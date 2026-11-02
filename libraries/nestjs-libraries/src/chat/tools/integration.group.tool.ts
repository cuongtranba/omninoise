import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class IntegrationGroupTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationGroupTool';
  mirrors = [
    'PUT /integrations/:id/group',
    'PUT /integrations/:id/customer-name',
    'PUT /integrations/customers/:id',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'integrationGroupTool',
      mcp: {
        annotations: {
          title: 'Manage Channel Groups',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this to organize channels in groups (also called customers). The groups are listed by groupList, the group of a channel is in integrationGetTool.
action "assign": puts the channel with "id" in the existing group "groupId" (from groupList). Without "groupId" the channel is taken out of its group.
action "assignByName": puts the channel with "id" in the group called "name", the group is created when it does not exist. Without "name" the channel is taken out of its group.
action "rename": renames the group "groupId" (from groupList) to "name", the name must be new.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['assign', 'assignByName', 'rename']),
        id: z
          .string()
          .optional()
          .describe('For "assign" and "assignByName": the "id" of the channel'),
        groupId: z
          .string()
          .optional()
          .describe('For "assign" and "rename": the "id" of the group'),
        name: z
          .string()
          .optional()
          .describe('For "assignByName" and "rename": the name of the group'),
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
            if (!inputData.groupId || !inputData.name) {
              return {
                output: { errors: 'The groupId and the name are required' },
              };
            }
            const { id } = await this._integrationService.updateCustomerName(
              organizationId,
              inputData.groupId,
              inputData.name
            );
            return { output: { id } };
          }

          if (!inputData.id) {
            return { output: { errors: 'The channel id is required' } };
          }
          const { id } =
            inputData.action === 'assign'
              ? await this._integrationService.updateIntegrationGroup(
                  organizationId,
                  inputData.id,
                  inputData.groupId || ''
                )
              : await this._integrationService.updateOnCustomerName(
                  organizationId,
                  inputData.id,
                  inputData.name || ''
                );
          return { output: { id } };
        } catch (err: any) {
          return {
            output: {
              errors:
                err?.code === 'P2025'
                  ? 'Not found, use integrationList and groupList to get valid ids'
                  : err?.message || 'Failed to update the group',
            },
          };
        }
      },
    });
  }
}
