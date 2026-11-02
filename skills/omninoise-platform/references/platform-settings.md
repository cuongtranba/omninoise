# Per-platform settings and limits

The schema from `integrationSchema` is the authority for limits and required fields. This table is what worked in practice. The profile's `channels.<kind>` entries give each channel's integration id, language order, footer and hashtag range.

| Channel kind (profile) | Provider (`__type`) | Settings that worked |
|---|---|---|
| `youtube` | `youtube` | `title` (keyword first, " #Shorts" included, 100 characters at most), `type: "public"`, `selfDeclaredMadeForKids: "no"`, `tags: [{value, label}]` |
| `instagram` | `instagram-standalone` | `post_type: "post"` (a single video publishes as a Reel; several images become one carousel). Caption 2,200 characters at most. |
| `tiktok` | `tiktok` | `title` (90 characters at most), `content_posting_method: "UPLOAD"`, `privacy_level: "PUBLIC_TO_EVERYONE"`, `duet: true`, `stitch: true`, `comment: true`, `autoAddMusic: "no"`, `brand_content_toggle: false`, `brand_organic_toggle: false`, `video_made_with_ai: true` (ignored by `UPLOAD`; the owner sets the AI label in the app) |
| `facebook` | `facebook` | `post_type: "post"`, `title` |
| `threads` | `threads` | none; 500 characters at most, counting link, footer and hashtag |

Use the "Tiktok" tile (the Login Kit provider), not "TikTok" (Business), when connecting TikTok. Use the "Instagram (Standalone)" provider for Instagram.

## Several images at once (carousels)

Each platform turns several attachments into one post, taken from the provider code at the time this was written:

| Platform | How several images post | Settings | Caption |
|---|---|---|---|
| Instagram | one carousel (`media_type=CAROUSEL`) | `post_type: "post"` | the channel's `language` |
| Facebook | one post with all the photos (`attached_media`) | `post_type: "post"` | the channel's `language` |
| Threads | one carousel (`media_type: 'CAROUSEL'`) | none | 500 characters |
| TikTok | one photo post | `content_posting_method: "UPLOAD"`, `title` (90 characters) plus the schema's required fields | the channel's `language` |
| YouTube | not available | | |

- **TikTok photo limits.** Pictures only, no mixing with video, at most 1080 px on the short side. `UPLOAD` keeps only the title and description, and photo posts have no AI label.
- **Slides** are 1080x1350 JPEGs under 1 MB each, attached in slide order.

## Covers

Omninoise applies a custom cover only on YouTube (`thumbnails.set` from the attachment's `thumbnail`, which needs a phone-verified channel) and Instagram Reels (`cover_url`). TikTok takes a cover timestamp only on Direct Post, and none in inbox mode. Facebook and Threads take none. Upload the JPG first (`uploadFromUrlTool` or `omninoise upload`) and pass its path as the video attachment's `thumbnail`.

## Cadence and slots

Slots come from `slots` in the profile: `video` times and a `carousel` time, in `slots.timezone`. Each video goes to every channel at its slot, in one call, so all channels publish in the same minute. Never put two posts on the same channel in the same minute. `postFindSlotTool` finds the next free time for a channel.
