import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { isTimeZone } from 'class-validator';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';
import {
  Organization,
  Provider,
  Role,
  Subscription,
  User,
} from '@prisma/client';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { EmailNotificationsDto } from '@gitroom/nestjs-libraries/dtos/users/email-notifications.dto';
import { TimezoneDto } from '@gitroom/nestjs-libraries/dtos/users/timezone.dto';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// The organization of a request: with the subscription and the role of the
// caller (users[0]) it is loaded with
type RequestOrganization = Organization & {
  subscription?: Pick<
    Subscription,
    'subscriptionTier' | 'totalChannels' | 'isLifetime'
  > | null;
  users?: { role: Role }[];
};

@Injectable()
export class UsersService {
  constructor(
    private _usersRepository: UsersRepository,
    private _organizationRepository: OrganizationRepository,
    private _integrationRepository: IntegrationRepository,
    private _notificationService: NotificationService,
    private _paymentService: PaymentService
  ) {}

  private readonly _logger = new Logger(UsersService.name);

  getUserByEmail(email: string) {
    return this._usersRepository.getUserByEmail(email);
  }

  getUserById(id: string) {
    return this._usersRepository.getUserById(id);
  }

  getUserWithActiveSubscriptionByEmail(email: string, excludeUserId: string) {
    return this._usersRepository.getUserWithActiveSubscriptionByEmail(
      email,
      excludeUserId
    );
  }

  // The plan and the role of the caller in the organization
  private getPlan(organization: RequestOrganization) {
    return {
      orgId: organization.id,
      totalChannels: !process.env.STRIPE_PUBLISHABLE_KEY
        ? 10000
        : organization.subscription?.totalChannels || pricing.FREE.channel,
      tier:
        organization.subscription?.subscriptionTier ||
        (!process.env.STRIPE_PUBLISHABLE_KEY ? 'ULTIMATE' : 'FREE'),
      role: organization.users?.[0]?.role,
      isLifetime: !!organization.subscription?.isLifetime,
      isTrailing: !process.env.STRIPE_PUBLISHABLE_KEY
        ? false
        : organization.isTrailing,
      allowTrial: organization.allowTrial,
      streakSince: organization.streakSince || null,
    };
  }

  private canSeeApiKey(organization: RequestOrganization) {
    return (
      organization.users?.[0]?.role === 'SUPERADMIN' ||
      organization.users?.[0]?.role === 'ADMIN'
    );
  }

  getSelf(user: User, organization: RequestOrganization, impersonate: boolean) {
    // the sign in of the user (password hash, ip, agent, provider id) is not
    // read by the web app
    const { password, ip, agent, providerId, ...rest } = user;
    return {
      ...rest,
      ...this.getPlan(organization),
      admin: !!user.isSuperAdmin,
      impersonate,
      publicApi: this.canSeeApiKey(organization) ? organization.apiKey : '',
    };
  }

  // The same as getSelf with the fields picked one by one: no credentials, no
  // API key and nothing of the sign in of the user
  getAccount(user: User, organization: RequestOrganization) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      lastName: user.lastName,
      timezoneName: user.timezoneName,
      ...this.getPlan(organization),
      admin: !!user.isSuperAdmin,
    };
  }

  getImpersonateUser(name: string) {
    return this._organizationRepository.getImpersonateUser(name);
  }

  // The admin routes of the instance (errors, stats, announcements, the user
  // search) are only for the super admin, the web checks the user of the request
  assertSuperAdmin(user?: Pick<User, 'isSuperAdmin'> | null) {
    if (!user?.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }
  }

  // The same check for a connection of the MCP or the copilot: the user is read
  // from the database by its id, never from the request. An API key has no
  // user, so it can never pass.
  async assertSuperAdminById(userId?: string) {
    this.assertSuperAdmin(userId ? await this.getUserById(userId) : null);
  }

  getUserByProvider(providerId: string, provider: Provider) {
    return this._usersRepository.getUserByProvider(providerId, provider);
  }

  async switchUser(
    currentUserId: string,
    targetUserId: string,
    adminId: string
  ) {
    const { kept, switched } =
      await this._usersRepository.switchUserCredentials(
        currentUserId,
        targetUserId
      );

    this._logger.log(
      `User login switch performed by admin ${adminId}: account ${
        kept.id
      } login ${switched.email} -> ${kept.email}; account ${
        switched.id
      } login ${kept.email} -> ${switched.email}`
    );

    // the swap is already committed; a notification failure must not fail it
    if (this._notificationService.hasEmailProvider()) {
      await Promise.all(
        [kept, switched].map((account) =>
          this._notificationService
            .sendEmail(
              account.email,
              'Your Postiz login was changed',
              `An administrator changed the login for your Postiz account. ` +
                `You can now sign in using ${account.email}. ` +
                `Your subscription and plan were not changed by this switch — ` +
                `if you intended to cancel a subscription, please do that ` +
                `separately from your billing settings.`
            )
            .catch((err) =>
              this._logger.error(`Failed to notify ${account.email}`, err)
            )
        )
      );
    }

    return { kept, switched };
  }

  async getOrgsToDeleteForAccount(userId: string) {
    const orgs = await this._organizationRepository.getOrgsByUserId(userId);
    const ownedOrgs = orgs.filter(
      (org) => org.users[0].role === Role.SUPERADMIN
    );

    const teams = await Promise.all(
      ownedOrgs.map((org) => this._organizationRepository.getTeam(org.id))
    );

    return ownedOrgs.filter(
      (org, index) =>
        !teams[index]?.users?.some(
          (member) =>
            member.user.id !== userId && member.role === Role.SUPERADMIN
        )
    );
  }

  async getDeleteAccountInfo(userId: string) {
    const ownedOrgs = await this.getOrgsToDeleteForAccount(userId);
    const teams = await Promise.all(
      ownedOrgs.map((org) => this._organizationRepository.getTeam(org.id))
    );

    return {
      hasSubscription: ownedOrgs.some((org) => !!org.subscription),
      hasAdditionalMembers: teams.some((team) =>
        team?.users?.some((member) => member.user.id !== userId)
      ),
    };
  }

  // Billing is cancelled before the account is scrubbed - once the account is
  // deleted there is no way to retry a failed cancellation
  async cancelBillingAndDeleteAccount(userId: string, impersonating: boolean) {
    if (impersonating) {
      throw new HttpException(
        'Account cannot be deleted while impersonating',
        400
      );
    }

    const ownedOrgs = await this.getOrgsToDeleteForAccount(userId);

    for (const org of ownedOrgs) {
      try {
        await this._paymentService.cancelAllSubscriptions(org.id);
      } catch (err) {
        console.log(err);
        throw new HttpException(
          'Could not cancel your subscription, please try again or contact support',
          400
        );
      }
    }

    return this.deleteAccount(userId);
  }

  async deleteAccount(userId: string) {
    const deletedOrgs = await this.getOrgsToDeleteForAccount(userId);
    const orgs = await this._organizationRepository.getOrgsByUserId(userId);

    for (const org of orgs) {
      if (deletedOrgs.some((deletedOrg) => deletedOrg.id === org.id)) {
        const team = await this._organizationRepository.getTeam(org.id);
        for (const member of team?.users || []) {
          if (member.user.id !== userId) {
            await this._organizationRepository.deleteTeamMember(
              org.id,
              member.user.id
            );
          }
        }

        await this._integrationRepository.deleteIntegrationsForAccount(org.id);
        await this._organizationRepository.deleteOrganization(org.id);
      } else {
        await this._organizationRepository.deleteTeamMember(org.id, userId);
      }
    }

    await this._usersRepository.deleteAccount(userId);

    this._logger.log(
      `Account ${userId} deleted, organizations removed: ${deletedOrgs
        .map((org) => org.id)
        .join(', ')}`
    );

    return { deletedOrgs };
  }

  activateUser(id: string) {
    return this._usersRepository.activateUser(id);
  }

  updatePassword(id: string, password: string) {
    return this._usersRepository.updatePassword(id, password);
  }

  getPersonal(userId: string) {
    return this._usersRepository.getPersonal(userId);
  }

  changePersonal(userId: string, body: UserDetailDto) {
    return this._usersRepository.changePersonal(userId, body);
  }

  getEmailNotifications(userId: string) {
    return this._usersRepository.getEmailNotifications(userId);
  }

  updateEmailNotifications(userId: string, body: EmailNotificationsDto) {
    return this._usersRepository.updateEmailNotifications(userId, body);
  }

  updateTimezone(userId: string, body: TimezoneDto) {
    // empty means the timezone of the browser
    if (body.timezoneName && !isTimeZone(body.timezoneName)) {
      throw new BadRequestException(
        'timezoneName must be a valid IANA timezone'
      );
    }

    return this._usersRepository.updateTimezone(userId, body);
  }
}
