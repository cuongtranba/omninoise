import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JobWorker } from '@gitroom/nestjs-libraries/jobs/job.worker';
import { workerQueues } from '@gitroom/nestjs-libraries/jobs/job.queues';
import { PostJobs } from '@gitroom/orchestrator/jobs/post.jobs';
import { SystemJobs } from '@gitroom/orchestrator/jobs/system.jobs';
import { EmailMediaJobs } from '@gitroom/orchestrator/jobs/email.media.jobs';
import { ClippingJobs } from '@gitroom/orchestrator/jobs/clipping.jobs';
import { JobSeeder } from '@gitroom/orchestrator/jobs/job.seeder';

/** Starts the job worker with the orchestrator and stops it on shutdown. */
@Injectable()
export class JobWorkerService implements OnModuleInit, OnModuleDestroy {
  private worker = new JobWorker({ queues: workerQueues() });

  constructor(
    posts: PostJobs,
    system: SystemJobs,
    emailMedia: EmailMediaJobs,
    clipping: ClippingJobs,
    private _seeder: JobSeeder
  ) {
    posts.register(this.worker);
    system.register(this.worker);
    emailMedia.register(this.worker);
    clipping.register(this.worker);
  }

  async onModuleInit() {
    await this.worker.start();
    try {
      await this._seeder.seed();
    } catch (err) {
      // the worker is already serving; the hourly sweep still recovers posts
      console.error('Job seeding failed', err);
    }
  }

  async onModuleDestroy() {
    await this.worker.stop(
      Number(process.env.JOB_WORKER_SHUTDOWN_GRACE_MS) || 300_000
    );
  }
}
