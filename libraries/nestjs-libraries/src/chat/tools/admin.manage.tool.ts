import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import {
  checkAuth,
  toolErrorMessage,
} from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class AdminManageTool implements AgentToolInterface {
  constructor(
    private _usersService: UsersService,
    private _organizationService: OrganizationService
  ) {}
  name = 'adminManageTool';
  mirrors = [
    'POST /admin/organizations/:id/members',
    'PUT /admin/organizations/:id/members/:userId',
    'DELETE /admin/organizations/:id/members/:userId',
    'DELETE /admin/organizations/:id',
    'POST /admin/organizations/:id/restore',
    'PUT /admin/users/:id/access',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'adminManageTool',
      mcp: {
        annotations: {
          title: 'Instance Admin (Manage)',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to manage the organizations and accounts of the whole Postiz instance. Only the super admin of the instance (the operator of the installation) can use it, for everybody else the result contains output.errors with "Unauthorized". It acts as the connected user, so this needs a connection through OAuth, an API key has no user and is always refused. Find the ids with adminTool ("listOrganizations", "getOrganization", "listUsers") and confirm every change with the user first.
action "addMember": adds the existing account with "email" to "organizationId" with "role" (USER, ADMIN or SUPERADMIN for an owner), without an invitation and without the plan limits.
action "updateMember": changes the "role" of the member "userId" of "organizationId" and/or disables or enables their access to it with "disabled". A plan change can enable a disabled membership again, use "setUserAccess" for a durable block.
action "removeMember": removes the member "userId" from "organizationId". An organization always keeps at least one owner (SUPERADMIN), so its last owner can be neither demoted nor removed.
action "deleteOrganization": deletes "organizationId" (it can be restored) and disables its enabled channels. Billing is not changed.
action "restoreOrganization": restores the deleted "organizationId" and enables again the channels its deletion disabled.
action "setUserAccess": blocks ("disabled" true) or unblocks ("disabled" false) the whole account "userId": a blocked account can no longer sign in, use the app or use its MCP connections. Blocking your own account is refused.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum([
          'addMember',
          'updateMember',
          'removeMember',
          'deleteOrganization',
          'restoreOrganization',
          'setUserAccess',
        ]),
        organizationId: z
          .string()
          .optional()
          .describe(
            'The id of the organization, for every action but "setUserAccess"'
          ),
        userId: z
          .string()
          .optional()
          .describe(
            'For "updateMember", "removeMember" and "setUserAccess": the id of the user'
          ),
        email: z
          .string()
          .email()
          .optional()
          .describe('For "addMember": the email of the existing account'),
        role: z
          .nativeEnum(Role)
          .optional()
          .describe('For "addMember" (required) and "updateMember": the role'),
        disabled: z
          .boolean()
          .optional()
          .describe(
            'For "updateMember": disable the membership; for "setUserAccess" (required): block the account'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({ id: z.string() })
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
          const requesterId = organization.users?.[0]?.userId;
          await this._usersService.assertSuperAdminById(requesterId);

          if (inputData.action === 'setUserAccess') {
            if (!inputData.userId || inputData.disabled === undefined) {
              return {
                output: { errors: 'The userId and disabled are required' },
              };
            }
            return {
              output: await this._usersService.setUserAccess(
                requesterId,
                inputData.userId,
                inputData.disabled
              ),
            };
          }

          if (!inputData.organizationId) {
            return { output: { errors: 'The organizationId is required' } };
          }
          const orgId = inputData.organizationId;

          if (inputData.action === 'deleteOrganization') {
            return {
              output:
                await this._organizationService.adminDeleteOrganization(orgId),
            };
          }

          if (inputData.action === 'restoreOrganization') {
            return {
              output:
                await this._organizationService.adminRestoreOrganization(orgId),
            };
          }

          if (inputData.action === 'addMember') {
            if (!inputData.email || !inputData.role) {
              return { output: { errors: 'The email and role are required' } };
            }
            return {
              output: await this._organizationService.adminAddMember(orgId, {
                email: inputData.email,
                role: inputData.role,
              }),
            };
          }

          if (!inputData.userId) {
            return { output: { errors: 'The userId is required' } };
          }

          if (inputData.action === 'removeMember') {
            return {
              output: await this._organizationService.adminRemoveMember(
                orgId,
                inputData.userId
              ),
            };
          }

          return {
            output: await this._organizationService.adminUpdateMember(
              orgId,
              inputData.userId,
              { role: inputData.role, disabled: inputData.disabled }
            ),
          };
        } catch (err: any) {
          return {
            output: {
              errors: toolErrorMessage(
                err,
                'Not found',
                'Failed to change the organization or the account'
              ),
            },
          };
        }
      },
    });
  }
}
