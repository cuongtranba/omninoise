import { Injectable } from '@nestjs/common';
import {
  ensurePgOnlySchema,
  getPgPool,
} from '@gitroom/nestjs-libraries/pg/pg.pool';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  analyticsMetrics,
  AnalyticsGrain,
} from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';

// One row per channel, metric and day: a TimescaleDB hypertable in `pgonly`,
// because `prisma db push` drops the tables it does not know in `public`.
// Chunks older than 180 days are compressed (segmented by channel and metric).
// `kind` says what `value` is: 'day' is what the platform reports for that day
// (the day's amount, or the reading of a stock like followers), 'total' is a
// running total read that day (platforms that only serve current totals).
const DDL = [
  `CREATE EXTENSION IF NOT EXISTS timescaledb`,
  `CREATE TABLE IF NOT EXISTS pgonly.channel_metrics (
    organization_id text NOT NULL,
    integration_id text NOT NULL,
    metric text NOT NULL,
    day date NOT NULL,
    kind text NOT NULL CHECK (kind IN ('day', 'total')),
    value double precision NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (integration_id, metric, day)
  )`,
  `SELECT create_hypertable(
    'pgonly.channel_metrics',
    by_range('day', INTERVAL '3 months'),
    if_not_exists => true
  )`,
  `CREATE INDEX IF NOT EXISTS channel_metrics_org_metric_day_idx
    ON pgonly.channel_metrics (organization_id, metric, day DESC)`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM timescaledb_information.hypertable_columnstore_settings
      WHERE hypertable = 'pgonly.channel_metrics'::regclass
        AND segmentby IS NOT NULL
    ) THEN
      ALTER TABLE pgonly.channel_metrics SET (
        timescaledb.enable_columnstore,
        timescaledb.segmentby = 'integration_id, metric',
        timescaledb.orderby = 'day'
      );
    END IF;
  END $$`,
  `CALL add_columnstore_policy(
    'pgonly.channel_metrics',
    after => INTERVAL '180 days',
    if_not_exists => true
  )`,
  // One row per post, metric and age: the lifetime reading of the post
  // `age_days` days after it was published, taken on `captured_on`. A
  // hypertable cannot have a unique key without its time column, so the key
  // holds captured_on too (it is the publish day plus the age, so reading the
  // same age again is the same row).
  `CREATE TABLE IF NOT EXISTS pgonly.post_metrics (
    organization_id text NOT NULL,
    integration_id text NOT NULL,
    post_id text NOT NULL,
    metric text NOT NULL,
    age_days int NOT NULL,
    captured_on date NOT NULL,
    value double precision NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, metric, age_days, captured_on)
  )`,
  `SELECT create_hypertable(
    'pgonly.post_metrics',
    by_range('captured_on', INTERVAL '3 months'),
    if_not_exists => true
  )`,
  `CREATE INDEX IF NOT EXISTS post_metrics_org_captured_on_idx
    ON pgonly.post_metrics (organization_id, captured_on DESC)`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM timescaledb_information.hypertable_columnstore_settings
      WHERE hypertable = 'pgonly.post_metrics'::regclass
        AND segmentby IS NOT NULL
    ) THEN
      ALTER TABLE pgonly.post_metrics SET (
        timescaledb.enable_columnstore,
        timescaledb.segmentby = 'integration_id',
        timescaledb.orderby = 'captured_on'
      );
    END IF;
  END $$`,
  `CALL add_columnstore_policy(
    'pgonly.post_metrics',
    after => INTERVAL '180 days',
    if_not_exists => true
  )`,
];

export type ChannelMetricKind = 'day' | 'total';

// What the days of a metric add up to: their sum, average and latest reading
export interface ChannelMetricStats {
  metric: string;
  kind: ChannelMetricKind;
  sum: number;
  avg: number;
  last: number;
  count: number;
}

export interface ChannelMetricBucket extends ChannelMetricStats {
  bucket: string; // First day of the bucket, YYYY-MM-DD
}

export interface ChannelMetricRange {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
}

const STATS = `sum(value) AS sum, avg(value) AS avg, last(value, day) AS last, count(*)::int AS count`;

// Both the organization and the channel are always filtered: a channel id
// alone must never read another organization's rows
const IN_RANGE = `organization_id = $1 AND integration_id = $2
  AND day BETWEEN $3::date AND $4::date
  AND ($5::text[] IS NULL OR metric = ANY($5::text[]))`;

const BUCKET_SIZE: Record<AnalyticsGrain, string> = {
  day: '1 day',
  week: '1 week',
  month: '1 month',
};

const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar day: `2026-02-30` rolls over and `2026-13-01` is invalid
const isDay = (value: string) => {
  const time = DAY_FORMAT.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  return (
    !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
  );
};

// A missing or blank total is not a zero
const toValue = (total: string | null | undefined) =>
  total == null || String(total).trim() === '' ? NaN : Number(total);

// Only the metrics of the catalogue are stored; a derived metric is a figure
// computed from the others, not a reading of the platform
const isStorable = (item: AnalyticsData) =>
  !!item.key && !!analyticsMetrics[item.key] && !item.derived;

// What the stored readings of a post say about one metric at one age
export interface PostMetricReading {
  post_id: string;
  metric: string;
  age_days: number;
  captured_on: string; // YYYY-MM-DD
  value: number;
}

@Injectable()
export class AnalyticsHistoryRepository {
  private ready?: Promise<void>;

  private async pool() {
    // A failed setup is not cached, so the next call retries it.
    this.ready ??= ensurePgOnlySchema(...DDL);
    await this.ready.catch((err) => {
      this.ready = undefined;
      throw err;
    });
    return getPgPool();
  }

  async hasMetrics(integrationId: string) {
    const { rows } = await (
      await this.pool()
    ).query(
      `SELECT 1 FROM pgonly.channel_metrics WHERE integration_id = $1 LIMIT 1`,
      [integrationId]
    );
    return rows.length > 0;
  }

  /**
   * Stores the daily points of the metrics in the catalogue. A point that is
   * stored again replaces the earlier value (platforms revise recent days).
   * Returns how many points were stored.
   */
  async saveMetrics(
    organizationId: string,
    integrationId: string,
    kind: ChannelMetricKind,
    data: AnalyticsData[]
  ) {
    // The last point wins, the upsert cannot touch a row twice
    const points = new Map<
      string,
      { metric: string; day: string; value: number }
    >();
    for (const item of data) {
      // A derived metric is a figure for the whole window, not for a day; the
      // history derives it again from the stored days
      if (!isStorable(item) || !item.key) {
        continue;
      }
      for (const point of item.data) {
        const value = toValue(point.total);
        if (!isDay(point.date) || !Number.isFinite(value)) {
          continue;
        }
        points.set(`${item.key}:${point.date}`, {
          metric: item.key,
          day: point.date,
          value,
        });
      }
    }

    if (points.size === 0) {
      return 0;
    }

    const rows = [...points.values()];
    await (
      await this.pool()
    ).query(
      `INSERT INTO pgonly.channel_metrics
        (organization_id, integration_id, kind, metric, day, value)
      SELECT $1, $2, $3, metric, day, value
      FROM unnest($4::text[], $5::date[], $6::double precision[])
        AS t(metric, day, value)
      ON CONFLICT (integration_id, metric, day) DO UPDATE SET
        value = EXCLUDED.value,
        kind = EXCLUDED.kind,
        fetched_at = now(),
        organization_id = EXCLUDED.organization_id`,
      [
        organizationId,
        integrationId,
        kind,
        rows.map((row) => row.metric),
        rows.map((row) => row.day),
        rows.map((row) => row.value),
      ]
    );
    return rows.length;
  }

  // The stored days of a channel in buckets of `grain` (weeks start on Monday,
  // months on the 1st). A bucket is named by its first day, which can be
  // before the start of the range.
  async getSeries(
    organizationId: string,
    integrationId: string,
    range: ChannelMetricRange,
    grain: AnalyticsGrain,
    metrics?: string[]
  ) {
    const { rows } = await (
      await this.pool()
    ).query<ChannelMetricBucket>(
      `SELECT metric, kind, time_bucket($6::interval, day)::text AS bucket, ${STATS}
      FROM pgonly.channel_metrics
      WHERE ${IN_RANGE}
      GROUP BY metric, kind, 3
      ORDER BY 3, metric`,
      [
        organizationId,
        integrationId,
        range.from,
        range.to,
        metrics?.length ? metrics : null,
        BUCKET_SIZE[grain],
      ]
    );
    return rows;
  }

  // The stored days of a channel over the whole range
  async getTotals(
    organizationId: string,
    integrationId: string,
    range: ChannelMetricRange,
    metrics?: string[]
  ) {
    const { rows } = await (
      await this.pool()
    ).query<ChannelMetricStats>(
      `SELECT metric, kind, ${STATS}
      FROM pgonly.channel_metrics
      WHERE ${IN_RANGE}
      GROUP BY metric, kind
      ORDER BY metric`,
      [
        organizationId,
        integrationId,
        range.from,
        range.to,
        metrics?.length ? metrics : null,
      ]
    );
    return rows;
  }

  // The first day stored for the channel, undefined when nothing is stored
  async getOldestDay(organizationId: string, integrationId: string) {
    const { rows } = await (
      await this.pool()
    ).query<{ day: string | null }>(
      `SELECT min(day)::text AS day FROM pgonly.channel_metrics
      WHERE organization_id = $1 AND integration_id = $2`,
      [organizationId, integrationId]
    );
    return rows[0]?.day ?? undefined;
  }

  /**
   * Stores the reading of a post: the last point of each metric in the
   * catalogue, the post's lifetime totals at `ageDays` days after it was
   * published, read on `capturedOn`. Reading the same age again replaces the
   * earlier values. Returns how many metrics were stored.
   */
  async savePostMetrics(
    organizationId: string,
    integrationId: string,
    postId: string,
    ageDays: number,
    capturedOn: string,
    data: AnalyticsData[]
  ) {
    const readings = new Map<string, number>();
    for (const item of data) {
      if (!isStorable(item) || !item.key) {
        continue;
      }
      // The platform lists the post's totals by date, the latest is the reading
      for (const point of [...item.data].reverse()) {
        const value = toValue(point.total);
        if (Number.isFinite(value)) {
          readings.set(item.key, value);
          break;
        }
      }
    }

    if (readings.size === 0 || !isDay(capturedOn)) {
      return 0;
    }

    await (
      await this.pool()
    ).query(
      `INSERT INTO pgonly.post_metrics
        (organization_id, integration_id, post_id, age_days, captured_on, metric, value)
      SELECT $1, $2, $3, $4, $5::date, metric, value
      FROM unnest($6::text[], $7::double precision[]) AS t(metric, value)
      ON CONFLICT (post_id, metric, age_days, captured_on) DO UPDATE SET
        value = EXCLUDED.value,
        fetched_at = now(),
        organization_id = EXCLUDED.organization_id,
        integration_id = EXCLUDED.integration_id`,
      [
        organizationId,
        integrationId,
        postId,
        ageDays,
        capturedOn,
        [...readings.keys()],
        [...readings.values()],
      ]
    );
    return readings.size;
  }

  // The stored readings of the posts, at one age or at every age. The
  // organization is always filtered: a post id alone must never read another
  // organization's rows.
  async getPostMetrics(
    organizationId: string,
    postIds: string[],
    options: { age?: number; metrics?: string[] } = {}
  ) {
    if (postIds.length === 0) {
      return [];
    }

    const { rows } = await (
      await this.pool()
    ).query<PostMetricReading>(
      `SELECT post_id, metric, age_days, captured_on::text AS captured_on, value
      FROM pgonly.post_metrics
      WHERE organization_id = $1 AND post_id = ANY($2::text[])
        AND ($3::int IS NULL OR age_days = $3::int)
        AND ($4::text[] IS NULL OR metric = ANY($4::text[]))
      ORDER BY post_id, age_days, metric`,
      [
        organizationId,
        postIds,
        options.age ?? null,
        options.metrics?.length ? options.metrics : null,
      ]
    );
    return rows;
  }
}
