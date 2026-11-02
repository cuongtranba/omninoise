# Claims: <title> (en <seconds> s, vi <seconds> s)

Sources are ledger ids from your `content/sources.yaml` (see the omninoise-strategy skill). Every spoken line sits beside the source sentence it rests on. A line with no quote here must be cut.

The hook's pattern (from the hook patterns in the omninoise-strategy skill) is: <pattern>. The line that pays it off is: <scene and line>.

## Script

| Scene | Line (`content/en.yaml`) | Tiếng Việt (`content/vi.yaml`) | Source sentence |
|---|---|---|---|
| Hook | One idea, painted and built in a minute. | Một ý tưởng, vẽ và dựng xong trong một phút. | `<ledger id>`: "<quote>" |
| Outro | Replace this sample with your idea. Follow for daily AI build lessons. | Thay đoạn mẫu này bằng ý tưởng của bạn. Theo dõi để mỗi ngày học thêm cách làm với AI. | The second sentence is the channel's call to action, not a claim. |

## On-screen text and pictures

| Text / picture | Support |
|---|---|
| Every background picture | Painted by Codex for this video (`art.yaml`, `art/manifest.json`). Abstract illustrations; no screenshot, account, post or person. The art label is on every frame. |

## Simplifications to be aware of

- Say here every place where a short line simplifies its source, so the next reader sees it.
- The voice is AI and the pictures are Codex's, so the captions say so.
