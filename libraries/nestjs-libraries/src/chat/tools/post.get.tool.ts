import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// only what the post editor reads of a post, the channel without its tokens
const editorPostSchema = z.object({
  id: z.string(),
  content: z.string(),
  publishDate: z.string().describe('UTC time'),
  state: z.string().describe('QUEUE, DRAFT, PUBLISHED or ERROR'),
  delay: z.number().describe('Minutes to wait after the previous part'),
  intervalInDays: z.number().nullable().describe('The repeat interval'),
  creationMethod: z.string(),
  image: z.array(
    z.object({
      id: z.string().optional(),
      path: z.string(),
      url: z.string().optional(),
      name: z.string().optional(),
      alt: z.string().nullable().optional(),
      thumbnail: z.string().nullable().optional(),
    })
  ),
  tags: z
    .array(
      z.object({
        tag: z.object({ id: z.string(), name: z.string(), color: z.string() }),
      })
    )
    .optional(),
  integration: z
    .object({
      id: z.string(),
      name: z.string(),
      picture: z.string().nullable(),
      providerIdentifier: z.string(),
      profile: z.string().nullable(),
    })
    .optional(),
});

const editorSchema = z.object({
  group: z.string().nullable().optional(),
  posts: z
    .array(editorPostSchema)
    .describe(
      'The main post first, then its thread parts or comments in order'
    ),
  integration: z.string().describe('The id of the channel'),
  integrationPicture: z.string().nullable().optional(),
  settings: z.any().describe('The current provider settings'),
});

type EditorPost = z.infer<typeof editorPostSchema>;

@Injectable()
export class PostGetTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postGetTool';
  mirrors = ['GET /posts/:id', 'GET /posts/group/:group'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'postGetTool',
      mcp: {
        annotations: {
          title: 'Get Post',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this to read one post in full, the way the post editor loads it: all of its parts (the main post and its thread or comments), their media, the channel it belongs to and its current provider settings.
Pass either the "id" of the post or its "group" - find them first with postsListTool or postsBrowseTool, both return the id and the group of every post.
With the "group" the result also holds "siblings": the same post as it was created for the other channels at once.
If the post cannot be found, the result contains output.errors.
`,
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe('The "id" of the post, pass this or the group'),
        group: z
          .string()
          .optional()
          .describe('The "group" of the post, pass this or the id'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            ...editorSchema.shape,
            siblings: z
              .array(editorSchema)
              .optional()
              .describe(
                'The same post on the other channels it was created for'
              ),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        if (!!inputData.id === !!inputData.group) {
          return { output: { errors: 'Pass either the id or the group' } };
        }

        try {
          if (inputData.group) {
            const { siblings, ...main } =
              await this._postsService.getPostsByGroup(
                organizationId,
                inputData.group
              );
            return {
              output: {
                ...this.mapEditor(main),
                siblings: siblings.map((s) => this.mapEditor(s)),
              },
            };
          }

          return {
            output: this.mapEditor(
              await this._postsService.getPost(organizationId, inputData.id!)
            ),
          };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to load the post' },
          };
        }
      },
    });
  }

  private mapEditor(editor: Awaited<ReturnType<PostsService['getPost']>>) {
    return {
      group: editor.group,
      posts: editor.posts.map(
        (p: any): EditorPost => ({
          id: p.id,
          content: p.content,
          publishDate: dayjs(p.publishDate).utc().format('YYYY-MM-DDTHH:mm:ss'),
          state: p.state,
          delay: p.delay,
          intervalInDays: p.intervalInDays ?? null,
          creationMethod: p.creationMethod,
          image: p.image,
          tags: p.tags?.map(({ tag }: any) => ({
            tag: { id: tag.id, name: tag.name, color: tag.color },
          })),
          integration: p.integration,
        })
      ),
      integration: editor.integration,
      integrationPicture: editor.integrationPicture,
      settings: editor.settings,
    };
  }
}
