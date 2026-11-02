import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class PostStatisticsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postStatisticsTool';
  mirrors = ['GET /posts/:id/statistics'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'postStatisticsTool',
      mcp: {
        annotations: {
          title: 'Get Post Link Statistics',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      description: `
Use this to see how many clicks the shortened links of a post got.
Find the post first (postsListTool or postsBrowseTool) and pass its "id".
It asks the short link service for the links written in the post and its thread. The list is empty when the post has no shortened links or short links are not configured.
`,
      inputSchema: z.object({
        id: z.string().describe('The "id" of the post'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            clicks: z
              .array(z.any())
              .describe('One item per shortened link with its click count'),
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
            output: await this._postsService.getStatistics(
              organizationId,
              inputData.id
            ),
          };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to load the link statistics',
            },
          };
        }
      },
    });
  }
}
