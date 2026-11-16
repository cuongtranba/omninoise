import { IsBoolean, IsDefined, IsEmail, ValidateIf } from 'class-validator';

export class PlatformInviteDto {
  @IsDefined()
  @IsEmail()
  @ValidateIf((o) => o.sendEmail)
  email: string;

  @IsDefined()
  @IsBoolean()
  sendEmail: boolean;
}
