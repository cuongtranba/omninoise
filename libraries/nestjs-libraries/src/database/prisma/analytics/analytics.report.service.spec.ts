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
import { AnalyticsReportService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.service';
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

dayjs.extend(utc);

// What a channel serves: the current window, and the one the provider
// returns when it is asked for the window before it (offset > 0)
type Served = { current: AnalyticsData[]; previous: AnalyticsData[] };

class FakeProvider extends BlueskyProvider {
  override analyticsPreviousPeriod = true;
  served: Record<string, Served> = {};

  override async analytics(
    id: string,
    accessToken: string,
    days: number,
    offset?: number
  ) {
    const served = this.served[id];
    return offset ? served.previous : served.current;
  }
}

const provider = new FakeProvider();

class FakeManager extends IntegrationManager {
  override getSocialIntegration() {
    return provider;
  }
}

// The channel is never refreshed here (its token is valid), and the refresh
// service and the integration service need each other, so it gets no service
class NoRefresh extends RefreshIntegrationService {
  constructor(manager: IntegrationManager, queue: JobQueueService) {
    super(manager, undefined!, queue);
  }
}

const prisma = new PrismaService();
const repo = new PrismaRepository<keyof PrismaService>(prisma);
const queue = new JobQueueService();
const manager = new FakeManager();
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

const days = 7;
let orgId: string;
let report: AnalyticsReportService;

// A daily point `daysAgo` days before today
const point = (daysAgo: number, total: number) => ({
  total: String(total),
  date: dayjs.utc().subtract(daysAgo, 'day').format('YYYY-MM-DD'),
});

const metric = (key: string, data: AnalyticsData['data']): AnalyticsData => ({
  key,
  label: key,
  percentageChange: 0,
  data,
});

const addChannel = async (internalId: string, served: Served) => {
  provider.served[internalId] = served;
  return (
    await prisma.integration.create({
      data: {
        organizationId: orgId,
        internalId,
        name: internalId,
        providerIdentifier: 'bluesky',
        type: 'social',
        token: 'token',
        tokenExpiration: dayjs().add(1, 'day').toDate(),
      },
    })
  ).id;
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
  orgId = (await prisma.organization.create({ data: { name: 'analytics' } }))
    .id;

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
  const posts = new PostsService(
    new PostsRepository(repo, repo, repo, repo, repo, repo),
    manager,
    integrations,
    media,
    new ShortLinkService(),
    openai,
    queue,
    refresh
  );
  report = new AnalyticsReportService(
    integrations,
    manager,
    posts,
    new AnalyticsHistoryService(
      new AnalyticsHistoryRepository(),
      integrations,
      manager,
      posts
    )
  );
});

afterAll(async () => {
  await prisma.integration.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

test('compares with the previous window only when it ends before the current one starts', async () => {
  const current = [
    metric(
      'impressions',
      [0, 1, 2, 3, 4, 5, 6].map((d) => point(d, 20))
    ),
  ];
  const olderWindow = [
    metric(
      'impressions',
      [10, 10, 10, 10, 20, 20, 20].map((total, i) => point(8 + i, total))
    ),
  ];
  // A provider that ignores the offset serves points of the current window again
  const sameWindow = [
    metric(
      'impressions',
      [0, 1, 2, 3, 4, 5, 6].map((d) => point(d, 10))
    ),
  ];

  const honest = await addChannel('honest', {
    current,
    previous: olderWindow,
  });
  const ignoresOffset = await addChannel('ignores-offset', {
    current,
    previous: sameWindow,
  });

  const [honestMetric] = await integrations.checkAnalytics(
    { id: orgId },
    honest,
    String(days)
  );
  const [ignoringMetric] = await integrations.checkAnalytics(
    { id: orgId },
    ignoresOffset,
    String(days)
  );

  expect([honestMetric.percentageChange, honestMetric.previousTotal]).toEqual([
    40, 100,
  ]);
  expect([
    ignoringMetric.percentageChange,
    ignoringMetric.previousTotal,
  ]).toEqual([0, undefined]);
});

test('a followers metric totals to its latest point instead of the sum', async () => {
  const id = await addChannel('followers', {
    current: [
      metric('followers', [point(2, 100), point(0, 150), point(1, 120)]),
    ],
    previous: [],
  });

  const built = await report.build(orgId, {
    days,
    integrationIds: [id],
    metrics: ['followers'],
    sections: ['channels'],
  });

  expect(built.channels?.[0].metrics.map((m) => [m.key, m.total])).toEqual([
    ['followers', 150],
  ]);
});

test('a report keeps only the requested sections and metrics', async () => {
  const id = await addChannel('filtered', {
    current: [
      metric('impressions', [point(1, 200), point(0, 100)]),
      metric('likes', [point(1, 10), point(0, 5)]),
      metric('engagements', [point(1, 30), point(0, 15)]),
    ],
    previous: [],
  });

  const built = await report.build(orgId, {
    days,
    integrationIds: [id],
    metrics: ['impressions'],
    sections: ['summary', 'channels'],
    topPostsLimit: 5,
  });

  expect(Object.keys(built.summary?.metrics ?? {})).toEqual(['impressions']);
  expect(built.channels?.map((c) => c.metrics.map((m) => m.key))).toEqual([
    ['impressions'],
  ]);
  expect('topPosts' in built).toBe(false);
});
