import { execFileSync } from 'node:child_process';
import { expect, test, vi } from 'vitest';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { getPgPool } from '@gitroom/nestjs-libraries/pg/pg.pool';

const unique = (name: string) => `${name}:${Date.now()}:${Math.random()}`;

test('set NX is refused while the key is live and succeeds once it has expired', async () => {
  const key = unique('nx');
  expect(await ioRedis.set(key, '1', 'EX', 1, 'NX')).toBe('OK');
  expect(await ioRedis.set(key, '2', 'EX', 1, 'NX')).toBeNull();
  await vi.waitFor(
    async () => {
      expect(await ioRedis.set(key, '3', 'EX', 5, 'NX')).toBe('OK');
    },
    { timeout: 5000, interval: 100 }
  );
  expect(await ioRedis.get(key)).toBe('3');
});

test('an expired key reads as null', async () => {
  const key = unique('ttl');
  await ioRedis.set(key, 'v', 'EX', 1);
  expect(await ioRedis.get(key)).toBe('v');
  await vi.waitFor(async () => expect(await ioRedis.get(key)).toBeNull(), {
    timeout: 5000,
    interval: 100,
  });
});

test('rpush then lrange returns the items in order', async () => {
  const key = unique('list');
  expect(await ioRedis.rpush(key, 'a')).toBe(1);
  expect(await ioRedis.rpush(key, 'b')).toBe(2);
  await ioRedis.rpush(key, 'c');
  expect(await ioRedis.lrange(key, 0, -1)).toEqual(['a', 'b', 'c']);
});

test('prisma db push, run at every boot, leaves the pgonly tables intact', async () => {
  const key = unique('survives');
  await ioRedis.set(key, 'kept', 'EX', 600);

  execFileSync(
    'node_modules/.bin/prisma',
    [
      'db',
      'push',
      '--skip-generate',
      '--schema',
      'libraries/nestjs-libraries/src/database/prisma/schema.prisma',
    ],
    { env: process.env, stdio: 'pipe' }
  );

  expect(await ioRedis.get(key)).toBe('kept');
  const { rows } = await getPgPool().query(
    `SELECT relpersistence FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'pgonly' AND c.relname = 'kv_store'`
  );
  expect(rows).toEqual([{ relpersistence: 'u' }]);
});
