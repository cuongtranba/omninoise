export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export type Job<P = any> = {
  id: number;
  kind: string;
  queue: string;
  dedupeKey: string | null;
  postId: string | null;
  organizationId: string | null;
  payload: P;
  status: JobStatus;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  retryDelayMs: number;
  backoff: number;
  lockedUntil: Date | null;
  startedAt: Date | null;
  result: any;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EnqueueOptions = {
  /** When the job becomes due. Default: now. */
  runAt?: Date;
  /** Default 'main'. */
  queue?: string;
  /**
   * At most one pending/running job per key. `mode` says what a second
   * enqueue with the same key does.
   */
  dedupeKey?: string;
  /**
   * 'keep' (default): the existing job stays, the existing job wins.
   * 'replace': the existing job is cancelled and this one takes its place,
   * the new job wins.
   */
  mode?: 'keep' | 'replace';
  postId?: string;
  organizationId?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
  backoff?: number;
};

/** A follow-up the worker inserts atomically with the completion of a job. */
export type FollowUp = {
  kind: string;
  payload?: unknown;
  opts?: EnqueueOptions;
};

export type JobOutcome = {
  result?: unknown;
  /** Inserted in the same transaction that marks the job done. */
  next?: FollowUp[];
};

/** Status names of the previous scheduler, kept for the video status tool. */
export type LegacyStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export type JobSnapshot = {
  id: number;
  status: JobStatus;
  legacyStatus: LegacyStatus;
  result: any;
  error: string | null;
};
