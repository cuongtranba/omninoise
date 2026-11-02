---
name: omninoise-carousel
description: Plan, write, render and schedule image posts, carousels and diagrams for a channel run on Omninoise, and balance them against the videos. Use when asked for an image post, carousel, infographic, diagram post, "Save this" card, slide-by-slide post, or a content mix or calendar across Instagram, Facebook, Threads and TikTok; when asked to make the channels more informative than video alone; or after a video is made and it needs its companion post. Videos themselves are the omninoise-video skill's job; scheduling and posting is the omninoise-platform skill's.
---

# omninoise-carousel: the companion carousel for every video topic

Read `omninoise.profile.yaml` at the workspace root first. It names the brand, the one hub link, the strings banned from public text (`ban`, `hashtag_ban`), the AI-disclosure patterns, each channel's language order and hashtag range, and the carousel slot. If you have none, copy `skills/profile.example.yaml` from the omninoise repository. `<skill-dir>` below is the folder this skill was installed into.

Videos bring reach. Carousels bring saves and show what the channel is for: a viewer who liked a video can swipe through the same idea at their own pace and keep the commands. So every topic that gets a video also gets one 5-to-6-slide carousel. Its third slide is a diagram, and its facts are the video's facts.

The marketing guidance below is adapted from the `social` skill in [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (MIT, `references/LICENSE-marketingskills`). The carousel frameworks are vendored unchanged in `references/carousel-frameworks.md`. Where that skill disagrees with your profile, the profile wins: your channel rules, languages, sources and TikTok mode come first.

Work in a task worktree on its own branch. Never commit to your main branch.

## 1. Pick the topic and the framework

1. Take a topic that already has an explainer with a `claims.md` (`render/explainer/<slug>/claims.md`), ideally one whose video is scheduled or just out. The carousel may only say what that file supports. A new fact needs a source in `content/sources.yaml` and a row in a `claims.md` first.
2. Pick one framework from `references/carousel-frameworks.md` before writing:

| The topic is… | Framework | Usual shape |
|---|---|---|
| A setup, a command, a config file | E: Demo Walkthrough | cover, problem, **diagram**, detail, save, close |
| A list of tips or tools | A: Value-Stack | cover with the exact count, one item per slide, save, close |
| A rule people get wrong | C: Hack List | contrarian cover, why it fails, **diagram**, fixes, close |
| A result with a system behind it | B: Problem-Proof | claim with a number, the system **diagram**, the receipt |

Skip D (Rant Callout) on a channel that teaches: it should not pick fights.

## 2. Write the spec

One JSON file per post, in your workspace at `render/cards/posts/<slug>.json`, with `en` and `vi` slide lists and a `publish` block. The schema and slide types (`cover`, `points`, `quote`, `flow`, `files`, `save`, `close`) are in `renderer/README.md`. `renderer/example/example-guard-main.json` is the reference.

Slide rules:

- **Slide 1 is the thumbnail.** It must stop the scroll on its own: the video's hook, 2 to 4 short lines, one `**accent**` word. With no video, write one from the omninoise-strategy skill's `references/hooks.md` (the "Action" patterns suit "Save this" posts); the English and Vietnamese covers are each written for their own language.
- **One idea per slide**, at most three items. Inline `` `code` `` for every command, flag, file and event name.
- **Slide 3 is the diagram.**
  - `flow`: steps, layers, or a fork with `branches`; a `loop` for a cycle.
  - `files`: what goes in which file, with an `@ import` style link.
  - Draw it in code. Never use Codex art, generated images or a screenshot of a real account.
- **"Save this" card** with the exact commands, then the close card with the follow line and one public link (the hub link in your profile, or docs or GitHub). Never a string from the profile's `ban` list. Name the studio or product behind the channel only on a post that introduces it.
- **Vietnamese slides** are written, not translated (the omninoise-seo skill's `references/vietnamese-style.md`). Reuse the owner-approved lines from the video's `claims.md` and `content/vi.yaml` wherever they fit. A paraphrased quote is labelled "(ý chính)".
- **No AI tells.** Avoid:
  - "it's not X, it's Y" reveals
  - "The result? …" questions the post answers itself
  - stock phrases
  - emoji bullets
  - "Agree?" style bait

Captions (`publish`), in short; the full rules are in the omninoise-seo skill:

- **`caption_en`** goes to channels whose `language` is `en`. The hook line first, then "The diagram is on slide 3" or a save cue, then the link. Threads gets 500 characters at most.
- **`caption_vi_first`** goes to channels whose `language` is `vi-first`. Vietnamese first, a blank line, then English. `title_vi` is TikTok's title, 90 characters at most.
- **Hub footer.** Every channel's content ends with its footer line (`channels.<kind>.footer` in the profile), on its own line after the post's own link (if any); on Instagram, Threads and TikTok it goes before the hashtags. Copy it from the profile, never retype it. The Threads 500-character limit counts the footer.
- **Hashtags.** Stay inside `channels.<kind>.hashtags` from the profile (the usual ranges: Instagram 1 to 5, Facebook 2 to 3, TikTok 3 to 5, Threads exactly 1). Never a word in `hashtag_ban`.
- **AI disclosure.** No voice and no generated art means no "AI-generated voice" line. Any generated picture means the slide and the caption say so.

## 3. Render and look

```bash
cd <skill-dir>/renderer && bun install
bun run typecheck && bun run lint && bun test        # the test parses the bundled sample (and your posts, if OMNINOISE_POSTS is set)
bun run render-post <slug>                            # <out>/<slug>/{en,vi}-NN.jpg, 1080x1350
```

`render-post` finds your workspace on its own when the skill is installed inside it (it looks for `omninoise.profile.yaml` above the current folder and above the renderer). Otherwise name the inputs: `--posts <dir>` (the folder of post specs), `--brand <dir>` (the folder holding your logo file, named by `brand.logo`), `--out <dir>`, `--profile <file>`. With no profile it renders the bundled sample with a placeholder logo. The brand name and the footer line on each slide come from `brand.name` and `brand.hub`.

Read every JPG, in both languages, at full size and as a thumbnail. Check for:

- clipped or overflowing text, and missing Vietnamese diacritics
- a diagram whose arrows do not read top to bottom
- a cover that does not work alone
- any file over 1 MB

Fix the spec or the renderer and render again. A posted slide cannot be edited (the MCP cannot change content), so this is the last chance.

## 4. Upload and schedule

Use the omninoise-platform skill. In short:

1. Upload each JPG (`omninoise upload <file>`, or the media library in the dashboard), keeping the slide order.
2. Read `integrationList` and `integrationSchema` for every platform you post to.
3. Make one `integrationSchedulePostTool` call per post: one `socialPost` per channel, `type: "schedule"`, `date` in UTC, `isPremium: false`, `shortLink: false`, `content` as `<p>` lines, and `attachments` listing every slide in order.

| Channel | Slides | Caption | `settings` |
|---|---|---|---|
| Instagram (`instagram-standalone`) | en | `caption_en` + hashtags | `post_type: "post"` (several attachments become one carousel) |
| Threads | en | `caption_en` + 1 tag | none |
| Facebook | vi | `caption_vi_first` + hashtags | `post_type: "post"` |
| TikTok (inbox draft) | vi | `caption_vi_first` + hashtags | `title: title_vi`, `content_posting_method: "UPLOAD"`, plus the schema's required fields (`privacy_level`, `duet`, `stitch`, `comment`, `autoAddMusic`, `brand_content_toggle`, `brand_organic_toggle`) |
| YouTube | none | n/a | YouTube takes video only |

4. Check with `postsListTool` over the window: one post per channel, state `QUEUE`, no `error`, and each `content` holds its hub footer. Never retry a call before listing, or you make duplicates.

## 5. After it goes out

- Open each post logged out: the carousel shows every slide, in order, on Instagram, Facebook and Threads. Then append one line per post to `content/published.jsonl`. A TikTok draft counts only after the owner publishes it.
- Judge carousels by saves, shares and completion, not likes (`analyticsTool`; the omninoise-strategy skill's weekly review).
  - If a carousel underperforms, fix slide 1 or the framework, not the middle.
  - Compare carousels with the videos in the next metrics pass before changing the mix.

## Cadence

One carousel a day at the profile's `slots.carousel` time, between the video slots. Never two posts in the same minute on the same channel. Keep about two days queued, but never a carousel for a topic whose video has not been rendered and checked.
