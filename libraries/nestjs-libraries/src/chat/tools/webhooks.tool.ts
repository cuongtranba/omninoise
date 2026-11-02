import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import {
  OnlyURL,
  UpdateDto,
} from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import {
  checkAuth,
  toolErrorMessage,
} from '@gitroom/nestjs-libraries/chat/auth.context';
import { webhookFields } from '@gitroom/nestjs-libraries/chat/automation.fields';
import { validateDto } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';

@Injectable()
export class WebhooksTool implements AgentToolInterface {
  constructor(private _webhooksService: WebhooksService) {}
  name = 'webhooksTool';
  mirrors = [
    'GET /webhooks',
    'PUT /webhooks',
    'DELETE /webhooks/:id',
    'POST /webhooks/send',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'webhooksTool',
      mcp: {
        annotations: {
          title: 'Manage Webhooks',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this to manage the webhooks of the organization: a webhook is a public https address that Postiz sends the post to every time a post of its channels is published. Create one with webhookCreateTool.
action "list": all the webhooks with their channels (an empty list of channels means all of them).
action "update": replaces the "name", "url" and "channels" of the webhook with the given "id" (list them first to get it), pass all three again.
action "delete": removes the webhook with the given "id", nothing is sent to it any more. It cannot be undone, so show the user which webhook will be deleted and get their confirmation first.
action "send": sends the "payload" (any JSON) as a POST to the https "url" to try an address out. It sends data to a third party, so only send what the user asked to send, to the address they gave, and confirm both first. It never reaches an internal network address, and the result only says the request was made, not whether the other side accepted it.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['list', 'update', 'delete', 'send']),
        id: z
          .string()
          .optional()
          .describe('For "update" and "delete": the "id" of the webhook'),
        name: webhookFields.name.optional(),
        url: webhookFields.url
          .optional()
          .describe('For "update" and "send": the https address'),
        channels: webhookFields.channels.optional(),
        payload: z
          .record(z.unknown())
          .optional()
          .describe('For "send": the JSON object to send'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            webhooks: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                url: z.string(),
                channels: z.array(
                  z.object({
                    id: z.string(),
                    name: z.string(),
                    picture: z.string().nullable(),
                  })
                ),
                createdAt: z.string(),
                updatedAt: z.string(),
              })
            ),
          })
          .or(z.object({ saved: z.object({ id: z.string() }) }))
          .or(z.object({ deleted: z.object({ id: z.string() }) }))
          .or(z.object({ sent: z.boolean() }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          if (inputData.action === 'send') {
            // the check of the web route: a public https address
            const invalid = await validateDto(OnlyURL, { url: inputData.url });
            if (invalid) {
              return { output: { errors: invalid } };
            }
            await this._webhooksService.sendWebhook(
              inputData.url!,
              inputData.payload || {}
            );
            return { output: { sent: true } };
          }

          if (inputData.action === 'list') {
            return {
              output: {
                webhooks: (
                  await this._webhooksService.getWebhooks(organizationId)
                ).map((webhook) => ({
                  id: webhook.id,
                  name: webhook.name,
                  url: webhook.url,
                  channels: webhook.integrations.map((i) => i.integration),
                  createdAt: webhook.createdAt.toISOString(),
                  updatedAt: webhook.updatedAt.toISOString(),
                })),
              },
            };
          }

          if (!inputData.id) {
            return { output: { errors: 'The id is required' } };
          }

          if (inputData.action === 'delete') {
            await this._webhooksService.deleteWebhook(
              organizationId,
              inputData.id
            );
            return { output: { deleted: { id: inputData.id } } };
          }

          const body = {
            id: inputData.id,
            name: inputData.name,
            url: inputData.url,
            integrations: inputData.channels?.map((id: string) => ({ id })),
          } as UpdateDto;
          const invalid = await validateDto(UpdateDto, body);
          if (invalid) {
            return { output: { errors: invalid } };
          }

          return {
            output: {
              saved: await this._webhooksService.createWebhook(
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
