import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class IntegrationUpdateTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationUpdateTool';
  mirrors = [
    'PUT /integrations/:id/custom-name',
    'POST /integrations/:id/settings',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'integrationUpdateTool',
      mcp: {
        annotations: {
          title: 'Update a Channel',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this to change a channel in Postiz. Get the channel "id" from integrationList.
action "rename": sets the name Postiz shows for the channel, pass "name". An empty "name" goes back to the name from the platform. It does not change the name on the social network (integrationProfileTool does).
action "saveSettings": replaces ALL the settings of the channel with "additionalSettings". Read the current ones with integrationGetTool first and send the whole list back with the changes, anything missing is removed. Show the user what will change and get their confirmation first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['rename', 'saveSettings']),
        id: z.string().describe('The "id" of the channel'),
        name: z.string().optional().describe('For "rename"'),
        additionalSettings: z
          .array(
            z.object({
              title: z.string(),
              description: z.string(),
              type: z.enum(['checkbox', 'text', 'textarea']),
              value: z.any(),
              regex: z.string().optional(),
            })
          )
          .optional()
          .describe('For "saveSettings": the complete list of settings'),
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
          if (inputData.action === 'rename') {
            if (inputData.name === undefined) {
              return { output: { errors: 'The name is required' } };
            }
            const { id } = await this._integrationService.updateCustomName(
              organizationId,
              inputData.id,
              inputData.name
            );
            return { output: { id } };
          }

          if (!inputData.additionalSettings) {
            return {
              output: { errors: 'The additionalSettings are required' },
            };
          }
          const { id } = await this._integrationService.updateProviderSettings(
            organizationId,
            inputData.id,
            JSON.stringify(inputData.additionalSettings)
          );
          return { output: { id } };
        } catch (err: any) {
          return {
            output: {
              errors:
                err?.code === 'P2025'
                  ? 'Channel not found, use integrationList to get a valid channel id'
                  : err?.message || 'Failed to update the channel',
            },
          };
        }
      },
    });
  }
}
