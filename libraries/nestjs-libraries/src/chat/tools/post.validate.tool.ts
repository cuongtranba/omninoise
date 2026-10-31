import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class PostValidateTool implements AgentToolInterface {
  constructor(
    private _postsService: PostsService,
    private _shortLinkService: ShortLinkService
  ) {}
  name = 'postValidateTool';
  mirrors = ['POST /posts/valid', 'POST /posts/should-shortlink'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'postValidateTool',
      mcp: {
        annotations: {
          title: 'Validate Post',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this to check a post before scheduling it, nothing is created.
action "validate": checks the posts the way the app does before it creates them: the channel settings, the media rules of the platform, empty content and the maximum length. Pass the same "posts" you are about to give to integrationSchedulePostTool (a channel "integration" id, its "value" parts and its "settings"). Each channel comes back with "valid", "settingsError", "errors" (true when the media is fine, otherwise the problem), "emptyContent", "tooLong" and its "maximumCharacters".
action "shouldShortlink": tells if the texts have links that Postiz can shorten. Pass the text of the post parts as "messages". When "ask" is true, ask the user if they want the links shortened and set "shortLink" on the post accordingly.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['validate', 'shouldShortlink']),
        posts: z
          .array(
            z.object({
              integration: z.object({
                id: z.string().describe('The id of the channel'),
              }),
              value: z.array(
                z.object({
                  content: z.string().optional(),
                  image: z
                    .array(
                      z.object({
                        path: z.string(),
                        thumbnail: z.string().optional(),
                      })
                    )
                    .optional(),
                })
              ),
              settings: z
                .any()
                .optional()
                .describe('The provider settings of the post'),
            })
          )
          .optional()
          .describe('For "validate": the posts to check, one per channel'),
        messages: z
          .array(z.string())
          .optional()
          .describe('For "shouldShortlink": the text of the post parts'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            results: z.array(
              z.object({
                id: z.string(),
                identifier: z.string(),
                name: z.string(),
                valid: z.boolean(),
                settingsError: z.string(),
                errors: z.union([z.string(), z.literal(true)]),
                emptyContent: z.boolean(),
                tooLong: z.boolean(),
                maximumCharacters: z.number().nullable().optional(),
              })
            ),
          })
          .or(z.object({ ask: z.boolean() }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          if (inputData.action === 'shouldShortlink') {
            return {
              output: {
                ask: this._shortLinkService.askShortLinkedin(
                  inputData.messages || []
                ),
              },
            };
          }

          return {
            output: {
              results: await this._postsService.validatePosts(
                organizationId,
                inputData.posts || []
              ),
            },
          };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to validate the posts' },
          };
        }
      },
    });
  }
}
