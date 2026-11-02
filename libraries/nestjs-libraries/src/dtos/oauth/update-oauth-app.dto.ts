import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { redirectUrlOptions } from '@gitroom/nestjs-libraries/dtos/oauth/create-oauth-app.dto';

export class UpdateOAuthAppDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  pictureId?: string;

  @IsString()
  @IsOptional()
  @IsUrl(redirectUrlOptions)
  redirectUrl?: string;
}
