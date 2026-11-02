# Pillars and formats

## What a pillar is

A pillar is a kind of idea your channel is for, with the format that carries it, the sources that feed it and one rule for how far to trust it. Three to five is plenty. Write them in `content/pillars.md` once and use them to cut ideas, not to generate more.

| Pillar (example) | Format | Sources | Rule of thumb |
|---|---|---|---|
| Lessons from your own writing | `explainer`: faceless, vertical, narrated | Your blog posts (`blog-*` in the ledger) | One idea per video. Say only what the post says. |
| Build it with AI | `build`: screen recording or terminal demo | The repo and the post about the same project | Show the real tool doing the real thing. Cut any line the recording does not show. |
| A story or series | a cut from public chapters | Only pages you may publish | Private repos and private run logs are not sources. |
| 60-second tool tips | explainer or screen capture | The tool's own docs | Re-read the docs the day before the render. |
| Text-only post for one network | text plus image or carousel | A hot take, a lesson thread, a repo spotlight | Link to the matching video. |

The names above are an example of the shape. Use your own.

## Two formats per topic

A video alone shows what you talk about. The carousel beside it shows what you want the viewer to keep. So every topic ships as both, and they share one `claims.md`:

| Format | Built in | Judged by |
|---|---|---|
| Video (1080x1920) | `render/explainer/<slug>/` or `render/montage/<slug>/` | views, retention, completion |
| Carousel (1080x1350, 5 to 6 slides; slide 3 is a diagram) | `render/cards/posts/<slug>.json` | saves, shares, completion |

The carousel adds no fact the video does not have. A carousel costs a spec and a render, has no voice and runs no `nv` gate, so check every slide in both languages before it is scheduled (a posted slide cannot be edited).

To reverse the two-format rule, stop adding specs. The renderer and the skills can stay.

## Rules for every item

1. Hook of 60 characters or fewer, picked from the hook bank: it opens a gap (a way, a reason, a mistake, a number) that the video then closes.
2. Every factual claim cites a source `id` and a quoted sentence.
3. A source that says "early", "pre-alpha" or "stubbed" keeps that caveat in the video.
4. A TTS voice means the caption says "AI-generated voice". Set the TikTok AI label when you publish the draft.
5. End card: the channel name and its call to action.

## Backlog math

Count the material before you promise a cadence. For example: 10 blog posts at about 3 clips each, 15 repos at 1 or 2 clips each, and a few dozen story runs is 60 days or more before anything repeats. A cadence the backlog cannot feed turns into rushed renders, so the backlog has to keep pace with the slots. If it cannot, drop a slot rather than lower the checks.

## A series as a unit

A week built around two series (for example one pairing two tools, one on everyday work) can fix a format once and reuse it: the same split-screen or "by hand vs with AI" layout, a 2 to 3 second "save this" card closing each video, the same card on the cover. Build the new scene once in the first project and reuse it. Slots for a series: if a video misses its slot, it moves to the next free slot in the same week rather than being rushed.

An exception to the language rule belongs in writing: a video about a local institution (a national invoice format, a local tender law) can ship one Vietnamese cut to every channel with one English line in the caption. Say so in the backlog item.
