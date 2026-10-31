import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

const infoSchema = z.object({
  hasSubscription: z.boolean(),
  hasAdditionalMembers: z.boolean(),
});

@Injectable()
export class AccountDeleteTool implements AgentToolInterface {
  constructor(private _usersService: UsersService) {}
  name = 'accountDeleteTool';
  mirrors = ['GET /user/delete-account-info', 'POST /user/delete-account'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'accountDeleteTool',
      mcp: {
        annotations: {
          title: 'Delete My Account',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this to delete the account of the connected user. It is about the user who connected, so this needs a connection through OAuth, an API key has no user.
action "info": what deleting the account takes with it, call it first. "hasSubscription": the user owns an organization with a subscription, which is cancelled. "hasAdditionalMembers": the user owns an organization with other members, who are removed from it.
action "delete": deletes the account for good. Every organization the user owns alone is deleted with its channels, posts and media, the user leaves the others, their login is removed and this connection stops working. It cannot be undone. Like the Delete Account button of the app, it only goes ahead after the user confirmed: read the "info" first, tell the user what will be deleted (the account, the organizations, channels and posts, the subscription if "hasSubscription", the other members if "hasAdditionalMembers"), and only when they clearly said yes call "delete" with "confirm" true and "hasSubscription" and "hasAdditionalMembers" exactly as "info" returned them. Nothing is deleted if they differ from the current ones.
If something fails (for example the subscription could not be cancelled, then nothing is deleted), the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['info', 'delete']),
        confirm: z
          .boolean()
          .optional()
          .describe('For "delete": true once the user confirmed the deletion'),
        hasSubscription: z
          .boolean()
          .optional()
          .describe('For "delete": the value "info" returned'),
        hasAdditionalMembers: z
          .boolean()
          .optional()
          .describe('For "delete": the value "info" returned'),
      }),
      outputSchema: z.object({
        output: infoSchema
          .or(z.object({ deleted: z.boolean() }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        // the whole organization is parsed, the account is read as users[0].userId
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        const userId = organization.users?.[0]?.userId;

        if (!userId) {
          return {
            output: {
              errors:
                'The account belongs to a user, connect through OAuth instead of an API key',
            },
          };
        }

        try {
          const info = await this._usersService.getDeleteAccountInfo(userId);
          if (inputData.action === 'info') {
            return { output: info };
          }

          if (
            inputData.confirm !== true ||
            inputData.hasSubscription !== info.hasSubscription ||
            inputData.hasAdditionalMembers !== info.hasAdditionalMembers
          ) {
            return {
              output: {
                errors:
                  'The deletion was not confirmed for what it takes with it. Call the action "info", tell the user, and pass confirm true with the hasSubscription and hasAdditionalMembers it returned. Nothing was deleted',
              },
            };
          }

          await this._usersService.cancelBillingAndDeleteAccount(
            userId,
            !!organization.users?.[0]?.impersonating
          );
          return { output: { deleted: true } };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to delete the account' },
          };
        }
      },
    });
  }
}
