import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

dayjs.extend(utc);

const settingSchema = z.object({
  title: z.string(),
  description: z.string(),
  type: z.enum(['checkbox', 'text', 'textarea']),
  value: z.any(),
  regex: z.string().optional(),
});

@Injectable()
export class IntegrationGetTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationGetTool';
  // the dashboard reads the posting times and settings of a channel from its entry of the list
  mirrors = ['GET /integrations/list'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'integrationGetTool',
      mcp: {
        annotations: {
          title: 'Get a Channel',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this to read one channel in full: its name, the group it belongs to, its posting times, its settings and what can be changed on it. Get the channel "id" from integrationList.
"postingTimes" are the times of day posts are suggested for, in UTC ("utc" is HH:mm), change them with integrationTimesTool.
"additionalSettings" are the settings of the channel, change them with integrationUpdateTool.
"canChangeNickname" and "canChangeProfilePicture" say if integrationProfileTool can change the name and picture of the channel on the platform.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        id: z.string().describe('The "id" of the channel from integrationList'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            id: z.string(),
            name: z.string(),
            customName: z.string().nullable(),
            platform: z.string(),
            picture: z.string().nullable(),
            profile: z.string().nullable(),
            disabled: z.boolean(),
            inBetweenSteps: z.boolean(),
            refreshNeeded: z.boolean(),
            group: z.object({ id: z.string(), name: z.string() }).nullable(),
            postingTimes: z.array(
              z.object({ time: z.number(), utc: z.string() })
            ),
            additionalSettings: z.array(settingSchema),
            canChangeNickname: z.boolean(),
            canChangeProfilePicture: z.boolean(),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          const channel = (
            await this._integrationService.getIntegrationsListForDisplay(
              organizationId
            )
          ).find((p) => p.id === inputData.id);
          if (!channel) {
            return {
              output: {
                errors:
                  'Channel not found, use integrationList to get a valid channel id',
              },
            };
          }

          return {
            output: {
              id: channel.id,
              name: channel.originalName,
              customName:
                channel.name !== channel.originalName ? channel.name : null,
              platform: channel.identifier,
              picture: channel.picture,
              profile: channel.display,
              disabled: channel.disabled,
              inBetweenSteps: channel.inBetweenSteps,
              refreshNeeded: channel.refreshNeeded,
              group: channel.customer
                ? { id: channel.customer.id, name: channel.customer.name }
                : null,
              postingTimes: (channel.time as { time: number }[]).map(
                ({ time }) => ({
                  time,
                  utc: dayjs
                    .utc()
                    .startOf('day')
                    .add(time, 'minutes')
                    .format('HH:mm'),
                })
              ),
              additionalSettings: JSON.parse(channel.additionalSettings),
              canChangeNickname: channel.changeNickName,
              canChangeProfilePicture: channel.changeProfilePicture,
            },
          };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to read the channel' },
          };
        }
      },
    });
  }
}
