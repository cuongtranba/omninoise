import { Injectable } from '@nestjs/common';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import { AutopostActivity } from '@gitroom/orchestrator/activities/autopost.activity';
import { IntegrationsActivity } from '@gitroom/orchestrator/activities/integrations.activity';
import { EmailActivity } from '@gitroom/orchestrator/activities/email.activity';
import { JobWorker } from '@gitroom/nestjs-libraries/jobs/job.worker';
import { Job, JobOutcome } from '@gitroom/nestjs-libraries/jobs/job.types';
import {
  deleteDigestItems,
  readDigestItems,
} from '@gitroom/nestjs-libraries/jobs/digest.queue';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const MISSING_POSTS_KEY = 'system.missingPosts';

/**
 * The jobs that run for as long as the app does. Each one
 * schedules its own next run when it completes (never a long sleep), and
 * always does: a failed run must not end the cycle.
 */
@Injectable()
export class SystemJobs {
  constructor(
    private _post: PostActivity,
    private _autopost: AutopostActivity,
    private _integrations: IntegrationsActivity,
    private _email: EmailActivity
  ) {}

  register(worker: JobWorker) {
    worker
      .register(MISSING_POSTS_KEY, (job) => this.missingPosts(job))
      .register('autopost', (job) => this.autopost(job))
      .register('integration.refresh', (job) => this.refresh(job))
      .register('streak', (job) => this.streak(job))
      .register('digest', (job) => this.digest(job));
  }

  // QUEUE posts of the last two days that have no live job get one
  private async missingPosts(job: Job): Promise<JobOutcome> {
    try {
      await this._post.searchForMissingThreeHoursPosts();
    } catch (err) {
      console.error('missingPosts failed', (err as Error).message);
    }
    return {
      next: [
        {
          kind: MISSING_POSTS_KEY,
          opts: {
            dedupeKey: MISSING_POSTS_KEY,
            mode: 'keep',
            runAt: new Date(Date.now() + HOUR),
          },
        },
      ],
    };
  }

  // reads the autopost settings on every run
  private async autopost(
    job: Job<{ id: string; organizationId?: string }>
  ): Promise<JobOutcome> {
    const { id, organizationId } = job.payload;
    try {
      await this._autopost.autoPost(id);
    } catch (err) {}
    return {
      next: [
        {
          kind: 'autopost',
          payload: job.payload,
          opts: {
            dedupeKey: `autopost:${id}`,
            mode: 'keep',
            organizationId,
            runAt: new Date(Date.now() + HOUR),
          },
        },
      ],
    };
  }

  // Refreshes a token when it expires, then waits for the new expiry.
  // `scheduled` is false only for the job that starts the cycle: it just
  // finds the expiry and sleeps (as a job) until it.
  private async refresh(
    job: Job<{
      integrationId: string;
      organizationId: string;
      scheduled?: boolean;
    }>
  ): Promise<JobOutcome | void> {
    const { integrationId, organizationId } = job.payload;

    const load = async () => {
      const integration = await this._integrations.getIntegrationsById(
        integrationId,
        organizationId
      );
      return !integration ||
        integration.deletedAt ||
        integration.inBetweenSteps ||
        integration.refreshNeeded
        ? undefined
        : integration;
    };

    if (job.payload.scheduled) {
      // while we waited, the integration might have been deleted
      const integration = await load();
      if (!integration) {
        return;
      }
      await this._post.refreshToken(integration);
    }

    const integration = await load();
    if (!integration) {
      return;
    }

    const wait = new Date(integration.tokenExpiration!).getTime() - Date.now();
    if (!(wait > 0)) {
      return;
    }

    return {
      next: [
        {
          kind: 'integration.refresh',
          payload: { integrationId, organizationId, scheduled: true },
          opts: {
            dedupeKey: `refresh:${integrationId}`,
            mode: 'keep',
            organizationId,
            runAt: new Date(Date.now() + wait),
          },
        },
      ],
    };
  }

  // Wakes when the last post is a day old and ends the streak if nothing
  // newer was published.
  private async streak(
    job: Job<{ organizationId: string; lastPost?: number }>
  ): Promise<JobOutcome | void> {
    const { organizationId } = job.payload;
    const lastPost = Math.max(
      job.payload.lastPost ?? 0,
      (await this._email.getLastPublishDate(organizationId)) || 0
    );

    if (lastPost + DAY > Date.now()) {
      return {
        next: [
          {
            kind: 'streak',
            payload: { organizationId, lastPost },
            opts: {
              dedupeKey: `streak:${organizationId}`,
              mode: 'keep',
              organizationId,
              runAt: new Date(Math.max(Date.now() + 1000, lastPost + DAY)),
            },
          },
        ],
      };
    }

    const userOrgs = await this._email.getUserOrgs(organizationId);
    for (const user of userOrgs.users) {
      if (!user.user.sendStreakEmails) {
        continue;
      }
      await this._email.sendEmailAsync(
        user.user.email,
        'Streak Ended',
        "<p>Your streak has ended! You didn't post anything in the last 24 hours. Schedule a post now to start a new streak!</p>",
        'bottom'
      );
    }
    await this._email.setStreak(organizationId, 'end');
  }

  // An hour after the first notification, sends what piled up as one email
  private async digest(
    job: Job<{ organizationId: string }>
  ): Promise<JobOutcome | void> {
    const { organizationId } = job.payload;
    const items = await readDigestItems(organizationId);
    if (items.length === 0) {
      return;
    }
    const batch = items.map((i) => i.item);

    const org = await this._email.getUserOrgs(organizationId);

    for (const user of org.users) {
      const allowFailure = user.user.sendFailureEmails ? 'fail' : null;
      const allowSuccess = user.user.sendSuccessEmails ? 'success' : null;

      const toSend = batch.filter(
        (email) =>
          email.type === allowFailure ||
          email.type === allowSuccess ||
          email.type === 'info'
      );

      if (toSend.length === 0) continue;

      await this._email.sendEmailAsync(
        user.user.email,
        toSend.length === 1
          ? toSend[0].title!
          : `[Postiz] Your latest notifications`,
        toSend.map((p) => p.message).join('<br/>'),
        'bottom'
      );
    }

    // Items that arrived while this ran got no digest of their own (the key
    // was taken), so arm the next one.
    const more = await deleteDigestItems(
      organizationId,
      items.map((i) => i.id)
    );
    if (more) {
      return {
        next: [
          {
            kind: 'digest',
            payload: { organizationId },
            opts: {
              dedupeKey: `digest:${organizationId}`,
              mode: 'keep',
              organizationId,
              runAt: new Date(Date.now() + HOUR),
            },
          },
        ],
      };
    }
  }
}
