import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

const appSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  redirectUrl: z.string(),
  clientId: z.string(),
  picture: z.string().nullable(),
  createdAt: z.string(),
});

// the app is picked field by field: the row also holds the (encrypted) client secret
const mapApp = (app: {
  id: string;
  name: string;
  description: string | null;
  redirectUrl: string;
  clientId: string;
  picture?: { path: string } | null;
  createdAt: Date;
}) => ({
  id: app.id,
  name: app.name,
  description: app.description,
  redirectUrl: app.redirectUrl,
  clientId: app.clientId,
  picture: app.picture?.path ?? null,
  createdAt: app.createdAt.toISOString(),
});

@Injectable()
export class OAuthAppTool implements AgentToolInterface {
  constructor(private _oauthService: OAuthService) {}
  name = 'oauthAppTool';
  mirrors = [
    'GET /user/oauth-app',
    'POST /user/oauth-app',
    'PUT /user/oauth-app',
    'DELETE /user/oauth-app',
    'POST /user/oauth-app/rotate-secret',
  ];
  optionalOnSelfHosted = true;
  // same limit as the routes of the web app
  policies: AgentToolInterface['policies'] = [
    [AuthorizationActions.Create, Sections.ADMIN],
  ];

  run() {
    return createTool({
      id: 'oauthAppTool',
      mcp: {
        annotations: {
          title: 'Manage Developer OAuth App',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to manage the OAuth application of the organization (Settings > Developers). It lets another app sign in with Postiz and act in this organization. An organization has at most one. It needs an admin of the organization.
action "get": the application ("app" is null when there is none): name, description, redirect url and client id. The client secret is never returned here.
action "create": creates the application, pass "name" and "redirectUrl" (and "description"). Its "clientSecret" is returned only now: it is a secret and cannot be read again, give it only to the user and never write it anywhere else.
action "update": changes the name, description or redirect url you pass. The redirect url decides where the signed-in users are sent, so confirm it with the user first.
action "rotateSecret": creates a new client secret and returns it as "clientSecret", with the same care. The old secret stops working immediately, so every app using it breaks until it gets the new one.
action "delete": deletes the application and revokes every connection that was made through it, they stop working immediately. It cannot be undone, so confirm with the user first.
The picture of the application can only be changed in the Postiz app. If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['get', 'create', 'update', 'rotateSecret', 'delete']),
        name: z
          .string()
          .max(100)
          .optional()
          .describe('For "create" (required) and "update"'),
        description: z
          .string()
          .max(500)
          .optional()
          .describe('For "create" and "update"'),
        redirectUrl: z
          .string()
          .optional()
          .describe(
            'For "create" (required) and "update": a full http or https url'
          ),
      }),
      outputSchema: z.object({
        // the first one that fits is kept and a union member drops the keys it
        // does not know, so the one with the secret goes before the one without
        output: z
          .object({ app: appSchema, clientSecret: z.string() })
          .or(z.object({ app: appSchema.nullable() }))
          .or(z.object({ clientSecret: z.string() }))
          .or(z.object({ deleted: z.boolean() }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          if (inputData.action === 'get') {
            const app = await this._oauthService.getApp(organizationId);
            return { output: { app: app ? mapApp(app) : null } };
          }

          if (inputData.action === 'create') {
            if (!inputData.name || !inputData.redirectUrl) {
              return {
                output: { errors: 'The name and the redirectUrl are required' },
              };
            }
            const { clientSecret, ...app } = await this._oauthService.createApp(
              organizationId,
              {
                name: inputData.name,
                description: inputData.description,
                redirectUrl: inputData.redirectUrl,
              }
            );
            return { output: { app: mapApp(app), clientSecret } };
          }

          if (inputData.action === 'update') {
            const app = await this._oauthService.updateApp(organizationId, {
              name: inputData.name,
              description: inputData.description,
              redirectUrl: inputData.redirectUrl,
            });
            if (!app) {
              return { output: { errors: 'No OAuth app found' } };
            }
            return { output: { app: mapApp(app) } };
          }

          if (inputData.action === 'rotateSecret') {
            return {
              output: await this._oauthService.rotateSecret(organizationId),
            };
          }

          await this._oauthService.deleteApp(organizationId);
          return { output: { deleted: true } };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to manage the OAuth app',
            },
          };
        }
      },
    });
  }
}
