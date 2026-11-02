import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class TeamAddMemberTool implements AgentToolInterface {
  constructor(
    private _organizationService: OrganizationService,
    private _usersService: UsersService
  ) {}
  name = 'teamAddMemberTool';
  mirrors = ['POST /settings/team/add'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'teamAddMemberTool',
      mcp: {
        annotations: {
          title: 'Add Existing Account To Team',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to add an account that already exists in Postiz to the organization by its email, without an invitation link. Only the super admin of the Postiz instance can do it (the operator of the installation), for everybody else the result contains output.errors with "Unauthorized". To invite a new person use teamTool (action invite).
The account is added at once with the given "role" (USER or ADMIN), so confirm the email and the role with the user first. The plan of the organization must include team members.
It acts as the connected user, so this needs a connection through OAuth, an API key has no user.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        email: z.string().email().describe('The email of the existing account'),
        role: z.enum(['USER', 'ADMIN']),
      }),
      outputSchema: z.object({
        output: z
          .object({ added: z.boolean() })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        try {
          const userId = organization.users?.[0]?.userId;
          const user = userId
            ? await this._usersService.getUserById(userId)
            : null;
          if (!user) {
            return {
              output: {
                errors:
                  'Adding an account is allowed per user, connect through OAuth instead of an API key',
              },
            };
          }

          // the super admin check is part of the service, like on the web
          return {
            output: await this._organizationService.addTeamMemberByEmail(
              organization,
              user,
              inputData
            ),
          };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to add the team member' },
          };
        }
      },
    });
  }
}
