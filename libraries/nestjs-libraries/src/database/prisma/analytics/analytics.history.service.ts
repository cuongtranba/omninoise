import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  AnalyticsHistoryRepository,
  ChannelMetricKind,
  ChannelMetricStats,
} from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.history.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  analyticsMetricKeys,
  analyticsMetrics,
  AnalyticsCategory,
  AnalyticsGrain,
  AnalyticsMetric,
} from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';

dayjs.extend(utc);

// The window read when the platform does not list its windows. Every
// collection re-reads a whole window: platforms revise the latest days.
const REFRESH_DAYS = 7;

// The range read when none is given, and the longest one that can be read
const DEFAULT_DAYS = 90;
const MAX_DAYS = 3 * 366;

const DAY = 'YYYY-MM-DD';

export interface ChannelHistoryQuery {
  from?: string; // YYYY-MM-DD, 90 days before `to` by default
  to?: string; // YYYY-MM-DD, today by default
  grain?: AnalyticsGrain; // day by default
  metrics?: string[]; // Metric keys, empty means all
}

// The shape of AnalyticsData and ReportMetric, so the consumers of the
// analytics of a channel can read it as they are
export interface ChannelHistoryMetric {
  key: string;
  label: string;
  category: AnalyticsCategory;
  format: AnalyticsMetric['format'];
  aggregate: AnalyticsMetric['aggregate'];
  kind: ChannelMetricKind;
  total: number;
  previousTotal?: number;
  percentageChange: number;
  data: { date: string; total: string }[];
}

@Injectable()
export class AnalyticsHistoryService {
  constructor(
    private _analyticsHistoryRepository: AnalyticsHistoryRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager
  ) {}

  // The channels whose platform serves analytics
  async collectableChannels() {
    return (await this._integrationService.getAnalyticsChannels()).filter(
      (p) =>
        this._integrationManager.getSocialIntegration(p.providerIdentifier)
          ?.analytics
    );
  }

  // Reads the channel's analytics and stores them by day. The first time the
  // largest window of the platform is read, to backfill what it still serves.
  async collectChannel(params: {
    organizationId: string;
    integrationId: string;
  }) {
    const { organizationId, integrationId } = params;
    const integration = await this._integrationService.getIntegrationById(
      organizationId,
      integrationId
    );
    const provider =
      integration &&
      this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      );
    // The first time, the largest window the platform serves backfills what
    // it still has; afterwards its smallest window refreshes the latest days
    const served = provider?.analyticsDays?.length
      ? provider.analyticsDays
      : [REFRESH_DAYS];
    const first =
      !(await this._analyticsHistoryRepository.hasMetrics(integrationId));
    const days = first ? Math.max(...served) : Math.min(...served);

    const data = await this._integrationService.checkAnalytics(
      { id: organizationId },
      integrationId,
      String(days)
    );
    return {
      days,
      stored: await this._analyticsHistoryRepository.saveMetrics(
        organizationId,
        integrationId,
        // A platform that only serves current totals gives running totals
        provider?.analyticsSnapshot ? 'total' : 'day',
        data
      ),
    };
  }

  // The first day stored for the channel is on or before `day`, so a range
  // that starts on `day` is complete
  async reaches(organizationId: string, integrationId: string, day: string) {
    const oldest = await this._analyticsHistoryRepository.getOldestDay(
      organizationId,
      integrationId
    );
    return !!oldest && oldest <= day;
  }

  // The stored analytics of a channel over [from, to], as a series per metric
  // and its total, compared with the range of the same length before it when
  // that range is stored too. Empty when the channel is not the organization's.
  async channelHistory(
    organizationId: string,
    integrationId: string,
    query: ChannelHistoryQuery
  ): Promise<ChannelHistoryMetric[]> {
    const to = query.to ? dayjs.utc(query.to) : dayjs.utc();
    const from = query.from
      ? dayjs.utc(query.from)
      : to.subtract(DEFAULT_DAYS - 1, 'day');
    if (!from.isValid() || !to.isValid() || from.isAfter(to, 'day')) {
      throw new HttpException(
        'The range must start on or before the day it ends',
        HttpStatus.BAD_REQUEST
      );
    }
    const days = to.startOf('day').diff(from.startOf('day'), 'day') + 1;
    if (days > MAX_DAYS) {
      throw new HttpException(
        `The range can be at most ${MAX_DAYS} days`,
        HttpStatus.BAD_REQUEST
      );
    }

    const integration = await this._integrationService.getIntegrationById(
      organizationId,
      integrationId
    );
    if (!integration) {
      return [];
    }

    const range = { from: from.format(DAY), to: to.format(DAY) };
    const previousTo = from.subtract(1, 'day');
    const previous = {
      from: previousTo.subtract(days - 1, 'day').format(DAY),
      to: previousTo.format(DAY),
    };
    const metrics = query.metrics?.length ? query.metrics : undefined;

    // The range before is only compared when it is stored from its first day
    const comparable = await this.reaches(
      organizationId,
      integrationId,
      previous.from
    );
    const [series, totals, before] = await Promise.all([
      this._analyticsHistoryRepository.getSeries(
        organizationId,
        integrationId,
        range,
        query.grain ?? 'day',
        metrics
      ),
      this._analyticsHistoryRepository.getTotals(
        organizationId,
        integrationId,
        range,
        metrics
      ),
      comparable
        ? this._analyticsHistoryRepository.getTotals(
            organizationId,
            integrationId,
            previous,
            metrics
          )
        : [],
    ]);

    const id = (stats: ChannelMetricStats) => `${stats.metric}:${stats.kind}`;
    const metricOrder = (key: string) => analyticsMetricKeys.indexOf(key);

    const items: ChannelHistoryMetric[] = totals
      .filter((stats) => !!analyticsMetrics[stats.metric])
      .map((stats) => {
        const catalog = analyticsMetrics[stats.metric];
        // A running total is read at the end of the range, never added up
        const aggregate = stats.kind === 'total' ? 'last' : catalog.aggregate;
        const total = this.aggregated(stats, aggregate);
        const earlier = before.find((p) => id(p) === id(stats));
        const previousTotal = earlier
          ? this.aggregated(earlier, aggregate)
          : undefined;

        return {
          key: stats.metric,
          label: catalog.label,
          category: catalog.category,
          format: catalog.format,
          aggregate,
          kind: stats.kind,
          total,
          previousTotal,
          percentageChange:
            previousTotal === undefined
              ? 0
              : this._integrationService.analyticsChange(
                  catalog.format,
                  total,
                  previousTotal
                ),
          data: series
            .filter((bucket) => id(bucket) === id(stats))
            .map((bucket) => ({
              date: bucket.bucket,
              total: String(this.aggregated(bucket, aggregate)),
            })),
        };
      });

    return this.withEngagementRate(items).sort(
      (a, b) => metricOrder(a.key) - metricOrder(b.key)
    );
  }

  // The engagement rate of many days is their engagements over their
  // impressions (or reach), not an average of daily rates: when both are
  // stored it is computed for every point and replaces a stored rate
  private withEngagementRate(items: ChannelHistoryMetric[]) {
    const daily = (key: string) =>
      items.find((p) => p.key === key && p.kind === 'day');
    const engagements = daily('engagements');
    const base = daily('impressions') ?? daily('reach');
    if (!engagements || !base) {
      return items;
    }

    const rate = (value: number, of: number) =>
      this._integrationService.analyticsRate(value, of);
    const catalog = analyticsMetrics.engagement_rate;
    const total = rate(engagements.total, base.total);
    const previousTotal =
      engagements.previousTotal !== undefined &&
      base.previousTotal !== undefined
        ? rate(engagements.previousTotal, base.previousTotal)
        : undefined;

    return [
      ...items.filter((p) => p.key !== 'engagement_rate'),
      {
        key: 'engagement_rate',
        label: catalog.label,
        category: catalog.category,
        format: catalog.format,
        aggregate: catalog.aggregate,
        kind: 'day' as const,
        total,
        previousTotal,
        percentageChange:
          previousTotal === undefined
            ? 0
            : this._integrationService.analyticsChange(
                catalog.format,
                total,
                previousTotal
              ),
        data: engagements.data.flatMap((point) => {
          const of = base.data.find((p) => p.date === point.date);
          return of
            ? [
                {
                  date: point.date,
                  total: String(rate(Number(point.total), Number(of.total))),
                },
              ]
            : [];
        }),
      },
    ];
  }

  private aggregated(
    stats: ChannelMetricStats,
    aggregate: AnalyticsMetric['aggregate']
  ) {
    return aggregate === 'sum'
      ? stats.sum
      : aggregate === 'average'
        ? stats.avg
        : stats.last;
  }
}
