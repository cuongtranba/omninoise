# Drive a logged-in browser (and a phone) when the API cannot

Use for: a platform's consent screen, the dashboard's media upload, a platform's own console, a check that a post is visible to a logged-out visitor. Prefer the API for everything else.

## Your own Chrome over its debugging port

Start a Chrome with its own profile and a debugging port, and sign in there yourself (only the owner types passwords, captchas and 2FA codes):

```bash
open -na "Google Chrome" --args --user-data-dir="$HOME/.omninoise-chrome" --remote-debugging-port=9333 --no-first-run
curl -s http://127.0.0.1:9333/json/version | jq -r .Browser
```

(On Linux, run `google-chrome` with the same flags.) Then drive it with a CDP-capable tool (for example `agent-browser --cdp 9333`, Playwright's `connectOverCDP`, or raw CDP).

Rules:

- **Open a tab of your own and close it afterwards.** Never drive a tab you or another agent already has open, and never bring one to the front. Several agents may share the same Chrome.
- **Put back any setting a click changed** (a calendar view, a privacy toggle).
- If a session hangs, attach with a new session name; Chrome keeps running. Open a tab with `curl -X PUT "http://127.0.0.1:9333/json/new?<urlencoded url>"`.
- A tool that relaunches headless (some CLIs do unless told to restore a headed profile) comes back logged out. Pass the flags that keep the headed profile.

## Clicking and typing

- Prefer mouse move, down and up at coordinates read from a screenshot. Many consoles ignore a synthetic `click()`.
- Native file dialogs: use the tool's `upload` on a file input, inject a `File` into an input you create, or intercept the chooser with CDP `Page.setInterceptFileChooserDialog`.
- A secret shown on a page: read it with a script that sends it straight to where it belongs and prints only its length. Never print it.

## Upload a large file through the dashboard session

If the API refuses a large body (413, or a 404 from the web layer on a big file), upload from the logged-in dashboard tab. The page's own session uploads to the server route:

```js
// run in the dashboard tab: create an input, attach the file with your tool's upload command, then
const i = document.getElementById('omniup');
const fd = new FormData(); fd.append('file', i.files[0], 'name.mp4');
const r = await fetch('/api/media/upload-server', { method: 'POST', body: fd, credentials: 'include' });
// r.status and the JSON body hold the media id and path
```

Keep the returned `id` and `path`; check that a range request returns `206 video/mp4` (`curl -r 0-100 <path>`). If a file of 30 MB or more is rejected, re-encode it to about 8 MB (`ffmpeg -c:v libx264 -preset slow -crf 27 -c:a copy -movflags +faststart`); film grain is what makes a cut that large. Screen recordings shrink to about 5.5 MB with no visible loss.

## Check a post as a logged-out visitor

Open the post's public URL (`postReleaseTool` `getUrl`) in a clean profile, or in a private window with no cookies. A post counts as done only when a logged-out visitor sees it, and every slide of a carousel, in order.

## A phone (when a step only exists in an app)

Some steps (publishing a TikTok inbox draft, turning on the AI label) exist only in the phone app. Where the owner allows it, a phone-mirroring tool can drive the phone from the desktop (macOS iPhone Mirroring, screenshots at 2x so halve the coordinates). The phone must be locked for mirroring to connect. Avoid reading private chats on screen. Otherwise ask the owner to do the step.
