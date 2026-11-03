import { FC, useEffect, useMemo } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import useSWR from 'swr';
import { customFetch } from '@gitroom/helpers/utils/custom.fetch.func';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { useVariables } from '@gitroom/react/helpers/variable.context';

// Pages that work for signed-out visitors. The consent screen of MCP / OAuth
// clients handles signed-out visitors itself (sign in and come back, or
// connect a self-hosted instance).
const isPublicPath = (pathname: string, href: string) =>
  pathname === '/auth/logout' ||
  pathname.startsWith('/uploads/') ||
  pathname.startsWith('/p/') ||
  pathname.startsWith('/provider/') ||
  pathname.startsWith('/icons/') ||
  pathname.startsWith('/oauth/authorize') ||
  (pathname.startsWith('/integrations/social/') &&
    href.indexOf('state=login') === -1);

// The layout context redirects to / on every 401, which would reload forever
// when the probe itself is what answers 401, so the probes skip it.
export const useAuthFetch = () => {
  const { backendUrl, isSecured } = useVariables();
  return useMemo(
    () =>
      customFetch(
        { baseUrl: backendUrl, afterRequest: async () => true },
        undefined,
        undefined,
        isSecured
      ),
    [backendUrl, isSecured]
  );
};

export const authProbeKey = 'auth-probe';

const useAuthProbe = (enabled: boolean, area: string) => {
  const authFetch = useAuthFetch();
  return useSWR(
    enabled ? [authProbeKey, area] : null,
    async () => (await authFetch('/user/self')).status !== 401,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    }
  );
};

// undefined while the answer is loading. The auth pages and the app are cached
// apart, so the first visit to the app after signing up asks again.
export const useLoggedIn = (enabled = true) => {
  const { pathname } = useLocation();
  const { data, error } = useAuthProbe(
    enabled,
    pathname.startsWith('/auth') ? 'auth' : 'app'
  );
  return error ? false : data;
};

const providerQuery = (href: string, search: string, genericOauth: boolean) => {
  const findIndex = ['google', 'settings'].find((p) => href.indexOf(p) > -1);
  if (!findIndex) {
    return '';
  }
  const provider =
    findIndex === 'settings'
      ? genericOauth
        ? 'generic'
        : 'github'
      : findIndex;
  return `${search.indexOf('?') > -1 ? '&' : '?'}provider=${provider.toUpperCase()}`;
};

export const RouteGuard: FC = () => {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const fetch = useFetch();
  const {
    isGeneral,
    genericOauth,
    disableRegistration,
    frontEndUrl,
    isSecured,
  } = useVariables();
  const href = window.location.href;
  const isAuthPath = pathname.startsWith('/auth');
  const isPublic = isPublicPath(pathname, href);
  const loggedIn = useLoggedIn(!isPublic);
  const org = new URLSearchParams(search).get('org');
  const registrationBlocked =
    pathname.startsWith('/auth/register') && disableRegistration;

  const joinOrg = loggedIn === true && !isPublic && !isAuthPath && !!org;
  const rememberOrg =
    loggedIn === false && isAuthPath && !registrationBlocked && !!org;

  useEffect(() => {
    if (!joinOrg) {
      return;
    }
    (async () => {
      try {
        const { id } = await (
          await fetch('/user/join-org', {
            body: JSON.stringify({ org }),
            method: 'POST',
          })
        ).json();
        if (id) {
          // sets the showorg cookie
          await fetch('/user/change-org', {
            body: JSON.stringify({ id }),
            method: 'POST',
          });
        }
        navigate('/?added=true', { replace: true });
      } catch (err) {
        console.log('err', err);
        navigate('/auth/logout', { replace: true });
      }
    })();
  }, [joinOrg, org]);

  useEffect(() => {
    if (!rememberOrg) {
      return;
    }
    // The backend picks the org up from this cookie once the visitor signs up
    document.cookie = [
      `org=${encodeURIComponent(org!)}`,
      `expires=${new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toUTCString()}`,
      'path=/',
      ...(isSecured
        ? [
            `domain=${getCookieUrlFromDomain(frontEndUrl)}`,
            'secure',
            'samesite=none',
          ]
        : []),
    ].join('; ');
    navigate('/', { replace: true });
  }, [rememberOrg, org]);

  if (isPublic) {
    return <Outlet />;
  }
  if (loggedIn === undefined) {
    return null;
  }
  if (pathname.startsWith('/modal/') && !loggedIn) {
    return <Navigate to="/auth/login-required" replace />;
  }
  if (registrationBlocked) {
    return <Navigate to="/auth/login" replace />;
  }
  if (!isAuthPath && !loggedIn) {
    return (
      <Navigate
        to={`/auth${search}${providerQuery(href, search, genericOauth)}`}
        replace
      />
    );
  }
  if (isAuthPath && loggedIn) {
    return <Navigate to={`/${search}`} replace />;
  }
  if (joinOrg || rememberOrg) {
    return null;
  }
  if (pathname === '/') {
    return <Navigate to={isGeneral ? '/launches' : '/analytics'} replace />;
  }
  return <Outlet />;
};
