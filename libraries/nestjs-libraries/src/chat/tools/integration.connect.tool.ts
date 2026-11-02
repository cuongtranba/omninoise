import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import {
  ConnectUrlError,
  IntegrationService,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

@Injectable()
export class IntegrationConnectTool implements AgentToolInterface {
  constructor(
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager
  ) {}
  name = 'integrationConnectTool';
  mirrors = ['GET /integrations/social/:integration'];
  optionalOnSelfHosted = true;
  policies: AgentToolInterface['policies'] = [
    [AuthorizationActions.Create, Sections.CHANNEL],
  ];

  // the channel to reconnect, when the call is a reconnect
  private reconnectChannel(
    inputData: { reconnectChannelId?: string },
    orgId: string
  ) {
    return inputData.reconnectChannelId
      ? this._integrationService.getIntegrationById(
          orgId,
          inputData.reconnectChannelId
        )
      : undefined;
  }

  async refreshChannelId(
    inputData: { reconnectChannelId?: string },
    orgId: string
  ) {
    return (await this.reconnectChannel(inputData, orgId))?.internalId;
  }

  run() {
    return createTool({
      id: 'integrationConnectTool',
      mcp: {
        annotations: {
          title: 'Connect a Channel',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this to connect a new channel, or to reconnect a channel whose connection expired (integrationList shows it as "refreshNeeded"). It does not connect anything by itself: it returns a link ("url") that the user opens in their browser, authorizes on the social platform, and is brought back to Postiz where the channel is created. Show the user the link and tell them it is valid for one hour.
Pass "provider" with the "identifier" from integrationProvidersTool, only platforms with connect "oauth" work here. A platform with "requiresInstanceUrl" also needs "instanceUrl", the address of the user's server.
To reconnect, pass "reconnectChannelId", the "id" of the channel from integrationList (the provider is then taken from the channel). Reconnecting does not count against the channels limit of the plan.
After the user is back, list the channels again: some platforms ask the user to pick an account or page in Postiz first, the channel shows "inBetweenSteps" until they do.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        provider: z
          .string()
          .optional()
          .describe(
            'The "identifier" of the platform from integrationProvidersTool, not needed when reconnecting'
          ),
        instanceUrl: z
          .string()
          .optional()
          .describe(
            "For platforms with requiresInstanceUrl: the address of the user's server, e.g. https://mastodon.social"
          ),
        reconnectChannelId: z
          .string()
          .optional()
          .describe(
            'To reconnect: the "id" of the channel from integrationList'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({ url: z.string(), expiresInMinutes: z.number() })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          let provider = inputData.provider;
          let refresh: string | undefined;
          if (inputData.reconnectChannelId) {
            const channel = await this.reconnectChannel(
              inputData,
              organizationId
            );
            if (!channel) {
              return {
                output: {
                  errors:
                    'Channel not found, use integrationList to get a valid channel id',
                },
              };
            }
            provider = channel.providerIdentifier;
            refresh = channel.internalId;
          }

          if (!provider) {
            return {
              output: {
                errors:
                  'Pass a provider from integrationProvidersTool or the reconnectChannelId of a channel',
              },
            };
          }

          const connectType = this._integrationManager.getConnectType(provider);
          if (connectType && connectType !== 'oauth') {
            return {
              output: {
                errors: `${provider} cannot be connected from here, the user has to add it in Postiz with the "Add channel" button`,
              },
            };
          }

          const result = await this._integrationService.generateConnectUrl(
            organizationId,
            provider,
            { refresh, externalUrl: inputData.instanceUrl }
          );
          if ('err' in result) {
            return {
              output: { errors: 'Could not connect to the platform' },
            };
          }

          return { output: { url: result.url, expiresInMinutes: 60 } };
        } catch (err: any) {
          return {
            output: {
              errors:
                err instanceof ConnectUrlError && err.reason === 'notAllowed'
                  ? 'Pass a provider from integrationProvidersTool or the reconnectChannelId of a channel'
                  : err?.message || 'Failed to create the link',
            },
          };
        }
      },
    });
  }
}
