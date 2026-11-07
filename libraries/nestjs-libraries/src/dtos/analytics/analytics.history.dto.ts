import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  analyticsGrains,
  AnalyticsGrain,
} from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';

export class AnalyticsHistoryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsIn(analyticsGrains)
  grain?: AnalyticsGrain;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (value ? value.split(',') : []))
  metrics?: string[];
}
