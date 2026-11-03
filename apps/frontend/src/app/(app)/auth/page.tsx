import useSWR from 'swr';
import { Link, useSearchParams } from 'react-router';
import { Register } from '@gitroom/frontend/components/auth/register';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoginWithOidc } from '@gitroom/frontend/components/auth/login.with.oidc';

const useCanRegister = (enabled: boolean) => {
  const fetch = useFetch();
  return useSWR(
    enabled ? '/auth/can-register' : null,
    async (path: string) => (await (await fetch(path)).json()).register
  );
};

export default function Auth() {
  const t = useT();
  const { isGeneral, disableRegistration } = useVariables();
  const [searchParams] = useSearchParams();
  const { data: canRegister } = useCanRegister(disableRegistration);

  const title = (
    <title>{`${isGeneral ? 'Omninoise' : 'Gitroom'} Register`}</title>
  );

  if (disableRegistration) {
    if (canRegister === undefined) {
      return title;
    }
    if (!canRegister && !searchParams.get('provider')) {
      return (
        <>
          {title}
          <LoginWithOidc />
          <div className="text-center">
            {t('registration_is_disabled', 'Registration is disabled')}
            <br />
            <Link className="underline hover:font-bold" to="/auth/login">
              {t('login_instead', 'Login instead')}
            </Link>
          </div>
        </>
      );
    }
  }
  return (
    <>
      {title}
      <Register />
    </>
  );
}
