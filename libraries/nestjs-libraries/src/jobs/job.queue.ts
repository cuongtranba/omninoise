import { Global, Injectable, Module } from '@nestjs/common';
import type { PoolClient, Pool } from 'pg';
import {
  ensurePgOnlySchema,
  getPgPool,
  sweepHourly,
} from '@gitroom/nestjs-libraries/pg/pg.pool';
import type {
  EnqueueOptions,
  FollowUp,
  Job,
  JobSnapshot,
  LegacyStatus,
} from '@gitroom/nestjs-libraries/jobs/job.types';

export const JOBS_CHANNEL = 'pgonly_jobs';

// A normal LOGGED table: the schedule has to survive a crash. It lives in
// `pgonly` because `prisma db push` drops tables it does not know in `public`.
const DDL = [
  `CREATE TABLE IF NOT EXISTS pgonly.jobs (
    id bigserial PRIMARY KEY,
    kind text NOT NULL,
    queue text NOT NULL DEFAULT 'main',
    dedupe_key text,
    post_id text,
    organization_id text,
    payload jsonb NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'pending',
    run_at timestamptz NOT NULL DEFAULT now(),
    attempts int NOT NULL DEFAULT 0,
    max_attempts int NOT NULL DEFAULT 3,
    retry_delay_ms int NOT NULL DEFAULT 120000,
    backoff numeric NOT NULL DEFAULT 1,
    locked_until timestamptz,
    started_at timestamptz,
    progress text,
    result jsonb,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedupe_key_idx
    ON pgonly.jobs (dedupe_key)
    WHERE status IN ('pending','running') AND dedupe_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS jobs_queue_run_at_idx
    ON pgonly.jobs (queue, run_at) WHERE status = 'pending'`,
  `CREATE INDEX IF NOT EXISTS jobs_post_id_idx ON pgonly.jobs (post_id)`,
  `CREATE INDEX IF NOT EXISTS jobs_running_lease_idx
    ON pgonly.jobs (locked_until) WHERE status = 'running'`,
  // Notifications waiting for an organization's hourly digest email.
  `CREATE TABLE IF NOT EXISTS pgonly.digest_items (
    id bigserial PRIMARY KEY,
    organization_id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS digest_items_org_idx
    ON pgonly.digest_items (organization_id, id)`,
];

const PRUNE_SQL = `DELETE FROM pgonly.jobs
  WHERE status IN ('done','failed','cancelled')
    AND updated_at < now() - interval '30 days'`;

const ACTIVE = `('pending','running')`;

export const mapRow = (row: any): Job => ({
  id: Number(row.id),
  kind: row.kind,
  queue: row.queue,
  dedupeKey: row.dedupe_key,
  postId: row.post_id,
  organizationId: row.organization_id,
  payload: row.payload,
  status: row.status,
  runAt: row.run_at,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  retryDelayMs: row.retry_delay_ms,
  backoff: Number(row.backoff),
  lockedUntil: row.locked_until,
  startedAt: row.started_at,
  result: row.result,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const LEGACY: Record<string, LegacyStatus> = {
  pending: 'RUNNING',
  running: 'RUNNING',
  done: 'COMPLETED',
  failed: 'FAILED',
  cancelled: 'FAILED',
};

let schemaReady: Promise<void> | undefined;

/** Creates the job tables once per process; a failed attempt is retried. */
export function ensureJobsSchema() {
  schemaReady ??= ensurePgOnlySchema(...DDL)
    .then(() => sweepHourly(PRUNE_SQL))
    .catch((err) => {
      schemaReady = undefined;
      throw err;
    });
  return schemaReady;
}

/** Inserts one job on `db`; with a dedupe key it honours the 'keep'/'replace' mode. */
export async function insertJob(
  db: Pick<Pool | PoolClient, 'query'>,
  kind: string,
  payload: unknown,
  opts: EnqueueOptions = {}
): Promise<{ id: number; created: boolean }> {
  const values = [
    kind,
    opts.queue ?? 'main',
    opts.dedupeKey ?? null,
    opts.postId ?? null,
    opts.organizationId ?? null,
    JSON.stringify(payload ?? {}),
    opts.runAt ?? new Date(),
    opts.maxAttempts ?? 3,
    opts.retryDelayMs ?? 120_000,
    opts.backoff ?? 1,
  ];
  const insert = `INSERT INTO pgonly.jobs
      (kind, queue, dedupe_key, post_id, organization_id, payload, run_at,
       max_attempts, retry_delay_ms, backoff)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;

  if (!opts.dedupeKey) {
    const res = await db.query(`${insert} RETURNING id`, values);
    return { id: Number(res.rows[0].id), created: true };
  }

  if (opts.mode === 'replace') {
    await db.query(
      `UPDATE pgonly.jobs SET status = 'cancelled', updated_at = now()
       WHERE dedupe_key = $1 AND status IN ${ACTIVE}`,
      [opts.dedupeKey]
    );
  }

  // The job holding the key can finish between the conflict and the lookup,
  // freeing the key; go round again instead of failing.
  for (let attempt = 0; attempt < 5; attempt++) {
    const inserted = await db.query(
      `${insert}
       ON CONFLICT (dedupe_key)
         WHERE status IN ${ACTIVE} AND dedupe_key IS NOT NULL
       DO NOTHING RETURNING id`,
      values
    );
    if (inserted.rows[0]) {
      return { id: Number(inserted.rows[0].id), created: true };
    }
    const existing = await db.query(
      `SELECT id FROM pgonly.jobs
       WHERE dedupe_key = $1 AND status IN ${ACTIVE} LIMIT 1`,
      [opts.dedupeKey]
    );
    if (existing.rows[0]) {
      return { id: Number(existing.rows[0].id), created: false };
    }
  }
  throw new Error(`Could not enqueue ${kind} with key ${opts.dedupeKey}`);
}

export async function insertFollowUps(
  db: Pick<Pool | PoolClient, 'query'>,
  next: FollowUp[]
) {
  const queues = new Set<string>();
  for (const f of next) {
    await insertJob(db, f.kind, f.payload, f.opts);
    queues.add(f.opts?.queue ?? 'main');
  }
  for (const queue of queues) {
    await db.query('SELECT pg_notify($1, $2)', [JOBS_CHANNEL, queue]);
  }
}

/**
 * The single owner of scheduling. Postgres is the queue (`FOR UPDATE SKIP
 * LOCKED`), the wake-up (`LISTEN/NOTIFY`) and the clock (`run_at`).
 * Usable with or without Nest DI: `new JobQueueService()`.
 */
@Injectable()
export class JobQueueService {
  async ready() {
    await ensureJobsSchema();
  }

  async enqueue(
    kind: string,
    payload: unknown = {},
    opts: EnqueueOptions = {}
  ): Promise<{ id: number; created: boolean }> {
    await this.ready();
    const client = await getPgPool().connect();
    try {
      await client.query('BEGIN');
      const res = await insertJob(client, kind, payload, opts);
      await client.query('SELECT pg_notify($1, $2)', [
        JOBS_CHANNEL,
        opts.queue ?? 'main',
      ]);
      await client.query('COMMIT');
      return res;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Cancels every pending or running job of a post, the repeat children
   * included. A running handler is not interrupted; its completion is
   * ignored, so it cannot schedule anything after the cancel.
   */
  async cancelByPost(postId: string): Promise<number> {
    await this.ready();
    const res = await getPgPool().query(
      `UPDATE pgonly.jobs SET status = 'cancelled', updated_at = now()
       WHERE post_id = $1 AND status IN ${ACTIVE}`,
      [postId]
    );
    return res.rowCount ?? 0;
  }

  async cancelByKey(key: string): Promise<number> {
    await this.ready();
    const res = await getPgPool().query(
      `UPDATE pgonly.jobs SET status = 'cancelled', updated_at = now()
       WHERE dedupe_key = $1 AND status IN ${ACTIVE}`,
      [key]
    );
    return res.rowCount ?? 0;
  }

  /** By numeric id, or by dedupe key (the newest job holding it). */
  async get(ref: number | string): Promise<JobSnapshot | undefined> {
    await this.ready();
    const res =
      typeof ref === 'number'
        ? await getPgPool().query('SELECT * FROM pgonly.jobs WHERE id = $1', [
            ref,
          ])
        : await getPgPool().query(
            `SELECT * FROM pgonly.jobs WHERE dedupe_key = $1
             ORDER BY id DESC LIMIT 1`,
            [ref]
          );
    if (!res.rows[0]) {
      return undefined;
    }
    const job = mapRow(res.rows[0]);
    return {
      id: job.id,
      status: job.status,
      legacyStatus: LEGACY[job.status],
      result: job.result,
      error: job.lastError,
    };
  }

  /** The newest job of a kind that is waiting or running, if any. */
  async findActive(dedupeKey: string): Promise<Job | undefined> {
    await this.ready();
    const res = await getPgPool().query(
      `SELECT * FROM pgonly.jobs WHERE dedupe_key = $1 AND status IN ${ACTIVE}
       LIMIT 1`,
      [dedupeKey]
    );
    return res.rows[0] ? mapRow(res.rows[0]) : undefined;
  }
}

@Global()
@Module({
  providers: [JobQueueService],
  exports: [JobQueueService],
})
export class JobsModule {}
