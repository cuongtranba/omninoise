import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksDto } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

@Injectable()
export class WebhooksService {
  constructor(private _webhooksRepository: WebhooksRepository) {}

  getTotal(orgId: string) {
    return this._webhooksRepository.getTotal(orgId);
  }

  getWebhooks(orgId: string) {
    return this._webhooksRepository.getWebhooks(orgId);
  }

  async createWebhook(orgId: string, body: WebhooksDto) {
    // an update only changes a webhook of this organization, it never saves a
    // new one for an id it does not know, which would skip the plan limit
    if (
      body.id &&
      !(await this.getWebhooks(orgId)).some((w) => w.id === body.id)
    ) {
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

    return this._webhooksRepository.createWebhook(orgId, body);
  }

  deleteWebhook(orgId: string, id: string) {
    return this._webhooksRepository.deleteWebhook(orgId, id);
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
