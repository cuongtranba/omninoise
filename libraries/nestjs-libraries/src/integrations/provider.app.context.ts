import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The organization's own developer app a provider call runs with (see
 * `ownApp` on the providers and ProviderAppService.run). Like the job
 * context, it reaches every provider method without a new parameter: X signs
 * analytics calls with the app key, and refreshToken gets no channel row.
 * The secret is decrypted and lives only for the duration of the call.
 */
export type ProviderAppContext = {
  family: string;
  clientId: string;
  clientSecret: string;
};

const storage = new AsyncLocalStorage<ProviderAppContext | undefined>();

/** `app` undefined runs `fn` with the server's app (the env vars). */
export const runWithProviderApp = <T>(
  app: ProviderAppContext | undefined,
  fn: () => Promise<T>
) => storage.run(app, fn);

export const currentProviderApp = () => storage.getStore();
