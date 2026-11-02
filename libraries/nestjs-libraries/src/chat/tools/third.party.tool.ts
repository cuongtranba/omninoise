import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { ThirdPartyManager } from '@gitroom/nestjs-libraries/3rdparties/thirdparty.manager';
import { ImportMediaDto } from '@gitroom/nestjs-libraries/dtos/third-party/import-media.dto';
import {
  checkAuth,
  toolErrorMessage,
} from '@gitroom/nestjs-libraries/chat/auth.context';
import { validateDto } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';

const fieldSchema = z.object({
  name: z.string(),
  description: z.string(),
  type: z.string(),
  placeholder: z.string(),
});

const mediaSchema = z.object({
  id: z.string(),
  name: z.string(),
  originalName: z.string().nullable(),
  path: z.string(),
  alt: z.string().nullable(),
  thumbnail: z.string().nullable(),
  status: z.string(),
});

// the fields a provider tells about itself, without the pattern it checks
// them with
const toFields = (fields: any[] = []) =>
  fields.map(({ name, description, type, placeholder }) => ({
    name,
    description,
    type,
    placeholder,
  }));

@Injectable()
export class ThirdPartyTool implements AgentToolInterface {
  constructor(private _thirdPartyManager: ThirdPartyManager) {}
  name = 'thirdPartyTool';
  mirrors = [
    'GET /third-party/list',
    'GET /third-party',
    'DELETE /third-party/:id',
    'POST /third-party/:id/submit',
    'POST /third-party/function/:id/:functionName',
    'POST /third-party/:id/import',
    'POST /third-party/:identifier',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'thirdPartyTool',
      mcp: {
        annotations: {
          title: 'Manage Third Party Apps',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this for the third-party apps connected to the organization (for example a service that generates videos for the media library). The API key of an app is stored encrypted and is never returned by any action.
action "available": the apps that can be connected, with their "identifier", description and the "fields" they ask for. An app with an "installUrl" is installed from that link, not with an API key.
action "list": the apps connected to the organization, with the "id" the other actions need.
action "connect": connects the app with the given "identifier" using "apiKey", which is checked with the app before it is saved. The user's API key goes through this call, so use it only with a key the user gave you for this and never repeat it back.
action "delete": disconnects the app with the given "id". The API key is forgotten, the media it made stays. Show the user which app will be disconnected and get their confirmation first.
action "callFunction": runs the function "functionName" of the connected app with the given "id" and "data" and returns what it says (for example the voices or avatars to choose from). Only the functions the app exposes can be called.
action "submit": sends "data" to the connected app with the given "id", which makes a media (for example a video) that is saved in the media library and returned. It can take a while and the app may charge the user for it, so confirm the "data" with the user first.
action "import": brings the media at the https addresses in "items" (each with a "url" and a "name") from the connected app with the given "id" into the media library.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum([
          'available',
          'list',
          'connect',
          'delete',
          'callFunction',
          'submit',
          'import',
        ]),
        id: z
          .string()
          .optional()
          .describe(
            'For "delete", "callFunction", "submit" and "import": the "id" of the connected app'
          ),
        identifier: z
          .string()
          .optional()
          .describe('For "connect": the "identifier" of the app'),
        apiKey: z
          .string()
          .optional()
          .describe('For "connect": the API key of the app'),
        functionName: z
          .string()
          .optional()
          .describe('For "callFunction": the name of the function'),
        data: z
          .record(z.unknown())
          .optional()
          .describe('For "callFunction" and "submit": the data to send'),
        items: z
          .array(z.object({ url: z.string(), name: z.string() }))
          .optional()
          .describe('For "import": the media to import'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            apps: z.array(
              z.object({
                identifier: z.string(),
                title: z.string(),
                description: z.string(),
                fields: z.array(fieldSchema),
                installUrl: z.string().nullable(),
              })
            ),
          })
          .or(
            z.object({
              connected: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  identifier: z.string(),
                  title: z.string(),
                  description: z.string(),
                  position: z.string().nullable(),
                  fields: z.array(fieldSchema),
                })
              ),
            })
          )
          .or(z.object({ saved: z.object({ id: z.string() }) }))
          .or(z.object({ deleted: z.object({ id: z.string() }) }))
          .or(z.object({ media: mediaSchema }))
          .or(z.object({ imported: z.array(mediaSchema) }))
          // before result, whose unknown value would also match an error
          .or(z.object({ errors: z.string() }))
          .or(z.object({ result: z.unknown() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          if (inputData.action === 'available') {
            return {
              output: {
                apps: this._thirdPartyManager
                  .getAllThirdParties()
                  .map((app) => ({
                    identifier: app.identifier,
                    title: app.title,
                    description: app.description,
                    fields: toFields(app.fields),
                    installUrl: app.installUrl || null,
                  })),
              },
            };
          }

          if (inputData.action === 'list') {
            return {
              output: {
                connected: (
                  await this._thirdPartyManager.getSavedThirdParties(
                    organizationId
                  )
                ).map((app) => ({
                  id: app.id,
                  name: app.name,
                  identifier: app.identifier,
                  title: app.title,
                  description: app.description,
                  position: app.position || null,
                  fields: toFields(app.fields),
                })),
              },
            };
          }

          if (inputData.action === 'connect') {
            if (!inputData.identifier || !inputData.apiKey) {
              return {
                output: {
                  errors: 'The identifier and the apiKey are required',
                },
              };
            }
            return {
              output: {
                saved: await this._thirdPartyManager.connect(
                  organizationId,
                  inputData.identifier,
                  inputData.apiKey
                ),
              },
            };
          }

          if (!inputData.id) {
            return { output: { errors: 'The id is required' } };
          }

          if (inputData.action === 'delete') {
            await this._thirdPartyManager.deleteIntegration(
              organizationId,
              inputData.id
            );
            return { output: { deleted: { id: inputData.id } } };
          }

          if (inputData.action === 'callFunction') {
            if (!inputData.functionName) {
              return { output: { errors: 'The functionName is required' } };
            }
            return {
              output: {
                result: await this._thirdPartyManager.callFunction(
                  organizationId,
                  inputData.id,
                  inputData.functionName,
                  inputData.data || {}
                ),
              },
            };
          }

          if (inputData.action === 'submit') {
            return {
              output: {
                media: await this._thirdPartyManager.submit(
                  organizationId,
                  inputData.id,
                  inputData.data || {}
                ),
              },
            };
          }

          // import: the addresses are checked like the web route does, they
          // are public https ones
          const invalid = await validateDto(ImportMediaDto, {
            items: inputData.items,
          });
          if (invalid) {
            return { output: { errors: invalid } };
          }
          return {
            output: {
              imported: await this._thirdPartyManager.importMedia(
                organizationId,
                inputData.id,
                inputData.items!
              ),
            },
          };
        } catch (err: any) {
          return {
            output: {
              errors: toolErrorMessage(
                err,
                'The third party app was not found',
                'Failed to manage the third party apps'
              ),
            },
          };
        }
      },
    });
  }
}
