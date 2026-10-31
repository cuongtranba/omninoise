import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { ShortLinkPreference } from '@prisma/client';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class ShortlinkPreferenceGetTool implements AgentToolInterface {
  constructor(private _organizationService: OrganizationService) {}
  name = 'shortlinkPreferenceGetTool';
  mirrors = ['GET /settings/shortlink'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'shortlinkPreferenceGetTool',
      mcp: {
        annotations: {
          title: 'Get Short Link Preference',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this to read what the organization wants done with the links of a post: "ASK" (ask every time, the default), "YES" (always shorten them) or "NO" (never shorten them).
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({}),
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
            await this._organizationService.getShortlinkPreference(
              organizationId
            );
          if (!organization) {
            return { output: { errors: 'The organization was not found' } };
          }
          return { output: { shortlink: organization.shortlink } };
        } catch (err: any) {
          return {
            output: {
              errors:
                err?.message || 'Failed to read the short link preference',
            },
          };
        }
      },
    });
  }
}
