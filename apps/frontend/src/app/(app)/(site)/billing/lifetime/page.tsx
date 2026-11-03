import { LifetimeDeal } from '@gitroom/frontend/components/billing/lifetime.deal';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Page() {
  const { isGeneral } = useVariables();
  return (
    <>
      <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} Lifetime deal`}</title>
      <LifetimeDeal />
    </>
  );
}
