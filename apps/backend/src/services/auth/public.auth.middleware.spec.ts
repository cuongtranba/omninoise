import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { PermissionsService } from '@gitroom/nestjs-libraries/permissions/permissions.service';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { PublicAuthMiddleware } from '@gitroom/backend/services/auth/public.auth.middleware';

process.env.JWT_SECRET ||= 'public-auth-middleware-spec-secret';

const run = Math.random().toString(36).slice(2);
const stripeBefore = process.env.STRIPE_PUBLISHABLE_KEY;
const secretBefore = process.env.STRIPE_SECRET_KEY;
let moduleRef: Awaited<
  ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
>;
let orgId: string;
let appId: string;
const apiKey = `public-api-key-${run}`;

// the organization of the request after the middleware, and whether the admin
// section is granted to it by the guard (which reads org.users[0].role)
const authenticate = async (authorization: string) => {
  const req: any = { headers: { authorization } };
  const res: any = {
    status: () => res,
    json: () => res,
  };
  let passed = false;
  await new PublicAuthMiddleware(
    moduleRef.get(OrganizationService),
    moduleRef.get(OAuthService)
  ).use(req, res, () => {
    passed = true;
  });
  const ability = await moduleRef
    .get(PermissionsService)
    .check(req.org.id, req.org.createdAt, req.org.users[0].role, [
      [AuthorizationActions.Create, Sections.ADMIN],
    ]);
  return {
    passed,
    role: req.org.users[0].role,
    admin: ability.can(AuthorizationActions.Create, Sections.ADMIN),
  };
};

// an OAuth token approved by a member of the organization
const approve = async (role: 'USER' | 'ADMIN') => {
  const prisma = moduleRef.get(PrismaService);
  const user = await prisma.user.create({
    data: {
      email: `${role}-${run}@postiz.test`,
      providerName: 'LOCAL',
      timezone: 0,
    },
  });
  await prisma.userOrganization.create({
    data: { userId: user.id, organizationId: orgId, role },
  });
  const token = `pos_${role}_${run}`;
  await prisma.oAuthAuthorization.create({
    data: {
      oauthAppId: appId,
      userId: user.id,
      organizationId: orgId,
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
  moduleRef = await Test.createTestingModule({
    imports: [DatabaseModule, JobsModule],
  }).compile();
  const prisma = moduleRef.get(PrismaService);
  orgId = (
    await prisma.organization.create({
      data: { name: `public-auth-${run}`, apiKey },
    })
  ).id;
  appId = (
    await prisma.oAuthApp.create({
      data: {
        name: `public-auth-app-${run}`,
        redirectUrl: 'https://postiz.test/callback',
        clientId: `public-auth-${run}`,
        dynamic: true,
      },
    })
  ).id;
});

afterEach(() => {
  for (const [name, value] of [
    ['STRIPE_PUBLISHABLE_KEY', stripeBefore],
    ['STRIPE_SECRET_KEY', secretBefore],
  ] as const) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

afterAll(async () => {
  const prisma = moduleRef.get(PrismaService);
  await prisma.oAuthAuthorization.deleteMany({ where: { oauthAppId: appId } });
  await prisma.oAuthApp.delete({ where: { id: appId } });
  await prisma.userOrganization.deleteMany({
    where: { organizationId: orgId },
  });
  await prisma.user.deleteMany({
    where: { email: { endsWith: `-${run}@postiz.test` } },
  });
  await prisma.organization.delete({ where: { id: orgId } });
  await moduleRef.close();
});

test('the public API gives the guard the role of the caller: the owner for an API key, the real role for an OAuth token', async () => {
  // a self-hosted instance: the plan limits are open, the role is not
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  delete process.env.STRIPE_SECRET_KEY;

  const key = await authenticate(apiKey);
  const admin = await authenticate(await approve('ADMIN'));
  const regular = await authenticate(await approve('USER'));

  expect(key).toEqual({ passed: true, role: 'SUPERADMIN', admin: true });
  expect(admin).toEqual({ passed: true, role: 'ADMIN', admin: true });
  expect(regular).toEqual({ passed: true, role: 'USER', admin: false });
});
