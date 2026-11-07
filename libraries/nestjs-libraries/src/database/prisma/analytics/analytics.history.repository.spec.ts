import { execFileSync } from 'node:child_process';
import { expect, test } from 'vite-plus/test';
import { AnalyticsHistoryRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.history.repository';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { getPgPool } from '@gitroom/nestjs-libraries/pg/pg.pool';

const history = new AnalyticsHistoryRepository();
const unique = (name: string) => `${name}:${Date.now()}:${Math.random()}`;

const metric = (
  key: string | undefined,
  data: AnalyticsData['data']
): AnalyticsData => ({
  key,
  label: key ?? 'unkeyed',
  percentageChange: 0,
  data,
});

const stored = async (integrationId: string) =>
  (
    await getPgPool().query(
      `SELECT metric, day::text AS day, kind, value FROM pgonly.channel_metrics
       WHERE integration_id = $1 ORDER BY metric, day`,
      [integrationId]
    )
  ).rows;

test('prisma db push, run at every boot, leaves channel_metrics a hypertable with its rows', async () => {
  const integrationId = unique('push');
  await history.saveMetrics('org', integrationId, 'day', [
    metric('followers', [{ total: '10', date: '2026-01-01' }]),
  ]);

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

  expect(await stored(integrationId)).toEqual([
    { metric: 'followers', day: '2026-01-01', kind: 'day', value: 10 },
  ]);
  const { rows } = await getPgPool().query(
    `SELECT 1 FROM timescaledb_information.hypertables
     WHERE hypertable_schema = 'pgonly' AND hypertable_name = 'channel_metrics'`
  );
  expect(rows).toHaveLength(1);
});

test('saving a channel metric day again keeps one row with the newer value, and skips points it cannot store', async () => {
  const integrationId = unique('upsert');

  await history.saveMetrics('org', integrationId, 'day', [
    metric('impressions', [
      { total: '5', date: '2026-02-01' },
      { total: '7', date: '2026-02-02' },
    ]),
  ]);
  const count = await history.saveMetrics('org', integrationId, 'day', [
    metric('impressions', [{ total: '9', date: '2026-02-02' }]),
    metric(undefined, [{ total: '1', date: '2026-02-02' }]),
    metric('not_in_the_catalogue', [{ total: '1', date: '2026-02-02' }]),
    metric('likes', [
      { total: 'abc', date: '2026-02-02' },
      { total: '', date: '2026-02-03' },
      { total: '  ', date: '2026-02-04' },
      { total: '3', date: '2026-02-30' },
      { total: '3', date: '2026-13-01' },
      { total: '3', date: 'yesterday' },
    ]),
  ]);

  expect(count).toBe(1);
  expect(await stored(integrationId)).toEqual([
    { metric: 'impressions', day: '2026-02-01', kind: 'day', value: 5 },
    { metric: 'impressions', day: '2026-02-02', kind: 'day', value: 9 },
  ]);
  expect(await history.hasMetrics(integrationId)).toBe(true);
  expect(await history.hasMetrics(unique('none'))).toBe(false);
});

test('history saved for one organization is not read by another one with the same channel id', async () => {
  const integrationId = unique('tenant');
  const range = { from: '2026-04-01', to: '2026-04-30' };
  await history.saveMetrics('org-a', integrationId, 'day', [
    metric('impressions', [{ total: '5', date: '2026-04-10' }]),
  ]);

  expect(
    await history.getSeries('org-b', integrationId, range, 'week')
  ).toEqual([]);
  expect(await history.getTotals('org-b', integrationId, range)).toEqual([]);
  expect(await history.getOldestDay('org-b', integrationId)).toBeUndefined();
  expect(
    (await history.getTotals('org-a', integrationId, range)).map(
      (row) => row.sum
    )
  ).toEqual([5]);
});

test('reading a post again at the same age keeps one row per metric with the newer value, and skips what it cannot store', async () => {
  const postId = unique('post');
  const read = (data: AnalyticsData[], age = 7) =>
    history.savePostMetrics('org', 'channel', postId, age, '2026-05-01', data);
  const point = (total: string, date = '2026-05-01') => ({ total, date });

  await read([metric('likes', [point('5')]), metric('shares', [point('2')])]);
  const count = await read([
    metric('likes', [point('3', '2026-04-30'), point('9')]),
    metric('comments', [point('abc'), point(' ')]),
    metric('followers', [{ ...point('1') }]),
    { ...metric('engagement_rate', [point('1')]), derived: true },
    metric('not_in_the_catalogue', [point('1')]),
    metric(undefined, [point('1')]),
  ]);
  await read([metric('likes', [point('1')])], 14);

  expect(count).toBe(2);
  expect(
    (await history.getPostMetrics('org', [postId], { age: 7 })).map((row) => [
      row.metric,
      row.value,
    ])
  ).toEqual([
    ['followers', 1],
    ['likes', 9],
    ['shares', 2],
  ]);
  expect(await history.getPostMetrics('other-org', [postId])).toEqual([]);
});
