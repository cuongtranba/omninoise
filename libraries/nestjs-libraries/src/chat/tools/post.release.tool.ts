import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class PostReleaseTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postReleaseTool';
  mirrors = [
    'GET /posts/:id/release-url',
    'GET /posts/:id/missing',
    'PUT /posts/:id/release-id',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'postReleaseTool',
      mcp: {
        annotations: {
          title: 'Published Post Link',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this to get the link of a published post on its social network, or to connect a post whose link Postiz could not find.
Find the post first (postsListTool or postsBrowseTool) and pass its "id".
action "getUrl": the link of the published post. It can come back empty (not published, or no link), "pending" (the platform has not finished publishing it, ask again later), "unavailable" or "reconnect" (the channel must be reconnected).
action "listMissing": for a post whose id on the platform was not captured (its release id is "missing"), lists the recent content of the channel as candidates, each with an "id" and a "url".
action "setReleaseId": connects such a post to the candidate the user picked, pass its "id" as "releaseId". It only works on a post whose release id is "missing", and it overwrites that value - show the user the candidate and get their confirmation first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['getUrl', 'listMissing', 'setReleaseId']),
        id: z.string().describe('The "id" of the post'),
        releaseId: z
          .string()
          .optional()
          .describe(
            'For "setReleaseId": the "id" of the candidate from listMissing'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({
            releaseURL: z.string().optional(),
            pending: z.boolean().optional(),
            unavailable: z.boolean().optional(),
            reconnect: z.boolean().optional(),
            missing: z
              .array(z.object({ id: z.string(), url: z.string() }))
              .optional(),
            id: z.string().optional(),
            releaseId: z.string().nullable().optional(),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          if (inputData.action === 'getUrl') {
            return {
              output: await this._postsService.getReleaseURL(
                organizationId,
                inputData.id
              ),
            };
          }

          if (inputData.action === 'listMissing') {
            return {
              output: {
                missing: await this._postsService.getMissingContent(
                  organizationId,
                  inputData.id
                ),
              },
            };
          }

          if (!inputData.releaseId) {
            return { output: { errors: 'The releaseId is required' } };
          }

          const post = await this._postsService.updateReleaseId(
            organizationId,
            inputData.id,
            inputData.releaseId
          );
          return {
            output: {
              id: post.id,
              releaseId: post.releaseId,
              releaseURL: post.releaseURL ?? undefined,
            },
          };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to work with the post link',
            },
          };
        }
      },
    });
  }
}
