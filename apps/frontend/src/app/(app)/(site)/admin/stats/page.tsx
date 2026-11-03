import { AdminStatsComponent } from '@gitroom/frontend/components/admin/admin-stats.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Page() {
  const { isGeneral } = useVariables();
  return (
    <>
      <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} Admin Stats`}</title>
      <div className="bg-newBgColorInner flex-1 min-w-0 flex-col flex p-[20px] gap-[12px]">
        <AdminStatsComponent />
      </div>
    </>
  );
}
