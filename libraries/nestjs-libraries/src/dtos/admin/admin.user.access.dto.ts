import { IsBoolean, IsDefined } from 'class-validator';

export class AdminUserAccessDto {
  @IsDefined()
  @IsBoolean()
  disabled: boolean;
}
