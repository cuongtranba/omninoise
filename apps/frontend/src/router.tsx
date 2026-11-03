import { ComponentType, FC } from 'react';
import { createBrowserRouter, RouteObject } from 'react-router';
import AppLayout from './app/(app)/layout';
import ExtensionLayout from './app/(extension)/layout';
import ProviderLayout from './app/(provider)/layout';
import GlobalError from './app/global-error';

// Routes are code-split: the module is only fetched once its URL is visited
const load = (
  module: () => Promise<{ default: ComponentType }>
): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await module()).default }),
});

// Lazy routes resolve before the first render, there is nothing to show meanwhile
const HydrateFallback: FC = () => null;

export const router = createBrowserRouter([
  {
    Component: AppLayout,
    HydrateFallback,
    ErrorBoundary: GlobalError,
    children: [
      { index: true, element: null },
      {
        path: 'p/:id',
        ...load(() => import('./app/(app)/(preview)/p/[id]/layout')),
        children: [
          {
            index: true,
            ...load(() => import('./app/(app)/(preview)/p/[id]/page')),
          },
        ],
      },
      {
        ...load(() => import('./app/(app)/(site)/layout')),
        children: [
          {
            path: 'launches',
            ...load(() => import('./app/(app)/(site)/launches/page')),
          },
          {
            path: 'analytics',
            ...load(() => import('./app/(app)/(site)/analytics/page')),
          },
          {
            path: 'billing',
            ...load(() => import('./app/(app)/(site)/billing/page')),
          },
          {
            path: 'billing/lifetime',
            ...load(() => import('./app/(app)/(site)/billing/lifetime/page')),
          },
          {
            path: 'media',
            ...load(() => import('./app/(app)/(site)/media/page')),
          },
          {
            path: 'settings',
            ...load(() => import('./app/(app)/(site)/settings/page')),
          },
          {
            path: 'err',
            ...load(() => import('./app/(app)/(site)/err/page')),
          },
          {
            path: 'plugs',
            ...load(() => import('./app/(app)/(site)/plugs/page')),
          },
          {
            path: 'third-party',
            ...load(() => import('./app/(app)/(site)/third-party/page')),
          },
          {
            path: 'admin/errors',
            ...load(() => import('./app/(app)/(site)/admin/errors/page')),
          },
          {
            path: 'admin/stats',
            ...load(() => import('./app/(app)/(site)/admin/stats/page')),
          },
          {
            path: 'agents',
            ...load(() => import('./app/(app)/(site)/agents/layout')),
            children: [
              {
                index: true,
                ...load(() => import('./app/(app)/(site)/agents/page')),
              },
              {
                path: ':id',
                ...load(() => import('./app/(app)/(site)/agents/[id]/page')),
              },
            ],
          },
        ],
      },
      {
        path: 'auth',
        ...load(() => import('./app/(app)/auth/layout')),
        children: [
          {
            index: true,
            ...load(() => import('./app/(app)/auth/page')),
          },
          {
            path: 'login',
            ...load(() => import('./app/(app)/auth/login/page')),
          },
          {
            path: 'login-required',
            ...load(() => import('./app/(app)/auth/login-required/page')),
          },
          {
            path: 'activate',
            ...load(() => import('./app/(app)/auth/activate/page')),
          },
          {
            path: 'activate/:code',
            ...load(() => import('./app/(app)/auth/activate/[code]/page')),
          },
          {
            path: 'forgot',
            ...load(() => import('./app/(app)/auth/forgot/page')),
          },
          {
            path: 'forgot/:token',
            ...load(() => import('./app/(app)/auth/forgot/[token]/page')),
          },
        ],
      },
      {
        path: 'auth/logout',
        ...load(() => import('./app/(app)/auth/logout/page')),
      },
      {
        path: 'integrations/social',
        ...load(() => import('./app/(app)/integrations/social/layout')),
        children: [
          {
            path: ':provider',
            ...load(
              () => import('./app/(app)/integrations/social/[provider]/page')
            ),
          },
        ],
      },
      {
        path: 'oauth/authorize',
        ...load(() => import('./app/(app)/oauth/authorize/layout')),
        children: [
          {
            index: true,
            ...load(() => import('./app/(app)/oauth/authorize/page')),
          },
        ],
      },
      {
        path: '*',
        element: <div className="p-[20px]">Page not found</div>,
      },
    ],
  },
  {
    Component: ExtensionLayout,
    HydrateFallback,
    ErrorBoundary: GlobalError,
    children: [
      {
        path: 'modal',
        ...load(() => import('./app/(extension)/modal/layout')),
        children: [
          {
            path: ':style/:platform',
            ...load(
              () => import('./app/(extension)/modal/[style]/[platform]/page')
            ),
          },
        ],
      },
    ],
  },
  {
    Component: ProviderLayout,
    HydrateFallback,
    ErrorBoundary: GlobalError,
    children: [
      {
        path: 'provider/add',
        ...load(() => import('./app/(provider)/provider/add/page')),
      },
      {
        path: 'provider/:p',
        ...load(() => import('./app/(provider)/provider/[p]/page')),
      },
    ],
  },
]);
