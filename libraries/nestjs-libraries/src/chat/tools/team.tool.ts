import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

const memberSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
});

@Injectable()
export class TeamTool implements AgentToolInterface {
  constructor(
    private _organizationService: OrganizationService,
    private _usersService: UsersService
  ) {}
  name = 'teamTool';
  mirrors = [
    'GET /settings/team',
    'POST /settings/team',
    'DELETE /settings/team/:id',
  ];
  optionalOnSelfHosted = true;
  // same limits as the team routes of the web app
  policies: AgentToolInterface['policies'] = [
    [AuthorizationActions.Create, Sections.TEAM_MEMBERS],
    [AuthorizationActions.Create, Sections.ADMIN],
  ];

  run() {
    return createTool({
      id: 'teamTool',
      mcp: {
        annotations: {
          title: 'Manage Team',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to manage the members of the organization (the team). It needs an admin of the organization and a plan that includes team members.
action "list": the members with their user "id", email and role (USER, ADMIN or SUPERADMIN).
action "invite": creates an invitation link for a new member, pass the "role" (USER or ADMIN) and "sendEmail". The link is valid for 2 days and is returned in "url", give it to the person who should join. With sendEmail true the invitation is also emailed to "email" (required then) in the name of the connected user, which needs a connection through OAuth. Nobody joins until the person opens the link, so confirm the role with the user first.
action "remove": removes the member with the given user "id" (list the team first to get it) from the organization. They lose access to the organization immediately, including the connections (OAuth) they approved. You cannot remove someone with a higher role than yours. Removing the connected user themselves ends this connection. It cannot be undone, so show the user which member will be removed and get their confirmation first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['list', 'invite', 'remove']),
        email: z
          .string()
          .email()
          .optional()
          .describe(
            'For "invite": the email of the person, required with sendEmail true'
          ),
        role: z
          .enum(['USER', 'ADMIN'])
          .optional()
          .describe('For "invite": the role of the new member'),
        sendEmail: z
          .boolean()
          .optional()
          .describe(
            'For "invite": send the invitation by email, false by default'
          ),
        id: z
          .string()
          .optional()
          .describe('For "remove": the user "id" of the member'),
      }),
      outputSchema: z.object({
        output: z
          .object({ members: z.array(memberSchema) })
          .or(z.object({ url: z.string() }))
          .or(z.object({ removed: z.object({ id: z.string() }) }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        // the whole organization is parsed: the invitation and the removal read
        // its name and the role of the caller (users[0].role)
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        try {
          if (inputData.action === 'list') {
            const team = await this._organizationService.getTeam(
              organization.id
            );
            return {
              output: {
                members: (team?.users || []).map((member) => ({
                  id: member.user.id,
                  email: member.user.email,
                  role: member.role,
                })),
              },
            };
          }

          if (inputData.action === 'remove') {
            if (!inputData.id) {
              return { output: { errors: 'The id of the member is required' } };
            }

            await this._organizationService.deleteTeamMember(
              organization,
              inputData.id
            );
            return { output: { removed: { id: inputData.id } } };
          }

          if (!inputData.role) {
            return { output: { errors: 'The role is required' } };
          }
          if (inputData.sendEmail && !inputData.email) {
            return {
              output: {
                errors: 'The email is required to send the invitation',
              },
            };
          }

          const userId = organization.users?.[0]?.userId;
          const inviter =
            inputData.sendEmail && userId
              ? await this._usersService.getUserById(userId)
              : null;

          return {
            output: await this._organizationService.inviteTeamMember(
              organization,
              inviter,
              {
                email: inputData.email as string,
                role: inputData.role,
                sendEmail: !!inputData.sendEmail,
              }
            ),
          };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to manage the team' },
          };
        }
      },
    });
  }
}
