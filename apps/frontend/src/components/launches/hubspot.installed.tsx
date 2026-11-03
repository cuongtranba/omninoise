'use client';

import { FC, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// /oauth/hubspot/callback sends people here after they install the Postiz
// app in HubSpot, and the calendar alone doesn't say what just happened
export const HubspotInstalled: FC = () => {
  const [searchParams] = useSearchParams();
  const installed = searchParams.get('hubspot') === 'installed';
  const modal = useDecisionModal();
  const navigate = useNavigate();
  const t = useT();
  const shown = useRef(false);

  useEffect(() => {
    if (!installed || shown.current) {
      return;
    }
    shown.current = true;
    (async () => {
      await modal.open({
        title: t('hubspot_installed', 'Omninoise is installed in HubSpot'),
        onlyApprove: true,
        approveLabel: t('ok', 'OK'),
        description: t(
          'hubspot_installed_description',
          'Connect the channels you want to post to here in Omninoise. Then, in HubSpot, open Agent Hub > Agent Builder, add a tool, pick Omninoise MCP under MCP Servers and click Connect and add.'
        ),
      });
      // like Onboarding, drop the param once closed so a calendar reload
      // doesn't show it again
      navigate('/launches', { replace: true });
    })();
  }, [installed]);

  return null;
};
