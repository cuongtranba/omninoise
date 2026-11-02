import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { expandPostsList } from '@gitroom/helpers/utils/posts.list.minify';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// the earlier posts are not paged, so a long history is cut to what fits a reply
const OLD_POSTS_LIMIT = 100;

@Injectable()
export class PostsBrowseTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postsBrowseTool';
  mirrors = ['GET /posts/list', 'GET /posts/old'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'postsBrowseTool',
      mcp: {
        annotations: {
          title: 'Browse Posts',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this to browse the organization's posts without knowing their dates, as the list view of the app does. For a calendar window between two dates use postsListTool instead.
action "page": one page of the main posts, filtered by "state" (all, scheduled, draft or published) and optionally by channels or customer. Scheduled and draft posts are the upcoming ones, soonest first, published posts are the most recent first. Use "page" (starting at 0) and "limit" to walk through them, the result says if there are more.
action "before": the posts published or scheduled up to a "date" (UTC), newest first, up to ${OLD_POSTS_LIMIT} of them. Use it to find an earlier post to link to from a new one.
Each post has an "id" and a "group", pass them to postGetTool to read the whole post.
`,
      inputSchema: z.object({
        action: z.enum(['page', 'before']),
        page: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('For "page": the page number, starting at 0'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('For "page": posts per page, 20 by default'),
        state: z
          .enum(['all', 'scheduled', 'draft', 'published'])
          .optional()
          .describe('For "page": which posts to list, all by default'),
        customer: z
          .string()
          .optional()
          .describe(
            'For "page": optional customer (group) id to filter the channels by'
          ),
        integrations: z
          .array(z.string())
          .optional()
          .describe('For "page": optional channel ids to list the posts of'),
        date: z
          .string()
          .optional()
          .describe(
            'For "before": the date (UTC) the posts must be at or before, for example 2026-07-20T00:00:00'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({
            posts: z.array(
              z.object({
                id: z.string(),
                group: z.string().optional(),
                content: z.string(),
                publishDate: z.string(),
                state: z
                  .string()
                  .optional()
                  .describe('QUEUE, DRAFT, PUBLISHED or ERROR'),
                releaseURL: z.string().nullable().optional(),
                releaseId: z.string().nullable().optional(),
                integration: z.any().describe('The channel the post is on'),
                tags: z.array(z.any()).optional(),
              })
            ),
            total: z.number().optional(),
            page: z.number().optional(),
            limit: z.number().optional(),
            hasMore: z.boolean().optional(),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          if (inputData.action === 'before') {
            if (!inputData.date) {
              return { output: { errors: 'The date is required' } };
            }

            const posts = await this._postsService.getOldPosts(
              organizationId,
              inputData.date,
              OLD_POSTS_LIMIT
            );
            return {
              output: {
                posts: posts.map((p) => ({
                  ...p,
                  publishDate: dayjs(p.publishDate)
                    .utc()
                    .format('YYYY-MM-DDTHH:mm:ss'),
                })),
              },
            };
          }

          const list = expandPostsList(
            await this._postsService.getPostsList(organizationId, {
              page: inputData.page,
              limit: inputData.limit,
              state: inputData.state,
              customer: inputData.customer,
              integrations: inputData.integrations,
            })
          );
          return { output: list };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to list the posts' },
          };
        }
      },
    });
  }
}
