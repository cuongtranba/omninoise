import { IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class AnalyticsOverviewDto {
  @Type(() => Number)
  @IsIn([7, 30, 90, 180, 365])
  date: number;
}
