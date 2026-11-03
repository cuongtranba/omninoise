import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  PrismaRepository,
  PrismaService,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { AnalyticsReportService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.service';
import { JobQueueService } from '@gitroom/nestjs-libraries/jobs/job.queue';

const prisma = new PrismaService();
const repo = new PrismaRepository<keyof PrismaService>(prisma);
// Post events never build an analytics report, so its services are left out
const webhooks = new WebhooksService(
  new WebhooksRepository(repo, repo),
  new JobQueueService(),
  new AnalyticsReportService(undefined!, undefined!, undefined!)
);

type Received = { path?: string; event?: string; body: string };
const received: Received[] = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    received.push({
      path: req.url,
      event: req.headers['x-webhook-event'] as string,
      body,
    });
    res.end('ok');
  });
});
const ssrfProtection = process.env.DISABLE_SSRF_PROTECTION;
let orgId: string;
let integrationId: string;
let base: string;

const addIntegration = async (internalId: string) =>
  (
    await prisma.integration.create({
      data: {
        organizationId: orgId,
        internalId,
        name: internalId,
        providerIdentifier: 'bluesky',
        type: 'social',
        token: 'token',
      },
    })
  ).id;

const addWebhook = (path: string, type: string, channels: string[] = []) =>
  prisma.webhooks.create({
    data: {
      organizationId: orgId,
      name: path,
      url: `${base}/${path}`,
      type,
      integrations: {
        create: channels.map((integrationId) => ({ integrationId })),
      },
    },
  });

beforeAll(async () => {
  process.env.DISABLE_SSRF_PROTECTION = 'true';
  execFileSync(
    'node_modules/.bin/prisma',
    [
      'db',
      'push',
      '--skip-generate',
      '--schema',
      'libraries/nestjs-libraries/src/database/prisma/schema.prisma',
    ],
    { env: process.env, stdio: 'pipe' }
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  orgId = (await prisma.organization.create({ data: { name: 'webhooks' } })).id;
  integrationId = await addIntegration('listened');
  const other = await addIntegration('other');
  await addWebhook('failed', 'post.failed');
  await addWebhook('published', 'post.published');
  await addWebhook('failed-other-channel', 'post.failed', [other]);
});

beforeEach(() => {
  received.length = 0;
});

afterAll(async () => {
  server.close();
  if (ssrfProtection === undefined) {
    delete process.env.DISABLE_SSRF_PROTECTION;
  } else {
    process.env.DISABLE_SSRF_PROTECTION = ssrfProtection;
  }
  await prisma.integrationsWebhooks.deleteMany({
    where: { webhook: { organizationId: orgId } },
  });
  await prisma.webhooks.deleteMany({ where: { organizationId: orgId } });
  await prisma.integration.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

test('a failed post only reaches the post.failed webhooks that listen to its channel', async () => {
  const payload = [{ id: 'post-1', state: 'ERROR', error: '{"message":"x"}' }];

  await webhooks.sendPostWebhooks(
    orgId,
    integrationId,
    'post.failed',
    async () => payload
  );

  expect(received).toEqual([
    {
      path: '/failed',
      event: 'post.failed',
      body: JSON.stringify(payload),
    },
  ]);
});

// post.published delivery moved here from the orchestrator: its body stays the
// post list it always was
test('a published post reaches the post.published webhooks only', async () => {
  const payload = [{ id: 'post-2', state: 'PUBLISHED' }];

  await webhooks.sendPostWebhooks(
    orgId,
    integrationId,
    'post.published',
    async () => payload
  );

  expect(received).toEqual([
    {
      path: '/published',
      event: 'post.published',
      body: JSON.stringify(payload),
    },
  ]);
});
