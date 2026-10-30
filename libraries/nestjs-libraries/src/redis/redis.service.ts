import {
  ensurePgOnlySchema,
  getPgPool,
  sweepHourly,
} from '@gitroom/nestjs-libraries/pg/pg.pool';

const DDL = [
  `CREATE UNLOGGED TABLE IF NOT EXISTS pgonly.kv_store(
    key text PRIMARY KEY,
    value text,
    list text[],
    expires_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS kv_store_expires_at_idx
    ON pgonly.kv_store(expires_at)`,
];

const LIVE =
  '(kv_store.expires_at IS NULL OR kv_store.expires_at > now())';

/**
 * The small subset of the ioredis API Postiz uses, backed by an UNLOGGED
 * Postgres table. Expired rows count as absent everywhere.
 */
class PostgresKeyValue {
  private ready?: Promise<void>;

  private async query(text: string, values: unknown[]) {
    // A failed setup is not cached, so the next call retries it.
    this.ready ??= ensurePgOnlySchema(...DDL).then(() =>
      sweepHourly('DELETE FROM pgonly.kv_store WHERE expires_at <= now()')
    );
    await this.ready.catch((err) => {
      this.ready = undefined;
      throw err;
    });
    return getPgPool().query(text, values);
  }

  async get(key: string): Promise<string | null> {
    const res = await this.query(
      `SELECT value FROM pgonly.kv_store AS kv_store WHERE key = $1 AND ${LIVE}`,
      [key]
    );
    return res.rows[0]?.value ?? null;
  }

  set(key: string, value: string): Promise<'OK'>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<'OK'>;
  set(
    key: string,
    value: string,
    mode: 'EX',
    seconds: number,
    nx: 'NX'
  ): Promise<'OK' | null>;
  async set(
    key: string,
    value: string,
    mode?: 'EX',
    seconds?: number,
    nx?: 'NX'
  ): Promise<'OK' | null> {
    const expiresAt = mode ? `now() + $3 * interval '1 second'` : 'NULL';
    const values = mode ? [key, value, seconds] : [key, value];
    // NX only takes over a row that has already expired.
    const onConflict = nx
      ? `DO UPDATE SET value = EXCLUDED.value, list = NULL, expires_at = EXCLUDED.expires_at
         WHERE kv_store.expires_at IS NOT NULL AND kv_store.expires_at <= now()`
      : `DO UPDATE SET value = EXCLUDED.value, list = NULL, expires_at = EXCLUDED.expires_at`;
    const res = await this.query(
      `INSERT INTO pgonly.kv_store AS kv_store (key, value, expires_at)
       VALUES ($1, $2, ${expiresAt})
       ON CONFLICT (key) ${onConflict}
       RETURNING key`,
      values
    );
    return res.rowCount ? 'OK' : null;
  }

  async del(key: string): Promise<number> {
    const res = await this.query(
      `DELETE FROM pgonly.kv_store AS kv_store WHERE key = $1 AND ${LIVE}`,
      [key]
    );
    return res.rowCount ?? 0;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const res = await this.query(
      `UPDATE pgonly.kv_store AS kv_store
         SET expires_at = now() + $2 * interval '1 second'
       WHERE key = $1 AND ${LIVE}`,
      [key, seconds]
    );
    return res.rowCount ?? 0;
  }

  async rpush(key: string, item: string): Promise<number> {
    const res = await this.query(
      `INSERT INTO pgonly.kv_store AS kv_store (key, list)
       VALUES ($1, ARRAY[$2]::text[])
       ON CONFLICT (key) DO UPDATE SET
         list = CASE WHEN ${LIVE}
                     THEN COALESCE(kv_store.list, '{}') || EXCLUDED.list
                     ELSE EXCLUDED.list END,
         value = CASE WHEN ${LIVE} THEN kv_store.value END,
         expires_at = CASE WHEN ${LIVE} THEN kv_store.expires_at END
       RETURNING cardinality(list) AS length`,
      [key, item]
    );
    return res.rows[0].length;
  }

  async lrange(key: string, start: number, end: number): Promise<string[]> {
    const res = await this.query(
      `SELECT list FROM pgonly.kv_store AS kv_store WHERE key = $1 AND ${LIVE}`,
      [key]
    );
    const list: string[] = res.rows[0]?.list ?? [];
    const from = start < 0 ? Math.max(list.length + start, 0) : start;
    const to = end < 0 ? list.length + end : end;
    return to < from ? [] : list.slice(from, to + 1);
  }
}

export const ioRedis = new PostgresKeyValue();
