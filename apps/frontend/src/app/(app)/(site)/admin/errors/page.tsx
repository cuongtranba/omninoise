import { AdminErrorsComponent } from '@gitroom/frontend/components/admin/admin-errors.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Page() {
  const { isGeneral } = useVariables();
  return (
    <>
      <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} Admin Errors`}</title>
      <div className="bg-newBgColorInner flex-1 flex-col flex p-[20px] gap-[12px]">
        <AdminErrorsComponent />
      </div>
    </>
  );
}
