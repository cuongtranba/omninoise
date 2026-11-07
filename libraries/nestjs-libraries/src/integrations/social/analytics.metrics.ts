export type AnalyticsCategory =
  | 'audience'
  | 'reach'
  | 'engagement'
  | 'clicks'
  | 'video';

export type AnalyticsMetric = {
  label: string;
  category: AnalyticsCategory;
  format: 'number' | 'percent' | 'duration'; // duration is in seconds
  aggregate: 'sum' | 'average' | 'last';
  summable: boolean; // Can be added up across channels
};

const metric = (
  label: string,
  category: AnalyticsCategory,
  format: AnalyticsMetric['format'],
  aggregate: AnalyticsMetric['aggregate'],
  summable: boolean
): AnalyticsMetric => ({ label, category, format, aggregate, summable });

export const analyticsMetrics: Record<string, AnalyticsMetric> = {
  followers: metric('Followers', 'audience', 'number', 'last', true),
  follower_change: metric('Follower Change', 'audience', 'number', 'sum', true),
  impressions: metric('Impressions', 'reach', 'number', 'sum', true),
  reach: metric('Reach', 'reach', 'number', 'sum', true),
  profile_views: metric('Profile Views', 'reach', 'number', 'sum', true),
  engagements: metric('Engagements', 'engagement', 'number', 'sum', true),
  engagement_rate: metric(
    'Engagement Rate',
    'engagement',
    'percent',
    'average',
    false
  ),
  likes: metric('Likes', 'engagement', 'number', 'sum', true),
  comments: metric('Comments', 'engagement', 'number', 'sum', true),
  shares: metric('Shares', 'engagement', 'number', 'sum', true),
  saves: metric('Saves', 'engagement', 'number', 'sum', true),
  clicks: metric('Clicks', 'clicks', 'number', 'sum', true),
  video_views: metric('Video Views', 'video', 'number', 'sum', true),
  watch_time: metric('Watch Time', 'video', 'duration', 'sum', true),
  minutes_watched: metric('Minutes Watched', 'video', 'number', 'sum', true),
  avg_watch_time: metric(
    'Average Watch Time',
    'video',
    'duration',
    'average',
    false
  ),
  avg_view_percentage: metric(
    'Average View Percentage',
    'video',
    'percent',
    'average',
    false
  ),
  following: metric('Following', 'audience', 'number', 'last', false),
  posts_count: metric('Posts', 'audience', 'number', 'last', false),
  subscribers_gained: metric(
    'Subscribers Gained',
    'audience',
    'number',
    'sum',
    true
  ),
  subscribers_lost: metric(
    'Subscribers Lost',
    'audience',
    'number',
    'sum',
    true
  ),
  unfollows: metric('Unfollows', 'audience', 'number', 'sum', true),
  map_views: metric('Map Views', 'reach', 'number', 'sum', true),
  search_views: metric('Search Views', 'reach', 'number', 'sum', true),
  calls: metric('Calls', 'clicks', 'number', 'sum', true),
  direction_requests: metric(
    'Direction Requests',
    'clicks',
    'number',
    'sum',
    true
  ),
  messages: metric('Messages', 'clicks', 'number', 'sum', true),
  bookings: metric('Bookings', 'clicks', 'number', 'sum', true),
  menu_clicks: metric('Menu Clicks', 'clicks', 'number', 'sum', true),
  pin_clicks: metric('Pin Clicks', 'clicks', 'number', 'sum', true),
  outbound_clicks: metric('Outbound Clicks', 'clicks', 'number', 'sum', true),
  click_rate: metric('Click Rate', 'clicks', 'percent', 'average', false),
  save_rate: metric('Save Rate', 'engagement', 'percent', 'average', false),
  replies: metric('Replies', 'engagement', 'number', 'sum', true),
  reposts: metric('Reposts', 'engagement', 'number', 'sum', true),
  quotes: metric('Quotes', 'engagement', 'number', 'sum', true),
  dislikes: metric('Dislikes', 'engagement', 'number', 'sum', true),
  engaged_accounts: metric(
    'Engaged Accounts',
    'engagement',
    'number',
    'sum',
    true
  ),
  upvote_ratio: metric(
    'Upvote Ratio',
    'engagement',
    'percent',
    'average',
    false
  ),
  score: metric('Score', 'engagement', 'number', 'sum', true),
  karma: metric('Karma', 'audience', 'number', 'last', false),
  engaged_views: metric('Engaged Views', 'video', 'number', 'sum', true),
  total_likes: metric('Total Likes', 'audience', 'number', 'last', false),
  videos_count: metric('Videos', 'audience', 'number', 'last', false),
};

export const analyticsMetricKeys = Object.keys(analyticsMetrics);

// The size of a point of a stored series
export const analyticsGrains = ['day', 'week', 'month'] as const;
export type AnalyticsGrain = (typeof analyticsGrains)[number];

// The grain that keeps a chart of that many days readable
export const analyticsGrainFor = (days: number): AnalyticsGrain =>
  days > 180 ? 'month' : days > 90 ? 'week' : 'day';

// How a published post ranks against the others, by its metrics: its
// engagements, else its likes, comments and shares added up
export const postEngagementScore = (metrics: Record<string, number>) =>
  metrics.engagements ??
  (metrics.likes ?? 0) + (metrics.comments ?? 0) + (metrics.shares ?? 0);

// Days after publishing at which the lifetime totals of a post are stored, and
// the one the insights compare the posts at when none is asked for
export const analyticsPostAges = [1, 3, 7, 14, 30, 90] as const;
export const analyticsPostDefaultAge = 7;
