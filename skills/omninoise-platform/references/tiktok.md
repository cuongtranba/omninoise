# TikTok: inbox drafts until the audit passes

**State of play.** Posting to TikTok with `content_posting_method: "DIRECT_POST"` needs the TikTok app to pass TikTok's audit. Until then it fails, even as Self only on a public account. So every TikTok post is scheduled with `content_posting_method: "UPLOAD"`: the video or photos go to the owner's TikTok inbox as a draft.

- `UPLOAD` drops every setting except the title (and description), including `video_made_with_ai`. The owner opens the draft in the TikTok app, turns on the AI-generated label when the video uses AI voice, music or art, picks the cover frame, and publishes within 24 hours.
- A draft is not published until then. Record it in your published ledger only when the owner has published it.
- The schema's `rules` text says to prefer `DIRECT_POST`. Ignore that until the audit has passed.
- Photo posts (carousels) are inbox drafts with no AI label.

## Getting the audit through

- The production app needs Login Kit and the Content Posting API (Direct Post), every scope the instance requests (six), a redirect URI of `<your instance frontend>/integrations/social/tiktok`, a Terms of Service page and a Privacy Policy page, and a verified domain for each URL it uses.
- TikTok asks for an explanation and a demo video. Write the explanation in plain steps (what the tool does, where the user clicks, what is posted), at most 1,000 characters.

## If TikTok asks for a new demo video

1. Set the demo account to **private** (tiktok.com > Settings > Privacy). TikTok also switches comments to followers.
2. On the phone: TikTok > Profile > menu > Settings and privacy > Security & permissions > Apps and services > your app > Remove access. This makes the consent screen appear again.
3. Record a screen capture of: Add Channel > Tiktok > consent > Continue > Create Post > caption and media > privacy "Self only" > Direct Post > "Video made with AI" > Post now > the video on the profile.
4. Cap still frames at about 1.2 s so the video stays short.
5. Switch the account back to **public** and comments to **Everyone**.

## After approval

1. If production has its own client key and secret, put them in the instance's environment (`TIKTOK_CLIENT_ID`, `TIKTOK_CLIENT_SECRET`), redeploy and reconnect TikTok.
2. Schedule with `content_posting_method: "DIRECT_POST"`, `privacy_level: "PUBLIC_TO_EVERYONE"`, `video_made_with_ai: true`.
3. Update the `posting_method` of the `tiktok` channel in the profile from `UPLOAD` to `DIRECT_POST`.
