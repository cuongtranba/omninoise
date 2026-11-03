import { MediaLayoutComponent } from '@gitroom/frontend/components/new-layout/layout.media.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Page() {
  const { isGeneral } = useVariables();
  return (
    <>
      <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} Media`}</title>
      <MediaLayoutComponent />
    </>
  );
}
