import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveProviderAppDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  clientId: string;

  // Empty keeps the stored secret; required for a new app
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  clientSecret?: string;
}
