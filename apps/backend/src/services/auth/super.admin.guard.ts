import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private _organizationService: OrganizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    const { org, isOAuthApp, authOrgId } = request;

    const orgId = authOrgId || org?.id;

    if (
      !orgId ||
      isOAuthApp ||
      !(await this._organizationService.canUseSuperAdminApi(orgId))
    ) {
      throw new HttpException({ msg: 'Unauthorized' }, 403);
    }

    return true;
  }
}
