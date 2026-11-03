import { SentryComponent } from '@gitroom/frontend/components/layout/sentry.component';
import LayoutContext from '@gitroom/frontend/components/layout/layout.context';
import { VariableContextComponent } from '@gitroom/react/helpers/variable.context';
import UtmSaver from '@gitroom/helpers/utils/utm.saver';
import { DubAnalytics } from '@gitroom/frontend/components/layout/dubAnalytics';
import { FacebookComponent } from '@gitroom/frontend/components/layout/facebook.component';
import { GoogleTagManagerComponent } from '@gitroom/frontend/components/layout/gtm.component';
import {
  cookieName,
  fallbackLng,
} from '@gitroom/react/translation/i18n.config';
import { HtmlComponent } from '@gitroom/frontend/components/layout/html.component';
import { ChangeDirClient } from '@gitroom/frontend/components/new-layout/change.dir.client';
import { RouteGuard } from '@gitroom/frontend/app/route.guard';
import { ScrollRestoration } from 'react-router';

const readLanguage = () =>
  decodeURIComponent(
    document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith(`${cookieName}=`))
      ?.split('=')[1] || ''
  ) || fallbackLng;

export default function AppLayout() {
  const config = window.__RUNTIME_CONFIG__;
  return (
    <VariableContextComponent {...config} language={readLanguage()}>
      <SentryComponent>
        <HtmlComponent />
        {!!config.datafastWebsiteId && (
          <script
            async
            data-website-id={config.datafastWebsiteId}
            data-domain="postiz.com"
            src="https://datafa.st/js/script.js"
          />
        )}
        {!!config.plausibleDomain && (
          <script
            async
            defer
            data-domain={config.plausibleDomain}
            src="https://plausible.io/js/script.js"
          />
        )}
        <ChangeDirClient />
        <DubAnalytics />
        <FacebookComponent />
        <GoogleTagManagerComponent gtmId={config.googleAdsId} />
        <LayoutContext>
          <UtmSaver />
          <RouteGuard />
        </LayoutContext>
        {/* Navigations start at the top of the page, as they did under Next. */}
        <ScrollRestoration />
      </SentryComponent>
    </VariableContextComponent>
  );
}
