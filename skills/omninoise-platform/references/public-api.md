# The Public API (fallback)

Use when the MCP and the CLI are not available. Base: `<instance>/public/v1`. Set the secret in the environment (`OMNINOISE_API_KEY`) and never paste it into a file or a command line you share.

**Auth.** The header is `Authorization: <value>` with no `Bearer ` prefix. The value is the organization's API key, or an OAuth access token that starts with `pos_`. `Bearer pos_...` is rejected with 401 `Invalid API key`. A request with no header gets 401 `No API Key found`.

```bash
curl -sS -H "Authorization: $OMNINOISE_API_KEY" "$OMNINOISE_URL/public/v1/integrations"
```

(Give curl the key through a config file or your secret wrapper rather than a visible argument if your shell history or process list is shared.)

| Method | Path | Use |
|---|---|---|
| GET | `/integrations` | Channels and ids |
| GET | `/integration-settings/:id` | A channel's settings schema |
| POST | `/upload` | Multipart field `file`; body limits apply (see below) |
| POST | `/upload-from-url` | `{url, adjust}` |
| GET | `/media` | `page`, `search` |
| GET | `/media/:id/status` | `processing` or `ready` after `adjust` |
| POST | `/posts` | `{type: "schedule"|"draft"|"now", date, shortLink: false, tags: [], posts: [{integration: {id}, value: [{content, image: [{id, path}]}], settings: {__type, ...}}]}` |
| GET | `/posts` | `startDate` and `endDate` (UTC) required |
| DELETE | `/posts/:id` | Deletes the post and its whole group |
| PUT | `/posts/:id/settings` | Settings only |
| PUT | `/posts/:id/status` | `draft` or `schedule` |
| GET | `/find-slot/:id` | Next free time for a channel |
| GET | `/analytics/:integration`, `/analytics/post/:postId` | `?date=<days>` |
| GET | `/social/:integration` | A connect URL (`?refresh` to reconnect) |
| GET | `/me` | The signed-in user (OAuth tokens only) |

There is **no** change-date route in the Public API. Move a post with the MCP `postChangeDateTool` (`action: "schedule"`), or delete and recreate it. The API key acts as an administrator of its organization; an OAuth token acts with its approving user's role and cannot use the `x-postiz-org` header or the super-admin routes.

Large uploads: a proxy in front of the API (a secret-injecting wrapper, a reverse proxy) may cap request bodies at 1 MB and answer 413. Upload large media from the logged-in dashboard instead ([browser.md](browser.md)).
