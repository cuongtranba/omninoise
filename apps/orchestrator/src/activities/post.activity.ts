import { Injectable } from '@nestjs/common';
import { capitalize } from 'lodash';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  NotificationService,
  NotificationType,
} from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Integration, Post, State } from '@prisma/client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { AuthTokenDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { timer } from '@gitroom/helpers/utils/timer';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { JobQueueService } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { providerQueue } from '@gitroom/nestjs-libraries/jobs/job.queues';
import { markStarted } from '@gitroom/nestjs-libraries/jobs/job.context';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { setHeartbeatDetails } from '@gitroom/nestjs-libraries/jobs/job.context';
import {
  BadBody,
  Disconnect,
  PublishedWithError,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

// Drops fields the workflow and downstream activities never read — biggest wins are `error` (grows per retry) and `childrenPost` (Prisma side-loads it on every recursive row).
function slimPost(post: any) {
  if (!post) return post;
  const {
    error,
    childrenPost,
    tags,
    description,
    title,
    submittedForOrderId,
    submittedForOrganizationId,
    submittedForOrder,
    submittedForOrganization,
    lastMessageId,
    parentPostId,
    approvedSubmitForOrder,
    deletedAt,
    createdAt,
    updatedAt,
    payoutProblems,
    comments,
    errors,
    ...rest
  } = post;
  return rest;
}

// A genuinely missed occurrence (dead workflow) is only recovered by the
// missing-posts sweep, which runs every hour - so anything later than the
// sweep period plus retry margin is a stale anchor, not a missed publish.
const REANCHOR_GRACE_MS = 2 * 60 * 60 * 1000;

// A repeat post keeps its original anchor publishDate forever (updatePost only
// flips the state, the calendar expands occurrences virtually). If the workflow
// gets that raw past date, any (re)start - an accidental edit resetting the
// state to QUEUE, or a missing-posts sweep poke - sleeps 0 and publishes
// instantly, machine-gunning the channel. Roll the returned date forward to the
// next occurrence on the anchor grid instead, so fresh starts wait for the next
// real occurrence. Only for the initial QUEUE run: repeat chain children
// (postNow) run against a PUBLISHED post and must keep publishing immediately.
// Occurrences missed within the grace window still catch up and post.
function reanchorInterval(post: any) {
  if (!post?.intervalInDays || post.state !== State.QUEUE) {
    return post;
  }

  const interval = post.intervalInDays * 24 * 60 * 60 * 1000;
  const late = Date.now() - new Date(post.publishDate).getTime();
  if (late <= REANCHOR_GRACE_MS) {
    return post;
  }

  const next =
    new Date(post.publishDate).getTime() +
    Math.ceil(late / interval) * interval;

  return { ...post, publishDate: new Date(next) };
}

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class PostActivity {
  constructor(
    private _postService: PostsService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _webhookService: WebhooksService,
    private _queue: JobQueueService,
    private _subscriptionService: SubscriptionService,
    private _organizationService: OrganizationService
  ) {}

  async getIntegrationById(orgId: string, id: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  async searchForMissingThreeHoursPosts() {
    const list = await this._postService.searchForMissingThreeHoursPosts();
    // A post whose publish ever began has an unknown outcome (it may be live
    // although the flow never recorded it): publishing it again could
    // duplicate it, so it is never picked up automatically. One that is past
    // due with nothing left alive is reported to its owner instead.
    const { publish, unconfirmed } = await this._queue.classifyQueuedPosts(
      list
    );
    await this.markUnconfirmedPosts(
      list.filter((post) => unconfirmed.includes(post.id))
    );
    let enqueued = 0;
    for (const post of list) {
      if (!publish.includes(post.id)) {
        continue;
      }
      enqueued++;
      // 'keep': a post that already has a live job is left alone
      await this._queue.enqueue(
        'post.publish',
        {
          taskQueue: providerQueue(post.integration.providerIdentifier),
          postId: post.id,
          organizationId: post.organizationId,
        },
        {
          queue: providerQueue(post.integration.providerIdentifier),
          dedupeKey: `post:${post.id}`,
          mode: 'keep',
          postId: post.id,
          organizationId: post.organizationId,
        }
      );
    }
    return enqueued;
  }

  /**
   * Posts that are still QUEUE although a publish of theirs began and nothing
   * is alive any more: the outcome was never written (the database was out
   * while the flow settled). They may be live, so they leave QUEUE with the
   * usual "check the account before posting again" error and notification.
   * One post failing does not stop the others.
   */
  async markUnconfirmedPosts(
    posts: {
      id: string;
      organizationId: string;
      integration: { providerIdentifier: string; name?: string | null };
    }[]
  ) {
    for (const post of posts) {
      try {
        await this._postService.changeState(
          post.id,
          'ERROR',
          'The outcome of the publish was never recorded'
        );
        const provider = capitalize(post.integration.providerIdentifier);
        await this._notificationService.inAppNotification(
          post.organizationId,
          `We couldn't confirm your post on ${provider}`,
          `Your post was sent to ${provider}, but we couldn't confirm it was published. Please check your ${
            post.integration.name ?? provider
          } account before posting again to avoid duplicates.`,
          true,
          false,
          'fail'
        );
      } catch (err) {
        console.error(
          `post activity: could not mark post ${post.id} unconfirmed`,
          (err as Error)?.message
        );
      }
    }
  }

  async updatePost(id: string, postId: string, releaseURL: string) {
    await this._postService.updatePost(id, postId, releaseURL);
  }

  async getPost(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return false;
      }
    }
    const post = await this._postService.getPostById(postId, orgId);
    if (post.deletedAt) {
      return false;
    }

    return reanchorInterval(post);
  }

  /** One comment of a post's chain by id; undefined once it was deleted. */
  async getComment(orgId: string, id: string) {
    const [comment] = await this._postService.getPostsRecursively(
      id,
      false,
      orgId
    );
    return comment ? slimPost(comment) : undefined;
  }

  async getPostsList(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return [];
      }
    }

    const getPosts = await this._postService.getPostsRecursively(
      postId,
      true,
      orgId
    );
    if (!getPosts || getPosts.length === 0 || getPosts[0].parentPostId) {
      return [];
    }

    // only the root drives the pre-publish sleep and the repeat schedule,
    // the rest are comments
    const [root, ...comments] = getPosts.map(slimPost);
    return [reanchorInterval(root), ...comments];
  }

  async isCommentable(integration: Integration) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return !!getIntegration.comment;
  }

  async postComment(
    postId: string,
    lastPostId: string | undefined,
    integration: Integration,
    posts: Post[]
  ) {
    return this.handleDisconnect(integration, async () => {
      const getIntegration = this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      );

      const newPosts = await this._postService.updateTags(
        integration.organizationId,
        posts
      );

      const mappedPosts = await Promise.all(
        (newPosts || []).map(async (p) => ({
          id: p.id,
          message: stripHtmlValidation(
            getIntegration.editor,
            p.content,
            true,
            false,
            !/<\/?[a-z][\s\S]*>/i.test(p.content),
            getIntegration.mentionFormat
          ),
          settings: JSON.parse(p.settings || '{}'),
          media: await this._postService.updateMedia(
            p.id,
            JSON.parse(p.image || '[]'),
            getIntegration?.convertToJPEG || false
          ),
        }))
      );

      // everything before this line can be run again; the comment cannot
      await markStarted();
      return getIntegration.comment(
        integration.internalId,
        postId,
        lastPostId,
        integration.token,
        mappedPosts,
        integration
      );
    });
  }

  async postSocial(integration: Integration, posts: Post[]) {
    return this.postSocialInternal(integration, posts, false);
  }

  // Providers that implement `postPending` return a `pending` response the
  // post flow resolves via checkPostStatus / finalizePost.
  async postSocialPending(integration: Integration, posts: Post[]) {
    return this.postSocialInternal(integration, posts, true);
  }

  // A Disconnect error means the platform will keep rejecting this channel no
  // matter how many token refreshes (e.g. TikTok's daily active user cap):
  // mark the channel as needing a re-connect and notify the user, then rethrow
  // as BadBody so the post flow treats it as a terminal error.
  private async handleDisconnect<T>(
    integration: Integration,
    func: () => Promise<T>
  ): Promise<T> {
    try {
      return await func();
    } catch (err) {
      if (err instanceof Disconnect) {
        try {
          await this._integrationService.disconnectChannel(
            integration.organizationId,
            integration,
            err.message
          );
        } catch (e) {
          /**empty**/
        }

        throw new BadBody(
          integration.providerIdentifier,
          JSON.stringify({}),
          Buffer.from('{}'),
          err.message
        );
      }

      // The post is live but a follow-up mutation failed: keep its platform
      // id / URL on the post, then fail it as BadBody like any other error.
      if (err instanceof PublishedWithError) {
        try {
          await this._postService.updateResolvedRelease(
            err.postDbId,
            integration.organizationId,
            err.releaseId,
            err.releaseURL
          );
        } catch (e) {
          /**empty**/
        }

        throw new BadBody(
          integration.providerIdentifier,
          JSON.stringify({}),
          Buffer.from('{}'),
          err.message
        );
      }

      throw err;
    }
  }

  private async postSocialInternal(
    integration: Integration,
    posts: Post[],
    allowPending: boolean
  ) {
    return this.handleDisconnect(integration, () =>
      this.postSocialBody(integration, posts, allowPending)
    );
  }

  // A publish starts the organization's streak unless one is already running;
  // the running one checks for newer posts before it ends.
  private async startStreak(organizationId: string) {
    const { created } = await this._queue.enqueue(
      'streak',
      { organizationId, lastPost: Date.now() },
      {
        dedupeKey: `streak:${organizationId}`,
        mode: 'keep',
        organizationId,
        runAt: new Date(Date.now() + DAY),
      }
    );
    if (created) {
      await this._organizationService.setStreak(organizationId, 'start');
    }
  }

  private async postSocialBody(
    integration: Integration,
    posts: Post[],
    allowPending: boolean
  ) {
    // Stage markers: whatever ran last is what a timed-out activity reports.
    // Providers that go through this.fetch overwrite these with the exact URL;
    // the ones on their own HTTP client (x, youtube, bluesky) are still
    // narrowed down to the step they hung on.
    setHeartbeatDetails('subscription lookup');
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        integration.organizationId
      );

      if (!subscription) {
        throw new Error('No active subscription found for this organization.');
      }
    }

    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    setHeartbeatDetails('update tags');
    const newPosts = await this._postService.updateTags(
      integration.organizationId,
      posts
    );

    setHeartbeatDetails('resolve media');
    const mappedPosts = await Promise.all(
      (newPosts || []).map(async (p) => ({
        id: p.id,
        message: stripHtmlValidation(
          getIntegration.editor,
          p.content,
          true,
          false,
          !/<\/?[a-z][\s\S]*>/i.test(p.content),
          getIntegration.mentionFormat,
          !!getIntegration.inlineImages?.(JSON.parse(p.settings || '{}'))
        ),
        settings: JSON.parse(p.settings || '{}'),
        media: await this._postService.updateMedia(
          p.id,
          JSON.parse(p.image || '[]'),
          getIntegration?.convertToJPEG || false
        ),
      }))
    );

    setHeartbeatDetails(`${integration.providerIdentifier}: publish`);
    // everything before this line can be run again; the publish cannot
    await markStarted();
    const postNow =
      allowPending && getIntegration.postPending
        ? await getIntegration.postPending(
            integration.internalId,
            integration.token,
            mappedPosts,
            integration
          )
        : await getIntegration.post(
            integration.internalId,
            integration.token,
            mappedPosts,
            integration
          );

    // The post is already published at this point: the streak is best-effort,
    // failing the activity here would retry it and publish again.
    setHeartbeatDetails(`${integration.providerIdentifier}: published, streak`);
    try {
      await this.startStreak(integration.organizationId);
    } catch (err) {
      /**empty**/
    }

    return postNow;
  }

  async checkPostStatus(integration: Integration, pendingData: any) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return this.handleDisconnect(integration, () =>
      getIntegration.checkPostStatus(
        integration.token,
        pendingData,
        integration
      )
    );
  }

  async finalizePost(integration: Integration, pendingData: any) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    // finalize runs provider mutations: it cannot be repeated after this line
    await markStarted();
    return this.handleDisconnect(integration, () =>
      getIntegration.finalizePost(integration.token, pendingData, integration)
    );
  }

  async inAppNotification(
    orgId: string,
    subject: string,
    message: string,
    sendEmail = false,
    digest = false,
    type: NotificationType = 'success'
  ) {
    await this._notificationService.inAppNotification(
      orgId,
      subject,
      message,
      sendEmail,
      digest,
      type
    );
  }

  async globalPlugs(integration: Integration) {
    return this._postService.checkPlugs(
      integration.organizationId,
      integration.providerIdentifier,
      integration.id
    );
  }

  /** Notes a failure on the post without changing its state. */
  async recordPostError(id: string, error: string) {
    await this._postService.setError(id, error);
  }

  async changeState(id: string, state: State, err?: any, body?: any) {
    await this._postService.changeState(id, state, err, body);
  }

  async internalPlugs(integration: Integration, settings: any) {
    return this._postService.checkInternalPlug(
      integration,
      integration.organizationId,
      integration.id,
      settings
    );
  }

  async sendWebhooks(postId: string, orgId: string, integrationId: string) {
    // Webhooks are best-effort and run after the post already published, so a
    // failure here must not fail the workflow.
    try {
      const webhooks = (await this._webhookService.getWebhooks(orgId)).filter(
        (f) => {
          return (
            f.integrations.length === 0 ||
            f.integrations.some((i) => i.integration.id === integrationId)
          );
        }
      );

      if (webhooks.length === 0) {
        return;
      }

      const post = await this._postService.getPostByForWebhookId(
        postId,
        integrationId
      );
      await Promise.all(
        webhooks.map(async (webhook) => {
          try {
            // webhook.url is validated at save time, but DNS can change
            // between then and now - pin resolution like every other
            // user-influenced outbound request.
            await fetch(webhook.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(post),
              // @ts-ignore — undici option, not in lib.dom fetch types
              dispatcher: getSsrfSafeDispatcher(),
            });
          } catch (e) {
            /**empty**/
          }
        })
      );
    } catch (err) {
      /**empty**/
    }
  }
  async processPlug(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    return this._integrationService.processPlugs(data);
  }

  async processInternalPlug(data: {
    post: string;
    originalIntegration: string;
    integration: string;
    plugName: string;
    orgId: string;
    delay: number;
    information: any;
  }) {
    await this._integrationService.processInternalPlug(data);
  }

  async refreshToken(
    integration: Integration
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(
        integration,
        (err as Error)?.message || ''
      );
      return false;
    }
  }

  async refreshTokenWithCause(
    integration: Integration,
    cause: string
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration,
        cause
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(
        integration,
        cause || (err as Error)?.message || ''
      );
      return false;
    }
  }
}
