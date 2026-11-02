import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class NotificationsTool implements AgentToolInterface {
  constructor(private _notificationService: NotificationService) {}
  name = 'notificationsTool';
  mirrors = ['GET /notifications', 'GET /notifications/list'];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'notificationsTool',
      mcp: {
        annotations: {
          title: 'Read Notifications',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this for the notifications of the bell of Postiz (posts published, posts that failed, channels that need attention). They belong to the organization, and what is "new" is counted per user.
action "unread": how many notifications arrived since the user last opened the list. Nothing changes.
action "list": the latest 10 notifications, newest first, with "lastReadNotifications" (when the user last opened the list). Like opening the bell in the app it marks everything as read for the user.
It is the notifications of the user who connected, so this needs a connection through OAuth, an API key has no user.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['unread', 'list']),
      }),
      outputSchema: z.object({
        output: z
          .object({ total: z.number() })
          .or(
            z.object({
              lastReadNotifications: z.string().nullable(),
              notifications: z.array(
                z.object({ createdAt: z.string(), content: z.string() })
              ),
            })
          )
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        // the whole organization is parsed, the notifications are read as users[0].userId
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        const userId = organization.users?.[0]?.userId;
        if (!userId) {
          return {
            output: {
              errors:
                'Notifications are read per user, connect through OAuth instead of an API key',
            },
          };
        }

        try {
          if (inputData.action === 'unread') {
            return {
              output: await this._notificationService.getMainPageCount(
                organization.id,
                userId
              ),
            };
          }

          const { lastReadNotifications, notifications } =
            await this._notificationService.getNotifications(
              organization.id,
              userId
            );
          return {
            output: {
              lastReadNotifications:
                lastReadNotifications?.toISOString() ?? null,
              notifications: notifications.map((notification) => ({
                createdAt: notification.createdAt.toISOString(),
                content: notification.content,
              })),
            },
          };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to read the notifications',
            },
          };
        }
      },
    });
  }
}
