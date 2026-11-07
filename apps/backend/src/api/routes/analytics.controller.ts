import { Controller, Get, Param, Query } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ApiTags } from '@nestjs/swagger';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { AnalyticsReportService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.service';
import { AnalyticsHistoryService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.history.service';
import { AnalyticsHistoryDto } from '@gitroom/nestjs-libraries/dtos/analytics/analytics.history.dto';
import { AnalyticsInsightsDto } from '@gitroom/nestjs-libraries/dtos/analytics/analytics.insights.dto';
import { AnalyticsOverviewDto } from '@gitroom/nestjs-libraries/dtos/analytics/analytics.overview.dto';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

@ApiTags('Analytics')
@Controller('/analytics')
export class AnalyticsController {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _analyticsReportService: AnalyticsReportService,
    private _analyticsHistoryService: AnalyticsHistoryService
  ) {}

  @Get('/overview')
  getOverview(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsOverviewDto
  ) {
    return this._analyticsReportService.overview(org.id, query.date);
  }

  // Before '/:integration', which would take 'insights' for a channel id
  @Get('/insights')
  getInsights(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsInsightsDto
  ) {
    return this._analyticsHistoryService.postInsights(org.id, query);
  }

  @Get('/:integration')
  async getIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string
  ) {
    return this._integrationService.checkAnalytics(org, integration, date);
  }

  @Get('/:integration/history')
  getIntegrationHistory(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query() query: AnalyticsHistoryDto
  ) {
    return this._analyticsHistoryService.channelHistory(
      org.id,
      integration,
      query
    );
  }

  @Get('/post/:postId/history')
  getPostHistory(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string
  ) {
    return this._analyticsHistoryService.postHistory(org.id, postId);
  }

  @Get('/post/:postId')
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Query('date') date: string
  ) {
    return this._postsService.checkPostAnalytics(org.id, postId, +date);
  }
}
