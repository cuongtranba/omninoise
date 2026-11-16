import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import dayjs from 'dayjs';
import { Test } from '@nestjs/testing';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { AuthProviderManager } from '@gitroom/backend/services/auth/providers/providers.manager';

process.env.JWT_SECRET ||= 'auth-service-spec-secret';

const run = randomBytes(6).toString('hex');
const disableRegistrationBefore = process.env.DISABLE_REGISTRATION;
let moduleRef: Awaited<
  ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
>;
let orgId: string;

// the invite link token a team member gets from Settings > Teams
const inviteToken = (id: string) =>
  AuthChecker.signJWT({
    email: `invited-${run}@postiz.test`,
    role: 'USER',
    orgId,
    id,
    timeLimit: dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
  });

// the link token the operator of the instance creates to invite a new person
const platformInviteToken = (id: string) =>
  AuthChecker.signJWT({
    platform: true,
    email: `platform-invited-${run}@postiz.test`,
    id,
    timeLimit: dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
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
    imports: [DatabaseModule, JobsModule],
    providers: [AuthService, AuthProviderManager, EmailService],
  }).compile();
  orgId = (
    await moduleRef
      .get(PrismaService)
      .organization.create({ data: { name: `auth-service-${run}` } })
  ).id;
});

afterAll(async () => {
  if (disableRegistrationBefore === undefined) {
    delete process.env.DISABLE_REGISTRATION;
  } else {
    process.env.DISABLE_REGISTRATION = disableRegistrationBefore;
  }
  const prisma = moduleRef.get(PrismaService);
  await prisma.userOrganization.deleteMany({
    where: { organization: { name: { startsWith: `platform-signup-${run}` } } },
  });
  await prisma.userOrganization.deleteMany({
    where: { organizationId: orgId },
  });
  await prisma.user.deleteMany({
    where: { email: { endsWith: `-${run}@postiz.test` } },
  });
  await prisma.organization.deleteMany({
    where: { name: { startsWith: `platform-signup-${run}` } },
  });
  await prisma.organization.delete({ where: { id: orgId } });
  await moduleRef.close();
});

test('a team invite does not open registration while it is closed', async () => {
  process.env.DISABLE_REGISTRATION = 'true';
  const auth = moduleRef.get(AuthService);
  const token = inviteToken(`invite-${run}`);

  expect(await auth.canRegister('LOCAL', false)).toBe(false);
  expect(
    await auth.canRegister('LOCAL', auth.getPlatformInviteFromCookie(token))
  ).toBe(false);
  expect(auth.getOrgFromCookie(token)).toMatchObject({ orgId });
});

test('a platform invite lets its holder register while registration is closed, until a user has used it', async () => {
  process.env.DISABLE_REGISTRATION = 'true';
  const auth = moduleRef.get(AuthService);
  const platformInviteId = `platform-invite-${run}`;
  const invite = auth.getPlatformInviteFromCookie(
    platformInviteToken(platformInviteId)
  );

  expect(await auth.canRegister('LOCAL', invite)).toBe(true);

  await moduleRef.get(PrismaService).user.create({
    data: {
      email: `platform-member-${run}@postiz.test`,
      providerName: 'LOCAL',
      timezone: 0,
      platformInviteId,
    },
  });

  expect(await auth.canRegister('LOCAL', invite)).toBe(false);
});

test('a platform invite creates only one account, a second sign-up with it is refused', async () => {
  process.env.DISABLE_REGISTRATION = 'true';
  const auth = moduleRef.get(AuthService);
  const platformInviteId = `platform-once-${run}`;
  const invite = auth.getPlatformInviteFromCookie(
    platformInviteToken(platformInviteId)
  );
  const signUp = (name: string) =>
    auth.routeAuth(
      'LOCAL',
      Object.assign(new CreateOrgUserDto(), {
        company: `platform-signup-${run}-${name}`,
        email: `${name}-${run}@postiz.test`,
        password: 'password',
        provider: 'LOCAL',
      }),
      '127.0.0.1',
      'spec',
      false,
      invite
    );

  expect(typeof (await signUp('first-signup')).jwt).toBe('string');
  await expect(signUp('second-signup')).rejects.toThrow(
    'Registration is disabled'
  );
});

// Regression: the team invite stays in the "org" cookie for 2 days, and logging
// in with it used to try to add an existing member again and fail the login
test('a member who logs in with a team invite of their own organization still logs in', async () => {
  const auth = moduleRef.get(AuthService);
  const prisma = moduleRef.get(PrismaService);
  const email = `returning-member-${run}@postiz.test`;
  const member = await prisma.user.create({
    data: {
      email,
      password: AuthChecker.hashPassword('password'),
      providerName: 'LOCAL',
      timezone: 0,
    },
  });
  await prisma.userOrganization.create({
    data: { userId: member.id, organizationId: orgId, role: 'USER' },
  });

  const login = await auth.routeAuth(
    'LOCAL',
    {
      email,
      password: 'password',
      provider: 'LOCAL',
      providerToken: '',
      datafast_visitor_id: '',
    },
    '127.0.0.1',
    'spec',
    auth.getOrgFromCookie(inviteToken(`returning-${run}`))
  );

  expect(login.addedOrg).toBe(false);
  expect(typeof login.jwt).toBe('string');
});
