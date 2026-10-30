import { Pool } from 'pg';

// Postgres replaces Redis for caches, one-shot state and rate limiting. Those
// tables live in their own schema because `prisma db push` treats `public` as
// fully Prisma-owned and drops tables it does not know about.
export const PGONLY_SCHEMA = 'pgonly';

// Query parameters that only Prisma understands; `pg` would pass them to the
// server as unknown runtime options and the connection would be rejected.
const PRISMA_ONLY_PARAMS = [
  'schema',
  'connection_limit',
  'pool_timeout',
  'pgbouncer',
  'statement_cache_size',
  'socket_timeout',
  'connect_timeout',
];

// Arbitrary constant: every process taking this lock serialises its DDL.
const DDL_LOCK_ID = 7_251_902_001;

let pool: Pool | undefined;
const ensured = new Map<string, Promise<void>>();
const sweepers = new Set<string>();

/** The plain `pg` connection string, for clients that must not be pooled (LISTEN). */
export function pgConnectionString() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL is not set');
  }
  const url = new URL(raw);
  for (const param of PRISMA_ONLY_PARAMS) {
    url.searchParams.delete(param);
  }
  return url.toString();
}

export function getPgPool() {
  if (!pool) {
    pool = new Pool({ connectionString: pgConnectionString(), max: 5 });
    // An idle client dies when Postgres restarts; without a listener the
    // 'error' event would crash the process. The pool replaces the client.
    pool.on('error', (err) => {
      console.error('pg pool: idle client error', err.message);
    });
  }
  return pool;
}

/**
 * Creates the `pgonly` schema and runs the given idempotent DDL statements
 * (use `CREATE UNLOGGED TABLE IF NOT EXISTS`). Memoised per statement set and
 * guarded by an advisory lock, so concurrent backend and orchestrator boots
 * cannot race.
 */
export function ensurePgOnlySchema(...ddl: string[]) {
  const id = ddl.join(';\n');
  let done = ensured.get(id);
  if (!done) {
    done = runDdl(ddl).catch((err) => {
      ensured.delete(id);
      throw err;
    });
    ensured.set(id, done);
  }
  return done;
}

async function runDdl(ddl: string[]) {
  const client = await getPgPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [DDL_LOCK_ID]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${PGONLY_SCHEMA}`);
    for (const statement of ddl) {
      await client.query(statement);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Runs `deleteSql` hourly; the timer never keeps the process alive. */
export function sweepHourly(deleteSql: string) {
  if (sweepers.has(deleteSql)) {
    return;
  }
  sweepers.add(deleteSql);
  setInterval(
    () => {
      getPgPool()
        .query(deleteSql)
        .catch(() => undefined);
    },
    60 * 60 * 1000
  ).unref();
}
