# `publish.yaml`

Each video project has one, beside its config: `render/explainer/<slug>/publish.yaml` or `render/montage/<slug>/publish.yaml`. Scheduling reads it; nothing is retyped.

```yaml
title: "Keyword-first title, 90 characters or fewer"   # YouTube title; " #Shorts" is added
caption: |                                     # 1 to 3 short lines; the first carries the keyword
  Hook line with the keyword.
  AI-generated voice. Follow for daily AI build lessons.
caption_threads: |                             # optional shorter text for Threads (500 characters with link, footer and tag)
  Hook line with the keyword. AI-generated voice.
link: "https://example.com/posts/<slug>/"      # optional; plain text on Instagram and TikTok; the hub footer is added after it
link_label: "Full write-up"                    # optional label before the link
hashtags:
  youtube: [AI, ClaudeCode, AIagents, coding, BuildInPublic]   # 3 to 5, also in the description
  youtube_tags: [ai agents, claude code, llm, software engineering, coding with ai]   # 5 to 10 search tags
  instagram: [AI, AIagents, ClaudeCode, coding, BuildInPublic]  # 5 at most
  tiktok: [AI, AIagents, coding, BuildInPublic]                 # 3 to 5
  facebook: [AI, AIagents, BuildInPublic]                        # 2 or 3
  threads: [AI]                                                  # exactly 1 topic tag
# For a project with a Vietnamese cut (out/<slug>-vi-1080x1920.mp4):
title_vi: "Tiêu đề tiếng Việt, từ khóa đứng đầu"
caption_vi_first: |
  Vietnamese text, one to three short lines. Giọng đọc do AI tạo.

  The same text in English. AI-generated voice.
# For a Vietnamese-only project (no English cut; every channel gets the Vietnamese cut):
# vi_only: true
```

## What goes where

| Channel | Cut | Caption | Title |
|---|---|---|---|
| YouTube | English (or the only cut) | `caption` | `title` + " #Shorts" |
| Instagram | English | `caption` | none (a Reel) |
| Threads | English | `caption_threads` or `caption` | none |
| Facebook | Vietnamese when the project has it | `caption_vi_first` | `title_vi`, else `title` |
| TikTok | Vietnamese when the project has it | `caption_vi_first` | `title_vi` (90 characters at most), else `title` |

The profile's `channels.<kind>.language` decides which channels take the `vi-first` text. The table above is the shape for the example profile.

## Covers

Every video ships two stills from its own project: `out/cover-1080x1920.jpg` (Instagram Reels cover; on TikTok and Facebook pick the frame by hand in the app) and `out/thumb-1280x720.jpg` (YouTube custom thumbnail). The cover is the hook split into 2 to 4 lines with the key word in the accent colour, the series label and the brand. Its words sit inside the centre 1080x1350 (Instagram's 4:5 grid crop). Keep each JPG under 1 MB. Threads takes no cover.

## Checks a scheduler should run

Refuse to send when any of these fails; fix the file, do not loosen the check.

1. No string from the profile's `ban`, and no `hashtag_ban` word in a hashtag.
2. The caption matches the profile's `ai_disclosure` regex for the language it is in. `caption_vi_first` matches both.
3. Hashtag counts are inside each channel's range.
4. `title` plus " #Shorts" is at most 100 characters and holds no `<` or `>`.
5. The Threads text is at most `max_chars` (500).
6. Each channel's content includes its footer from the profile.
