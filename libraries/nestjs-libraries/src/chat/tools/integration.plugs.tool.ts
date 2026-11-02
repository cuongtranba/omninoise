import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class IntegrationPlugsTool implements AgentToolInterface {
  constructor(
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager
  ) {}
  name = 'integrationPlugsTool';
  mirrors = [
    'GET /integrations/plug/list',
    'GET /integrations/:identifier/internal-plugs',
    'GET /integrations/:id/plugs',
    'POST /integrations/:id/plugs',
    'PUT /integrations/plugs/:id/activate',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'integrationPlugsTool',
      mcp: {
        annotations: {
          title: 'Manage Channel Plugs',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this to manage the plugs of the channels. A plug is an automation Postiz runs on a channel after it publishes, for example liking or reposting posts.
action "available": every plug that can be set up, by platform. Each plug has a "methodName" (the "func" of "save") and the "fields" it needs.
action "internal": the plugs that publish a post from another channel when a post of this channel goes out, for the platform "provider" (its "identifier" from integrationProvidersTool).
action "list": the plugs already set up on the channel "id" (integrationList), each with its "id" and if it is "activated".
action "save": sets up (or changes) the plug "func" on the channel "id" with "fields", a list of { name, value } for the fields of that plug. It replaces the previous values and runs against the real account, so show the user the values and get their confirmation first.
action "activate": turns the plug with the given "plugId" (from "list") on or off with "activated".
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['available', 'internal', 'list', 'save', 'activate']),
        provider: z
          .string()
          .optional()
          .describe('For "internal": the identifier of the platform'),
        id: z
          .string()
          .optional()
          .describe('For "list" and "save": the "id" of the channel'),
        func: z
          .string()
          .optional()
          .describe(
            'For "save": the "methodName" of the plug from "available"'
          ),
        fields: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .optional()
          .describe('For "save": the values of the fields of the plug'),
        plugId: z
          .string()
          .optional()
          .describe('For "activate": the "id" of the plug from "list"'),
        activated: z.boolean().optional().describe('For "activate"'),
      }),
      outputSchema: z.object({
        output: z
          .object({ plugs: z.array(z.record(z.string(), z.any())) })
          .or(
            z.object({ internalPlugs: z.array(z.record(z.string(), z.any())) })
          )
          .or(
            z.object({
              channelPlugs: z.array(
                z.object({
                  id: z.string(),
                  func: z.string(),
                  activated: z.boolean(),
                  fields: z.array(
                    z.object({ name: z.string(), value: z.string() })
                  ),
                })
              ),
            })
          )
          .or(z.object({ id: z.string() }))
          .or(z.object({ activated: z.boolean() }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          if (inputData.action === 'available') {
            return {
              output: { plugs: this._integrationManager.getAllPlugs() },
            };
          }

          if (inputData.action === 'internal') {
            if (!inputData.provider) {
              return { output: { errors: 'The provider is required' } };
            }
            return {
              output: this._integrationManager.getInternalPlugs(
                inputData.provider
              ),
            };
          }

          if (inputData.action === 'activate') {
            if (!inputData.plugId || inputData.activated === undefined) {
              return {
                output: { errors: 'The plugId and activated are required' },
              };
            }
            return {
              output: await this._integrationService.changePlugActivation(
                organizationId,
                inputData.plugId,
                inputData.activated
              ),
            };
          }

          if (!inputData.id) {
            return { output: { errors: 'The channel id is required' } };
          }

          if (inputData.action === 'list') {
            return {
              output: {
                channelPlugs: (
                  await this._integrationService.getPlugsByIntegrationId(
                    organizationId,
                    inputData.id
                  )
                ).map((p) => ({
                  id: p.id,
                  func: p.plugFunction,
                  activated: p.activated,
                  fields: JSON.parse(p.data),
                })),
              },
            };
          }

          if (!inputData.func || !inputData.fields) {
            return { output: { errors: 'The func and fields are required' } };
          }
          return {
            output: await this._integrationService.createOrUpdatePlug(
              organizationId,
              inputData.id,
              { func: inputData.func, fields: inputData.fields }
            ),
          };
        } catch (err: any) {
          return {
            output: {
              errors:
                err?.code === 'P2025'
                  ? 'Not found, use the list action to get a valid plug id'
                  : err?.message || 'Failed to manage the plugs',
            },
          };
        }
      },
    });
  }
}
