# The Omninoise MCP server

Use when: an agent lists channels, schedules, checks, moves or deletes posts through MCP tools. The MCP is the default agent interface; the CLI, the Public API and the browser cover what it cannot do.

## The server

| Item | Value |
|---|---|
| Name | Whatever you registered it as (tools then appear as `mcp__<name>__<tool>` in Claude Code) |
| URL, OAuth | `<instance>/mcp-oauth-dynamic`. The first use opens a browser to approve the app; the token never expires until you revoke it in Settings. |
| URL, API key | `<instance>/mcp`, with the organization's API key as the bearer token. Treat that key like a password. |
| Claude Code example | `claude mcp add omninoise --transport http <instance>/mcp-oauth-dynamic` |

`<instance>` is `instance.url` from the profile. A hosted Postiz connector (`mcp.postiz.com`) is Postiz Cloud, not your instance: never use it for this.

Check it is the right instance: `integrationList` must return the integration ids in your profile, and the avatar URLs should start with your own domain.

## Which tool for which job

| Job | Tool | Notes |
|---|---|---|
| List channels and their ids | `integrationList` | Use the `id`, not the name. A renamed channel can keep its old display name on the network side. |
| Read one channel in full | `integrationGetTool` | Posting times, settings, whether name and picture can be changed. |
| Read a platform's settings and rules | `integrationSchema` (`platform`, `isPremium: false`) | Read it before the first post to a platform. Its `rules` text is generic; your profile overrides it. |
| Provider lookups (music, location, boards) | `triggerTool` | Only when the schema lists a callable tool. |
| Mention an account | `integrationMentionsTool` | Returns the handle to write in the mention. |
| Find uploaded media | `mediaListTool` (`search` by original file name) | Use the returned `path` as the attachment. |
| Upload media from a public URL | `uploadFromUrlTool` | For a file hosted somewhere public. A local file goes through the CLI or the dashboard. `adjust: true` re-encodes for platform limits and the media is `processing` until `mediaStatusTool` says `ready`. |
| Create a draft, scheduled or immediate post | `integrationSchedulePostTool` | One `socialPost` item per channel. `date` is UTC. |
| Check a post before sending | `postValidateTool` (`validate`) | Runs the app's own checks (settings, media rules, length) and creates nothing. |
| Find the next free slot | `postFindSlotTool` | Uses the channel's posting times; returns a UTC date and schedules nothing. |
| List posts and their state | `postsListTool` (`startDate`, `endDate` in UTC) | States: `QUEUE`, `PUBLISHED`, `ERROR`, draft. Read `error` on failures. |
| Browse posts without dates | `postsBrowseTool` | `state`: all, scheduled, draft, published. |
| Read one post in full | `postGetTool` | By `id` or `group`; a group shows the same post on the other channels. |
| Get a published post's link | `postReleaseTool` (`getUrl`) | `pending` means the network has not finished; ask again later. |
| Move a post | `postChangeDateTool` | `action: "schedule"` to really move it (rule 3 in SKILL.md). |
| Change a not-yet-published post's settings | `postSettingsTool` | Settings only; content and date stay. |
| Delete a post | `deletePostTool` | Irreversible. Confirm first. |
| Read analytics | `analyticsTool` | `integrationId` or `postId`, `days`. |
| Connect or reconnect a channel | `integrationConnectTool` | Returns a link for the owner. See connect-a-channel.md. |
| Tags, comments, sets, signatures, webhooks, autopost | `postTagsTool`, `postCommentsTool`, `setsTool`, `signaturesTool`, `webhooksTool`, `autopostTool` | Optional features; read each tool's own description. |
| Generate images or videos | `generateImageTool`, `generateVideoTool` | Do not publish their output unreviewed; see SKILL.md rule 10. |

Account and admin tools (`accountDeleteTool`, `apiKeyRotateTool`, `teamTool`, `adminTool`, `oauthAppTool`) change who can get in. Use them only when the owner asks for exactly that, and never rotate a key you are connected with without saying that the connection will stop working.

## Calling `integrationSchedulePostTool`

- One call, one `socialPost` per channel: `integrationId`, `isPremium: false`, `type` (`draft`, `schedule` or `now`), `date` (UTC), `shortLink: false`, `postsAndComments`, `settings`.
- `postsAndComments[0]` is the post, every later item is a comment on it: `{content, attachments}`. `content` is HTML, each line in `<p>`; allowed tags are `h1 h2 h3 u strong li ul p` (not `u` and `strong` together).
- `attachments` is a list of the uploaded `path` strings (or `{path, alt, thumbnail}` for a video cover).
- `settings` is a list of `{key, value}`, from the schema. Per-platform values that have worked: [platform-settings.md](platform-settings.md).
- Success returns a `previewUrl` per post. A validation failure returns `output.errors`; fix the named fields and retry, but list first if the call created anything.

## Limits

- **Rate limit.** The public API allows a limited number of requests per hour (the instance's `API_LIMIT`, 30 by default). Assume MCP calls count too (not verified); batch channels into one scheduling call.
- **Concurrent calls.** Do not fire several `integrationSchedulePostTool` calls for the same post in parallel.
