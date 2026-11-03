import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import {
  AnalyticsPreviewDto,
  WebhooksDto,
} from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { JobQueueService } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { AnalyticsReportService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.service';

const DAY = 24 * 60 * 60 * 1000;
const analyticsIntervals: Record<string, number> = {
  daily: DAY,
  weekly: 7 * DAY,
  monthly: 30 * DAY,
};

export const analyticsWebhookRunAt = (schedule?: string | null) =>
  new Date(Date.now() + (analyticsIntervals[schedule || ''] ?? DAY));

@Injectable()
export class WebhooksService {
  constructor(
    private _webhooksRepository: WebhooksRepository,
    private _jobQueue: JobQueueService,
    private _analyticsReportService: AnalyticsReportService
  ) {}

  getTotal(orgId: string) {
    return this._webhooksRepository.getTotal(orgId);
  }

  getWebhooks(orgId: string) {
    return this._webhooksRepository.getWebhooks(orgId);
  }

  async createWebhook(orgId: string, body: WebhooksDto) {
    // an update only changes a webhook of this organization, it never saves a
    // new one for an id it does not know, which would skip the plan limit
    const existing = body.id
      ? (await this.getWebhooks(orgId)).find((w) => w.id === body.id)
      : undefined;
    if (body.id && !existing) {
      throw new NotFoundException('The webhook was not found');
    }

    // a webhook only listens to the channels of its own organization
    const ids = [...new Set(body.integrations.map((i) => i.id))];
    if (
      ids.length &&
      (await this._webhooksRepository.countIntegrations(orgId, ids)) !==
        ids.length
    ) {
      throw new BadRequestException('One of the channels was not found');
    }

    const webhook = await this._webhooksRepository.createWebhook(orgId, body);

    // fields left out of an update keep the saved ones
    await this.processCron(
      (body.type ?? existing?.type) === 'analytics.report',
      orgId,
      webhook.id,
      body.schedule ?? existing?.schedule
    );

    return webhook;
  }

  async deleteWebhook(orgId: string, id: string) {
    const data = await this._webhooksRepository.deleteWebhook(orgId, id);
    await this.processCron(false, orgId, id);
    return data;
  }

  // Starts (or restarts) the schedule of an analytics webhook, and stops it
  // for any other type
  async processCron(
    analytics: boolean,
    orgId: string,
    id: string,
    schedule?: string | null
  ) {
    if (analytics) {
      try {
        // 'replace': a new schedule restarts the cycle, the job reads the
        // webhook settings on every run
        return await this._jobQueue.enqueue(
          'analytics.webhook',
          { id, organizationId: orgId },
          {
            dedupeKey: `analytics.webhook:${id}`,
            mode: 'replace',
            organizationId: orgId,
            runAt: analyticsWebhookRunAt(schedule),
          }
        );
      } catch (err) {
        console.error('analytics webhook scheduling failed', err);
        return false;
      }
    }

    try {
      return await this._jobQueue.cancelByKey(`analytics.webhook:${id}`);
    } catch (err) {
      console.error('analytics webhook cancel failed', err);
      return false;
    }
  }

  // Builds and posts the report of an analytics webhook. Tells the job if the
  // webhook is still an analytics one, and when to run next.
  async sendAnalyticsReport(
    id: string
  ): Promise<{ active: boolean; schedule?: string }> {
    const webhook = await this._webhooksRepository.getWebhookById(id);
    if (!webhook || webhook.type !== 'analytics.report') {
      return { active: false };
    }

    // Best-effort: a failed delivery must not end the schedule.
    try {
      const report = await this._analyticsReportService.build(
        webhook.organizationId,
        {
          integrationIds: webhook.integrations.map((i) => i.integrationId),
          days: webhook.lookbackDays ?? 7,
          metrics: webhook.metrics,
          sections: webhook.sections.length
            ? (webhook.sections as ('channels' | 'summary' | 'topPosts')[])
            : undefined,
          topPostsLimit: webhook.topPostsLimit ?? 0,
        }
      );

      // webhook.url is validated at save time, but DNS can change between
      // then and now - pin resolution like every other user-influenced
      // outbound request.
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': 'analytics.report',
        },
        body: JSON.stringify({
          ...report,
          webhook: { id: webhook.id, name: webhook.name },
        }),
        signal: AbortSignal.timeout(30000),
        // @ts-ignore - undici-only option; blocks SSRF to internal IPs
        dispatcher: getSsrfSafeDispatcher(),
      });

      if (res.ok) {
        await this._webhooksRepository.setLastSent(webhook.id);
      } else {
        console.error('analytics webhook rejected', webhook.id, res.status);
      }
    } catch (err) {
      console.error('analytics webhook failed', (err as Error).message);
    }

    return { active: true, schedule: webhook.schedule ?? undefined };
  }

  preview(orgId: string, body: AnalyticsPreviewDto) {
    return this._analyticsReportService.build(orgId, {
      integrationIds: body.integrations?.map((i) => i.id),
      days: body.lookbackDays ?? 7,
      metrics: body.metrics,
      sections: body.sections,
      topPostsLimit: body.topPostsLimit,
    });
  }

  async sendWebhook(url: string, body: any) {
    try {
      await fetch(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        // @ts-ignore - undici-only option; blocks SSRF to internal IPs
        dispatcher: getSsrfSafeDispatcher(),
      });
    } catch (err) {
      /** sent **/
    }

    return { send: true };
  }
}
