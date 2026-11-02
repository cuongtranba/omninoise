import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { AnnouncementsService } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { AnnouncementDto } from '@gitroom/nestjs-libraries/dtos/announcements/announcements.dto';

@ApiTags('Announcements')
@Controller('/announcements')
export class AnnouncementsController {
  constructor(
    private _announcementsService: AnnouncementsService,
    private _usersService: UsersService
  ) {}

  @Get('/')
  async getAnnouncements() {
    return this._announcementsService.getAnnouncements();
  }

  @Post('/')
  async createAnnouncement(
    @GetUserFromRequest() user: User,
    @Body() body: AnnouncementDto
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._announcementsService.createAnnouncement(body);
  }

  @Delete('/:id')
  async deleteAnnouncement(
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    this._usersService.assertSuperAdmin(user);
    return this._announcementsService.deleteAnnouncement(id);
  }
}
