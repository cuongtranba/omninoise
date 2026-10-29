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

// The steps between the platform accepting a post and the chain being done.
// A status check may wait for minutes between two polls, a comment for days.
const MID_PUBLISH_KINDS = `('post.comment','post.checkStatus','post.finish')`;

// THE rule for "this job of the post cannot be cancelled, and the post must
// not be touched until it has ended". Everything that decides it (reschedule,
// replace, take-over, `postBusy`) uses this one fragment:
//  - a running job whose provider call has begun cannot be interrupted and its
//    outcome is unknown: cancelling it would only hide it, and a replacement
//    would publish the post a second time;
//  - a job of a mid-publish kind, pending or running: the platform already
//    accepted the post and the job is what records it (a status check waits
//    between two polls with `started_at` unset). Cancelling it loses the
//    record of a live post, and the edit queued instead would publish it again.
export const IN_FLIGHT = `(status IN ${ACTIVE} AND (
  kind IN ${MID_PUBLISH_KINDS} OR (status = 'running' AND started_at IS NOT NULL)))`;

// Cancels the matching active jobs, locking the rows in id order: two
// statements that touch several rows of one post (a reschedule, the reaper,
// a lease extension) then queue up behind each other instead of deadlocking.
const cancelActive = (where: string) => `UPDATE pgonly.jobs
  SET status = 'cancelled', updated_at = now()
  WHERE id IN (
    SELECT id FROM pgonly.jobs WHERE ${where} AND status IN ${ACTIVE}
    ORDER BY id FOR UPDATE)`;

// Finished rows of a post stop counting as "a publish began" once the owner
// (or a take-over) re-armed the post.
const supersedeFinished = `UPDATE pgonly.jobs SET superseded = true
  WHERE id IN (
    SELECT id FROM pgonly.jobs
    WHERE post_id = $1 AND status IN ('done','failed','cancelled')
      AND NOT superseded
    ORDER BY id FOR UPDATE)`;

const RETRYABLE_SQLSTATES = new Set(['40P01', '40001']);

/** Runs a whole transaction again, once, when Postgres aborted it as a deadlock victim. */
async function retryOnConflict<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!RETRYABLE_SQLSTATES.has((err as { code?: string })?.code ?? '')) {
      throw err;
    }
    return fn();
  }
}

/** The key of a publish that waits for the chain in flight to end. */
export const NEXT_SUFFIX = ':next';
/** The key of a post's repeat job. */
export const REPEAT_SUFFIX = ':repeat';

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
       ${IN_FLIGHT}
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
    await db.query(cancelActive(`dedupe_key = $1 AND NOT ${IN_FLIGHT}`), [
      opts.dedupeKey,
    ]);
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
   * included, whatever it is doing (a delete: the post is gone, and a job that
   * still finds it - a status check between two polls - reads a post with
   * `deletedAt` set and ends). A running handler is not interrupted; its
   * completion is ignored, so it cannot schedule anything after the cancel.
   */
  async cancelByPost(postId: string): Promise<number> {
    await this.ready();
    return retryOnConflict(async () => {
      const client = await getPgPool().connect();
      try {
        await client.query('BEGIN');
        await lockPost(client, postId);
        const res = await client.query(cancelActive('post_id = $1'), [postId]);
        await client.query('COMMIT');
        return res.rowCount ?? 0;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    });
  }

  /**
   * Replaces everything scheduled for a post in one transaction: its pending
   * and not-yet-started jobs are cancelled and, unless `next` is omitted (a
   * draft), `next` takes their place. There is no instant at which the post
   * has no job, or two.
   *
   * A job that is in flight (`IN_FLIGHT`: mid-publish, running with
   * `started_at` set, or any pending or running comment, status check or
   * finish) is left alone: it cannot be stopped, its outcome is unknown or it
   * is what records the outcome, so a replacement started beside it could
   * publish the post twice. `next` is then inserted under the key
   * `<dedupeKey>:next` (replacing an earlier edit's) and `deferred` is true:
   * its handler waits for the chain in flight to end (`isPostBusy`), then
   * takes the post over (`takeOverPost`). The edit is never dropped and the
   * post never has two publishes running.
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
    return retryOnConflict(async () => {
      const client = await getPgPool().connect();
      try {
        await client.query('BEGIN');
        await lockPost(client, postId);
        const cancelled = await client.query(
          cancelActive(`post_id = $1 AND NOT ${IN_FLIGHT}`),
          [postId]
        );
        await client.query(supersedeFinished, [postId]);
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
    });
  }

  /**
   * True while another job of the post could still change what the post
   * looks like: one that is in flight (`IN_FLIGHT`), or one that finished (or
   * failed) after beginning less than `cooldownMs` ago (its failure handler
   * may not have settled the post yet).
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
   * repeat), the post's finished rows are marked superseded and the job takes
   * over the post's normal dedupe key. Answers `taken: false` when the post is
   * busy or the key is held: try again later. Throws JobNotOwned when the job
   * itself was cancelled meanwhile.
   *
   * Answers `unconfirmed: true` (and takes nothing over) when a publish of the
   * post began, was not superseded and ended after `job` was created: the
   * edit waited for it, and the caller has just seen the post still waiting to
   * be published. Either the publish never wrote its outcome to the post (a
   * database outage swallowed the write) or this is a republish; in both cases
   * the post may be live, so publishing again could duplicate it. The caller
   * marks the post unconfirmed and ends `job`.
   */
  async takeOverPost(
    job: Pick<Job, 'id' | 'postId' | 'attempts'>,
    cooldownMs = SETTLE_COOLDOWN_MS
  ): Promise<
    { taken: true; dedupeKey: string } | { taken: false; unconfirmed?: boolean }
  > {
    await this.ready();
    const postId = job.postId!;
    const dedupeKey = `post:${postId}`;
    const client = await getPgPool().connect();
    try {
      await client.query('BEGIN');
      await lockPost(client, postId);
      const own = await client.query(
        `SELECT created_at FROM pgonly.jobs
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
      const unfinished = await client.query(
        `SELECT 1 FROM pgonly.jobs
         WHERE post_id = $1 AND id <> $2 AND started_at IS NOT NULL
           AND kind LIKE 'post.%' AND NOT superseded
           AND status IN ('done','failed') AND updated_at > $3
         LIMIT 1`,
        [postId, job.id, own.rows[0].created_at]
      );
      if (unfinished.rowCount) {
        await client.query('ROLLBACK');
        return { taken: false, unconfirmed: true };
      }
      await client.query(cancelActive('post_id = $1 AND id <> $2'), [
        postId,
        job.id,
      ]);
      await client.query(supersedeFinished, [postId]);
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
   * Sorts posts that are waiting to be published (state QUEUE) by what the
   * job table knows of them. The sweep and the boot seeder use this.
   *  - `publish`: no publish ever began; safe to enqueue (`keep` leaves a post
   *    that has a live job alone);
   *  - `unconfirmed`: past due, a publish began (not superseded by an owner
   *    reschedule) and no job of the post is alive any more (or settling:
   *    one that ended less than `SETTLE_COOLDOWN_MS` ago still may), yet the post is
   *    still QUEUE: its outcome was never written. It may be live, so it must
   *    not be published again; the caller marks it unconfirmed;
   *  - every other post is left alone (its publish is in flight, or it is not
   *    due yet).
   */
  async classifyQueuedPosts(
    posts: { id: string; publishDate: Date }[],
    now = Date.now()
  ): Promise<{ publish: string[]; unconfirmed: string[] }> {
    const out = { publish: [] as string[], unconfirmed: [] as string[] };
    if (!posts.length) {
      return out;
    }
    await this.ready();
    const res = await getPgPool().query(
      `SELECT p.id,
         EXISTS (SELECT 1 FROM pgonly.jobs j WHERE j.post_id = p.id
                 AND j.started_at IS NOT NULL AND j.kind LIKE 'post.%'
                 AND NOT j.superseded) AS started,
         EXISTS (SELECT 1 FROM pgonly.jobs j WHERE j.post_id = p.id
                 AND (j.status IN ${ACTIVE}
                      OR (j.started_at IS NOT NULL AND j.updated_at >
                          now() - ($2::double precision * interval '1 millisecond')))
                ) AS alive
       FROM unnest($1::text[]) AS p(id)`,
      [posts.map((p) => p.id), SETTLE_COOLDOWN_MS]
    );
    const info = new Map(res.rows.map((r) => [r.id as string, r]));
    for (const post of posts) {
      const { started, alive } = info.get(post.id) ?? {};
      if (!started) {
        out.publish.push(post.id);
      } else if (!alive && new Date(post.publishDate).getTime() <= now) {
        out.unconfirmed.push(post.id);
      }
    }
    return out;
  }

  async cancelByKey(key: string): Promise<number> {
    await this.ready();
    const res = await getPgPool().query(cancelActive('dedupe_key = $1'), [key]);
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
