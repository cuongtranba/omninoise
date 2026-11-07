import { Injectable } from '@nestjs/common';
import { AnalyticsHistoryRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.history.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';

// The window read when the platform does not list its windows. Every
// collection re-reads a whole window: platforms revise the latest days.
const REFRESH_DAYS = 7;

@Injectable()
export class AnalyticsHistoryService {
  constructor(
    private _analyticsHistoryRepository: AnalyticsHistoryRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager
  ) {}

  // The channels whose platform serves analytics
  async collectableChannels() {
    return (await this._integrationService.getAnalyticsChannels()).filter(
      (p) =>
        this._integrationManager.getSocialIntegration(p.providerIdentifier)
          ?.analytics
    );
  }

  // Reads the channel's analytics and stores them by day. The first time the
  // largest window of the platform is read, to backfill what it still serves.
  async collectChannel(params: {
    organizationId: string;
    integrationId: string;
  }) {
    const { organizationId, integrationId } = params;
    const integration = await this._integrationService.getIntegrationById(
      organizationId,
      integrationId
    );
    const provider =
      integration &&
      this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      );
    // The first time, the largest window the platform serves backfills what
    // it still has; afterwards its smallest window refreshes the latest days
    const served = provider?.analyticsDays?.length
      ? provider.analyticsDays
      : [REFRESH_DAYS];
    const first =
      !(await this._analyticsHistoryRepository.hasMetrics(integrationId));
    const days = first ? Math.max(...served) : Math.min(...served);

    const data = await this._integrationService.checkAnalytics(
      { id: organizationId },
      integrationId,
      String(days)
    );
    return {
      days,
      stored: await this._analyticsHistoryRepository.saveMetrics(
        organizationId,
        integrationId,
        // A platform that only serves current totals gives running totals
        provider?.analyticsSnapshot ? 'total' : 'day',
        data
      ),
    };
  }
}
