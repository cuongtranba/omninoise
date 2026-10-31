import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { RequestContext } from '@mastra/core/di';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { ChatModule } from '@gitroom/nestjs-libraries/chat/chat.module';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

const run = Math.random().toString(36).slice(2);
let moduleRef: Awaited<
  ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
>;
let tools: Record<string, any>;
let orgId: string;
let operatorId: string;
let regularId: string;
const userIds: string[] = [];

const user = async (name: string, isSuperAdmin: boolean) => {
  const created = await moduleRef.get(PrismaService).user.create({
    data: {
      email: `${name}-${run}@postiz.test`,
      name: `${name}-${run}`,
      providerName: 'LOCAL',
      timezone: 0,
      isSuperAdmin,
    },
  });
  userIds.push(created.id);
  return created.id;
};

// the organization of an MCP connection or of the copilot: an OAuth one carries
// the user and an API key one does not
const connection = async (
  userId?: string,
  extra: { impersonating?: boolean; isSuperAdmin?: boolean } = {}
) => {
  const organization = await moduleRef
    .get(PrismaService)
    .organization.findUniqueOrThrow({ where: { id: orgId } });
  const requestContext = new RequestContext();
  requestContext.set(
    'organization',
    JSON.stringify({
      ...organization,
      users: [{ role: 'SUPERADMIN', userId, ...extra }],
    })
  );
  return { requestContext };
};

const announcementTitles = () =>
  moduleRef
    .get(PrismaService)
    .announcement.findMany({ where: { title: { contains: run } } })
    .then((rows) => rows.map((row) => row.title));

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
  const prisma = moduleRef.get(PrismaService);
  orgId = (
    await prisma.organization.create({
      data: { name: `admin-tools-${run}`, paymentId: `cus_secret_${run}` },
    })
  ).id;
  operatorId = await user('admin-operator', true);
  regularId = await user('admin-regular', false);
  await prisma.userOrganization.createMany({
    data: [operatorId, regularId].map((userId) => ({
      userId,
      organizationId: orgId,
      role: 'SUPERADMIN' as const,
    })),
  });
});

afterAll(async () => {
  const prisma = moduleRef.get(PrismaService);
  await prisma.announcement.deleteMany({ where: { title: { contains: run } } });
  await prisma.errors.deleteMany({ where: { organizationId: orgId } });
  await prisma.post.deleteMany({ where: { organizationId: orgId } });
  await prisma.integration.deleteMany({ where: { organizationId: orgId } });
  await prisma.userOrganization.deleteMany({
    where: { organizationId: orgId },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await moduleRef.close();
});

test('the admin tools refuse an API key, a regular user and a regular user who claims to be impersonating, and let the super admin of the instance in', async () => {
  const calls = [
    (c: any) => tools.adminTool.execute({ action: 'stats' }, c),
    (c: any) => tools.adminTool.execute({ action: 'errorPlatforms' }, c),
    (c: any) =>
      tools.adminTool.execute({ action: 'publishErrors', limit: 1 }, c),
    (c: any) =>
      tools.adminTool.execute({ action: 'searchUsers', name: `-${run}` }, c),
    (c: any) =>
      tools.announcementsTool.execute(
        { action: 'create', title: `refused-${run}`, description: 'text' },
        c
      ),
    (c: any) =>
      tools.announcementsTool.execute({ action: 'delete', id: 'unknown' }, c),
  ];

  for (const call of calls) {
    // a flag in the request never makes a user the super admin
    for (const refused of [
      await connection(),
      await connection(regularId),
      await connection(regularId, { impersonating: true, isSuperAdmin: true }),
    ]) {
      expect((await call(refused)).output).toEqual({ errors: 'Unauthorized' });
    }
  }
  expect(await announcementTitles()).toEqual([]);

  const allowed = await tools.adminTool.execute(
    { action: 'stats' },
    await connection(operatorId)
  );
  expect(allowed.output).toHaveProperty('stats.posts.total');
});

test('the super admin publishes and deletes an announcement and every connection, even an API key, can read them', async () => {
  const title = `Maintenance ${run}`;
  const operator = await connection(operatorId);

  const created = await tools.announcementsTool.execute(
    {
      action: 'create',
      title,
      description: 'Tonight at 22:00',
      color: 'WARNING',
    },
    operator
  );
  const id = created.output.created.id;
  expect(created.output.created).toMatchObject({
    title,
    description: 'Tonight at 22:00',
    color: 'WARNING',
  });

  const listed = await tools.announcementsTool.execute(
    { action: 'list' },
    await connection()
  );
  expect(
    listed.output.announcements.map((announcement: any) => announcement.id)
  ).toContain(id);

  const deleted = await tools.announcementsTool.execute(
    { action: 'delete', id },
    operator
  );
  const again = await tools.announcementsTool.execute(
    { action: 'delete', id },
    operator
  );
  expect(deleted.output).toEqual({ deleted: { id } });
  expect(again.output).toEqual({ errors: 'The announcement was not found' });
  expect(await announcementTitles()).toEqual([]);
});

test('the user search returns the users with their organizations and no payment data', async () => {
  const result = await tools.adminTool.execute(
    { action: 'searchUsers', name: `admin-regular-${run}` },
    await connection(operatorId)
  );

  expect(result.output.users).toEqual([
    {
      userId: regularId,
      name: `admin-regular-${run}`,
      email: `admin-regular-${run}@postiz.test`,
      organizationId: orgId,
      organizationName: `admin-tools-${run}`,
      role: 'SUPERADMIN',
      subscriptionTier: null,
    },
  ]);
  expect(JSON.stringify(result.output)).not.toContain('cus_secret');
});

test('the failed posts list the organization members and filter by platform', async () => {
  const prisma = moduleRef.get(PrismaService);
  const integration = await prisma.integration.create({
    data: {
      internalId: `internal-${run}`,
      organizationId: orgId,
      name: 'Channel',
      providerIdentifier: 'x',
      type: 'social',
      token: 'secret-token',
    },
  });
  const post = await prisma.post.create({
    data: {
      organizationId: orgId,
      integrationId: integration.id,
      group: `group-${run}`,
      content: 'The text of the post',
      publishDate: new Date(),
      state: 'ERROR',
    },
  });
  await prisma.errors.create({
    data: {
      organizationId: orgId,
      postId: post.id,
      platform: `platform-${run}`,
      message: 'Token expired',
    },
  });
  const operator = await connection(operatorId);

  const platforms = await tools.adminTool.execute(
    { action: 'errorPlatforms' },
    operator
  );
  const errors = await tools.adminTool.execute(
    { action: 'publishErrors', platform: `platform-${run}` },
    operator
  );

  expect(platforms.output.platforms).toContain(`platform-${run}`);
  expect(errors.output.publishErrors).toMatchObject({
    total: 1,
    hasMore: false,
    items: [
      {
        message: 'Token expired',
        platform: `platform-${run}`,
        postId: post.id,
        post: { id: post.id, content: 'The text of the post' },
        organization: { id: orgId, name: `admin-tools-${run}` },
      },
    ],
  });
  expect(
    errors.output.publishErrors.items[0].organization.users.map(
      (member: any) => member.id
    )
  ).toEqual(expect.arrayContaining([operatorId, regularId]));
  expect(JSON.stringify(errors.output)).not.toContain('secret-token');
});
