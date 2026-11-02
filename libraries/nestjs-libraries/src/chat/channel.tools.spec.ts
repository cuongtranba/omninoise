import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { RequestContext } from '@mastra/core/di';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { ChatModule } from '@gitroom/nestjs-libraries/chat/chat.module';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

const run = Math.random().toString(36).slice(2);
const envBefore = {
  stripe: process.env.STRIPE_PUBLISHABLE_KEY,
  linkedin: process.env.LINKEDIN_CLIENT_ID,
  frontend: process.env.FRONTEND_URL,
};
let moduleRef: Awaited<
  ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
>;
let tools: Record<string, any>;
const orgIds: string[] = [];

const org = async (name: string) => {
  const created = await moduleRef
    .get(PrismaService)
    .organization.create({ data: { name: `${name}-${run}` } });
  orgIds.push(created.id);
  return created.id;
};

// what an API key connection carries: the organization with its subscription
const connection = (id: string, subscription?: { totalChannels: number }) => {
  const requestContext = new RequestContext();
  requestContext.set(
    'organization',
    JSON.stringify({
      id,
      createdAt: new Date(),
      subscription,
      users: [{ role: 'SUPERADMIN' }],
    })
  );
  return { requestContext };
};

const channel = (
  organizationId: string,
  name: string,
  data: { providerIdentifier?: string; disabled?: boolean } = {}
) =>
  moduleRef.get(PrismaService).integration.create({
    data: {
      organizationId,
      internalId: `${name}-${run}`,
      name,
      providerIdentifier: 'linkedin',
      type: 'social',
      token: `secret-token-${name}-${run}`,
      ...data,
    },
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
  process.env.LINKEDIN_CLIENT_ID = 'client-id';
  process.env.FRONTEND_URL = 'https://postiz.test';
  moduleRef = await Test.createTestingModule({
    imports: [DatabaseModule, JobsModule, ChatModule],
  }).compile();
  tools = await moduleRef.get(LoadToolsService).loadTools();
});

afterAll(async () => {
  const restore = (key: string, value?: string) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };
  restore('STRIPE_PUBLISHABLE_KEY', envBefore.stripe);
  restore('LINKEDIN_CLIENT_ID', envBefore.linkedin);
  restore('FRONTEND_URL', envBefore.frontend);
  const prisma = moduleRef.get(PrismaService);
  await prisma.plugs.deleteMany({
    where: { integration: { organizationId: { in: orgIds } } },
  });
  await prisma.post.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.integration.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await prisma.customer.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await moduleRef.close();
});

test('a group of another organization cannot be linked to a channel', async () => {
  const prisma = moduleRef.get(PrismaService);
  const owner = await org('group-owner');
  const stranger = await org('group-stranger');
  const mine = await channel(owner, 'mine');
  const foreignGroup = await prisma.customer.create({
    data: { name: `foreign-${run}`, orgId: stranger },
  });

  const result = await tools.integrationGroupTool.execute(
    { action: 'assign', id: mine.id, groupId: foreignGroup.id },
    connection(owner)
  );

  expect(result.output).toHaveProperty('errors');
  expect(
    (await prisma.integration.findUniqueOrThrow({ where: { id: mine.id } }))
      .customerId
  ).toBeNull();
});

test('a plug cannot be set up on a channel of another organization', async () => {
  const prisma = moduleRef.get(PrismaService);
  const owner = await org('plug-owner');
  const stranger = await org('plug-stranger');
  const available = await tools.integrationPlugsTool.execute(
    { action: 'available' },
    connection(stranger)
  );
  const provider = available.output.plugs[0];
  const victim = await channel(owner, 'victim', {
    providerIdentifier: provider.identifier,
  });

  const result = await tools.integrationPlugsTool.execute(
    {
      action: 'save',
      id: victim.id,
      func: provider.plugs[0].methodName,
      fields: [],
    },
    connection(stranger)
  );

  expect(result.output).toHaveProperty('errors');
  expect(
    await prisma.plugs.count({ where: { integrationId: victim.id } })
  ).toBe(0);
});

test('a plug the platform of the channel does not have is refused', async () => {
  const owner = await org('plug-func');
  const available = await tools.integrationPlugsTool.execute(
    { action: 'available' },
    connection(owner)
  );
  const mine = await channel(owner, 'plug-func', {
    providerIdentifier: available.output.plugs[0].identifier,
  });

  // a method of the provider that is not one of its plugs
  const result = await tools.integrationPlugsTool.execute(
    { action: 'save', id: mine.id, func: 'refreshToken', fields: [] },
    connection(owner)
  );

  expect(result.output).toHaveProperty('errors');
});

test('deleting a channel deletes its posts too', async () => {
  const prisma = moduleRef.get(PrismaService);
  const owner = await org('delete');
  const mine = await channel(owner, 'delete');
  const post = await prisma.post.create({
    data: {
      organizationId: owner,
      integrationId: mine.id,
      publishDate: new Date('2030-01-01T12:00:00.000Z'),
      content: 'Scheduled',
      group: `group-${run}`,
    },
  });

  const result = await tools.integrationStateTool.execute(
    { action: 'delete', id: mine.id },
    connection(owner)
  );

  expect(result.output).toEqual({ id: mine.id, state: 'deleted' });
  await expect
    .poll(
      async () =>
        (
          await prisma.post.findUniqueOrThrow({ where: { id: post.id } })
        ).deletedAt
    )
    .not.toBeNull();
  expect(
    (await prisma.integration.findUniqueOrThrow({ where: { id: mine.id } }))
      .deletedAt
  ).not.toBeNull();
});

test('a disabled channel is enabled only while the channels limit of the subscription has a place', async () => {
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_channels';
  const prisma = moduleRef.get(PrismaService);
  const owner = await org('enable');
  await channel(owner, 'active');
  const off = await channel(owner, 'off', { disabled: true });
  const enable = (totalChannels: number) =>
    tools.integrationStateTool.execute(
      { action: 'enable', id: off.id },
      connection(owner, { totalChannels })
    );

  expect((await enable(1)).output.errors).toMatch(/maximum number of channels/);
  expect(
    (await prisma.integration.findUniqueOrThrow({ where: { id: off.id } }))
      .disabled
  ).toBe(true);

  expect((await enable(2)).output).toEqual({ id: off.id, state: 'enabled' });
});

test('a channel at the channels limit can be reconnected but a new one cannot be connected', async () => {
  // billing on and no subscription: the free plan has no place for new channels
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_connect';
  const owner = await org('connect');
  const mine = await channel(owner, 'connect');

  await expect(
    tools.integrationConnectTool.execute(
      { provider: 'linkedin' },
      connection(owner)
    )
  ).rejects.toThrow(/channel/i);

  const reconnect = await tools.integrationConnectTool.execute(
    { reconnectChannelId: mine.id },
    connection(owner)
  );
  const state = new URL(reconnect.output.url).searchParams.get('state')!;

  // the callback of the browser finds the organization and the channel by this state
  expect(await ioRedis.get(`organization:${state}`)).toBe(owner);
  expect(await ioRedis.get(`refresh:${state}`)).toBe(mine.internalId);
});

test('posting times set in UTC hours and minutes are read back as the same time of day', async () => {
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  const owner = await org('times');
  const mine = await channel(owner, 'times');

  await tools.integrationTimesTool.execute(
    { id: mine.id, times: [{ hour: 1, minute: 30 }] },
    connection(owner)
  );
  const result = await tools.integrationGetTool.execute(
    { id: mine.id },
    connection(owner)
  );

  expect(result.output.postingTimes).toEqual([{ time: 90, utc: '01:30' }]);
});
