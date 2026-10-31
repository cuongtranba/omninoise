import { IntegrationValidationTool } from '@gitroom/nestjs-libraries/chat/tools/integration.validation.tool';
import { IntegrationTriggerTool } from '@gitroom/nestjs-libraries/chat/tools/integration.trigger.tool';
import { IntegrationSchedulePostTool } from './integration.schedule.post';
import { GenerateVideoOptionsTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.options.tool';
import { VideoFunctionTool } from '@gitroom/nestjs-libraries/chat/tools/video.function.tool';
import { GenerateVideoTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.tool';
import { VideoStatusTool } from '@gitroom/nestjs-libraries/chat/tools/video.status.tool';
import { ClippingTool } from '@gitroom/nestjs-libraries/chat/tools/clipping.tool';
import { ClippingStatusTool } from '@gitroom/nestjs-libraries/chat/tools/clipping.status.tool';
import { ClippingWidgetTicketTool } from '@gitroom/nestjs-libraries/chat/tools/clipping.widget.ticket.tool';
import { GenerateImageTool } from '@gitroom/nestjs-libraries/chat/tools/generate.image.tool';
import { IntegrationListTool } from '@gitroom/nestjs-libraries/chat/tools/integration.list.tool';
import { GroupListTool } from '@gitroom/nestjs-libraries/chat/tools/group.list.tool';
import { UploadFromUrlTool } from '@gitroom/nestjs-libraries/chat/tools/upload.from.url.tool';
import { MediaListTool } from '@gitroom/nestjs-libraries/chat/tools/media.list.tool';
import { MediaStatusTool } from '@gitroom/nestjs-libraries/chat/tools/media.status.tool';
import { PostsListTool } from '@gitroom/nestjs-libraries/chat/tools/posts.list.tool';
import { PostSettingsTool } from '@gitroom/nestjs-libraries/chat/tools/post.settings.tool';
import { DeletePostTool } from '@gitroom/nestjs-libraries/chat/tools/delete.post.tool';
import { UploadWidgetTool } from '@gitroom/nestjs-libraries/chat/tools/upload.widget.tool';
import { UploadWidgetTicketTool } from '@gitroom/nestjs-libraries/chat/tools/upload.widget.ticket.tool';
import { UploadWidgetStatusTool } from '@gitroom/nestjs-libraries/chat/tools/upload.widget.status.tool';
import { PostGetTool } from '@gitroom/nestjs-libraries/chat/tools/post.get.tool';
import { PostsBrowseTool } from '@gitroom/nestjs-libraries/chat/tools/posts.browse.tool';
import { PostStatisticsTool } from '@gitroom/nestjs-libraries/chat/tools/post.statistics.tool';
import { PostReleaseTool } from '@gitroom/nestjs-libraries/chat/tools/post.release.tool';
import { PostCommentsTool } from '@gitroom/nestjs-libraries/chat/tools/post.comments.tool';
import { PostTagsTool } from '@gitroom/nestjs-libraries/chat/tools/post.tags.tool';
import { PostFindSlotTool } from '@gitroom/nestjs-libraries/chat/tools/post.find.slot.tool';
import { PostValidateTool } from '@gitroom/nestjs-libraries/chat/tools/post.validate.tool';
import { PostGeneratorTool } from '@gitroom/nestjs-libraries/chat/tools/post.generator.tool';
import { PostGeneratorDraftTool } from '@gitroom/nestjs-libraries/chat/tools/post.generator.draft.tool';
import { PostChangeDateTool } from '@gitroom/nestjs-libraries/chat/tools/post.change.date.tool';
import { PostSeparateTool } from '@gitroom/nestjs-libraries/chat/tools/post.separate.tool';
import { IntegrationProvidersTool } from '@gitroom/nestjs-libraries/chat/tools/integration.providers.tool';
import { IntegrationConnectTool } from '@gitroom/nestjs-libraries/chat/tools/integration.connect.tool';
import { IntegrationGetTool } from '@gitroom/nestjs-libraries/chat/tools/integration.get.tool';
import { IntegrationUpdateTool } from '@gitroom/nestjs-libraries/chat/tools/integration.update.tool';
import { IntegrationGroupTool } from '@gitroom/nestjs-libraries/chat/tools/integration.group.tool';
import { IntegrationProfileTool } from '@gitroom/nestjs-libraries/chat/tools/integration.profile.tool';
import { IntegrationTimesTool } from '@gitroom/nestjs-libraries/chat/tools/integration.times.tool';
import { IntegrationStateTool } from '@gitroom/nestjs-libraries/chat/tools/integration.state.tool';
import { IntegrationMentionsTool } from '@gitroom/nestjs-libraries/chat/tools/integration.mentions.tool';
import { IntegrationPlugsTool } from '@gitroom/nestjs-libraries/chat/tools/integration.plugs.tool';
import { AnalyticsTool } from '@gitroom/nestjs-libraries/chat/tools/analytics.tool';
import { MediaManageTool } from '@gitroom/nestjs-libraries/chat/tools/media.manage.tool';
import { ClippingListTool } from '@gitroom/nestjs-libraries/chat/tools/clipping.list.tool';
import { CopilotThreadsTool } from '@gitroom/nestjs-libraries/chat/tools/copilot.threads.tool';
import { AiCreditsTool } from '@gitroom/nestjs-libraries/chat/tools/ai.credits.tool';
import { NotificationsTool } from '@gitroom/nestjs-libraries/chat/tools/notifications.tool';
import { TeamTool } from '@gitroom/nestjs-libraries/chat/tools/team.tool';
import { TeamAddMemberTool } from '@gitroom/nestjs-libraries/chat/tools/team.add.member.tool';
import { ShortlinkPreferenceGetTool } from '@gitroom/nestjs-libraries/chat/tools/shortlink.preference.get.tool';
import { ShortlinkPreferenceSetTool } from '@gitroom/nestjs-libraries/chat/tools/shortlink.preference.set.tool';
import { UserAccountTool } from '@gitroom/nestjs-libraries/chat/tools/user.account.tool';
import { ApiKeyRotateTool } from '@gitroom/nestjs-libraries/chat/tools/api.key.rotate.tool';
import { SubscriptionTool } from '@gitroom/nestjs-libraries/chat/tools/subscription.tool';
import { UserOrganizationsTool } from '@gitroom/nestjs-libraries/chat/tools/user.organizations.tool';
import { AccountDeleteTool } from '@gitroom/nestjs-libraries/chat/tools/account.delete.tool';
import { OAuthAppTool } from '@gitroom/nestjs-libraries/chat/tools/oauth.app.tool';
import { ApprovedAppsTool } from '@gitroom/nestjs-libraries/chat/tools/approved.apps.tool';
import { SignaturesTool } from '@gitroom/nestjs-libraries/chat/tools/signatures.tool';
import { SetsTool } from '@gitroom/nestjs-libraries/chat/tools/sets.tool';
import { AutopostTool } from '@gitroom/nestjs-libraries/chat/tools/autopost.tool';
import { AutopostCreateTool } from '@gitroom/nestjs-libraries/chat/tools/autopost.create.tool';
import { WebhooksTool } from '@gitroom/nestjs-libraries/chat/tools/webhooks.tool';
import { WebhookCreateTool } from '@gitroom/nestjs-libraries/chat/tools/webhook.create.tool';
import { ThirdPartyTool } from '@gitroom/nestjs-libraries/chat/tools/third.party.tool';

export const toolList = [
  IntegrationListTool,
  IntegrationProvidersTool,
  IntegrationConnectTool,
  IntegrationGetTool,
  IntegrationUpdateTool,
  IntegrationGroupTool,
  IntegrationProfileTool,
  IntegrationTimesTool,
  IntegrationStateTool,
  IntegrationMentionsTool,
  IntegrationPlugsTool,
  AnalyticsTool,
  GroupListTool,
  IntegrationValidationTool,
  IntegrationTriggerTool,
  IntegrationSchedulePostTool,
  PostsListTool,
  PostSettingsTool,
  DeletePostTool,
  PostGetTool,
  PostsBrowseTool,
  PostStatisticsTool,
  PostReleaseTool,
  PostCommentsTool,
  PostTagsTool,
  PostFindSlotTool,
  PostValidateTool,
  PostGeneratorTool,
  PostGeneratorDraftTool,
  PostChangeDateTool,
  PostSeparateTool,
  GenerateVideoOptionsTool,
  VideoFunctionTool,
  GenerateVideoTool,
  VideoStatusTool,
  ClippingTool,
  ClippingStatusTool,
  ClippingListTool,
  ClippingWidgetTicketTool,
  GenerateImageTool,
  UploadFromUrlTool,
  MediaListTool,
  MediaStatusTool,
  MediaManageTool,
  UploadWidgetTool,
  UploadWidgetTicketTool,
  UploadWidgetStatusTool,
  AiCreditsTool,
  CopilotThreadsTool,
  NotificationsTool,
  TeamTool,
  TeamAddMemberTool,
  ShortlinkPreferenceGetTool,
  ShortlinkPreferenceSetTool,
  UserAccountTool,
  ApiKeyRotateTool,
  SubscriptionTool,
  UserOrganizationsTool,
  AccountDeleteTool,
  OAuthAppTool,
  ApprovedAppsTool,
  SignaturesTool,
  SetsTool,
  AutopostTool,
  AutopostCreateTool,
  WebhooksTool,
  WebhookCreateTool,
  ThirdPartyTool,
];
