import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { execFileSync } from 'node:child_process';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Test } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import {
  PrismaRepository,
  PrismaService,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AnalyticsHistoryRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.history.repository';
import { AnalyticsHistoryService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.history.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { BlueskyProvider } from '@gitroom/nestjs-libraries/integrations/social/bluesky.provider';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { JobQueueService } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import { getPgPool } from '@gitroom/nestjs-libraries/pg/pg.pool';

dayjs.extend(utc);

// The totals the platform gives for any post
class FakeProvider extends BlueskyProvider {
  served: AnalyticsData[] = [];

  override async postAnalytics() {
    return this.served;
  }
}

const provider = new FakeProvider();

class FakeManager extends IntegrationManager {
  override getSocialIntegration() {
    return provider;
  }
}

// The channel is never refreshed here (its token is valid)
class NoRefresh extends RefreshIntegrationService {
  constructor(manager: IntegrationManager, queue: JobQueueService) {
    super(manager, undefined!, queue);
  }
}

const prisma = new PrismaService();
const repo = new PrismaRepository<keyof PrismaService>(prisma);
const queue = new JobQueueService();
const manager = new FakeManager();
const history = new AnalyticsHistoryRepository();
const notifications = new NotificationService(
  new NotificationsRepository(repo, repo),
  new EmailService(queue),
  new OrganizationRepository(repo, repo, repo),
  queue
);
const refresh = new NoRefresh(manager, queue);
const integrations = new IntegrationService(
  new IntegrationRepository(repo, repo, repo, repo, repo, repo),
  new AutopostRepository(repo),
  manager,
  notifications,
  refresh,
  queue
);

let service: AnalyticsHistoryService;
const orgIds: string[] = [];

const addOrganization = async () => {
  const id = (
    await prisma.organization.create({ data: { name: 'post insights' } })
  ).id;
  orgIds.push(id);
  return id;
};

const addChannel = async (
  organizationId: string,
  options: { disabled?: boolean } = {}
) =>
  (
    await prisma.integration.create({
      data: {
        organizationId,
        internalId: `channel-${Math.random()}`,
        name: 'channel',
        providerIdentifier: 'bluesky',
        type: 'social',
        token: 'token',
        tokenExpiration: dayjs().add(1, 'day').toDate(),
        disabled: options.disabled,
      },
    })
  ).id;

const addPost = async (
  organizationId: string,
  integrationId: string,
  publishDate: Date,
  extra: { content?: string; image?: string; releaseId?: string } = {}
) =>
  (
    await prisma.post.create({
      data: {
        organizationId,
        integrationId,
        publishDate,
        state: 'PUBLISHED',
        content: extra.content ?? 'hello',
        image: extra.image,
        group: `group-${Math.random()}`,
        releaseId: extra.releaseId ?? 'release',
        releaseURL: 'https://example.com/post',
      },
    })
  ).id;

// A post published `daysAgo` whole UTC days ago, mid-morning
const daysAgo = (days: number) =>
  dayjs.utc().startOf('day').subtract(days, 'day').add(10, 'hour').toDate();

const metric = (key: string, total: number): AnalyticsData => ({
  key,
  label: key,
  percentageChange: 0,
  data: [{ total: String(total), date: dayjs.utc().format('YYYY-MM-DD') }],
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

  const moduleRef = (await Test.createTestingModule({}).compile()).get(
    ModuleRef
  );
  const openai = new OpenaiService();
  const media = new MediaService(
    new MediaRepository(repo),
    openai,
    new SubscriptionService(
      new SubscriptionRepository(repo, repo, repo, repo, repo),
      integrations,
      new OrganizationService(
        new OrganizationRepository(repo, repo, repo),
        notifications
      )
    ),
    new VideoManager(moduleRef),
    queue
  );
  service = new AnalyticsHistoryService(
    history,
    integrations,
    manager,
    new PostsService(
      new PostsRepository(repo, repo, repo, repo, repo, repo),
      manager,
      integrations,
      media,
      new ShortLinkService(),
      openai,
      queue,
      refresh
    )
  );
});

afterAll(async () => {
  await getPgPool().query(
    `DELETE FROM pgonly.post_metrics WHERE organization_id = ANY($1::text[])`,
    [orgIds]
  );
  await prisma.post.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.integration.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

test('insights group the posts read at an age by weekday and hour in the asked timezone, and never include another organization', async () => {
  const orgId = await addOrganization();
  const other = await addOrganization();
  const channel = await addChannel(orgId);
  const otherChannel = await addChannel(other);

  // Mondays 20:00 and 20:30 UTC are Tuesdays 03:00 and 03:30 in Ho Chi Minh City
  const first = await addPost(orgId, channel, new Date('2026-03-02T20:00:00Z'));
  const second = await addPost(
    orgId,
    channel,
    new Date('2026-03-09T20:30:00Z')
  );
  // Wednesday 19:00 in Ho Chi Minh City, a video
  const video = await addPost(
    orgId,
    channel,
    new Date('2026-03-04T12:00:00Z'),
    {
      image: JSON.stringify([
        { id: '1', path: 'https://cdn.example.com/a.mp4' },
      ]),
    }
  );
  // Never read at that age
  await addPost(orgId, channel, new Date('2026-03-05T12:00:00Z'));
  const foreign = await addPost(
    other,
    otherChannel,
    new Date('2026-03-02T20:00:00Z')
  );

  const read = (
    organizationId: string,
    integrationId: string,
    postId: string,
    engagements: number,
    age = 7
  ) =>
    history.savePostMetrics(
      organizationId,
      integrationId,
      postId,
      age,
      '2026-03-20',
      [metric('engagements', engagements)]
    );
  await read(orgId, channel, first, 10);
  await read(orgId, channel, second, 30);
  await read(orgId, channel, video, 100);
  await read(orgId, channel, video, 5000, 14);
  await read(other, otherChannel, foreign, 9999);

  const insights = await service.postInsights(orgId, {
    from: '2026-03-01',
    to: '2026-03-31',
    timezone: 'Asia/Ho_Chi_Minh',
  });

  expect(insights.posts).toBe(3);
  expect(insights.median).toBe(30);
  expect(insights.byWeekdayHour).toEqual([
    { weekday: 2, hour: 3, posts: 2, median: 20 },
  ]);
  expect(insights.byWeekday).toEqual([
    { weekday: 2, posts: 2, median: 20 },
    { weekday: 3, posts: 1, median: 100 },
  ]);
  expect(insights.byFormat).toEqual(
    expect.arrayContaining([
      { format: 'video', posts: 1, median: 100 },
      { format: 'text', posts: 2, median: 20 },
    ])
  );
  expect(insights.top.map((p) => p.id)).toEqual([video, second, first]);
  expect(insights.bottom).toEqual([]);

  const foreignInsights = await service.postInsights(other, {
    from: '2026-03-01',
    to: '2026-03-31',
  });
  expect(foreignInsights.top.map((p) => p.id)).toEqual([foreign]);
});

test('the sweep picks only the published posts whose age today is one of the ages', async () => {
  const orgId = await addOrganization();
  const channel = await addChannel(orgId);
  const disabled = await addChannel(orgId, { disabled: true });

  const due = [
    await addPost(orgId, channel, daysAgo(1)),
    await addPost(orgId, channel, daysAgo(7)),
    await addPost(orgId, channel, daysAgo(90)),
  ];
  await addPost(orgId, channel, daysAgo(2));
  await addPost(orgId, channel, daysAgo(0));
  await addPost(orgId, channel, daysAgo(7), { releaseId: 'missing' });
  await addPost(orgId, disabled, daysAgo(7));

  const posts = (await service.collectablePosts()).filter(
    (p) => p.organizationId === orgId
  );

  expect(posts.map((p) => [p.id, p.age]).sort()).toEqual(
    [
      [due[0], 1],
      [due[1], 7],
      [due[2], 90],
    ].sort()
  );
});

test('the sweep reads at most the configured number of posts of an organization, the younger ones first', async () => {
  const orgId = await addOrganization();
  const channel = await addChannel(orgId);
  const old = await addPost(orgId, channel, daysAgo(30));
  const young = await addPost(orgId, channel, daysAgo(1));
  const middle = await addPost(orgId, channel, daysAgo(7));

  process.env.ANALYTICS_POST_SNAPSHOTS_PER_DAY = '2';
  try {
    const posts = (await service.collectablePosts()).filter(
      (p) => p.organizationId === orgId
    );

    expect(posts.map((p) => p.id)).toEqual([young, middle]);
    expect(posts.map((p) => p.id)).not.toContain(old);
  } finally {
    delete process.env.ANALYTICS_POST_SNAPSHOTS_PER_DAY;
  }
});

test('reading a post stores its totals under the age it has today, and the switch turns the sweep off', async () => {
  const orgId = await addOrganization();
  const channel = await addChannel(orgId);
  const postId = await addPost(orgId, channel, daysAgo(3));
  provider.served = [metric('likes', 4), metric('comments', 1)];

  const read = await service.collectPost({ organizationId: orgId, postId });

  expect(read).toEqual({ age: 3, stored: 2 });
  expect(
    (await service.postHistory(orgId, postId)).map((p) => [
      p.key,
      p.data.map((point) => [point.age, point.total]),
    ])
  ).toEqual([
    ['likes', [[3, '4']]],
    ['comments', [[3, '1']]],
  ]);

  process.env.ANALYTICS_POST_SNAPSHOTS = 'false';
  try {
    expect(await service.collectablePosts()).toEqual([]);
  } finally {
    delete process.env.ANALYTICS_POST_SNAPSHOTS;
  }
});
