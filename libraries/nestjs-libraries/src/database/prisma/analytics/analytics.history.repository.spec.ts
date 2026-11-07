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
