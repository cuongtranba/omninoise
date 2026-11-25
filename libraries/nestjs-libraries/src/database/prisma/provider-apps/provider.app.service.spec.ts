import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  ProviderAppNotFound,
  ProviderAppService,
} from '@gitroom/nestjs-libraries/database/prisma/provider-apps/provider.app.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { currentProviderApp } from '@gitroom/nestjs-libraries/integrations/provider.app.context';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { getPgPool } from '@gitroom/nestjs-libraries/pg/pg.pool';

const run = randomBytes(6).toString('hex');
const env = {
  FACEBOOK_APP_ID: 'server-facebook-id',
  FACEBOOK_APP_SECRET: 'server-facebook-secret',
  LINKEDIN_CLIENT_ID: 'server-linkedin-id',
  LINKEDIN_CLIENT_SECRET: 'server-linkedin-secret',
  FRONTEND_URL: 'https://postiz.test',
  JWT_SECRET: process.env.JWT_SECRET || 'provider-app-spec',
};
const envBefore = Object.fromEntries(
  Object.keys(env).map((key) => [key, process.env[key]])
);
let moduleRef: Awaited<
  ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
>;
let apps: ProviderAppService;
let integrations: IntegrationService;
const orgIds: string[] = [];

const org = async (name: string) => {
  const created = await moduleRef
    .get(PrismaService)
    .organization.create({ data: { name: `${name}-${run}` } });
  orgIds.push(created.id);
  return created.id;
};

const channel = (
  organizationId: string,
  name: string,
  data: {
    providerAppId?: string | null;
    rootInternalId?: string;
    internalId?: string;
  } = {}
) =>
  moduleRef.get(PrismaService).integration.create({
    data: {
      organizationId,
      internalId: `${name}-${run}`,
      name,
      providerIdentifier: 'linkedin',
      type: 'social',
      token: `token-${name}`,
      ...data,
    },
  });

const boundApp = (id: string) =>
  moduleRef.get(PrismaService).integration.findUnique({
    where: { id },
    select: { providerAppId: true },
  });

const clientIdOf = (url: string) => new URL(url).searchParams.get('client_id');

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
  Object.assign(process.env, env);
  moduleRef = await Test.createTestingModule({
    imports: [DatabaseModule, JobsModule],
  }).compile();
  apps = moduleRef.get(ProviderAppService);
  integrations = moduleRef.get(IntegrationService);
});

afterAll(async () => {
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  const prisma = moduleRef.get(PrismaService);
  await prisma.integration.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await prisma.notifications.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await prisma.providerApp.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await moduleRef.close();
});

test('a connect link carries the organization app, or the server app when it has none', async () => {
  const mine = await org('connect-mine');
  const other = await org('connect-other');
  await apps.save(mine, 'facebook', {
    clientId: `mine-${run}`,
    clientSecret: 'secret',
  });

  const withApp = await integrations.generateConnectUrl(mine, 'facebook', {});
  const withoutApp = await integrations.generateConnectUrl(
    other,
    'facebook',
    {}
  );

  expect(clientIdOf(withApp.url)).toBe(`mine-${run}`);
  expect(clientIdOf(withoutApp.url)).toBe('server-facebook-id');
});

test('LinkedIn pages connect through the LinkedIn app', async () => {
  const mine = await org('linkedin-page');
  await apps.save(mine, 'linkedin', {
    clientId: `linkedin-${run}`,
    clientSecret: 'secret',
  });

  const { url } = await integrations.generateConnectUrl(
    mine,
    'linkedin-page',
    {}
  );

  expect(clientIdOf(url)).toBe(`linkedin-${run}`);
});

test('the client secret is stored encrypted and never leaves the server', async () => {
  const mine = await org('secret');
  const secret = `top-secret-${run}`;
  const { id } = await apps.save(mine, 'facebook', {
    clientId: `secret-app-${run}`,
    clientSecret: secret,
  });

  const { url } = await integrations.generateConnectUrl(mine, 'facebook', {});
  const stored = await moduleRef
    .get(PrismaService)
    .providerApp.findUnique({ where: { id } });
  const keyValueRows = await getPgPool().query(
    'SELECT key FROM pgonly.kv_store WHERE value LIKE $1',
    [`%${secret}%`]
  );

  expect(stored.clientSecret).not.toContain(secret);
  expect(AuthService.fixedDecryption(stored.clientSecret)).toBe(secret);
  expect(JSON.stringify(await apps.list(mine))).not.toContain(secret);
  expect(url).not.toContain(secret);
  expect(keyValueRows.rows).toEqual([]);
  // the callback learns the app from the state, by id only
  expect(
    await ioRedis.get(`providerApp:${new URL(url).searchParams.get('state')}`)
  ).toBe(id);
});

test('concurrent calls of two organizations each run with their own app', async () => {
  const first = await org('concurrent-first');
  const second = await org('concurrent-second');
  const firstApp = await apps.save(first, 'facebook', {
    clientId: `first-${run}`,
    clientSecret: 'secret',
  });
  const secondApp = await apps.save(second, 'facebook', {
    clientId: `second-${run}`,
    clientSecret: 'secret',
  });
  const facebook = moduleRef
    .get(IntegrationManager)
    .getSocialIntegration('facebook');
  const authUrl = (organizationId: string, providerAppId: string) =>
    apps.run({ organizationId, providerAppId }, async () => {
      const { url } = await facebook.generateAuthUrl();
      return url;
    });

  const [firstUrl, secondUrl] = await Promise.all([
    authUrl(first, firstApp.id),
    authUrl(second, secondApp.id),
  ]);

  expect(clientIdOf(firstUrl)).toBe(`first-${run}`);
  expect(clientIdOf(secondUrl)).toBe(`second-${run}`);
});

test('an organization cannot run with the app of another organization', async () => {
  const owner = await org('tenant-owner');
  const stranger = await org('tenant-stranger');
  const app = await apps.save(owner, 'facebook', {
    clientId: `owner-${run}`,
    clientSecret: 'secret',
  });
  let ran = false;

  try {
    await apps.run({ organizationId: stranger, providerAppId: app.id }, () => {
      ran = true;
      return Promise.resolve();
    });
  } catch (e) {
    if (!(e instanceof ProviderAppNotFound)) throw e;
  }

  expect(ran).toBe(false);
});

test('saving an app without a secret keeps the stored secret', async () => {
  const mine = await org('keep-secret');
  const { id } = await apps.save(mine, 'facebook', {
    clientId: `keep-${run}`,
    clientSecret: 'first-secret',
  });

  await apps.save(mine, 'facebook', { clientId: `keep-${run}` });
  const app = await apps.run({ organizationId: mine, providerAppId: id }, () =>
    Promise.resolve(currentProviderApp())
  );

  expect(app).toEqual({
    family: 'facebook',
    clientId: `keep-${run}`,
    clientSecret: 'first-secret',
  });
});

test('an app in use keeps its client ID and cannot be deleted; once free it can be deleted and saved again', async () => {
  const mine = await org('lifecycle');
  const { id } = await apps.save(mine, 'facebook', {
    clientId: `lifecycle-${run}`,
    clientSecret: 'secret',
  });
  const used = await channel(mine, 'lifecycle', { providerAppId: id });
  const status = async (call: Promise<unknown>) => {
    try {
      await call;
    } catch (e) {
      if (!(e instanceof HttpException)) throw e;
      return e.getStatus();
    }
    return 'ok';
  };

  const changeInUse = await status(
    apps.save(mine, 'facebook', { clientId: `changed-${run}` })
  );
  const deleteInUse = await status(apps.delete(mine, 'facebook'));
  await moduleRef.get(PrismaService).integration.update({
    where: { id: used.id },
    data: { deletedAt: new Date() },
  });
  const deleteFree = await status(apps.delete(mine, 'facebook'));
  const listedAfterDelete = (await apps.list(mine)).find(
    (f) => f.family === 'facebook'
  )?.app;
  const restoreWithoutSecret = await status(
    apps.save(mine, 'facebook', { clientId: `again-${run}` })
  );
  const restored = await apps.save(mine, 'facebook', {
    clientId: `again-${run}`,
    clientSecret: 'new-secret',
  });

  expect([changeInUse, deleteInUse, deleteFree]).toEqual([409, 409, 'ok']);
  expect(listedAfterDelete).toBeNull();
  expect(restoreWithoutSecret).toBe(400);
  expect(
    await apps.run({ organizationId: mine, providerAppId: restored.id }, () =>
      Promise.resolve(currentProviderApp())
    )
  ).toEqual({
    family: 'facebook',
    clientId: `again-${run}`,
    clientSecret: 'new-secret',
  });
});

test('a token refresh keeps a channel on its app, a reconnect binds it to the app it went through', async () => {
  const mine = await org('refresh');
  const app = await apps.save(mine, 'linkedin', {
    clientId: `refresh-${run}`,
    clientSecret: 'secret',
  });
  const save = (providerAppId?: string | null) =>
    integrations.createOrUpdateIntegration(
      undefined,
      false,
      mine,
      'Channel',
      undefined,
      'social',
      `refresh-${run}`,
      'linkedin',
      'token',
      'refresh-token',
      3600,
      'user',
      false,
      undefined,
      undefined,
      undefined,
      providerAppId
    );

  const connected = await save(app.id);
  await save();
  const afterRefresh = await boundApp(connected.id);
  await save(null);
  const afterServerReconnect = await boundApp(connected.id);

  expect(afterRefresh.providerAppId).toBe(app.id);
  expect(afterServerReconnect.providerAppId).toBeNull();
});

test('LinkedIn siblings take a fresh token with its app, never in another organization on another app', async () => {
  const mine = await org('siblings-mine');
  const other = await org('siblings-other');
  const app = await apps.save(mine, 'linkedin', {
    clientId: `siblings-${run}`,
    clientSecret: 'secret',
  });
  const root = `siblings-root-${run}`;
  const page = await channel(mine, 'siblings-page', { rootInternalId: root });
  const foreign = await channel(other, 'siblings-foreign', {
    rootInternalId: root,
  });

  await integrations.createOrUpdateIntegration(
    undefined,
    true,
    mine,
    'Person',
    undefined,
    'social',
    root,
    'linkedin',
    'fresh-token',
    'refresh-token',
    3600,
    'person',
    false,
    undefined,
    undefined,
    undefined,
    app.id
  );

  const prisma = moduleRef.get(PrismaService);
  const [pageAfter, foreignAfter] = await Promise.all(
    [page.id, foreign.id].map((id) =>
      prisma.integration.findUnique({
        where: { id },
        select: { token: true, providerAppId: true },
      })
    )
  );

  expect(pageAfter).toEqual({ token: 'fresh-token', providerAppId: app.id });
  expect(foreignAfter).toEqual({
    token: 'token-siblings-foreign',
    providerAppId: null,
  });
});

test('a channel whose app is gone is flagged to be connected again', async () => {
  const mine = await org('app-gone');
  const app = await apps.save(mine, 'facebook', {
    clientId: `gone-${run}`,
    clientSecret: 'secret',
  });
  const orphan = await channel(mine, 'app-gone', { providerAppId: app.id });
  // the app was deleted while the channel was being connected
  await moduleRef.get(PrismaService).providerApp.update({
    where: { id: app.id },
    data: { deletedAt: new Date() },
  });

  const result = await integrations.callProviderFunction(
    orphan,
    'mention',
    { query: 'someone' },
    { disconnectOnRefreshFailure: false }
  );
  const after = await moduleRef.get(PrismaService).integration.findUnique({
    where: { id: orphan.id },
    select: { refreshNeeded: true },
  });

  expect(result.status).toBe('disconnected');
  expect(after.refreshNeeded).toBe(true);
});

test('picking a page that is already a channel keeps the app of the fresh login', async () => {
  const mine = await org('repick');
  const app = await apps.save(mine, 'facebook', {
    clientId: `repick-${run}`,
    clientSecret: 'secret',
  });
  const pageId = `repick-page-${run}`;
  const existingPage = await channel(mine, 'repick-existing', {
    internalId: pageId,
    providerAppId: null,
  });
  const freshLogin = await channel(mine, 'repick-login', {
    providerAppId: app.id,
  });

  await moduleRef.get(IntegrationRepository).updateIntegration(freshLogin.id, {
    internalId: pageId,
    organizationId: mine,
    name: 'Page',
    inBetweenSteps: false,
    token: 'page-token',
  });

  expect((await boundApp(existingPage.id)).providerAppId).toBe(app.id);
});
