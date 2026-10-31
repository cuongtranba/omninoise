import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { RequestContext } from '@mastra/core/di';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { ChatModule } from '@gitroom/nestjs-libraries/chat/chat.module';
import { ThirdPartyManager } from '@gitroom/nestjs-libraries/3rdparties/thirdparty.manager';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { SetsService } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.service';
import { SignatureService } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.service';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

process.env.JWT_SECRET ||= 'assets-automation-tools-spec-secret';

const run = Math.random().toString(36).slice(2);
const stripeBefore = process.env.STRIPE_PUBLISHABLE_KEY;
let moduleRef: Awaited<
  ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
>;
let tools: Record<string, any>;
const orgIds: string[] = [];

const org = async (name: string, tier?: 'STANDARD') => {
  const prisma = moduleRef.get(PrismaService);
  const created = await prisma.organization.create({
    data: { name: `${name}-${run}` },
  });
  if (tier) {
    await prisma.subscription.create({
      data: {
        organizationId: created.id,
        subscriptionTier: tier,
        period: 'MONTHLY',
        totalChannels: 10,
      },
    });
  }
  orgIds.push(created.id);
  return created.id;
};

const connection = (id: string) => {
  const requestContext = new RequestContext();
  requestContext.set(
    'organization',
    JSON.stringify({
      id,
      createdAt: new Date(),
      users: [{ role: 'SUPERADMIN' }],
    })
  );
  return { requestContext };
};

const channel = (organizationId: string, name: string) =>
  moduleRef.get(PrismaService).integration.create({
    data: {
      organizationId,
      internalId: `${name}-${run}`,
      name,
      providerIdentifier: 'linkedin',
      type: 'social',
      token: `secret-token-${name}-${run}`,
    },
  });

const setContent = (integrationId: string) => ({
  posts: [
    {
      integration: { id: integrationId },
      settings: { __type: 'linkedin' },
      value: [{ content: '<p>Hello</p>' }],
    },
  ],
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

afterEach(() => {
  if (stripeBefore === undefined) {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  } else {
    process.env.STRIPE_PUBLISHABLE_KEY = stripeBefore;
  }
});

afterAll(async () => {
  const prisma = moduleRef.get(PrismaService);
  const inOrgs = { organizationId: { in: orgIds } };
  await prisma.integrationsWebhooks.deleteMany({
    where: { webhook: inOrgs },
  });
  await prisma.webhooks.deleteMany({ where: inOrgs });
  await prisma.integration.deleteMany({ where: inOrgs });
  await prisma.autoPost.deleteMany({ where: inOrgs });
  await prisma.sets.deleteMany({ where: inOrgs });
  await prisma.signatures.deleteMany({ where: inOrgs });
  await prisma.thirdParty.deleteMany({ where: inOrgs });
  await prisma.subscription.deleteMany({ where: inOrgs });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await moduleRef.close();
});

test('updating a signature, set, autopost or webhook of another organization changes nothing and saves nothing', async () => {
  const prisma = moduleRef.get(PrismaService);
  const owner = await org('update-owner');
  const stranger = await org('update-stranger');
  const theirs = await connection(stranger);
  const signature = await prisma.signatures.create({
    data: { organizationId: owner, content: 'mine', autoAdd: false },
  });
  const set = await prisma.sets.create({
    data: { organizationId: owner, name: 'mine', content: '{}' },
  });
  const autopost = await prisma.autoPost.create({
    data: {
      organizationId: owner,
      title: 'mine',
      url: 'https://postiz.test/feed.xml',
      lastUrl: '',
      integrations: '[]',
      active: false,
      onSlot: false,
      syncLast: false,
      addPicture: false,
      generateContent: false,
    },
  });
  const webhook = await prisma.webhooks.create({
    data: { organizationId: owner, name: 'mine', url: 'https://8.8.8.8/h' },
  });
  const theirChannel = await channel(stranger, 'update-their-channel');

  const results = [
    await tools.signaturesTool.execute(
      { action: 'update', id: signature.id, content: 'taken', autoAdd: false },
      theirs
    ),
    await tools.setsTool.execute(
      {
        action: 'update',
        id: set.id,
        name: 'taken',
        content: setContent(theirChannel.id),
      },
      theirs
    ),
    await tools.autopostTool.execute(
      { action: 'update', id: autopost.id, title: 'taken' },
      theirs
    ),
    await tools.webhooksTool.execute(
      {
        action: 'update',
        id: webhook.id,
        name: 'taken',
        url: 'https://8.8.8.8/h',
        channels: [],
      },
      theirs
    ),
  ];

  for (const result of results) {
    expect(result.output).toEqual({
      errors: expect.stringMatching(/was not found/),
    });
  }
  expect(
    (await prisma.signatures.findMany({ where: { content: 'taken' } })).length
  ).toBe(0);
  expect(
    (await prisma.sets.findMany({ where: { name: 'taken' } })).length
  ).toBe(0);
  expect(
    (await prisma.autoPost.findMany({ where: { title: 'taken' } })).length
  ).toBe(0);
  expect(
    (await prisma.webhooks.findMany({ where: { name: 'taken' } })).length
  ).toBe(0);
});

test('the web update of a signature, autopost or webhook with an id that does not exist saves nothing, so a webhook cannot skip the plan limit', async () => {
  const prisma = moduleRef.get(PrismaService);
  const owner = await org('unknown-id');
  const unknown = `unknown-${run}`;

  await expect(
    moduleRef
      .get(SignatureService)
      .createOrUpdateSignature(
        owner,
        { content: 'ghost', autoAdd: false },
        unknown
      )
  ).rejects.toThrow('The signature was not found');
  await expect(
    moduleRef.get(AutopostService).createAutopost(
      owner,
      {
        title: 'ghost',
        url: 'https://postiz.test/feed.xml',
        lastUrl: '',
        integrations: [],
        active: false,
        onSlot: false,
        syncLast: false,
        addPicture: false,
        generateContent: false,
      },
      unknown
    )
  ).rejects.toThrow('The autopost was not found');
  await expect(
    moduleRef.get(WebhooksService).createWebhook(owner, {
      id: unknown,
      name: 'ghost',
      url: 'https://8.8.8.8/h',
      integrations: [],
    })
  ).rejects.toThrow('The webhook was not found');

  const inOwner = { organizationId: owner };
  expect(await prisma.signatures.count({ where: inOwner })).toBe(0);
  expect(await prisma.autoPost.count({ where: inOwner })).toBe(0);
  expect(await prisma.webhooks.count({ where: inOwner })).toBe(0);
});

test('deleting a signature, set, autopost or webhook of another organization keeps it', async () => {
  const prisma = moduleRef.get(PrismaService);
  const owner = await org('delete-owner');
  const stranger = await org('delete-stranger');
  const theirs = await connection(stranger);
  const signature = await prisma.signatures.create({
    data: { organizationId: owner, content: 'mine', autoAdd: false },
  });
  const set = await prisma.sets.create({
    data: { organizationId: owner, name: 'mine', content: '{}' },
  });
  const autopost = await prisma.autoPost.create({
    data: {
      organizationId: owner,
      title: 'mine',
      url: 'https://postiz.test/feed.xml',
      lastUrl: '',
      integrations: '[]',
      active: true,
      onSlot: false,
      syncLast: false,
      addPicture: false,
      generateContent: false,
    },
  });
  const webhook = await prisma.webhooks.create({
    data: { organizationId: owner, name: 'mine', url: 'https://8.8.8.8/h' },
  });

  const results = [
    await tools.signaturesTool.execute(
      { action: 'delete', id: signature.id },
      theirs
    ),
    await tools.setsTool.execute({ action: 'delete', id: set.id }, theirs),
    await tools.autopostTool.execute(
      { action: 'delete', id: autopost.id },
      theirs
    ),
    await tools.autopostTool.execute(
      { action: 'setActive', id: autopost.id, active: false },
      theirs
    ),
    await tools.webhooksTool.execute(
      { action: 'delete', id: webhook.id },
      theirs
    ),
  ];

  for (const result of results) {
    expect(result.output).toEqual({ errors: expect.any(String) });
    expect(JSON.stringify(result.output)).not.toMatch(/prisma|invocation/i);
  }
  expect(
    (await prisma.signatures.findUnique({ where: { id: signature.id } }))
      ?.deletedAt
  ).toBeNull();
  expect(
    await prisma.sets.findUnique({ where: { id: set.id } })
  ).not.toBeNull();
  const kept = await prisma.autoPost.findUnique({ where: { id: autopost.id } });
  expect(kept?.deletedAt).toBeNull();
  expect(kept?.active).toBe(true);
  expect(
    (await prisma.webhooks.findUnique({ where: { id: webhook.id } }))?.deletedAt
  ).toBeNull();
});

test('a webhook only listens to the channels of its own organization', async () => {
  const mine = await org('webhook-channels-mine');
  const stranger = await org('webhook-channels-stranger');
  const own = await channel(mine, 'webhook-own-channel');
  const foreign = await channel(stranger, 'webhook-foreign-channel');

  const refused = await tools.webhookCreateTool.execute(
    {
      name: 'hook',
      url: 'https://8.8.8.8/hook',
      channels: [own.id, foreign.id],
    },
    connection(mine)
  );
  const created = await tools.webhookCreateTool.execute(
    {
      name: 'hook',
      url: 'https://8.8.8.8/hook',
      channels: [own.id, own.id],
    },
    connection(mine)
  );
  const list = await tools.webhooksTool.execute(
    { action: 'list' },
    connection(mine)
  );

  expect(refused.output).toEqual({
    errors: 'One of the channels was not found',
  });
  expect(created.output).toHaveProperty('created');
  expect(list.output.webhooks).toHaveLength(1);
  expect(list.output.webhooks[0].channels.map((c: any) => c.id)).toEqual([
    own.id,
  ]);
});

test('a webhook created past the plan limit is refused, an existing one can still be updated', async () => {
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_assets_automation';
  const team = await org('webhook-limit', 'STANDARD');
  const input = (n: number) => ({
    name: `hook-${n}`,
    url: 'https://8.8.8.8/hook',
    channels: [],
  });

  const first = await tools.webhookCreateTool.execute(
    input(1),
    connection(team)
  );
  const second = await tools.webhookCreateTool.execute(
    input(2),
    connection(team)
  );

  await expect(
    tools.webhookCreateTool.execute(input(3), connection(team))
  ).rejects.toThrow();
  const update = await tools.webhooksTool.execute(
    {
      action: 'update',
      id: first.output.created.id,
      ...input(1),
      name: 'renamed',
    },
    connection(team)
  );
  const list = await tools.webhooksTool.execute(
    { action: 'list' },
    connection(team)
  );
  expect(second.output).toHaveProperty('created');
  expect(update.output).toHaveProperty('saved');
  expect(list.output.webhooks.map((w: any) => w.name).sort()).toEqual([
    'hook-2',
    'renamed',
  ]);
});

test('addresses that are not public https ones are refused by the tools that reach out', async () => {
  const team = await org('ssrf');
  const internal = 'https://127.0.0.1/hook';
  const insecure = 'http://8.8.8.8/hook';

  const results = [
    await tools.webhooksTool.execute(
      { action: 'send', url: internal, payload: { a: 1 } },
      connection(team)
    ),
    await tools.webhooksTool.execute(
      { action: 'send', url: insecure, payload: {} },
      connection(team)
    ),
    await tools.webhookCreateTool.execute(
      { name: 'hook', url: internal, channels: [] },
      connection(team)
    ),
    await tools.autopostTool.execute(
      { action: 'test', url: internal },
      connection(team)
    ),
    await tools.autopostCreateTool.execute(
      {
        title: 'feed',
        url: internal,
        active: false,
        channels: [],
        generateContent: false,
        addPicture: false,
        syncLast: true,
        onSlot: false,
      },
      connection(team)
    ),
  ];

  for (const result of results) {
    expect(result.output).toEqual({ errors: expect.any(String) });
  }
  expect(
    await moduleRef
      .get(PrismaService)
      .webhooks.count({ where: { organizationId: team } })
  ).toBe(0);
  expect(
    await moduleRef
      .get(PrismaService)
      .autoPost.count({ where: { organizationId: team } })
  ).toBe(0);
});

test('a set saved by the tool is the JSON the editor of the app loads back', async () => {
  const team = await org('sets-content');
  const own = await channel(team, 'sets-own-channel');

  const created = await tools.setsTool.execute(
    { action: 'create', name: 'weekly', content: setContent(own.id) },
    connection(team)
  );
  const stored = await moduleRef.get(SetsService).getSets(team);
  const list = await tools.setsTool.execute(
    { action: 'list' },
    connection(team)
  );
  const invalid = await tools.setsTool
    .execute(
      { action: 'create', name: 'empty', content: { posts: [] } },
      connection(team)
    )
    .catch((err: Error) => err);

  expect(created.output).toHaveProperty('saved');
  expect(JSON.parse(stored[0].content)).toEqual(setContent(own.id));
  expect(list.output.sets[0].content).toEqual(setContent(own.id));
  expect(invalid).not.toHaveProperty('output.saved');
  expect(await moduleRef.get(SetsService).getTotal(team)).toBe(1);
});

test('third party apps never return their stored API key and only run exposed functions of the own organization', async () => {
  const manager = moduleRef.get(ThirdPartyManager);
  const mine = await org('third-party-mine');
  const stranger = await org('third-party-stranger');
  const apiKey = `heygen-secret-key-${run}`;
  const saved = await manager.saveIntegration(mine, 'heygen', apiKey, {
    id: `heygen-user-${run}`,
    name: 'HeyGen User',
    username: `heygen-user-${run}`,
  });
  const encrypted = AuthService.fixedEncryption(apiKey);
  const stored = await moduleRef
    .get(PrismaService)
    .thirdParty.findUniqueOrThrow({ where: { id: saved.id } });

  const list = await tools.thirdPartyTool.execute(
    { action: 'list' },
    connection(mine)
  );
  const available = await tools.thirdPartyTool.execute(
    { action: 'available' },
    connection(mine)
  );
  const hidden = await tools.thirdPartyTool.execute(
    { action: 'callFunction', id: saved.id, functionName: 'checkConnection' },
    connection(mine)
  );
  const foreign = await tools.thirdPartyTool.execute(
    { action: 'callFunction', id: saved.id, functionName: 'voices' },
    connection(stranger)
  );
  const foreignDelete = await tools.thirdPartyTool.execute(
    { action: 'delete', id: saved.id },
    connection(stranger)
  );

  expect(stored.apiKey).not.toBe(apiKey);
  expect(list.output.connected).toEqual([
    expect.objectContaining({
      id: saved.id,
      identifier: 'heygen',
      name: 'HeyGen User',
    }),
  ]);
  for (const output of [list.output, available.output]) {
    expect(JSON.stringify(output)).not.toContain(apiKey);
    expect(JSON.stringify(output)).not.toContain(stored.apiKey);
    expect(JSON.stringify(output)).not.toContain(encrypted);
  }
  expect(hidden.output).toEqual({ errors: 'Function not found' });
  expect(foreign.output).toEqual({ errors: 'Integration not found' });
  expect(foreignDelete.output).toEqual({
    errors: 'The third party app was not found',
  });
  expect((await manager.getIntegrationById(mine, saved.id))?.id).toBe(saved.id);
});

test('updating an autopost only changes the settings that are passed', async () => {
  const team = await org('autopost-update');
  const own = await channel(team, 'autopost-own-channel');
  const created = await tools.autopostCreateTool.execute(
    {
      title: 'feed',
      url: 'https://8.8.8.8/feed.xml',
      active: false,
      channels: [own.id],
      generateContent: false,
      content: 'New item',
      addPicture: false,
      syncLast: false,
      onSlot: true,
      lastUrl: 'https://8.8.8.8/item-1',
    },
    connection(team)
  );

  const updated = await tools.autopostTool.execute(
    { action: 'update', id: created.output.created.id, title: 'renamed' },
    connection(team)
  );
  const toggled = await tools.autopostTool.execute(
    { action: 'setActive', id: created.output.created.id, active: true },
    connection(team)
  );
  await tools.autopostTool.execute(
    { action: 'setActive', id: created.output.created.id, active: false },
    connection(team)
  );
  const list = await tools.autopostTool.execute(
    { action: 'list' },
    connection(team)
  );

  expect(updated.output).toHaveProperty('saved');
  expect(toggled.output.saved.active).toBe(true);
  expect(list.output.autoposts).toEqual([
    expect.objectContaining({
      title: 'renamed',
      url: 'https://8.8.8.8/feed.xml',
      active: false,
      channels: [own.id],
      content: 'New item',
      onSlot: true,
      lastUrl: 'https://8.8.8.8/item-1',
    }),
  ]);
});
