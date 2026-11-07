import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AnalyticsHistoryService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.history.service';
import {
  analyticsGrains,
  analyticsPostAges,
} from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
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

const historySchema = z.array(
  z.object({
    key: z.string(),
    label: z.string(),
    category: z.string(),
    format: z.enum(['number', 'percent', 'duration']),
    aggregate: z.enum(['sum', 'average', 'last']),
    kind: z.enum(['day', 'total']),
    total: z.number(),
    previousTotal: z.number().optional(),
    percentageChange: z.number(),
    data: z.array(z.object({ total: z.string(), date: z.string() })),
  })
);

const postHistorySchema = z.array(
  z.object({
    key: z.string(),
    label: z.string(),
    category: z.string(),
    format: z.enum(['number', 'percent', 'duration']),
    data: z.array(
      z.object({ age: z.number(), date: z.string(), total: z.string() })
    ),
  })
);

const insightPost = z.object({
  id: z.string(),
  integration: z.object({
    id: z.string(),
    name: z.string(),
    providerIdentifier: z.string(),
    picture: z.string().nullable(),
  }),
  publishDate: z.string(),
  content: z.string(),
  value: z.number(),
  releaseURL: z.string().nullable(),
});

const group = { posts: z.number(), median: z.number() };

const insightsSchema = z.object({
  age: z.number(),
  timezone: z.string(),
  period: z.object({ from: z.string(), to: z.string() }),
  posts: z.number(),
  median: z.number().nullable(),
  byWeekdayHour: z.array(
    z.object({ weekday: z.number(), hour: z.number(), ...group })
  ),
  byWeekday: z.array(z.object({ weekday: z.number(), ...group })),
  byHour: z.array(z.object({ hour: z.number(), ...group })),
  byFormat: z.array(
    z.object({ format: z.enum(['video', 'image', 'text']), ...group })
  ),
  byChannel: z.array(
    z.object({ integration: insightPost.shape.integration, ...group })
  ),
  byLength: z.array(
    z.object({ length: z.enum(['short', 'medium', 'long']), ...group })
  ),
  top: z.array(insightPost),
  bottom: z.array(insightPost),
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

@Injectable()
export class AnalyticsTool implements AgentToolInterface {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _analyticsHistoryService: AnalyticsHistoryService
  ) {}
  name = 'analyticsTool';
  mirrors = [
    'GET /analytics/:integration',
    'GET /analytics/:integration/history',
    'GET /analytics/insights',
    'GET /analytics/post/:postId',
    'GET /analytics/post/:postId/history',
  ];
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
"days" is the number of days to load, 7 by default (the dashboard offers 7, 30, 90, 180 and 365, a platform serves the windows it lists in analyticsDays of integrationList).
It asks the social network, so it can take a few seconds, the result is cached for an hour, and a channel whose connection expired is refreshed first.
Pass "history" true with the "integrationId" to read the daily history Postiz collected and stored instead of asking the social network: it goes back further than the platform serves, as far as the channel has been collected, up to 3 years. "from" and "to" (YYYY-MM-DD, by default the last 90 days) pick the range, "grain" (day, week or month) the size of a point and "metrics" the metric keys to keep (all by default). Each metric has its total over the range, the total of the range of the same length before it (previousTotal, when that range is stored as well), its change in percent and its points, a point is named by the first day of its bucket. The list is empty when nothing is stored for the channel.
Pass "history" true with the "postId" to read the lifetime totals of the post that Postiz stored 1, 3, 7, 14, 30 and 90 days after it was published: each metric has its readings by age ("age" in days, "date" the day it was read, "total").
Pass "insights" true (with no integrationId or postId) to learn what the posts that did best have in common. The published posts of the range (by default the last 90 days, "from" and "to" are YYYY-MM-DD, "integrations" narrows it to channels) are compared by their engagements (else likes, comments and shares added up) "age" days after they were published (1, 3, 7, 14, 30 or 90, 7 by default), from the readings Postiz stored, so only posts that were read at that age count. The result has the median of that value overall ("posts" of them), and per weekday and hour in the "timezone" (IANA, UTC by default; weekday 0 is Sunday; only slots of at least 2 posts, best first), per weekday, per hour, per format (video, image or text), per channel and per length of text (short under 100 characters, medium, long from 280), each with its number of posts and median, and the 5 best ("top") and next 5 worst ("bottom") posts. Everything is empty when there are no such posts yet.
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
        history: z
          .boolean()
          .optional()
          .describe(
            'true to read the stored history of the channel (with the integrationId) or the stored readings of the post (with the postId)'
          ),
        insights: z
          .boolean()
          .optional()
          .describe(
            'true to compare the published posts (pass neither integrationId nor postId)'
          ),
        integrations: z
          .array(z.string())
          .optional()
          .describe(
            'Insights: only the posts of these channels, all by default'
          ),
        age: z
          .number()
          .int()
          .optional()
          .describe(
            `Insights: days after publishing the posts are compared at, one of ${analyticsPostAges.join(', ')}, 7 by default`
          ),
        timezone: z
          .string()
          .optional()
          .describe(
            'Insights: IANA timezone of the weekday and hour, UTC by default'
          ),
        from: day
          .optional()
          .describe(
            'History: first day, YYYY-MM-DD, 90 days before "to" by default'
          ),
        to: day
          .optional()
          .describe('History: last day, YYYY-MM-DD, today by default'),
        grain: z
          .enum(analyticsGrains)
          .optional()
          .describe('History: size of a point, day by default'),
        metrics: z
          .array(z.string())
          .optional()
          .describe('History: the metric keys to keep, all by default'),
      }),
      outputSchema: z.object({
        output: historySchema
          .or(postHistorySchema)
          .or(insightsSchema)
          .or(analyticsSchema)
          .or(z.object({ missing: z.literal(true) }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        if (inputData.insights) {
          if (inputData.integrationId || inputData.postId) {
            return {
              output: {
                errors:
                  'The insights compare the posts of the organization, pass neither the integrationId nor the postId',
              },
            };
          }
        } else if (!!inputData.integrationId === !!inputData.postId) {
          return {
            output: { errors: 'Pass either the integrationId or the postId' },
          };
        }

        const days = inputData.days || 7;
        try {
          if (inputData.insights) {
            return {
              output: await this._analyticsHistoryService.postInsights(
                organization.id,
                inputData
              ),
            };
          }

          if (inputData.history && inputData.postId) {
            return {
              output: await this._analyticsHistoryService.postHistory(
                organization.id,
                inputData.postId
              ),
            };
          }

          if (inputData.history) {
            return {
              output: await this._analyticsHistoryService.channelHistory(
                organization.id,
                inputData.integrationId!,
                inputData
              ),
            };
          }

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
