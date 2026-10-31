import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

@Injectable()
export class PostChangeDateTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postChangeDateTool';
  mirrors = ['PUT /posts/:id/date'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'postChangeDateTool',
      mcp: {
        annotations: {
          title: 'Change Post Date',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to move a post to another date, like dragging it on the calendar.
Find the post first (postsListTool or postsBrowseTool) and pass its "id" and the new "date" (UTC, for example 2026-07-20T10:00:00).
action "update": only the date changes, the state stays as it is (a scheduled post stays scheduled, a draft stays a draft). Use this to move a post.
action "schedule": the post is put back in the queue for the new date (a draft stays a draft) and its published link is cleared. A post that was already published is refused, because it would be published a second time, unless "republish" is true - only pass it when the user explicitly asked to publish the post again, and get their confirmation first.
If the post cannot be moved, the result contains output.errors.
`,
      inputSchema: z.object({
        id: z.string().describe('The "id" of the post'),
        date: z
          .string()
          .describe('The new date (UTC), for example 2026-07-20T10:00:00'),
        action: z.enum(['update', 'schedule']),
        republish: z
          .boolean()
          .optional()
          .describe(
            'Only with "schedule": allow publishing a published post again'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({
            id: z.string(),
            publishDate: z.string(),
            state: z.string(),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          const post = await this._postsService.changeDate(
            organizationId,
            inputData.id,
            inputData.date,
            inputData.action,
            inputData.republish
          );
          return {
            output: {
              id: post.id,
              publishDate: dayjs(post.publishDate)
                .utc()
                .format('YYYY-MM-DDTHH:mm:ss'),
              state: post.state,
            },
          };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to change the date' },
          };
        }
      },
    });
  }
}
