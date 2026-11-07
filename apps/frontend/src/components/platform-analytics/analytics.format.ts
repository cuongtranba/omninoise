import dayjs from 'dayjs';
import {
  analyticsMetrics,
  type AnalyticsCategory,
  type AnalyticsMetric,
} from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';

export type AnalyticsFormat = AnalyticsMetric['format'];
export type AnalyticsAggregate = AnalyticsMetric['aggregate'];

export interface AnalyticsDataItem {
  label: string;
  data: Array<{ total: number; date: string }>;
  percentageChange?: number;
  key?: string;
  category?: AnalyticsCategory;
  format?: AnalyticsFormat;
  aggregate?: AnalyticsAggregate;
  average?: boolean;
  previousTotal?: number;
  total?: number; // The total over the range, when the backend computed it
}

export const categoryOrder: AnalyticsCategory[] = [
  'audience',
  'reach',
  'engagement',
  'clicks',
  'video',
];

export const getCategoryTitles = (
  t: (key: string, fallback: string) => string
): Record<string, string> => ({
  audience: t('analytics_category_audience', 'Audience'),
  reach: t('analytics_category_reach', 'Reach'),
  engagement: t('analytics_category_engagement', 'Engagement'),
  clicks: t('analytics_category_clicks', 'Clicks'),
  video: t('analytics_category_video', 'Video'),
  other: t('analytics_category_other', 'Other'),
});

// The translated name of a metric of the catalog, the label of the platform
// for any other
export const getAnalyticsMetricName = (
  t: (key: string, fallback: string) => string,
  item: { key?: string; label: string }
) =>
  item.key && analyticsMetrics[item.key]
    ? t(`analytics_metric_${item.key}`, analyticsMetrics[item.key].label)
    : item.label;

const formatDuration = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

export const formatAnalyticsValue = (
  value: number | undefined | null,
  format: AnalyticsFormat = 'number'
) => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '—';
  }
  if (format === 'percent') {
    return `${value.toFixed(2)}%`;
  }
  if (format === 'duration') {
    return formatDuration(value);
  }
  return new Intl.NumberFormat().format(Math.round(value));
};

// Totals follow `aggregate`; legacy providers only set `average: true`
export const aggregateAnalytics = (item: AnalyticsDataItem) => {
  const points = (item.data || []).map((p) => ({
    total: Number(p.total) || 0,
    time: dayjs(p.date).valueOf(),
  }));
  if (!points.length) {
    return 0;
  }
  const aggregate = item.aggregate || (item.average ? 'average' : 'sum');
  if (aggregate === 'last') {
    // The latest dated point, like the backend
    return points.reduce((a, b) => (b.time >= a.time ? b : a)).total;
  }
  const sum = points.reduce((acc, curr) => acc + curr.total, 0);
  return aggregate === 'average' ? sum / points.length : sum;
};

export const formatAnalyticsItem = (item: AnalyticsDataItem) => {
  // legacy items with `average` render as a percentage
  const format = item.format || (item.average ? 'percent' : 'number');
  return formatAnalyticsValue(item.total ?? aggregateAnalytics(item), format);
};
