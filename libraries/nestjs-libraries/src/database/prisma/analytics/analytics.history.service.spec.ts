import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { execFileSync } from 'node:child_process';
import dayjs from 'dayjs';
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
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { JobQueueService } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { getPgPool } from '@gitroom/nestjs-libraries/pg/pg.pool';

const prisma = new PrismaService();
const repo = new PrismaRepository<keyof PrismaService>(prisma);
const queue = new JobQueueService();
const manager = new IntegrationManager();
const history = new AnalyticsHistoryRepository();
const service = new AnalyticsHistoryService(
  history,
  new IntegrationService(
    new IntegrationRepository(repo, repo, repo, repo, repo, repo),
    new AutopostRepository(repo),
    manager,
    new NotificationService(
      new NotificationsRepository(repo, repo),
      new EmailService(queue),
      new OrganizationRepository(repo, repo, repo),
      queue
    ),
    new RefreshIntegrationService(manager, undefined!, queue),
    queue
  ),
  manager
);

let orgId: string;
let integrationId: string;

const metric = (key: string, data: AnalyticsData['data']): AnalyticsData => ({
  key,
  label: key,
  percentageChange: 0,
  data,
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
  orgId = (
    await prisma.organization.create({ data: { name: 'analytics history' } })
  ).id;
  integrationId = (
    await prisma.integration.create({
      data: {
        organizationId: orgId,
        internalId: 'history-channel',
        name: 'history-channel',
        providerIdentifier: 'bluesky',
        type: 'social',
        token: 'token',
        tokenExpiration: dayjs().add(1, 'day').toDate(),
      },
    })
  ).id;
});

afterAll(async () => {
  await getPgPool().query(
    `DELETE FROM pgonly.channel_metrics WHERE integration_id = $1`,
    [integrationId]
  );
  await prisma.integration.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

test('weekly history adds up a flow metric and reads a stock or a running total at the end of the week', async () => {
  // Mondays: 2026-03-02 and 2026-03-09
  await history.saveMetrics(orgId, integrationId, 'day', [
    metric('impressions', [
      { total: '1', date: '2026-03-02' },
      { total: '2', date: '2026-03-04' },
      { total: '5', date: '2026-03-10' },
    ]),
    metric('followers', [
      { total: '100', date: '2026-03-02' },
      { total: '110', date: '2026-03-05' },
      { total: '120', date: '2026-03-10' },
    ]),
  ]);
  await history.saveMetrics(orgId, integrationId, 'total', [
    metric('likes', [
      { total: '50', date: '2026-03-03' },
      { total: '70', date: '2026-03-06' },
      { total: '90', date: '2026-03-10' },
    ]),
  ]);

  const result = await service.channelHistory(orgId, integrationId, {
    from: '2026-03-02',
    to: '2026-03-15',
    grain: 'week',
  });

  expect(
    result.map(({ key, kind, aggregate, total, data }) => ({
      key,
      kind,
      aggregate,
      total,
      data,
    }))
  ).toEqual([
    {
      key: 'followers',
      kind: 'day',
      aggregate: 'last',
      total: 120,
      data: [
        { date: '2026-03-02', total: '110' },
        { date: '2026-03-09', total: '120' },
      ],
    },
    {
      key: 'impressions',
      kind: 'day',
      aggregate: 'sum',
      total: 8,
      data: [
        { date: '2026-03-02', total: '3' },
        { date: '2026-03-09', total: '5' },
      ],
    },
    {
      key: 'likes',
      kind: 'total',
      aggregate: 'last',
      total: 90,
      data: [
        { date: '2026-03-02', total: '70' },
        { date: '2026-03-09', total: '90' },
      ],
    },
  ]);
});

test('the engagement rate of a week is its engagements over its impressions, not the average of daily rates', async () => {
  await history.saveMetrics(orgId, integrationId, 'day', [
    metric('engagements', [
      { total: '1', date: '2026-04-06' },
      { total: '9', date: '2026-04-07' },
    ]),
    metric('impressions', [
      { total: '10', date: '2026-04-06' },
      { total: '990', date: '2026-04-07' },
    ]),
    // A stored rate, and one Postiz derived for the window, are both ignored
    metric('engagement_rate', [{ total: '5', date: '2026-04-07' }]),
    {
      ...metric('engagement_rate', [{ total: '7', date: '2026-04-08' }]),
      derived: true,
    },
  ]);

  const result = await service.channelHistory(orgId, integrationId, {
    from: '2026-04-06',
    to: '2026-04-12',
    grain: 'week',
    metrics: ['engagements', 'impressions', 'engagement_rate'],
  });

  const rate = result.find((p) => p.key === 'engagement_rate');
  expect({ total: rate?.total, data: rate?.data }).toEqual({
    total: 1,
    data: [{ date: '2026-04-06', total: '1' }],
  });
});
