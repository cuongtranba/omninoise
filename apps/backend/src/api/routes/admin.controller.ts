import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { ErrorsService } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.service';
import { AdminStatsService } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { PlatformInviteDto } from '@gitroom/nestjs-libraries/dtos/settings/platform.invite.dto';
import { AdminAddMemberDto } from '@gitroom/nestjs-libraries/dtos/admin/admin.add.member.dto';
import { AdminUpdateMemberDto } from '@gitroom/nestjs-libraries/dtos/admin/admin.update.member.dto';
import { AdminUserAccessDto } from '@gitroom/nestjs-libraries/dtos/admin/admin.user.access.dto';

@ApiTags('Admin')
@Controller('/admin')
export class AdminController {
  constructor(
    private _errorsService: ErrorsService,
    private _adminStatsService: AdminStatsService,
    private _usersService: UsersService,
    private _organizationService: OrganizationService
  ) {}

  @Post('/platform-invite')
  async invitePlatform(
    @GetUserFromRequest() user: User,
    @Body() body: PlatformInviteDto
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._organizationService.invitePlatform(user, body);
  }

  @Get('/errors')
  async listErrors(
    @GetUserFromRequest() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('platform') platform?: string,
    @Query('email') email?: string,
    @Query('unknownFirst') unknownFirst?: string
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._errorsService.listErrors({
      page: page ? parseInt(page, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 20,
      platform: platform || undefined,
      email: email || undefined,
      unknownFirst: unknownFirst === 'true' || unknownFirst === '1',
    });
  }

  @Get('/errors/platforms')
  async listPlatforms(@GetUserFromRequest() user: User) {
    this._usersService.assertSuperAdmin(user);
    return this._errorsService.listPlatforms();
  }

  @Get('/stats')
  async getStats(
    @GetUserFromRequest() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('unknownOnly') unknownOnly?: string
  ) {
    this._usersService.assertSuperAdmin(user);

    return this._adminStatsService.getStatsByRange({
      from,
      to,
      unknownOnly: unknownOnly === 'true' || unknownOnly === '1',
    });
  }

  @Get('/organizations')
  async listOrganizations(
    @GetUserFromRequest() user: User,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('deleted') deleted?: string
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._organizationService.adminListOrganizations({
      search: search || undefined,
      page: page ? parseInt(page, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 20,
      deleted:
        deleted === 'true' ? true : deleted === 'false' ? false : undefined,
    });
  }

  @Get('/organizations/:id')
  async getOrganization(
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._organizationService.adminGetOrganization(id);
  }

  @Post('/organizations/:id/members')
  async addMember(
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: AdminAddMemberDto
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._organizationService.adminAddMember(id, body);
  }

  @Put('/organizations/:id/members/:userId')
  async updateMember(
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: AdminUpdateMemberDto
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._organizationService.adminUpdateMember(id, userId, body);
  }

  @Delete('/organizations/:id/members/:userId')
  async removeMember(
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Param('userId') userId: string
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._organizationService.adminRemoveMember(id, userId);
  }

  @Delete('/organizations/:id')
  async deleteOrganization(
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._organizationService.adminDeleteOrganization(id);
  }

  @Post('/organizations/:id/restore')
  async restoreOrganization(
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._organizationService.adminRestoreOrganization(id);
  }

  @Get('/users')
  async listUsers(
    @GetUserFromRequest() user: User,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._usersService.adminListUsers({
      search: search || undefined,
      page: page ? parseInt(page, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Put('/users/:id/access')
  async setUserAccess(
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: AdminUserAccessDto
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._usersService.setUserAccess(user.id, id, body.disabled);
  }
}
