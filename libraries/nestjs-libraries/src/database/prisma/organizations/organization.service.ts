import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { HttpException, Injectable } from '@nestjs/common';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { AddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/add.team.member.dto';
import { AdminAddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/admin.add.team.member.dto';
import { PlatformInviteDto } from '@gitroom/nestjs-libraries/dtos/settings/platform.invite.dto';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  Organization,
  Role,
  ShortLinkPreference,
  Subscription,
  User,
} from '@prisma/client';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { AdminAddMemberDto } from '@gitroom/nestjs-libraries/dtos/admin/admin.add.member.dto';
import { AdminUpdateMemberDto } from '@gitroom/nestjs-libraries/dtos/admin/admin.update.member.dto';

// The organization the auth middlewares attach to the request: the full
// organization for a signed-in user or an API key, only its id for the widget
// tickets. subscription and users are there when it is loaded with them,
// users[0].role is the role of the caller in that organization.
export type RequestOrganization = Pick<Organization, 'id'> &
  Partial<Organization> & {
    subscription?: Partial<
      Pick<
        Subscription,
        'subscriptionTier' | 'totalChannels' | 'isLifetime' | 'createdAt'
      >
    > | null;
    // adminAccess: the instance super admin entered an organization they are
    // not a member of, see AuthMiddleware
    users?: { role: Role; disabled?: boolean; adminAccess?: boolean }[];
  };

@Injectable()
export class OrganizationService {
  constructor(
    private _organizationRepository: OrganizationRepository,
    private _notificationsService: NotificationService,
    private _integrationRepository: IntegrationRepository
  ) {}
  async createOrgAndUser(
    body: Omit<CreateOrgUserDto, 'providerToken'> & { providerId?: string },
    ip: string,
    userAgent: string,
    platformInviteId?: string
  ) {
    return this._organizationRepository.createOrgAndUser(
      body,
      this._notificationsService.hasEmailProvider(),
      ip,
      userAgent,
      platformInviteId
    );
  }

  async getCount() {
    return this._organizationRepository.getCount();
  }

  async isInviteUsed(id: string) {
    return this._organizationRepository.isInviteUsed(id);
  }

  async isPlatformInviteUsed(id: string) {
    return this._organizationRepository.isPlatformInviteUsed(id);
  }

  async createMaxUser(
    id: string,
    name: string,
    saasName: string,
    email: string
  ) {
    return this._organizationRepository.createMaxUser(
      id,
      name,
      saasName,
      email
    );
  }

  addUserToOrg(
    userId: string,
    id: string,
    orgId: string,
    role: 'USER' | 'ADMIN'
  ) {
    return this._organizationRepository.addUserToOrg(userId, id, orgId, role);
  }

  // The invitation an invite link carries, false when it is invalid or expired
  getInviteFromToken(token?: string) {
    if (!token) {
      return false;
    }

    try {
      const invite: any = AuthService.verifyJWT(token);
      if (
        typeof invite.orgId !== 'string' ||
        typeof invite.id !== 'string' ||
        !['USER', 'ADMIN'].includes(invite.role) ||
        !invite.timeLimit ||
        dayjs(invite.timeLimit).isBefore(dayjs())
      ) {
        return false;
      }

      return invite as {
        email: string;
        role: 'USER' | 'ADMIN';
        orgId: string;
        id: string;
      };
    } catch (err) {
      return false;
    }
  }

  // The platform invitation an invite link carries (an invite to create an
  // account, not tied to an organization), false when it is invalid or expired
  getPlatformInviteFromToken(token?: string) {
    if (!token) {
      return false;
    }

    try {
      const invite: any = AuthService.verifyJWT(token);
      if (
        invite.platform !== true ||
        typeof invite.id !== 'string' ||
        !invite.timeLimit ||
        dayjs(invite.timeLimit).isBefore(dayjs())
      ) {
        return false;
      }

      return invite as { email?: string; id: string };
    } catch (err) {
      return false;
    }
  }

  // Accepts an invite for the user, the token or the whole link carrying it in
  // "org": the id of the organization joined, or null when it is invalid,
  // expired, already used or the plan is full
  async joinOrg(userId: string, tokenOrLink: string) {
    const invite = this.getInviteFromToken(
      tokenOrLink?.match(/[?&]org=([^&#\s]+)/)?.[1] ?? tokenOrLink
    );
    if (!invite) {
      return { id: null };
    }

    const addedOrg = await this.addUserToOrg(
      userId,
      invite.id,
      invite.orgId,
      invite.role
    );

    return {
      id: typeof addedOrg !== 'boolean' ? addedOrg.organizationId : null,
    };
  }

  // The organizations the user belongs to and has not been disabled in
  async getUserOrganizations(userId: string) {
    return (await this.getOrgsByUserId(userId))
      .filter((f) => !f.users[0].disabled)
      .map((p) => ({
        id: p.id,
        name: p.name,
        users: p.users,
        subscription: p.subscription,
      }));
  }

  getOrgById(id: string) {
    return this._organizationRepository.getOrgById(id);
  }

  getOrgByIdWithSubscription(id: string) {
    return this._organizationRepository.getOrgByIdWithSubscription(id);
  }

  getActiveOrgForAdmin(id: string) {
    return this._organizationRepository.getActiveOrgForAdmin(id);
  }

  getAccountOverview(orgId: string) {
    return this._organizationRepository.getAccountOverview(orgId);
  }

  getOrgByApiKey(api: string) {
    return this._organizationRepository.getOrgByApiKey(api);
  }

  // Billing is on and the organization has no subscription: the public API
  // and MCP both refuse it
  hasNoSubscription(org: { subscription?: unknown }) {
    return !!process.env.STRIPE_SECRET_KEY && !org.subscription;
  }

  async canUseSuperAdminApi(orgId: string) {
    const [superAdmin, privilegedOther] = await Promise.all([
      this._organizationRepository.getSuperAdminUser(orgId),
      this._organizationRepository.getPrivilegedNonSuperAdminUser(orgId),
    ]);

    return !!superAdmin && !privilegedOther;
  }

  getUserOrg(id: string) {
    return this._organizationRepository.getUserOrg(id);
  }

  getOrgsByUserId(userId: string) {
    return this._organizationRepository.getOrgsByUserId(userId);
  }

  updateApiKey(orgId: string) {
    return this._organizationRepository.updateApiKey(orgId);
  }

  getTeam(orgId: string) {
    return this._organizationRepository.getTeam(orgId);
  }

  async setStreak(organizationId: string, type: 'start' | 'end') {
    return this._organizationRepository.setStreak(organizationId, type);
  }

  async getLastPublishDate(organizationId: string) {
    return this._organizationRepository.getLastPublishDate(organizationId);
  }

  getOrgByCustomerId(customerId: string) {
    return this._organizationRepository.getOrgByCustomerId(customerId);
  }

  async inviteTeamMember(
    org: Organization,
    user: Pick<User, 'name' | 'email'> | null,
    body: AddTeamMemberDto
  ) {
    const timeLimit = dayjs().add(2, 'day').format('YYYY-MM-DD HH:mm:ss');
    const id = makeId(5);
    // only the invite fields, the body can carry undeclared properties
    const url =
      process.env.FRONTEND_URL +
      `/?org=${AuthService.signJWT({
        email: body.email,
        role: body.role,
        orgId: org.id,
        timeLimit,
        id,
      })}`;
    if (body.sendEmail) {
      if (!user) {
        throw new HttpException(
          'An invitation by email is sent in the name of a user',
          400
        );
      }
      const inviter = user.name ? `${user.name} (${user.email})` : user.email;
      await this._notificationsService.sendEmail(
        body.email,
        `${user.name || user.email} invited you to join "${org.name}"`,
        this.inviteEmailBody(
          `${inviter} has invited you to join the "${org.name}" team.`,
          'Accept the invitation',
          url
        )
      );
    }
    return { url };
  }

  // An invitation to create an account on the instance, only for its super
  // admin. It reuses the "org" link of the team invites and joins no organization.
  async invitePlatform(
    user: Pick<User, 'name' | 'email'>,
    body: PlatformInviteDto
  ) {
    const timeLimit = dayjs().add(2, 'day').format('YYYY-MM-DD HH:mm:ss');
    const url =
      process.env.FRONTEND_URL +
      `/?org=${AuthService.signJWT({
        platform: true,
        email: body.email,
        timeLimit,
        id: makeId(10),
      })}`;
    if (body.sendEmail) {
      const inviter = user.name || user.email;
      await this._notificationsService.sendEmail(
        body.email,
        `${inviter} invited you to Omninoise`,
        this.inviteEmailBody(
          `${inviter} has invited you to create an Omninoise account.`,
          'Create your account',
          url
        )
      );
    }
    return { url };
  }

  private inviteEmailBody(sentence: string, button: string, url: string) {
    return `${sentence}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
          <tr>
            <td align="center" bgcolor="#D04430" style="background-color:#D04430;border-radius:8px;">
              <a href="${url}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${button}</a>
            </td>
          </tr>
        </table>
        The link will expire in 2 days.
        <div style="padding-top:16px;font-size:13px;line-height:1.5;color:#6b7280;">
          Or paste this link into your browser:<br />
          <a href="${url}" style="color:#6b7280;word-break:break-all;">${url}</a>
        </div>`;
  }

  // The admins and owners of the organization, and the super admin of the
  // instance, can add an existing account to the organization by its email
  async addTeamMemberByEmail(
    org: RequestOrganization,
    requester: Pick<User, 'isSuperAdmin'>,
    body: AdminAddTeamMemberDto
  ) {
    const role = org.users?.[0]?.role;
    if (!requester.isSuperAdmin && role !== 'ADMIN' && role !== 'SUPERADMIN') {
      throw new HttpException('Unauthorized', 400);
    }

    const tier =
      org?.subscription?.subscriptionTier ||
      (!process.env.STRIPE_PUBLISHABLE_KEY ? 'ULTIMATE' : 'FREE');

    if (!pricing[tier].team_members) {
      throw new HttpException(
        'The organization plan does not include team members',
        400
      );
    }

    const user = await this.getSingleUserByEmail(body.email);

    const userOrgs = await this._organizationRepository.getOrgsByUserId(
      user.id
    );
    if (userOrgs.some((current) => current.id === org.id)) {
      throw new HttpException(
        'User is already a member of this organization',
        400
      );
    }

    const added = await this._organizationRepository.addUserToOrg(
      user.id,
      makeId(5),
      org.id,
      body.role as 'USER' | 'ADMIN'
    );

    if (!added) {
      throw new HttpException(
        'Could not add the user to the organization',
        400
      );
    }

    return { added: true };
  }

  async deleteTeamMember(org: RequestOrganization, userId: string) {
    const userOrgs = await this._organizationRepository.getOrgsByUserId(userId);
    const findOrgToDelete = userOrgs.find((orgUser) => orgUser.id === org.id);
    if (!findOrgToDelete) {
      throw new Error('User is not part of this organization');
    }

    const myRole = org.users[0].role;
    const userRole = findOrgToDelete.users[0].role;
    const myLevel = myRole === 'USER' ? 0 : myRole === 'ADMIN' ? 1 : 2;
    const userLevel = userRole === 'USER' ? 0 : userRole === 'ADMIN' ? 1 : 2;

    if (myLevel < userLevel) {
      throw new Error('You do not have permission to delete this user');
    }

    return this._organizationRepository.deleteTeamMember(org.id, userId);
  }

  // The organization management of the instance super admin. The callers
  // (admin controller, adminTool, adminManageTool) check the super admin first.
  async adminListOrganizations(params: {
    search?: string;
    page?: number;
    limit?: number;
    deleted?: boolean;
  }) {
    const list = await this._organizationRepository.adminListOrganizations({
      search: params.search?.trim() || undefined,
      page: params.page ?? 0,
      limit: params.limit ?? 20,
      deleted: params.deleted,
    });

    return {
      ...list,
      items: list.items.map((org) => ({
        id: org.id,
        name: org.name,
        createdAt: org.createdAt,
        deletedAt: org.deletedAt,
        tier: org.subscription?.subscriptionTier ?? null,
        ownerEmail: org.users[0]?.user.email ?? null,
        members: org._count.users,
      })),
    };
  }

  async adminGetOrganization(orgId: string) {
    const [overview, members] = await Promise.all([
      this._organizationRepository.getAccountOverview(orgId),
      this._organizationRepository.getMembersForAdmin(orgId),
    ]);
    if (!overview) {
      throw new HttpException('Organization not found', 404);
    }

    return {
      ...overview,
      members: members.map((member) => ({
        userId: member.user.id,
        email: member.user.email,
        name: member.user.name,
        role: member.role,
        disabled: member.disabled,
        accountDisabledAt: member.user.disabledAt,
        createdAt: member.createdAt,
      })),
    };
  }

  async adminAddMember(orgId: string, body: AdminAddMemberDto) {
    if (!(await this._organizationRepository.getOrgById(orgId))) {
      throw new HttpException('Organization not found', 404);
    }

    const user = await this.getSingleUserByEmail(body.email);

    if (await this._organizationRepository.getMembership(orgId, user.id)) {
      throw new HttpException(
        'User is already a member of this organization',
        400
      );
    }

    return this._organizationRepository.addMemberForAdmin(
      orgId,
      user.id,
      body.role
    );
  }

  // The one account with this email, an email can have one account per login
  // provider
  private async getSingleUserByEmail(email: string) {
    const users = await this._organizationRepository.getUsersByEmail(email);
    if (!users.length) {
      throw new HttpException('No Omninoise account found for this email', 400);
    }

    if (users.length > 1) {
      throw new HttpException(
        'Multiple accounts exist for this email (different login providers)',
        400
      );
    }

    return users[0];
  }

  async adminUpdateMember(
    orgId: string,
    userId: string,
    body: AdminUpdateMemberDto
  ) {
    const membership = await this.getMembershipForAdmin(orgId, userId);
    if (body.role && body.role !== Role.SUPERADMIN) {
      await this.assertKeepsAnOwner(orgId, userId, membership.role);
    }

    return this._organizationRepository.updateMembership(orgId, userId, {
      role: body.role,
      disabled: body.disabled,
    });
  }

  async adminRemoveMember(orgId: string, userId: string) {
    const membership = await this.getMembershipForAdmin(orgId, userId);
    await this.assertKeepsAnOwner(orgId, userId, membership.role);
    await this._organizationRepository.deleteTeamMember(orgId, userId);

    return { id: membership.id };
  }

  // Soft deletes the organization and disables its enabled channels, billing
  // is left as it is. Running it again is harmless.
  async adminDeleteOrganization(orgId: string) {
    if (!(await this._organizationRepository.getOrgById(orgId))) {
      throw new HttpException('Organization not found', 404);
    }

    await this._integrationRepository.suspendForOrganization(orgId);
    await this._organizationRepository.deleteOrganization(orgId);

    return { id: orgId };
  }

  // Restores the organization and re-enables the channels its delete disabled
  async adminRestoreOrganization(orgId: string) {
    if (!(await this._organizationRepository.getOrgById(orgId))) {
      throw new HttpException('Organization not found', 404);
    }

    await this._organizationRepository.restoreOrganization(orgId);
    await this._integrationRepository.resumeForOrganization(orgId);

    return { id: orgId };
  }

  private async getMembershipForAdmin(orgId: string, userId: string) {
    const membership = await this._organizationRepository.getMembership(
      orgId,
      userId
    );
    if (!membership) {
      throw new HttpException(
        'The user is not a member of this organization',
        400
      );
    }

    return membership;
  }

  // Billing and the account deletion rely on every organization having an
  // owner (SUPERADMIN role), so the last one can be neither demoted nor removed
  private async assertKeepsAnOwner(orgId: string, userId: string, role: Role) {
    if (
      role === Role.SUPERADMIN &&
      !(await this._organizationRepository.countOtherOwners(orgId, userId))
    ) {
      throw new HttpException(
        'The organization must keep at least one owner',
        400
      );
    }
  }

  disableOrEnableNonSuperAdminUsers(orgId: string, disable: boolean) {
    return this._organizationRepository.disableOrEnableNonSuperAdminUsers(
      orgId,
      disable
    );
  }

  getShortlinkPreference(orgId: string) {
    return this._organizationRepository.getShortlinkPreference(orgId);
  }

  updateShortlinkPreference(orgId: string, shortlink: ShortLinkPreference) {
    return this._organizationRepository.updateShortlinkPreference(
      orgId,
      shortlink
    );
  }
}
