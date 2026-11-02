import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class IntegrationProvidersTool implements AgentToolInterface {
  constructor(private _integrationManager: IntegrationManager) {}
  name = 'integrationProvidersTool';
  mirrors = ['GET /integrations'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'integrationProvidersTool',
      mcp: {
        annotations: {
          title: 'List Connectable Platforms',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this to list the social platforms a channel can be connected to (the "Add channel" list of Postiz). To the user these are platforms, the channels are the accounts already connected (integrationList).
Each platform has an "identifier" to pass to integrationConnectTool, and "connect" says how it is connected:
"oauth": the user authorizes on the platform in their browser, integrationConnectTool returns the link.
"form", "web3" and "extension": the user has to add it inside Postiz (credentials form, wallet or browser extension), integrationConnectTool cannot do it.
"requiresInstanceUrl" is true for platforms that live on the user's own server (they pass its address as "instanceUrl").
`,
      inputSchema: z.object({}),
      outputSchema: z.object({
        output: z.array(
          z.object({
            identifier: z.string(),
            name: z.string(),
            tooltip: z.string().optional(),
            connect: z.enum(['oauth', 'form', 'web3', 'extension']),
            requiresInstanceUrl: z.boolean(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);

        return {
          output: (
            await this._integrationManager.getAllIntegrations()
          ).social.map((p) => ({
            identifier: p.identifier,
            name: p.name,
            tooltip: p.toolTip,
            connect: this._integrationManager.getConnectType(p.identifier),
            requiresInstanceUrl: p.isExternal,
          })),
        };
      },
    });
  }
}
