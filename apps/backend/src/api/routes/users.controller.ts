import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { sign } from 'jsonwebtoken';
import { Organization, User } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';
import { Response, Request } from 'express';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { CheckPolicies } from '@gitroom/nestjs-libraries/permissions/permissions.ability';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { ApiTags } from '@nestjs/swagger';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { EmailNotificationsDto } from '@gitroom/nestjs-libraries/dtos/users/email-notifications.dto';
import { TimezoneDto } from '@gitroom/nestjs-libraries/dtos/users/timezone.dto';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { applyTrackCookies } from '@gitroom/nestjs-libraries/track/track.cookies';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

@ApiTags('User')
@Controller('/user')
export class UsersController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _paymentService: PaymentService,
    private _orgService: OrganizationService,
    private _userService: UsersService,
    private _trackService: TrackService
  ) {}

  @Get('/chatbase-token')
  async getChatbaseToken(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    if (!process.env.CHATBASE_TOKEN) {
      throw new HttpException('Chatbase SSO is not configured', 400);
    }

    const token = sign(
      {
        user_id: organization.id,
        email: user.email,
        ...(organization.paymentId
          ? {
              stripe_accounts: [
                {
                  label: organization.name,
                  stripe_id: organization.paymentId,
                },
              ],
            }
          : {}),
      },
      process.env.CHATBASE_TOKEN,
      { expiresIn: '1h' }
    );

    return { token };
  }

  @Get('/self')
  async getSelf(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Req() req: Request
  ) {
    if (!organization) {
      throw new HttpForbiddenException();
    }

    const impersonate = req.cookies.impersonate || req.headers.impersonate;
    return this._userService.getSelf(user, organization, !!impersonate);
  }

  @Get('/personal')
  async getPersonalInformation(@GetUserFromRequest() user: User) {
    return this._userService.getPersonal(user.id);
  }

  @Get('/impersonate')
  async getImpersonate(
    @GetUserFromRequest() user: User,
    @Query('name') name: string
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return this._userService.getImpersonateUser(name);
  }

  @Post('/impersonate')
  async setImpersonate(
    @GetUserFromRequest() user: User,
    @Body('id') id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    response.cookie('impersonate', id, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    if (process.env.NOT_SECURED) {
      response.header('impersonate', id);
    }
  }

  @Post('/switch')
  async switchUser(
    @GetUserFromRequest() user: User,
    @Body('id') id: string,
    @Req() req: Request
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    // `user` is the impersonated account, so the admin id comes from the token.
    // Require an active impersonation session and never allow the admin's own
    // account in the swap — either would trade away the admin's login.
    const adminId = this.getRequestUserId(req);
    if (
      !id ||
      !adminId ||
      id === user.id ||
      adminId === user.id ||
      adminId === id
    ) {
      throw new HttpException('Invalid user to switch to', 400);
    }

    const { kept, switched } = await this._userService.switchUser(
      user.id,
      id,
      adminId
    );

    await this._paymentService.syncCustomerEmailsAfterSwitch([kept, switched]);

    return { success: true };
  }

  private getRequestUserId(req: Request): string | null {
    try {
      const auth = (req.headers.auth as string) || req.cookies?.auth;
      const payload = AuthChecker.verifyJWT(auth) as { id?: string } | null;
      return payload?.id || null;
    } catch {
      return null;
    }
  }

  @Post('/personal')
  async changePersonal(
    @GetUserFromRequest() user: User,
    @Body() body: UserDetailDto
  ) {
    return this._userService.changePersonal(user.id, body);
  }

  @Get('/email-notifications')
  async getEmailNotifications(@GetUserFromRequest() user: User) {
    return this._userService.getEmailNotifications(user.id);
  }

  @Post('/email-notifications')
  async updateEmailNotifications(
    @GetUserFromRequest() user: User,
    @Body() body: EmailNotificationsDto
  ) {
    return this._userService.updateEmailNotifications(user.id, body);
  }

  @Post('/timezone')
  async updateTimezone(
    @GetUserFromRequest() user: User,
    @Body() body: TimezoneDto
  ) {
    return this._userService.updateTimezone(user.id, body);
  }

  @Post('/api-key/rotate')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async rotateApiKey(@GetOrgFromRequest() organization: Organization) {
    return this._orgService.updateApiKey(organization.id);
  }

  @Get('/subscription')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getSubscription(@GetOrgFromRequest() organization: Organization) {
    const subscription = await this._paymentService.getSubscription(
      organization.id
    );

    return subscription ? { subscription } : { subscription: undefined };
  }

  @Get('/subscription/tiers')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async tiers() {
    return this._paymentService.getDefaultProvider('web').getPackages();
  }

  @Post('/join-org')
  async joinOrg(
    @GetUserFromRequest() user: User,
    @Body('org') org: string,
    @Res({ passthrough: true }) response: Response
  ) {
    response.status(200).json(await this._orgService.joinOrg(user.id, org));
  }

  @Get('/organizations')
  async getOrgs(@GetUserFromRequest() user: User) {
    return this._orgService.getUserOrganizations(user.id);
  }

  @Post('/change-org')
  changeOrg(
    @Body('id') id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    response.cookie('showorg', id, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    if (process.env.NOT_SECURED) {
      response.header('showorg', id);
    }

    response.status(200).send();
  }

  @Get('/delete-account-info')
  getDeleteAccountInfo(@GetUserFromRequest() user: User) {
    return this._userService.getDeleteAccountInfo(user.id);
  }

  @Post('/delete-account')
  async deleteAccount(
    @GetUserFromRequest() user: User,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const impersonate = req.cookies.impersonate || req.headers.impersonate;

    await this._userService.cancelBillingAndDeleteAccount(
      user.id,
      !!impersonate
    );

    return this.logout(response);
  }

  @Post('/logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.header('logout', 'true');
    response.cookie('auth', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.cookie('showorg', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.cookie('impersonate', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.status(200).send();
  }

  @Post('/t')
  async trackEvent(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @GetUserFromRequest() user: User,
    @RealIP() ip: string,
    @UserAgent() userAgent: string,
    @Body()
    body: { tt: TrackEnum; fbclid: string; additional: Record<string, any> }
  ) {
    const { uniqueId, fbc, fbp } = applyTrackCookies(req, res, body.fbclid);
    this._trackService
      .track(
        uniqueId,
        ip,
        userAgent,
        body.tt,
        body.additional,
        fbc,
        user,
        fbp
      )
      .catch((err) => {});

    res.status(200).json({
      track: uniqueId,
    });
  }
}
