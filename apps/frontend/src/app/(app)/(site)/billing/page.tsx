import { BillingComponent } from '@gitroom/frontend/components/billing/billing.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Page() {
  const { isGeneral } = useVariables();
  return (
    <>
      <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} Billing`}</title>
      <div className="bg-newBgColorInner flex-1 flex-col flex p-[20px] gap-[12px]">
        <BillingComponent />
      </div>
    </>
  );
}
