import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class PostFindSlotTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postFindSlotTool';
  mirrors = ['GET /posts/find-slot', 'GET /posts/find-slot/:id'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'postFindSlotTool',
      mcp: {
        annotations: {
          title: 'Find Free Post Slot',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this to find the next free time to schedule a post, the one the app suggests for a new post: the first day with a free posting time of the channel.
Pass the "integrationId" of a channel (from integrationList) to use the posting times of that channel, without it the organization defaults are used.
It returns a UTC date to use as the publish date, it does not schedule anything.
`,
      inputSchema: z.object({
        integrationId: z
          .string()
          .optional()
          .describe('Optional id of the channel to find the slot for'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            date: z
              .string()
              .describe('UTC date, for example 2026-07-20T10:00:00'),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          return {
            output: {
              date: await this._postsService.findFreeDateTime(
                organizationId,
                inputData.integrationId
              ),
            },
          };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to find a free slot' },
          };
        }
      },
    });
  }
}
