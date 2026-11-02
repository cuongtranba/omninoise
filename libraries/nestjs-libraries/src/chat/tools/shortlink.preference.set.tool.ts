import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { ShortLinkPreference } from '@prisma/client';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

@Injectable()
export class ShortlinkPreferenceSetTool implements AgentToolInterface {
  constructor(private _organizationService: OrganizationService) {}
  name = 'shortlinkPreferenceSetTool';
  mirrors = ['POST /settings/shortlink'];
  optionalOnSelfHosted = true;
  // same limit as the route of the web app
  policies: AgentToolInterface['policies'] = [
    [AuthorizationActions.Create, Sections.ADMIN],
  ];

  run() {
    return createTool({
      id: 'shortlinkPreferenceSetTool',
      mcp: {
        annotations: {
          title: 'Set Short Link Preference',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this to set what the organization wants done with the links of a post: "ASK" (ask every time), "YES" (always shorten them) or "NO" (never shorten them). It needs an admin of the organization and applies to every user of it, so confirm the choice with the user first. Read the current one with shortlinkPreferenceGetTool.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        shortlink: z.nativeEnum(ShortLinkPreference),
      }),
      outputSchema: z.object({
        output: z
          .object({ shortlink: z.nativeEnum(ShortLinkPreference) })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          const organization =
            await this._organizationService.updateShortlinkPreference(
              organizationId,
              inputData.shortlink
            );
          return { output: { shortlink: organization.shortlink } };
        } catch (err: any) {
          return {
            output: {
              errors:
                err?.message || 'Failed to save the short link preference',
            },
          };
        }
      },
    });
  }
}
