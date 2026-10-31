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
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { IntegrationFunctionDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.function.dto';
import { CheckPolicies } from '@gitroom/nestjs-libraries/permissions/permissions.ability';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationTimeDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.time.dto';
import { IntegrationNameDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.name.dto';
import { CustomerNameDto } from '@gitroom/nestjs-libraries/dtos/integrations/customer.name.dto';
import { PlugDto } from '@gitroom/nestjs-libraries/dtos/plugs/plug.dto';
import { TelegramProvider } from '@gitroom/nestjs-libraries/integrations/social/telegram.provider';
import { MoltbookProvider } from '@gitroom/nestjs-libraries/integrations/social/moltbook.provider';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

@ApiTags('Integrations')
@Controller('/integrations')
export class IntegrationsController {
  constructor(
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _postService: PostsService
  ) {}

  @Post('/provider/:id/connect')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  async saveProviderPage(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: any
  ) {
    return this._integrationService.saveProviderPage(org.id, id, body);
  }

  @Get('/:identifier/internal-plugs')
  getInternalPlugs(@Param('identifier') identifier: string) {
    return this._integrationManager.getInternalPlugs(identifier);
  }

  @Get('/customers')
  getCustomers(@GetOrgFromRequest() org: Organization) {
    return this._integrationService.customers(org.id);
  }

  @Put('/customers/:id')
  async updateCustomerName(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: CustomerNameDto
  ) {
    return this._integrationService.updateCustomerName(org.id, id, body.name);
  }

  @Put('/:id/group')
  async updateIntegrationGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { group: string }
  ) {
    return this._integrationService.updateIntegrationGroup(
      org.id,
      id,
      body.group
    );
  }

  @Put('/:id/customer-name')
  async updateOnCustomerName(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { name: string }
  ) {
    return this._integrationService.updateOnCustomerName(org.id, id, body.name);
  }

  @Put('/:id/custom-name')
  async updateCustomName(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: IntegrationNameDto
  ) {
    return this._integrationService.updateCustomName(org.id, id, body.name);
  }

  @Get('/list')
  async getIntegrationList(@GetOrgFromRequest() org: Organization) {
    return {
      integrations:
        await this._integrationService.getIntegrationsListForDisplay(org.id),
    };
  }

  @Post('/:id/settings')
  async updateProviderSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('additionalSettings') body: string
  ) {
    if (typeof body !== 'string') {
      throw new Error('Invalid body');
    }

    await this._integrationService.updateProviderSettings(org.id, id, body);
  }
  @Post('/:id/nickname')
  async setNickname(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { name: string; picture: string }
  ) {
    return this._integrationService.changeProfile(org.id, id, body);
  }

  @Get('/:id')
  getSingleIntegration(
    @Param('id') id: string,
    @Query('order') order: string,
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    return this._integrationService.getIntegrationForOrder(
      id,
      order,
      user.id,
      org.id
    );
  }

  @Get('/social/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  async getIntegrationUrl(
    @Param('integration') integration: string,
    @Query('refresh') refresh: string,
    @Query('externalUrl') externalUrl: string,
    @Query('redirectUrl') redirectUrl: string,
    @Query('onboarding') onboarding: string,
    @GetOrgFromRequest() org: Organization
  ) {
    return this._integrationService.generateConnectUrl(org.id, integration, {
      refresh,
      externalUrl,
      redirectUrl,
      onboarding,
    });
  }

  @Post('/:id/time')
  async setTime(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: IntegrationTimeDto
  ) {
    return this._integrationService.setTimes(org.id, id, body);
  }

  @Post('/mentions')
  async mentions(
    @GetOrgFromRequest() org: Organization,
    @Body() body: IntegrationFunctionDto
  ) {
    return this._integrationService.mentions(org.id, body.id, body.data);
  }

  @Post('/function')
  async functionIntegration(
    @GetOrgFromRequest() org: Organization,
    @Body() body: IntegrationFunctionDto
  ): Promise<any> {
    return this._integrationService.dashboardFunction(
      org.id,
      body.id,
      body.name,
      body.data
    );
  }

  @Post('/disable')
  disableChannel(
    @GetOrgFromRequest() org: Organization,
    @Body('id') id: string
  ) {
    return this._integrationService.disableChannel(org.id, id);
  }

  @Post('/enable')
  enableChannel(
    @GetOrgFromRequest() org: Organization,
    @Body('id') id: string
  ) {
    return this._integrationService.enableChannelForOrganization(org, id);
  }

  @Delete('/')
  async deleteChannel(
    @GetOrgFromRequest() org: Organization,
    @Body('id') id: string
  ) {
    return this._postService.deleteChannelWithPosts(org.id, id);
  }

  @Get('/plug/list')
  async getPlugList() {
    return { plugs: this._integrationManager.getAllPlugs() };
  }

  @Get('/:id/plugs')
  async getPlugsByIntegrationId(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization
  ) {
    return this._integrationService.getPlugsByIntegrationId(org.id, id);
  }

  @Post('/:id/plugs')
  async postPlugsByIntegrationId(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
    @Body() body: PlugDto
  ) {
    return this._integrationService.createOrUpdatePlug(org.id, id, body);
  }

  @Put('/plugs/:id/activate')
  async changePlugActivation(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
    @Body('status') status: boolean
  ) {
    return this._integrationService.changePlugActivation(org.id, id, status);
  }

  @Get('/telegram/updates')
  async getUpdates(@Query() query: { word: string; id?: number }) {
    return new TelegramProvider().getBotId(query);
  }

  @Post('/moltbook/register')
  async moltbookRegister(@Body() body: { name: string; description: string }) {
    try {
      const provider = new MoltbookProvider();
      const result = await provider.registerAgent(body.name, body.description);
      return {
        apiKey: result.api_key,
        claimUrl: result.claim_url,
        verificationCode: result.verification_code,
      };
    } catch (err: any) {
      return { error: err.message || 'Registration failed' };
    }
  }

  @Get('/moltbook/status')
  async moltbookStatus(@Query('apiKey') apiKey: string) {
    try {
      const provider = new MoltbookProvider();
      const result = await provider.checkAgentStatus(apiKey);
      return { claimed: result?.status === 'claimed' };
    } catch (err) {
      return { claimed: false };
    }
  }
}
