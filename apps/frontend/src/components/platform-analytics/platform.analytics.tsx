'use client';

import useSWR from 'swr';
import { useCallback, useMemo, useState } from 'react';
import { orderBy } from 'lodash';
import clsx from 'clsx';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { RenderAnalytics } from '@gitroom/frontend/components/platform-analytics/render.analytics';
import { OverviewAnalytics } from '@gitroom/frontend/components/platform-analytics/overview.analytics';
import { Select } from '@gitroom/react/form/select';
import { Button } from '@gitroom/react/form/button';
import { useNavigate } from 'react-router';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import useCookie from 'react-use-cookie';
import { SVGLine } from '@gitroom/frontend/components/launches/launches.component';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
const useAnalyticsIntegrations = () => {
  const fetch = useFetch();
  const { disableXAnalytics } = useVariables();
  const load = useCallback(async () => {
    return (
      await (await fetch('/integrations/list')).json()
    ).integrations.filter((f: any) => {
      if (f.identifier === 'x' && disableXAnalytics) {
        return false;
      }
      return !!f.analytics;
    });
  }, [disableXAnalytics]);

  return useSWR('analytics-list', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: [],
  });
};

export const PlatformAnalytics = () => {
  const t = useT();
  const navigate = useNavigate();

  // -1 selects the Overview entry
  const [current, setCurrent] = useState(-1);
  const [key, setKey] = useState(7);
  const [refresh, setRefresh] = useState(false);
  const [collapseMenu, setCollapseMenu] = useCookie('collapseMenu', '0');
  const toaster = useToaster();
  const { data, isLoading } = useAnalyticsIntegrations();
  const sortedIntegrations = useMemo(() => {
    return orderBy(
      data,
      ['type', 'disabled', 'identifier'],
      ['desc', 'asc', 'asc']
    );
  }, [data]);
  const currentIntegration = useMemo(() => {
    return sortedIntegrations[current];
  }, [current, sortedIntegrations]);
  const options = useMemo(() => {
    const labels: Record<number, string> = {
      7: t('7_days', '7 Days'),
      30: t('30_days', '30 Days'),
      90: t('90_days', '90 Days'),
    };
    const days = currentIntegration
      ? currentIntegration.analyticsDays || []
      : [7, 30, 90];
    return days
      .filter((day: number) => !!labels[day])
      .map((day: number) => ({ key: day, value: labels[day] }));
  }, [currentIntegration, t]);
  const keys = useMemo(() => {
    if (options.find((p: { key: number }) => p.key === key)) {
      return key;
    }
    return options[0]?.key;
  }, [key, options]);

  if (isLoading) {
    return (
      <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[15px] transition-all items-center justify-center">
        <LoadingComponent />
      </div>
    );
  }

  if (!sortedIntegrations.length && !isLoading) {
    return (
      <div className="bg-newBgColorInner p-[20px] flex flex-col gap-[15px] transition-all flex-1 justify-center items-center text-center">
        <div>
          <img src="/peoplemarketplace.svg" />
        </div>
        <div className="text-[48px]">
          {t('can_t_show_analytics_yet', "Can't show analytics yet")}
          <br />
          {t(
            'you_have_to_add_social_media_channels',
            'You have to add Social Media channels'
          )}
        </div>
        <Button onClick={() => navigate('/launches')}>
          {t(
            'go_to_the_calendar_to_add_channels',
            'Go to the calendar to add channels'
          )}
        </Button>
      </div>
    );
  }
  return (
    <>
      <div
        className={clsx(
          'bg-newBgColorInner p-[20px] mobile:p-[12px] flex flex-col gap-[15px] transition-all mobile:w-full',
          collapseMenu === '1' ? 'group sidebar w-[100px]' : 'w-[260px]'
        )}
      >
        <div className="flex gap-[12px] flex-col">
          <div className="flex items-center mobile:hidden">
            <h2 className="group-[.sidebar]:hidden flex-1 text-[20px] font-[500]">
              {t('channels')}
            </h2>
            <div
              onClick={() => setCollapseMenu(collapseMenu === '1' ? '0' : '1')}
              className="group-[.sidebar]:rotate-[180deg] group-[.sidebar]:mx-auto text-btnText bg-btnSimple rounded-[6px] w-[24px] h-[24px] flex items-center justify-center cursor-pointer select-none"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="7"
                height="13"
                viewBox="0 0 7 13"
                fill="none"
              >
                <path
                  d="M6 11.5L1 6.5L6 1.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
          <div className="flex gap-[15px] mobile:gap-[12px] flex-col mobile:flex-row mobile:overflow-x-auto mobile:ps-[12px] mobile:pt-[6px] mobile:pb-[6px] scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
            <div
              onClick={() => {
                setRefresh(true);
                setTimeout(() => {
                  setRefresh(false);
                }, 10);
                setCurrent(-1);
              }}
              className={clsx(
                'flex gap-[12px] items-center group/profile justify-center hover:bg-boxHover rounded-e-[8px] mobile:shrink-0',
                !!currentIntegration &&
                  'opacity-20 hover:opacity-100 cursor-pointer'
              )}
            >
              <div className="h-full w-[4px] -ms-[12px] rounded-s-[3px] opacity-0 group-hover/profile:opacity-100 transition-opacity">
                <SVGLine />
              </div>
              <div className="w-[36px] h-[36px] rounded-[8px] bg-btnSimple text-btnText flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </div>
              <div className="flex-1 whitespace-nowrap text-ellipsis overflow-hidden group-[.sidebar]:hidden mobile:hidden">
                {t('analytics_overview', 'Overview')}
              </div>
            </div>
            {sortedIntegrations.map((integration, index) => (
              <div
                key={integration.id}
                onClick={() => {
                  if (integration.refreshNeeded) {
                    toaster.show(
                      'Please refresh the integration from the calendar',
                      'warning'
                    );
                    return;
                  }
                  setRefresh(true);
                  setTimeout(() => {
                    setRefresh(false);
                  }, 10);
                  setCurrent(index);
                }}
                className={clsx(
                  'flex gap-[12px] items-center group/profile justify-center hover:bg-boxHover rounded-e-[8px] mobile:shrink-0',
                  currentIntegration?.id !== integration.id &&
                    'opacity-20 hover:opacity-100 cursor-pointer'
                )}
              >
                <div
                  className={clsx(
                    'relative rounded-full flex justify-center items-center gap-[6px]',
                    integration.disabled && 'opacity-50'
                  )}
                >
                  {(integration.inBetweenSteps ||
                    integration.refreshNeeded) && (
                    <div className="absolute start-0 top-0 w-[39px] h-[46px] cursor-pointer">
                      <div className="bg-red-500 w-[15px] h-[15px] rounded-full start-0 top-[5px] absolute z-[200] text-[10px] flex justify-center items-center">
                        !
                      </div>
                      <div className="bg-primary/60 w-[39px] h-[46px] start-0 top-0 absolute rounded-full z-[199]" />
                    </div>
                  )}
                  <div className="h-full w-[4px] -ms-[12px] rounded-s-[3px] opacity-0 group-hover/profile:opacity-100 transition-opacity">
                    <SVGLine />
                  </div>
                  <ImageWithFallback
                    fallbackSrc={`/icons/platforms/${integration.identifier}.png`}
                    src={integration.picture}
                    className="rounded-[8px]"
                    alt={integration.identifier}
                    width={36}
                    height={36}
                  />
                  <SafeImage
                    src={`/icons/platforms/${integration.identifier}.png`}
                    className="rounded-[8px] absolute z-10 bottom-[5px] -end-[5px] border border-fifth"
                    alt={integration.identifier}
                    width={18.41}
                    height={18.41}
                  />
                </div>
                <div
                  className={clsx(
                    'flex-1 whitespace-nowrap text-ellipsis overflow-hidden group-[.sidebar]:hidden mobile:hidden',
                    integration.disabled && 'opacity-50'
                  )}
                >
                  {integration.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="bg-newBgColorInner flex-1 flex-col flex p-[20px] mobile:p-[12px] gap-[12px]">
        {!!options.length && (
          <div className="flex-1 flex flex-col gap-[14px]">
            <div className="max-w-[200px]">
              <Select
                label=""
                name="date"
                disableForm={true}
                hideErrors={true}
                value={keys}
                onChange={(e) => setKey(+e.target.value)}
              >
                {options.map((option: { key: number; value: string }) => (
                  <option key={option.key} value={option.key}>
                    {option.value}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex-1">
              {!!keys && !refresh && !currentIntegration && (
                <OverviewAnalytics date={keys} />
              )}
              {!!keys && !!currentIntegration && !refresh && (
                <RenderAnalytics integration={currentIntegration} date={keys} />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};
