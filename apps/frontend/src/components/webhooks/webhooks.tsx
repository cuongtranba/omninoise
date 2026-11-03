'use client';

import React, { FC, Fragment, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Input } from '@gitroom/react/form/input';
import { FormProvider, useForm } from 'react-hook-form';
import { array, number, object, string } from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import { Select } from '@gitroom/react/form/select';
import { Checkbox } from '@gitroom/react/form/checkbox';
import {
  analyticsMetrics,
  AnalyticsMetric,
} from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import {
  categoryOrder,
  getAnalyticsMetricName,
  getCategoryTitles,
} from '@gitroom/frontend/components/platform-analytics/analytics.format';
import { PickPlatforms } from '@gitroom/frontend/components/launches/helpers/pick.platform.component';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const useWebhooksList = () => {
  const fetch = useFetch();
  const list = useCallback(async () => {
    return (await fetch('/webhooks')).json();
  }, []);
  return useSWR('webhooks', list);
};

const useWebhookIntegrations = () => {
  const fetch = useFetch();
  const integration = useCallback(async () => {
    return (await fetch('/integrations/list')).json();
  }, []);
  return useSWR('integrations', integration, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

export const Webhooks: FC = () => {
  const fetch = useFetch();
  const user = useUser();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const { data, mutate } = useWebhooksList();
  const scheduleLabels = getScheduleLabels(t);
  const addWebhook = useCallback(
    (data?: any) => () => {
      modal.openModal({
        title: data
          ? t('update_webhook', 'Update webhook')
          : t('add_webhook', 'Add webhook'),
        withCloseButton: true,
        children: <AddOrEditWebhook data={data} reload={mutate} />,
      });
    },
    [t]
  );
  const deleteHook = useCallback(
    (data: any) => async () => {
      if (
        await deleteDialog(
          t(
            'are_you_sure_you_want_to_delete',
            `Are you sure you want to delete ${data.name}?`,
            { name: data.name }
          )
        )
      ) {
        await fetch(`/webhooks/${data.id}`, {
          method: 'DELETE',
        });
        mutate();
        toaster.show(
          t('webhook_deleted_successfully', 'Webhook deleted successfully'),
          'success'
        );
      }
    },
    []
  );

  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">
        {t('webhooks', 'Webhooks')} ({data?.length || 0}/{user?.tier?.webhooks})
      </h3>
      <div className="text-customColor18 mt-[4px]">
        {t(
          'webhooks_are_a_way_to_get_notified_when_something_happens_in_postiz_via_an_http_request',
          'Webhooks are a way to get notified when something happens in Omninoise via\n        an HTTP request.'
        )}
      </div>
      <div className="my-[16px] mt-[16px] bg-sixth border-fifth items-center border rounded-[4px] p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {!!data?.length && (
            <div className="grid grid-cols-[1fr,1fr,1fr,1fr,1fr] w-full gap-y-[10px]">
              <div>{t('name', 'Name')}</div>
              <div>{t('url', 'URL')}</div>
              <div>{t('webhook_type', 'Type')}</div>
              <div>{t('edit', 'Edit')}</div>
              <div>{t('delete', 'Delete')}</div>
              {data?.map((p: any) => (
                <Fragment key={p.id}>
                  <div className="flex flex-col justify-center">{p.name}</div>
                  <div className="flex flex-col justify-center">{p.url}</div>
                  <div className="flex flex-col justify-center">
                    {p.type === 'analytics.report'
                      ? t(
                          'webhook_type_analytics_report_schedule',
                          'Analytics report · {{schedule}}',
                          { schedule: scheduleLabels[p.schedule] || p.schedule }
                        )
                      : p.type === 'post.failed'
                      ? t('webhook_type_post_failed', 'Post failed')
                      : t('webhook_type_post_published', 'Post published')}
                  </div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button onClick={addWebhook(p)}>
                        {t('edit', 'Edit')}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button onClick={deleteHook(p)}>
                        {t('delete', 'Delete')}
                      </Button>
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>
          )}
          <div>
            <Button
              onClick={addWebhook()}
              className={clsx((data?.length || 0) > 0 && 'my-[16px]')}
            >
              {t('add_a_webhook', 'Add a webhook')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
const sectionKeys = ['channels', 'summary', 'topPosts'];
const details = object().shape({
  name: string().required(),
  url: string().url().required(),
  type: string()
    .oneOf(['post.published', 'post.failed', 'analytics.report'])
    .required(),
  integrations: array(),
  schedule: string().when('type', {
    is: 'analytics.report',
    then: (schema) => schema.oneOf(['daily', 'weekly', 'monthly']).required(),
    otherwise: (schema) => schema.nullable(),
  }),
  lookbackDays: number().oneOf([1, 7, 30, 90]),
  metrics: array(string().required()),
  sections: array(string().required()).when('type', {
    is: 'analytics.report',
    then: (schema) => schema.min(1),
  }),
  topPostsLimit: number().min(0).max(10),
});
const getScheduleLabels = (
  t: (key: string, fallback: string) => string
): Record<string, string> => ({
  daily: t('webhook_schedule_daily', 'Daily'),
  weekly: t('webhook_schedule_weekly', 'Weekly'),
  monthly: t('webhook_schedule_monthly', 'Monthly'),
});
const getWebhookOptions = (t: (key: string, fallback: string) => string) => [
  {
    label: t('all_integrations', 'All integrations'),
    value: 'all',
  },
  {
    label: t('specific_integrations', 'Specific integrations'),
    value: 'specific',
  },
];
const usePreviewReport = (
  getBody: () => Record<string, unknown>
): [() => Promise<any>, boolean] => {
  const fetch = useFetch();
  const [loading, setLoading] = useState(false);
  const preview = useCallback(async () => {
    setLoading(true);
    try {
      return await (
        await fetch('/webhooks/analytics/preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(getBody()),
        })
      ).json();
    } finally {
      setLoading(false);
    }
  }, []);
  return [preview, loading];
};

export const AddOrEditWebhook: FC<{
  data?: any;
  reload: () => void;
}> = (props) => {
  const { data, reload } = props;
  const fetch = useFetch();
  const t = useT();
  const options = getWebhookOptions(t);
  const scheduleLabels = getScheduleLabels(t);
  const categoryTitles = getCategoryTitles(t);
  const [allIntegrations, setAllIntegrations] = useState(
    (data?.integrations?.length || 0) > 0 ? options[1] : options[0]
  );
  const [previewData, setPreviewData] = useState<any>(null);
  const modal = useModals();
  const toast = useToaster();
  const form = useForm({
    resolver: yupResolver(details),
    values: {
      name: data?.name || '',
      url: data?.url || '',
      type: data?.type || 'post.published',
      schedule: data?.schedule || 'daily',
      lookbackDays: data?.lookbackDays || 7,
      metrics: data?.metrics || [],
      sections: data?.sections?.length ? data.sections : sectionKeys,
      topPostsLimit: data?.topPostsLimit ?? 5,
      integrations: data?.integrations?.map((p: any) => p.integration) || [],
    },
  });
  const integrations = form.watch('integrations');
  const type = form.watch('type');
  const metrics = form.watch('metrics');
  const sections = form.watch('sections');
  const isAnalytics = type === 'analytics.report';
  const metricGroups = useMemo(() => {
    return categoryOrder
      .map((category) => ({
        category,
        title: categoryTitles[category],
        items: Object.entries(analyticsMetrics).filter(
          ([, metric]: [string, AnalyticsMetric]) =>
            metric.category === category
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [categoryTitles]);
  const changeIntegration = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const findValue = options.find(
        (option) => option.value === e.target.value
      )!;
      setAllIntegrations(findValue);
      if (findValue.value === 'all') {
        form.setValue('integrations', []);
      }
    },
    []
  );
  // Checkboxes keep a stale onChange, so always read the current list from the form
  const toggleListItem = useCallback(
    (field: 'metrics' | 'sections', item: string) => () => {
      const current: string[] = form.getValues(field);
      form.setValue(
        field,
        current.includes(item)
          ? current.filter((p) => p !== item)
          : [...current, item],
        { shouldValidate: true }
      );
    },
    []
  );
  const toggleAllMetrics = useCallback(() => {
    form.setValue('metrics', [], { shouldValidate: true });
  }, []);
  const { data: dataList, isLoading } = useWebhookIntegrations();
  const getReportBody = useCallback(() => {
    const values = form.getValues();
    return {
      integrations: (values.integrations || []).map((p: any) => ({
        id: p.id,
      })),
      lookbackDays: Number(values.lookbackDays),
      metrics: values.metrics,
      sections: values.sections,
      topPostsLimit: Number(values.topPostsLimit),
    };
  }, []);
  const [buildPreview, previewing] = usePreviewReport(getReportBody);
  const callBack = useCallback(
    async (values: any) => {
      const analytics = values.type === 'analytics.report';
      await fetch('/webhooks', {
        method: data?.id ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...(data?.id
            ? {
                id: data.id,
              }
            : {}),
          name: values.name,
          url: values.url,
          type: values.type,
          integrations: values.integrations,
          ...(analytics
            ? {
                schedule: values.schedule,
                lookbackDays: values.lookbackDays,
                metrics: values.metrics,
                sections: values.sections,
                topPostsLimit: values.sections.includes('topPosts')
                  ? values.topPostsLimit
                  : 0,
              }
            : {}),
        }),
      });
      toast.show(
        data?.id
          ? t('webhook_updated_successfully', 'Webhook updated successfully')
          : t('webhook_added_successfully', 'Webhook added successfully'),
        'success'
      );
      modal.closeAll();
      reload();
    },
    [data, integrations]
  );
  const showPreview = useCallback(async () => {
    try {
      setPreviewData(await buildPreview());
    } catch (e: any) {
      /** empty **/
    }
  }, []);
  const sendTest = useCallback(async () => {
    const url = form.getValues('url');
    let body: unknown = [
      {
        id: 'cm6tcts4f0005qcwit25cis26',
        content: 'This is the first post to instagram',
        publishDate: '2025-02-06T13:09:00.000Z',
        releaseURL: 'https://facebook.com/release/release',
        state: 'PUBLISHED',
        integration: {
          id: 'cm6s4uyou0001i2r47pxix6z1',
          name: 'test',
          providerIdentifier: 'instagram',
          picture: 'https://uploads.gitroom.com/F6LSCD8wrrQ.jpeg',
          type: 'social',
        },
      },
      {
        id: 'cm6tcts4f0005qcwit25cis26',
        content: 'This is the second post to facebook',
        publishDate: '2025-02-06T13:09:00.000Z',
        releaseURL: 'https://facebook.com/release2/release2',
        state: 'PUBLISHED',
        integration: {
          id: 'cm6s4uyou0001i2r47pxix6z1',
          name: 'test2',
          providerIdentifier: 'facebook',
          picture: 'https://uploads.gitroom.com/F6LSCD8wrrQ.jpeg',
          type: 'social',
        },
      },
    ];
    try {
      if (form.getValues('type') === 'post.failed') {
        body = (body as any[]).map((post) => ({
          ...post,
          state: 'ERROR',
          releaseURL: null,
          error: '{"message":"fetch failed"}',
        }));
      }
      if (form.getValues('type') === 'analytics.report') {
        body = await buildPreview();
      }
      toast.show(t('webhook_sent', 'Webhook send'), 'success');
      await fetch(`/webhooks/send?url=${encodeURIComponent(url)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      /** empty **/
    }
  }, []);
  const invalid =
    !form.formState.isValid ||
    (allIntegrations.value === 'specific' && !integrations?.length);

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(callBack)}>
        <div className="relative flex gap-[20px] flex-col flex-1 rounded-[4px] pt-0">
          <div>
            <Input
              label="Name"
              translationKey="label_name"
              {...form.register('name')}
            />
            <Input
              label="URL"
              translationKey="label_url"
              {...form.register('url')}
            />
            <Select
              label="Type"
              translationKey="label_webhook_type"
              {...form.register('type')}
            >
              <option value="post.published">
                {t('webhook_type_post_published', 'Post published')}
              </option>
              <option value="post.failed">
                {t('webhook_type_post_failed', 'Post failed')}
              </option>
              <option value="analytics.report">
                {t('webhook_type_analytics_report', 'Analytics report')}
              </option>
            </Select>
            {isAnalytics && (
              <>
                <Select
                  label="Schedule"
                  translationKey="label_webhook_schedule"
                  {...form.register('schedule')}
                >
                  {Object.entries(scheduleLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Lookback"
                  translationKey="label_webhook_lookback"
                  {...form.register('lookbackDays')}
                >
                  <option value={1}>
                    {t('webhook_lookback_1', 'Last day')}
                  </option>
                  <option value={7}>
                    {t('webhook_lookback_7', 'Last 7 days')}
                  </option>
                  <option value={30}>
                    {t('webhook_lookback_30', 'Last 30 days')}
                  </option>
                  <option value={90}>
                    {t('webhook_lookback_90', 'Last 90 days')}
                  </option>
                </Select>
                <div className="flex flex-col gap-[6px] mb-[16px]">
                  <div className="text-[14px]">
                    {t('webhook_sections', 'Sections')}
                  </div>
                  <Checkbox
                    disableForm={true}
                    checked={sections.includes('channels')}
                    onChange={toggleListItem('sections', 'channels')}
                    label={t('webhook_section_channels', 'Channel metrics')}
                  />
                  <Checkbox
                    disableForm={true}
                    checked={sections.includes('summary')}
                    onChange={toggleListItem('sections', 'summary')}
                    label={t(
                      'webhook_section_summary',
                      'Cross-channel summary'
                    )}
                  />
                  <Checkbox
                    disableForm={true}
                    checked={sections.includes('topPosts')}
                    onChange={toggleListItem('sections', 'topPosts')}
                    label={t('webhook_section_top_posts', 'Top posts')}
                  />
                </div>
                {sections.includes('topPosts') && (
                  <Select
                    label="Top posts"
                    translationKey="label_webhook_top_posts"
                    {...form.register('topPostsLimit')}
                  >
                    {Array.from({ length: 11 }, (_, i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </Select>
                )}
                <div className="flex flex-col gap-[10px] mb-[16px]">
                  <div className="text-[14px]">
                    {t('webhook_metrics', 'Metrics')}
                  </div>
                  <Checkbox
                    disableForm={true}
                    checked={!metrics.length}
                    onChange={toggleAllMetrics}
                    label={t('webhook_all_metrics', 'All metrics')}
                  />
                  {metricGroups.map((group) => (
                    <div
                      key={group.category}
                      className="flex flex-col gap-[6px]"
                    >
                      <div className="text-[13px] opacity-60">
                        {group.title}
                      </div>
                      <div className="grid grid-cols-2 gap-[6px]">
                        {group.items.map(([key, metric]) => (
                          <Checkbox
                            key={key}
                            disableForm={true}
                            checked={metrics.includes(key)}
                            onChange={toggleListItem('metrics', key)}
                            label={getAnalyticsMetricName(t, {
                              key,
                              label: metric.label,
                            })}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <Select
              value={allIntegrations.value}
              name="integrations"
              label="Integrations"
              translationKey="label_integrations"
              disableForm={true}
              onChange={changeIntegration}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {allIntegrations.value === 'specific' && dataList && !isLoading && (
              <PickPlatforms
                integrations={dataList.integrations}
                selectedIntegrations={integrations as any[]}
                onChange={(e) => form.setValue('integrations', e)}
                singleSelect={false}
                toolTip={true}
                isMain={true}
              />
            )}
            {isAnalytics && !!previewData && (
              <pre className="mt-[16px] max-h-[300px] overflow-auto text-[12px] bg-newTableHeader border border-newTableBorder rounded-[8px] p-[12px]">
                {JSON.stringify(previewData, null, 2)}
              </pre>
            )}
            <div className="flex gap-[10px]">
              <Button type="submit" className="mt-[24px]" disabled={invalid}>
                {t('save', 'Save')}
              </Button>
              {isAnalytics && (
                <Button
                  type="button"
                  secondary={true}
                  className="mt-[24px]"
                  onClick={showPreview}
                  loading={previewing}
                  disabled={invalid}
                >
                  {t('preview', 'Preview')}
                </Button>
              )}
              <Button
                type="button"
                secondary={true}
                className="mt-[24px]"
                onClick={sendTest}
                disabled={invalid}
              >
                {t('send_test', 'Send Test')}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </FormProvider>
  );
};
