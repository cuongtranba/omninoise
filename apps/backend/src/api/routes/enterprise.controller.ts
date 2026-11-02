import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

@ApiTags('Enterprise')
@Controller('/enterprise')
export class EnterpriseController {
  constructor(
    private _organizationService: OrganizationService,
    private _integrationService: IntegrationService,
    private _postsService: PostsService
  ) {}

  private verifyEnterpriseToken<T extends object>(params: string): T {
    const payload = AuthService.verifyJWT(params) as any;
    if (
      !payload || typeof payload !== 'object' ||
      'providerName' in payload || // login token (full User row)
      'orgId' in payload || // team invite token
      'expires' in payload // password reset token
    ) {
      throw new Error('Invalid enterprise token');
    }

    return payload as T;
  }

  @Post('/create-user')
  async createUser(@Body('params') params: string) {
    try {
      const { id, name, saasName, email } = this.verifyEnterpriseToken<{
        id: string;
        name: string;
        email: string;
        saasName: string;
      }>(params);

      if (!id || !saasName) {
        return { success: false };
      }

      try {
        return await this._organizationService.createMaxUser(
          id,
          name,
          saasName,
          email
        );
      } catch (err) {
        return { create: false };
      }
    } catch (err) {
      return { success: false };
    }
  }

  @Post('/url')
  async redirectParams(@Body('params') params: string) {
    try {
      const load = this.verifyEnterpriseToken<{
        redirectUrl: string;
        apiKey: string;
        refreshId?: string;
        provider: string;
        webhookUrl: string;
      }>(params);

      if (
        !load ||
        !load.redirectUrl ||
        !load.apiKey ||
        typeof load.apiKey !== 'string' ||
        !load.provider
      ) {
        return;
      }

      const org = await this._organizationService.getOrgByApiKey(load.apiKey);

      if (!org) {
        throw new Error('Organization not found');
      }

      const result = await this._integrationService.generateConnectUrl(
        org.id,
        load.provider,
        {
          refresh: load.refreshId,
          redirectUrl: load.redirectUrl,
          webhookUrl: load.webhookUrl,
        }
      );

      return 'url' in result ? result.url : undefined;
    } catch (err) {}
  }

  @Post('/delete-channel')
  async deleteChannel(@Body('params') params: string) {
    try {
      const load = this.verifyEnterpriseToken<{
        apiKey: string;
        id: string;
      }>(params);

      if (
        !load ||
        !load.apiKey ||
        !load.id ||
        typeof load.apiKey !== 'string' ||
        typeof load.id !== 'string'
      ) {
        return { success: false };
      }

      const org = await this._organizationService.getOrgByApiKey(load.apiKey);

      if (!org) {
        return { success: false };
      }

      await this._postsService.deleteChannelWithPosts(org.id, load.id);
      return { success: true };
    } catch (err) {
      return { success: false };
    }
  }
}
