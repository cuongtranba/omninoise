import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { chunk } from 'lodash';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  AnalyticsHistoryService,
  ChannelHistoryMetric,
  postExcerpt,
} from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.history.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  analyticsGrainFor,
  analyticsMetrics,
  postEngagementScore,
  AnalyticsCategory,
} from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';

dayjs.extend(utc);

export type AnalyticsReportSection =
  | 'channels'
  | 'summary'
  | 'topPosts'
  | 'insights';

export interface AnalyticsReportOptions {
  integrationIds?: string[];
  days: number;
  metrics?: string[]; // Metric keys, empty means all
  sections?: AnalyticsReportSection[];
  topPostsLimit?: number;
}

export interface ReportIntegration {
  id: string;
  name: string;
  providerIdentifier: string;
  picture: string | null;
}

export interface ReportMetric {
  key?: string;
  label: string;
  category?: AnalyticsCategory;
  format?: AnalyticsData['format'];
  total: number;
  previousTotal?: number;
  percentageChange: number;
  data: AnalyticsData['data'];
}

export interface ReportTotal {
  total: number;
  previousTotal?: number;
  percentageChange: number;
}

const CONCURRENCY = 3;
const TOP_POSTS_PER_CHANNEL = 10;
const TOP_POSTS_MAX = 30;

@Injectable()
export class AnalyticsReportService {
  constructor(
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _postsService: PostsService,
    private _analyticsHistoryService: AnalyticsHistoryService
  ) {}

  // The report of the overview page, cached for an hour per organization
  async overview(orgId: string, days: number) {
    const cacheKey = `analytics-overview:${orgId}:${days}`;
    const cached = await ioRedis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const report = await this.build(orgId, { days, topPostsLimit: 5 });
    await ioRedis.set(
      cacheKey,
      JSON.stringify(report),
      'EX',
      !process.env.NODE_ENV || process.env.NODE_ENV === 'development' ? 1 : 3600
    );
    return report;
  }

  async build(orgId: string, options: AnalyticsReportOptions) {
    const { days } = options;
    const sections = options.sections ?? ['channels', 'summary', 'topPosts'];
    const keys = options.metrics?.length ? options.metrics : undefined;
    const to = dayjs.utc();
    const from = to.subtract(days, 'day');

    const integrations = (
      await this._integrationService.getIntegrationsList(orgId)
    ).filter(
      (p) =>
        p.type === 'social' &&
        !p.disabled &&
        !p.inBetweenSteps &&
        (!options.integrationIds?.length ||
          options.integrationIds.includes(p.id)) &&
        this._integrationManager.getSocialIntegration(p.providerIdentifier)
          ?.analytics
    );

    // Every metric of a channel, the filter is applied on the way out
    const loaded = (
      await this.inBatches(integrations, async (p) => {
        try {
          const integration = {
            id: p.id,
            name: p.customName || p.name,
            providerIdentifier: p.providerIdentifier,
            picture: p.picture,
          };
          const stored = await this.storedMetrics(
            orgId,
            p.id,
            p.providerIdentifier,
            days
          );
          if (stored) {
            return {
              days,
              source: 'history' as const,
              integration,
              metrics: stored,
            };
          }

          const channelDays = this.channelDays(p.providerIdentifier, days);
          const data = await this._integrationService.checkAnalytics(
            { id: orgId },
            p.id,
            String(channelDays)
          );
          return {
            days: channelDays,
            source: 'live' as const,
            integration,
            metrics: data.map((item) => this.reportMetric(item)),
          };
        } catch (err) {
          return undefined;
        }
      })
    ).filter((p) => p?.metrics.length);

    const channels = loaded.map((p) => ({
      integration: p!.integration,
      days: p!.days,
      source: p!.source,
      metrics: p!.metrics.filter(
        (m) => !keys || (m.key && keys.includes(m.key))
      ),
    }));

    return {
      event: 'analytics.report' as const,
      generatedAt: to.toISOString(),
      period: {
        days,
        from: from.toISOString(),
        to: to.toISOString(),
        previousFrom: from.subtract(days, 'day').toISOString(),
        previousTo: from.toISOString(),
      },
      ...(sections.includes('summary')
        ? {
            summary: this.summary(
              loaded.map((p) => p!.metrics),
              keys
            ),
          }
        : {}),
      ...(sections.includes('channels') ? { channels } : {}),
      ...(sections.includes('topPosts') && (options.topPostsLimit ?? 0) > 0
        ? {
            topPosts: await this.topPosts(
              orgId,
              integrations
                .filter(
                  (p) =>
                    this._integrationManager.getSocialIntegration(
                      p.providerIdentifier
                    )?.postAnalytics
                )
                .map((p) => p.id),
              days,
              options.topPostsLimit!
            ),
          }
        : {}),
      // What the posts of the window have in common (see postInsights)
      ...(sections.includes('insights')
        ? {
            insights: await this._analyticsHistoryService
              .postInsights(orgId, {
                from: from.format('YYYY-MM-DD'),
                to: to.format('YYYY-MM-DD'),
                integrations: options.integrationIds,
              })
              .catch((err) => {
                console.error(
                  'analytics report insights failed',
                  (err as Error).message
                );
                return undefined;
              }),
          }
        : {}),
    };
  }

  // The largest window the platform serves that is not above the requested
  // one, or its smallest one when every window is above it. So a channel is
  // only read over another window than the requested one when its platform
  // cannot serve that window (`days` of the channel says which one it was).
  private channelDays(providerIdentifier: string, days: number) {
    const supported = [
      ...(this._integrationManager.getSocialIntegration(providerIdentifier)
        ?.analyticsDays ?? [days]),
    ].sort((a, b) => a - b);

    return supported.filter((p) => p <= days).pop() ?? supported[0] ?? days;
  }

  // The stored history of a channel, for a window that is longer than every
  // one its platform serves, when the history reaches back to its start.
  // Undefined otherwise: the platform is read live.
  private async storedMetrics(
    orgId: string,
    integrationId: string,
    providerIdentifier: string,
    days: number
  ): Promise<ReportMetric[] | undefined> {
    const served =
      this._integrationManager.getSocialIntegration(
        providerIdentifier
      )?.analyticsDays;
    if (!served?.length || days <= Math.max(...served)) {
      return undefined;
    }

    const to = dayjs.utc();
    const from = to.subtract(days - 1, 'day');
    if (
      !(await this._analyticsHistoryService.reaches(
        orgId,
        integrationId,
        from.format('YYYY-MM-DD')
      ))
    ) {
      return undefined;
    }

    const history = await this._analyticsHistoryService
      .channelHistory(orgId, integrationId, {
        from: from.format('YYYY-MM-DD'),
        to: to.format('YYYY-MM-DD'),
        grain: analyticsGrainFor(days),
      })
      .catch((): ChannelHistoryMetric[] => []);
    return history.length
      ? history.map((m) => ({
          key: m.key,
          label: m.label,
          category: m.category,
          format: m.format,
          total: m.total,
          previousTotal: m.previousTotal,
          percentageChange: m.percentageChange,
          data: m.data,
        }))
      : undefined;
  }

  private reportMetric(item: AnalyticsData): ReportMetric {
    return {
      key: item.key,
      label: item.label,
      category: item.category,
      format: item.format,
      total: this._integrationService.analyticsTotal(item),
      previousTotal: item.previousTotal,
      percentageChange: item.percentageChange,
      data: item.data,
    };
  }

  // Adds the channels up for the metrics that make sense across channels. The
  // windows of the channels may differ, only for a platform that cannot serve
  // the requested one (see channelDays), the totals are still added up as they are.
  private summary(channels: ReportMetric[][], keys?: string[]) {
    const metrics: Record<string, ReportTotal> = {};
    const found = new Set(
      channels.flatMap((metric) => metric.map((m) => m.key))
    );

    for (const key of found) {
      const catalog = key ? analyticsMetrics[key] : undefined;
      if (!key || !catalog?.summable) {
        continue;
      }

      const items = channels.flatMap((metric) =>
        metric.filter((m) => m.key === key)
      );
      const total = items.reduce((all, m) => all + m.total, 0);
      const previousTotal = items.every((m) => m.previousTotal !== undefined)
        ? items.reduce((all, m) => all + m.previousTotal!, 0)
        : undefined;
      metrics[key] = {
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
      };
    }

    const base = metrics.impressions ?? metrics.reach;
    if (metrics.engagements && base) {
      const total = this._integrationService.analyticsRate(
        metrics.engagements.total,
        base.total
      );
      const previousTotal =
        metrics.engagements.previousTotal !== undefined &&
        base.previousTotal !== undefined
          ? this._integrationService.analyticsRate(
              metrics.engagements.previousTotal,
              base.previousTotal
            )
          : undefined;
      metrics.engagement_rate = {
        total,
        previousTotal,
        percentageChange:
          previousTotal === undefined
            ? 0
            : this._integrationService.analyticsChange(
                'percent',
                total,
                previousTotal
              ),
      };
    }

    return {
      channels: channels.length,
      metrics: Object.fromEntries(
        Object.entries(metrics).filter(([key]) => !keys || keys.includes(key))
      ),
    };
  }

  // The posts of the window that did best, by engagements
  private async topPosts(
    orgId: string,
    integrationIds: string[],
    days: number,
    limit: number
  ) {
    const posts = (
      await this._postsService.getPublishedPostsForAnalytics(
        orgId,
        integrationIds,
        dayjs.utc().subtract(days, 'day').toDate(),
        TOP_POSTS_PER_CHANNEL
      )
    )
      .sort((a, b) => b.publishDate.getTime() - a.publishDate.getTime())
      .slice(0, TOP_POSTS_MAX);

    const withMetrics = await this.inBatches(posts, async (post) => {
      try {
        const data = await this._postsService.checkPostAnalytics(
          orgId,
          post.id,
          days
        );
        if (!Array.isArray(data) || !data.length) {
          return undefined;
        }

        const metrics: Record<string, number> = {};
        for (const item of data) {
          metrics[item.key ?? item.label] =
            this._integrationService.analyticsTotal(item);
        }

        return {
          id: post.id,
          content: postExcerpt(post.content),
          publishDate: post.publishDate,
          releaseURL: post.releaseURL,
          integration: post.integration,
          metrics,
        };
      } catch (err) {
        return undefined;
      }
    });

    return withMetrics
      .filter((p) => !!p)
      .sort(
        (a, b) =>
          postEngagementScore(b!.metrics) - postEngagementScore(a!.metrics)
      )
      .slice(0, limit);
  }

  private async inBatches<T, R>(
    items: T[],
    run: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = [];
    for (const batch of chunk(items, CONCURRENCY)) {
      results.push(...(await Promise.all(batch.map(run))));
    }
    return results;
  }
}
