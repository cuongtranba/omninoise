'use client';

import React, { lazy, Suspense } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import AuthenticationComponent from '@gitroom/frontend/components/settings/authentication.component';
import EmailNotificationsComponent from '@gitroom/frontend/components/settings/email-notifications.component';
import ShortlinkPreferenceComponent from '@gitroom/frontend/components/settings/shortlink-preference.component';
import DeleteAccountComponent from '@gitroom/frontend/components/settings/delete-account.component';

const MetricComponent = lazy(
  () => import('@gitroom/frontend/components/settings/metric.component')
);

export const GlobalSettings = () => {
  const t = useT();
  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">{t('global_settings', 'Global Settings')}</h3>
      <AuthenticationComponent />
      <Suspense fallback={null}>
        <MetricComponent />
      </Suspense>
      <EmailNotificationsComponent />
      <ShortlinkPreferenceComponent />
      <DeleteAccountComponent />
    </div>
  );
};
