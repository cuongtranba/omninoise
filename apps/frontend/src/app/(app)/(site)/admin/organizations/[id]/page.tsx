import { useParams } from 'react-router';
import { AdminOrganizationComponent } from '@gitroom/frontend/components/admin/admin-organization.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Page() {
  const { isGeneral } = useVariables();
  const { id } = useParams();
  return (
    <>
      <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} Admin Organization`}</title>
      <div className="bg-newBgColorInner flex-1 flex-col flex p-[20px] gap-[12px]">
        <AdminOrganizationComponent id={id || ''} />
      </div>
    </>
  );
}
