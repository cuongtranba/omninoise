import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsTimeZone,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { analyticsPostAges } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';

export class AnalyticsInsightsDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (value ? value.split(',') : []))
  integrations?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsIn(analyticsPostAges)
  age?: number;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}
