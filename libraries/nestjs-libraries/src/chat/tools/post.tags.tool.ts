import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

@Injectable()
export class PostTagsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postTagsTool';
  mirrors = [
    'GET /posts/tags',
    'POST /posts/tags',
    'PUT /posts/tags/:id',
    'DELETE /posts/tags/:id',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'postTagsTool',
      mcp: {
        annotations: {
          title: 'Manage Post Tags',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to manage the tags of the organization. A tag is a name with a color that is put on posts to organize the calendar.
action "list": all the tags with their "id".
action "create": a new tag, pass "name" and "color" (a hex color such as #FF5733).
action "update": changes the "name" and "color" of the tag with the given "id" (list the tags first to get it), both are required.
action "delete": deletes the tag with the given "id" and removes it from all the posts that have it. It cannot be undone, so show the user which tag will be deleted and get their confirmation first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update', 'delete']),
        id: z
          .string()
          .optional()
          .describe('For "update" and "delete": the "id" of the tag'),
        name: z.string().optional().describe('For "create" and "update"'),
        color: z
          .string()
          .optional()
          .describe('For "create" and "update": a hex color such as #FF5733'),
      }),
      outputSchema: z.object({
        output: z
          .object({ tags: z.array(tagSchema) })
          .or(z.object({ tag: tagSchema }))
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
                tags: (await this._postsService.getTags(organizationId)).map(
                  this.mapTag
                ),
              },
            };
          }

          if (inputData.action === 'delete') {
            if (!inputData.id) {
              return { output: { errors: 'The id is required' } };
            }
            return {
              output: {
                tag: this.mapTag(
                  await this._postsService.deleteTag(
                    inputData.id,
                    organizationId
                  )
                ),
              },
            };
          }

          if (!inputData.name || !inputData.color) {
            return { output: { errors: 'The name and color are required' } };
          }
          const body = { name: inputData.name, color: inputData.color };

          if (inputData.action === 'create') {
            return {
              output: {
                tag: this.mapTag(
                  await this._postsService.createTag(organizationId, body)
                ),
              },
            };
          }

          if (!inputData.id) {
            return { output: { errors: 'The id is required' } };
          }
          return {
            output: {
              tag: this.mapTag(
                await this._postsService.editTag(
                  inputData.id,
                  organizationId,
                  body
                )
              ),
            },
          };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to manage the tag' },
          };
        }
      },
    });
  }

  private mapTag(tag: { id: string; name: string; color: string }) {
    return { id: tag.id, name: tag.name, color: tag.color };
  }
}
