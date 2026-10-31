import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { RequestContext } from '@mastra/core/di';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { ChatModule } from '@gitroom/nestjs-libraries/chat/chat.module';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

process.env.JWT_SECRET ||= 'team-user-tools-spec-secret';

type Role = 'USER' | 'ADMIN' | 'SUPERADMIN';

const run = Math.random().toString(36).slice(2);
const stripeBefore = process.env.STRIPE_PUBLISHABLE_KEY;
let moduleRef: Awaited<
  ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
>;
let tools: Record<string, any>;
let appId: string;
const orgIds: string[] = [];
const userIds: string[] = [];

// an organization on a plan that includes team members
const org = async (name: string, apiKey?: string) => {
  const prisma = moduleRef.get(PrismaService);
  const created = await prisma.organization.create({
    data: { name: `${name}-${run}`, apiKey },
  });
  await prisma.subscription.create({
    data: {
      organizationId: created.id,
      subscriptionTier: 'TEAM',
      period: 'MONTHLY',
      totalChannels: 10,
    },
  });
  orgIds.push(created.id);
  return created.id;
};

const user = async (
  name: string,
  data: { isSuperAdmin?: boolean; name?: string; password?: string } = {}
) => {
  const created = await moduleRef.get(PrismaService).user.create({
    data: {
      email: `${name}-${run}@postiz.test`,
      providerName: 'LOCAL',
      timezone: 0,
      ...data,
    },
  });
  userIds.push(created.id);
  return created.id;
};

const member = (organizationId: string, userId: string, role: Role) =>
  moduleRef
    .get(PrismaService)
    .userOrganization.create({ data: { organizationId, userId, role } });

// the access token a user approved for an organization
const approve = async (
  userId: string,
  organizationId: string,
  name: string
) => {
  const token = `pos_${name}_${run}`;
  const authorization = await moduleRef
    .get(PrismaService)
    .oAuthAuthorization.create({
      data: {
        oauthAppId: appId,
        userId,
        organizationId,
        accessToken: AuthService.fixedEncryption(token),
      },
    });
  return { token, id: authorization.id };
};

const isMember = async (organizationId: string, userId: string) =>
  !!(await moduleRef
    .get(PrismaService)
    .userOrganization.findFirst({ where: { organizationId, userId } }));

// the organization of an MCP connection, an OAuth one carries the user and an
// API key one does not (the copilot also tells when the user is impersonated)
const connection = async (
  id: string,
  role: Role,
  userId?: string,
  impersonating = false
) => {
  const organization = await moduleRef
    .get(PrismaService)
    .organization.findUniqueOrThrow({
      where: { id },
      include: { subscription: true },
    });
  const requestContext = new RequestContext();
  requestContext.set(
    'organization',
    JSON.stringify({
      ...organization,
      users: [{ role, userId, impersonating }],
    })
  );
  return { requestContext };
};

// the plan limits are only checked when billing is on
const billingOn = () => {
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_team_user';
};

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
  appId = (
    await moduleRef.get(PrismaService).oAuthApp.create({
      data: {
        name: `client-${run}`,
        redirectUrl: 'https://postiz.test/callback',
        clientId: `client-${run}`,
        dynamic: true,
      },
    })
  ).id;
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
  await prisma.oAuthAuthorization.deleteMany({ where: { oauthAppId: appId } });
  await prisma.oAuthApp.deleteMany({
    where: { OR: [{ id: appId }, inOrgs] },
  });
  await prisma.userOrganization.deleteMany({
    where: { OR: [inOrgs, { userId: { in: userIds } }] },
  });
  await prisma.subscription.deleteMany({ where: inOrgs });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await moduleRef.close();
});

test('a USER member cannot invite or remove team members', async () => {
  billingOn();
  const team = await org('team-user-role');
  const regular = await user('team-user-role-regular');
  const other = await user('team-user-role-other');
  await member(team, regular, 'USER');
  await member(team, other, 'USER');

  await expect(
    tools.teamTool.execute(
      { action: 'invite', role: 'USER', sendEmail: false },
      await connection(team, 'USER', regular)
    )
  ).rejects.toThrow();
  await expect(
    tools.teamTool.execute(
      { action: 'remove', id: other },
      await connection(team, 'USER', regular)
    )
  ).rejects.toThrow();
  expect(await isMember(team, other)).toBe(true);
  // the same call of an admin goes through
  const adminRemove = await tools.teamTool.execute(
    { action: 'remove', id: other },
    await connection(team, 'ADMIN', regular)
  );
  expect(adminRemove.output).toEqual({ removed: { id: other } });
  expect(await isMember(team, other)).toBe(false);
});

test('a removed member loses the OAuth connection they approved and the team list no longer shows them', async () => {
  const team = await org('team-removed');
  const owner = await user('team-removed-owner');
  const leaving = await user('team-removed-leaving');
  await member(team, owner, 'SUPERADMIN');
  await member(team, leaving, 'USER');
  const { token } = await approve(leaving, team, 'team-removed');
  const oauth = moduleRef.get(OAuthService);
  expect(await oauth.resolveAccessToken(token)).not.toBeNull();

  const removed = await tools.teamTool.execute(
    { action: 'remove', id: leaving },
    await connection(team, 'SUPERADMIN', owner)
  );
  const list = await tools.teamTool.execute(
    { action: 'list' },
    await connection(team, 'SUPERADMIN', owner)
  );

  expect(removed.output).toEqual({ removed: { id: leaving } });
  expect(await oauth.resolveAccessToken(token)).toBeNull();
  expect(list.output.members.map((m: any) => m.id)).toEqual([owner]);
});

test('a member of another organization cannot be removed', async () => {
  const mine = await org('team-mine');
  const theirs = await org('team-theirs');
  const stranger = await user('team-stranger');
  await member(theirs, stranger, 'USER');

  const result = await tools.teamTool.execute(
    { action: 'remove', id: stranger },
    await connection(mine, 'SUPERADMIN')
  );

  expect(result.output).toHaveProperty('errors');
  expect(await isMember(theirs, stranger)).toBe(true);
});

test('an admin cannot remove a member with a higher role', async () => {
  const team = await org('team-levels');
  const owner = await user('team-levels-owner');
  const admin = await user('team-levels-admin');
  await member(team, owner, 'SUPERADMIN');
  await member(team, admin, 'ADMIN');

  const result = await tools.teamTool.execute(
    { action: 'remove', id: owner },
    await connection(team, 'ADMIN', admin)
  );

  expect(result.output).toHaveProperty('errors');
  expect(await isMember(team, owner)).toBe(true);
});

test('adding an account by email needs the super admin of the instance and a connection with a user', async () => {
  const team = await org('team-add');
  const regular = await user('team-add-regular');
  const operator = await user('team-add-operator', { isSuperAdmin: true });
  const target = await user('team-add-target');
  await member(team, regular, 'SUPERADMIN');
  await member(team, operator, 'SUPERADMIN');
  const input = { email: `team-add-target-${run}@postiz.test`, role: 'USER' };

  const byRegular = await tools.teamAddMemberTool.execute(
    input,
    await connection(team, 'SUPERADMIN', regular)
  );
  const byApiKey = await tools.teamAddMemberTool.execute(
    input,
    await connection(team, 'SUPERADMIN')
  );

  expect(byRegular.output).toEqual({ errors: 'Unauthorized' });
  expect(byApiKey.output).toHaveProperty('errors');
  expect(await isMember(team, target)).toBe(false);
  // the super admin adds it
  const byOperator = await tools.teamAddMemberTool.execute(
    input,
    await connection(team, 'SUPERADMIN', operator)
  );
  expect(byOperator.output).toEqual({ added: true });
  expect(await isMember(team, target)).toBe(true);
});

test('an invitation link adds the user who opens it once', async () => {
  const team = await org('team-invite');
  const owner = await user('team-invite-owner');
  const first = await user('team-invite-first');
  const second = await user('team-invite-second');
  await member(team, owner, 'SUPERADMIN');

  const invite = await tools.teamTool.execute(
    { action: 'invite', role: 'ADMIN', sendEmail: false },
    await connection(team, 'SUPERADMIN')
  );
  const link = invite.output.url as string;
  const joinedFirst = await tools.userOrganizationsTool.execute(
    { action: 'join', invite: link },
    await connection(team, 'SUPERADMIN', first)
  );
  const joinedSecond = await tools.userOrganizationsTool.execute(
    { action: 'join', invite: link },
    await connection(team, 'SUPERADMIN', second)
  );
  const forged = await tools.userOrganizationsTool.execute(
    { action: 'join', invite: 'not-an-invitation' },
    await connection(team, 'SUPERADMIN', second)
  );
  const byApiKey = await tools.userOrganizationsTool.execute(
    { action: 'join', invite: link },
    await connection(team, 'SUPERADMIN')
  );

  expect(joinedFirst.output).toEqual({ joined: true, organizationId: team });
  expect(joinedSecond.output).toEqual({ joined: false, organizationId: null });
  expect(forged.output).toEqual({ joined: false, organizationId: null });
  expect(byApiKey.output).toHaveProperty('errors');
  expect(await isMember(team, first)).toBe(true);
  expect(await isMember(team, second)).toBe(false);
});

test('an API key connection cannot read or change the personal settings and a user connection can', async () => {
  const team = await org('account-personal');
  const owner = await user('account-personal-owner', { name: 'Old Name' });
  await member(team, owner, 'SUPERADMIN');
  const prisma = moduleRef.get(PrismaService);

  const byApiKey = await tools.userAccountTool.execute(
    { action: 'updatePersonal', fullname: 'Taken Over' },
    await connection(team, 'SUPERADMIN')
  );
  const notifications = await tools.userAccountTool.execute(
    {
      action: 'updateEmailNotifications',
      sendSuccessEmails: false,
      sendFailureEmails: false,
      sendStreakEmails: false,
    },
    await connection(team, 'SUPERADMIN')
  );

  expect(byApiKey.output).toHaveProperty('errors');
  expect(notifications.output).toHaveProperty('errors');
  const untouched = await prisma.user.findUniqueOrThrow({
    where: { id: owner },
  });
  expect(untouched.name).toBe('Old Name');
  expect(untouched.sendSuccessEmails).toBe(true);
  // the user's own connection can
  const byUser = await tools.userAccountTool.execute(
    { action: 'updatePersonal', fullname: 'New Name', bio: 'Hello' },
    await connection(team, 'SUPERADMIN', owner)
  );
  expect(byUser.output.personal).toMatchObject({
    name: 'New Name',
    bio: 'Hello',
  });
});

test('the account of the user shows the plan and never the password or the API key', async () => {
  const team = await org('account-self', `secret-api-key-${run}`);
  const owner = await user('account-self-owner', {
    password: 'secret-password-hash',
  });
  await member(team, owner, 'SUPERADMIN');

  const result = await tools.userAccountTool.execute(
    { action: 'self' },
    await connection(team, 'SUPERADMIN', owner)
  );

  expect(result.output.account).toMatchObject({
    id: owner,
    orgId: team,
    role: 'SUPERADMIN',
    tier: 'TEAM',
    admin: false,
  });
  expect(JSON.stringify(result)).not.toContain('secret-password-hash');
  expect(JSON.stringify(result)).not.toContain(`secret-api-key-${run}`);
});

test('an account is not deleted by an API key connection or without the confirmation of what it takes with it', async () => {
  const team = await org('delete-account');
  const owner = await user('delete-account-owner');
  const colleague = await user('delete-account-colleague');
  await member(team, owner, 'SUPERADMIN');
  await member(team, colleague, 'USER');
  const prisma = moduleRef.get(PrismaService);
  const deletedAt = async () =>
    (await prisma.user.findUniqueOrThrow({ where: { id: owner } })).deletedAt;

  const info = await tools.accountDeleteTool.execute(
    { action: 'info' },
    await connection(team, 'SUPERADMIN', owner)
  );
  const byApiKey = await tools.accountDeleteTool.execute(
    {
      action: 'delete',
      confirm: true,
      hasSubscription: true,
      hasAdditionalMembers: true,
    },
    await connection(team, 'SUPERADMIN')
  );
  const withoutConfirm = await tools.accountDeleteTool.execute(
    { action: 'delete', hasSubscription: true, hasAdditionalMembers: true },
    await connection(team, 'SUPERADMIN', owner)
  );
  const wrongInfo = await tools.accountDeleteTool.execute(
    {
      action: 'delete',
      confirm: true,
      hasSubscription: true,
      hasAdditionalMembers: false,
    },
    await connection(team, 'SUPERADMIN', owner)
  );

  expect(info.output).toEqual({
    hasSubscription: true,
    hasAdditionalMembers: true,
  });
  expect(byApiKey.output).toHaveProperty('errors');
  expect(withoutConfirm.output).toHaveProperty('errors');
  expect(wrongInfo.output).toHaveProperty('errors');
  expect(await deletedAt()).toBeNull();
  expect(await isMember(team, colleague)).toBe(true);
  // confirmed with what the info returned
  const deleted = await tools.accountDeleteTool.execute(
    {
      action: 'delete',
      confirm: true,
      hasSubscription: true,
      hasAdditionalMembers: true,
    },
    await connection(team, 'SUPERADMIN', owner)
  );
  expect(deleted.output).toEqual({ deleted: true });
  expect(await deletedAt()).not.toBeNull();
  expect(await isMember(team, colleague)).toBe(false);
});

test('an account is not deleted while a super admin impersonates it', async () => {
  const team = await org('delete-impersonated');
  const owner = await user('delete-impersonated-owner');
  await member(team, owner, 'SUPERADMIN');
  const deletedAt = async () =>
    (
      await moduleRef
        .get(PrismaService)
        .user.findUniqueOrThrow({ where: { id: owner } })
    ).deletedAt;
  const input = {
    action: 'delete',
    confirm: true,
    hasSubscription: true,
    hasAdditionalMembers: false,
  };

  const impersonated = await tools.accountDeleteTool.execute(
    input,
    await connection(team, 'SUPERADMIN', owner, true)
  );

  expect(impersonated.output).toEqual({
    errors: 'Account cannot be deleted while impersonating',
  });
  expect(await deletedAt()).toBeNull();
  // the same call without the impersonation deletes it
  const own = await tools.accountDeleteTool.execute(
    input,
    await connection(team, 'SUPERADMIN', owner)
  );
  expect(own.output).toEqual({ deleted: true });
  expect(await deletedAt()).not.toBeNull();
});

test('saving the personal settings keeps the profile picture and a timezone that is not an IANA one is refused', async () => {
  const team = await org('account-picture');
  const owner = await user('account-picture-owner');
  await member(team, owner, 'SUPERADMIN');
  const prisma = moduleRef.get(PrismaService);
  const picture = await prisma.media.create({
    data: {
      name: `picture-${run}`,
      path: 'https://postiz.test/me.png',
      organizationId: team,
    },
  });
  await prisma.user.update({
    where: { id: owner },
    data: { pictureId: picture.id },
  });

  const saved = await tools.userAccountTool.execute(
    { action: 'updatePersonal', fullname: 'With Picture' },
    await connection(team, 'SUPERADMIN', owner)
  );
  const badZone = await tools.userAccountTool.execute(
    { action: 'setTimezone', timezoneName: 'Nowhere/Land' },
    await connection(team, 'SUPERADMIN', owner)
  );
  const goodZone = await tools.userAccountTool.execute(
    { action: 'setTimezone', timezoneName: 'Europe/Berlin' },
    await connection(team, 'SUPERADMIN', owner)
  );

  expect(saved.output.personal.picture).toEqual({
    id: picture.id,
    path: 'https://postiz.test/me.png',
  });
  expect(badZone.output).toHaveProperty('errors');
  expect(goodZone.output).toEqual({ timezoneName: 'Europe/Berlin' });
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: owner } });
  expect(stored.timezoneName).toBe('Europe/Berlin');
  await prisma.user.update({ where: { id: owner }, data: { pictureId: null } });
  await prisma.media.delete({ where: { id: picture.id } });
});

test('an OAuth app redirect url that is not an http(s) url is refused and nothing is stored', async () => {
  const team = await org('oauth-app-redirect');
  const prisma = moduleRef.get(PrismaService);
  const stored = () =>
    prisma.oAuthApp.findMany({
      where: { organizationId: team, deletedAt: null },
    });
  // javascript:1/%0aalert(1) passes a url check that does not need a protocol
  const unsafe = [
    'javascript:alert(1)//',
    'javascript:1/%0aalert(1)',
    'data:text/html,x',
    'localhost:3000/callback',
  ];

  for (const redirectUrl of unsafe) {
    const created = await tools.oauthAppTool.execute(
      { action: 'create', name: 'Unsafe app', redirectUrl },
      await connection(team, 'SUPERADMIN')
    );
    expect(created.output).toHaveProperty('errors');
  }
  expect(await stored()).toEqual([]);

  const created = await tools.oauthAppTool.execute(
    {
      action: 'create',
      name: 'Safe app',
      redirectUrl: 'http://localhost:3000/callback',
    },
    await connection(team, 'SUPERADMIN')
  );
  expect(created.output.app.redirectUrl).toBe('http://localhost:3000/callback');
  for (const redirectUrl of unsafe) {
    const updated = await tools.oauthAppTool.execute(
      { action: 'update', redirectUrl },
      await connection(team, 'SUPERADMIN')
    );
    expect(updated.output).toHaveProperty('errors');
  }
  expect((await stored()).map((app) => app.redirectUrl)).toEqual([
    'http://localhost:3000/callback',
  ]);
});

test('the OAuth app of another organization is not visible, changed or deleted', async () => {
  const mine = await org('oauth-app-mine');
  const theirs = await org('oauth-app-theirs');

  const created = await tools.oauthAppTool.execute(
    {
      action: 'create',
      name: 'My app',
      redirectUrl: 'https://postiz.test/mine',
    },
    await connection(mine, 'SUPERADMIN')
  );
  const seenByStranger = await tools.oauthAppTool.execute(
    { action: 'get' },
    await connection(theirs, 'SUPERADMIN')
  );
  const updatedByStranger = await tools.oauthAppTool.execute(
    { action: 'update', name: 'Hijacked' },
    await connection(theirs, 'SUPERADMIN')
  );
  const deletedByStranger = await tools.oauthAppTool.execute(
    { action: 'delete' },
    await connection(theirs, 'SUPERADMIN')
  );
  const seenByOwner = await tools.oauthAppTool.execute(
    { action: 'get' },
    await connection(mine, 'SUPERADMIN')
  );

  expect(seenByStranger.output).toEqual({ app: null });
  expect(updatedByStranger.output).toHaveProperty('errors');
  expect(deletedByStranger.output).toHaveProperty('errors');
  expect(seenByOwner.output.app).toMatchObject({
    id: created.output.app.id,
    name: 'My app',
  });
});

test('the client secret of the OAuth app is returned only when it is created or rotated', async () => {
  const team = await org('oauth-app-secret');
  const prisma = moduleRef.get(PrismaService);
  const created = await tools.oauthAppTool.execute(
    {
      action: 'create',
      name: 'Secret app',
      redirectUrl: 'https://postiz.test/secret',
    },
    await connection(team, 'SUPERADMIN')
  );
  const secret = created.output.clientSecret as string;
  const storedBefore = await prisma.oAuthApp.findFirstOrThrow({
    where: { organizationId: team, deletedAt: null },
  });

  const read = await tools.oauthAppTool.execute(
    { action: 'get' },
    await connection(team, 'SUPERADMIN')
  );
  const updated = await tools.oauthAppTool.execute(
    { action: 'update', description: 'Changed' },
    await connection(team, 'SUPERADMIN')
  );
  const rotated = await tools.oauthAppTool.execute(
    { action: 'rotateSecret' },
    await connection(team, 'SUPERADMIN')
  );

  expect(secret.startsWith('pcs_')).toBe(true);
  for (const leaked of [secret, storedBefore.clientSecret!]) {
    expect(JSON.stringify(read)).not.toContain(leaked);
    expect(JSON.stringify(updated)).not.toContain(leaked);
  }
  expect(JSON.stringify(created.output.app)).not.toContain('clientSecret');
  expect(rotated.output.clientSecret).not.toBe(secret);
  const stored = await prisma.oAuthApp.findFirstOrThrow({
    where: { organizationId: team, deletedAt: null },
  });
  expect(stored.clientSecret).toBe(
    AuthService.fixedEncryption(rotated.output.clientSecret)
  );
});

test('the approved apps of a user hide the tokens and only that user can revoke their approval', async () => {
  const team = await org('approved');
  const mine = await user('approved-mine');
  const theirs = await user('approved-theirs');
  await member(team, mine, 'USER');
  await member(team, theirs, 'USER');
  const myApproval = await approve(mine, team, 'approved-mine');
  const theirApproval = await approve(theirs, team, 'approved-theirs');
  const oauth = moduleRef.get(OAuthService);

  const list = await tools.approvedAppsTool.execute(
    { action: 'list' },
    await connection(team, 'USER', mine)
  );
  const revokeTheirs = await tools.approvedAppsTool.execute(
    { action: 'revoke', id: theirApproval.id },
    await connection(team, 'USER', mine)
  );
  const byApiKey = await tools.approvedAppsTool.execute(
    { action: 'revoke', id: myApproval.id },
    await connection(team, 'SUPERADMIN')
  );

  expect(list.output.apps.map((app: any) => app.id)).toEqual([myApproval.id]);
  expect(JSON.stringify(list)).not.toContain(
    AuthService.fixedEncryption(myApproval.token)
  );
  expect(JSON.stringify(list)).not.toContain(myApproval.token);
  expect(revokeTheirs.output).toHaveProperty('errors');
  expect(byApiKey.output).toHaveProperty('errors');
  expect(await oauth.resolveAccessToken(theirApproval.token)).not.toBeNull();
  expect(await oauth.resolveAccessToken(myApproval.token)).not.toBeNull();
  // the user revokes their own
  const revokeMine = await tools.approvedAppsTool.execute(
    { action: 'revoke', id: myApproval.id },
    await connection(team, 'USER', mine)
  );
  expect(revokeMine.output).toEqual({ revoked: { id: myApproval.id } });
  expect(await oauth.resolveAccessToken(myApproval.token)).toBeNull();
});

test('a USER member cannot rotate the API key, manage the OAuth app or set the short link preference', async () => {
  billingOn();
  const prisma = moduleRef.get(PrismaService);
  const team = await org('admin-policies', `before-${run}`);
  const regular = await user('admin-policies-regular');
  await member(team, regular, 'USER');
  const asUser = await connection(team, 'USER', regular);

  await expect(tools.apiKeyRotateTool.execute({}, asUser)).rejects.toThrow();
  await expect(
    tools.oauthAppTool.execute({ action: 'get' }, asUser)
  ).rejects.toThrow();
  await expect(
    tools.shortlinkPreferenceSetTool.execute({ shortlink: 'YES' }, asUser)
  ).rejects.toThrow();
  const after = await prisma.organization.findUniqueOrThrow({
    where: { id: team },
  });
  expect(after.apiKey).toBe(`before-${run}`);
  expect(after.shortlink).toBe('ASK');
  // reading the preference is open to every member, like on the web
  const read = await tools.shortlinkPreferenceGetTool.execute({}, asUser);
  expect(read.output).toEqual({ shortlink: 'ASK' });
});

test('rotating the API key returns the new key and the old one stops working', async () => {
  const team = await org('rotate-key', `rotate-${run}`);
  const organizations = moduleRef.get(OrganizationService);
  expect(await organizations.getOrgByApiKey(`rotate-${run}`)).not.toBeNull();

  const result = await tools.apiKeyRotateTool.execute(
    {},
    await connection(team, 'ADMIN')
  );

  const stored = await moduleRef
    .get(PrismaService)
    .organization.findUniqueOrThrow({ where: { id: team } });
  expect(result.output).toEqual({ apiKey: stored.apiKey });
  expect(stored.apiKey).not.toBe(`rotate-${run}`);
  expect(await organizations.getOrgByApiKey(`rotate-${run}`)).toBeNull();
});
