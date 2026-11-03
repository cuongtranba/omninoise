import LayoutContext from '@gitroom/frontend/components/layout/layout.context';
import { VariableContextComponent } from '@gitroom/react/helpers/variable.context';
import UtmSaver from '@gitroom/helpers/utils/utm.saver';
import { RouteGuard } from '@gitroom/frontend/app/route.guard';

export default function ExtensionLayout() {
  return (
    <VariableContextComponent
      {...window.__RUNTIME_CONFIG__}
      language="en"
      stripeClient=""
      dub={false}
      isChatBase={false}
      googleAdsId={undefined}
      googleAdsTrialTracking={undefined}
      recaptchaSiteKey={undefined}
    >
      <LayoutContext>
        <UtmSaver />
        <RouteGuard />
      </LayoutContext>
    </VariableContextComponent>
  );
}
