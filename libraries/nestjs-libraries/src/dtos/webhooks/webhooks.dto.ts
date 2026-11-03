import {
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { analyticsMetricKeys } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import { IsSafeWebhookUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

export class WebhooksIntegrationDto {
  @IsString()
  @IsDefined()
  id: string;
}

export class WebhooksDto {
  id: string;

  @IsString()
  @IsDefined()
  name: string;

  @IsString()
  @IsUrl()
  @IsDefined()
  @IsSafeWebhookUrl({
    message:
      'Webhook URL must be a public HTTPS URL and cannot point to internal network addresses',
  })
  url: string;

  @Type(() => WebhooksIntegrationDto)
  @IsDefined()
  integrations: WebhooksIntegrationDto[];

  @IsOptional()
  @IsIn(['post.published', 'post.failed', 'analytics.report'])
  type?: 'post.published' | 'post.failed' | 'analytics.report';

  @ValidateIf((o) => o.type === 'analytics.report')
  @IsIn(['daily', 'weekly', 'monthly'])
  schedule?: 'daily' | 'weekly' | 'monthly';

  @IsOptional()
  @IsIn([1, 7, 30, 90])
  lookbackDays?: number;

  @IsOptional()
  @IsArray()
  @IsIn(analyticsMetricKeys, { each: true })
  metrics?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(['channels', 'summary', 'topPosts'], { each: true })
  sections?: ('channels' | 'summary' | 'topPosts')[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  topPostsLimit?: number;
}

export class OnlyURL {
  @IsString()
  @IsUrl()
  @IsDefined()
  @IsSafeWebhookUrl({
    message:
      'URL must be a public HTTPS URL and cannot point to internal network addresses',
  })
  url: string;
}

export class UpdateDto {
  @IsString()
  @IsDefined()
  id: string;

  @IsString()
  @IsDefined()
  name: string;

  @IsString()
  @IsUrl()
  @IsDefined()
  @IsSafeWebhookUrl({
    message:
      'Webhook URL must be a public HTTPS URL and cannot point to internal network addresses',
  })
  url: string;

  @Type(() => WebhooksIntegrationDto)
  @IsDefined()
  integrations: WebhooksIntegrationDto[];

  @IsOptional()
  @IsIn(['post.published', 'post.failed', 'analytics.report'])
  type?: 'post.published' | 'post.failed' | 'analytics.report';

  @ValidateIf((o) => o.type === 'analytics.report')
  @IsIn(['daily', 'weekly', 'monthly'])
  schedule?: 'daily' | 'weekly' | 'monthly';

  @IsOptional()
  @IsIn([1, 7, 30, 90])
  lookbackDays?: number;

  @IsOptional()
  @IsArray()
  @IsIn(analyticsMetricKeys, { each: true })
  metrics?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(['channels', 'summary', 'topPosts'], { each: true })
  sections?: ('channels' | 'summary' | 'topPosts')[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  topPostsLimit?: number;
}

export class AnalyticsPreviewDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WebhooksIntegrationDto)
  integrations?: WebhooksIntegrationDto[];

  @IsOptional()
  @IsIn([1, 7, 30, 90])
  lookbackDays?: number;

  @IsOptional()
  @IsArray()
  @IsIn(analyticsMetricKeys, { each: true })
  metrics?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(['channels', 'summary', 'topPosts'], { each: true })
  sections?: ('channels' | 'summary' | 'topPosts')[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  topPostsLimit?: number;
}
