# Omninoise CLI

`omninoise` is the command line for an Omninoise instance. It logs in through your browser, lists your channels and posts, uploads media, reads analytics, and publishes a rendered video to every channel in one command.

It talks to the Public API (`/public/v1`) of your instance and needs Node.js 22 or newer.

## Install

```bash
npm install -g omninoise
omninoise --help
```

## Log in

```bash
omninoise auth:login --url https://your-host/api
```

`--url` is the backend URL of your instance, the same one the dashboard uses for its API. The command:

1. starts a listener on `127.0.0.1` on a random port,
2. registers itself as a public OAuth client named "Omninoise CLI" (PKCE, S256),
3. opens the consent page in your browser (the URL is printed too, in case no browser opens),
4. waits up to five minutes for you to approve, then exchanges the code for an access token.

The token is saved to `~/.config/omninoise/credentials.json` (or `$XDG_CONFIG_HOME/omninoise/credentials.json`) with mode `0600`, in a directory with mode `0700`. The token is never printed. It does not expire; logging in again replaces it, and `auth:logout` deletes the file.

If the discovery document (`/.well-known/oauth-authorization-server/mcp-oauth-dynamic`) is not reachable, the CLI derives the endpoints from the backend URL: the consent page is the backend URL without a trailing `/api`, which you can override with `OMNINOISE_FRONTEND_URL`.

### Without a browser: an API key

Set an organization API key (Settings → Developers) instead of logging in:

```bash
export OMNINOISE_API_KEY=...
export OMNINOISE_URL=https://your-host/api
```

## Environment variables

| Variable                 | Meaning                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `OMNINOISE_API_KEY`      | Organization API key. Used instead of the saved login. Needs `OMNINOISE_URL` or `--url` (below). |
| `OMNINOISE_URL`          | Backend URL of the instance, e.g. `https://your-host/api`. Same as `--url`.                      |
| `OMNINOISE_FRONTEND_URL` | Only for `auth:login`, when the consent page is not at the backend URL minus `/api`.             |
| `XDG_CONFIG_HOME`        | Moves the credentials file (default `~/.config`).                                                |

The instance, and so where the secret is sent, is chosen only by `--url`, then `OMNINOISE_URL`, then the saved login. A profile's `instance.url` never picks it: `publish` checks it against the chosen instance and refuses, before uploading anything, if they differ. With a saved login, an instance that differs from the one you logged in to is an error, not a silent fallback.

Credentials are chosen from `OMNINOISE_API_KEY` first, then the saved login.

## Commands

Every command that calls the API also accepts `--url <backend url>`.

| Command                                                                      | What it does                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `omninoise auth:login [--url <url>]`                                         | Log in through the browser and save the credentials.                |
| `omninoise auth:logout`                                                      | Delete the saved credentials.                                       |
| `omninoise auth:status`                                                      | Show the instance, organization and user. Never prints the token.   |
| `omninoise channels [--json]`                                                | List the connected channels: id, name, platform, disabled.          |
| `omninoise posts list [--from <date>] [--to <date>] [--json]`                | List posts in a range. Default: today to 30 days ahead.             |
| `omninoise posts delete <id> [--yes]`                                        | Delete a post and the rest of its group. Asks `y/N` unless `--yes`. |
| `omninoise upload <file>`                                                    | Upload a file to the media library; prints `{"id","path"}`.         |
| `omninoise analytics <integrationId> [--days 7]`                             | Analytics for a channel.                                            |
| `omninoise analytics --post <postId> [--days 7]`                             | Analytics for one post.                                             |
| `omninoise publish <project-dir> --at <time> [--dry-run] [--profile <file>]` | Schedule a rendered video on every channel in the profile.          |

The public API has no route to change a post's date, so there is no `posts move`.

## Publish a video

```bash
omninoise publish ./videos/my-video --at 2026-11-05T12:00:00Z --dry-run   # print the request, upload nothing
omninoise publish ./videos/my-video --at 2026-11-05T12:00:00Z
```

`--at` is a UTC time of the form `YYYY-MM-DDTHH:MM:00Z`. The project folder name is the **slug**. It holds:

```
my-video/
  publish.yaml
  out/
    my-video-1080x1920.mp4        the English cut
    my-video-vi-1080x1920.mp4     optional, the Vietnamese cut
    cover-1080x1920.jpg           Instagram cover (needed when the profile has instagram)
    thumb-1280x720.jpg            YouTube thumbnail (needed when the profile has youtube)
```

`publish` uploads the files with `POST /public/v1/upload`, then creates one scheduled post per channel in the profile with `POST /public/v1/posts` (`creationMethod: "CLI"`). It prints a one-line summary to stderr and the result JSON to stdout. `--dry-run` prints the request body with placeholder media paths (`<instance origin>/uploads/dry/<file>`) and uploads and posts nothing.

Before anything is uploaded it also reads `GET /public/v1/integrations` and refuses a profile whose channel is missing, disabled or on another platform than its key. It refuses a project that breaks a rule from the profile: a `ban` string anywhere in `publish.yaml`, a `hashtag_ban` string in a hashtag, a caption without the AI disclosure, hashtag counts outside the channel's range, a post without its channel footer, a YouTube title over 100 characters or with `<` or `>`, or a Threads post over `max_chars`.

### publish.yaml

```yaml
title: Why agents forget
caption: |
  One paragraph for YouTube, Instagram and Threads.
  AI-generated voice.
caption_threads: Optional shorter caption for Threads. AI-generated voice.
link: https://example.com/article # optional
link_label: Full write-up # optional, default "Full write-up"
hashtags:
  youtube: [ai, agents, tools] # counts must fit the profile's ranges
  youtube_tags: [ai agents, tools] # YouTube tag field, needed with a youtube channel
  instagram: [ai]
  tiktok: [ai, agents, tools]
  facebook: [ai, agents]
  threads: [ai]
# A Vietnamese cut (channels with language: vi-first get it):
caption_vi_first: |
  Câu tiếng Việt. Giọng đọc do AI tạo.

  The same text in English. AI-generated voice.
title_vi: Tiêu đề tiếng Việt
# vi_only: true    # no English cut: every channel gets the Vietnamese cut and caption
```

Channels with `language: vi-first` get the Vietnamese cut, caption and title when the project has them; the others keep the English ones. YouTube and Facebook put the link in the caption; Instagram and TikTok cannot link, so another site is written as plain text and a link to the profile's hub is left out (the footer already points there); Threads gets the link on its own line.

## The profile

`publish` needs a profile, `omninoise.profile.yaml`. It is found with `--profile <file>`, else by walking up from the project folder and then from the current directory. All keys:

```yaml
instance: { url: https://omninoise.example.com/api } # optional; publish refuses if it differs from the instance you are authenticated to
brand:
  {
    name: Example Channel,
    hub: https://example.com/links,
    logo: brand/logo-1024.png,
  }
ban: ['internal.example.com'] # text that must not appear anywhere in publish.yaml (case-insensitive)
hashtag_ban: ['omninoise'] # text that must not appear in any hashtag
ai_disclosure: # regular expressions every caption must match
  en: 'AI-generated (voice|music|art)'
  vi: '(Giọng đọc|Nhạc|Hình) do AI tạo'
channels: # key = channel kind: youtube, instagram, tiktok, facebook, threads
  youtube:
    {
      integration: '<id>',
      language: en,
      footer: 'All channels: https://example.com/links',
      hashtags: [3, 5],
    }
  instagram:
    {
      integration: '<id>',
      language: en,
      footer: 'All channels: link in bio.',
      hashtags: [1, 5],
    }
  tiktok:
    {
      integration: '<id>',
      language: vi-first,
      footer: 'Mọi kênh: example.com/links',
      hashtags: [3, 5],
      posting_method: UPLOAD,
    }
  facebook:
    {
      integration: '<id>',
      language: vi-first,
      footer: 'Theo dõi mọi kênh: https://example.com/links',
      hashtags: [2, 3],
    }
  threads:
    {
      integration: '<id>',
      language: en,
      footer: 'https://example.com/links',
      hashtags: [1, 1],
      max_chars: 500,
    }
slots:
  {
    timezone: Asia/Ho_Chi_Minh,
    video: ['07:00', '12:00', '17:00', '20:00'],
    carousel: ['10:00'],
  }
```

- Only the channels listed are posted to. Get each `integration` id from `omninoise channels`.
- `footer` is added to that channel's post and checked before sending.
- `hashtags: [min, max]` is the allowed number of hashtags for that channel in `publish.yaml`.
- `posting_method` (TikTok) is `UPLOAD` (a draft in the TikTok inbox, the default) or `DIRECT_POST`.
- `max_chars` (optional) caps the text of a post.
- `brand.name`, `brand.logo` and `slots` are read by other tools (for example the agent skills) and are not used by `publish`.

A bad profile stops the command with the name of the key at fault, for example `Profile key "channels.tiktok.hashtags" must be [min, max] with 0 <= min <= max`.

## Develop

```bash
pnpm --filter omninoise build        # dist/index.js
pnpm exec vitest run apps/cli        # specs run against a local fake server, no database needed
pnpm run publish-cli                 # build and publish to npm (maintainers)
```

MIT licensed.
