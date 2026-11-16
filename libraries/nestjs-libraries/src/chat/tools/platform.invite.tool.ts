import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import {
  checkAuth,
  toolErrorMessage,
} from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class PlatformInviteTool implements AgentToolInterface {
  constructor(
    private _organizationService: OrganizationService,
    private _usersService: UsersService
  ) {}
  name = 'platformInviteTool';
  mirrors = ['POST /admin/platform-invite'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'platformInviteTool',
      mcp: {
        annotations: {
          title: 'Invite To Platform',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this to invite a new person to create an account on the Postiz instance while registration is closed. Only the super admin of the instance (the operator of the installation) can do it, for everybody else the result contains output.errors with "Unauthorized". It acts as the connected user, so this needs a connection through OAuth, an API key has no user and is always refused.
It creates a one-time link valid for 2 days, returned in "url", that opens the sign-up and joins no organization (the person gets their own). Pass "sendEmail" true to also email it to "email" (required then) in the name of the connected user, otherwise give the link to the person yourself, it is a secret for them. Confirm the email with the user first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        email: z
          .string()
          .email()
          .optional()
          .describe('The email of the person, required with sendEmail true'),
        sendEmail: z
          .boolean()
          .optional()
          .describe('Send the invitation by email, false by default'),
      }),
      outputSchema: z.object({
        output: z
          .object({ url: z.string() })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        // the whole organization is parsed, the caller is read as users[0].userId
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        try {
          // the same super admin check as the web, on the user read from the database
          const userId = organization.users?.[0]?.userId;
          await this._usersService.assertSuperAdminById(userId);
          // the inviter's name and email go into the invitation email
          const user = await this._usersService.getUserById(userId);

          if (inputData.sendEmail && !inputData.email) {
            return {
              output: {
                errors: 'The email is required to send the invitation',
              },
            };
          }

          return {
            output: await this._organizationService.invitePlatform(user!, {
              email: inputData.email as string,
              sendEmail: !!inputData.sendEmail,
            }),
          };
        } catch (err: any) {
          return {
            output: {
              errors: toolErrorMessage(
                err,
                'Not found',
                'Failed to create the invitation'
              ),
            },
          };
        }
      },
    });
  }
}
