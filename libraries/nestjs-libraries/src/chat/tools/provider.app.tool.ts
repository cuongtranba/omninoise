import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { ProviderAppService } from '@gitroom/nestjs-libraries/database/prisma/provider-apps/provider.app.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

const familySchema = z.object({
  family: z.string(),
  instanceApp: z.boolean(),
  providers: z.array(
    z.object({
      identifier: z.string(),
      name: z.string(),
      redirectUri: z.string(),
    })
  ),
  app: z
    .object({
      id: z.string(),
      clientId: z.string(),
      updatedAt: z.string(),
      channels: z.number(),
    })
    .nullable(),
});

@Injectable()
export class ProviderAppTool implements AgentToolInterface {
  constructor(private _providerAppService: ProviderAppService) {}
  name = 'providerAppTool';
  // Saving an app is left to the Postiz app: its client secret is typed by an
  // admin there and never passes through an agent conversation
  mirrors = ['GET /provider-apps', 'DELETE /provider-apps/:family'];
  // same limit as the routes of the web app
  policies: AgentToolInterface['policies'] = [
    [AuthorizationActions.Create, Sections.ADMIN],
  ];

  run() {
    return createTool({
      id: 'providerAppTool',
      mcp: {
        annotations: {
          title: 'Manage Platform Apps',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to see or remove the organization's own developer apps for the platforms (Settings > Platform apps). New channels of a platform connect through the organization's app when it has one, otherwise through the server's app. It needs an admin of the organization.
action "list": every platform family that can have its own app: the providers it covers with the callback URL each one needs on the app, "instanceApp" (the server has an app too) and "app" (null when the organization has none: its client id and how many channels connect through it). The client secret is never returned.
action "delete": removes the organization's app of "family", so new channels connect through the server's app again. It is refused while channels connect through the app. It cannot be undone, so confirm with the user first.
An app can only be added or changed in the Postiz app, because its client secret must not pass through this conversation. If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['list', 'delete']),
        family: z
          .string()
          .optional()
          .describe('For "delete" (required): the "family" from "list"'),
      }),
      outputSchema: z.object({
        output: z
          .object({ families: z.array(familySchema) })
          .or(z.object({ deleted: z.boolean() }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          if (inputData.action === 'list') {
            const families =
              await this._providerAppService.list(organizationId);
            return {
              output: {
                families: families.map((f) => ({
                  ...f,
                  app: f.app
                    ? { ...f.app, updatedAt: f.app.updatedAt.toISOString() }
                    : null,
                })),
              },
            };
          }

          if (!inputData.family) {
            return { output: { errors: 'The family is required' } };
          }

          await this._providerAppService.delete(
            organizationId,
            inputData.family
          );
          return { output: { deleted: true } };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to manage the platform app',
            },
          };
        }
      },
    });
  }
}
