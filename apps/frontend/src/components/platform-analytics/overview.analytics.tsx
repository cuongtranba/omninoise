import { FC, useCallback } from 'react';
import useSWR from 'swr';
import { formatDate } from '@gitroom/frontend/components/layout/set.timezone';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { analyticsMetrics } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import { TrendIndicator } from '@gitroom/frontend/components/platform-analytics/render.analytics';
import {
  formatAnalyticsValue,
  getAnalyticsMetricName,
} from '@gitroom/frontend/components/platform-analytics/analytics.format';

interface OverviewIntegration {
  id: string;
  name: string;
  providerIdentifier: string;
  picture: string;
}

interface OverviewMetric {
  key?: string;
  label: string;
  total: number;
  previousTotal?: number;
  percentageChange: number;
}

interface OverviewData {
  period: { days: number };
  summary: {
    channels: number;
    metrics: Record<string, OverviewMetric>;
  };
  channels: Array<{
    integration: OverviewIntegration;
    metrics: OverviewMetric[];
  }>;
  topPosts: Array<{
    id: string;
    content: string;
    publishDate: string;
    releaseURL: string;
    integration: OverviewIntegration;
    metrics: Record<string, number>;
  }>;
}

const kpiKeys = [
  'followers',
  'impressions',
  'engagements',
  'engagement_rate',
  'clicks',
  'video_views',
];

const postMetricKeys = [
  'engagements',
  'impressions',
  'reach',
  'likes',
  'comments',
  'shares',
  'clicks',
  'video_views',
];

const useOverviewAnalytics = (date: number) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch(`/analytics/overview?date=${date}`)).json();
  }, [date]);

  return useSWR<OverviewData>(`/analytics-overview-${date}`, load, {
    refreshInterval: 0,
    refreshWhenHidden: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    revalidateOnMount: true,
  });
};

const KpiCard: FC<{
  metricKey: string;
  metric: OverviewMetric;
  days: number;
}> = ({ metricKey, metric, days }) => {
  const t = useT();
  const catalog = analyticsMetrics[metricKey];
  return (
    <div className="flex flex-col gap-[8px] bg-newTableHeader border border-newTableBorder rounded-[12px] px-[16px] py-[14px] transition-all duration-200 hover:border-brand/50">
      <div className="flex items-center justify-between gap-[8px]">
        <span className="text-[15px] font-medium text-newTableText">
          {getAnalyticsMetricName(t, { key: metricKey, label: metric.label })}
        </span>
        <TrendIndicator
          value={metric.percentageChange}
          percentagePoints={catalog?.format === 'percent'}
          days={days}
        />
      </div>
      <div className="text-[36px] leading-[42px] font-semibold tracking-tight">
        {formatAnalyticsValue(metric.total, catalog?.format)}
      </div>
    </div>
  );
};

const ChannelAvatar: FC<{ integration: OverviewIntegration }> = ({
  integration,
}) => (
  <ImageWithFallback
    fallbackSrc={`/icons/platforms/${integration.providerIdentifier}.png`}
    src={integration.picture}
    className="rounded-[8px]"
    alt={integration.providerIdentifier}
    width={28}
    height={28}
  />
);

const ChannelsTable: FC<{ channels: OverviewData['channels'] }> = ({
  channels,
}) => {
  const t = useT();
  const columns = [
    { keys: ['followers'], label: t('analytics_followers', 'Followers') },
    {
      keys: ['impressions', 'reach'],
      label: t('analytics_impressions', 'Impressions'),
    },
    { keys: ['engagements'], label: t('analytics_engagements', 'Engagements') },
    {
      keys: ['engagement_rate'],
      label: t('analytics_engagement_rate', 'Engagement Rate'),
    },
  ];

  return (
    <div className="bg-newTableHeader border border-newTableBorder rounded-[12px] overflow-x-auto">
      <div className="grid grid-cols-[minmax(160px,2fr)_repeat(4,minmax(90px,1fr))] min-w-[600px] text-[14px]">
        <div className="px-[16px] py-[10px] font-medium border-b border-newTableBorder">
          {t('channel', 'Channel')}
        </div>
        {columns.map((column) => (
          <div
            key={column.label}
            className="px-[16px] py-[10px] font-medium text-end border-b border-newTableBorder"
          >
            {column.label}
          </div>
        ))}
        {channels.map((channel) => (
          <div key={channel.integration.id} className="contents">
            <div className="flex items-center gap-[10px] px-[16px] py-[10px] border-b border-newTableBorder">
              <ChannelAvatar integration={channel.integration} />
              <span className="truncate">{channel.integration.name}</span>
            </div>
            {columns.map((column) => {
              const metric = channel.metrics.find(
                (m) => !!m.key && column.keys.includes(m.key)
              );
              return (
                <div
                  key={column.label}
                  className="px-[16px] py-[10px] text-end border-b border-newTableBorder"
                >
                  {metric
                    ? formatAnalyticsValue(
                        metric.total,
                        analyticsMetrics[metric.key!]?.format
                      )
                    : '—'}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

const TopPosts: FC<{ posts: OverviewData['topPosts'] }> = ({ posts }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[10px]">
      {posts.map((post) => {
        const chips = Object.entries(post.metrics)
          .sort(([a], [b]) => {
            const rank = (key: string) =>
              postMetricKeys.includes(key)
                ? postMetricKeys.indexOf(key)
                : postMetricKeys.length;
            return rank(a) - rank(b);
          })
          .slice(0, 4);
        return (
          <div
            key={post.id}
            className="flex items-center gap-[12px] bg-newTableHeader border border-newTableBorder rounded-[12px] px-[16px] py-[12px] mobile:flex-col mobile:items-start"
          >
            <ChannelAvatar integration={post.integration} />
            <div className="flex-1 min-w-0 flex flex-col gap-[6px]">
              <div className="truncate text-[14px] text-newTableText">
                {stripHtmlValidation(
                  'none',
                  post.content,
                  false,
                  true,
                  false
                ) || t('analytics_post_without_text', 'Post without text')}
              </div>
              <div className="flex flex-wrap items-center gap-[6px] text-[12px]">
                <span className="opacity-60">
                  {formatDate(post.publishDate, 'dateTime')}
                </span>
                {chips.map(([key, value]) => (
                  <span
                    key={key}
                    className="rounded-[6px] bg-newBgColorInner border border-newTableBorder px-[8px] py-[2px]"
                  >
                    {getAnalyticsMetricName(t, { key, label: key })}:{' '}
                    {formatAnalyticsValue(value, analyticsMetrics[key]?.format)}
                  </span>
                ))}
              </div>
            </div>
            {!!post.releaseURL && (
              <a
                href={post.releaseURL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[14px] font-medium text-brand hover:underline whitespace-nowrap"
              >
                {t('analytics_open_post', 'Open post')}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const OverviewAnalytics: FC<{ date: number }> = ({ date }) => {
  const t = useT();
  const { data, isLoading } = useOverviewAnalytics(date);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-[48px]">
        <LoadingComponent />
      </div>
    );
  }

  const kpis = kpiKeys.filter((key) => !!data?.summary?.metrics?.[key]);

  if (!data || (!kpis.length && !data.channels?.length)) {
    return (
      <div className="flex flex-col items-center justify-center py-[48px] px-[24px] bg-newTableHeader border border-newTableBorder rounded-[12px]">
        <p className="text-[15px] text-newTableText text-center">
          {t(
            'analytics_overview_empty',
            'No analytics available for your channels yet'
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[24px]">
      {!!kpis.length && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[16px]">
          {kpis.map((key) => (
            <KpiCard
              key={key}
              metricKey={key}
              metric={data.summary.metrics[key]}
              days={data.period.days}
            />
          ))}
        </div>
      )}
      {!!data.channels?.length && (
        <div className="flex flex-col gap-[12px]">
          <h3 className="text-[16px] font-[500]">
            {t('analytics_channel_comparison', 'Channel comparison')}
          </h3>
          <ChannelsTable channels={data.channels} />
        </div>
      )}
      {!!data.topPosts?.length && (
        <div className="flex flex-col gap-[12px]">
          <h3 className="text-[16px] font-[500]">
            {t('analytics_top_posts', 'Top posts')}
          </h3>
          <TopPosts posts={data.topPosts} />
        </div>
      )}
    </div>
  );
};
