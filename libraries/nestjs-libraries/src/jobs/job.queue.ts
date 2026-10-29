import { Global, Injectable, Module } from '@nestjs/common';
import type { PoolClient, Pool } from 'pg';
import {
  ensurePgOnlySchema,
  getPgPool,
  sweepHourly,
} from '@gitroom/nestjs-libraries/pg/pg.pool';
import { JobNotOwned } from '@gitroom/nestjs-libraries/jobs/job.errors';
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
  // Set by an owner reschedule on the finished rows of a post: the owner
  // re-armed the post, so those rows no longer stop the sweep from rescuing it.
  `ALTER TABLE pgonly.jobs
    ADD COLUMN IF NOT EXISTS superseded boolean NOT NULL DEFAULT false`,
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

// A running job whose provider call has begun cannot be interrupted, and its
// outcome is unknown: cancelling it would only hide it, and a replacement
// would publish the post a second time.
const IN_FLIGHT = `(status = 'running' AND started_at IS NOT NULL)`;

// The steps between the platform accepting a post and the chain being done.
// While one of these is alive the root may still change state.
const MID_PUBLISH_KINDS = `('post.comment','post.checkStatus','post.finish')`;

/** The key of a publish that waits for the chain in flight to end. */
export const NEXT_SUFFIX = ':next';

/**
 * Serialises everything that decides what is scheduled for one post: a
 * reschedule, a cancel, a job completing with follow-ups, a take-over. Held
 * to the end of the transaction. Each transaction takes at most this one lock,
 * so there is no ordering to get wrong. Without it a cancel that waits on a
 * job's row lock cannot see the follow-up that job inserts when it commits.
 */
export const lockPost = (
  db: Pick<Pool | PoolClient, 'query'>,
  postId: string
) => db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`post:${postId}`]);

// How long after another job of a post began and ended its failure handler
// has to settle the post's state before a successor may look at it.
export const SETTLE_COOLDOWN_MS = 30_000;

const postBusy = async (
  db: Pick<Pool | PoolClient, 'query'>,
  job: Pick<Job, 'id' | 'postId'>,
  cooldownMs: number
) => {
  const res = await db.query(
    `SELECT 1 FROM pgonly.jobs
     WHERE post_id = $1 AND id <> $2 AND (
       (status IN ${ACTIVE} AND (${IN_FLIGHT} OR kind IN ${MID_PUBLISH_KINDS}))
       OR (started_at IS NOT NULL AND status IN ('done','failed')
           AND updated_at > now() - ($3::double precision * interval '1 millisecond'))
     ) LIMIT 1`,
    [job.postId, job.id, cooldownMs]
  );
  return !!res.rowCount;
};

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

  // 'replace' leaves a job that is mid-publish alone; the insert below then
  // finds it holding the key and creates nothing.
  if (opts.mode === 'replace') {
    if (opts.postId) {
      await lockPost(db, opts.postId);
    }
    await db.query(
      `UPDATE pgonly.jobs SET status = 'cancelled', updated_at = now()
       WHERE dedupe_key = $1 AND status IN ${ACTIVE} AND NOT ${IN_FLIGHT}`,
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
      if (opts.postId) {
        await lockPost(client, opts.postId);
      }
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
    const client = await getPgPool().connect();
    try {
      await client.query('BEGIN');
      await lockPost(client, postId);
      const res = await client.query(
        `UPDATE pgonly.jobs SET status = 'cancelled', updated_at = now()
         WHERE post_id = $1 AND status IN ${ACTIVE}`,
        [postId]
      );
      await client.query('COMMIT');
      return res.rowCount ?? 0;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Replaces everything scheduled for a post in one transaction: its pending
   * and not-yet-started running jobs are cancelled and, unless `next` is
   * omitted (a draft), `next` takes their place. There is no instant at which
   * the post has no job, or two.
   *
   * A job that is mid-publish (running, `started_at` set) is left alone: it
   * cannot be stopped and its outcome is unknown, so a replacement started
   * beside it could publish the post twice. `next` is then inserted under the
   * key `<dedupeKey>:next` (replacing an earlier edit's) and `deferred` is
   * true: its handler waits for the chain in flight to end (`isPostBusy`),
   * then takes the post over (`takeOverPost`). The edit is never dropped and
   * the post never has two publishes running.
   *
   * Every finished row of the post is marked `superseded`: the owner re-armed
   * the post, so a publish that failed earlier no longer keeps the sweep from
   * rescuing it.
   */
  async reschedulePost(
    postId: string,
    next?: FollowUp
  ): Promise<{ cancelled: number; created: boolean; deferred: boolean }> {
    await this.ready();
    const client = await getPgPool().connect();
    try {
      await client.query('BEGIN');
      await lockPost(client, postId);
      const cancelled = await client.query(
        `UPDATE pgonly.jobs SET status = 'cancelled', updated_at = now()
         WHERE post_id = $1 AND status IN ${ACTIVE} AND NOT ${IN_FLIGHT}`,
        [postId]
      );
      await client.query(
        `UPDATE pgonly.jobs SET superseded = true
         WHERE post_id = $1 AND status IN ('done','failed','cancelled')
           AND NOT superseded`,
        [postId]
      );
      let created = false;
      let deferred = false;
      if (next) {
        const inFlight = await client.query(
          `SELECT 1 FROM pgonly.jobs WHERE post_id = $1 AND ${IN_FLIGHT} LIMIT 1`,
          [postId]
        );
        deferred = !!inFlight.rowCount && !!next.opts?.dedupeKey;
        const opts: EnqueueOptions = deferred
          ? {
              ...next.opts,
              postId,
              dedupeKey: `${next.opts!.dedupeKey}${NEXT_SUFFIX}`,
              mode: 'replace',
            }
          : { ...next.opts, postId, mode: 'keep' };
        created = (await insertJob(client, next.kind, next.payload, opts))
          .created;
        await client.query('SELECT pg_notify($1, $2)', [
          JOBS_CHANNEL,
          opts.queue ?? 'main',
        ]);
      }
      await client.query('COMMIT');
      return { cancelled: cancelled.rowCount ?? 0, created, deferred };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * True while another job of the post could still change what the post
   * looks like: one that is mid-publish, one of the steps between the
   * platform accepting the post and the chain ending, or one that finished
   * (or failed) after beginning less than `cooldownMs` ago (its failure
   * handler may not have settled the post yet).
   */
  async isPostBusy(
    job: Pick<Job, 'id' | 'postId'>,
    cooldownMs = SETTLE_COOLDOWN_MS
  ): Promise<boolean> {
    await this.ready();
    return postBusy(getPgPool(), job, cooldownMs);
  }

  /**
   * Makes `job` the only job of its post, atomically: while the post is not
   * busy (`isPostBusy`) every other pending or not-yet-started job of the post
   * is cancelled (the remains of the chain that was in flight: its plugs and
   * repeat) and the job takes over the post's normal dedupe key. Answers
   * `taken: false` when the post is busy or the key is held: try again later.
   * Throws JobNotOwned when the job itself was cancelled meanwhile.
   */
  async takeOverPost(
    job: Pick<Job, 'id' | 'postId' | 'attempts'>,
    cooldownMs = SETTLE_COOLDOWN_MS
  ): Promise<{ taken: true; dedupeKey: string } | { taken: false }> {
    await this.ready();
    const postId = job.postId!;
    const dedupeKey = `post:${postId}`;
    const client = await getPgPool().connect();
    try {
      await client.query('BEGIN');
      await lockPost(client, postId);
      const own = await client.query(
        `SELECT 1 FROM pgonly.jobs
         WHERE id = $1 AND attempts = $2 AND status = 'running'`,
        [job.id, job.attempts]
      );
      if (!own.rowCount) {
        throw new JobNotOwned();
      }
      if (await postBusy(client, job, cooldownMs)) {
        await client.query('ROLLBACK');
        return { taken: false };
      }
      await client.query(
        `UPDATE pgonly.jobs SET status = 'cancelled', updated_at = now()
         WHERE post_id = $1 AND id <> $2 AND status IN ${ACTIVE}
           AND NOT ${IN_FLIGHT}`,
        [postId, job.id]
      );
      await client.query(
        `UPDATE pgonly.jobs SET dedupe_key = $2, updated_at = now()
         WHERE id = $1`,
        [job.id, dedupeKey]
      );
      await client.query('COMMIT');
      return { taken: true, dedupeKey };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      // a job that began after the check holds the key: it owns the post
      if ((err as { code?: string })?.code === '23505') {
        return { taken: false };
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Which of these posts had a publish begin, in any job status. A post whose
   * publish ever started has an unknown outcome and must never be published
   * again automatically (the sweep and the boot seeder use this). Rows that an
   * owner reschedule superseded do not count: the owner re-armed the post.
   */
  async startedPublishPostIds(postIds: string[]): Promise<Set<string>> {
    if (!postIds.length) {
      return new Set();
    }
    await this.ready();
    const res = await getPgPool().query(
      `SELECT DISTINCT post_id FROM pgonly.jobs
       WHERE post_id = ANY($1::text[]) AND started_at IS NOT NULL
         AND kind LIKE 'post.%' AND NOT superseded`,
      [postIds]
    );
    return new Set(res.rows.map((r) => r.post_id as string));
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
