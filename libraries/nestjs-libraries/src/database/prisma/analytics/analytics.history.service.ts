import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import striptags from 'striptags';
import { isTimeZone } from 'class-validator';
import {
  AnalyticsHistoryRepository,
  ChannelMetricKind,
  ChannelMetricStats,
} from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.history.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  analyticsMetricKeys,
  analyticsMetrics,
  analyticsPostAges,
  analyticsPostDefaultAge,
  postEngagementScore,
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

// How many posts of an organization are read per sweep when
// ANALYTICS_POST_SNAPSHOTS_PER_DAY does not say
const DEFAULT_POST_SNAPSHOTS_PER_DAY = 300;

// The metrics a post is ranked by (see postEngagementScore)
const RANKING_METRICS = ['engagements', 'likes', 'comments', 'shares'];

// A group of the insights is only a pattern when it holds this many posts
const MIN_SLOT_POSTS = 2;
const EXTREMES = 5;

// The text of a post (without its markup) is short under 100 characters,
// long from 280 (the limit of a post on X) and medium in between
const SHORT_POST = 100;
const LONG_POST = 280;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v'];

export type PostFormat = 'video' | 'image' | 'text';
export type PostLength = 'short' | 'medium' | 'long';

// The text of a post as a short plain excerpt
export const postExcerpt = (content: string) =>
  striptags(content).replace(/\s+/g, ' ').trim().slice(0, 280);

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

export interface PostInsightsQuery {
  from?: string; // First day (UTC), 90 days before `to` by default
  to?: string; // Last day (UTC), today by default
  integrations?: string[]; // Channel ids, empty means all
  age?: number; // Days after publishing the posts are compared at, one of analyticsPostAges
  timezone?: string; // IANA timezone of the weekday and hour, UTC by default
}

export interface PostInsightsPost {
  id: string;
  integration: {
    id: string;
    name: string;
    providerIdentifier: string;
    picture: string | null;
  };
  publishDate: string;
  content: string;
  value: number;
  releaseURL: string | null;
}

// The median of the posts' ranking value and how many posts it is of
interface PostInsightsGroup {
  posts: number;
  median: number;
}

export interface PostInsights {
  age: number;
  timezone: string;
  period: { from: string; to: string };
  posts: number; // Posts of the range that have a reading at that age
  median: number | null;
  byWeekdayHour: (PostInsightsGroup & { weekday: number; hour: number })[]; // Best median first
  byWeekday: (PostInsightsGroup & { weekday: number })[]; // Sunday (0) to Saturday (6)
  byHour: (PostInsightsGroup & { hour: number })[];
  byFormat: (PostInsightsGroup & { format: PostFormat })[];
  byChannel: (PostInsightsGroup & {
    integration: PostInsightsPost['integration'];
  })[]; // Best median first
  byLength: (PostInsightsGroup & { length: PostLength })[];
  top: PostInsightsPost[]; // Best first
  bottom: PostInsightsPost[]; // Worst first, never a post of `top`
}

export interface PostHistoryMetric {
  key: string;
  label: string;
  category: AnalyticsCategory;
  format: AnalyticsMetric['format'];
  data: { age: number; date: string; total: string }[];
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

@Injectable()
export class AnalyticsHistoryService {
  constructor(
    private _analyticsHistoryRepository: AnalyticsHistoryRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _postsService: PostsService
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

  // The posts whose lifetime totals are due today: published `age` whole UTC
  // days ago for one of the ages, on a channel that can be read and whose
  // platform serves post analytics. An organization is read for at most
  // ANALYTICS_POST_SNAPSHOTS_PER_DAY posts, the younger ones first. Nothing is
  // due when ANALYTICS_POST_SNAPSHOTS is 'false'.
  async collectablePosts() {
    if (process.env.ANALYTICS_POST_SNAPSHOTS === 'false') {
      return [];
    }

    const providerIdentifiers = this._integrationManager
      .getAllowedSocialsIntegrations()
      .filter(
        (identifier) =>
          this._integrationManager.getSocialIntegration(identifier)
            ?.postAnalytics
      );
    const today = dayjs.utc().startOf('day');
    const windows = analyticsPostAges.map((age) => ({
      age,
      from: today.subtract(age, 'day').toDate(),
      to: today.subtract(age - 1, 'day').toDate(),
    }));

    const due = (
      await this._postsService.getPostsPublishedInWindows(
        windows,
        providerIdentifiers
      )
    ).flatMap((post) => {
      const window = windows.find(
        (p) => post.publishDate >= p.from && post.publishDate < p.to
      );
      return window
        ? [
            {
              id: post.id,
              organizationId: post.organizationId,
              providerIdentifier: post.integration.providerIdentifier,
              age: window.age,
              publishDate: post.publishDate,
            },
          ]
        : [];
    });

    const configured = Number(process.env.ANALYTICS_POST_SNAPSHOTS_PER_DAY);
    const perOrganization =
      process.env.ANALYTICS_POST_SNAPSHOTS_PER_DAY?.trim() &&
      Number.isInteger(configured) &&
      configured >= 0
        ? configured
        : DEFAULT_POST_SNAPSHOTS_PER_DAY;
    const taken = new Map<string, number>();
    return due
      .sort(
        (a, b) =>
          a.age - b.age || b.publishDate.getTime() - a.publishDate.getTime()
      )
      .filter((post) => {
        const count = taken.get(post.organizationId) ?? 0;
        taken.set(post.organizationId, count + 1);
        return count < perOrganization;
      })
      .map(({ publishDate, ...post }) => post);
  }

  // Reads the lifetime totals of a published post and stores them for its age
  // in whole UTC days (what the sweep queued it for). A post that is gone,
  // not a day old yet or that the platform gives nothing for stores nothing.
  async collectPost(params: { organizationId: string; postId: string }) {
    const { organizationId, postId } = params;
    const post = await this._postsService.getPostForSnapshot(
      organizationId,
      postId
    );
    const today = dayjs.utc().startOf('day');
    const age = post
      ? today.diff(dayjs.utc(post.publishDate).startOf('day'), 'day')
      : 0;
    if (!post || age < 1) {
      return { age, stored: 0 };
    }

    const data = await this._postsService.checkPostAnalytics(
      organizationId,
      postId,
      age
    );
    return {
      age,
      stored: Array.isArray(data)
        ? await this._analyticsHistoryRepository.savePostMetrics(
            organizationId,
            post.integrationId,
            postId,
            age,
            today.format(DAY),
            data
          )
        : 0,
    };
  }

  // The stored readings of a post, a series per metric by age. Empty when the
  // post is not the organization's or nothing is stored for it yet.
  async postHistory(
    organizationId: string,
    postId: string
  ): Promise<PostHistoryMetric[]> {
    const readings = await this._analyticsHistoryRepository.getPostMetrics(
      organizationId,
      [postId]
    );
    return analyticsMetricKeys
      .filter((key) => readings.some((p) => p.metric === key))
      .map((key) => ({
        key,
        label: analyticsMetrics[key].label,
        category: analyticsMetrics[key].category,
        format: analyticsMetrics[key].format,
        data: readings
          .filter((p) => p.metric === key)
          .map((p) => ({
            age: p.age_days,
            date: p.captured_on,
            total: String(p.value),
          })),
      }));
  }

  // What the posts published in the range have in common with the ones that
  // did best: the posts are ranked at one age after publishing (see
  // postEngagementScore) from their stored readings, and the median of that
  // value is given per weekday and hour (in the timezone), format, channel
  // and length of text, with the best and worst posts.
  async postInsights(
    organizationId: string,
    query: PostInsightsQuery
  ): Promise<PostInsights> {
    const age = query.age ?? analyticsPostDefaultAge;
    if (!(analyticsPostAges as readonly number[]).includes(age)) {
      throw new HttpException(
        `The age must be one of ${analyticsPostAges.join(', ')} days`,
        HttpStatus.BAD_REQUEST
      );
    }
    const timezone = query.timezone || 'UTC';
    if (!isTimeZone(timezone)) {
      throw new HttpException(
        'The timezone must be a valid IANA timezone',
        HttpStatus.BAD_REQUEST
      );
    }

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
    if (to.startOf('day').diff(from.startOf('day'), 'day') + 1 > MAX_DAYS) {
      throw new HttpException(
        `The range can be at most ${MAX_DAYS} days`,
        HttpStatus.BAD_REQUEST
      );
    }

    const posts = await this._postsService.getPublishedPostsBetween(
      organizationId,
      { from: from.startOf('day').toDate(), to: to.endOf('day').toDate() },
      query.integrations
    );
    const readings = await this._analyticsHistoryRepository.getPostMetrics(
      organizationId,
      posts.map((post) => post.id),
      { age, metrics: RANKING_METRICS }
    );

    const clock = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    });
    const scored = posts.flatMap((post) => {
      const own = readings.filter((p) => p.post_id === post.id);
      if (!own.length) {
        return [];
      }

      const parts = clock.formatToParts(post.publishDate);
      const text = striptags(post.content).trim();
      const media = this.media(post.image);
      return [
        {
          post: {
            id: post.id,
            integration: {
              id: post.integration.id,
              name: post.integration.customName || post.integration.name,
              providerIdentifier: post.integration.providerIdentifier,
              picture: post.integration.picture,
            },
            publishDate: post.publishDate.toISOString(),
            content: postExcerpt(post.content),
            value: postEngagementScore(
              Object.fromEntries(own.map((p) => [p.metric, p.value]))
            ),
            releaseURL: post.releaseURL,
          },
          weekday: WEEKDAYS.indexOf(
            parts.find((p) => p.type === 'weekday')?.value ?? ''
          ),
          hour: Number(parts.find((p) => p.type === 'hour')?.value),
          format: (media.some((path) =>
            VIDEO_EXTENSIONS.some((ext) => hasExtension(path, ext))
          )
            ? 'video'
            : media.length
              ? 'image'
              : 'text') as PostFormat,
          length: (text.length < SHORT_POST
            ? 'short'
            : text.length < LONG_POST
              ? 'medium'
              : 'long') as PostLength,
        },
      ];
    });

    const grouped = <K>(key: (p: (typeof scored)[number]) => K) => {
      const groups = new Map<string, { key: K; values: number[] }>();
      for (const item of scored) {
        const id = JSON.stringify(key(item));
        const group = groups.get(id) ?? { key: key(item), values: [] };
        group.values.push(item.post.value);
        groups.set(id, group);
      }
      return [...groups.values()].map(({ key, values }) => ({
        key,
        posts: values.length,
        median: median(values),
      }));
    };
    const best = (a: { median: number }, b: { median: number }) =>
      b.median - a.median;

    const byValue = [...scored].sort((a, b) => b.post.value - a.post.value);
    const top = byValue.slice(0, EXTREMES);
    return {
      age,
      timezone,
      period: { from: from.format(DAY), to: to.format(DAY) },
      posts: scored.length,
      median: scored.length ? median(scored.map((p) => p.post.value)) : null,
      byWeekdayHour: grouped((p) => ({ weekday: p.weekday, hour: p.hour }))
        .filter((p) => p.posts >= MIN_SLOT_POSTS)
        .map(({ key, ...group }) => ({ ...key, ...group }))
        .sort(best),
      byWeekday: grouped((p) => p.weekday)
        .map(({ key, ...group }) => ({ weekday: key, ...group }))
        .sort((a, b) => a.weekday - b.weekday),
      byHour: grouped((p) => p.hour)
        .map(({ key, ...group }) => ({ hour: key, ...group }))
        .sort((a, b) => a.hour - b.hour),
      byFormat: grouped((p) => p.format).map(({ key, ...group }) => ({
        format: key,
        ...group,
      })),
      byChannel: grouped((p) => p.post.integration)
        .map(({ key, ...group }) => ({ integration: key, ...group }))
        .sort(best),
      byLength: grouped((p) => p.length).map(({ key, ...group }) => ({
        length: key,
        ...group,
      })),
      top: top.map((p) => p.post),
      bottom: byValue
        .slice(EXTREMES)
        .reverse()
        .slice(0, EXTREMES)
        .map((p) => p.post),
    };
  }

  // The paths of the media of a post, whose `image` holds them as JSON
  private media(image: string | null): string[] {
    try {
      const media: { path?: string }[] = JSON.parse(image || '[]');
      return media.flatMap((p) => (p?.path ? [p.path] : []));
    } catch (err) {
      return [];
    }
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
