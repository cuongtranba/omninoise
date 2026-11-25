import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { RequestContext } from '@mastra/core/di';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { ChatModule } from '@gitroom/nestjs-libraries/chat/chat.module';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

process.env.JWT_SECRET ||= 'admin-tools-spec-secret';

const run = randomBytes(6).toString('hex');
let moduleRef: Awaited<
  ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
>;
let tools: Record<string, any>;
let orgId: string;
let operatorId: string;
let regularId: string;
const userIds: string[] = [];
const orgIds: string[] = [];

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

// an organization of the instance with these members
const organization = async (
  name: string,
  members: [string, 'USER' | 'ADMIN' | 'SUPERADMIN'][]
) => {
  const created = await moduleRef.get(PrismaService).organization.create({
    data: {
      name: `${name}-${run}`,
      users: {
        create: members.map(([userId, role]) => ({ userId, role })),
      },
    },
  });
  orgIds.push(created.id);
  return created.id;
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
  orgIds.push(orgId);
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
  const inOrgs = { organizationId: { in: orgIds } };
  await prisma.errors.deleteMany({ where: inOrgs });
  await prisma.post.deleteMany({ where: inOrgs });
  await prisma.integration.deleteMany({ where: inOrgs });
  await prisma.userOrganization.deleteMany({ where: inOrgs });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
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
    (c: any) => tools.platformInviteTool.execute({ sendEmail: false }, c),
    (c: any) => tools.adminTool.execute({ action: 'listOrganizations' }, c),
    (c: any) => tools.adminTool.execute({ action: 'listUsers' }, c),
    (c: any) =>
      tools.adminManageTool.execute(
        { action: 'deleteOrganization', organizationId: orgId },
        c
      ),
    (c: any) =>
      tools.adminManageTool.execute(
        { action: 'setUserAccess', userId: operatorId, disabled: true },
        c
      ),
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
  expect(
    await moduleRef
      .get(PrismaService)
      .organization.findUniqueOrThrow({ where: { id: orgId } })
  ).toMatchObject({ deletedAt: null });

  const allowed = await tools.adminTool.execute(
    { action: 'stats' },
    await connection(operatorId)
  );
  expect(allowed.output).toHaveProperty('stats.posts.total');

  const invited = await tools.platformInviteTool.execute(
    { sendEmail: false },
    await connection(operatorId)
  );
  expect(invited.output).toEqual({ url: expect.stringContaining('/?org=') });
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

test('the organization list finds an organization by the email of a member, with its owner and member count', async () => {
  const result = await tools.adminTool.execute(
    { action: 'listOrganizations', search: `admin-regular-${run}@` },
    await connection(operatorId)
  );

  expect(result.output.organizations).toMatchObject({
    total: 1,
    items: [
      {
        id: orgId,
        name: `admin-tools-${run}`,
        deletedAt: null,
        members: 2,
        ownerEmail: expect.stringContaining(`-${run}@postiz.test`),
      },
    ],
  });
});

test('the super admin adds a member and changes their role, but never demotes or removes the last owner', async () => {
  const ownerId = await user('member-owner', false);
  const memberId = await user('member-added', false);
  const teamId = await organization('members', [[ownerId, 'SUPERADMIN']]);
  const operator = await connection(operatorId);
  const manage = (input: Record<string, unknown>) =>
    tools.adminManageTool.execute(
      { organizationId: teamId, ...input },
      operator
    );

  const added = await manage({
    action: 'addMember',
    email: `member-added-${run}@postiz.test`,
    role: 'USER',
  });
  const promoted = await manage({
    action: 'updateMember',
    userId: memberId,
    role: 'ADMIN',
  });
  const demoted = await manage({
    action: 'updateMember',
    userId: ownerId,
    role: 'USER',
  });
  const removed = await manage({ action: 'removeMember', userId: ownerId });

  expect(added.output).toEqual({ id: expect.any(String) });
  expect(promoted.output).toEqual({ id: added.output.id });
  expect(demoted.output).toEqual({
    errors: 'The organization must keep at least one owner',
  });
  expect(removed.output).toEqual(demoted.output);
  expect(
    await moduleRef.get(PrismaService).userOrganization.findMany({
      where: { organizationId: teamId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, role: true },
    })
  ).toEqual([
    { userId: ownerId, role: 'SUPERADMIN' },
    { userId: memberId, role: 'ADMIN' },
  ]);
});

test('deleting an organization disables its enabled channels and restoring it enables only those again', async () => {
  const prisma = moduleRef.get(PrismaService);
  const deletedId = await organization('deleted', []);
  const channel = (name: string, disabled: boolean) =>
    prisma.integration.create({
      data: {
        internalId: `${name}-${run}`,
        organizationId: deletedId,
        name,
        providerIdentifier: 'x',
        type: 'social',
        token: 'secret-token',
        disabled,
      },
    });
  const enabled = await channel('enabled', false);
  const disabledBefore = await channel('disabled-before', true);
  const operator = await connection(operatorId);
  const channels = async () =>
    Object.fromEntries(
      (
        await prisma.integration.findMany({
          where: { id: { in: [enabled.id, disabledBefore.id] } },
        })
      ).map((row) => [row.name, row.disabled])
    );

  const deleted = await tools.adminManageTool.execute(
    { action: 'deleteOrganization', organizationId: deletedId },
    operator
  );
  const afterDelete = await channels();
  const deletedAt = (
    await prisma.organization.findUniqueOrThrow({ where: { id: deletedId } })
  ).deletedAt;
  const restored = await tools.adminManageTool.execute(
    { action: 'restoreOrganization', organizationId: deletedId },
    operator
  );

  expect(deleted.output).toEqual({ id: deletedId });
  expect(deletedAt).not.toBeNull();
  expect(afterDelete).toEqual({ enabled: true, 'disabled-before': true });
  expect(restored.output).toEqual({ id: deletedId });
  expect(await channels()).toEqual({
    enabled: false,
    'disabled-before': true,
  });
  expect(
    await prisma.organization.findUniqueOrThrow({ where: { id: deletedId } })
  ).toMatchObject({ deletedAt: null });
});

test('the super admin blocks an account, but never their own', async () => {
  const blockedId = await user('admin-blocked', false);
  const operator = await connection(operatorId);

  const blocked = await tools.adminManageTool.execute(
    { action: 'setUserAccess', userId: blockedId, disabled: true },
    operator
  );
  const self = await tools.adminManageTool.execute(
    { action: 'setUserAccess', userId: operatorId, disabled: true },
    operator
  );
  const listed = await tools.adminTool.execute(
    { action: 'listUsers', search: `admin-blocked-${run}` },
    operator
  );

  expect(blocked.output).toEqual({ id: blockedId });
  expect(self.output).toEqual({ errors: 'You cannot block your own account' });
  expect(listed.output.accounts.items).toEqual([
    expect.objectContaining({ id: blockedId, disabledAt: expect.any(String) }),
  ]);
  expect(
    await moduleRef
      .get(PrismaService)
      .user.findUniqueOrThrow({ where: { id: operatorId } })
  ).toMatchObject({ disabledAt: null });
});
