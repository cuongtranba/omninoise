/// <reference types="vite/client" />
import type { ComponentProps } from 'react';
import type { VariableContextComponent } from '@gitroom/react/helpers/variable.context';

declare global {
  interface ImportMetaEnv {
    readonly NEXT_PUBLIC_VERSION: string;
  }

  interface Window {
    // Written by /runtime-config.js (runtime-config.mjs) before the bundle runs
    __RUNTIME_CONFIG__: Omit<
      ComponentProps<typeof VariableContextComponent>,
      'children' | 'language'
    >;
  }
}
