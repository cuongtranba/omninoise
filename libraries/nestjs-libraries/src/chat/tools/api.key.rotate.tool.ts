import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

@Injectable()
export class ApiKeyRotateTool implements AgentToolInterface {
  constructor(private _organizationService: OrganizationService) {}
  name = 'apiKeyRotateTool';
  mirrors = ['POST /user/api-key/rotate'];
  optionalOnSelfHosted = true;
  // same limit as the route of the web app
  policies: AgentToolInterface['policies'] = [
    [AuthorizationActions.Create, Sections.ADMIN],
  ];

  run() {
    return createTool({
      id: 'apiKeyRotateTool',
      mcp: {
        annotations: {
          title: 'Rotate API Key',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to replace the API key of the organization (the one of the public API and of the MCP connections that use a key) with a new one. It needs an admin of the organization.
The old key stops working immediately, everywhere: every integration, script and MCP connection that uses it breaks until it is given the new key. If this connection itself was made with that API key, it stops working too, and the new key is the only way back in. The new key is returned once as "apiKey", it is a secret: give it only to the user, never write it anywhere else.
It cannot be undone, so tell the user what will stop working and get their confirmation first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({}),
      outputSchema: z.object({
        output: z
          .object({ apiKey: z.string() })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          const organization = await this._organizationService.updateApiKey(
            organizationId
          );
          // the route of the web app answers with the whole organization, only the key is needed
          return { output: { apiKey: organization.apiKey as string } };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to rotate the API key' },
          };
        }
      },
    });
  }
}
