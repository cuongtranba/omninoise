import { Injectable } from '@nestjs/common';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';

@Injectable()
export class AnalyticsWebhookActivity {
  constructor(private _webhooksService: WebhooksService) {}

  async send(id: string) {
    return this._webhooksService.sendAnalyticsReport(id);
  }
}
