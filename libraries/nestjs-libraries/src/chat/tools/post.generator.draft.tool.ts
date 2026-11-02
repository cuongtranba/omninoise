import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AbilityPolicy } from '@gitroom/nestjs-libraries/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

@Injectable()
export class PostGeneratorDraftTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postGeneratorDraftTool';
  mirrors = ['POST /posts/generator/draft'];
  optionalOnSelfHosted = true;
  // same limit as POST /posts/generator/draft
  policies: AbilityPolicy[] = [
    [AuthorizationActions.Create, Sections.POSTS_PER_MONTH],
  ];

  run() {
    return createTool({
      id: 'postGeneratorDraftTool',
      mcp: {
        annotations: {
          title: 'Fill A Week With Drafts',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to fill a week of the calendar with drafts out of the texts of an article, the way the generator of the app does for a blog post.
For EVERY enabled channel (except Reddit) and for every item of "posts" it creates one draft, at a random time of the chosen week, so it creates many posts: channels times items. Show the user the texts, the week and the number of drafts it will create, and get their confirmation first.
"posts" is the list of items, each with the "list" of its parts (the first part is the post, the next ones follow it in the thread). A last part linking to the article is always added: pass the "url" of the article, or the "postId" of a post of Postiz.
"week" is the ISO week number and "year" the year, the drafts are placed at a random time of that week, so it must be a week that is not over yet.
The drafts are only drafts, nothing is published. Find them with postsBrowseTool and the state draft.
If something fails, the result contains output.errors.
`,
      inputSchema: z
        .object({
          posts: z
            .array(
              z.object({
                list: z
                  .array(z.object({ post: z.string() }))
                  .min(1)
                  .describe('The parts of one post, the first is the post'),
              })
            )
            .min(1),
          week: z.number().describe('ISO week number of the year'),
          year: z.number(),
          url: z
            .string()
            .optional()
            .describe('The link to the article, pass this or the postId'),
          postId: z
            .string()
            .optional()
            .describe('The id of a post to link to, pass this or the url'),
        })
        .refine((input) => !!input.url || !!input.postId, {
          message: 'Pass the url or the postId to link to',
        }),
      outputSchema: z.object({
        output: z
          .object({ created: z.boolean() })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          await this._postsService.generatePostsDraft(
            organizationId,
            inputData
          );
          return { output: { created: true } };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to create the drafts' },
          };
        }
      },
    });
  }
}
