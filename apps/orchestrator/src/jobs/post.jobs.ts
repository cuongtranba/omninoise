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
  JobQueueService,
  NEXT_SUFFIX,
  REPEAT_SUFFIX,
} from '@gitroom/nestjs-libraries/jobs/job.queue';
import {
  assertOwned,
  markStarted,
} from '@gitroom/nestjs-libraries/jobs/job.context';
import {
  isJobNotOwned,
  isNonRetryable,
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
 *                        post.finish ──▶ post.plugPlan ──▶ post.plug ──▶ ...
 *                      (webhooks, once)  (plugs, repeat)
 *
 * Every job of the chain holds the post's dedupe key, so the hourly sweep
 * (`keep`) never starts a second flow while one is alive.
 *
 * Two rules keep a post from being published twice or never:
 *  - once a provider call began (`markStarted`) nothing re-runs the job; a
 *    failure after that point settles the post's state in `onFailed`;
 *  - a handler whose job was cancelled or reclaimed (`JobNotOwned`) writes
 *    nothing: the job that replaced it owns the post.
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
// Waits between the tries of a database call (V112 retried each activity 3x).
// Bounded to ~21s: a handler holds its lease while it waits.
const DB_RETRY_DELAYS_MS = [1_000, 4_000, 16_000];
// A publish that waits for the chain in flight to end looks again this often.
const DEFER_MS = 30_000;
// plugPlan that failed for good is scheduled again this many times, a while apart.
const PLAN_RETRIES = 3;
const PLAN_RETRY_DELAY_MS = 10 * 60 * 1000;
// A plug that keeps failing is tried this many times, a while apart.
const PLUG_ATTEMPTS = 5;
const PLUG_RETRY_DELAY_MS = 2 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Repeats a database-only call that failed transiently. Never use it on a provider call. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (
        isJobNotOwned(err) ||
        isNonRetryable(err) ||
        attempt >= DB_RETRY_DELAYS_MS.length
      ) {
        throw err;
      }
      await sleep(DB_RETRY_DELAYS_MS[attempt]);
    }
  }
}

// For best-effort writes: swallow the failure, but never a lost job.
const quiet = (err: unknown) => {
  if (isJobNotOwned(err)) {
    throw err;
  }
};

type PendingState = {
  check: number;
  errorAttempts: number;
  data: any;
};

/** A comment of the post, in publishing order; its content is read when its turn comes. */
type CommentRef = { id: string; delay: number };

export type PostFlowState = {
  taskQueue: string;
  postId: string;
  organizationId: string;
  postNow?: boolean;
  /** The first stage already waited for the publish date. */
  waited?: boolean;
  /** When publishing started; the repeat delay is measured from here. */
  startTime?: number;
  /**
   * The comments to publish after the root, fixed when the root publishes. A
   * later edit of the list cannot shift, skip or repeat one; a comment deleted
   * meanwhile is skipped.
   */
  comments?: CommentRef[];
  /** The item being processed: 0 is the root, then comments[index - 1]. */
  index?: number;
  results?: PostResponse[];
  pending?: PendingState;
  /** The webhooks of this publish went out (or were attempted): never again. */
  webhooksSent?: boolean;
  /** How often planning the plugs failed for good and was scheduled again. */
  planRetries?: number;
};

type PlugTodo = { type: string; delay: number; [key: string]: any };

type PlugState = {
  taskQueue: string;
  postId: string;
  organizationId: string;
  integrationId: string;
  platformPostId: string;
  list: PlugTodo[];
  /** Failed tries of the plug at the head of the list. */
  attempt?: number;
};

// `postsList` is the root (and, for the first stage only, its comments); `item`
// is the comment a comment job publishes.
type Flow = { post: any; postsList: any[]; item?: any };
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

const itemOf = (flow: Flow, i: number) =>
  i === 0 ? flow.postsList[0] : flow.item;

@Injectable()
export class PostJobs {
  constructor(private _act: PostActivity, private _queue: JobQueueService) {}

  register(worker: JobWorker) {
    // A job that ends failed for good leaves the post in a known state:
    //  - publish: only once its provider call began (before that nothing was
    //    sent, and the job was retried);
    //  - checkStatus and comment: always, the platform already accepted the post;
    //  - finish: the rest of the chain still runs.
    const settle = async (job: Job, error: string) => {
      // no handler is running to return the recovery: schedule it here
      const outcome = await this.settleFailed(job, error);
      for (const f of (outcome as JobOutcome | undefined)?.next ?? []) {
        await this._queue.enqueue(f.kind, f.payload, f.opts);
      }
    };

    worker
      .register('post.publish', (job) => this.publish(job), {
        onFailed: (job, error) =>
          job.startedAt ? settle(job, error) : Promise.resolve(),
      })
      .register('post.comment', (job) => this.comment(job), {
        onFailed: settle,
      })
      .register('post.checkStatus', (job) => this.checkStatus(job), {
        onFailed: settle,
      })
      .register('post.finish', (job) => this.finish(job), {
        onFailed: (job) =>
          this._queue.enqueue(
            'post.plugPlan',
            // the webhooks may or may not have gone out: at most once
            { ...job.payload, webhooksSent: true },
            chain(job, { queue: 'main' })
          ),
      })
      .register('post.plugPlan', (job) => this.plugPlan(job), {
        onFailed: (job, error) => this.planFailed(job, error),
      })
      .register('post.plug', (job) => this.plug(job));
  }

  // ---- post.publish -----------------------------------------------------
  private async publish(job: Job<PostFlowState>): Promise<JobOutcome | void> {
    const s: PostFlowState = { ...job.payload };
    const { postId, organizationId, postNow = false } = s;

    // Inserted by an edit that arrived while another job of the post was
    // publishing: it must not touch the post until that chain has ended.
    const deferred = job.dedupeKey === `post:${postId}${NEXT_SUFFIX}`;
    if (deferred && (await this._queue.isPostBusy(job))) {
      return this.deferAgain();
    }

    const firstPost = await withRetry(() =>
      this._act.getPost(organizationId, postId)
    );

    // in case it doesn't exist for some reason, fail it
    if (!firstPost) {
      await assertOwned();
      await withRetry(() => this._act.changeState(postId, 'ERROR', 'No Post'));
      return;
    }

    if (!postNow && firstPost.state !== 'QUEUE') {
      await assertOwned();
      if (deferred) {
        // The chain in flight ended and left the post as it is: say which
        // way it went. Publishing the edit now would duplicate a live post.
        await this.notify(
          organizationId,
          `Your edit of a post was not published`,
          firstPost.state === 'PUBLISHED'
            ? `This post was edited while it was being published; the earlier version was published. Check it and reschedule if needed.`
            : firstPost.state === 'ERROR'
            ? `This post was edited while it was being published, but that publish failed; your edit was not applied. Check the account and reschedule if needed.`
            : `This post was edited while it was being published and is no longer scheduled; your edit was not applied. Check it and reschedule if needed.`,
          true,
          false,
          'info'
        );
        return;
      }
      await withRetry(() =>
        this._act.changeState(firstPost.id, 'ERROR', 'Already posted', [
          firstPost,
        ])
      );
      return;
    }

    if (deferred) {
      // the only job of the post from here on, under its normal key
      const took = await this._queue.takeOverPost(job);
      if (!took.taken) {
        if ('unconfirmed' in took && took.unconfirmed) {
          // the chain in flight ended without its outcome reaching the post
          const [root] = await withRetry(() =>
            this._act.getPostsList(organizationId, postId)
          );
          if (root) {
            await this.markUnconfirmed(
              { post: root, postsList: [root] },
              'The earlier publish of this post ended without a recorded outcome'
            );
          }
          return;
        }
        return this.deferAgain();
      }
      job.dedupeKey = took.dedupeKey;
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
    s.comments = flow.postsList
      .slice(1)
      .map((c) => ({ id: c.id, delay: Number(c.delay ?? 0) }));
    return this.runItem(job, s, flow);
  }

  // The same job, looked at again in a while: one row, however long it waits,
  // and the waits use up none of its attempts.
  private deferAgain(): JobOutcome {
    return { retryAt: new Date(Date.now() + DEFER_MS) };
  }

  // ---- post.comment -----------------------------------------------------
  private async comment(job: Job<PostFlowState>): Promise<JobOutcome | void> {
    const s: PostFlowState = { ...job.payload };
    const flow = await this.loadFlow(s, false);
    if (!flow) {
      return;
    }

    const ref = s.comments?.[s.index! - 1];
    const item = ref
      ? await withRetry(() => this._act.getComment(s.organizationId, ref.id))
      : undefined;
    if (!item) {
      // deleted while the chain waited: skip it, carry on with the next
      return this.afterStep(job, s, flow, 'continue');
    }
    return this.runItem(job, s, { ...flow, item });
  }

  // ---- post.checkStatus -------------------------------------------------
  // The platform accepted the post but is still processing it: poll the
  // read-only status check every 20 seconds. Nothing that goes wrong may
  // escape without the post leaving QUEUE: a post left in QUEUE is published
  // again by the sweep or the next boot.
  private async checkStatus(
    job: Job<PostFlowState>
  ): Promise<JobOutcome | void> {
    try {
      return await this.pollStatus(job);
    } catch (err) {
      if (isJobNotOwned(err)) {
        throw err;
      }
      // still running, so the recovery is this job's own follow-up
      return this.settleFailed(job, errorValue(err));
    }
  }

  private async pollStatus(
    job: Job<PostFlowState>
  ): Promise<JobOutcome | void> {
    const s: PostFlowState = { ...job.payload };
    const root = await this.loadFlow(s, false);
    if (!root) {
      return;
    }
    const i = s.index!;
    // a comment is read by id, as the comment job reads it
    const ref = i > 0 ? s.comments?.[i - 1] : undefined;
    const item = ref
      ? await withRetry(() => this._act.getComment(s.organizationId, ref.id))
      : undefined;
    if (i > 0 && !item) {
      // deleted while the platform was processing it: nothing to record
      return this.afterStep(job, s, root, 'continue');
    }
    const flow: Flow = { ...root, item };
    const { post } = flow;
    const pending = s.pending!;
    const accepted = s.results![s.results!.length - 1];
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
        s.results![s.results!.length - 1] = {
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
      if (isJobNotOwned(err)) {
        throw err;
      }
      const handle = await this.handleError(err, flow);

      if (handle.type === 'stop') {
        // the token could not be refreshed, but the platform already accepted
        // the post: warn about a possible live post
        await this.markUnconfirmed(flow, err);
        return;
      }

      if (handle.type === 'bad-body') {
        await assertOwned();
        await withRetry(() =>
          this._act.changeState(
            flow.postsList[0].id,
            'ERROR',
            errorValue(err),
            flow.postsList
          )
        );
        await this.notify(
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
  // Only the webhooks, and at most once per publish: after `markStarted` the
  // job is never re-run, and `webhooksSent` travels on. The plugs and the
  // repeat are planned by the next job, so a failure there cannot send the
  // webhooks a second time.
  private async finish(job: Job<PostFlowState>): Promise<JobOutcome | void> {
    const s = job.payload;
    const flow = await this.loadFlow(s, false);
    if (!flow) {
      return;
    }

    if (!s.webhooksSent) {
      await markStarted();
      // best effort inside: it never throws
      await this._act.sendWebhooks(
        s.results![0].postId,
        flow.post.organizationId,
        flow.post.integration.id
      );
    }

    return {
      next: [
        {
          kind: 'post.plugPlan',
          payload: { ...s, webhooksSent: true },
          opts: chain(job, { queue: 'main' }),
        },
      ],
    };
  }

  // ---- post.plugPlan ----------------------------------------------------
  private async plugPlan(job: Job<PostFlowState>): Promise<JobOutcome | void> {
    const s = job.payload;
    const flow = await this.loadFlow(s, false);
    if (!flow) {
      return;
    }
    const { post } = flow;
    const results = s.results!;

    // load internal plugs like repost by other users
    const internalPlugsList = await withRetry(() =>
      this._act.internalPlugs(post.integration, JSON.parse(post.settings))
    );

    // load global plugs, like repost a post if it gets to a certain number of likes
    const globalPlugsList = (
      await withRetry(() => this._act.globalPlugs(post.integration))
    ).reduce((all: PlugTodo[], current: any) => {
      for (let i = 1; i <= current.totalRuns; i++) {
        all.push({
          ...current,
          delay: current.delay * i,
        });
      }

      return all;
    }, []);

    // Sort all the actions by delay, so we can process them in order. (The
    // repeat is not one of them: `afterStep` schedules it as a job of its own.)
    const list = sortBy(
      [...internalPlugsList, ...globalPlugsList],
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

  // Planning the plugs failed for good (loading them is database work, it was
  // retried). Try again a few times; after that the post says so on its error
  // field. Its PUBLISHED state is never touched: the post is live.
  private async planFailed(job: Job<PostFlowState>, error: string) {
    const tries = job.payload.planRetries ?? 0;
    if (tries < PLAN_RETRIES) {
      await this._queue.enqueue(
        'post.plugPlan',
        { ...job.payload, planRetries: tries + 1 },
        chain(job, {
          queue: 'main',
          runAt: new Date(Date.now() + PLAN_RETRY_DELAY_MS),
        })
      );
      return;
    }
    await this._act.recordPostError(
      job.payload.postId,
      `The plugs of this post could not be planned: ${error}`
    );
  }

  // ---- post.plug --------------------------------------------------------
  // The plugs are processed in order, each one after its own delay counted
  // from the end of the previous one, as the workflow slept before each. A
  // plug that fails comes back as a new job a while later.
  private async plug(job: Job<PlugState>): Promise<JobOutcome | void> {
    const s: PlugState = { ...job.payload, list: [...job.payload.list] };
    const [todo, ...rest] = s.list;
    if (!todo) {
      return;
    }
    s.list = rest;
    const attempt = s.attempt ?? 0;
    const next: FollowUp[] = [];
    // set when the plug failed in a way another try may fix
    let retryIn: number | undefined;

    const onError = async (
      err: unknown,
      getIntegration: () => Promise<any>
    ) => {
      if (isJobNotOwned(err)) {
        throw err;
      }
      const handle = await this.handleError(err, undefined, getIntegration);
      if (handle.type === 'stop' || handle.type === 'bad-body') {
        return;
      }
      if (attempt + 1 < PLUG_ATTEMPTS) {
        // a refreshed token tries again at once, anything else waits
        retryIn =
          handle.type === 'retry' ? 0 : PLUG_RETRY_DELAY_MS * (attempt + 1);
      }
    };

    // process internal plug
    if (todo.type === 'internal-plug') {
      try {
        await this._act.processInternalPlug({
          ...todo,
          post: s.platformPostId,
        } as any);
      } catch (err) {
        await onError(err, () =>
          this._act.getIntegrationById(s.organizationId, todo.integration)
        );
      }
    }

    // process global plug
    if (todo.type === 'global') {
      try {
        const process = await this._act.processPlug({
          ...todo,
          postId: s.platformPostId,
        } as any);
        if (process) {
          s.list = s.list.filter((item) => item.plugId !== todo.plugId);
        }
      } catch (err) {
        await onError(err, () =>
          this._act.getIntegrationById(s.organizationId, s.integrationId)
        );
      }
    }

    if (retryIn !== undefined) {
      return {
        next: [
          {
            kind: 'post.plug',
            payload: { ...s, list: [todo, ...s.list], attempt: attempt + 1 },
            opts: chain(job, {
              queue: s.taskQueue,
              runAt: new Date(Date.now() + retryIn),
            }),
          },
        ],
      };
    }
    s.attempt = undefined;

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

  /**
   * Best effort, and once: a retry after a send that failed late would email
   * the owner twice, and a missed notification is not worth a failed job.
   */
  private async notify(...args: Parameters<PostActivity['inAppNotification']>) {
    try {
      await this._act.inAppNotification(...args);
    } catch (err) {
      console.error(
        `post jobs: could not notify "${args[1]}"`,
        (err as Error)?.message
      );
    }
  }

  /**
   * Loads the root post the way the workflow did after its sleep. The first
   * stage also returns the comments to publish; later stages work with the
   * root only (the comments are in the payload, and read by id).
   */
  private async loadFlow(
    s: PostFlowState,
    first: boolean
  ): Promise<Flow | undefined> {
    const postsListBefore = await withRetry(() =>
      this._act.getPostsList(s.organizationId, s.postId)
    );
    const [post] = postsListBefore;

    if (!post) {
      await assertOwned();
      await withRetry(() =>
        this._act.changeState(s.postId, 'ERROR', 'No Post')
      );
      return;
    }

    if (first) {
      // if refresh is needed from last time, let's inform the user
      if (post.integration?.refreshNeeded) {
        await assertOwned();
        await this.notify(
          post.organizationId,
          `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
          `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because you need to reconnect it. Please enable it and try again.`,
          true,
          false,
          'info'
        );

        await withRetry(() =>
          this._act.changeState(
            postsListBefore[0].id,
            'ERROR',
            'Refresh channel needed',
            postsListBefore
          )
        );
        return;
      }

      // if it's disabled, inform the user
      if (post.integration?.disabled) {
        await assertOwned();
        await this.notify(
          post.organizationId,
          `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
          `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because it's disabled. Please enable it and try again.`,
          true,
          false,
          'info'
        );

        await withRetry(() =>
          this._act.changeState(
            postsListBefore[0].id,
            'ERROR',
            'Channel disabled',
            postsListBefore
          )
        );
        return;
      }
    }

    // Do we need to post comments for this social?
    const toComment: boolean =
      first && postsListBefore.length > 1
        ? await withRetry(() => this._act.isCommentable(post.integration))
        : false;

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
    await assertOwned();
    const { post, postsList } = flow;
    await withRetry(() =>
      this._act.changeState(
        postsList[0].id,
        'ERROR',
        errorValue(err),
        postsList
      )
    );
    await this.notify(
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

  /**
   * The flow of a post cannot go on and its outcome is unknown. The post must
   * leave QUEUE, otherwise the sweep publishes it again:
   *  - if the root is live (PUBLISHED with its platform id: the crash came
   *    after `updatePost`) it stays PUBLISHED and the rest of the chain is
   *    returned to be scheduled again (comments, webhooks, plugs, repeat);
   *  - otherwise, or when a comment failed, it is marked unconfirmed (ERROR),
   *    as V112 did. A comment failure therefore still sets the root to ERROR
   *    and drops the remaining comments, like V112.
   * The state alone is not proof, nor is a platform id alone: an edit leaves
   * the id of the previous publish on the row and sets the state back to
   * QUEUE, so a crash during the republish must not read as "live".
   * A repeat run (`postNow`) starts from a PUBLISHED post, so a live root says
   * nothing about that run and is treated like any other failure.
   */
  private async settleFailed(
    job: Job,
    error: string
  ): Promise<JobOutcome | void> {
    const s = job.payload as PostFlowState;
    const list = await withRetry(() =>
      this._act.getPostsList(s.organizationId, s.postId)
    );
    const [root] = list;
    if (!root) {
      // deleted, or its subscription lapsed: a QUEUE post nothing will run
      await withRetry(() =>
        this._act.changeState(s.postId, 'ERROR', 'No Post')
      );
      return;
    }

    const live =
      !s.postNow &&
      (s.index ?? 0) === 0 &&
      root.state === 'PUBLISHED' &&
      !!root.releaseId;
    if (!live) {
      await this.markUnconfirmed({ post: root, postsList: [root] }, error);
      return;
    }

    const commentable =
      list.length > 1 &&
      (await withRetry(() => this._act.isCommentable(root.integration)));
    const rebuilt: PostFlowState = {
      taskQueue: s.taskQueue,
      postId: s.postId,
      organizationId: s.organizationId,
      startTime: s.startTime,
      index: 0,
      comments:
        s.comments ??
        (commentable
          ? list
              .slice(1)
              .map((c) => ({ id: c.id, delay: Number(c.delay ?? 0) }))
          : []),
      results: [
        {
          id: root.id,
          postId: root.releaseId,
          releaseURL: root.releaseURL,
          status: 'success',
        } as PostResponse,
      ],
    };
    return this.afterStep(
      job,
      rebuilt,
      { post: root, postsList: [root] },
      'continue'
    );
  }

  // Publishes the current item (the root, or the comment of `flow.item`),
  // repeating the action after a token refresh.
  private async runItem(
    job: Job<PostFlowState>,
    s: PostFlowState,
    flow: Flow
  ): Promise<JobOutcome | void> {
    const { post, postsList } = flow;
    const i = s.index!;
    const item = itemOf(flow, i);
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
                  item,
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
                  results.length === 1
                    ? undefined
                    : results[results.length - 1].postId,
                  post.integration,
                  [item]
                ),
              MUTATION_TIMEOUT_MS
            ))
          );
        }
      } catch (err) {
        // the job was cancelled or reclaimed: the job that replaced it owns the post
        if (isJobNotOwned(err)) {
          throw err;
        }
        const handle = await this.handleError(err, flow);

        // token refreshed, repeat the action
        if (handle.type === 'retry') {
          continue;
        }

        // the call timed out: the platform may still complete the publish in
        // the background, so never retry it
        if (handle.type === 'timeout') {
          await this.markUnconfirmed(flow, err).catch(quiet);
          return;
        }

        // for other errors, change state and inform the user if needed
        await assertOwned();
        await withRetry(() =>
          this._act.changeState(
            postsList[0].id,
            'ERROR',
            errorValue(err),
            postsList
          )
        );

        if (handle.type === 'stop') {
          return;
        }

        // specific case for bad body errors
        if (handle.type === 'bad-body') {
          await this.notify(
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
        const accepted = results[results.length - 1];
        if (accepted.status === 'pending') {
          s.pending = {
            check: 0,
            errorAttempts: 0,
            data: accepted.pendingData,
          };
          step = 'pending';
        } else {
          step = await this.record(s, flow, i);
        }
      } catch (err) {
        if (isJobNotOwned(err)) {
          throw err;
        }
        await this.markUnconfirmed(flow, err).catch(quiet);
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
      ).catch(quiet);
    }
  }

  // mark the post as successful
  private async record(s: PostFlowState, flow: Flow, i: number): Promise<Step> {
    const { post } = flow;
    const item = itemOf(flow, i);
    const result = s.results![s.results!.length - 1];
    let updated = false;
    try {
      await withRetry(() =>
        this._act.updatePost(item.id, result.postId, result.releaseURL)
      );
      updated = true;

      if (i === 0) {
        // send notification on a successful post
        await this.notify(
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
      if (isJobNotOwned(err)) {
        throw err;
      }
      if (!updated) {
        // still marked QUEUE, record the error so the missing-posts sweep
        // doesn't re-publish it
        await this.markUnconfirmed(flow, err).catch(quiet);
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

    // comments[i] is the item after the current one (item 0 is the root)
    const i = s.index!;
    const nextComment = s.comments?.[i];
    if (nextComment) {
      const delay = nextComment.delay;
      return {
        next: [
          {
            kind: 'post.comment',
            payload: { ...s, index: i + 1, pending: undefined },
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

    // The repeat is a job of its own, scheduled here and not by the plug
    // planning: a plug that cannot be loaded must not end a series.
    const next: FollowUp[] = [
      {
        kind: 'post.finish',
        payload: { ...s, pending: undefined },
        opts: chain(job, { queue: 'main' }),
      },
    ];
    const repeat = this.repeatOf(s, flow);
    if (repeat) {
      next.push(repeat);
    }
    return { next };
  }

  // A post with an interval publishes again after it, counted from when this
  // publish began. A fresh flow of its own, so the other plugs keep running.
  private repeatOf(s: PostFlowState, flow: Flow): FollowUp | undefined {
    const { post } = flow;
    if (!post.intervalInDays) {
      return;
    }
    const delay = Math.max(
      0,
      post.intervalInDays * 24 * 60 * 60 * 1000 -
        (Date.now() - (s.startTime ?? Date.now()))
    );
    return {
      kind: 'post.plug',
      payload: {
        taskQueue: s.taskQueue,
        postId: s.postId,
        organizationId: s.organizationId,
        integrationId: post.integration.id,
        platformPostId: s.results![0].postId,
        list: [{ type: 'repeat-post', delay }],
      } satisfies PlugState,
      opts: {
        queue: s.taskQueue,
        dedupeKey: `post:${s.postId}${REPEAT_SUFFIX}`,
        postId: s.postId,
        organizationId: s.organizationId,
        runAt: new Date(Date.now() + delay),
      },
    };
  }
}
