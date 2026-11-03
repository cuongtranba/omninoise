import { Forgot } from '@gitroom/frontend/components/auth/forgot';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Auth() {
  const { isGeneral } = useVariables();
  return (
    <>
      <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} Forgot Password`}</title>
      <Forgot />
    </>
  );
}
