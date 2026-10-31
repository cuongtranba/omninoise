import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { AgentGraphService } from '@gitroom/nestjs-libraries/agent/agent.graph.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AbilityPolicy } from '@gitroom/nestjs-libraries/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

@Injectable()
export class PostGeneratorTool implements AgentToolInterface {
  constructor(private _agentGraphService: AgentGraphService) {}
  name = 'postGeneratorTool';
  mirrors = ['POST /posts/generator'];
  optionalOnSelfHosted = true;
  // same limit as POST /posts/generator
  policies: AbilityPolicy[] = [
    [AuthorizationActions.Create, Sections.POSTS_PER_MONTH],
  ];

  run() {
    return createTool({
      id: 'postGeneratorTool',
      mcp: {
        annotations: {
          title: 'Generate Post Text',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this to write the text of a new post with AI from a short request, the same generator as the "Generate" button of the app. It researches the topic on the internet, finds a hook and writes the content, and with "isPicture" it also generates a picture for every part and saves it in the media library. It can take a few minutes.
Nothing is scheduled: it returns the "hook", the "content" parts and a free "date" to schedule on. For the text of a single-part post join the hook and the first content part with a new line, then use integrationSchedulePostTool with the user's confirmation, the generated pictures can be passed as attachments.
"research" is what the post is about, at least 10 characters. "format" is one_short (200 characters, fits X), one_long, thread_short or thread_long (a thread of at least two parts). "tone" is personal (first person) or company (third person).
If the generation fails, the result contains output.errors.
`,
      inputSchema: z.object({
        research: z
          .string()
          .min(10)
          .describe('What the post is about, at least 10 characters'),
        isPicture: z
          .boolean()
          .describe('Generate a picture for every part of the post'),
        format: z.enum([
          'one_short',
          'one_long',
          'thread_short',
          'thread_long',
        ]),
        tone: z.enum(['personal', 'company']),
      }),
      outputSchema: z.object({
        output: z
          .object({
            hook: z.string().nullable().optional(),
            content: z.array(
              z.object({
                content: z.string(),
                website: z.string().nullable().optional(),
                image: z
                  .object({ id: z.string(), path: z.string() })
                  .nullable()
                  .optional()
                  .describe(
                    'The generated picture, as it is saved in the media library'
                  ),
              })
            ),
            date: z
              .string()
              .optional()
              .describe('A free UTC date to schedule on'),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          const generated = await this._agentGraphService.generate(
            organizationId,
            inputData
          );
          if (!generated?.content) {
            return {
              output: {
                errors: 'Failed to generate the post, please try again.',
              },
            };
          }

          return {
            output: {
              hook: generated.hook,
              content: generated.content.map((p: any) => ({
                content: p.content,
                website: p.website,
                image: p.image?.path
                  ? { id: p.image.id, path: p.image.path }
                  : undefined,
              })),
              date: generated.date,
            },
          };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to generate the post' },
          };
        }
      },
    });
  }
}
