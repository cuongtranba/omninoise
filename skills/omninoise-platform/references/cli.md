# The `omninoise` CLI

For scripts, CI and sessions without the MCP. It talks to the Public API of your instance.

| Setting | Meaning |
|---|---|
| `OMNINOISE_URL` | The instance's backend URL (Settings > Public API). Required with `OMNINOISE_API_KEY` (or pass `--url`); the key only goes where you point it. `publish` refuses when it differs from the profile's `instance.url`. |
| `OMNINOISE_API_KEY` | The organization's API key, or an OAuth token from `auth:login`. Never put it in a file, argument or log. |

```bash
omninoise auth:login --url <instance>   # browser sign-in; stores a token for this machine (or set OMNINOISE_URL)
omninoise auth:status                  # who and which instance
omninoise auth:logout
omninoise channels                     # the connected channels and their integration ids
omninoise posts list                   # posts in a window; --help for the date flags
omninoise posts delete <id>            # irreversible; confirm with the owner first
omninoise upload <file>                # prints the media id and path for use as an attachment
omninoise analytics                    # channel or post analytics; --help for flags
omninoise publish <project-dir> --at <UTC> [--dry-run]
```

`publish` reads the project's `publish.yaml` and `omninoise.profile.yaml`, uploads the render, its cover and its thumbnail, builds one post per channel with the channel's language order, footer and hashtags, and refuses to send a post that breaks the caption rules (banned strings, missing footer, hashtag count, missing AI disclosure, Threads over 500 characters, `<` or `>` for YouTube). `--dry-run` prints the request body and sends nothing: read it before the real run. Run `omninoise <command> --help` for the current flags; where `--help` and this note differ, trust `--help`.

The CLI sends the API key as the raw `Authorization` value. An OAuth token (`pos_...`) works on the Public API only when sent the same way, with no `Bearer ` in front.
