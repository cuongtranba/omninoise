import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';

process.env.JWT_SECRET ||= 'auth-middleware-spec-secret';

const run = randomBytes(6).toString('hex');
let moduleRef: Awaited<
  ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
>;
const orgIds: string[] = [];

// a user who owns an organization of their own
const member = async (name: string, isSuperAdmin = false) => {
  const prisma = moduleRef.get(PrismaService);
  const user = await prisma.user.create({
    data: {
      email: `${name}-${run}@postiz.test`,
      providerName: 'LOCAL',
      timezone: 0,
      isSuperAdmin,
    },
  });
  const org = await prisma.organization.create({
    data: {
      name: `${name}-org-${run}`,
      apiKey: `auth-middleware-${name}-${run}`,
      users: { create: { userId: user.id, role: 'SUPERADMIN' } },
    },
  });
  orgIds.push(org.id);
  return { userId: user.id, orgId: org.id };
};

// the organization the web request runs in, with the showorg cookie set
const signIn = async (userId: string, showorg: string) => {
  const req: any = {
    headers: { auth: AuthService.signJWT({ id: userId }) },
    cookies: { showorg },
  };
  await new AuthMiddleware(
    moduleRef.get(OrganizationService),
    moduleRef.get(UsersService)
  ).use(req, {} as any, () => {});
  return req.org;
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
});

afterAll(async () => {
  const prisma = moduleRef.get(PrismaService);
  await prisma.userOrganization.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({
    where: { email: { endsWith: `-${run}@postiz.test` } },
  });
  await moduleRef.close();
});

test('the super admin of the instance enters an organization they are not a member of as its owner', async () => {
  const operator = await member('operator', true);
  const customer = await member('customer');

  const org = await signIn(operator.userId, customer.orgId);

  expect(org.id).toBe(customer.orgId);
  expect(org.users).toEqual([
    { role: 'SUPERADMIN', disabled: false, adminAccess: true },
  ]);
});

test('a regular user naming an organization they are not a member of stays in their own', async () => {
  const regular = await member('regular');
  const customer = await member('other-customer');

  const org = await signIn(regular.userId, customer.orgId);

  expect(org.id).toBe(regular.orgId);
});

test('a blocked account is refused even in its own organization', async () => {
  const blocked = await member('blocked');
  await moduleRef.get(PrismaService).user.update({
    where: { id: blocked.userId },
    data: { disabledAt: new Date() },
  });

  const refused = await signIn(blocked.userId, blocked.orgId).catch(
    (err: unknown) => err
  );

  if (!(refused instanceof HttpException)) throw refused;
  expect(refused.getStatus()).toBe(403);
});
