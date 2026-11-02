import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class PostSeparateTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postSeparateTool';
  mirrors = ['POST /posts/separate-posts'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'postSeparateTool',
      mcp: {
        annotations: {
          title: 'Split Text Into A Thread',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this to split a long text into the parts of a thread, with AI. Each part is at most "len" characters, keeps the exact wording and breaks the text where the context changes.
Pass the long "content" and the maximum "len" of a part (the character limit of the platform, from integrationSchema). Nothing is scheduled: use the returned parts as the parts of a post with integrationSchedulePostTool.
If it fails, the result contains output.errors.
`,
      inputSchema: z.object({
        content: z.string().min(1).describe('The long text to split'),
        len: z
          .number()
          .int()
          .min(20)
          .describe('The maximum number of characters of a part'),
      }),
      outputSchema: z.object({
        output: z
          .object({ posts: z.array(z.string()) })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);

        try {
          return {
            output: await this._postsService.separatePosts(
              inputData.content,
              inputData.len
            ),
          };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to split the text' },
          };
        }
      },
    });
  }
}
