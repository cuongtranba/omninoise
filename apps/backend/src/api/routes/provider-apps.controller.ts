import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { ProviderAppService } from '@gitroom/nestjs-libraries/database/prisma/provider-apps/provider.app.service';
import { CheckPolicies } from '@gitroom/nestjs-libraries/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';
import { SaveProviderAppDto } from '@gitroom/nestjs-libraries/dtos/provider-apps/save.provider.app.dto';

// The organization's own developer apps for the platforms, so its channels
// connect through its app instead of the server's. The secret is write-only.
@ApiTags('Provider Apps')
@Controller('/provider-apps')
export class ProviderAppsController {
  constructor(private _providerAppService: ProviderAppService) {}

  @Get('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async list(@GetOrgFromRequest() org: Organization) {
    return this._providerAppService.list(org.id);
  }

  @Put('/:family')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async save(
    @GetOrgFromRequest() org: Organization,
    @Param('family') family: string,
    @Body() body: SaveProviderAppDto
  ) {
    return this._providerAppService.save(org.id, family, body);
  }

  @Delete('/:family')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async delete(
    @GetOrgFromRequest() org: Organization,
    @Param('family') family: string
  ) {
    return this._providerAppService.delete(org.id, family);
  }
}
