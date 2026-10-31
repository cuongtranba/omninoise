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
const stripeKey = process.env.STRIPE_PUBLISHABLE_KEY;
let moduleRef: Awaited<
  ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
>;
let orgId: string;

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
  orgId = (
    await moduleRef
      .get(PrismaService)
      .organization.create({ data: { name: `tools-${run}` } })
  ).id;
});

afterAll(async () => {
  if (stripeKey === undefined) {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  } else {
    process.env.STRIPE_PUBLISHABLE_KEY = stripeKey;
  }
  await moduleRef
    .get(PrismaService)
    .organization.delete({ where: { id: orgId } });
  await moduleRef.close();
});

test('the schedule tool refuses an organization that reached its posts per month', async () => {
  // billing on, and an organization without a subscription is on the FREE tier
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_policies';
  const { integrationSchedulePostTool } = await moduleRef
    .get(LoadToolsService)
    .loadTools();
  const requestContext = new RequestContext();
  requestContext.set(
    'organization',
    JSON.stringify({
      id: orgId,
      createdAt: new Date(),
      users: [{ role: 'SUPERADMIN' }],
    })
  );

  await expect(
    integrationSchedulePostTool.execute({ socialPost: [] }, { requestContext })
  ).rejects.toThrow(/maximum number of posts/);
});

test('the schedule tool runs when the organization is within its limits', async () => {
  // billing off: every plan limit is open
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  const { integrationSchedulePostTool } = await moduleRef
    .get(LoadToolsService)
    .loadTools();
  const requestContext = new RequestContext();
  requestContext.set(
    'organization',
    JSON.stringify({
      id: orgId,
      createdAt: new Date(),
      users: [{ role: 'SUPERADMIN' }],
    })
  );

  expect(
    await integrationSchedulePostTool.execute(
      { socialPost: [] },
      { requestContext }
    )
  ).toEqual({ output: [] });
});
