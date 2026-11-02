# When something fails

| Symptom | Cause and fix |
|---|---|
| A schedule call returned an error but the post may exist | List first (`postsListTool` over the window). Retry only when it is not there, or you make duplicates. |
| `output.errors` on a schedule call | A validation failure. Fix the named fields (settings, media rules, empty content, too long) and retry. `postValidateTool` checks the same rules without creating anything. |
| 401 `Invalid API key` on the Public API with an OAuth token | The header has `Bearer ` in front. Send the bare `pos_...` value. |
| 401 `No API Key found` | No `Authorization` header. |
| 413 on upload | A proxy caps bodies at 1 MB. Upload from the dashboard session ([browser.md](browser.md)). |
| A large file is refused or 404s from the web layer | Re-encode to about 8 MB. |
| The post goes out at the old time after a move | It was moved with `action: "update"`. Move it again with `action: "schedule"`. |
| YouTube post fails, or the channel is "in between steps" | Pick the channel in the dashboard's Configure Channel dialog. |
| YouTube post fails at publish with "disallowed characters" | A `<` or `>` in the title or description. Remove them before queueing. |
| YouTube custom thumbnail error | The channel is not phone-verified. The post still publishes; Omninoise marks it "published with error". |
| TikTok fails on `DIRECT_POST` | The app has not passed its audit. Use `UPLOAD` ([tiktok.md](tiktok.md)). |
| TikTok "scope" error on the consent page | The app does not list all six scopes the instance requests. |
| Instagram 409 "Invalid API key" and nothing logged | The account is not an Instagram Tester on the Meta app (or has not accepted the invite). |
| Threads posts fail to connect | The account is not a Threads tester, or has not accepted the invite. |
| Posts publish but nobody sees them | The Meta app is in Development mode. Put it Live, then check logged out. |
| A channel shows `refreshNeeded` | The connection expired. `integrationConnectTool` with `reconnectChannelId`; reconnecting does not use a channel slot. |
| The dashboard calendar spins for about 60 s | The AI chat endpoint has no `OPENAI_API_KEY`. Not an error; wait or use the API. |
| Rate limit (HTTP 429) | The instance allows `API_LIMIT` public-API requests an hour (30 by default). Batch channels into one call; wait. |
| `analyticsTool` returns `missing: true` | The network post was not found, or it is a TikTok draft published by hand. See `postReleaseTool` to connect a post whose release id was not captured. |
| A Python `urllib` call cannot use your secret proxy | Use curl, Node fetch or Go. |
