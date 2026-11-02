---
name: omninoise-platform
description: Operate an Omninoise instance (the self-hosted Postiz fork that schedules and publishes social posts). Use when asked to connect or reconnect a channel, list channels, schedule, list, move, check or delete posts, upload media, publish a rendered video or carousel, read analytics, or when an Omninoise MCP tool (integrationList, integrationSchema, integrationSchedulePostTool, postsListTool, postChangeDateTool, mediaListTool, analyticsTool) or the `omninoise` CLI is involved. Covers YouTube, Instagram, TikTok, Facebook and Threads, and replaces the upstream Postiz agent skill for this instance.
---

# omninoise-platform: run the channels

Read `omninoise.profile.yaml` at the workspace root first. It holds your instance URL, one integration id per channel, each channel's language order, footer and hashtag range, the strings banned from public text, the AI-disclosure patterns and your posting slots. If you have none, copy `skills/profile.example.yaml` from the omninoise repository and fill it in; you get the integration ids from `integrationList` or `omninoise channels`.

Omninoise is a self-hosted fork of Postiz. It schedules posts to many social networks and publishes them at their time. This skill is how an agent operates it: connect channels, schedule and check posts, upload media, read analytics. Making the video or carousel is the omninoise-video and omninoise-carousel skills' job; deciding what to say is omninoise-strategy and omninoise-seo.

## Pick a transport

| Transport | Use it when | Setup |
|---|---|---|
| **MCP** (default) | An agent in a session with the server registered | Register `<instance>/mcp-oauth-dynamic` (OAuth in a browser, once) or `<instance>/mcp` with your API key as the bearer token; Settings > Public API in the dashboard shows the exact URLs. Tools appear as `integrationList`, `postsListTool` and so on. See [references/mcp-tools.md](references/mcp-tools.md). |
| **`omninoise` CLI** | A script, CI, or a session without the MCP | `omninoise auth:login`, or `OMNINOISE_URL` and `OMNINOISE_API_KEY` in the environment. See [references/cli.md](references/cli.md). |
| **Public API** | Neither of the above is available | `GET/POST <instance>/public/v1/...`. See [references/public-api.md](references/public-api.md). |
| **Browser** | What the API cannot do: a platform's consent screen, a large upload, the dashboard | Drive your own Chrome over its debugging port. See [references/browser.md](references/browser.md). |

`<instance>` is `instance.url` in the profile (the backend URL shown in Settings > Public API). Never use a hosted Postiz connector for this: it talks to Postiz Cloud, not to your instance. Check you have the right instance: `integrationList` must return the integration ids in your profile.

## The rules that cost the most to learn

1. **List before you retry.** A schedule call that errored may still have created the post. Run `postsListTool` over the window first, or you make duplicates.
2. **Dates are UTC.** The profile's slots are in `slots.timezone`; convert. 07:00 in Asia/Ho_Chi_Minh is `00:00Z`.
3. **To move a post, use `postChangeDateTool` with `action: "schedule"`, never `update`.** `update` changes only the date shown in the dashboard; the publish job was queued when the post was created and keeps its old time, so the post still goes out at the old time.
4. **`isPremium: false` and `shortLink: false`** on every post. Content is HTML: wrap each line in `<p>`.
5. **One call for all channels.** One `integrationSchedulePostTool` call carries one `socialPost` per channel, so a video goes out at the same minute everywhere.
6. **The schema's `rules` text is generic.** `integrationSchema` explains how to post for any user. Where your profile disagrees, the profile wins. In particular the schema says to prefer TikTok `DIRECT_POST`; use `UPLOAD` until your TikTok app has passed its audit ([references/tiktok.md](references/tiktok.md)).
7. **TikTok `UPLOAD` posts a draft to the inbox.** The owner opens it in the TikTok app, turns on the AI label and publishes within 24 hours. A TikTok draft is not "published" until then.
8. **YouTube brand channels stay "in between steps"** until the channel is picked in the dashboard's Configure Channel dialog, and posts fail until then. YouTube also rejects `<` and `>` in a title or description at publish time, so check before queueing.
9. **Threads takes 500 characters** counting the link, the hub footer and the hashtag. Cut before you send.
10. **Never publish `generateImageTool` or `generateVideoTool` output unreviewed.** Everything you publish should come from your own sources and renders, checked by a person.
11. **`deletePostTool` is irreversible.** A scheduled post is gone; a published post is removed from Omninoise but stays live on the network. Confirm with the owner first, and delete one post (one channel) at a time.
12. **The MCP cannot change a post's content.** Delete and recreate it (after confirming), or fix the next one. That is why carousels are checked slide by slide before they are scheduled.
13. **A post is done only when** it is visible to a logged-out browser and recorded (the omninoise-strategy skill's `content/published.jsonl`).
14. **No secret in a file, argument, log or chat.** Keys come from the environment or the MCP's own auth. Never ask the user to paste one.

## Common jobs

### Schedule a video

1. Check your media: render the MP4, re-encode to about 8 MB if it is larger (`ffmpeg -c:v libx264 -preset slow -crf 27 -c:a copy -movflags +faststart`). Large files can be refused by the upload. Look at a full-size frame again.
2. Upload it: `omninoise upload <file>`, or find an earlier upload with `mediaListTool` (`search` by file name) and use its `path`. For a file the API refuses, upload through the dashboard ([references/browser.md](references/browser.md)).
3. Read `integrationSchema` for every platform you post to.
4. Make one `integrationSchedulePostTool` call: one `socialPost` per channel (`integrationId`, `isPremium: false`, `type: "schedule"`, `date`, `shortLink: false`, `postsAndComments: [{content, attachments: [path]}]`, `settings`). Per-platform settings and limits: [references/platform-settings.md](references/platform-settings.md). Captions, hashtags and the hub footer: the omninoise-seo skill.
5. Confirm with `postsListTool` over the window: one post per channel, state `QUEUE`, no `error`, and each `content` ends with its channel's footer.
6. After the publish time `postsListTool` shows `PUBLISHED`. Open each post logged out, then record it.

With the CLI, steps 2 to 4 are one command: `omninoise publish <project-dir> --at <UTC>` reads the project's `publish.yaml` and the profile, uploads the render and its cover, builds one post per channel with its footer, and refuses a post that breaks the caption rules. Run it first with `--dry-run` and read the request it prints.

### Schedule a carousel

The same call with every slide JPG as an attachment, in slide order. Instagram posts one carousel, Facebook one post with all photos, Threads one carousel, TikTok one photo post (inbox draft). YouTube takes video only. Details: [references/platform-settings.md](references/platform-settings.md).

### List, check and move posts

- `postsListTool` (`startDate`, `endDate` in UTC) returns every post in the window, whatever its state: `QUEUE`, `PUBLISHED`, `ERROR`, draft. Read `error` on failures.
- `postsBrowseTool` pages through upcoming or published posts without dates.
- `postGetTool` reads one post in full; `postReleaseTool` (`getUrl`) gives the link of a published post.
- Move a post: `postChangeDateTool` with `action: "schedule"` and a UTC `date`. A post that was already published is refused unless `republish` is true; never pass that without the owner asking.
- Change only settings: `postSettingsTool`. It merges keys and leaves the content and date alone.

### Analytics

`analyticsTool` takes either `integrationId` (the channel) or `postId` (one published post) and `days` (7 by default). It asks the network, can take a few seconds, and is cached for an hour. Figures are running totals since the post went out, as each platform reports them (views, plays, likes). TikTok drafts published by hand have no per-video numbers (`missing: true`). The weekly review method is in the omninoise-strategy skill.

### Connect or reconnect a channel

[references/connect-a-channel.md](references/connect-a-channel.md). `integrationConnectTool` returns a link the owner opens; only the owner approves the consent screen.

## When something fails

[references/troubleshooting.md](references/troubleshooting.md): validation errors, rate limits, a calendar that spins for a minute, tester roles, `inBetweenSteps`, and what each failure looks like.
