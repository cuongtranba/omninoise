import { createServer } from 'node:http';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  getSsrfSafeAxios,
  ssrfSafeDispatcher,
} from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

const server = createServer((_req, res) => res.end('reached'));
let url = '';

beforeAll(async () => {
  delete process.env.DISABLE_SSRF_PROTECTION;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
});

afterAll(() => {
  server.close();
});

test('fetch with the SSRF dispatcher refuses a loopback IP literal', async () => {
  await expect(
    fetch(url, { dispatcher: ssrfSafeDispatcher } as any)
  ).rejects.toThrow();
});

test('SSRF-safe axios refuses a loopback IP literal', async () => {
  await expect(getSsrfSafeAxios().get(url)).rejects.toThrow();
});
