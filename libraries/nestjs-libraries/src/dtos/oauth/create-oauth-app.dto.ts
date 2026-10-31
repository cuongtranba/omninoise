import { IsDefined, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

// The consent screen navigates to this url: only a full http(s) url is a
// redirect, anything else (javascript:1/%0aalert(1) passes without a protocol)
// would run in the Postiz origin
export const redirectUrlOptions = {
  require_tld: false,
  require_protocol: true,
  protocols: ['http', 'https'],
};

export class CreateOAuthAppDto {
  @IsString()
  @IsDefined()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  pictureId?: string;

  @IsString()
  @IsDefined()
  @IsUrl(redirectUrlOptions)
  redirectUrl: string;
}
