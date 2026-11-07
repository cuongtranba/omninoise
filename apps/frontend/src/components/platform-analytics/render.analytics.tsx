import { FC, useCallback, useMemo } from 'react';
import { Integration } from '@prisma/client';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { ChartSocial } from '@gitroom/frontend/components/analytics/chart-social';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { analyticsGrainFor } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import {
  AnalyticsDataItem,
  categoryOrder,
  formatAnalyticsItem,
  getAnalyticsMetricName,
  getCategoryTitles,
} from '@gitroom/frontend/components/platform-analytics/analytics.format';

export const TrendIndicator: FC<{
  value?: number;
  percentagePoints?: boolean;
  days: number;
}> = ({ value, percentagePoints, days }) => {
  const t = useT();
  // 0 means there is no previous period to compare with
  if (!value) return null;

  const isPositive = value > 0;
  const displayValue = Math.abs(value).toFixed(1);

  return (
    <div
      title={t('vs_previous_days', 'vs previous {{days}} days', { days })}
      className={`flex items-center gap-[4px] text-[13px] font-medium ${
        isPositive ? 'text-[#32d583]' : 'text-[#f97066]'
      }`}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        className={isPositive ? '' : 'rotate-180'}
      >
        <path d="M6 2.5L10 7.5H2L6 2.5Z" fill="currentColor" />
      </svg>
      <span>
        {displayValue}
        {percentagePoints ? 'pp' : '%'}
      </span>
    </div>
  );
};

const AnalyticsCard: FC<{
  item: AnalyticsDataItem;
  total: string;
  index: number;
  days: number;
}> = ({ item, total, index, days }) => {
  const t = useT();
  const colorVariants = ['purple', 'green', 'blue'] as const;
  const color = colorVariants[index % colorVariants.length];

  const hasDataPoints = item.data.length >= 1;

  return (
    <div className="group relative">
      <div
        className={`
          flex flex-col h-full
          bg-newTableHeader
          border border-newTableBorder
          rounded-[12px]
          overflow-hidden
          transition-all duration-200
          hover:border-brand/50
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-[16px] pt-[14px] pb-[8px]">
          <div className="flex items-center gap-[10px]">
            <div
              className={`
                w-[8px] h-[8px] rounded-full
                ${color === 'purple' ? 'bg-brand' : ''}
                ${color === 'green' ? 'bg-[#32d583]' : ''}
                ${color === 'blue' ? 'bg-[#1d9bf0]' : ''}
              `}
            />
            <span className="text-[15px] font-medium text-newTableText">
              {getAnalyticsMetricName(t, item)}
            </span>
          </div>
          <TrendIndicator
            value={item.percentageChange}
            percentagePoints={item.format === 'percent' || item.average}
            days={days}
          />
        </div>

        {/* Content */}
        {hasDataPoints ? (
          <>
            {/* Chart */}
            <div className="flex-1 px-[12px] py-[8px]">
              <div className="h-[120px] relative">
                <ChartSocial
                  data={item.data}
                  color={color}
                  aggregate={
                    item.aggregate || (item.average ? 'average' : 'sum')
                  }
                  key={`chart-${index}`}
                />
              </div>
            </div>

            {/* Value */}
            <div className="px-[16px] pb-[14px]">
              <div className="text-[36px] leading-[42px] font-semibold tracking-tight">
                {total}
              </div>
              {item.data.length === 1 && (
                <div className="text-[12px] text-newTableText opacity-60">
                  {t('current_total', 'Current total')}
                </div>
              )}
            </div>
          </>
        ) : (
          /* Single value display */
          <div className="flex-1 flex flex-col items-center justify-center py-[32px] px-[16px]">
            <div className="text-[48px] leading-[56px] font-semibold tracking-tight">
              {total}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const EmptyState: FC<{ onRefresh: () => void }> = ({ onRefresh }) => {
  const t = useT();

  return (
    <div className="col-span-full flex flex-col items-center justify-center py-[48px] px-[24px] bg-newTableHeader border border-newTableBorder rounded-[12px]">
      <div className="w-[48px] h-[48px] mb-[16px] rounded-full bg-brand/10 flex items-center justify-center">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-brand"
        >
          <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path d="M12 8v4l2 2" />
        </svg>
      </div>
      <p className="text-[15px] text-newTableText text-center mb-[12px]">
        {t(
          'this_channel_needs_to_be_refreshed',
          'This channel needs to be refreshed to display analytics'
        )}
      </p>
      <button
        onClick={onRefresh}
        className="inline-flex items-center gap-[6px] px-[16px] py-[8px] text-[14px] font-medium text-white bg-brand hover:bg-brandHover rounded-[8px] transition-colors"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
        {t('refresh_channel', 'Refresh Channel')}
      </button>
    </div>
  );
};

const useIntegrationAnalytics = (
  integrationId: string,
  date: number,
  enabled: boolean
) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch(`/analytics/${integrationId}?date=${date}`)).json();
  }, [integrationId, date]);

  return useSWR<AnalyticsDataItem[]>(
    enabled ? `/analytics-${integrationId}-${date}` : null,
    load,
    {
      refreshInterval: 0,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      refreshWhenOffline: false,
      revalidateOnMount: true,
    }
  );
};

// The stored days of the channel for the `date` days up to today, in the
// points that keep the chart readable
const useIntegrationHistory = (
  integrationId: string,
  date: number,
  enabled: boolean
) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const from = new Date(Date.now() - (date - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    return (
      await fetch(
        `/analytics/${integrationId}/history?from=${from}&grain=${analyticsGrainFor(date)}`
      )
    ).json();
  }, [integrationId, date]);

  return useSWR<AnalyticsDataItem[]>(
    enabled ? `/analytics-history-${integrationId}-${date}` : null,
    load,
    {
      refreshInterval: 0,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      refreshWhenOffline: false,
      revalidateOnMount: true,
    }
  );
};

export const RenderAnalytics: FC<{
  integration: Integration;
  date: number;
  history?: boolean;
}> = (props) => {
  const { integration, date, history } = props;
  const fetch = useFetch();
  const t = useT();
  const live = useIntegrationAnalytics(integration.id, date, !history);
  const stored = useIntegrationHistory(integration.id, date, !!history);
  const { data, isLoading } = history ? stored : live;

  const refreshChannel = useCallback(
    (
      integrationData: Integration & {
        identifier: string;
      }
    ) =>
      async () => {
        const { url } = await (
          await fetch(
            `/integrations/social/${integrationData.identifier}?refresh=${integrationData.internalId}`,
            {
              method: 'GET',
            }
          )
        ).json();
        window.location.href = url;
      },
    []
  );

  const sections = useMemo(() => {
    const titles = getCategoryTitles(t);
    const grouped = new Map<
      string,
      Array<{ item: AnalyticsDataItem; index: number }>
    >();
    (data || []).forEach((item, index) => {
      const category = item.category || 'other';
      grouped.set(category, [
        ...(grouped.get(category) || []),
        { item, index },
      ]);
    });
    return [...categoryOrder, 'other']
      .filter((category) => grouped.has(category))
      .map((category) => ({
        category,
        title: titles[category],
        items: grouped.get(category)!,
      }));
  }, [data, t]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-[48px]">
        <LoadingComponent />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[24px]">
      {data?.length === 0 && !history && (
        <div className="grid grid-cols-1">
          <EmptyState onRefresh={refreshChannel(integration as any)} />
        </div>
      )}
      {data?.length === 0 && !!history && (
        <div className="flex flex-col items-center justify-center py-[48px] px-[24px] bg-newTableHeader border border-newTableBorder rounded-[12px]">
          <p className="text-[15px] text-newTableText text-center">
            {t(
              'analytics_history_empty',
              'No history stored for this channel yet, it builds up every day'
            )}
          </p>
        </div>
      )}
      {sections.map((section) => (
        <div key={section.category} className="flex flex-col gap-[12px]">
          <h3 className="text-[16px] font-[500]">{section.title}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[16px]">
            {section.items.map(({ item, index }) => (
              <AnalyticsCard
                key={`analytics-${index}`}
                item={item}
                total={formatAnalyticsItem(item)}
                index={index}
                days={date}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
