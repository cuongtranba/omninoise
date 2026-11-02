import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class IntegrationMentionsTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationMentionsTool';
  mirrors = ['POST /integrations/mentions'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'integrationMentionsTool',
      mcp: {
        annotations: {
          title: 'Find Accounts to Mention',
          // the accounts it finds are remembered by Postiz for the next search
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      description: `
Use this to find the accounts of a social platform that a post can mention (the @mention picker of the editor). Pass the "id" of the channel the post is for (integrationList) and what the user typed in "query", a name or a handle.
Each result has an "id" (the handle to write in the mention), a "label" (the display name) and an "image". When the result is { none: true } the platform of that channel has no mentions.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        id: z.string().describe('The "id" of the channel from integrationList'),
        query: z.string().describe('A name or handle to search'),
      }),
      outputSchema: z.object({
        output: z
          .array(
            z.object({
              id: z.string(),
              label: z.string(),
              image: z.string().optional(),
            })
          )
          .or(z.object({ none: z.literal(true) }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          const mentions = await this._integrationService.mentions(
            organizationId,
            inputData.id,
            { query: inputData.query }
          );
          return {
            output: Array.isArray(mentions)
              ? mentions.map(({ id, label, image }) => ({ id, label, image }))
              : mentions,
          };
        } catch (err: any) {
          return {
            output: {
              errors:
                err?.message === 'Invalid integration'
                  ? 'Channel not found, use integrationList to get a valid channel id'
                  : err?.message || 'Failed to search the mentions',
            },
          };
        }
      },
    });
  }
}
