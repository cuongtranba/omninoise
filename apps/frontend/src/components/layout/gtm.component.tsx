'use client';

import { FC, useEffect } from 'react';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useVariables } from '@gitroom/react/helpers/variable.context';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export const TrialTracker: FC = () => {
  const user = useUser();
  const { googleAdsId, googleAdsTrialTracking } = useVariables();
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !user?.id ||
      !window.gtag ||
      !googleAdsId ||
      !googleAdsTrialTracking
    )
      return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('trialStart') !== 'true') return;
    const key = `gtm_start_trial_${user?.id}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    window.gtag('event', 'conversion', {
      send_to: `${googleAdsId}/${googleAdsTrialTracking}`,
      transaction_id: user.id,
    });
  }, [user]);
  return null;
};

export const GoogleTagManagerComponent: FC<{ gtmId?: string }> = ({
  gtmId,
}) => {
  useEffect(() => {
    // like next/script, an id keeps the tag from loading twice
    if (!gtmId || document.getElementById('google-ads-gtag')) {
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-ads-gtag';
    script.src = '/g.js';
    document.body.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      // gtag.js only understands the arguments object, not an array
      // oxlint-disable-next-line prefer-rest-params
      window.dataLayer?.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', gtmId);
  }, [gtmId]);
  return null;
};
