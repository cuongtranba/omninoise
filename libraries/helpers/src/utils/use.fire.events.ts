import { useCallback } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';

declare global {
  interface Window {
    plausible?: (name: string, options?: { props?: unknown }) => void;
  }
}

export const useFireEvents = () => {
  const { billingEnabled } = useVariables();

  return useCallback(
    (name: string, props?: any) => {
      if (!billingEnabled) {
        return;
      }

      window.plausible?.(name, { props });
    },
    [billingEnabled]
  );
};
