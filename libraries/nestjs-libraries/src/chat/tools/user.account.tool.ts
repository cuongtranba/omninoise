import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

const accountSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  lastName: z.string().nullable(),
  timezoneName: z.string().nullable(),
  orgId: z.string(),
  role: z.string().optional(),
  tier: z.string(),
  totalChannels: z.number(),
  isLifetime: z.boolean(),
  isTrailing: z.boolean().optional(),
  allowTrial: z.boolean().optional(),
  streakSince: z.string().nullable(),
  admin: z.boolean(),
});

const personalSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  bio: z.string().nullable(),
  picture: z.object({ id: z.string(), path: z.string() }).nullable(),
});

const emailNotificationsSchema = z.object({
  sendSuccessEmails: z.boolean(),
  sendFailureEmails: z.boolean(),
  sendStreakEmails: z.boolean(),
});

@Injectable()
export class UserAccountTool implements AgentToolInterface {
  constructor(private _usersService: UsersService) {}
  name = 'userAccountTool';
  mirrors = [
    'GET /user/self',
    'GET /user/personal',
    'POST /user/personal',
    'GET /user/email-notifications',
    'POST /user/email-notifications',
    'POST /user/timezone',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'userAccountTool',
      mcp: {
        annotations: {
          title: 'Manage My Account',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Use this for the personal account of the connected user (not of the organization). It is about the user who connected, so this needs a connection through OAuth, an API key has no user.
action "self": who the user is and where they are: id, email, name, the organization they are working in (orgId), their role in it, the plan (tier, totalChannels) and whether they are the super admin of the instance. It never returns the password or the API key.
action "getPersonal": the name, bio and profile picture.
action "updatePersonal": saves the "fullname" (at least 3 characters) and the "bio" (omit it to keep it). The profile picture stays as it is, it can only be changed in the Postiz app.
action "getEmailNotifications": which emails the user receives: for posts published, posts that failed and the streak.
action "updateEmailNotifications": pass the three flags "sendSuccessEmails", "sendFailureEmails" and "sendStreakEmails", all of them are saved.
action "setTimezone": saves the IANA timezone (such as Europe/Berlin) in "timezoneName", leave it empty to use the timezone of the browser again.
Show the user the change before saving it. If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum([
          'self',
          'getPersonal',
          'updatePersonal',
          'getEmailNotifications',
          'updateEmailNotifications',
          'setTimezone',
        ]),
        fullname: z
          .string()
          .min(3)
          .optional()
          .describe('For "updatePersonal": the name of the user'),
        bio: z.string().optional().describe('For "updatePersonal": the bio'),
        sendSuccessEmails: z
          .boolean()
          .optional()
          .describe('For "updateEmailNotifications"'),
        sendFailureEmails: z
          .boolean()
          .optional()
          .describe('For "updateEmailNotifications"'),
        sendStreakEmails: z
          .boolean()
          .optional()
          .describe('For "updateEmailNotifications"'),
        timezoneName: z
          .string()
          .optional()
          .describe(
            'For "setTimezone": an IANA timezone, empty to use the browser timezone'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({ account: accountSchema })
          .or(z.object({ personal: personalSchema }))
          .or(z.object({ emailNotifications: emailNotificationsSchema }))
          .or(z.object({ timezoneName: z.string().nullable() }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        // the whole organization is parsed, the account is read as users[0].userId
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        const userId = organization.users?.[0]?.userId;
        if (!userId) {
          return {
            output: {
              errors:
                'The account belongs to a user, connect through OAuth instead of an API key',
            },
          };
        }

        try {
          if (inputData.action === 'self') {
            const user = await this._usersService.getUserById(userId);
            if (!user) {
              return { output: { errors: 'The user was not found' } };
            }
            const account = this._usersService.getAccount(user, organization);
            return {
              output: {
                account: {
                  ...account,
                  streakSince: account.streakSince
                    ? new Date(account.streakSince).toISOString()
                    : null,
                },
              },
            };
          }

          if (inputData.action === 'updatePersonal') {
            if (!inputData.fullname) {
              return { output: { errors: 'The fullname is required' } };
            }
            await this._usersService.changePersonal(userId, {
              fullname: inputData.fullname,
              bio: inputData.bio as string,
            });
          }

          if (
            inputData.action === 'getPersonal' ||
            inputData.action === 'updatePersonal'
          ) {
            const personal = await this._usersService.getPersonal(userId);
            if (!personal) {
              return { output: { errors: 'The user was not found' } };
            }
            return {
              output: {
                personal: {
                  id: personal.id,
                  name: personal.name,
                  bio: personal.bio,
                  picture: personal.picture
                    ? { id: personal.picture.id, path: personal.picture.path }
                    : null,
                },
              },
            };
          }

          if (inputData.action === 'updateEmailNotifications') {
            if (
              inputData.sendSuccessEmails === undefined ||
              inputData.sendFailureEmails === undefined ||
              inputData.sendStreakEmails === undefined
            ) {
              return {
                output: {
                  errors:
                    'sendSuccessEmails, sendFailureEmails and sendStreakEmails are required',
                },
              };
            }
            await this._usersService.updateEmailNotifications(userId, {
              sendSuccessEmails: inputData.sendSuccessEmails,
              sendFailureEmails: inputData.sendFailureEmails,
              sendStreakEmails: inputData.sendStreakEmails,
            });
          }

          if (
            inputData.action === 'getEmailNotifications' ||
            inputData.action === 'updateEmailNotifications'
          ) {
            const emailNotifications =
              await this._usersService.getEmailNotifications(userId);
            if (!emailNotifications) {
              return { output: { errors: 'The user was not found' } };
            }
            return { output: { emailNotifications } };
          }

          await this._usersService.updateTimezone(userId, {
            timezoneName: inputData.timezoneName,
          });
          return { output: { timezoneName: inputData.timezoneName || null } };
        } catch (err: any) {
          return {
            output: { errors: err?.message || 'Failed to manage the account' },
          };
        }
      },
    });
  }
}
