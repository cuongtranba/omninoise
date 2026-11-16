import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import dayjs from 'dayjs';
import { Test } from '@nestjs/testing';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
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
  await prisma.user.deleteMany({
    where: { email: { endsWith: `-${run}@postiz.test` } },
  });
  await prisma.organization.delete({ where: { id: orgId } });
  await moduleRef.close();
});

test('a valid invite lets its holder register while registration is closed, until a user has used it', async () => {
  process.env.DISABLE_REGISTRATION = 'true';
  const auth = moduleRef.get(AuthService);
  const inviteId = `invite-${run}`;
  const invite = auth.getOrgFromCookie(inviteToken(inviteId));

  expect(await auth.canRegister('LOCAL', false)).toBe(false);
  expect(await auth.canRegister('LOCAL', invite)).toBe(true);

  await moduleRef.get(PrismaService).user.create({
    data: {
      email: `member-${run}@postiz.test`,
      providerName: 'LOCAL',
      timezone: 0,
      inviteId,
    },
  });

  expect(await auth.canRegister('LOCAL', invite)).toBe(false);
});
