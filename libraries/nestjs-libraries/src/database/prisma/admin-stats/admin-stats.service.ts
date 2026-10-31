import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import {
  AdminStatsRepository,
  OrgActivityParams,
  StatsParams,
} from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.repository';

@Injectable()
export class AdminStatsService {
  constructor(private _adminStatsRepository: AdminStatsRepository) {}

  getStats(params: StatsParams) {
    return this._adminStatsRepository.getStats(params);
  }

  // The last 30 days unless a range is given, whole days
  getStatsByRange(range: {
    from?: string;
    to?: string;
    unknownOnly?: boolean;
  }) {
    const fromDate = range.from
      ? dayjs(range.from)
      : dayjs().subtract(30, 'day');
    const toDate = range.to ? dayjs(range.to) : dayjs();

    return this.getStats({
      from: fromDate.startOf('day').toDate(),
      to: toDate.endOf('day').toDate(),
      unknownOnly: !!range.unknownOnly,
    });
  }

  getOrgActivity(params: OrgActivityParams) {
    return this._adminStatsRepository.getOrgActivity(params);
  }
}
