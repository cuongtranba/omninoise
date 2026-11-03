import { expect, test } from 'vite-plus/test';
import { buildRuntimeConfig } from './runtime-config.mjs';

test('browser config derives public flags without exposing server secrets', () => {
  const config = buildRuntimeConfig({
    RUNPOD_API_KEY: 'secret-runpod',
    CHATBASE_TOKEN: 'secret-chatbase',
    STORAGE_PROVIDER: 'cloudflare',
    RUNPOD_ENDPOINT_ID: 'x',
    STRIPE_PUBLISHABLE_KEY: 'pk',
  });
  const serialized = JSON.stringify(config);

  expect(serialized).not.toContain('secret-runpod');
  expect(serialized).not.toContain('secret-chatbase');
  expect(config.mediaProcessing).toBe(true);
  expect(config.isChatBase).toBe(true);
  expect(config.billingEnabled).toBe(true);
});
