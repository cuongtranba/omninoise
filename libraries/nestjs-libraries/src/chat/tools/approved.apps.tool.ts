import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import {
  checkAuth,
  toolErrorMessage,
} from '@gitroom/nestjs-libraries/chat/auth.context';

const approvedAppSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  picture: z.string().nullable(),
  organizationId: z.string(),
  approvedAt: z.string(),
});

@Injectable()
export class ApprovedAppsTool implements AgentToolInterface {
  constructor(private _oauthService: OAuthService) {}
  name = 'approvedAppsTool';
  mirrors = ['GET /user/approved-apps', 'DELETE /user/approved-apps/:id'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'approvedAppsTool',
      mcp: {
        annotations: {
          title: 'Manage Approved Apps',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this for the apps the connected user allowed to act for them in Postiz through OAuth (AI assistants, integrations). It is about the user who connected, so this needs a connection through OAuth, an API key has no user.
action "list": the approved apps with their "id" (the approval, not the app), name, description, the organization they act in and when they were approved. No tokens are returned.
action "revoke": takes back the approval with the given "id" (list them first to get it). The app stops working immediately. If it is the app this very connection was made with, this connection stops working too. Only the approvals of the connected user can be revoked. The user can approve the app again later, but you cannot undo it, so show the user which app will be revoked and get their confirmation first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['list', 'revoke']),
        id: z
          .string()
          .optional()
          .describe('For "revoke": the "id" of the approved app'),
      }),
      outputSchema: z.object({
        output: z
          .object({ apps: z.array(approvedAppSchema) })
          .or(z.object({ revoked: z.object({ id: z.string() }) }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        // the whole organization is parsed, the approvals are read as users[0].userId
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        const userId = organization.users?.[0]?.userId;

        if (!userId) {
          return {
            output: {
              errors:
                'The approved apps belong to a user, connect through OAuth instead of an API key',
            },
          };
        }

        try {
          if (inputData.action === 'list') {
            // the rows hold the tokens of the approval, only these fields are returned
            return {
              output: {
                apps: (await this._oauthService.getApprovedApps(userId)).map(
                  (approval) => ({
                    id: approval.id,
                    name: approval.oauthApp.name,
                    description: approval.oauthApp.description,
                    picture: approval.oauthApp.picture?.path ?? null,
                    organizationId: approval.organizationId,
                    approvedAt: approval.createdAt.toISOString(),
                  })
                ),
              },
            };
          }

          if (!inputData.id) {
            return { output: { errors: 'The id is required' } };
          }
          await this._oauthService.revokeApp(userId, inputData.id);
          return { output: { revoked: { id: inputData.id } } };
        } catch (err: any) {
          return {
            output: {
              errors: toolErrorMessage(
                err,
                'The approved app was not found',
                'Failed to manage the approved apps'
              ),
            },
          };
        }
      },
    });
  }
}
