import { FC, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useSWRConfig } from 'swr';
import { setCookie } from '@gitroom/frontend/components/layout/layout.context';
import { authProbeKey, useAuthFetch } from '@gitroom/frontend/app/route.guard';
import { useVariables } from '@gitroom/react/helpers/variable.context';

const Logout: FC = () => {
  const authFetch = useAuthFetch();
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const { isSecured } = useVariables();

  useEffect(() => {
    (async () => {
      // The backend clears the auth, showorg and impersonate cookies it owns
      await authFetch('/user/logout', { method: 'POST' }).catch(() => {});
      if (!isSecured) {
        setCookie('auth', '', -10);
        setCookie('showorg', '', -10);
        setCookie('impersonate', '', -10);
      }
      await mutate(
        (key) => Array.isArray(key) && key[0] === authProbeKey,
        undefined,
        { revalidate: false }
      );
      navigate('/auth/login', { replace: true });
    })();
  }, []);

  return null;
};

export default Logout;
