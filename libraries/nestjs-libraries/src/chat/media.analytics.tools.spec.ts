import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { RequestContext } from '@mastra/core/di';
import { Memory } from '@mastra/memory';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { ChatModule } from '@gitroom/nestjs-libraries/chat/chat.module';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { pStore } from '@gitroom/nestjs-libraries/chat/mastra.store';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

const run = Math.random().toString(36).slice(2);
const stripeBefore = process.env.STRIPE_PUBLISHABLE_KEY;
let moduleRef: Awaited<
  ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
>;
let tools: Record<string, any>;
const orgIds: string[] = [];
const userIds: string[] = [];

const org = async (name: string) => {
  const created = await moduleRef
    .get(PrismaService)
    .organization.create({ data: { name: `${name}-${run}` } });
  orgIds.push(created.id);
  return created.id;
};

const user = async (name: string) => {
  const created = await moduleRef.get(PrismaService).user.create({
    data: {
      email: `${name}-${run}@postiz.test`,
      providerName: 'LOCAL',
      timezone: 0,
    },
  });
  userIds.push(created.id);
  return created.id;
};

// an OAuth connection carries the user, an API key connection does not
const connection = (id: string, userId?: string) => {
  const requestContext = new RequestContext();
  requestContext.set(
    'organization',
    JSON.stringify({
      id,
      createdAt: new Date(),
      users: [{ role: 'SUPERADMIN', userId }],
    })
  );
  return { requestContext };
};

const media = (organizationId: string, name: string) =>
  moduleRef.get(PrismaService).media.create({
    data: { organizationId, name, path: `https://postiz.test/${name}-${run}` },
  });

beforeAll(async () => {
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
  moduleRef = await Test.createTestingModule({
    imports: [DatabaseModule, JobsModule, ChatModule],
  }).compile();
  tools = await moduleRef.get(LoadToolsService).loadTools();
});

afterAll(async () => {
  if (stripeBefore === undefined) {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  } else {
    process.env.STRIPE_PUBLISHABLE_KEY = stripeBefore;
  }
  const prisma = moduleRef.get(PrismaService);
  const inOrgs = { organizationId: { in: orgIds } };
  await prisma.credits.deleteMany({ where: inOrgs });
  await prisma.subscription.deleteMany({ where: inOrgs });
  await prisma.media.deleteMany({ where: inOrgs });
  await prisma.notifications.deleteMany({ where: inOrgs });
  await prisma.integration.deleteMany({ where: inOrgs });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await moduleRef.close();
});

test('a media of another organization cannot be deleted or edited', async () => {
  const prisma = moduleRef.get(PrismaService);
  const owner = await org('media-owner');
  const stranger = await org('media-stranger');
  const mine = await media(owner, 'mine');

  const deleted = await tools.mediaManageTool.execute(
    { action: 'delete', id: mine.id },
    connection(stranger)
  );
  const edited = await tools.mediaManageTool.execute(
    { action: 'update', id: mine.id, alt: 'changed' },
    connection(stranger)
  );

  expect(deleted.output).toHaveProperty('errors');
  expect(edited.output).toHaveProperty('errors');
  const after = await prisma.media.findUniqueOrThrow({
    where: { id: mine.id },
  });
  expect(after.deletedAt).toBeNull();
  expect(after.alt).toBeNull();
});

test('a deleted media leaves the media library', async () => {
  const owner = await org('media-delete');
  const mine = await media(owner, 'delete');

  const result = await tools.mediaManageTool.execute(
    { action: 'delete', id: mine.id },
    connection(owner)
  );

  expect(result.output).toEqual({ deleted: { id: mine.id } });
  const library = await tools.mediaListTool.execute({}, connection(owner));
  expect(library.output).toEqual([]);
});

test('an image is not generated and no media is saved when the account has no AI credits', async () => {
  const prisma = moduleRef.get(PrismaService);
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_credits';
  const owner = await org('credits');

  try {
    const result = await tools.generateImageTool.execute(
      { prompt: 'a red bicycle', writePromptFirst: true },
      connection(owner)
    );

    expect(result.error).toMatch(/credits/);
    expect(await prisma.media.count({ where: { organizationId: owner } })).toBe(
      0
    );
  } finally {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  }
});

test('the AI credits used in the current billing period are subtracted for an organization loaded by its API key', async () => {
  const prisma = moduleRef.get(PrismaService);
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_credits';
  const owner = await org('credits-period');
  const apiKey = `key-${run}`;
  await prisma.organization.update({
    where: { id: owner },
    data: { apiKey },
  });
  const day = 24 * 60 * 60 * 1000;
  // billed monthly since 45 days ago, so the period started about 15 days ago
  await prisma.subscription.create({
    data: {
      organizationId: owner,
      subscriptionTier: 'STANDARD',
      period: 'MONTHLY',
      totalChannels: 5,
      createdAt: new Date(Date.now() - 45 * day),
    },
  });
  // 3 credits used in the current period and 4 in the previous one
  await prisma.credits.createMany({
    data: [
      {
        organizationId: owner,
        credits: 3,
        createdAt: new Date(Date.now() - 5 * day),
      },
      {
        organizationId: owner,
        credits: 4,
        createdAt: new Date(Date.now() - 20 * day),
      },
    ],
  });
  const loaded = await moduleRef
    .get(OrganizationService)
    .getOrgByApiKey(apiKey);

  try {
    const requestContext = new RequestContext();
    requestContext.set(
      'organization',
      JSON.stringify({ ...loaded, users: [{ role: 'SUPERADMIN' }] })
    );
    const result = await tools.aiCreditsTool.execute({}, { requestContext });

    expect(result.output).toEqual({ credits: 20 - 3 });
  } finally {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  }
});

test('the notifications of another organization are never listed', async () => {
  const prisma = moduleRef.get(PrismaService);
  const owner = await org('notify-owner');
  const stranger = await org('notify-stranger');
  const reader = await user('notify-reader');
  await prisma.notifications.create({
    data: { organizationId: owner, content: `secret-${run}` },
  });
  await prisma.notifications.create({
    data: { organizationId: stranger, content: `own-${run}` },
  });

  const result = await tools.notificationsTool.execute(
    { action: 'list' },
    connection(stranger, reader)
  );

  expect(
    result.output.notifications.map((n: { content: string }) => n.content)
  ).toEqual([`own-${run}`]);
});

test('notifications cannot be read through an API key because they belong to a user', async () => {
  const owner = await org('notify-key');

  const result = await tools.notificationsTool.execute(
    { action: 'unread' },
    connection(owner)
  );

  expect(result.output).toHaveProperty('errors');
});

test('opening the notifications marks them as read for that user only', async () => {
  const prisma = moduleRef.get(PrismaService);
  const owner = await org('notify-read');
  const first = await user('notify-first');
  const second = await user('notify-second');
  await prisma.user.updateMany({
    where: { id: { in: [first, second] } },
    data: { lastReadNotifications: new Date('2020-01-01T00:00:00.000Z') },
  });
  await prisma.notifications.create({
    data: { organizationId: owner, content: `news-${run}` },
  });

  await tools.notificationsTool.execute(
    { action: 'list' },
    connection(owner, first)
  );

  const unread = (userId: string) =>
    tools.notificationsTool.execute(
      { action: 'unread' },
      connection(owner, userId)
    );
  expect((await unread(first)).output).toEqual({ total: 0 });
  expect((await unread(second)).output).toEqual({ total: 1 });
});

test('the copilot conversations of another organization are not visible', async () => {
  const owner = await org('copilot-owner');
  const stranger = await org('copilot-stranger');
  const memory = new Memory({ storage: pStore });
  await pStore.init();
  const thread = await memory.createThread({
    resourceId: owner,
    title: `secret-${run}`,
  });
  const threadId = thread.id;

  const own = await tools.copilotThreadsTool.execute(
    { action: 'list' },
    connection(owner)
  );
  const foreign = await tools.copilotThreadsTool.execute(
    { action: 'list' },
    connection(stranger)
  );
  const foreignMessages = await tools.copilotThreadsTool.execute(
    { action: 'messages', id: threadId },
    connection(stranger)
  );

  expect(own.output.threads).toEqual([
    { id: threadId, title: `secret-${run}` },
  ]);
  expect(foreign.output.threads).toEqual([]);
  expect(foreignMessages.output).toEqual({ messages: [] });
});

test('the analytics of a channel of another organization are refused', async () => {
  const prisma = moduleRef.get(PrismaService);
  const owner = await org('analytics-owner');
  const stranger = await org('analytics-stranger');
  const mine = await prisma.integration.create({
    data: {
      organizationId: owner,
      internalId: `analytics-${run}`,
      name: 'analytics',
      providerIdentifier: 'linkedin',
      type: 'social',
      token: `secret-token-${run}`,
    },
  });

  const result = await tools.analyticsTool.execute(
    { integrationId: mine.id },
    connection(stranger)
  );

  expect(result.output).toEqual({ errors: 'Invalid integration' });
});
