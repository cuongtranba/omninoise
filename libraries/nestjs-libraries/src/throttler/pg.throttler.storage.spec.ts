import { expect, test, vi } from 'vitest';
import { PgThrottlerStorage } from '@gitroom/nestjs-libraries/throttler/pg.throttler.storage';

test('the hit after the limit is blocked and a new window starts counting again', async () => {
  const storage = new PgThrottlerStorage();
  const key = `throttle:${Date.now()}:${Math.random()}`;
  const ttl = 1000;
  const limit = 3;

  for (let hit = 1; hit <= limit; hit++) {
    const record = await storage.increment(key, ttl, limit, ttl, 'default');
    expect(record).toMatchObject({ totalHits: hit, isBlocked: false });
  }
  expect(await storage.increment(key, ttl, limit, ttl, 'default')).toMatchObject(
    { totalHits: limit + 1, isBlocked: true }
  );

  // Block and window both last one second, so both lapse together.
  await vi.waitFor(
    async () => {
      expect(
        await storage.increment(key, ttl, limit, ttl, 'default')
      ).toMatchObject({ totalHits: 1, isBlocked: false });
    },
    { timeout: 5000, interval: 200 }
  );
});
