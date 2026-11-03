import { PlatformAnalytics } from '@gitroom/frontend/components/platform-analytics/platform.analytics';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Index() {
  const { isGeneral } = useVariables();
  return (
    <>
      <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} Analytics`}</title>
      <PlatformAnalytics />
    </>
  );
}
