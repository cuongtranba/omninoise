import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class IntegrationStateTool implements AgentToolInterface {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService
  ) {}
  name = 'integrationStateTool';
  mirrors = [
    'POST /integrations/disable',
    'POST /integrations/enable',
    'DELETE /integrations',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'integrationStateTool',
      mcp: {
        annotations: {
          title: 'Enable, Disable or Delete a Channel',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to enable, disable or delete a channel. Get the channel "id" from integrationList ("disabled" says if it is disabled).
action "disable": stops posting to the channel and frees its place in the channels limit of the plan, the channel stays in Postiz and can be enabled again.
action "enable": enables a disabled channel again. It counts against the channels limit of the plan and fails when the limit is reached.
action "delete": deletes the channel AND all its posts, scheduled ones will not be published. It cannot be undone (the user would have to connect the channel again). Show the user which channel and how many posts it has (postsListTool) and get their confirmation first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['enable', 'disable', 'delete']),
        id: z.string().describe('The "id" of the channel'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            id: z.string(),
            state: z.enum(['enabled', 'disabled', 'deleted']),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        try {
          if (inputData.action === 'delete') {
            await this._postsService.deleteChannelWithPosts(
              organization.id,
              inputData.id
            );
            return { output: { id: inputData.id, state: 'deleted' as const } };
          }

          if (inputData.action === 'disable') {
            await this._integrationService.disableChannel(
              organization.id,
              inputData.id
            );
            return { output: { id: inputData.id, state: 'disabled' as const } };
          }

          await this._integrationService.enableChannelForOrganization(
            organization,
            inputData.id
          );
          return { output: { id: inputData.id, state: 'enabled' as const } };
        } catch (err: any) {
          return {
            output: {
              errors:
                err?.code === 'P2025'
                  ? 'Channel not found, use integrationList to get a valid channel id'
                  : err?.message || 'Failed to change the channel',
            },
          };
        }
      },
    });
  }
}
