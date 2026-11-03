import { useCallback } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';

type PlausibleOptions = { props?: unknown };

declare global {
  interface Window {
    plausible?: ((name: string, options?: PlausibleOptions) => void) & {
      q?: unknown[][];
    };
  }
}

// Events fired before the Plausible script loads wait in window.plausible.q,
// which the script sends once it runs.
const queuePlausible = () => {
  const queue: unknown[][] = [];
  return Object.assign(
    (name: string, options?: PlausibleOptions) => {
      queue.push([name, options]);
    },
    { q: queue }
  );
};

export const useFireEvents = () => {
  const { billingEnabled } = useVariables();

  return useCallback(
    (name: string, props?: any) => {
      if (!billingEnabled) {
        return;
      }

      window.plausible = window.plausible ?? queuePlausible();
      window.plausible(name, { props });
    },
    [billingEnabled]
  );
};
