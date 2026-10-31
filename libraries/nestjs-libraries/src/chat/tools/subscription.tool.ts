import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/permissions/permission.exception.class';

const subscriptionSchema = z.object({
  subscriptionTier: z.string(),
  period: z.string(),
  totalChannels: z.number(),
  isLifetime: z.boolean(),
  cancelAt: z.string().nullable(),
  createdAt: z.string(),
  platform: z.string().nullable(),
});

const tierSchema = z.object({
  name: z.string().nullable(),
  price: z.number().nullable(),
});

@Injectable()
export class SubscriptionTool implements AgentToolInterface {
  constructor(private _paymentService: PaymentService) {}
  name = 'subscriptionTool';
  mirrors = ['GET /user/subscription', 'GET /user/subscription/tiers'];
  optionalOnSelfHosted = true;
  // same limit as the routes of the web app
  policies: AgentToolInterface['policies'] = [
    [AuthorizationActions.Create, Sections.ADMIN],
  ];

  run() {
    return createTool({
      id: 'subscriptionTool',
      mcp: {
        annotations: {
          title: 'Get Subscription',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      description: `
Use this to read the subscription of the organization. It needs an admin of the organization. Nothing is bought or changed here, the subscription is managed in the Postiz app.
action "current": the plan of the organization: tier, billing period, number of channels, whether it is a lifetime plan, when it ends ("cancelAt", if it was cancelled) and the platform where it is managed ("web" or "mobile"). "subscription" is null when there is none (a self-hosted Postiz has no billing).
action "tiers": the plans that can be bought, grouped by billing period ("month" or "year"), with their name and price. It asks the payment provider, so it can take a few seconds and fails on an install without billing.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['current', 'tiers']),
      }),
      outputSchema: z.object({
        output: z
          .object({ subscription: subscriptionSchema.nullable() })
          .or(z.object({ tiers: z.record(z.string(), z.array(tierSchema)) }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          if (inputData.action === 'current') {
            const subscription = await this._paymentService.getSubscription(
              organizationId
            );
            // picked one by one: the row also holds the id of the payment provider
            return {
              output: {
                subscription: subscription
                  ? {
                      subscriptionTier: subscription.subscriptionTier,
                      period: subscription.period,
                      totalChannels: subscription.totalChannels,
                      isLifetime: subscription.isLifetime,
                      cancelAt: subscription.cancelAt?.toISOString() ?? null,
                      createdAt: subscription.createdAt.toISOString(),
                      platform: subscription.platform ?? null,
                    }
                  : null,
              },
            };
          }

          const packages: Record<string, any[]> = await this._paymentService
            .getDefaultProvider('web')
            .getPackages();
          return {
            output: {
              tiers: Object.fromEntries(
                Object.entries(packages).map(([period, plans]) => [
                  period,
                  plans.map((plan) => ({
                    name: plan.name ?? null,
                    price: plan.price ?? null,
                  })),
                ])
              ),
            },
          };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to load the subscription',
            },
          };
        }
      },
    });
  }
}
