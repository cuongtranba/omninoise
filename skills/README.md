# Omninoise skills

Agent skills for running a social channel on Omninoise: make the video, make the carousel, plan the content, write the captions, and operate the platform. They follow the open [skills](https://github.com/vercel-labs/skills) layout (`skills/<name>/SKILL.md`), so any agent that reads `SKILL.md` files (Claude Code, Codex and others) can use them.

| Skill | What it does |
|---|---|
| [`omninoise-video`](omninoise-video/SKILL.md) | Make a short vertical video: a narrated explainer with Codex-painted art in Remotion, a beat-cut montage assembled in OpenCut, or a terminal demo. Includes a working explainer template and the vendored OpenCut MCP server. |
| [`omninoise-carousel`](omninoise-carousel/SKILL.md) | Plan, write and render an image-and-diagram carousel from a JSON spec, as the companion to each video. Includes the renderer. |
| [`omninoise-platform`](omninoise-platform/SKILL.md) | Operate an Omninoise instance: connect channels, schedule, list, move and delete posts, upload media, read analytics, over the MCP server, the `omninoise` CLI or the Public API. |
| [`omninoise-strategy`](omninoise-strategy/SKILL.md) | Decide what to post: pillars and format mix, cadence and slots, curiosity hooks, the source and fact gate, and the weekly review. |
| [`omninoise-seo`](omninoise-seo/SKILL.md) | Write titles, captions, hashtags and AI-disclosure lines per platform, with the hub footer, and write Vietnamese that is not translated. |

## Install

```bash
npx skills add cuongtranba/omninoise            # choose the skills and the agents
npx skills add cuongtranba/omninoise --list     # see what is offered, install nothing
```

The CLI copies only a skill's own folder, so every skill is self-contained: its scripts, templates and references live inside it. Skills refer to each other by name, so install all five.

The video and carousel tooling is [Bun](https://bun.sh) code that lives beside the skills and is not part of this repository's pnpm workspace. Run `bun install` inside the folder that needs it (`omninoise-video/template/explainer`, `omninoise-video/opencut-mcp`, `omninoise-carousel/renderer`).

## The workspace profile

Every skill starts by reading `omninoise.profile.yaml` at the root of your content workspace (the repository where your backlog, renders and published ledger live). It is private to you and never goes in this repository. Copy [`profile.example.yaml`](profile.example.yaml) and fill it in:

| Key | Meaning |
|---|---|
| `instance.url` | Your backend URL, shown in Settings > Public API |
| `brand` | `name`, the one `hub` link every bio and post points at, and the `logo` file (relative to the profile) |
| `ban`, `hashtag_ban` | Strings that must never appear in public text, captions or recordings, and words that must never be hashtags |
| `ai_disclosure` | Regexes a caption must match when AI voice, music or art is used, per language |
| `channels` | Per channel kind (`youtube`, `instagram`, `tiktok`, `facebook`, `threads`): the `integration` id from `integrationList`, `language` (`en` or `vi-first`), the `footer` line, the `hashtags` `[min, max]`, and for TikTok `posting_method` (`UPLOAD` until your app passes TikTok's audit); Threads also `max_chars` |
| `slots` | `timezone`, the `video` times and the `carousel` time |

The `omninoise` CLI reads the same file.

## Rules that apply to every skill

- No key, token or password goes in a file, a commit, an argument, a log or a chat. Keys come from the environment or from a secret wrapper you run the command under.
- Every factual claim traces to a source in your ledger.
- Say what is AI: voice, music and art are disclosed in the caption and the platform label.
- Public text never contains a string from `ban`.
- Only the owner types passwords, captchas and 2FA codes.

## Attribution

- `omninoise-video/opencut-mcp/` is vendored from [kenimo49/opencut-mcp](https://github.com/kenimo49/opencut-mcp) (MIT, see its `LICENSE`) with changes listed in its README, and drives [OpenCut](https://github.com/OpenCut-app/OpenCut).
- `omninoise-carousel/references/carousel-frameworks.md` is vendored unchanged from [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (MIT, `LICENSE-marketingskills`).
