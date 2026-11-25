'use client';

import { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { CopyButton } from '@gitroom/frontend/components/public-api/public.component';

type ProviderAppFamily = {
  family: string;
  instanceApp: boolean;
  providers: { identifier: string; name: string; redirectUri: string }[];
  app: {
    id: string;
    clientId: string;
    updatedAt: string;
    channels: number;
  } | null;
};

const useProviderApps = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await (
      await fetch('/provider-apps')
    ).json()) as ProviderAppFamily[];
  }, []);
  return useSWR('provider-apps', load, {
    revalidateOnFocus: false,
  });
};

const ProviderAppCard: FC<{
  family: ProviderAppFamily;
  onChange: () => void;
}> = ({ family, onChange }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const decision = useDecisionModal();
  const t = useT();
  const [clientId, setClientId] = useState(family.app?.clientId || '');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const showError = useCallback(
    async (response: Response, fallback: string) => {
      const { message }: { message?: string | string[] } = await response
        .json()
        .catch(() => ({}));
      toaster.show(
        (Array.isArray(message) ? message[0] : message) || fallback,
        'warning'
      );
    },
    []
  );

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const response = await fetch(`/provider-apps/${family.family}`, {
        method: 'PUT',
        body: JSON.stringify({
          clientId: clientId.trim(),
          ...(clientSecret ? { clientSecret: clientSecret.trim() } : {}),
        }),
      });
      if (!response.ok) {
        await showError(
          response,
          t('could_not_save_the_app', 'Could not save the app')
        );
        return;
      }
      setClientSecret('');
      toaster.show(t('app_saved', 'App saved'), 'success');
      onChange();
    } finally {
      setSaving(false);
    }
  }, [family.family, clientId, clientSecret]);

  const remove = useCallback(async () => {
    const approved = await decision.open({
      title: t('delete_platform_app', 'Delete this app?'),
      description: t(
        'delete_platform_app_description',
        'New channels will connect through the server app again.'
      ),
      approveLabel: t('delete', 'Delete'),
      cancelLabel: t('cancel', 'Cancel'),
    });
    if (!approved) {
      return;
    }
    const response = await fetch(`/provider-apps/${family.family}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      await showError(
        response,
        t('could_not_delete_the_app', 'Could not delete the app')
      );
      return;
    }
    setClientId('');
    setClientSecret('');
    toaster.show(t('app_deleted', 'App deleted'), 'success');
    onChange();
  }, [family.family]);

  return (
    <div className="bg-newBgColorInner rounded-[12px] border border-newBorder overflow-hidden">
      <div className="px-[20px] mobile:px-[14px] py-[14px] border-b border-newBorder flex items-start justify-between gap-[12px] mobile:flex-col">
        <div className="text-[15px] font-[600]">
          {family.providers.map((p) => p.name).join(', ')}
        </div>
        <div className="text-[13px] text-textItemBlur shrink-0">
          {family.app
            ? t('your_app', 'Your app')
            : family.instanceApp
              ? t('server_app', 'Server app')
              : t('no_app', 'No app')}
        </div>
      </div>
      <div className="p-[20px] mobile:p-[14px] flex flex-col gap-[16px]">
        <div className="flex flex-col gap-[6px]">
          <label className="text-[13px] font-[600] text-textItemBlur">
            {t('redirect_uris', 'Redirect URIs to add to your app')}
          </label>
          {family.providers.map((p) => (
            <div
              key={p.identifier}
              className="flex items-center gap-[8px] mobile:flex-col mobile:items-start"
            >
              <code className="flex-1 min-w-0 break-all text-[13px] bg-newBgColor border border-newBorder rounded-[8px] px-[12px] py-[8px]">
                {p.redirectUri}
              </code>
              <CopyButton text={p.redirectUri} label={t('copy', 'Copy')} />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-[6px]">
          <label className="text-[13px] font-[600] text-textItemBlur">
            {t('client_id', 'Client ID')}
          </label>
          <input
            className="bg-newBgColorInner border border-newBorder rounded-[8px] px-[16px] h-[44px] text-textColor outline-none"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            maxLength={500}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-[6px]">
          <label className="text-[13px] font-[600] text-textItemBlur">
            {t('client_secret', 'Client Secret')}
          </label>
          <input
            type="password"
            className="bg-newBgColorInner border border-newBorder rounded-[8px] px-[16px] h-[44px] text-textColor outline-none"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={
              family.app
                ? t(
                    'leave_empty_to_keep_the_secret',
                    'Leave empty to keep the saved secret'
                  )
                : ''
            }
            maxLength={1000}
            autoComplete="new-password"
          />
        </div>
        {!!family.app && (
          <div className="text-[13px] text-textItemBlur">
            {t('channels_using_this_app', 'Channels using this app')}:{' '}
            {family.app.channels}
          </div>
        )}
        <div className="flex gap-[8px]">
          <button
            type="button"
            disabled={saving || !clientId.trim()}
            onClick={save}
            className="cursor-pointer px-[20px] h-[44px] bg-brand hover:bg-brandHover transition-colors text-white rounded-[8px] text-[15px] font-[600] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('save', 'Save')}
          </button>
          {!!family.app && (
            <button
              type="button"
              onClick={remove}
              className="cursor-pointer px-[20px] h-[44px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[15px] font-[600]"
            >
              {t('delete', 'Delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const ProviderAppsComponent: FC = () => {
  const t = useT();
  const { data, mutate } = useProviderApps();

  if (!data) {
    return null;
  }

  return (
    <div className="flex flex-col gap-[24px]">
      <div className="text-[14px] text-textColor leading-[1.7]">
        {t(
          'platform_apps_note',
          'Connect new channels through your own developer app instead of the server app. Channels already connected keep the app they were connected with.'
        )}
        <br />
        {t(
          'platform_apps_live_hint',
          'Your app must be Live, and people who are not admins of the app need Advanced Access to its permissions.'
        )}
      </div>
      {data.map((family) => (
        <ProviderAppCard
          key={family.family}
          family={family}
          onChange={() => mutate()}
        />
      ))}
    </div>
  );
};
