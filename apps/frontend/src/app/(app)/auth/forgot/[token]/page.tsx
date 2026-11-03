import { useParams } from 'react-router';
import { ForgotReturn } from '@gitroom/frontend/components/auth/forgot-return';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function Auth() {
  const { isGeneral } = useVariables();
  const { token } = useParams();
  return (
    <>
      <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} Forgot Password`}</title>
      <ForgotReturn token={token!} />
    </>
  );
}
