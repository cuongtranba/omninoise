import { Injectable } from '@nestjs/common';
import { capitalize, sortBy } from 'lodash';
import { Integration } from '@prisma/client';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import { PostResponse } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  EnqueueOptions,
  FollowUp,
  Job,
  JobOutcome,
} from '@gitroom/nestjs-libraries/jobs/job.types';
import { JobWorker } from '@gitroom/nestjs-libraries/jobs/job.worker';
import {
  JobTimeout,
  withTimeout,
} from '@gitroom/nestjs-libraries/jobs/job.errors';

/**
 * The publish flow (it was the Temporal workflow postWorkflowV112) as a chain
 * of jobs. Every `sleep` became the `run_at` of the next job; the state the
 * workflow kept in memory travels in the payload.
 *
 *   post.publish ──▶ post.checkStatus ┐   (the platform answered "pending")
 *        │                            ▼
 *        └────────────▶ post.comment (one per comment, in order)
 *                             │
 *                             ▼
 *                        post.finish ──▶ post.plug ──▶ post.plug ...
 *
 * Every job of the chain holds the post's dedupe key, so the hourly sweep
 * (`keep`) never starts a second flow while one is alive.
 */

// A publish that outlives this is "outcome unknown" (the old 30 minute
// startToClose timeout of the mutating activities).
const MUTATION_TIMEOUT_MS = 30 * 60 * 1000;
const iterate = Array.from({ length: 5 });
// ~30 minutes at the 20s interval; multi-item flows (stories, chunked uploads)
// consume several checks per item, so it has to cover the largest post.
const MAX_PENDING_CHECKS = 90;
const CHECK_INTERVAL_MS = 20_000;
// A job is "due" within this slack of its publish date.
const DUE_SLACK_MS = 1_000;

type PendingState = {
  check: number;
  errorAttempts: number;
  data: any;
};

export type PostFlowState = {
  taskQueue: string;
  postId: string;
  organizationId: string;
  postNow?: boolean;
  /** The first stage already waited for the publish date. */
  waited?: boolean;
  /** When publishing started; the repeat delay is measured from here. */
  startTime?: number;
  /** The post being processed: 0 is the root, then the comments. */
  index?: number;
  results?: PostResponse[];
  pending?: PendingState;
};

type PlugTodo = { type: string; delay: number; [key: string]: any };

type PlugState = {
  taskQueue: string;
  postId: string;
  organizationId: string;
  integrationId: string;
  platformPostId: string;
  list: PlugTodo[];
};

type Flow = { post: any; postsList: any[] };
type Step = 'continue' | 'pending' | 'stop';

type Handled = {
  type: 'retry' | 'stop' | 'bad-body' | 'timeout' | 'unknown';
  message: string;
};

// changeState stores JSON.stringify(err); an Error would serialise as {}.
const errorValue = (err: any) =>
  typeof err === 'string' || typeof err?.toJSON === 'function'
    ? err
    : { message: err?.message ?? String(err) };

const chain = (
  job: Pick<Job, 'dedupeKey' | 'postId' | 'organizationId'>,
  extra: EnqueueOptions
): EnqueueOptions => ({
  dedupeKey: job.dedupeKey ?? undefined,
  postId: job.postId ?? undefined,
  organizationId: job.organizationId ?? undefined,
  ...extra,
});

@Injectable()
export class PostJobs {
  constructor(private _act: PostActivity) {}

  register(worker: JobWorker) {
    // A job that ends failed for good after its publish started has an
    // unknown outcome: the post is flagged so nobody republishes blindly.
    const onFailed = (job: Job, error: string) =>
      job.startedAt
        ? this.markUnconfirmedFor(job.payload as PostFlowState, error)
        : Promise.resolve();

    worker
      .register('post.publish', (job) => this.publish(job), { onFailed })
      .register('post.comment', (job) => this.comment(job), { onFailed })
      .register('post.checkStatus', (job) => this.checkStatus(job), {
        onFailed,
      })
      .register('post.finish', (job) => this.finish(job))
      .register('post.plug', (job) => this.plug(job));
  }

  // ---- post.publish -----------------------------------------------------
  private async publish(job: Job<PostFlowState>): Promise<JobOutcome | void> {
    const s: PostFlowState = { ...job.payload };
    const { postId, organizationId, postNow = false } = s;

    const firstPost = await this._act.getPost(organizationId, postId);

    // in case it doesn't exist for some reason, fail it
    if (!firstPost) {
      await this._act.changeState(postId, 'ERROR', 'No Post');
      return;
    }

    if (!postNow && firstPost.state !== 'QUEUE') {
      await this._act.changeState(firstPost.id, 'ERROR', 'Already posted', [
        firstPost,
      ]);
      return;
    }

    // wait for the scheduled publish date: the same job, due at that date
    if (!postNow && !s.waited) {
      const due = new Date(firstPost.publishDate).getTime();
      if (due - Date.now() > DUE_SLACK_MS) {
        return {
          next: [
            {
              kind: 'post.publish',
              payload: { ...s, waited: true },
              opts: chain(job, { queue: job.queue, runAt: new Date(due) }),
            },
          ],
        };
      }
    }

    // Measured after the wait: the repeat delay is "interval minus the time
    // spent publishing", not minus the time spent scheduled.
    s.startTime = Date.now();

    const flow = await this.loadFlow(s, true);
    if (!flow) {
      return;
    }

    s.index = 0;
    s.results = [];
    return this.runItem(job, s, flow);
  }

  // ---- post.comment -----------------------------------------------------
  private async comment(job: Job<PostFlowState>): Promise<JobOutcome | void> {
    const s: PostFlowState = { ...job.payload };
    const flow = await this.loadFlow(s, false);
    if (!flow) {
      return;
    }
    return this.runItem(job, s, flow);
  }

  // ---- post.checkStatus -------------------------------------------------
  // The platform accepted the post but is still processing it: poll the
  // read-only status check every 20 seconds. Errors are fully handled here
  // (never rethrown), otherwise they would re-run the publish.
  private async checkStatus(
    job: Job<PostFlowState>
  ): Promise<JobOutcome | void> {
    const s: PostFlowState = { ...job.payload };
    const flow = await this.loadFlow(s, false);
    if (!flow) {
      return;
    }
    const { post } = flow;
    const i = s.index!;
    const pending = s.pending!;
    const accepted = s.results![i];
    let retryNow = false;

    try {
      let result = await this._act.checkPostStatus(
        post.integration,
        pending.data
      );

      // commit the check's state BEFORE finalizePost runs: if finalize dies
      // mid-mutation, the next check must see what it had already authorized
      if (result.status !== 'completed') {
        pending.data = result.pendingData;
      }

      // polling is done, run the remaining provider mutations
      if (result.status === 'ready') {
        const ready = result;
        result = await withTimeout(
          () => this._act.finalizePost(post.integration, ready.pendingData),
          MUTATION_TIMEOUT_MS
        );
      }

      if (result.status === 'completed') {
        s.results![i] = {
          id: accepted.id,
          postId: result.postId,
          releaseURL: result.releaseURL,
          status: 'success',
        } as PostResponse;
        s.pending = undefined;
        const step = await this.record(s, flow, i);
        return this.afterStep(job, s, flow, step);
      }

      pending.data = result.pendingData;
      // a fully successful iteration proves the platform is reachable
      pending.errorAttempts = 0;
    } catch (err) {
      const handle = await this.handleError(err, flow);

      if (handle.type === 'stop') {
        // the token could not be refreshed, but the platform already accepted
        // the post: warn about a possible live post
        await this.markUnconfirmed(flow, err);
        return;
      }

      if (handle.type === 'bad-body') {
        await this._act.changeState(
          flow.postsList[0].id,
          'ERROR',
          errorValue(err),
          flow.postsList
        );
        await this._act.inAppNotification(
          post.organizationId,
          `Error posting on ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
          `An error occurred while posting on ${
            post.integration?.providerIdentifier
          }${handle.message ? `: ${handle.message}` : ``}`,
          true,
          false,
          'fail'
        );
        return;
      }

      if (handle.type === 'retry') {
        // a refreshed token checks again right away, still using up a check
        retryNow = true;
      } else {
        // unknown error on a read-only check, retry a few more times
        pending.errorAttempts++;
        if (pending.errorAttempts >= iterate.length) {
          await this.markUnconfirmed(flow, 'Could not confirm the post status');
          return;
        }
      }
    }

    pending.check++;
    if (pending.check >= MAX_PENDING_CHECKS) {
      // no verdict from the platform after all the checks
      await this.markUnconfirmed(flow, 'Could not confirm the post status');
      return;
    }

    return {
      next: [
        {
          kind: 'post.checkStatus',
          payload: s,
          opts: chain(job, {
            queue: job.queue,
            runAt: new Date(Date.now() + (retryNow ? 0 : CHECK_INTERVAL_MS)),
            retryDelayMs: 10_000,
          }),
        },
      ],
    };
  }

  // ---- post.finish ------------------------------------------------------
  private async finish(job: Job<PostFlowState>): Promise<JobOutcome | void> {
    const s = job.payload;
    const flow = await this.loadFlow(s, false);
    if (!flow) {
      return;
    }
    const { post } = flow;
    const results = s.results!;

    // send webhooks for the post
    await this._act.sendWebhooks(
      results[0].postId,
      post.organizationId,
      post.integration.id
    );

    // load internal plugs like repost by other users
    const internalPlugsList = await this._act.internalPlugs(
      post.integration,
      JSON.parse(post.settings)
    );

    // load global plugs, like repost a post if it gets to a certain number of likes
    const globalPlugsList = (
      await this._act.globalPlugs(post.integration)
    ).reduce((all: PlugTodo[], current: any) => {
      for (let i = 1; i <= current.totalRuns; i++) {
        all.push({
          ...current,
          delay: current.delay * i,
        });
      }

      return all;
    }, []);

    // Check if the post is repeatable
    const repeatPost: PlugTodo[] = !post.intervalInDays
      ? []
      : [
          {
            type: 'repeat-post',
            delay:
              post.intervalInDays * 24 * 60 * 60 * 1000 -
              (Date.now() - (s.startTime ?? Date.now())),
          },
        ];

    // Sort all the actions by delay, so we can process them in order
    const list = sortBy(
      [...internalPlugsList, ...globalPlugsList, ...repeatPost],
      'delay'
    ) as PlugTodo[];

    return this.nextPlug(
      job,
      {
        taskQueue: s.taskQueue,
        postId: s.postId,
        organizationId: s.organizationId,
        integrationId: post.integration.id,
        platformPostId: results[0].postId,
        list,
      },
      []
    );
  }

  // ---- post.plug --------------------------------------------------------
  // The plugs are processed in order, each one after its own delay counted
  // from the end of the previous one, as the workflow slept before each.
  private async plug(job: Job<PlugState>): Promise<JobOutcome | void> {
    const s: PlugState = { ...job.payload, list: [...job.payload.list] };
    const todo = s.list.shift();
    if (!todo) {
      return;
    }
    const next: FollowUp[] = [];

    // process internal plug
    if (todo.type === 'internal-plug') {
      for (const _ of iterate) {
        try {
          await this._act.processInternalPlug({
            ...todo,
            post: s.platformPostId,
          } as any);
        } catch (err) {
          const handle = await this.handleError(err, undefined, () =>
            this._act.getIntegrationById(s.organizationId, todo.integration)
          );

          if (handle.type === 'stop' || handle.type === 'bad-body') {
            break;
          }

          continue;
        }
        break;
      }
    }

    // process global plug
    if (todo.type === 'global') {
      for (const _ of iterate) {
        try {
          const process = await this._act.processPlug({
            ...todo,
            postId: s.platformPostId,
          } as any);
          if (process) {
            s.list = s.list.filter((item) => item.plugId !== todo.plugId);
          }
        } catch (err) {
          const handle = await this.handleError(err, undefined, () =>
            this._act.getIntegrationById(s.organizationId, s.integrationId)
          );

          if (handle.type === 'stop' || handle.type === 'bad-body') {
            break;
          }

          continue;
        }

        break;
      }
    }

    // process repeat post in a new flow, this is important so the other plugs can keep running
    if (todo.type === 'repeat-post') {
      next.push({
        kind: 'post.publish',
        payload: {
          taskQueue: s.taskQueue,
          postId: s.postId,
          organizationId: s.organizationId,
          postNow: true,
        } satisfies PostFlowState,
        opts: {
          queue: s.taskQueue,
          dedupeKey: `post:${s.postId}:${makeId(10)}`,
          postId: s.postId,
          organizationId: s.organizationId,
        },
      });
    }

    return this.nextPlug(job, s, next);
  }

  private nextPlug(job: Job<any>, s: PlugState, next: FollowUp[]): JobOutcome {
    if (s.list.length > 0) {
      next.push({
        kind: 'post.plug',
        payload: s,
        opts: chain(job, {
          queue: s.taskQueue,
          runAt: new Date(
            Date.now() + Math.max(0, Number(s.list[0].delay ?? 0))
          ),
        }),
      });
    }
    return { next };
  }

  // ---- shared -----------------------------------------------------------

  /** Loads the post and its comments the way the workflow did after its sleep. */
  private async loadFlow(
    s: PostFlowState,
    first: boolean
  ): Promise<Flow | undefined> {
    const postsListBefore = await this._act.getPostsList(
      s.organizationId,
      s.postId
    );
    const [post] = postsListBefore;

    if (!post) {
      await this._act.changeState(s.postId, 'ERROR', 'No Post');
      return;
    }

    if (first) {
      // if refresh is needed from last time, let's inform the user
      if (post.integration?.refreshNeeded) {
        await this._act.inAppNotification(
          post.organizationId,
          `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
          `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because you need to reconnect it. Please enable it and try again.`,
          true,
          false,
          'info'
        );

        await this._act.changeState(
          postsListBefore[0].id,
          'ERROR',
          'Refresh channel needed',
          postsListBefore
        );
        return;
      }

      // if it's disabled, inform the user
      if (post.integration?.disabled) {
        await this._act.inAppNotification(
          post.organizationId,
          `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
          `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because it's disabled. Please enable it and try again.`,
          true,
          false,
          'info'
        );

        await this._act.changeState(
          postsListBefore[0].id,
          'ERROR',
          'Channel disabled',
          postsListBefore
        );
        return;
      }
    }

    // Do we need to post comments for this social?
    const toComment: boolean =
      postsListBefore.length === 1
        ? false
        : await this._act.isCommentable(post.integration);

    return {
      post,
      postsList: toComment ? postsListBefore : [postsListBefore[0]],
    };
  }

  // Failure classification, once instead of in every catch block.
  // 'retry' - the token was refreshed, run the action again
  // 'stop' - the token could not be refreshed
  // 'bad-body' - the platform rejected the action
  // 'timeout' - the call outlived its budget, its outcome is unknown
  // 'unknown' - anything else (transient errors)
  // (A call that never started is not seen here: the reaper re-queues it.)
  private async handleError(
    err: any,
    flow?: Flow,
    getIntegration?: () => Promise<any>
  ): Promise<Handled> {
    if (err instanceof JobTimeout) {
      return { type: 'timeout', message: '' };
    }

    if (err?.type === 'refresh_token') {
      const refresh = await this._act.refreshTokenWithCause(
        getIntegration ? await getIntegration() : flow!.post.integration,
        err.message || ''
      );
      if (!refresh || !refresh.accessToken) {
        return { type: 'stop', message: err.message || '' };
      }

      if (!getIntegration) {
        flow!.post.integration.token = refresh.accessToken;
      }

      return { type: 'retry', message: err.message || '' };
    }

    if (err?.type === 'bad_body') {
      return { type: 'bad-body', message: err.message || '' };
    }

    return { type: 'unknown', message: '' };
  }

  // The platform may have accepted the post but we can't confirm it was
  // published - mark the error with a distinct message so the user checks the
  // account before reposting manually and duplicating it.
  private async markUnconfirmed(flow: Flow, err: any) {
    const { post, postsList } = flow;
    await this._act.changeState(
      postsList[0].id,
      'ERROR',
      errorValue(err),
      postsList
    );
    await this._act.inAppNotification(
      post.organizationId,
      `We couldn't confirm your post on ${capitalize(
        post.integration?.providerIdentifier
      )}`,
      `Your post was sent to ${capitalize(
        post.integration?.providerIdentifier
      )}, but we couldn't confirm it was published. Please check your ${
        post?.integration?.name
      } account before posting again to avoid duplicates.`,
      true,
      false,
      'fail'
    );
  }

  private async markUnconfirmedFor(s: PostFlowState, error: string) {
    const list = await this._act.getPostsList(s.organizationId, s.postId);
    if (!list[0]) {
      return;
    }
    await this.markUnconfirmed({ post: list[0], postsList: [list[0]] }, error);
  }

  // Publishes postsList[index], repeating the action after a token refresh.
  private async runItem(
    job: Job<PostFlowState>,
    s: PostFlowState,
    flow: Flow
  ): Promise<JobOutcome | void> {
    const { post, postsList } = flow;
    const i = s.index!;
    const results = s.results!;
    const before = results.length;

    // this is a small trick to repeat an action in case of token refresh
    for (const _ of iterate) {
      try {
        // first post the main post
        if (i === 0) {
          results.push(
            ...(await withTimeout(
              () =>
                this._act.postSocialPending(post.integration as Integration, [
                  postsList[i],
                ]),
              MUTATION_TIMEOUT_MS
            ))
          );

          // then post the comments if any
        } else {
          results.push(
            ...(await withTimeout(
              () =>
                this._act.postComment(
                  results[0].postId,
                  results.length === 1 ? undefined : results[i - 1].postId,
                  post.integration,
                  [postsList[i]]
                ),
              MUTATION_TIMEOUT_MS
            ))
          );
        }
      } catch (err) {
        const handle = await this.handleError(err, flow);

        // token refreshed, repeat the action
        if (handle.type === 'retry') {
          continue;
        }

        // the call timed out: the platform may still complete the publish in
        // the background, so never retry it
        if (handle.type === 'timeout') {
          await this.markUnconfirmed(flow, err).catch(() => undefined);
          return;
        }

        // for other errors, change state and inform the user if needed
        await this._act.changeState(
          postsList[0].id,
          'ERROR',
          errorValue(err),
          postsList
        );

        if (handle.type === 'stop') {
          return;
        }

        // specific case for bad body errors
        if (handle.type === 'bad-body') {
          await this._act.inAppNotification(
            post.organizationId,
            `Error posting${i === 0 ? ' ' : ' comments '}on ${
              post.integration?.providerIdentifier
            } for ${post?.integration?.name}`,
            `An error occurred while posting${i === 0 ? ' ' : ' comments '}on ${
              post.integration?.providerIdentifier
            }${handle.message ? `: ${handle.message}` : ``}`,
            true,
            false,
            'fail'
          );
          return;
        }

        // unknown errors are repeated, like the workflow did
        continue;
      }

      // The platform accepted it: from here the publish must never run again.
      let step: Step;
      try {
        if (results[i].status === 'pending') {
          s.pending = {
            check: 0,
            errorAttempts: 0,
            data: results[i].pendingData,
          };
          step = 'pending';
        } else {
          step = await this.record(s, flow, i);
        }
      } catch (err) {
        await this.markUnconfirmed(flow, err).catch(() => undefined);
        return;
      }
      return this.afterStep(job, s, flow, step);
    }

    if (results.length === before) {
      // all retries exhausted without success: record it, otherwise the post
      // stays in QUEUE with no error and the missing-posts sweep re-publishes
      // it. A retried publish may have run without reporting, so treat the
      // outcome as unknown.
      await this.markUnconfirmed(
        flow,
        'Could not publish after several attempts'
      ).catch(() => undefined);
    }
  }

  // mark the post as successful
  private async record(s: PostFlowState, flow: Flow, i: number): Promise<Step> {
    const { post, postsList } = flow;
    const result = s.results![i];
    let updated = false;
    try {
      await this._act.updatePost(
        postsList[i].id,
        result.postId,
        result.releaseURL
      );
      updated = true;

      if (i === 0) {
        // send notification on a successful post
        await this._act.inAppNotification(
          post.integration.organizationId,
          `Your post has been published on ${capitalize(
            post.integration.providerIdentifier
          )}`,
          `Your post has been published on ${capitalize(
            post.integration.providerIdentifier
          )} at ${result.releaseURL}`,
          true,
          true
        );
      }
    } catch (err) {
      if (!updated) {
        // still marked QUEUE, record the error so the missing-posts sweep
        // doesn't re-publish it
        await this.markUnconfirmed(flow, err).catch(() => undefined);
        return 'stop';
      }
      // already marked published, a failed notification shouldn't abort
      // the rest of the flow
    }
    return 'continue';
  }

  private afterStep(
    job: Job<PostFlowState>,
    s: PostFlowState,
    flow: Flow,
    step: Step
  ): JobOutcome | void {
    if (step === 'stop') {
      return;
    }

    if (step === 'pending') {
      // the first check runs right away
      return {
        next: [
          {
            kind: 'post.checkStatus',
            payload: s,
            opts: chain(job, { queue: s.taskQueue, retryDelayMs: 10_000 }),
          },
        ],
      };
    }

    const i = s.index!;
    const nextIndex = i + 1;
    if (nextIndex < flow.postsList.length) {
      const delay = flow.postsList[nextIndex].delay;
      return {
        next: [
          {
            kind: 'post.comment',
            payload: { ...s, index: nextIndex, pending: undefined },
            opts: chain(job, {
              queue: s.taskQueue,
              runAt: new Date(
                Date.now() + (delay ? 60000 * Math.max(0, Number(delay)) : 0)
              ),
            }),
          },
        ],
      };
    }

    return {
      next: [
        {
          kind: 'post.finish',
          payload: { ...s, pending: undefined },
          opts: chain(job, { queue: 'main' }),
        },
      ],
    };
  }
}
