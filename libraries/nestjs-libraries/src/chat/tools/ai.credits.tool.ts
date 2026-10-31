import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class AiCreditsTool implements AgentToolInterface {
  constructor(private _subscriptionService: SubscriptionService) {}
  name = 'aiCreditsTool';
  mirrors = ['GET /copilot/credits'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'aiCreditsTool',
      mcp: {
        annotations: {
          title: 'Get AI Credits',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this to see how many AI credits the organization has left this month: "ai_images" (generated pictures, the default), "ai_videos" (generated videos) or "clipping_minutes" (minutes of video clipping).
Check it before generating many pictures or videos. The accounts without a paid plan have no credits.
AI credits only exist on the Postiz cloud. On a self-hosted Postiz, which has no billing, generating pictures is not limited by credits and the number returned here is not a limit.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        type: z
          .enum(['ai_images', 'ai_videos', 'clipping_minutes'])
          .optional()
          .describe('The kind of credits, ai_images by default'),
      }),
      outputSchema: z.object({
        output: z
          .object({ credits: z.number() })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        try {
          return {
            output: await this._subscriptionService.checkCredits(
              organization,
              inputData.type || 'ai_images'
            ),
          };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to load the credits' },
          };
        }
      },
    });
  }
}
