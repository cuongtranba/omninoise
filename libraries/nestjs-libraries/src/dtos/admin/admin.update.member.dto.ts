import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Role } from '@prisma/client';

export class AdminUpdateMemberDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}
