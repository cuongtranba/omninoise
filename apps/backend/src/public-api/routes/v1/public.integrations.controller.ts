import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { streamUploadOptions } from '@gitroom/nestjs-libraries/upload/multer.stream.engine';
import { omit } from 'lodash';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetIncludeDeletedFromRequest } from '@gitroom/nestjs-libraries/user/include.deleted.from.request';
import { GetOAuthUserIdFromRequest } from '@gitroom/nestjs-libraries/user/oauth.user.id.from.request';
import { Organization } from '@prisma/client';
import {
  ConnectUrlError,
  IntegrationService,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { CheckPolicies } from '@gitroom/nestjs-libraries/permissions/permissions.ability';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { ChangePostStatusDto } from '@gitroom/nestjs-libraries/dtos/posts/change.post.status.dto';
import { UpdatePostSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/update.post.settings.dto';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { VideoFunctionDto } from '@gitroom/nestjs-libraries/dtos/videos/video.function.dto';
import { UploadDto } from '@gitroom/nestjs-libraries/dtos/media/upload.dto';
import { GetMediaDto } from '@gitroom/nestjs-libraries/dtos/media/get.media.dto';
import { ClippingDto } from '@gitroom/nestjs-libraries/dtos/clipping/clipping.dto';
import { ClippingService } from '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { GetNotificationsDto } from '@gitroom/nestjs-libraries/dtos/notifications/get.notifications.dto';
import * as Sentry from '@sentry/nestjs';
import {
  socialIntegrationList,
  IntegrationManager,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { SuperAdminGuard } from '@gitroom/backend/services/auth/super.admin.guard';
import { AdminStatsService } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { GetOrgActivityDto } from '@gitroom/nestjs-libraries/dtos/analytics/get.org.activity.dto';
import { ResetCreditsDto } from '@gitroom/nestjs-libraries/dtos/billing/reset.credits.dto';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import dayjs from 'dayjs';

@ApiTags('Public API')
@Controller('/public/v1')
export class PublicIntegrationsController {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _mediaService: MediaService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _usersService: UsersService,
    private _adminStatsService: AdminStatsService,
    private _organizationService: OrganizationService,
    private _clippingService: ClippingService,
    private _subscriptionService: SubscriptionService
  ) {}

  @Post('/upload')
  @UseInterceptors(FileInterceptor('file', streamUploadOptions()))
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File,
    @Body('adjust') adjust: string = 'false'
  ) {
    Sentry.metrics.count('public_api-request', 1);
    if (!file) {
      throw new HttpException({ msg: 'No file provided' }, 400);
    }

    if (adjust === 'true') {
      return this._mediaService.saveUploadedFile(
        org.id,
        file.filename,
        file.path
      );
    }

    return this._mediaService.saveFile(org.id, file.filename, file.path);
  }

  @Post('/upload-from-url')
  async uploadsFromUrl(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UploadDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    try {
      return await this._mediaService.uploadFromUrl(
        org.id,
        body.url,
        body.adjust
      );
    } catch (err) {
      // Validation failures keep this route's { msg } error shape
      if (err instanceof BadRequestException) {
        throw new HttpException({ msg: err.message }, 400);
      }
      throw err;
    }
  }

  @Get('/find-slot/:id')
  async findSlotIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return { date: await this._postsService.findFreeDateTime(org.id, id) };
  }

  @Get('/posts')
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const posts = await this._postsService.getPosts(org.id, query);
    return {
      posts,
      // comments,
    };
  }

  @Post('/posts')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async createPost(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: any
  ) {
    Sentry.metrics.count('public_api-request', 1);
    // a date per channel is a dashboard feature, the public API keeps one date
    // for the whole request
    const posts = Array.isArray(rawBody?.posts)
      ? rawBody.posts.map((post: any) => omit(post, 'date'))
      : rawBody?.posts;

    if (
      process.env.RESTRICT_UPLOAD_DOMAINS &&
      Array.isArray(posts) &&
      posts.some((p: any) =>
        p?.value?.some?.((a: any) =>
          a?.image?.some?.(
            (i: any) =>
              typeof i?.path === 'string' &&
              i.path.indexOf(process.env.RESTRICT_UPLOAD_DOMAINS) === -1
          )
        )
      )
    ) {
      throw new HttpException(
        {
          msg: `All media must be uploaded through our upload API route and contain the domain: ${process.env.RESTRICT_UPLOAD_DOMAINS}`,
        },
        400
      );
    }

    const allowedCreationMethods = ['CLI', 'API'] as const;
    const creationMethod = allowedCreationMethods.includes(
      rawBody.creationMethod
    )
      ? (rawBody.creationMethod as 'CLI' | 'API')
      : 'API';

    // Server-side validation — same rules as the dashboard, surfaced as a
    // readable 400 (see PostValidationExceptionFilter).
    return this._postsService.validateAndCreatePosts(
      org.id,
      { ...rawBody, posts },
      creationMethod,
      { replaceDraft: true }
    );
  }

  @Delete('/posts/:id')
  async deletePost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const getPostById = await this._postsService.getPost(org.id, id);
    return this._postsService.deletePost(org.id, getPostById.group);
  }

  @Delete('/posts/group/:group')
  deletePostByGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.deletePost(org.id, group);
  }

  @Get('/is-connected')
  async getActiveIntegrations(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    return { connected: true };
  }

  @Get('/media')
  async getMedia(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetMediaDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const { pages, results } = await this._mediaService.getMedia(
      org.id,
      query.page,
      query.search
    );

    return {
      pages,
      results: results.map((p) => ({
        id: p.id,
        name: p.name,
        originalName: p.originalName,
        path: p.path,
        createdAt: p.createdAt,
      })),
    };
  }

  @Get('/media/:id/status')
  async getMediaStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._mediaService.getMediaUploadStatus(org.id, id);
  }

  // `user` is only known for OAuth app tokens; an API key belongs to the
  // whole organization
  @Get('/me')
  async getMe(
    @GetOrgFromRequest() org: Organization,
    @GetOAuthUserIdFromRequest() userId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const user = userId ? await this._usersService.getPersonal(userId) : null;

    return {
      organization: { id: org.id, name: org.name },
      user: user
        ? { id: user.id, name: user.name, picture: user.picture?.path || null }
        : null,
    };
  }

  @Get('/groups')
  async listGroups(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    return (await this._integrationService.customers(org.id)).map(
      (customer) => ({
        id: customer.id,
        name: customer.name,
      })
    );
  }

  @Get('/integrations')
  async listIntegration(
    @GetOrgFromRequest() org: Organization,
    @Query('group') group?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return (await this._integrationService.getIntegrationsList(org.id))
      .filter((integration) => !group || integration.customer?.id === group)
      .map((integration) => ({
        id: integration.id,
        name: integration.customName || integration.name,
        identifier: integration.providerIdentifier,
        picture: integration.picture,
        disabled: integration.disabled,
        profile: integration.profile,
        customer: integration.customer
          ? {
              id: integration.customer.id,
              name: integration.customer.name,
            }
          : undefined,
      }));
  }

  @Get('/social/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  async getIntegrationUrl(
    @Param('integration') integration: string,
    @Query('refresh') refresh: string,
    @GetOrgFromRequest() org: Organization
  ) {
    Sentry.metrics.count('public_api-request', 1);
    let result;
    try {
      result = await this._integrationService.generateConnectUrl(
        org.id,
        integration,
        { refresh }
      );
    } catch (err) {
      if (!(err instanceof ConnectUrlError)) {
        throw err;
      }

      throw new HttpException(
        {
          msg:
            err.reason === 'externalUrl'
              ? 'This integration requires an external URL and is not supported via the public API'
              : 'Integration not allowed',
        },
        400
      );
    }

    if ('err' in result) {
      throw new HttpException({ msg: 'Failed to generate auth URL' }, 500);
    }

    return { url: result.url };
  }

  @Get('/users')
  @UseGuards(SuperAdminGuard)
  async listUsers(
    @GetOrgFromRequest() org: Organization,
    @Query('name') name: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const term = name?.trim();

    if (!term) {
      throw new HttpException({ msg: 'A search term is required' }, 400);
    }

    return this._usersService.getImpersonateUser(term);
  }

  @Get('/debug/posts/:id')
  @UseGuards(SuperAdminGuard)
  async getPostTimeline(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const timeline = await this._postsService.getPostTimeline(id, org.id);

    if (!timeline) {
      throw new HttpException({ msg: 'Post not found' }, 404);
    }

    return timeline;
  }

  @Get('/debug/account')
  @UseGuards(SuperAdminGuard)
  async getAccountOverview(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    const account = await this._organizationService.getAccountOverview(org.id);

    if (!account) {
      throw new HttpException({ msg: 'Organization not found' }, 404);
    }

    return account;
  }

  @Get('/debug/channels')
  @UseGuards(SuperAdminGuard)
  async getChannelHealth(
    @GetOrgFromRequest() org: Organization,
    @GetIncludeDeletedFromRequest() includeDeleted: boolean
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._integrationService.getChannelHealth(org.id, includeDeleted);
  }

  @Get('/debug/activity')
  @UseGuards(SuperAdminGuard)
  async getOrgActivity(
    @GetOrgFromRequest() org: Organization,
    @GetIncludeDeletedFromRequest() includeDeleted: boolean,
    @Query() query: GetOrgActivityDto
  ) {
    Sentry.metrics.count('public_api-request', 1);

    const from = query.from ? dayjs(query.from) : dayjs().subtract(30, 'day');
    const to = query.to ? dayjs(query.to) : dayjs();

    return this._adminStatsService.getOrgActivity({
      organizationId: org.id,
      from: from.startOf('day').toDate(),
      to: to.endOf('day').toDate(),
      includeDeleted,
    });
  }

  @Post('/credits/reset')
  @UseGuards(SuperAdminGuard)
  async resetCredits(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ResetCreditsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const reset = await this._subscriptionService.resetCredits(
      org.id,
      body.type
    );

    if (!reset) {
      throw new HttpException({ msg: 'No subscription found' }, 404);
    }

    return reset;
  }

  @Get('/notifications')
  async getNotifications(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetNotificationsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._notificationService.getNotificationsPaginated(
      org.id,
      query.page ?? 0
    );
  }

  @Post('/generate-video')
  generateVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._mediaService.generateVideo(org, body);
  }

  @Post('/video/function')
  videoFunction(@Body() body: VideoFunctionDto) {
    Sentry.metrics.count('public_api-request', 1);
    return this._mediaService.videoFunction(
      body.identifier,
      body.functionName,
      body.params
    );
  }

  @Post('/clipping')
  startClipping(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ClippingDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._clippingService.startClipping(org, body);
  }

  @Get('/clipping')
  getClippings(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page: number
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._clippingService.getClippings(org.id, page);
  }

  @Get('/clipping/:id')
  getClipping(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    Sentry.metrics.count('public_api-request', 1);
    return this._clippingService.getClipping(org.id, id);
  }

  @Delete('/integrations/:id')
  async deleteChannel(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.deleteChannelWithPosts(org.id, id);
  }

  @Get('/integration-settings/:id')
  async getIntegrationSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const loadIntegration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );

    if (!loadIntegration) {
      throw new HttpException({ msg: 'Integration not found' }, 404);
    }

    const verified =
      JSON.parse(loadIntegration.additionalSettings || '[]')?.find(
        (p: any) => p?.title === 'Verified'
      )?.value || false;

    const integration = socialIntegrationList.find(
      (p) => p.identifier === loadIntegration.providerIdentifier
    )!;

    if (!integration) {
      return {
        output: { rules: '', maxLength: 0, settings: {}, tools: [] as any[] },
      };
    }

    const maxLength = integration.maxLength(verified);
    const schemas = !integration.dto
      ? false
      : getValidationSchemas()[integration.dto.name];
    const tools = this._integrationManager.getAllTools();
    const rules = this._integrationManager.getAllRulesDescription();

    return {
      output: {
        rules: rules[integration.identifier],
        maxLength,
        settings: !schemas ? 'No additional settings required' : schemas,
        tools: tools[integration.identifier],
      },
    };
  }

  @Get('/posts/:id/missing')
  async getMissingContent(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.getMissingContent(org.id, id);
  }

  @Put('/posts/:id/settings')
  async updatePostSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdatePostSettingsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.updatePostSettings(
      org.id,
      id,
      body.settings,
      'API'
    );
  }

  @Put('/posts/:id/status')
  async changePostStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: ChangePostStatusDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.changePostStatus(org.id, id, body.status);
  }

  @Put('/posts/:id/release-id')
  async updateReleaseId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('releaseId') releaseId: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    // the batch only links the posts in the dashboard
    const { batchId, ...post } = await this._postsService.updateReleaseId(
      org.id,
      id,
      releaseId
    );
    return post;
  }

  @Get('/analytics/:integration')
  async getAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._integrationService.checkAnalytics(org, integration, date);
  }

  @Get('/analytics/post/:postId')
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Query('date') date: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.checkPostAnalytics(org.id, postId, +date);
  }

  @Post('/integration-trigger/:id')
  async triggerIntegrationTool(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { methodName: string; data: Record<string, string> }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const getIntegration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );

    if (!getIntegration) {
      throw new HttpException({ msg: 'Integration not found' }, 404);
    }

    const integrationProvider = socialIntegrationList.find(
      (p) => p.identifier === getIntegration.providerIdentifier
    )!;

    if (!integrationProvider) {
      throw new HttpException({ msg: 'Integration provider not found' }, 404);
    }

    const tools = this._integrationManager.getAllTools();
    if (
      // @ts-ignore
      !tools[integrationProvider.identifier]?.some(
        (p: any) => p.methodName === body.methodName
      ) ||
      // @ts-ignore
      !integrationProvider[body.methodName]
    ) {
      throw new HttpException({ msg: 'Tool not found' }, 404);
    }

    const result = await this._integrationService.callProviderFunction(
      getIntegration,
      body.methodName,
      body.data || {},
      { disconnectOnRefreshFailure: true }
    );

    if (result.status === 'ok') {
      return { output: result.data };
    }

    if (result.status === 'refreshFailed') {
      throw new HttpException(
        { msg: 'Channel disconnected due to expired token' },
        401
      );
    }

    throw new HttpException({ msg: 'Unexpected error' }, 500);
  }
}
