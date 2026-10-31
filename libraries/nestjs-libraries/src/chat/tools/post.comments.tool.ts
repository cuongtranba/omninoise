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
export class PostCommentsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postCommentsTool';
  mirrors = [
    'POST /posts/:id/comments',
    'PUT /posts/comments/:commentId/resolve',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'postCommentsTool',
      mcp: {
        annotations: {
          title: 'Post Review Comments',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this for the review comments of a post, the internal discussion in Postiz between the team and the people who review the post before it is published. These comments are not published on the social network.
Find the post first (postsListTool or postsBrowseTool) and pass its "id".
action "add": writes a comment on the post. Pass "postId" to comment on one part of the post's thread (a post of the thread, from postGetTool), otherwise the comment is on the main post. To anchor the comment to a piece of the text pass "anchorStart", "anchorEnd" and "anchorQuote" together (the offsets in the plain text of the post and the exact quote between them). To reply to a comment pass its "parentId" (only root comments can be replied to, replies are not anchored).
action "resolve": marks a root comment as resolved, or reopens it with "resolved" false. Pass the "commentId".
The comment is written as the user who connected, so this needs a connection through OAuth, an API key has no user.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['add', 'resolve']),
        id: z.string().optional().describe('For "add": the "id" of the post'),
        content: z
          .string()
          .min(1)
          .max(2000)
          .optional()
          .describe('For "add": the text of the comment'),
        postId: z
          .string()
          .optional()
          .describe(
            'For "add": the id of the part of the thread to comment on'
          ),
        anchorStart: z.number().int().min(0).optional(),
        anchorEnd: z.number().int().min(0).optional(),
        anchorQuote: z.string().max(500).optional(),
        parentId: z
          .string()
          .optional()
          .describe('For "add": the id of the root comment to reply to'),
        commentId: z
          .string()
          .optional()
          .describe('For "resolve": the id of the root comment'),
        resolved: z
          .boolean()
          .optional()
          .describe('For "resolve": true to resolve, false to reopen'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            id: z.string(),
            postId: z.string(),
            parentId: z.string().nullable(),
            content: z.string(),
            resolvedAt: z.string().nullable(),
            createdAt: z.string(),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        // the whole organization is parsed, the comment is written as users[0].userId
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        try {
          if (inputData.action === 'resolve') {
            if (!inputData.commentId || inputData.resolved === undefined) {
              return {
                output: { errors: 'The commentId and resolved are required' },
              };
            }

            const comment = await this._postsService.resolveComment(
              organization.id,
              inputData.commentId,
              inputData.resolved
            );
            return { output: this.mapComment(comment) };
          }

          const userId = organization.users?.[0]?.userId;
          if (!userId) {
            return {
              output: {
                errors:
                  'Comments are written as a user, connect through OAuth instead of an API key',
              },
            };
          }
          if (!inputData.id || !inputData.content) {
            return { output: { errors: 'The id and content are required' } };
          }

          const comment = await this._postsService.createPublicComment(
            inputData.id,
            {
              content: inputData.content,
              postId: inputData.postId,
              anchorStart: inputData.anchorStart,
              anchorEnd: inputData.anchorEnd,
              anchorQuote: inputData.anchorQuote,
              parentId: inputData.parentId,
            },
            userId,
            '',
            organization.id
          );
          return { output: this.mapComment(comment) };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to save the comment' },
          };
        }
      },
    });
  }

  private mapComment(comment: {
    id: string;
    postId: string;
    parentId: string | null;
    content: string;
    resolvedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: comment.id,
      postId: comment.postId,
      parentId: comment.parentId,
      content: comment.content,
      resolvedAt: comment.resolvedAt
        ? dayjs(comment.resolvedAt).utc().format('YYYY-MM-DDTHH:mm:ss')
        : null,
      createdAt: dayjs(comment.createdAt).utc().format('YYYY-MM-DDTHH:mm:ss'),
    };
  }
}
