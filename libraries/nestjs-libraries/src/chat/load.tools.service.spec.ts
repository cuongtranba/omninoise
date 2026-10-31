import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { RequestContext } from '@mastra/core/di';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { ChatModule } from '@gitroom/nestjs-libraries/chat/chat.module';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

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
  const prisma = moduleRef.get(PrismaService);
  await prisma.post.deleteMany({ where: { organizationId: orgId } });
  await prisma.integration.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
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

test('a post created by the schedule tool is stored like one created from the dashboard', async () => {
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  const prisma = moduleRef.get(PrismaService);
  const integration = await prisma.integration.create({
    data: {
      organizationId: orgId,
      internalId: `mastodon-${run}`,
      name: 'Mastodon',
      providerIdentifier: 'mastodon',
      type: 'social',
      token: 'x',
    },
  });
  const date = '2030-01-01T12:00:00.000Z';
  const image = { path: 'https://uploads.gitroom.com/photo.png' };

  // the body the dashboard sends to POST /posts
  const webResult = await moduleRef.get(PostsService).validateAndCreatePosts(
    orgId,
    {
      type: 'schedule',
      shortLink: false,
      date,
      tags: [],
      posts: [
        {
          integration: { id: integration.id },
          group: 'web-group',
          settings: {},
          value: [
            {
              id: 'web-1',
              content: '<p>hello</p>',
              delay: 0,
              image: [{ id: 'web-image', ...image }],
            },
          ],
        },
      ],
    },
    'WEB'
  );

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
  const mcpResult = await integrationSchedulePostTool.execute(
    {
      socialPost: [
        {
          integrationId: integration.id,
          isPremium: false,
          date,
          shortLink: false,
          type: 'schedule',
          settings: [],
          postsAndComments: [
            { content: '<p>hello</p>', attachments: [image.path] },
          ],
        },
      ],
    },
    { requestContext }
  );

  // media ids are generated per request
  const stored = async (id: string) => {
    const post = await prisma.post.findUniqueOrThrow({
      where: { id },
      select: {
        content: true,
        image: true,
        settings: true,
        state: true,
        delay: true,
        publishDate: true,
        integrationId: true,
        creationMethod: true,
      },
    });
    return {
      ...post,
      image: JSON.parse(post.image!).map((i: { path: string }) => i.path),
    };
  };
  const web = await stored(webResult[0].postId);
  const mcp = await stored((mcpResult as any).output[0].postId);

  expect(JSON.parse(mcp.settings!).__type).toBe('mastodon');
  expect(mcp).toEqual({ ...web, creationMethod: 'MCP' });
});

test('the schedule tool creates nothing when one of its posts is invalid', async () => {
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  const prisma = moduleRef.get(PrismaService);
  const integration = await prisma.integration.create({
    data: {
      organizationId: orgId,
      internalId: `mastodon-batch-${run}`,
      name: 'Mastodon',
      providerIdentifier: 'mastodon',
      type: 'social',
      token: 'x',
    },
  });
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
  const socialPost = (content: string) => ({
    integrationId: integration.id,
    isPremium: false,
    date: '2030-01-02T12:00:00.000Z',
    shortLink: false,
    type: 'schedule',
    settings: [],
    postsAndComments: [{ content, attachments: [] }],
  });

  const result = await integrationSchedulePostTool.execute(
    { socialPost: [socialPost('<p>valid</p>'), socialPost('')] },
    { requestContext }
  );

  expect(result).toEqual({
    output: {
      errors: expect.stringContaining('at least one character or one image'),
    },
  });
  expect(
    await prisma.post.count({ where: { integrationId: integration.id } })
  ).toBe(0);
});
