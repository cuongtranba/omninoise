import { Injectable } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { JobQueueService } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { providerQueue } from '@gitroom/nestjs-libraries/jobs/job.queues';
import { socialIntegrationList } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { MISSING_POSTS_KEY } from '@gitroom/orchestrator/jobs/system.jobs';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Brings the job table in line with the database at boot: everything that
 * used to be a sleeping workflow gets its job. Every job is enqueued with
 * `keep`, so running it again (another boot, another orchestrator) changes
 * nothing for work that already has a live job.
 */
@Injectable()
export class JobSeeder {
  constructor(
    private _queue: JobQueueService,
    private _prisma: PrismaService,
    private _organizationService: OrganizationService
  ) {}

  async seed() {
    const counts = {
      missingPosts: 0,
      posts: 0,
      refresh: 0,
      autoposts: 0,
      streaks: 0,
    };

    // RUN_CRON gates the hourly sweep, as it gated the cron workflow
    if (process.env.RUN_CRON) {
      const res = await this._queue.enqueue(
        MISSING_POSTS_KEY,
        {},
        { dedupeKey: MISSING_POSTS_KEY, mode: 'keep' }
      );
      counts.missingPosts = res.created ? 1 : 0;
    }

    // QUEUE root posts (the sweep's two-day window: older ones were given up)
    const posts = await this._prisma.post.findMany({
      where: {
        state: 'QUEUE',
        deletedAt: null,
        parentPostId: null,
        publishDate: { gte: new Date(Date.now() - 2 * DAY) },
        integration: { deletedAt: null },
      },
      select: {
        id: true,
        organizationId: true,
        publishDate: true,
        integration: { select: { providerIdentifier: true } },
      },
    });
    // A post whose publish ever began is not re-published on boot: it may be
    // live although the flow never recorded it.
    const started = await this._queue.startedPublishPostIds(
      posts.map((post) => post.id)
    );
    for (const post of posts) {
      if (started.has(post.id)) {
        continue;
      }
      const queue = providerQueue(post.integration.providerIdentifier);
      const res = await this._queue.enqueue(
        'post.publish',
        {
          taskQueue: queue,
          postId: post.id,
          organizationId: post.organizationId,
        },
        {
          queue,
          dedupeKey: `post:${post.id}`,
          mode: 'keep',
          postId: post.id,
          organizationId: post.organizationId,
          runAt: post.publishDate,
        }
      );
      counts.posts += res.created ? 1 : 0;
    }

    // tokens that refresh themselves
    const refreshable = new Set(
      socialIntegrationList
        .filter((p) => p.refreshCron)
        .map((p) => p.identifier)
    );
    const integrations = await this._prisma.integration.findMany({
      where: {
        deletedAt: null,
        inBetweenSteps: false,
        refreshNeeded: false,
        providerIdentifier: { in: [...refreshable] },
      },
      select: { id: true, organizationId: true },
    });
    for (const integration of integrations) {
      const res = await this._queue.enqueue(
        'integration.refresh',
        {
          integrationId: integration.id,
          organizationId: integration.organizationId,
        },
        {
          dedupeKey: `refresh:${integration.id}`,
          mode: 'keep',
          organizationId: integration.organizationId,
        }
      );
      counts.refresh += res.created ? 1 : 0;
    }

    const autoposts = await this._prisma.autoPost.findMany({
      where: { active: true, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    for (const autopost of autoposts) {
      const res = await this._queue.enqueue(
        'autopost',
        { id: autopost.id, organizationId: autopost.organizationId },
        {
          dedupeKey: `autopost:${autopost.id}`,
          mode: 'keep',
          organizationId: autopost.organizationId,
        }
      );
      counts.autoposts += res.created ? 1 : 0;
    }

    // organizations with a running streak (streakSince is set while it runs)
    const orgs = await this._prisma.organization.findMany({
      where: { streakSince: { not: null } },
      select: { id: true },
    });
    for (const org of orgs) {
      const lastPost =
        (await this._organizationService.getLastPublishDate(org.id)) ||
        Date.now();
      const res = await this._queue.enqueue(
        'streak',
        { organizationId: org.id, lastPost },
        {
          dedupeKey: `streak:${org.id}`,
          mode: 'keep',
          organizationId: org.id,
          runAt: new Date(lastPost + DAY),
        }
      );
      counts.streaks += res.created ? 1 : 0;
    }

    console.log(
      `Job seeding done (new jobs): ${counts.missingPosts} missing-posts sweep, ` +
        `${counts.posts} posts, ${counts.refresh} token refreshes, ` +
        `${counts.autoposts} autoposts, ${counts.streaks} streaks`
    );
    return counts;
  }
}
