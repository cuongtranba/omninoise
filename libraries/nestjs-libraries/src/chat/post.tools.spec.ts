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
const orgIds: string[] = [];
const userIds: string[] = [];

const org = async (name: string) => {
  const created = await moduleRef
    .get(PrismaService)
    .organization.create({ data: { name: `${name}-${run}` } });
  orgIds.push(created.id);
  return created.id;
};

// what an API key connection carries: no user, only the role
const connection = (id: string, userId?: string) => {
  const requestContext = new RequestContext();
  requestContext.set(
    'organization',
    JSON.stringify({
      id,
      createdAt: new Date(),
      users: [{ role: 'SUPERADMIN', userId }],
    })
  );
  return { requestContext };
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
});

afterAll(async () => {
  const prisma = moduleRef.get(PrismaService);
  await prisma.comments.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await prisma.post.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.integration.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tags.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await moduleRef.close();
});

test('a tag of another organization cannot be renamed through the tags tool', async () => {
  const owner = await org('tags-owner');
  const stranger = await org('tags-stranger');

  const created = await tools.postTagsTool.execute(
    { action: 'create', name: 'launch', color: '#FF5733' },
    connection(owner)
  );
  const tagId = created.output.tag.id;

  const renamed = await tools.postTagsTool.execute(
    { action: 'update', id: tagId, name: 'hijacked', color: '#000000' },
    connection(stranger)
  );
  expect(renamed.output).toHaveProperty('errors');

  const listed = await tools.postTagsTool.execute(
    { action: 'list' },
    connection(owner)
  );
  expect(listed.output.tags).toEqual([
    { id: tagId, name: 'launch', color: '#FF5733' },
  ]);
});

test('a review comment needs the user of an OAuth connection, an API key has none', async () => {
  const owner = await org('comments');

  const result = await tools.postCommentsTool.execute(
    { action: 'add', id: 'any-post', content: 'Looks good' },
    connection(owner)
  );

  expect(result.output.errors).toMatch(/connect through OAuth/);
});

// regression: a past week made the draft generator recurse until the stack overflowed
test('drafts for a week that is already over are refused', async () => {
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  const owner = await org('drafts');

  const result = await tools.postGeneratorDraftTool.execute(
    {
      posts: [{ list: [{ post: 'Hello' }] }],
      week: 10,
      year: 2020,
      url: 'https://example.com/article',
    },
    connection(owner)
  );

  expect(result.output.errors).toMatch(/already over/);
});

test('a post of another organization cannot be commented through the comments tool', async () => {
  const prisma = moduleRef.get(PrismaService);
  const owner = await org('comments-owner');
  const stranger = await org('comments-stranger');
  const user = await prisma.user.create({
    data: {
      email: `commenter-${run}@example.com`,
      providerName: 'LOCAL',
      timezone: 0,
    },
  });
  userIds.push(user.id);
  const integration = await prisma.integration.create({
    data: {
      internalId: `internal-${run}`,
      organizationId: owner,
      name: 'Channel',
      providerIdentifier: 'x',
      type: 'social',
      token: 'token',
    },
  });
  const post = await prisma.post.create({
    data: {
      organizationId: owner,
      integrationId: integration.id,
      publishDate: new Date(),
      content: 'Private draft',
      group: `group-${run}`,
    },
  });

  const result = await tools.postCommentsTool.execute(
    { action: 'add', id: post.id, content: 'Let me in' },
    connection(stranger, user.id)
  );

  expect(result.output).toHaveProperty('errors');
  expect(await prisma.comments.count({ where: { postId: post.id } })).toBe(0);
});
