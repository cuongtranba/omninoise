import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { SetsService } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.service';
import {
  SetsDto,
  UpdateSetsDto,
} from '@gitroom/nestjs-libraries/dtos/sets/sets.dto';
import {
  checkAuth,
  toolErrorMessage,
} from '@gitroom/nestjs-libraries/chat/auth.context';
import { validateDto } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';

// What the editor of the app saves in a set: the post it would create, which
// it loads back to fill the editor. It reads the channel and the settings of
// each post and the content and media of its parts.
const setContentSchema = z
  .object({
    posts: z
      .array(
        z
          .object({
            integration: z.object({ id: z.string() }).passthrough(),
            settings: z.record(z.unknown()).optional(),
            value: z
              .array(
                z
                  .object({
                    content: z.string(),
                    image: z
                      .array(z.object({ id: z.string(), path: z.string() }))
                      .optional(),
                  })
                  .passthrough()
              )
              .min(1),
          })
          .passthrough()
      )
      .min(1),
  })
  .passthrough();

const setSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// the editor stores the content as a JSON string, one that is not an object
// is shown as null instead of failing the whole list
const parseContent = (content: string) => {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch (err) {
    return null;
  }
};

@Injectable()
export class SetsTool implements AgentToolInterface {
  constructor(private _setsService: SetsService) {}
  name = 'setsTool';
  mirrors = ['GET /sets', 'POST /sets', 'PUT /sets', 'DELETE /sets/:id'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'setsTool',
      mcp: {
        annotations: {
          title: 'Manage Sets',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to manage the sets of the organization: named post templates the user picks in the calendar to start a new post already filled in. A set does not schedule anything.
The "content" of a set is the post it fills in, the same posts as integrationSchedulePostTool takes: { "posts": [ { "integration": { "id": the channel id }, "settings": the settings of the channel (integrationSchema), "value": [ { "content": the text as HTML, "image": [ { "id", "path" } ] } ] } ] }. The user's editor loads it back as it is, so a part without "content" or a channel that does not exist any more makes the set open empty or wrong; get the channel ids from integrationListTool. A set can hold a part per channel, and the first post's parts are the ones the editor fills in.
action "list": all the sets with their parsed "content".
action "create": saves a new set, pass "name" and "content".
action "update": replaces the "name" and "content" of the set with the given "id" (list them first to get it), pass both again.
action "delete": removes the set with the given "id". It cannot be undone, so show the user which set will be deleted and get their confirmation first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update', 'delete']),
        id: z
          .string()
          .optional()
          .describe('For "update" and "delete": the "id" of the set'),
        name: z
          .string()
          .min(1)
          .optional()
          .describe('For "create" and "update": the name of the set'),
        content: setContentSchema
          .optional()
          .describe('For "create" and "update": the post the set fills in'),
      }),
      outputSchema: z.object({
        output: z
          .object({ sets: z.array(setSchema) })
          .or(z.object({ saved: z.object({ id: z.string() }) }))
          .or(z.object({ deleted: z.object({ id: z.string() }) }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          if (inputData.action === 'list') {
            return {
              output: {
                sets: (await this._setsService.getSets(organizationId)).map(
                  (set) => ({
                    id: set.id,
                    name: set.name,
                    content: parseContent(set.content),
                    createdAt: set.createdAt.toISOString(),
                    updatedAt: set.updatedAt.toISOString(),
                  })
                ),
              },
            };
          }

          if (inputData.action === 'delete') {
            if (!inputData.id) {
              return { output: { errors: 'The id is required' } };
            }
            await this._setsService.deleteSet(organizationId, inputData.id);
            return { output: { deleted: { id: inputData.id } } };
          }

          const body = {
            id: inputData.action === 'update' ? inputData.id : undefined,
            name: inputData.name,
            content: inputData.content && JSON.stringify(inputData.content),
          } as SetsDto;
          const invalid = await validateDto(
            inputData.action === 'update' ? UpdateSetsDto : SetsDto,
            body
          );
          if (invalid) {
            return { output: { errors: invalid } };
          }

          return {
            output: {
              saved: await this._setsService.createSet(organizationId, body),
            },
          };
        } catch (err: any) {
          return {
            output: {
              errors: toolErrorMessage(
                err,
                'The set was not found',
                'Failed to manage the sets'
              ),
            },
          };
        }
      },
    });
  }
}
