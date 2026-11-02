---
name: omninoise-strategy
description: Plan the content for a channel run on Omninoise - pillars and format mix, posting cadence and slots, curiosity hooks, the per-topic pipeline (a short video plus a companion carousel), the source and fact gate, and the weekly review from analytics. Use when asked what to post, to plan a week, build or reorder a backlog, write or pick a hook, set a cadence or time slots, check that every claim has a source, review last week's numbers, decide what to change next, or when starting a new channel's content plan.
---

# omninoise-strategy: decide what to say, how often and whether it worked

Read `omninoise.profile.yaml` at the workspace root first. It names the brand, the channels and their languages, the posting slots and the banned strings. If you have none, copy `references/profile.example.yaml` from the omninoise-platform skill (installed beside this one) to your workspace root.

This skill is the thinking that comes before the other four: omninoise-video and omninoise-carousel make the assets, omninoise-seo writes the captions, omninoise-platform schedules them. It keeps the plan honest with three habits: every claim has a source, every topic ships in two formats, and every week ends with one decision made from the numbers.

## The workspace layout it assumes

```
content/
  sources.yaml        ledger of source material (id, kind, title, url, checked)
  pillars.md          your pillars, written down once
  hooks.md            optional: your own additions to the hook bank
  vietnamese-style.md optional: your phrase map (start from the omninoise-seo skill's copy)
  backlog/week-NN.md  the items for a week: format, hook, beats, claims, caption, platforms
  metrics/week-NN.md  what a week's numbers said (method in references/weekly-review.md)
  published.jsonl     one line per post that went out
render/
  explainer/<slug>/   a narrated video (omninoise-video)
  montage/<slug>/     a montage or terminal demo (omninoise-video)
  cards/posts/<slug>.json   a carousel spec (omninoise-carousel)
```

Nothing forces these names, but the other skills refer to them, so keep them unless you have a reason.

## 1. Pillars and the format mix

Write your pillars once, in `content/pillars.md`, and use them as filters: an idea that fits none is cut. Each pillar says who it is for, what format carries it, which sources feed it and a rule of thumb for how far to trust them. Details and a worked template: [references/pillars-and-formats.md](references/pillars-and-formats.md).

Every topic ships in two formats, because they do different jobs:

| Format | Job | Where |
|---|---|---|
| Video, 1080x1920, 30 to 40 s | Reach: get found | every channel |
| Carousel, 1080x1350, 5 to 6 slides, slide 3 a diagram | Saves: be the thing people keep | Instagram, Facebook, Threads, a TikTok photo draft |

The carousel is built from the video's `claims.md` and adds nothing the video's sources do not support. Format benchmarks disagree on exact numbers but agree on direction: carousels beat Reels on saves and engagement, Reels win on reach, and a mix does best. TikTok is the exception, where video earns more engagement than photo posts. Judge the two formats by different numbers (below).

## 2. Cadence and slots

The profile's `slots` set the times: `video` slots and one `carousel` slot, in `slots.timezone`. Rules that survived:

- **Every video goes to every channel in the same minute**, in one scheduling call. A group of posts at one time is the unit, not a post.
- **One carousel a day**, between the video slots.
- **Never burst-post**, and never two posts in the same minute on the same channel.
- **Keep about two days queued**, so one failed render never leaves a gap. Never queue a carousel for a topic whose video has not been rendered and checked.
- **Cadence is a decision you revisit after two weeks of numbers**, not a setting. Details, and why a slot cannot be judged from one video: [references/cadence.md](references/cadence.md).

## 3. The per-topic pipeline

1. **Pick** the next backlog item that is not in `content/published.jsonl`.
2. **Source it.** Read the source. Every factual sentence needs a ledger id and a quoted sentence. No quote, no claim ([references/sources-and-fact-gate.md](references/sources-and-fact-gate.md)).
3. **Hook first.** Draft three hooks from different patterns in [references/hooks.md](references/hooks.md), in English and in Vietnamese, read them aloud and keep the one that makes you want the answer. The script is the answer to the hook.
4. **Make the video** (omninoise-video). Note the hook's pattern and the line that pays it off in `claims.md`.
5. **Make the carousel** (omninoise-carousel) from the same `claims.md`.
6. **Package** the captions (omninoise-seo): keyword-first title, per-platform hashtags and footer, AI disclosure.
7. **Schedule** (omninoise-platform), check logged out, then append a line to `content/published.jsonl`.
8. **Review** weekly from analytics ([references/weekly-review.md](references/weekly-review.md)).

## The rules that keep the channel trustworthy

- **A source that says "early", "pre-alpha" or "stubbed" keeps that caveat in the video.**
- **Illustration is labelled as one** in `claims.md`. A video must not claim an event its source does not describe.
- **Docs change.** For a claim about a tool's documented behaviour, re-read the docs the day before the video renders.
- **No advice you cannot source.** A video about law, tax or money shows what a tool does and the principles in its own README, states no rule or threshold as fact, and carries the README's disclaimer.
- **Teach, don't pick fights.** A contrarian hook targets a practice, never a named company, product or person.
- **First person only with a receipt.** "I stopped…" needs a source that records the owner doing it.
- **Mix real footage with generated art.** Pure slideshows with stock voices rank poorly and read as unoriginal. Real screen recordings and your own projects keep the channel distinct, and a consistent voice helps.
- **Say what is AI.** Captions say "AI-generated voice", "AI-generated music" or "AI-generated art" wherever they are used, and the platform's AI label is set where one exists (omninoise-seo has the exact lines).
