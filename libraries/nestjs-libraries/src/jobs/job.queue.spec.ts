import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { JobQueueService } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { JobWorker } from '@gitroom/nestjs-libraries/jobs/job.worker';
import { markStarted } from '@gitroom/nestjs-libraries/jobs/job.context';
import {
  isJobNotOwned,
  NonRetryable,
} from '@gitroom/nestjs-libraries/jobs/job.errors';
import { getPgPool } from '@gitroom/nestjs-libraries/pg/pg.pool';

const queue = new JobQueueService();
const workers: JobWorker[] = [];

// Fast timings so lease expiry and polling are observable in a test run.
const startWorker = async (
  name: string,
  setup: (w: JobWorker) => void,
  extra: Partial<ConstructorParameters<typeof JobWorker>[0]> = {},
  concurrency = 10
) => {
  const worker = new JobWorker({
    queues: [{ name, concurrency }],
    pollIntervalMs: 50,
    reapIntervalMs: 100,
    ...extra,
  });
  setup(worker);
  workers.push(worker);
  await worker.start();
  return worker;
};

const status = async (id: number) => (await queue.get(id))?.status;
const row = async (id: number) =>
  (await getPgPool().query('SELECT * FROM pgonly.jobs WHERE id = $1', [id]))
    .rows[0];

let seq = 0;
const uniqueName = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

beforeEach(async () => {
  await queue.ready();
});

afterAll(async () => {
  await Promise.all(workers.map((w) => w.stop(0)));
});

test('two workers on one queue never run the same job', async () => {
  const q = uniqueName('race');
  const handled: number[] = [];
  const handler = async (job: { id: number }) => {
    handled.push(job.id);
  };
  const ids: number[] = [];
  for (let i = 0; i < 50; i++) {
    ids.push((await queue.enqueue('race', { i }, { queue: q })).id);
  }

  await startWorker(q, (w) => w.register('race', handler));
  await startWorker(q, (w) => w.register('race', handler));

  await vi.waitFor(async () => {
    const done = await getPgPool().query(
      `SELECT count(*)::int AS n FROM pgonly.jobs
       WHERE queue = $1 AND status = 'done'`,
      [q]
    );
    expect(done.rows[0].n).toBe(50);
  });
  expect([...handled].sort((a, b) => a - b)).toEqual(ids);
});

test('a job whose lease expired before it started is reclaimed and runs again', async () => {
  const q = uniqueName('reclaim');
  let runs = 0;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));

  // The lease is shorter than the first run and never extended in time.
  await startWorker(
    q,
    (w) =>
      w.register('reclaim', async () => {
        runs++;
        if (runs === 1) {
          await hold;
        }
      }),
    { leaseMs: 200, leaseExtendMs: 60_000 }
  );
  const { id } = await queue.enqueue('reclaim', {}, { queue: q });

  await vi.waitFor(async () => {
    expect(await status(id)).toBe('done');
  });
  expect(runs).toBe(2);
  expect((await row(id)).attempts).toBe(2);
  release();
});

test('a job that called markStarted and lost its lease is not run again', async () => {
  const q = uniqueName('started');
  let runs = 0;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));

  await startWorker(
    q,
    (w) =>
      w.register('started', async () => {
        runs++;
        await markStarted();
        await hold;
      }),
    { leaseMs: 200, leaseExtendMs: 60_000 }
  );
  const { id } = await queue.enqueue('started', {}, { queue: q });

  await vi.waitFor(async () => {
    expect(await status(id)).toBe('failed');
  });
  release();
  // Let the abandoned handler finish: it must not resurrect the job.
  await vi.waitFor(async () => {
    expect(await status(id)).toBe('failed');
  });
  expect(runs).toBe(1);
});

test('replace leaves one active job with the new run_at, keep leaves the original', async () => {
  const q = uniqueName('dedupe');
  const first = new Date(Date.now() + 3_600_000);
  const second = new Date(Date.now() + 7_200_000);

  const a = await queue.enqueue(
    'noop',
    { v: 1 },
    {
      queue: q,
      dedupeKey: `${q}:keep`,
      runAt: first,
    }
  );
  const kept = await queue.enqueue(
    'noop',
    { v: 2 },
    {
      queue: q,
      dedupeKey: `${q}:keep`,
      runAt: second,
      mode: 'keep',
    }
  );
  expect(kept).toEqual({ id: a.id, created: false });
  expect((await row(a.id)).run_at.getTime()).toBe(first.getTime());

  const b = await queue.enqueue(
    'noop',
    { v: 1 },
    {
      queue: q,
      dedupeKey: `${q}:replace`,
      runAt: first,
    }
  );
  const c = await queue.enqueue(
    'noop',
    { v: 2 },
    {
      queue: q,
      dedupeKey: `${q}:replace`,
      runAt: second,
      mode: 'replace',
    }
  );
  expect(c.id).not.toBe(b.id);
  expect(await status(b.id)).toBe('cancelled');
  const active = await getPgPool().query(
    `SELECT id, run_at FROM pgonly.jobs
     WHERE dedupe_key = $1 AND status IN ('pending','running')`,
    [`${q}:replace`]
  );
  expect(active.rows).toHaveLength(1);
  expect(active.rows[0].run_at.getTime()).toBe(second.getTime());
});

test('cancelByPost cancels the post job and its repeat child', async () => {
  const q = uniqueName('cancel');
  const postId = `post-${q}`;
  const parent = await queue.enqueue(
    'noop',
    {},
    {
      queue: q,
      postId,
      dedupeKey: `post:${postId}`,
      runAt: new Date(Date.now() + 3_600_000),
    }
  );
  const child = await queue.enqueue(
    'noop',
    {},
    {
      queue: q,
      postId,
      dedupeKey: `post:${postId}:abc`,
      runAt: new Date(Date.now() + 7_200_000),
    }
  );
  const other = await queue.enqueue(
    'noop',
    {},
    {
      queue: q,
      postId: `${postId}-other`,
      runAt: new Date(Date.now() + 3_600_000),
    }
  );

  await queue.cancelByPost(postId);

  expect(await status(parent.id)).toBe('cancelled');
  expect(await status(child.id)).toBe('cancelled');
  expect(await status(other.id)).toBe('pending');
});

test('a queue with concurrency 1 never runs two jobs at once', async () => {
  const q = uniqueName('serial');
  let active = 0;
  let peak = 0;
  await startWorker(
    q,
    (w) =>
      w.register('serial', async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active--;
      }),
    {},
    1
  );
  for (let i = 0; i < 8; i++) {
    await queue.enqueue('serial', {}, { queue: q });
  }

  await vi.waitFor(async () => {
    const done = await getPgPool().query(
      `SELECT count(*)::int AS n FROM pgonly.jobs
       WHERE queue = $1 AND status = 'done'`,
      [q]
    );
    expect(done.rows[0].n).toBe(8);
  });
  expect(peak).toBe(1);
});

test('a job with a future run_at does not run before it is due', async () => {
  const q = uniqueName('future');
  let ranAt = 0;
  await startWorker(q, (w) =>
    w.register('future', async () => {
      ranAt = Date.now();
    })
  );
  const dueAt = Date.now() + 1_500;
  const { id } = await queue.enqueue(
    'future',
    {},
    {
      queue: q,
      runAt: new Date(dueAt),
    }
  );

  expect(await status(id)).toBe('pending');
  await vi.waitFor(
    async () => {
      expect(await status(id)).toBe('done');
    },
    { timeout: 10_000 }
  );
  expect(ranAt).toBeGreaterThanOrEqual(dueAt - 5);
});

test('a handler that throws twice then succeeds ends done after 3 attempts', async () => {
  const q = uniqueName('retry');
  let calls = 0;
  await startWorker(q, (w) =>
    w.register('retry', async () => {
      if (++calls < 3) {
        throw new Error('boom');
      }
      return { result: { ok: true } };
    })
  );
  const { id } = await queue.enqueue(
    'retry',
    {},
    {
      queue: q,
      maxAttempts: 3,
      retryDelayMs: 20,
    }
  );

  await vi.waitFor(async () => {
    expect(await status(id)).toBe('done');
  });
  expect((await row(id)).attempts).toBe(3);
  expect((await queue.get(id))?.result).toEqual({ ok: true });
});

test('a NonRetryable error fails the job after one attempt and runs its cleanup', async () => {
  const q = uniqueName('nonretry');
  const cleaned: string[] = [];
  await startWorker(q, (w) =>
    w.register(
      'nonretry',
      async () => {
        throw new NonRetryable('rejected by the platform', 'bad_body');
      },
      { onFailed: async (_job, error) => void cleaned.push(error) }
    )
  );
  const { id } = await queue.enqueue(
    'nonretry',
    {},
    {
      queue: q,
      maxAttempts: 3,
      retryDelayMs: 20,
    }
  );

  await vi.waitFor(async () => {
    expect(await status(id)).toBe('failed');
  });
  expect((await row(id)).attempts).toBe(1);
  await vi.waitFor(() => expect(cleaned).toEqual(['rejected by the platform']));
});

test('a handler can return a follow-up job that then runs', async () => {
  const q = uniqueName('chain');
  const seen: string[] = [];
  await startWorker(q, (w) =>
    w
      .register('first', async () => {
        seen.push('first');
        return { next: [{ kind: 'second', opts: { queue: q } }] };
      })
      .register('second', async () => void seen.push('second'))
  );
  await queue.enqueue('first', {}, { queue: q });

  await vi.waitFor(() => expect(seen).toEqual(['first', 'second']));
});

test('a job cancelled while its handler runs is refused at markStarted and runs no cleanup', async () => {
  const q = uniqueName('notowned');
  const postId = `post-${q}`;
  const cleaned: string[] = [];
  let refusal: unknown;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let entered = false;

  const worker = await startWorker(q, (w) =>
    w.register(
      'notowned',
      async () => {
        entered = true;
        await hold;
        try {
          await markStarted();
        } catch (err) {
          refusal = err;
          throw err;
        }
      },
      { onFailed: async (_job, error) => void cleaned.push(error) }
    )
  );
  const { id } = await queue.enqueue('notowned', {}, { queue: q, postId });
  await vi.waitFor(() => expect(entered).toBe(true));

  // the owner edits the post: its job is cancelled while the handler works
  await queue.cancelByPost(postId);
  release();

  await vi.waitFor(() => expect(worker.runningCount()).toBe(0));
  expect(isJobNotOwned(refusal)).toBe(true);
  expect(await status(id)).toBe('cancelled');
  expect(cleaned).toEqual([]);
});

test('reschedulePost leaves exactly one active job for the post', async () => {
  const q = uniqueName('resched');
  const postId = `post-${q}`;
  const publish = (runAt: Date) => ({
    kind: 'noop',
    payload: {},
    opts: { queue: q, dedupeKey: `post:${postId}`, runAt },
  });
  const old = await queue.enqueue(
    'noop',
    {},
    {
      queue: q,
      postId,
      dedupeKey: `post:${postId}`,
      runAt: new Date(Date.now() + 3_600_000),
    }
  );
  const child = await queue.enqueue(
    'noop',
    {},
    {
      queue: q,
      postId,
      dedupeKey: `post:${postId}:abc`,
      runAt: new Date(Date.now() + 7_200_000),
    }
  );

  const second = new Date(Date.now() + 10_800_000);
  const res = await queue.reschedulePost(postId, publish(second));

  expect(res).toEqual({ cancelled: 2, created: true });
  expect(await status(old.id)).toBe('cancelled');
  expect(await status(child.id)).toBe('cancelled');
  const active = await getPgPool().query(
    `SELECT run_at FROM pgonly.jobs
     WHERE post_id = $1 AND status IN ('pending','running')`,
    [postId]
  );
  expect(active.rows).toHaveLength(1);
  expect(active.rows[0].run_at.getTime()).toBe(second.getTime());
});

test('reschedulePost does not cancel a publish in flight nor create a second one', async () => {
  const q = uniqueName('inflight');
  const postId = `post-${q}`;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let started = false;

  await startWorker(q, (w) =>
    w.register('inflight', async () => {
      await markStarted();
      started = true;
      await hold;
    })
  );
  const { id } = await queue.enqueue(
    'inflight',
    {},
    { queue: q, postId, dedupeKey: `post:${postId}` }
  );
  await vi.waitFor(() => expect(started).toBe(true));

  const res = await queue.reschedulePost(postId, {
    kind: 'inflight',
    payload: {},
    opts: { queue: q, dedupeKey: `post:${postId}` },
  });

  expect(res).toEqual({ cancelled: 0, created: false });
  expect(await status(id)).toBe('running');
  const active = await getPgPool().query(
    `SELECT id FROM pgonly.jobs
     WHERE post_id = $1 AND status IN ('pending','running')`,
    [postId]
  );
  expect(active.rows.map((r) => Number(r.id))).toEqual([id]);

  release();
  await vi.waitFor(async () => expect(await status(id)).toBe('done'));
});

test('startedPublishPostIds reports the posts whose publish began, in any status', async () => {
  const q = uniqueName('startedpub');
  const begun = `post-${q}-begun`;
  const waiting = `post-${q}-waiting`;

  await startWorker(q, (w) =>
    w.register('post.publish', async (job) => {
      if (job.postId === begun) {
        await markStarted();
      }
    })
  );
  const done = await queue.enqueue(
    'post.publish',
    {},
    { queue: q, postId: begun }
  );
  await vi.waitFor(async () => expect(await status(done.id)).toBe('done'));
  await queue.enqueue(
    'post.publish',
    {},
    { queue: q, postId: waiting, runAt: new Date(Date.now() + 3_600_000) }
  );

  const started = await queue.startedPublishPostIds([begun, waiting, 'none']);

  expect([...started]).toEqual([begun]);
});
