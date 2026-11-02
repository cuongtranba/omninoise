import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class IntegrationTimesTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationTimesTool';
  mirrors = ['POST /integrations/:id/time'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'integrationTimesTool',
      mcp: {
        annotations: {
          title: 'Set Posting Times',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this to set the posting times of a channel, the times of day Postiz suggests for new posts of that channel (postFindSlotTool uses them). It replaces ALL the times of the channel: read the current ones with integrationGetTool first and send the whole list with the changes.
Times are in UTC, convert from the user's timezone. Show the user the new list and get their confirmation first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        id: z.string().describe('The "id" of the channel from integrationList'),
        times: z
          .array(
            z.object({
              hour: z.number().int().min(0).max(23),
              minute: z.number().int().min(0).max(59),
            })
          )
          .describe('The complete list of posting times, in UTC'),
      }),
      outputSchema: z.object({
        output: z
          .object({ id: z.string() })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          const { id } = await this._integrationService.setTimes(
            organizationId,
            inputData.id,
            {
              time: inputData.times.map(({ hour, minute }) => ({
                time: hour * 60 + minute,
              })),
            }
          );
          return { output: { id } };
        } catch (err: any) {
          return {
            output: {
              errors:
                err?.code === 'P2025'
                  ? 'Channel not found, use integrationList to get a valid channel id'
                  : err?.message || 'Failed to set the posting times',
            },
          };
        }
      },
    });
  }
}
