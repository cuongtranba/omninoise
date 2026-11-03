import { Login } from '@gitroom/frontend/components/auth/login';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Auth() {
  const { isGeneral } = useVariables();
  return (
    <>
      <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} Login`}</title>
      <Login />
    </>
  );
}
