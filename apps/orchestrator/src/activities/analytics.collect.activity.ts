import { Injectable } from '@nestjs/common';
import { AnalyticsHistoryService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.history.service';

@Injectable()
export class AnalyticsCollectActivity {
  constructor(private _analyticsHistory: AnalyticsHistoryService) {}

  listChannels() {
    return this._analyticsHistory.collectableChannels();
  }

  collectChannel(params: { organizationId: string; integrationId: string }) {
    return this._analyticsHistory.collectChannel(params);
  }

  listPosts() {
    return this._analyticsHistory.collectablePosts();
  }

  collectPost(params: { organizationId: string; postId: string }) {
    return this._analyticsHistory.collectPost(params);
  }
}
