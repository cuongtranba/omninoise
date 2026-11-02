import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  PrismaRepository,
  PrismaService,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

process.env.JWT_SECRET ||= 'oauth-service-spec-secret';

const prisma = new PrismaService();
const repo = new PrismaRepository<keyof PrismaService>(prisma);
const oauth = new OAuthService(new OAuthRepository(repo, repo, repo, repo));

const run = Math.random().toString(36).slice(2);
let orgId: string;
let appId: string;

// A user who approved the app for the organization; returns the access token
const approve = async (
  name: string,
  membership: { role: 'USER' | 'ADMIN'; disabled?: boolean } | null,
  organizationId = orgId
) => {
  const user = await prisma.user.create({
    data: {
      email: `${name}-${run}@example.com`,
      providerName: 'LOCAL',
      timezone: 0,
    },
  });
  if (membership) {
    await prisma.userOrganization.create({
      data: { userId: user.id, organizationId, ...membership },
    });
  }
  const token = `pos_${name}_${run}`;
  await prisma.oAuthAuthorization.create({
    data: {
      oauthAppId: appId,
      userId: user.id,
      organizationId,
      accessToken: AuthService.fixedEncryption(token),
    },
  });
  return token;
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
  orgId = (await prisma.organization.create({ data: { name: `org-${run}` } }))
    .id;
  appId = (
    await prisma.oAuthApp.create({
      data: {
        name: `app-${run}`,
        redirectUrl: 'https://example.com/callback',
        clientId: `client-${run}`,
      },
    })
  ).id;
});

afterAll(async () => {
  const where = { organizationId: { in: [orgId] } };
  await prisma.oAuthAuthorization.deleteMany({ where });
  await prisma.userOrganization.deleteMany({ where });
  await prisma.oAuthApp.delete({ where: { id: appId } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@example.com` } } });
  await prisma.organization.deleteMany({ where: { name: { endsWith: run } } });
  await prisma.$disconnect();
});

test('accepts the token of an active member and returns their role', async () => {
  const token = await approve('member', { role: 'ADMIN' });

  const authorization = await oauth.resolveAccessToken(token);

  expect(authorization?.organization.id).toBe(orgId);
  expect(authorization?.role).toBe('ADMIN');
});

test('rejects the token of a user who was removed from the organization', async () => {
  const token = await approve('removed', null);

  expect(await oauth.resolveAccessToken(token)).toBeNull();
});

test('rejects the token of a member whose access was disabled', async () => {
  const token = await approve('disabled', { role: 'USER', disabled: true });

  expect(await oauth.resolveAccessToken(token)).toBeNull();
});

test('rejects the token of a deleted organization', async () => {
  const deleted = await prisma.organization.create({
    data: { name: `deleted-${run}`, deletedAt: new Date() },
  });
  const token = await approve('deleted-org', { role: 'USER' }, deleted.id);

  expect(await oauth.resolveAccessToken(token)).toBeNull();

  await prisma.oAuthAuthorization.deleteMany({
    where: { organizationId: deleted.id },
  });
  await prisma.userOrganization.deleteMany({
    where: { organizationId: deleted.id },
  });
});
