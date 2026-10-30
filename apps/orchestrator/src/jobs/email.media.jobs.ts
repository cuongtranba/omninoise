import { Injectable } from '@nestjs/common';
import { EmailActivity } from '@gitroom/orchestrator/activities/email.activity';
import { MediaActivity } from '@gitroom/orchestrator/activities/media.activity';
import { VideoActivity } from '@gitroom/orchestrator/activities/video.activity';
import { JobWorker } from '@gitroom/nestjs-libraries/jobs/job.worker';
import { Job, JobOutcome } from '@gitroom/nestjs-libraries/jobs/job.types';
import { withTimeout } from '@gitroom/nestjs-libraries/jobs/job.errors';
import type { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';

export type SendEmailPayload = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

// Polls a job on the media normalization service; the service has no
// callbacks, and the RunPod job TTL is one hour so polling past it is pointless
const MEDIA_POLL_INTERVAL = 5000;
const MEDIA_MAX_POLLS = (60 * 60 * 1000) / MEDIA_POLL_INTERVAL;
// Polling is idempotent: ride out a queue API outage of a few minutes
const POLL_MAX_ERRORS = 10;
const pollBackoff = (errors: number) =>
  Math.min(10_000 * Math.pow(2, errors - 1), 2 * 60 * 1000);

// Generating a video consumes a credit and can take a long while
const VIDEO_TIMEOUT_MS = 40 * 60 * 1000;

type MediaPoll = {
  mediaId: string;
  jobId: string;
  polls: number;
  errors: number;
};

@Injectable()
export class EmailMediaJobs {
  constructor(
    private _email: EmailActivity,
    private _media: MediaActivity,
    private _video: VideoActivity
  ) {}

  register(worker: JobWorker) {
    worker
      // The queue (email or email-bulk) is chosen by the producer; the rate
      // limit is the queue's.
      .register<SendEmailPayload>('email.send', async (job) => {
        const { to, subject, html, replyTo } = job.payload;
        await this._email.sendEmail(to, subject, html, replyTo);
      })
      .register('media.process', (job) => this.mediaProcess(job), {
        onFailed: (job, error) =>
          this._media.failMediaProcessing(job.payload.mediaId, error),
      })
      .register('media.poll', (job) => this.mediaPoll(job), {
        onFailed: (job, error) =>
          this._media.failMediaProcessing(job.payload.mediaId, error),
      })
      .register(
        'video.generate',
        async (
          job: Job<{ organizationId: string; body: VideoDto }>
        ): Promise<JobOutcome> => {
          const { organizationId, body } = job.payload;
          const media = await withTimeout(
            () => this._video.generateVideo(organizationId, body),
            VIDEO_TIMEOUT_MS
          );
          return { result: media };
        }
      );
  }

  // Submitting is a plain POST with no idempotency key, so a retry after the
  // queue accepted the job would run it twice: one attempt, and a failure
  // releases the media instead.
  private async mediaProcess(
    job: Job<{ mediaId: string }>
  ): Promise<JobOutcome | void> {
    const { mediaId } = job.payload;
    let jobId: string | null;
    try {
      jobId = await this._media.submitMediaProcessing(mediaId);
    } catch (err: any) {
      await this._media.failMediaProcessing(
        mediaId,
        err?.message || 'Could not submit job'
      );
      return;
    }

    // nothing to run: the service already released the media as ready
    if (!jobId) {
      return;
    }

    return this.nextPoll(job, { mediaId, jobId, polls: 0, errors: 0 });
  }

  private async mediaPoll(job: Job<MediaPoll>): Promise<JobOutcome | void> {
    const s = { ...job.payload };
    try {
      // true once the media record is final (ready or failed)
      if (await this._media.checkMediaProcessing(s.mediaId, s.jobId)) {
        return;
      }
      s.errors = 0;
    } catch (err: any) {
      s.errors++;
      if (s.errors >= POLL_MAX_ERRORS) {
        await this._media.failMediaProcessing(
          s.mediaId,
          err?.message || 'Could not check job'
        );
        return;
      }
      return this.nextPoll(job, s, pollBackoff(s.errors));
    }

    s.polls++;
    if (s.polls >= MEDIA_MAX_POLLS) {
      await this._media.failMediaProcessing(s.mediaId, 'Processing timed out');
      return;
    }
    return this.nextPoll(job, s);
  }

  private nextPoll(
    job: Job,
    s: MediaPoll,
    delay = MEDIA_POLL_INTERVAL
  ): JobOutcome {
    return {
      next: [
        {
          kind: 'media.poll',
          payload: s,
          opts: {
            dedupeKey: job.dedupeKey ?? undefined,
            organizationId: job.organizationId ?? undefined,
            runAt: new Date(Date.now() + delay),
          },
        },
      ],
    };
  }
}
