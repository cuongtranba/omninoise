import yargs from 'yargs';
import { Api } from './api';
import { credentialsPath, deleteCredentials, resolveAuth } from './config';
import { CliError, Context, printJson } from './context';
import { login } from './oauth';
import { publish } from './publish';

const table = (rows: string[][]) => {
  const widths = rows[0].map((_, c) =>
    Math.max(...rows.map((r) => (r[c] ?? '').length))
  );
  return rows
    .map((r) =>
      r
        .map((cell, c) => (cell ?? '').padEnd(widths[c]))
        .join('  ')
        .trimEnd()
    )
    .join('\n');
};

const oneLine = (s: unknown, max = 60) => {
  const text = String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const apiFor = async (ctx: Context, url?: string) => {
  const auth = await resolveAuth(ctx, url);
  return new Api(auth.url, auth.secret);
};

const DAY = 24 * 60 * 60 * 1000;

const urlOption = {
  describe: 'Backend URL, e.g. https://your-host/api',
  type: 'string',
} as const;
const jsonOption = {
  describe: 'Print JSON',
  type: 'boolean',
  default: false,
} as const;

/** Runs the CLI and returns the exit code. Output goes to ctx, never to the process directly. */
export const run = async (argv: string[], ctx: Context): Promise<number> => {
  try {
    await yargs(argv)
      .scriptName('omninoise')
      .usage('$0 <command> [options]')
      .exitProcess(false)
      .strict()
      .demandCommand(1, 'Pass a command; see --help')
      .recommendCommands()
      .fail((message: string, err: Error | undefined) => {
        throw err ?? new CliError(message);
      })
      .command(
        'auth:login',
        'Log in through the browser and save the credentials',
        (y) => y.option('url', urlOption),
        (a) => login(ctx, a.url)
      )
      .command(
        'auth:logout',
        'Delete the saved credentials',
        (y) => y,
        async () => {
          const existed = await deleteCredentials(ctx.env);
          ctx.stdout.write(
            existed
              ? `Removed ${credentialsPath(ctx.env)}\n`
              : 'No saved credentials.\n'
          );
        }
      )
      .command(
        'auth:status',
        'Show who the CLI is logged in as',
        (y) => y.option('url', urlOption),
        async (a) => {
          const auth = await resolveAuth(ctx, a.url);
          const me = await new Api(auth.url, auth.secret).me();
          ctx.stdout.write(
            [
              `Instance:     ${auth.url}`,
              `Organization: ${me.organization?.name ?? '?'} (${
                me.organization?.id ?? '?'
              })`,
              `User:         ${me.user?.name ?? 'none (API key)'}`,
              `Credentials:  ${
                auth.source === 'env'
                  ? 'OMNINOISE_API_KEY'
                  : credentialsPath(ctx.env)
              }`,
            ].join('\n') + '\n'
          );
        }
      )
      .command(
        'channels',
        'List the connected channels',
        (y) => y.option('url', urlOption).option('json', jsonOption),
        async (a) => {
          const channels: any[] = await (
            await apiFor(ctx, a.url)
          ).integrations();
          if (a.json) return printJson(ctx, channels);
          ctx.stdout.write(
            `${table([
              ['ID', 'NAME', 'PLATFORM', 'DISABLED'],
              ...channels.map((c) => [
                c.id,
                c.name,
                c.identifier,
                c.disabled ? 'yes' : 'no',
              ]),
            ])}\n`
          );
        }
      )
      .command('posts', 'List or delete posts', (y) =>
        y
          .command(
            'list',
            'List posts in a date range',
            (l) =>
              l
                .option('url', urlOption)
                .option('from', {
                  describe: 'Start (ISO date), default today',
                  type: 'string',
                })
                .option('to', {
                  describe: 'End (ISO date), default 30 days after --from',
                  type: 'string',
                })
                .option('json', jsonOption),
            async (a) => {
              const from = a.from
                ? new Date(a.from)
                : new Date(new Date().setUTCHours(0, 0, 0, 0));
              const to = a.to
                ? new Date(a.to)
                : new Date(from.getTime() + 30 * DAY);
              if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
                throw new CliError(
                  '--from and --to must be dates like 2026-11-05 or 2026-11-05T12:00:00Z'
                );
              }
              const res = await (
                await apiFor(ctx, a.url)
              ).posts(from.toISOString(), to.toISOString());
              const posts: any[] = res?.posts ?? [];
              if (a.json) return printJson(ctx, posts);
              ctx.stdout.write(
                `${table([
                  ['ID', 'DATE', 'CHANNEL', 'STATE', 'CONTENT'],
                  ...posts.map((p) => [
                    p.id,
                    p.publishDate ?? '',
                    p.integration?.providerIdentifier ??
                      p.integration?.name ??
                      '',
                    p.state ?? '',
                    oneLine(p.content),
                  ]),
                ])}\n`
              );
            }
          )
          .command(
            'delete <id>',
            'Delete a post (and the rest of its group)',
            (d) =>
              d
                .positional('id', { type: 'string', demandOption: true })
                .option('url', urlOption)
                .option('yes', {
                  describe: 'Do not ask',
                  type: 'boolean',
                  default: false,
                }),
            async (a) => {
              const api = await apiFor(ctx, a.url);
              if (
                !a.yes &&
                !(await ctx.confirm(`Delete post ${a.id}? [y/N] `))
              ) {
                ctx.stdout.write('Cancelled.\n');
                return;
              }
              printJson(ctx, await api.deletePost(a.id));
            }
          )
          .demandCommand(1, 'Use "posts list" or "posts delete <id>"')
      )
      .command(
        'upload <file>',
        'Upload a file to the media library',
        (y) =>
          y
            .positional('file', { type: 'string', demandOption: true })
            .option('url', urlOption),
        async (a) => {
          printJson(ctx, await (await apiFor(ctx, a.url)).upload(a.file));
        }
      )
      .command(
        'analytics [integrationId]',
        'Analytics for a channel, or for one post with --post',
        (y) =>
          y
            .positional('integrationId', { type: 'string' })
            .option('post', { describe: 'Post id', type: 'string' })
            .option('days', {
              describe: 'Days to load',
              type: 'number',
              default: 7,
            })
            .option('url', urlOption),
        async (a) => {
          if (!a.integrationId === !a.post) {
            throw new CliError('Pass either an integration id or --post <id>');
          }
          const api = await apiFor(ctx, a.url);
          printJson(
            ctx,
            a.post
              ? await api.postAnalytics(a.post, a.days)
              : await api.analytics(a.integrationId!, a.days)
          );
        }
      )
      .command(
        'publish <dir>',
        'Schedule a rendered video on every channel of the profile',
        (y) =>
          y
            .positional('dir', {
              describe: 'Project folder with publish.yaml and out/',
              type: 'string',
              demandOption: true,
            })
            .option('at', {
              describe: 'Publish time in UTC, 2026-11-05T12:00:00Z',
              type: 'string',
              demandOption: true,
            })
            .option('dry-run', {
              describe: 'Print the request body, upload nothing',
              type: 'boolean',
              default: false,
            })
            .option('profile', {
              describe:
                'omninoise.profile.yaml (default: found above the project)',
              type: 'string',
            })
            .option('url', urlOption),
        (a) =>
          publish(ctx, {
            dir: a.dir,
            at: a.at,
            dryRun: a.dryRun,
            profile: a.profile,
            url: a.url,
          })
      )
      .parseAsync();
    return 0;
  } catch (e: any) {
    ctx.stderr.write(
      `error: ${e instanceof CliError ? e.message : (e?.stack ?? e)}\n`
    );
    return 1;
  }
};
