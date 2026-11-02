import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { WebhooksDto } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import {
  checkAuth,
  toolErrorMessage,
} from '@gitroom/nestjs-libraries/chat/auth.context';
import { validateDto } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { webhookFields } from '@gitroom/nestjs-libraries/chat/automation.fields';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

@Injectable()
export class WebhookCreateTool implements AgentToolInterface {
  constructor(private _webhooksService: WebhooksService) {}
  name = 'webhookCreateTool';
  mirrors = ['POST /webhooks'];
  optionalOnSelfHosted = true;
  // same limit as the route of the web app
  policies: AgentToolInterface['policies'] = [
    [AuthorizationActions.Create, Sections.WEBHOOKS],
  ];

  run() {
    return createTool({
      id: 'webhookCreateTool',
      mcp: {
        annotations: {
          title: 'Create Webhook',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this to create a webhook: from now on Postiz sends every post that is published on its channels to the public https address "url" (an empty list of channels means all of them). The posts of the organization go to that address, so show the user the address and the channels and get their confirmation first. The plan limits how many webhooks the organization has. Try an address out with webhooksTool (action "send") and manage the webhooks that exist with webhooksTool.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object(webhookFields),
      outputSchema: z.object({
        output: z
          .object({ created: z.object({ id: z.string() }) })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          const body = {
            name: inputData.name,
            url: inputData.url,
            integrations: inputData.channels.map((id: string) => ({ id })),
          } as WebhooksDto;
          const invalid = await validateDto(WebhooksDto, body);
          if (invalid) {
            return { output: { errors: invalid } };
          }

          return {
            output: {
              created: await this._webhooksService.createWebhook(
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
                'The webhook was not found',
                'Failed to manage the webhooks'
              ),
            },
          };
        }
      },
    });
  }
}
