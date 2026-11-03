import { AfterActivate } from '@gitroom/frontend/components/auth/after.activate';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Auth() {
  const { isGeneral } = useVariables();
  return (
    <>
      <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} - Activate your account`}</title>
      <AfterActivate />
    </>
  );
}
