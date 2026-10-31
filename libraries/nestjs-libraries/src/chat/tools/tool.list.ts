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
  ClippingWidgetTicketTool,
  GenerateImageTool,
  UploadFromUrlTool,
  MediaListTool,
  MediaStatusTool,
  UploadWidgetTool,
  UploadWidgetTicketTool,
  UploadWidgetStatusTool,
];
