import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  PrismaRepository,
  PrismaService,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';

const prisma = new PrismaService();
const repo = new PrismaRepository<keyof PrismaService>(prisma);
const posts = new PostsRepository(repo, repo, repo, repo, repo, repo);

// What post.jobs.ts persists: NonRetryable.toJSON().
const stored = (type: string, message: string) =>
  JSON.stringify({
    name: 'NonRetryable',
    message,
    type,
    details: [{ identifier: 'threads', json: '{}', body: 'raw provider body' }],
  });

const window = {
  startDate: '2030-01-01T00:00:00.000Z',
  endDate: '2030-01-02T00:00:00.000Z',
  customer: '',
};
let orgId: string;

const addErrorPost = async (integrationId: string, error: string) =>
  (
    await prisma.post.create({
      data: {
        organizationId: orgId,
        integrationId,
        state: 'ERROR',
        publishDate: new Date('2030-01-01T12:00:00.000Z'),
        content: '<p>hello</p>',
        group: `group-${Math.random()}`,
        error,
      },
    })
  ).id;

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
  orgId = (await prisma.organization.create({ data: { name: 'curated' } })).id;
});

afterAll(async () => {
  await prisma.post.deleteMany({ where: { organizationId: orgId } });
  await prisma.integration.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

test('refresh_token failures surface their message instead of null', async () => {
  const integration = await prisma.integration.create({
    data: {
      organizationId: orgId,
      internalId: 'threads-1',
      name: 'Threads',
      providerIdentifier: 'threads',
      type: 'social',
      token: 'x',
    },
  });
  const refreshId = await addErrorPost(
    integration.id,
    stored('refresh_token', 'Threads access token expired')
  );
  const unmappedId = await addErrorPost(
    integration.id,
    stored('bad_body', 'Unknown Error')
  );

  const errors = Object.fromEntries(
    (await posts.getPosts(orgId, window)).map((p) => [p.id, p.error])
  );

  expect(errors[refreshId]).toBe('Threads access token expired');
  expect(errors[unmappedId]).toBeNull();
});
