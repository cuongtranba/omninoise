import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { AutopostDto } from '@gitroom/nestjs-libraries/dtos/autopost/autopost.dto';
import {
  checkAuth,
  toolErrorMessage,
} from '@gitroom/nestjs-libraries/chat/auth.context';
import { validateDto } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import {
  autopostFields,
  toAutopostDto,
} from '@gitroom/nestjs-libraries/chat/automation.fields';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

@Injectable()
export class AutopostCreateTool implements AgentToolInterface {
  constructor(private _autopostService: AutopostService) {}
  name = 'autopostCreateTool';
  mirrors = ['POST /autopost'];
  optionalOnSelfHosted = true;
  // same limit as the route of the web app
  policies: AgentToolInterface['policies'] = [
    [AuthorizationActions.Create, Sections.WEBHOOKS],
  ];

  run() {
    return createTool({
      id: 'autopostCreateTool',
      mcp: {
        annotations: {
          title: 'Create Autopost',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this to create an autopost: it follows an RSS feed and, when the feed has a new item, creates a draft post about it (written by the AI or from a fixed text, with a picture if asked) on its channels. Check the feed first with autopostTool (action "test"), manage the autoposts that exist with autopostTool.
An autopost created with "active" true starts at once, using the AI of the instance and creating drafts on its own, and the plan limits how many webhooks and autoposts the organization has, so show the user the settings and get their confirmation first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object(autopostFields),
      outputSchema: z.object({
        output: z
          .object({
            created: z.object({ id: z.string(), active: z.boolean() }),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          const body = toAutopostDto(inputData);
          const invalid = await validateDto(AutopostDto, body);
          if (invalid) {
            return { output: { errors: invalid } };
          }

          return {
            output: {
              created: await this._autopostService.createAutopost(
                organizationId,
                body
              ),
            },
          };
        } catch (err: any) {
          return {
            output: {
              errors: toolErrorMessage(
                err,
                'The autopost was not found',
                'Failed to manage the autoposts'
              ),
            },
          };
        }
      },
    });
  }
}
