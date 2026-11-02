import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { AnnouncementsService } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.service';
import {
  checkAuth,
  toolErrorMessage,
} from '@gitroom/nestjs-libraries/chat/auth.context';

const announcementSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  color: z.enum(['INFO', 'WARNING', 'ERROR']),
  createdAt: z.string(),
});

const toAnnouncement = (row: {
  id: string;
  title: string;
  description: string;
  color: 'INFO' | 'WARNING' | 'ERROR';
  createdAt: Date;
}) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  color: row.color,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class AnnouncementsTool implements AgentToolInterface {
  constructor(
    private _usersService: UsersService,
    private _announcementsService: AnnouncementsService
  ) {}
  name = 'announcementsTool';
  mirrors = [
    'GET /announcements',
    'POST /announcements',
    'DELETE /announcements/:id',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'announcementsTool',
      mcp: {
        annotations: {
          title: 'Manage Announcements',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this for the announcements, the banner messages every user of the Postiz instance sees in the app.
action "list": the current announcements, newest first. Every connection can read them.
action "create": publishes an announcement ("title", "description" and an optional "color" INFO, WARNING or ERROR) to every user of the instance at once. Only the super admin of the instance (the operator of the installation) can create and delete, for everybody else the result contains output.errors with "Unauthorized", and it needs a connection through OAuth, an API key has no user and is always refused. Show the user the text first and get their confirmation.
action "delete": removes the announcement with the given "id" (list them first to get it) for everybody, it cannot be undone. Same super admin rule.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'delete']),
        id: z
          .string()
          .optional()
          .describe('For "delete": the "id" of the announcement'),
        title: z.string().optional().describe('For "create": the title'),
        description: z
          .string()
          .optional()
          .describe('For "create": the text of the announcement'),
        color: z
          .enum(['INFO', 'WARNING', 'ERROR'])
          .optional()
          .describe('For "create": INFO by default'),
      }),
      outputSchema: z.object({
        output: z
          .object({ announcements: z.array(announcementSchema) })
          .or(z.object({ created: announcementSchema }))
          .or(z.object({ deleted: z.object({ id: z.string() }) }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        // the whole organization is parsed, the caller is read as users[0].userId
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        try {
          if (inputData.action === 'list') {
            return {
              output: {
                announcements: (
                  await this._announcementsService.getAnnouncements()
                ).map(toAnnouncement),
              },
            };
          }

          // the same super admin check as the web, on the user read from the database
          await this._usersService.assertSuperAdminById(
            organization.users?.[0]?.userId
          );

          if (inputData.action === 'create') {
            if (!inputData.title || !inputData.description) {
              return {
                output: {
                  errors: 'The title and the description are required',
                },
              };
            }
            return {
              output: {
                created: toAnnouncement(
                  await this._announcementsService.createAnnouncement({
                    title: inputData.title,
                    description: inputData.description,
                    color: inputData.color,
                  })
                ),
              },
            };
          }

          if (!inputData.id) {
            return { output: { errors: 'The id is required' } };
          }
          await this._announcementsService.deleteAnnouncement(inputData.id);
          return { output: { deleted: { id: inputData.id } } };
        } catch (err: any) {
          return {
            output: {
              errors: toolErrorMessage(
                err,
                'The announcement was not found',
                'Failed to manage the announcements'
              ),
            },
          };
        }
      },
    });
  }
}
