import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import {
  ensurePgOnlySchema,
  getPgPool,
  sweepHourly,
} from '@gitroom/nestjs-libraries/pg/pg.pool';

const DDL = [
  `CREATE UNLOGGED TABLE IF NOT EXISTS pgonly.throttle_hits(
    key text PRIMARY KEY,
    hits int NOT NULL,
    expires_at timestamptz NOT NULL,
    blocked_until timestamptz
  )`,
];

// $1 key, $2 ttl ms, $3 limit, $4 block duration ms.
// One atomic upsert with the semantics of the Redis script it replaces:
// the hit counter keeps counting while blocked, a window that has expired
// restarts at one hit, and the hit that exceeds the limit starts the block.
const INCREMENT = `
  INSERT INTO pgonly.throttle_hits AS t (key, hits, expires_at, blocked_until)
  VALUES (
    $1, 1, now() + $2 * interval '1 millisecond',
    CASE WHEN 1 > $3 THEN now() + $4 * interval '1 millisecond' END
  )
  ON CONFLICT (key) DO UPDATE SET
    hits = CASE WHEN t.expires_at <= now() THEN 1 ELSE t.hits + 1 END,
    expires_at = CASE WHEN t.expires_at <= now()
      THEN now() + $2 * interval '1 millisecond' ELSE t.expires_at END,
    blocked_until = CASE
      WHEN t.blocked_until > now() THEN t.blocked_until
      WHEN (CASE WHEN t.expires_at <= now() THEN 1 ELSE t.hits + 1 END) > $3
        THEN now() + $4 * interval '1 millisecond'
    END
  RETURNING
    hits,
    extract(epoch FROM (expires_at - now())) * 1000 AS ms_to_expire,
    COALESCE(blocked_until > now(), false) AS is_blocked,
    COALESCE(extract(epoch FROM (blocked_until - now())) * 1000, 0)
      AS ms_to_block_expire`;

@Injectable()
export class PgThrottlerStorage implements ThrottlerStorage {
  private ready?: Promise<void>;

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string
  ): ReturnType<ThrottlerStorage['increment']> {
    this.ready ??= ensurePgOnlySchema(...DDL).then(() =>
      sweepHourly(
        `DELETE FROM pgonly.throttle_hits
         WHERE expires_at <= now()
           AND (blocked_until IS NULL OR blocked_until <= now())`
      )
    );
    await this.ready;
    const { rows } = await getPgPool().query(INCREMENT, [
      `${key}:${throttlerName}`,
      ttl,
      limit,
      blockDuration,
    ]);
    const row = rows[0];
    return {
      totalHits: row.hits,
      timeToExpire: Math.ceil(Number(row.ms_to_expire) / 1000),
      isBlocked: row.is_blocked,
      timeToBlockExpire: Math.ceil(Number(row.ms_to_block_expire) / 1000),
    };
  }
}
