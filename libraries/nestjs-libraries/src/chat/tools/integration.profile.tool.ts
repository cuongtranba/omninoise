import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable, Logger } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class IntegrationProfileTool implements AgentToolInterface {
  private readonly _logger = new Logger(IntegrationProfileTool.name);
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationProfileTool';
  mirrors = ['POST /integrations/:id/nickname'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'integrationProfileTool',
      mcp: {
        annotations: {
          title: 'Change Channel Profile',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this to change the name and the picture of the account on the social platform itself, it is visible to everyone who sees the account. Only some platforms allow it: integrationGetTool says it with "canChangeNickname" and "canChangeProfilePicture".
Pass the "id" of the channel (integrationList), the new "name" and the "picture", a link to an image (an uploaded media path works).
It cannot be undone from Postiz, show the user the new name and picture and get their confirmation first. (To only change how Postiz shows the channel use integrationUpdateTool.)
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        id: z.string().describe('The "id" of the channel'),
        name: z.string().describe('The new name of the account'),
        picture: z
          .string()
          .describe('A link to the new picture of the account'),
      }),
      outputSchema: z.object({
        output: z
          .object({ id: z.string() })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          const { id } = await this._integrationService.changeProfile(
            organizationId,
            inputData.id,
            { name: inputData.name, picture: inputData.picture }
          );
          return { output: { id } };
        } catch (err: any) {
          if (err?.message !== 'Invalid integration') {
            this._logger.error('Failed to change the profile', err);
          }
          return {
            output: {
              errors:
                err?.message === 'Invalid integration'
                  ? 'Channel not found or its platform does not allow changing the profile'
                  : 'Failed to change the profile on the platform',
            },
          };
        }
      },
    });
  }
}
