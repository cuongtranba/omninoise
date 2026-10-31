import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
  tier: z.string().nullable(),
});

@Injectable()
export class UserOrganizationsTool implements AgentToolInterface {
  constructor(private _organizationService: OrganizationService) {}
  name = 'userOrganizationsTool';
  mirrors = ['GET /user/organizations', 'POST /user/join-org'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'userOrganizationsTool',
      mcp: {
        annotations: {
          title: 'My Organizations',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this for the organizations the connected user belongs to. This connection works in one organization only, it cannot be switched here. It is about the user who connected, so this needs a connection through OAuth, an API key has no user.
action "list": the organizations of the user (the ones they were not disabled in), with the role of the user and the plan tier of each.
action "join": the user accepts an invitation, pass the invitation link (or the code of its "org" parameter) in "invite". The invitation is a secret meant for this user, only use one the user gave you. "joined" is false when the invitation is invalid, expired, already used or the plan of the organization has no room, nothing changes then. Joining adds the user to the organization with the role of the invitation, so confirm with the user first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['list', 'join']),
        invite: z
          .string()
          .optional()
          .describe('For "join": the invitation link or its code'),
      }),
      outputSchema: z.object({
        output: z
          .object({ organizations: z.array(organizationSchema) })
          .or(
            z.object({
              joined: z.boolean(),
              organizationId: z.string().nullable(),
            })
          )
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        const userId = organization.users?.[0]?.userId;
        if (!userId) {
          return {
            output: {
              errors:
                'The organizations belong to a user, connect through OAuth instead of an API key',
            },
          };
        }

        try {
          if (inputData.action === 'join') {
            if (!inputData.invite) {
              return { output: { errors: 'The invite is required' } };
            }
            const { id } = await this._organizationService.joinOrg(
              userId,
              inputData.invite
            );
            return { output: { joined: !!id, organizationId: id } };
          }

          return {
            output: {
              organizations: (
                await this._organizationService.getUserOrganizations(userId)
              ).map((current) => ({
                id: current.id,
                name: current.name,
                role: current.users[0]?.role,
                tier: current.subscription?.subscriptionTier ?? null,
              })),
            },
          };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to manage the organizations',
            },
          };
        }
      },
    });
  }
}
