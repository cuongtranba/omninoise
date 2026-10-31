import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AllProvidersSettings } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';
import {
  PostValidationError,
  PostValidationException,
} from '@gitroom/nestjs-libraries/database/prisma/posts/posts.validation.exception';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AbilityPolicy } from '@gitroom/nestjs-libraries/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';
import {
  ValidUrlExtension,
  ValidUrlPath,
} from '@gitroom/helpers/utils/valid.url.path';

const validUrlExtension = new ValidUrlExtension();
const validUrlPath = new ValidUrlPath();

// Same URL validation as MediaDto (valid.url.path) - each attachment must
// point to an allowed upload domain and a supported file extension.
const attachmentUrl = z
  .string()
  .refine((url) => validUrlPath.validate(url, {} as any), {
    message: validUrlPath.defaultMessage({} as any),
  })
  .refine((url) => validUrlExtension.validate(url, {} as any), {
    message: validUrlExtension.defaultMessage({} as any),
  });

// Attachments are either a plain URL string or { path, alt?, thumbnail?,
// thumbnailTimestamp? }, the same per-media fields as the public API.
const attachment = z.union([
  attachmentUrl,
  z.object({
    path: attachmentUrl,
    alt: z.string().optional(),
    thumbnail: attachmentUrl.optional(),
    thumbnailTimestamp: z.number().int().min(0).optional(),
  }),
]);

// The error is the only thing returned on failure, so the posts that were
// already created are listed in it.
const alreadyCreated = (created: { postId: string; previewUrl: string }[]) =>
  created.length
    ? ` Posts already created before this error (do not create them again): ${created
        .map((p) => `${p.postId} (${p.previewUrl})`)
        .join(', ')}.`
    : '';

const toMedia = (
  a:
    | string
    | {
        path: string;
        alt?: string;
        thumbnail?: string;
        thumbnailTimestamp?: number;
      }
) =>
  typeof a === 'string'
    ? { path: a }
    : {
        path: a.path,
        alt: a.alt,
        thumbnail: a.thumbnail,
        thumbnailTimestamp: a.thumbnailTimestamp,
      };

@Injectable()
export class IntegrationSchedulePostTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'integrationSchedulePostTool';
  mirrors = ['POST /posts'];
  // same limit as POST /posts
  policies: AbilityPolicy[] = [
    [AuthorizationActions.Create, Sections.POSTS_PER_MONTH],
  ];

  run() {
    return createTool({
      id: 'schedulePostTool',
      mcp: {
        annotations: {
          title: 'Schedule Social Media Post',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this when the user wants to create a draft, scheduled, or immediate social media post on their connected channels, based on the integrationSchema tool.
Examples of the input shape:

A single LinkedIn post with one comment
- socialPost array length will be one
- postsAndComments array length will be two (one for the post, one for the comment)

20 Facebook posts each on individual days without comments
- socialPost array length will be 20
- postsAndComments array length will be one

Do not use this to update or delete existing posts.
On success, each item in output contains a previewUrl the user can open to see the post.
If validation fails, the result contains output.errors describing what to fix; the call can be retried with corrected parameters.
`,
      inputSchema: z.object({
        socialPost: z
          .array(
            z.object({
              integrationId: z
                .string()
                .describe('The id of the integration (not internal id)'),
              isPremium: z
                .boolean()
                .describe(
                  "If the integration is X, return if it's premium or not"
                ),
              date: z.string().describe('The date of the post in UTC time'),
              shortLink: z
                .boolean()
                .describe(
                  'If the post has a link inside, we can ask the user if they want to add a short link'
                ),
              type: z
                .enum(['draft', 'schedule', 'now'])
                .describe(
                  'The type of the post, if we pass now, we should pass the current date also'
                ),
              postsAndComments: z
                .array(
                  z.object({
                    content: z
                      .string()
                      .describe(
                        'The content of the post, HTML, Each line must be wrapped in <p> here is the possible tags: h1, h2, h3, u, strong, li, ul, p (you can\'t have u and strong together), img (<img src="...">) only when the integration rules say pictures go inside the content, and span only for a mention in the exact format given by a mention tool from the integrationSchema tools'
                      ),
                    attachments: z
                      .array(attachment)
                      .describe(
                        'The media of the post: either an uploaded media URL string, or { path, alt?, thumbnail?, thumbnailTimestamp? } where path is the uploaded media URL, alt is its alt text, thumbnail is the path of an uploaded jpeg/png (returned by uploadFromUrlTool) used as the video thumbnail / cover, and thumbnailTimestamp is the video frame to use as the cover, in milliseconds'
                      ),
                  })
                )
                .describe(
                  'first item is the post, every other item is the comments'
                ),
              settings: z
                .array(
                  z.object({
                    key: z
                      .string()
                      .describe('Name of the settings key to pass'),
                    value: z
                      .any()
                      .describe(
                        'Value of the key, always prefer the id then label if possible. When the settings schema says a field is an id, pass the id returned by the channel tools, never the display label'
                      ),
                  })
                )
                .describe(
                  'This relies on the integrationSchema tool to get the settings [input:settings]'
                ),
            })
          )
          .describe('Individual post'),
      }),
      outputSchema: z.object({
        output: z
          .array(
            z.object({
              postId: z.string(),
              integration: z.string(),
              previewUrl: z
                .string()
                .describe(
                  'Public preview page of the created post, share it with the user'
                ),
            })
          )
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;
        // The same body the dashboard sends to POST /posts, one per socialPost
        // (each has its own date and type)
        const bodies = inputData.socialPost.map((post) => ({
          date: post.date,
          type: post.type,
          shortLink: post.shortLink,
          tags: [],
          posts: [
            {
              integration: { id: post.integrationId },
              group: makeId(10),
              settings: post.settings.reduce(
                (
                  acc: AllProvidersSettings,
                  s: { key: string; value: any }
                ) => ({
                  ...acc,
                  [s.key]: s.value,
                }),
                {} as AllProvidersSettings
              ),
              value: post.postsAndComments.map((p: any) => ({
                content: p.content,
                id: makeId(10),
                delay: 0,
                image: (p.attachments || []).map((a: any) => ({
                  id: makeId(10),
                  ...toMedia(a),
                })),
              })),
            },
          ],
        }));

        // Every socialPost is validated before any is created, so an invalid
        // one creates nothing
        try {
          for (const body of bodies) {
            await this._postsService.assertPostsValid(
              organizationId,
              body.type,
              body.posts
            );
          }
        } catch (err) {
          if (!(err instanceof PostValidationException)) {
            throw err;
          }

          const { name, error, reason, maximumCharacters } =
            err.getResponse() as PostValidationError;
          const retry =
            ', please fix it, and try integrationSchedulePostTool again.';
          const message =
            reason === 'emptyContent'
              ? error
              : reason === 'tooLong'
              ? `The maximum characters is ${maximumCharacters}${retry}`
              : `${error}${retry}`;

          return { output: { errors: `${name}: ${message}` } };
        }

        // Posts created before a failure stay created, so they are reported
        // together with the error
        const finalOutput = [];
        try {
          for (const body of bodies) {
            const output = await this._postsService.mapAndCreatePosts(
              organizationId,
              body,
              'MCP'
            );
            // Same public preview page the calendar "Preview Post" button opens.
            finalOutput.push(
              ...output.map((p) => ({
                ...p,
                previewUrl: `${process.env.FRONTEND_URL}/p/${p.postId}?share=true`,
              }))
            );
          }
        } catch (err) {
          if (!finalOutput.length) {
            throw err;
          }
          return {
            output: {
              errors: `${(err as Error).message}${alreadyCreated(finalOutput)}`,
            },
          };
        }

        return {
          output: finalOutput,
        };
      },
    });
  }
}
