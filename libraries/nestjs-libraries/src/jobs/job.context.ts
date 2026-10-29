import { AsyncLocalStorage } from 'node:async_hooks';
import type { Job } from '@gitroom/nestjs-libraries/jobs/job.types';

/** What a running handler can tell the worker about itself. */
export type JobContext = {
  job: Job;
  /**
   * Call right before a call that cannot be repeated (a provider publish,
   * comment or finalize). From then on the job is never re-run after a lost
   * lease or a failure: the outcome is unknown and a second run could
   * publish twice. Before it, a lost lease simply re-queues the job.
   */
  markStarted(): Promise<void>;
  /** What the handler is waiting on; shown on the job if it stalls. */
  setProgress(details: string): void;
};

const storage = new AsyncLocalStorage<JobContext>();

export const runWithJobContext = <T>(ctx: JobContext, fn: () => Promise<T>) =>
  storage.run(ctx, fn);

export const currentJobContext = () => storage.getStore();

/** No-op outside a job (API requests, analytics). */
export const markStarted = async () => {
  await currentJobContext()?.markStarted();
};

/** No-op outside a job. Kept under its old name so providers need no change. */
export const setHeartbeatDetails = (details: string) => {
  currentJobContext()?.setProgress(details);
};
