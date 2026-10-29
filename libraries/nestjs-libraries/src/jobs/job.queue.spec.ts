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

  expect(res).toEqual({ cancelled: 2, created: true, deferred: false });
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

// The post's state lives in a table of the test, as the post row does in the app.
const stateTable = async () => {
  await getPgPool().query(
    `CREATE TABLE IF NOT EXISTS pgonly.test_post_state (
       post_id text PRIMARY KEY, state text NOT NULL)`
  );
};
const setState = (postId: string, state: string) =>
  getPgPool().query(
    `INSERT INTO pgonly.test_post_state (post_id, state) VALUES ($1, $2)
     ON CONFLICT (post_id) DO UPDATE SET state = $2`,
    [postId, state]
  );
const stateOf = async (postId: string) =>
  (
    await getPgPool().query(
      'SELECT state FROM pgonly.test_post_state WHERE post_id = $1',
      [postId]
    )
  ).rows[0]?.state as string;

const activeOf = async (postId: string) =>
  (
    await getPgPool().query(
      `SELECT id, kind, dedupe_key, run_at FROM pgonly.jobs
       WHERE post_id = $1 AND status IN ('pending','running') ORDER BY id`,
      [postId]
    )
  ).rows;

test('an edit while a job of the post is in flight is queued behind it and runs once it ends', async () => {
  const q = uniqueName('inflight');
  const postId = `post-${q}`;
  await stateTable();
  await setState(postId, 'QUEUE');
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let inFlight = false;
  const published: number[] = [];
  const looks: number[] = [];

  await startWorker(q, (w) =>
    w
      // the chain in flight: a comment that has not reached the platform yet
      .register('post.comment', async () => {
        inFlight = true;
        await hold;
      })
      // the new publish, written the way the real handler uses the queue
      .register('post.publish', async (job) => {
        const again = {
          kind: 'post.publish',
          payload: {},
          opts: {
            queue: q,
            postId,
            dedupeKey: job.dedupeKey!,
            runAt: new Date(Date.now() + 100),
          },
        };
        if (await queue.isPostBusy(job, 0)) {
          looks.push(job.id);
          return { next: [again] };
        }
        if ((await stateOf(postId)) !== 'QUEUE') {
          return;
        }
        const took = await queue.takeOverPost(job, 0);
        if (!took.taken) {
          return { next: [again] };
        }
        await markStarted();
        published.push(job.id);
        await setState(postId, 'PUBLISHED');
      })
  );
  const flying = await queue.enqueue(
    'post.comment',
    {},
    { queue: q, postId, dedupeKey: `post:${postId}` }
  );
  await vi.waitFor(() => expect(inFlight).toBe(true));

  const runAt = new Date(Date.now() + 50);
  const res = await queue.reschedulePost(postId, {
    kind: 'post.publish',
    payload: {},
    opts: { queue: q, dedupeKey: `post:${postId}`, runAt },
  });

  expect(res).toEqual({ cancelled: 0, created: true, deferred: true });
  const active = await activeOf(postId);
  expect(active.map((r) => r.dedupe_key)).toEqual([
    `post:${postId}`,
    `post:${postId}:next`,
  ]);
  expect(active[1].run_at.getTime()).toBe(runAt.getTime());
  // the new publish looks at the post again and again, and does nothing
  await vi.waitFor(() => expect(looks.length).toBeGreaterThanOrEqual(3));
  expect(published).toEqual([]);
  expect(await status(flying.id)).toBe('running');

  release();
  await vi.waitFor(() => expect(published).toHaveLength(1));
  expect(await stateOf(postId)).toBe('PUBLISHED');
  // it took the post's normal key over, so everything that looks for the
  // post's job finds it
  expect((await row(published[0])).dedupe_key).toBe(`post:${postId}`);
});

const advisoryWaiters = async (postId: string) =>
  (
    await getPgPool().query(
      `SELECT count(*)::int AS n FROM pg_locks
       WHERE locktype = 'advisory' AND NOT granted
         AND objid::bigint = (hashtext($1)::bigint & 4294967295)`,
      [`post:${postId}`]
    )
  ).rows[0].n as number;

// A job of a post completes with a follow-up at the old date while the owner
// reschedules the post. Both wait on the post's lock, held here, so that both
// orders can be driven; whichever goes first, the post ends with one job, at
// the new date.
test.each([
  ['the completion first', true],
  ['the reschedule first', false],
])(
  '%s: a follow-up never survives a reschedule',
  async (_name, completeFirst) => {
    const q = uniqueName('racecomplete');
    const postId = `post-${q}`;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let running = false;
    const oldDate = new Date(Date.now() + 3_600_000);
    const newDate = new Date(Date.now() + 7_200_000);

    await startWorker(q, (w) =>
      w
        .register('post.publish', async () => {
          running = true;
          await hold;
          // waits for its date: the same job, due at the old date
          return {
            next: [
              {
                kind: 'post.noop',
                payload: {},
                opts: {
                  queue: q,
                  postId,
                  dedupeKey: `post:${postId}`,
                  runAt: oldDate,
                },
              },
            ],
          };
        })
        .register('post.noop', async () => undefined)
    );
    const first = await queue.enqueue(
      'post.publish',
      {},
      { queue: q, postId, dedupeKey: `post:${postId}` }
    );
    await vi.waitFor(() => expect(running).toBe(true));

    const locker = await getPgPool().connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `post:${postId}`,
      ]);

      const reschedule = () =>
        queue.reschedulePost(postId, {
          kind: 'post.noop',
          payload: {},
          opts: { queue: q, dedupeKey: `post:${postId}`, runAt: newDate },
        });
      const finish = async () => {
        release();
        await vi.waitFor(async () =>
          expect(await advisoryWaiters(postId)).toBeGreaterThanOrEqual(1)
        );
      };

      let rescheduled: Promise<unknown>;
      if (completeFirst) {
        await finish();
        rescheduled = reschedule();
        await vi.waitFor(async () =>
          expect(await advisoryWaiters(postId)).toBe(2)
        );
      } else {
        rescheduled = reschedule();
        await vi.waitFor(async () =>
          expect(await advisoryWaiters(postId)).toBe(1)
        );
        await finish();
        await vi.waitFor(async () =>
          expect(await advisoryWaiters(postId)).toBe(2)
        );
      }
      await locker.query('COMMIT');
      await rescheduled;
    } finally {
      locker.release();
    }

    await vi.waitFor(async () =>
      expect(['done', 'cancelled']).toContain(await status(first.id))
    );
    const active = await activeOf(postId);
    expect(active).toHaveLength(1);
    expect(active[0].run_at.getTime()).toBe(newDate.getTime());
  }
);

test('a follow-up never survives a reschedule that races its completion', async () => {
  const q = uniqueName('racing');
  const oldDate = new Date(Date.now() + 3_600_000);
  const newDate = new Date(Date.now() + 7_200_000);
  const gates = new Map<string, () => void>();
  const running = new Set<string>();

  await startWorker(q, (w) =>
    w
      .register('post.publish', async (job) => {
        running.add(job.postId!);
        await new Promise<void>((resolve) => gates.set(job.postId!, resolve));
        return {
          next: [
            {
              kind: 'post.noop',
              payload: {},
              opts: {
                queue: q,
                postId: job.postId!,
                dedupeKey: `post:${job.postId}`,
                runAt: oldDate,
              },
            },
          ],
        };
      })
      .register('post.noop', async () => undefined)
  );

  for (let i = 0; i < 50; i++) {
    const postId = `post-${q}-${i}`;
    const first = await queue.enqueue(
      'post.publish',
      {},
      { queue: q, postId, dedupeKey: `post:${postId}` }
    );
    await vi.waitFor(() => expect(running.has(postId)).toBe(true));

    await Promise.all([
      Promise.resolve().then(() => gates.get(postId)!()),
      queue.reschedulePost(postId, {
        kind: 'post.noop',
        payload: {},
        opts: { queue: q, dedupeKey: `post:${postId}`, runAt: newDate },
      }),
    ]);
    await vi.waitFor(async () =>
      expect(['done', 'cancelled']).toContain(await status(first.id))
    );

    const active = await activeOf(postId);
    expect(active, `iteration ${i}`).toHaveLength(1);
    expect(active[0].run_at.getTime(), `iteration ${i}`).toBe(
      newDate.getTime()
    );
  }
});

test('classifyQueuedPosts publishes only posts whose publish never began', async () => {
  const q = uniqueName('classify');
  const begun = `post-${q}-begun`;
  const waiting = `post-${q}-waiting`;
  const past = new Date(Date.now() - 3_600_000);

  await startWorker(q, (w) =>
    w.register('post.publish', async (job) => {
      if (job.postId === begun) {
        await markStarted();
        // the outcome is never written to the post
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

  // the begun publish ended long ago: the 30 s settle window is not at issue
  await getPgPool().query(
    `UPDATE pgonly.jobs SET updated_at = now() - interval '5 minutes'
     WHERE id = $1`,
    [done.id]
  );
  const sorted = await queue.classifyQueuedPosts([
    { id: begun, publishDate: past },
    { id: waiting, publishDate: past },
    { id: 'none', publishDate: past },
  ]);

  expect(sorted.publish.sort()).toEqual([waiting, 'none'].sort());
  expect(sorted.unconfirmed).toEqual([begun]);
});

test('classifyQueuedPosts leaves a post whose publish is alive, settling or not due alone', async () => {
  const q = uniqueName('classifyalive');
  const alive = `post-${q}-alive`;
  const settling = `post-${q}-settling`;
  const notDue = `post-${q}-notdue`;
  const past = new Date(Date.now() - 3_600_000);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let running = false;

  await startWorker(q, (w) =>
    w.register('post.publish', async (job) => {
      await markStarted();
      if (job.postId === alive) {
        running = true;
        await hold;
      }
    })
  );
  await queue.enqueue('post.publish', {}, { queue: q, postId: alive });
  const ended = await queue.enqueue(
    'post.publish',
    {},
    { queue: q, postId: settling }
  );
  const later = await queue.enqueue(
    'post.publish',
    {},
    { queue: q, postId: notDue }
  );
  await vi.waitFor(async () => {
    expect(running).toBe(true);
    expect(await status(ended.id)).toBe('done');
    expect(await status(later.id)).toBe('done');
  });
  await getPgPool().query(
    `UPDATE pgonly.jobs SET updated_at = now() - interval '5 minutes'
     WHERE id = $1`,
    [later.id]
  );

  const sorted = await queue.classifyQueuedPosts([
    { id: alive, publishDate: past },
    { id: settling, publishDate: past },
    { id: notDue, publishDate: new Date(Date.now() + 3_600_000) },
  ]);

  expect(sorted).toEqual({ publish: [], unconfirmed: [] });
  release();
});

test('classifyQueuedPosts ignores publishes that an owner reschedule superseded', async () => {
  const q = uniqueName('superseded');
  const failedBefore = `post-${q}-failed`;
  const stillRunning = `post-${q}-running`;
  const past = new Date(Date.now() - 3_600_000);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let running = false;

  await startWorker(q, (w) =>
    w.register('post.publish', async (job) => {
      await markStarted();
      if (job.postId === stillRunning) {
        running = true;
        await hold;
        return;
      }
      throw new NonRetryable('the platform refused the post');
    })
  );
  const failed = await queue.enqueue(
    'post.publish',
    {},
    { queue: q, postId: failedBefore }
  );
  await queue.enqueue('post.publish', {}, { queue: q, postId: stillRunning });
  await vi.waitFor(async () => expect(await status(failed.id)).toBe('failed'));
  await vi.waitFor(() => expect(running).toBe(true));
  await getPgPool().query(
    `UPDATE pgonly.jobs SET updated_at = now() - interval '5 minutes'
     WHERE id = $1`,
    [failed.id]
  );
  const both = [
    { id: failedBefore, publishDate: past },
    { id: stillRunning, publishDate: past },
  ];
  expect(await queue.classifyQueuedPosts(both)).toEqual({
    publish: [],
    unconfirmed: [failedBefore],
  });

  // the owner fixes both posts and schedules them again
  await queue.reschedulePost(failedBefore);
  await queue.reschedulePost(stillRunning);

  // the failed publish no longer hides its post from the sweep; the one that
  // is still running keeps counting
  expect(await queue.classifyQueuedPosts(both)).toEqual({
    publish: [failedBefore],
    unconfirmed: [],
  });
  release();
});

test('an edit while a status check is pending leaves the check alone and publishes nothing beside it', async () => {
  const q = uniqueName('pendingcheck');
  const postId = `post-${q}`;
  const published: number[] = [];
  const checks: number[] = [];
  let activeAtPublish: string[] = [];

  await startWorker(q, (w) =>
    w
      // polls every 50 ms, like the real check every 20 s
      .register('post.checkStatus', async (job) => {
        checks.push(job.id);
        return checks.length < 6
          ? {
              next: [
                {
                  kind: 'post.checkStatus',
                  payload: {},
                  opts: {
                    queue: q,
                    postId,
                    dedupeKey: job.dedupeKey!,
                    runAt: new Date(Date.now() + 50),
                  },
                },
              ],
            }
          : undefined;
      })
      .register('post.publish', async (job) => {
        if (await queue.isPostBusy(job, 0)) {
          return { retryAt: new Date(Date.now() + 30) };
        }
        activeAtPublish = (await activeOf(postId))
          .filter((r) => r.id !== String(job.id))
          .map((r) => r.kind);
        const took = await queue.takeOverPost(job, 0);
        if (took.taken) {
          published.push(job.id);
        }
      })
  );
  // a check that waits for its next poll, hours in the future
  await queue.enqueue(
    'post.checkStatus',
    {},
    {
      queue: q,
      postId,
      dedupeKey: `post:${postId}`,
      runAt: new Date(Date.now() + 3_600_000),
    }
  );

  // a draft switch must not cancel the check
  expect(await queue.reschedulePost(postId)).toEqual({
    cancelled: 0,
    created: false,
    deferred: false,
  });
  expect((await activeOf(postId)).map((r) => r.kind)).toEqual([
    'post.checkStatus',
  ]);

  const res = await queue.reschedulePost(postId, {
    kind: 'post.publish',
    payload: {},
    opts: { queue: q, dedupeKey: `post:${postId}` },
  });

  // the check is not cancelled; the edit waits behind it under its own key
  expect(res).toEqual({ cancelled: 0, created: true, deferred: true });
  expect((await activeOf(postId)).map((r) => r.dedupe_key)).toEqual([
    `post:${postId}`,
    `post:${postId}:next`,
  ]);
  expect(await queue.isPostBusy({ id: 0, postId })).toBe(true);

  // the check is due: it polls through to its end while the edit waits
  await getPgPool().query(
    `UPDATE pgonly.jobs SET run_at = now() WHERE post_id = $1 AND kind = 'post.checkStatus'`,
    [postId]
  );
  await vi.waitFor(() => expect(checks).toHaveLength(6));
  await vi.waitFor(() => expect(published).toHaveLength(1));
  // no second publish was runnable while the check was alive
  expect(activeAtPublish).toEqual([]);
});

test('an edit that waits behind a busy post stays one row and uses no attempts', async () => {
  const q = uniqueName('onerow');
  const postId = `post-${q}`;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let inFlight = false;
  const looks: number[] = [];
  let took = false;

  await startWorker(q, (w) =>
    w
      .register('post.comment', async () => {
        inFlight = true;
        await hold;
      })
      .register('post.publish', async (job) => {
        if (await queue.isPostBusy(job, 0)) {
          looks.push(job.attempts);
          return { retryAt: new Date(Date.now() + 20) };
        }
        took = (await queue.takeOverPost(job, 0)).taken;
      })
  );
  await queue.enqueue(
    'post.comment',
    {},
    { queue: q, postId, dedupeKey: `post:${postId}` }
  );
  await vi.waitFor(() => expect(inFlight).toBe(true));
  await queue.reschedulePost(postId, {
    kind: 'post.publish',
    payload: {},
    opts: { queue: q, dedupeKey: `post:${postId}` },
  });

  await vi.waitFor(() => expect(looks.length).toBeGreaterThanOrEqual(8));
  const rows = await getPgPool().query(
    `SELECT id, attempts, status FROM pgonly.jobs
     WHERE post_id = $1 AND kind = 'post.publish'`,
    [postId]
  );
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0].status).toMatch(/pending|running/);
  expect(new Set(looks)).toEqual(new Set([1]));

  release();
  await vi.waitFor(() => expect(took).toBe(true));
  expect((await row(rows.rows[0].id)).attempts).toBe(1);
});

test('an edit is not applied when the earlier publish never wrote its outcome', async () => {
  const q = uniqueName('unconfirmed');
  const postId = `post-${q}`;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let inFlight = false;
  let answer: unknown;

  await startWorker(q, (w) =>
    w
      // the publish in flight: its provider call began, and its end leaves the
      // post as it was (the write of the outcome was lost)
      .register('post.publish', async (job) => {
        if (job.dedupeKey === `post:${postId}:next`) {
          if (await queue.isPostBusy(job, 0)) {
            return { retryAt: new Date(Date.now() + 20) };
          }
          answer = await queue.takeOverPost(job, 0);
          return;
        }
        await markStarted();
        inFlight = true;
        await hold;
      })
  );
  await queue.enqueue(
    'post.publish',
    {},
    { queue: q, postId, dedupeKey: `post:${postId}` }
  );
  await vi.waitFor(() => expect(inFlight).toBe(true));
  await queue.reschedulePost(postId, {
    kind: 'post.publish',
    payload: {},
    opts: { queue: q, dedupeKey: `post:${postId}` },
  });

  release();
  await vi.waitFor(() =>
    expect(answer).toEqual({ taken: false, unconfirmed: true })
  );
  // nothing was taken over: no job holds the post's key
  expect(await queue.findActive(`post:${postId}`)).toBeUndefined();
});

test('taking a post over marks its finished rows superseded', async () => {
  const q = uniqueName('takesupersede');
  const postId = `post-${q}`;
  let answer: unknown;

  await startWorker(q, (w) =>
    w
      .register('post.comment', async () => undefined)
      .register('post.publish', async (job) => {
        answer = await queue.takeOverPost(job, 0);
      })
  );
  const comment = await queue.enqueue(
    'post.comment',
    {},
    { queue: q, postId, dedupeKey: `post:${postId}` }
  );
  await vi.waitFor(async () => expect(await status(comment.id)).toBe('done'));
  await getPgPool().query(
    'UPDATE pgonly.jobs SET started_at = now() WHERE id = $1',
    [comment.id]
  );
  // created after the comment ended, so the comment is not "newer" than it
  await queue.enqueue(
    'post.publish',
    {},
    { queue: q, postId, dedupeKey: `post:${postId}:next` }
  );

  await vi.waitFor(() =>
    expect(answer).toEqual({ taken: true, dedupeKey: `post:${postId}` })
  );
  expect((await row(comment.id)).superseded).toBe(true);
});
