import { IsDefined, IsEmail, IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class AdminAddMemberDto {
  @IsDefined()
  @IsEmail()
  email: string;

  @IsDefined()
  @IsEnum(Role)
  role: Role;
}
