---
name: omninoise-seo
description: Write the titles, captions, hashtags and tags that make a post findable and honest on YouTube, Instagram, TikTok, Facebook and Threads - keyword-first titles, the YouTube title limit and tags, per-platform hashtag counts, caption structure and link rules, the hub footer, AI-disclosure lines, language order per channel, and Vietnamese written rather than translated. Use when asked to write or fix a caption, title, description, hashtags or publish.yaml, to make a post more discoverable, to localize a caption into Vietnamese, to add the AI disclosure, or before scheduling any post.
---

# omninoise-seo: be found, say what is true

Read `omninoise.profile.yaml` at the workspace root first. The caption rules below are the defaults; the profile has the real numbers for your channels: `channels.<kind>.language`, `footer`, `hashtags` (a `[min, max]` range), `max_chars`, plus `brand.hub`, `ban`, `hashtag_ban` and `ai_disclosure`. If you have none, copy `references/profile.example.yaml` from the omninoise-platform skill (installed beside this one) to your workspace root.

A post is found through its first line, its title, its tags and the account behind it. It is trusted through what it says about itself: where the voice and the pictures came from, and where to find the rest of the channel. This skill covers both.

## Titles

- **Keyword first.** Lead with the thing a person would type, then the angle. "Claude Code hooks block a bad commit" beats "Why you should care about this one trick".
- **YouTube title: 100 characters at most, counting the " #Shorts" you append.** Write the title in 90 characters or fewer. YouTube rejects `<` and `>` in a title or description at publish time, so never use them.
- **TikTok title: 90 characters at most.** Facebook takes a title too; keep it the same keyword-first line.
- The first caption line carries the keyword as well. It is what shows before "more".
- Use the same hook, or a variant of the same pattern, on the cover, the title and the first caption line (omninoise-strategy has the hook bank).

## Hashtags and tags

Hashtags are written without `#` in `publish.yaml` and added as `#Tag` in the caption. They must match the topic: a broad tag (`AI`), a niche tag (`ClaudeCode`) and a community tag (`BuildInPublic`). Never a tag unrelated to the video, and never a word in the profile's `hashtag_ban` (for example the studio's own name).

| Channel | Hashtags | Notes |
|---|---|---|
| YouTube | 3 to 5, in the description | Plus 5 to 10 separate search `tags` (lower case phrases, "claude code", "ai agents"). YouTube shows the first three description hashtags above the title. |
| Instagram | 1 to 5 | Instagram caps hashtags at 5. At the end of the caption, after the footer. |
| TikTok | 3 to 5 | After the footer. |
| Facebook | 2 to 3 | At the end. |
| Threads | exactly 1 | One topic tag. It counts toward the 500 characters. |

These are the defaults; the profile's `channels.<kind>.hashtags` range wins.

## Caption structure

- **Hook line first**, then the payoff in one or two plain sentences, then the call to action. One to three short lines for a video; at most three.
- **AI disclosure** in its own sentence ([below](#ai-disclosure)).
- **Links.** Instagram and TikTok captions cannot carry a clickable link, so they do not link: the bio carries the hub, and the footer says "link in bio" (Instagram) or names the hub as plain text (TikTok). YouTube, Facebook and Threads put the post's own link (if it has one) on its own line, labelled ("Code:", "Full write-up:").
- **Hub footer, last before the hashtags.** Every channel's content ends with its footer (`channels.<kind>.footer`), on its own line after the post's own link. On Instagram, Threads and TikTok it goes before the hashtags. Copy it from the profile, never retype it, and refuse to schedule a post that lost it. One hub that every bio and every post points at lets the audience converge on one entity you can measure, so a viewer on any channel finds the other four.
- **Order for each platform:**

| Channel | Order |
|---|---|
| YouTube | caption, hashtags, footer, `#Shorts` |
| Instagram | caption, plain link if any, footer, blank line, hashtags |
| TikTok | caption, plain link if any, footer, hashtags |
| Facebook | caption, hashtags, footer |
| Threads | caption (short), link, footer, hashtag; 500 characters in total |

A long caption needs a shorter `caption_threads` that fits Threads with its link, footer and tag.

## Language order per channel

`channels.<kind>.language` is `en` or `vi-first`.

- **`en`** channels get the English cut and an English caption.
- **`vi-first`** channels get the Vietnamese cut and a caption that is Vietnamese first, then a blank line, then the same text in English, then the hashtags once at the end. Each half keeps the one-to-three-line limit, says nothing the other does not, and carries the AI disclosure in its own language. A Vietnamese audience is on these channels and reads Vietnamese first; English below keeps the global one.
- Where a project has only a Vietnamese cut, that cut and the Vietnamese-first caption go to every channel.

The English half is a faithful translation; neither half may say anything the other does not. Every Vietnamese line gets the same source review as the English one, because a translation error is a factual error.

## Vietnamese is written, not translated

Check every Vietnamese line against [references/vietnamese-style.md](references/vietnamese-style.md): voice-over, burned-in captions, titles and captions. Write what a Vietnamese developer would say out loud, then check that it still means what the source says. Add each correction the owner makes to the phrase map so the same mistake is not made twice.

## AI disclosure

Say what is AI, in both languages, in its own sentence:

| Used | English | Vietnamese |
|---|---|---|
| Voice | "AI-generated voice." | "Giọng đọc do AI tạo." |
| Voice and art | "AI-generated voice and art." | "Giọng đọc do AI tạo, hình cũng do AI vẽ." |
| Music (no voice) | "AI-generated music." | "Nhạc do AI tạo." |
| Neither (a carousel drawn in code) | no line | no line |

- The profile's `ai_disclosure.en` and `ai_disclosure.vi` are regexes a caption must match when voice, music or art is used. A `vi-first` caption must match both. Check with them before scheduling.
- A frame that shows generated art carries a small "AI-generated art" label as well.
- Set the platform's own AI label wherever one exists. TikTok `UPLOAD` drafts drop that setting, so the owner turns the label on in the app when publishing the draft (omninoise-platform).

## Never in public text

Never any string from the profile's `ban` list (an internal studio address, a private repo name), in a bio, caption, title, tag, video, slide or recording. Name the studio or product behind the channel only in a video or caption that introduces it, with its public link, and never as a hashtag. Every other post presents its topic under the channel's name. Public links are the hub and the sites you list in the profile.

## `publish.yaml`

One file beside each video project, read by `omninoise publish` and by anyone scheduling by hand. Format and a worked example: [references/publish-yaml.md](references/publish-yaml.md). The checks a scheduler should refuse on:

- a banned string anywhere, or a banned hashtag;
- a missing or wrong AI disclosure for the voice, music or art used;
- hashtags outside the channel's range;
- a YouTube title over 100 characters with " #Shorts", or any `<` `>` in it;
- a Threads text over 500 characters;
- a post whose content lacks its channel's footer.
