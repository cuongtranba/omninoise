import { Injectable } from '@nestjs/common';
import { ClippingActivity } from '@gitroom/orchestrator/activities/clipping.activity';
import { JobWorker } from '@gitroom/nestjs-libraries/jobs/job.worker';
import {
  EnqueueOptions,
  FollowUp,
  Job,
  JobOutcome,
} from '@gitroom/nestjs-libraries/jobs/job.types';
import { JobQueueService } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { isNonRetryable } from '@gitroom/nestjs-libraries/jobs/job.errors';
import type { ClippingJobState } from '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service';

// The media service has no callbacks, and the RunPod job TTL is one hour so
// polling past it is pointless. Most jobs answer within a minute; one that
// waits on a cold endpoint is polled slower.
const FAST_POLLS = 12;
const FAST_INTERVAL = 5000;
const SLOW_INTERVAL = 15000;
const MAX_POLLS =
  FAST_POLLS + (60 * 60 * 1000 - FAST_POLLS * FAST_INTERVAL) / SLOW_INTERVAL;
// how many times a job the media service called retryable is submitted
const MAX_SUBMITS = 3;
// Polling and bookkeeping are idempotent: ride out an outage of a few minutes
const POLL_MAX_ERRORS = 10;
const pollBackoff = (errors: number) =>
  Math.min(10_000 * Math.pow(2, errors - 1), 2 * 60 * 1000);

const clipKey = (clipId: string) => `clipping_clip_${clipId}`;

// Submitting is a plain POST with no idempotency key. A retry after the queue
// accepted the job runs it twice, which only costs the second job: both write
// the same files and only the last job id is polled.
const SUBMIT: EnqueueOptions = {
  maxAttempts: 3,
  retryDelayMs: 10_000,
  backoff: 2,
};
// Transcribing and picking wait on an AI provider; running one again only
// costs a few cents and overwrites the same result.
const AI: EnqueueOptions = { maxAttempts: 3, retryDelayMs: 60_000 };
// Bookkeeping is idempotent: ride out an outage.
const BOOKKEEPING: EnqueueOptions = {
  maxAttempts: 10,
  retryDelayMs: 10_000,
  backoff: 2,
};

type Run = { jobId?: string; polls: number; submits: number; errors: number };
const newRun = (): Run => ({ polls: 0, submits: 0, errors: 0 });

type RunStep<T> =
  | { wait: number; run: Run }
  | { answer: T | { state: 'failed' } };

// One slice of "submit a job to the media service and poll it to its end".
// Only a "retry" answer submits it again; a job that never answered is
// failed, its twin could still be sitting in the queue.
async function stepRun<T extends { state: ClippingJobState }>(
  run: Run,
  submit: () => Promise<string>,
  check: (jobId: string) => Promise<T>
): Promise<RunStep<T>> {
  if (!run.jobId) {
    run.jobId = await submit();
    run.submits++;
    run.polls = 0;
    run.errors = 0;
    return { wait: FAST_INTERVAL, run };
  }

  let answer: T;
  try {
    answer = await check(run.jobId);
    run.errors = 0;
  } catch (err) {
    // a reason that can't change skips the retries
    if (isNonRetryable(err)) {
      throw err;
    }
    run.errors++;
    if (run.errors >= POLL_MAX_ERRORS) {
      throw err;
    }
    return { wait: pollBackoff(run.errors), run };
  }

  if (answer.state === 'pending') {
    run.polls++;
    if (run.polls >= MAX_POLLS) {
      return { answer: { state: 'failed' } };
    }
    return {
      wait: run.polls < FAST_POLLS ? FAST_INTERVAL : SLOW_INTERVAL,
      run,
    };
  }

  if (answer.state === 'retry') {
    if (run.submits >= MAX_SUBMITS) {
      return { answer: { state: 'failed' } };
    }
    run.jobId = undefined;
    return { wait: 0, run };
  }

  return { answer };
}

type ClippingPayload = {
  clippingId: string;
  step: 'analyse' | 'pick' | 'wait' | 'drafts';
  run?: Run;
  transcribe?: boolean;
  clipIds?: string[];
};

type ClipPayload = {
  clipId: string;
  step: 'fetch' | 'caption' | 'render';
  run?: Run;
};

@Injectable()
export class ClippingJobs {
  constructor(
    private _clipping: ClippingActivity,
    private _queue: JobQueueService
  ) {}

  register(worker: JobWorker) {
    worker
      .register('clipping', (job) => this.clipping(job), {
        // "customer": only a "clipping_stop" was written for the customer,
        // anything else (a provider's answer, a timeout) is for the logs
        onFailed: (job, error, type) =>
          this._clipping.failClipping({
            clippingId: job.payload.clippingId,
            error:
              error ||
              (job.payload.step === 'drafts'
                ? 'The draft posts could not be created'
                : 'Clipping failed'),
            customer: type === 'clipping_stop',
          }),
      })
      .register('clipping.clip', (job) => this.clip(job), {
        // a clip that fails is recorded on the clip and never stops the others
        onFailed: (job, error, type) =>
          this._clipping.failClip({
            clipId: job.payload.clipId,
            error: error || 'The clip could not be rendered',
            customer: type === 'clipping_stop',
          }),
      });
  }

  // ---- the clipping -----------------------------------------------------
  private async clipping(
    job: Job<ClippingPayload>
  ): Promise<JobOutcome | void> {
    const p = job.payload;
    const { clippingId } = p;
    const next = (
      payload: ClippingPayload,
      delay = 0,
      opts: EnqueueOptions = {}
    ): FollowUp => ({
      kind: 'clipping',
      payload,
      opts: {
        dedupeKey: job.dedupeKey ?? undefined,
        organizationId: job.organizationId ?? undefined,
        runAt: new Date(Date.now() + delay),
        ...opts,
      },
    });

    switch (p.step) {
      case 'analyse': {
        const step = await stepRun(
          p.run ?? newRun(),
          () => this._clipping.submitClippingAnalyse({ clippingId }),
          (jobId) => this._clipping.checkClippingAnalyse({ clippingId, jobId })
        );
        if ('wait' in step) {
          return { next: [next({ ...p, run: step.run }, step.wait, SUBMIT)] };
        }
        if (step.answer.state !== 'done') {
          await this._clipping.failClipping({
            clippingId,
            error: 'The video could not be analysed',
            customer: true,
          });
          return;
        }
        return {
          next: [
            next(
              {
                clippingId,
                step: 'pick',
                transcribe:
                  'transcribe' in step.answer && !!step.answer.transcribe,
              },
              0,
              AI
            ),
          ],
        };
      }

      case 'pick': {
        if (p.transcribe) {
          await this._clipping.transcribeClipping({ clippingId });
        }
        const clipIds: string[] = await this._clipping.pickClippingClips({
          clippingId,
        });
        return {
          next: [
            ...clipIds.map(
              (clipId): FollowUp => ({
                kind: 'clipping.clip',
                payload: { clipId, step: 'fetch' } satisfies ClipPayload,
                opts: {
                  dedupeKey: clipKey(clipId),
                  organizationId: job.organizationId ?? undefined,
                  ...SUBMIT,
                },
              })
            ),
            next({ clippingId, step: 'wait', clipIds }, FAST_INTERVAL),
          ],
        };
      }

      // The clips run as jobs of their own; the clipping goes on once every
      // one of them has ended, whatever its outcome (a clip that died still
      // leaves its clip unrendered, which the finish reads from the records).
      case 'wait': {
        for (const clipId of p.clipIds ?? []) {
          const clip = await this._queue.get(clipKey(clipId));
          if (
            clip &&
            (clip.status === 'pending' || clip.status === 'running')
          ) {
            return { next: [next(p, FAST_INTERVAL)] };
          }
        }
        return { next: [next({ clippingId, step: 'drafts' }, 0, BOOKKEEPING)] };
      }

      // the clips are in the media library by now; a draft that could not be
      // created is reported on the clipping and never takes them away
      case 'drafts': {
        await this._clipping.createClippingDrafts({ clippingId });
        return { result: await this._clipping.finishClipping({ clippingId }) };
      }
    }
  }

  // ---- one clip ---------------------------------------------------------
  private async clip(job: Job<ClipPayload>): Promise<JobOutcome | void> {
    const p = job.payload;
    const { clipId } = p;
    const next = (
      payload: ClipPayload,
      delay = 0,
      opts: EnqueueOptions = {}
    ): JobOutcome => ({
      next: [
        {
          kind: 'clipping.clip',
          payload,
          opts: {
            dedupeKey: job.dedupeKey ?? undefined,
            organizationId: job.organizationId ?? undefined,
            runAt: new Date(Date.now() + delay),
            ...opts,
          },
        },
      ],
    });

    switch (p.step) {
      case 'fetch': {
        const step = await stepRun(
          p.run ?? newRun(),
          () => this._clipping.submitClipFetch({ clipId }),
          (jobId) => this._clipping.checkClipFetch({ clipId, jobId })
        );
        if ('wait' in step) {
          return next({ ...p, run: step.run }, step.wait, SUBMIT);
        }
        if (step.answer.state !== 'done') {
          await this._clipping.failClip({
            clipId,
            error: 'The clip could not be downloaded',
            customer: true,
          });
          return;
        }
        return next({ clipId, step: 'caption' }, 0, AI);
      }

      case 'caption': {
        await this._clipping.captionClip({ clipId });
        return next({ clipId, step: 'render' }, 0, SUBMIT);
      }

      case 'render': {
        const step = await stepRun(
          p.run ?? newRun(),
          () => this._clipping.submitClipRender({ clipId }),
          (jobId) => this._clipping.checkClipRender({ clipId, jobId })
        );
        if ('wait' in step) {
          return next({ ...p, run: step.run }, step.wait, SUBMIT);
        }
        if (step.answer.state !== 'done') {
          await this._clipping.failClip({
            clipId,
            error: 'The clip could not be rendered',
            customer: true,
          });
        }
      }
    }
  }
}
