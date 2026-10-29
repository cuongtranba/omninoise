import { Client, Pool, PoolClient } from 'pg';
import { pgConnectionString } from '@gitroom/nestjs-libraries/pg/pg.pool';
import {
  insertFollowUps,
  JOBS_CHANNEL,
  lockPost,
  mapRow,
  ensureJobsSchema,
} from '@gitroom/nestjs-libraries/jobs/job.queue';
import type { Job, JobOutcome } from '@gitroom/nestjs-libraries/jobs/job.types';
import {
  JobContext,
  runWithJobContext,
} from '@gitroom/nestjs-libraries/jobs/job.context';
import {
  isJobNotOwned,
  isNonRetryable,
  JobNotOwned,
} from '@gitroom/nestjs-libraries/jobs/job.errors';

export type JobHandler<P = any> = (
  job: Job<P>,
  ctx: JobContext
) => Promise<void | JobOutcome>;

export type HandlerOptions = {
  /**
   * Runs once when the job ends `failed` for good: retries used up, a
   * NonRetryable error, or a lease lost after `markStarted`. Cleanup lives
   * here (mark the post errored, release the media, refund the clipping).
   * Never runs for a job that lost ownership (`JobNotOwned`): it was cancelled
   * or reclaimed and the job that replaced it is in charge.
   */
  onFailed?: (job: Job, error: string, type?: string) => Promise<unknown>;
};

export type QueueConfig = {
  name: string;
  /** Jobs of this queue running at once on this worker. */
  concurrency: number;
  /** Claims per second on this worker (the email queues). */
  perSecond?: number;
};

export type WorkerOptions = {
  queues: QueueConfig[];
  /** Poll for due jobs; NOTIFY only covers jobs that are due when enqueued. */
  pollIntervalMs?: number;
  /** How long a claim holds a job without a lease extension. */
  leaseMs?: number;
  leaseExtendMs?: number;
  reapIntervalMs?: number;
};

const MAX_CLAIM_BATCH = 100;
// The worker's own connections (claim, lease, complete, fail, reap). Apart
// from the app pool on purpose: a burst of request-time queries must never
// starve the lease extension, or the reaper fails jobs that are still alive.
const WORKER_POOL_SIZE = 4;

type Running = { job: Job; progress?: string };

class QueueRunner {
  running = new Map<number, Running>();
  claimedAt: number[] = [];
  busy = false;
  again = false;

  constructor(readonly config: QueueConfig) {}
}

/**
 * Runs the jobs of one or more queues. Handlers are registered by `kind`.
 * Safe to run on several processes against the same database.
 */
export class JobWorker {
  private handlers = new Map<
    string,
    { fn: JobHandler; opts: HandlerOptions }
  >();
  private runners = new Map<string, QueueRunner>();
  private timers: NodeJS.Timeout[] = [];
  private listener?: Client;
  private pool?: Pool;
  private polling = false;
  private stopped = true;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly leaseMs: number;
  private readonly leaseExtendMs: number;
  private readonly pollIntervalMs: number;
  private readonly reapIntervalMs: number;

  constructor(private readonly options: WorkerOptions) {
    this.leaseMs = options.leaseMs ?? 180_000;
    this.leaseExtendMs = options.leaseExtendMs ?? 15_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.reapIntervalMs = options.reapIntervalMs ?? 30_000;
    for (const config of options.queues) {
      this.runners.set(config.name, new QueueRunner(config));
    }
  }

  register<P = any>(
    kind: string,
    fn: JobHandler<P>,
    opts: HandlerOptions = {}
  ) {
    this.handlers.set(kind, { fn, opts });
    return this;
  }

  // Bookkeeping connections; created at start() and closed at stop().
  private get db(): Pool {
    if (!this.pool) {
      throw new Error('job worker is not started');
    }
    return this.pool;
  }

  async start() {
    if (!this.stopped) {
      return;
    }
    await ensureJobsSchema();
    this.pool = new Pool({
      connectionString: pgConnectionString(),
      max: WORKER_POOL_SIZE,
    });
    this.pool.on('error', (err) =>
      console.error('job worker: idle client error', err.message)
    );
    this.stopped = false;
    await this.listen();
    this.timers.push(
      setInterval(() => this.wakeAll(), this.pollIntervalMs),
      setInterval(() => void this.reap(), this.reapIntervalMs),
      setInterval(() => void this.extendLeases(), this.leaseExtendMs)
    );
    void this.reap();
    this.wakeAll();
  }

  /** Stops claiming and waits for running handlers (up to `graceMs`). */
  async stop(graceMs = 10_000) {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    clearTimeout(this.reconnectTimer);
    const listener = this.listener;
    this.listener = undefined;
    await listener?.end().catch(() => undefined);

    const deadline = Date.now() + graceMs;
    while (this.runningCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Handlers still running past the grace period get their writes refused
    // (the pool is gone); their jobs are left to the reaper.
    const pool = this.pool;
    this.pool = undefined;
    await pool?.end().catch(() => undefined);
  }

  runningCount() {
    let n = 0;
    this.runners.forEach((r) => (n += r.running.size));
    return n;
  }

  // ---- LISTEN -----------------------------------------------------------
  // LISTEN needs a session that stays open, so it never uses the pool: a
  // pooled client handed to someone else would carry the subscription along.
  private async listen() {
    const client = new Client({ connectionString: pgConnectionString() });
    // An error on an idle client must not crash the process.
    client.on('error', (err) => {
      console.error('job worker: LISTEN connection error', err.message);
      this.dropListener(client);
    });
    client.on('end', () => this.dropListener(client));
    client.on('notification', (msg) => {
      const runner = msg.payload ? this.runners.get(msg.payload) : undefined;
      if (runner) {
        void this.claim(runner);
      }
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${JOBS_CHANNEL}`);
    } catch (err) {
      client.end().catch(() => undefined);
      throw err;
    }
    this.listener = client;
  }

  private dropListener(failed: Client) {
    if (this.stopped || this.listener !== failed) {
      return;
    }
    this.listener = undefined;
    failed.end().catch(() => undefined);
    this.retryListen();
  }

  private retryListen() {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      if (this.stopped) {
        return;
      }
      try {
        await this.listen();
        // Notifications sent while we were away are gone; claim what is due.
        this.wakeAll();
      } catch (err) {
        console.error(
          'job worker: LISTEN reconnect failed',
          (err as Error).message
        );
        this.retryListen();
      }
    }, 1_000);
  }

  // One cheap query finds the queues that have something due, instead of one
  // claim per queue (about 35 per worker) every second.
  private wakeAll() {
    void this.poll();
  }

  private async poll() {
    if (this.stopped || this.polling) {
      return;
    }
    this.polling = true;
    try {
      const open = [...this.runners.values()].filter((r) => this.free(r) > 0);
      if (!open.length) {
        return;
      }
      const res = await this.db.query(
        `SELECT DISTINCT queue FROM pgonly.jobs
         WHERE status = 'pending' AND run_at <= now() AND queue = ANY($1::text[])`,
        [open.map((r) => r.config.name)]
      );
      for (const { queue } of res.rows) {
        const runner = this.runners.get(queue);
        if (runner) {
          void this.claim(runner);
        }
      }
    } catch (err) {
      if (!this.stopped) {
        console.error('job worker: poll failed', (err as Error).message);
      }
    } finally {
      this.polling = false;
    }
  }

  // ---- claim ------------------------------------------------------------
  private free(runner: QueueRunner) {
    const { concurrency, perSecond } = runner.config;
    let free = Math.min(concurrency - runner.running.size, MAX_CLAIM_BATCH);
    if (perSecond) {
      const since = Date.now() - 1000;
      runner.claimedAt = runner.claimedAt.filter((t) => t > since);
      free = Math.min(free, perSecond - runner.claimedAt.length);
    }
    return free;
  }

  private async claim(runner: QueueRunner) {
    if (this.stopped) {
      return;
    }
    // One claim at a time per queue; a wake-up during a claim asks for another.
    if (runner.busy) {
      runner.again = true;
      return;
    }
    runner.busy = true;
    try {
      do {
        runner.again = false;
        const free = this.free(runner);
        if (free <= 0) {
          break;
        }
        const res = await this.db.query(
          `UPDATE pgonly.jobs
             SET status = 'running', attempts = attempts + 1,
                 started_at = NULL, progress = NULL,
                 locked_until = now() + ($3::int * interval '1 millisecond'),
                 updated_at = now()
           WHERE id IN (
             SELECT id FROM pgonly.jobs
             WHERE status = 'pending' AND run_at <= now() AND queue = $1
             ORDER BY run_at
             FOR UPDATE SKIP LOCKED
             LIMIT $2)
           RETURNING *`,
          [runner.config.name, free, this.leaseMs]
        );
        const now = Date.now();
        for (const row of res.rows) {
          const job = mapRow(row);
          runner.claimedAt.push(now);
          runner.running.set(job.id, { job });
          void this.execute(runner, job);
        }
        // A full batch may mean more is due.
        if (res.rows.length === free) {
          runner.again = true;
        }
      } while (runner.again && !this.stopped);
    } catch (err) {
      console.error('job worker: claim failed', (err as Error).message);
    } finally {
      runner.busy = false;
    }
  }

  // ---- execute ----------------------------------------------------------
  private async execute(runner: QueueRunner, job: Job) {
    const handler = this.handlers.get(job.kind);
    const entry = runner.running.get(job.id)!;
    try {
      if (!handler) {
        // Retried: a worker of another version may know the kind.
        throw new Error(`No handler for job kind ${job.kind}`);
      }

      const ctx: JobContext = {
        job,
        markStarted: async () => {
          const res = await this.db.query(
            `UPDATE pgonly.jobs SET started_at = COALESCE(started_at, now()),
               updated_at = now()
             WHERE id = $1 AND attempts = $2 AND status = 'running'`,
            [job.id, job.attempts]
          );
          if (!res.rowCount) {
            // Cancelled or reclaimed: do not publish for a job nobody owns.
            throw new JobNotOwned();
          }
          job.startedAt ??= new Date();
        },
        assertOwned: async () => {
          const res = await this.db.query(
            `SELECT 1 FROM pgonly.jobs
             WHERE id = $1 AND attempts = $2 AND status = 'running'`,
            [job.id, job.attempts]
          );
          if (!res.rowCount) {
            throw new JobNotOwned();
          }
        },
        setProgress: (details) => {
          entry.progress = details;
        },
      };

      let outcome: void | JobOutcome;
      try {
        outcome = await runWithJobContext(ctx, () => handler.fn(job, ctx));
      } catch (err) {
        await this.fail(job, err, handler.opts).catch((e) =>
          console.error('job worker: could not record failure', e.message)
        );
        return;
      }
      // If this write is lost the lease runs out and the reaper decides.
      await this.complete(job, outcome || {}).catch((e) =>
        console.error('job worker: could not complete job', e.message)
      );
    } catch (err) {
      await this.fail(job, err).catch((e) =>
        console.error('job worker: could not record failure', e.message)
      );
    } finally {
      runner.running.delete(job.id);
      // A slot freed: claim again right away.
      void this.claim(runner);
    }
  }

  /**
   * One transaction on a worker connection. A job of a post takes the post's
   * lock first, so that what it writes (its end, its follow-ups, its retry)
   * and a reschedule or cancel of the post never interleave.
   */
  private async inTransaction<T>(
    job: Job,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      if (job.postId) {
        await lockPost(client, job.postId);
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async complete(job: Job, outcome: JobOutcome) {
    await this.inTransaction(job, async (client) => {
      // Guarded by status and attempt: a job that was cancelled or reclaimed
      // while the handler ran must not complete, nor schedule its follow-ups.
      const res = await client.query(
        `UPDATE pgonly.jobs SET status = 'done', result = $3,
           locked_until = NULL, updated_at = now()
         WHERE id = $1 AND attempts = $2 AND status = 'running'`,
        [job.id, job.attempts, JSON.stringify(outcome.result ?? null)]
      );
      if (res.rowCount && outcome.next?.length) {
        await insertFollowUps(client, outcome.next);
      }
    });
  }

  private async fail(job: Job, err: unknown, opts?: HandlerOptions) {
    // The row was cancelled or reclaimed under the handler: whoever took it
    // over decides its fate. Nothing to record, and no cleanup, because the
    // cleanup would act on a post that now belongs to another job.
    if (isJobNotOwned(err)) {
      return;
    }
    const message = String((err as Error)?.message ?? err).slice(0, 4000);
    // A job past markStarted is never retried: its outcome is unknown.
    const retry =
      !isNonRetryable(err) && !job.startedAt && job.attempts < job.maxAttempts;

    // Committed before onFailed runs: that handler enqueues, and takes the
    // same post lock on another connection.
    const recorded = await this.inTransaction(job, async (client) => {
      if (retry) {
        const delay =
          job.retryDelayMs * Math.pow(job.backoff, job.attempts - 1);
        await client.query(
          `UPDATE pgonly.jobs SET status = 'pending', last_error = $3,
             run_at = now() + ($4::double precision * interval '1 millisecond'),
             locked_until = NULL, updated_at = now()
           WHERE id = $1 AND attempts = $2 AND status = 'running'`,
          [job.id, job.attempts, message, delay]
        );
        return false;
      }
      const res = await client.query(
        `UPDATE pgonly.jobs SET status = 'failed', last_error = $3,
           locked_until = NULL, updated_at = now()
         WHERE id = $1 AND attempts = $2 AND status = 'running'`,
        [job.id, job.attempts, message]
      );
      return !!res.rowCount;
    });
    if (recorded) {
      await this.runOnFailed(job, message, (err as any)?.type, opts);
    }
  }

  private async runOnFailed(
    job: Job,
    error: string,
    type?: string,
    opts?: HandlerOptions
  ) {
    const onFailed =
      opts?.onFailed ?? this.handlers.get(job.kind)?.opts.onFailed;
    if (!onFailed) {
      return;
    }
    try {
      await onFailed(job, error, type);
    } catch (err) {
      console.error(
        `job worker: onFailed for ${job.kind} threw`,
        (err as Error).message
      );
    }
  }

  // ---- lease + reaper ---------------------------------------------------
  private async extendLeases() {
    const held: { id: number; attempts: number; progress: string | null }[] =
      [];
    this.runners.forEach((runner) =>
      runner.running.forEach((r) =>
        held.push({
          id: r.job.id,
          attempts: r.job.attempts,
          progress: r.progress ?? null,
        })
      )
    );
    if (!held.length) {
      return;
    }
    try {
      // A row that is not updated was cancelled or reclaimed; its handler
      // finishes anyway and the guarded completion is ignored.
      await this.db.query(
        `UPDATE pgonly.jobs j
           SET locked_until = now() + ($4::int * interval '1 millisecond'),
               progress = COALESCE(h.progress, j.progress)
         FROM unnest($1::bigint[], $2::int[], $3::text[]) AS h(id, attempts, progress)
         WHERE j.id = h.id AND j.attempts = h.attempts AND j.status = 'running'`,
        [
          held.map((h) => h.id),
          held.map((h) => h.attempts),
          held.map((h) => h.progress),
          this.leaseMs,
        ]
      );
    } catch (err) {
      console.error(
        'job worker: lease extension failed',
        (err as Error).message
      );
    }
  }

  /**
   * Takes jobs whose lease ran out (the process died, or hung) back from
   * their owner. A job that never reached `markStarted` goes back to pending;
   * one that did is failed instead, because its publish may have happened.
   */
  async reap() {
    if (this.stopped) {
      return;
    }
    try {
      const res = await this.db.query(
        `UPDATE pgonly.jobs SET
           status = CASE WHEN started_at IS NOT NULL OR attempts >= max_attempts
                         THEN 'failed' ELSE 'pending' END,
           last_error = CASE
             WHEN started_at IS NOT NULL THEN 'Lease expired after the job started (' || COALESCE(progress, 'no details') || '); not re-run, its outcome is unknown'
             WHEN attempts >= max_attempts THEN 'Lease expired and no attempts are left'
             ELSE last_error END,
           locked_until = NULL, updated_at = now()
         WHERE status = 'running' AND locked_until < now()
         RETURNING *`
      );
      for (const row of res.rows) {
        if (row.status === 'failed') {
          await this.runOnFailed(mapRow(row), row.last_error);
        }
      }
      if (res.rows.length) {
        this.wakeAll();
      }
    } catch (err) {
      console.error('job worker: reaper failed', (err as Error).message);
    }
  }
}
