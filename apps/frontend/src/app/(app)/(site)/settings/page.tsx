import { SettingsPopup } from '@gitroom/frontend/components/layout/settings.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Index() {
  const { isGeneral } = useVariables();
  return (
    <>
      <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} Settings`}</title>
      <SettingsPopup />
    </>
  );
}
