import { LaunchesComponent } from '@gitroom/frontend/components/launches/launches.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Index() {
  const { isGeneral } = useVariables();
  return (
    <>
      <title>{isGeneral ? 'Omninoise Calendar' : 'Gitroom Launches'}</title>
      <LaunchesComponent />
    </>
  );
}
