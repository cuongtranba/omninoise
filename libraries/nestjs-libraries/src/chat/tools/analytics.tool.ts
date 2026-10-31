import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

const analyticsSchema = z.array(
  z.object({
    label: z.string(),
    data: z.array(
      z.object({
        total: z.union([z.string(), z.number()]),
        date: z.string(),
      })
    ),
    percentageChange: z.union([z.number(), z.string()]).nullable().optional(),
  })
);

@Injectable()
export class AnalyticsTool implements AgentToolInterface {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService
  ) {}
  name = 'analyticsTool';
  mirrors = ['GET /analytics/:integration', 'GET /analytics/post/:postId'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'analyticsTool',
      mcp: {
        annotations: {
          title: 'Get Analytics',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      description: `
Use this to read the analytics of a channel or of one published post, the numbers the social network reports (followers, impressions, likes and so on, each with its values per day and the change in percent).
Pass either "integrationId" (the id of the channel, from integrationListTool) for the analytics of the whole channel, or "postId" (the id of a published post, from postsListTool or postsBrowseTool) for the analytics of that post.
"days" is the number of days to load, 7 by default (the dashboard offers 7, 30 and 90).
It asks the social network, so it can take a few seconds, the result is cached for an hour, and a channel whose connection expired is refreshed first.
The list is empty when the channel or the platform has no analytics, or when the post is not published yet. For a post that Postiz could not find on the social network the result is { missing: true }, see postReleaseTool.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        integrationId: z
          .string()
          .optional()
          .describe('The id of the channel, pass this or the postId'),
        postId: z
          .string()
          .optional()
          .describe(
            'The id of the published post, pass this or the integrationId'
          ),
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe('How many days to load, 7 by default'),
      }),
      outputSchema: z.object({
        output: analyticsSchema
          .or(z.object({ missing: z.literal(true) }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        if (!!inputData.integrationId === !!inputData.postId) {
          return {
            output: { errors: 'Pass either the integrationId or the postId' },
          };
        }

        const days = inputData.days || 7;
        try {
          if (inputData.postId) {
            return {
              output: await this._postsService.checkPostAnalytics(
                organization.id,
                inputData.postId,
                days
              ),
            };
          }

          return {
            output: await this._integrationService.checkAnalytics(
              organization,
              inputData.integrationId!,
              String(days)
            ),
          };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to load the analytics' },
          };
        }
      },
    });
  }
}
