# Vietnamese style: say it the way people talk

Every Vietnamese line, whether a voice-over, a burned-in caption, a title or a Facebook or TikTok caption, is checked against this file before review. A Vietnamese line translated word for word from English reads as machine output ("AI slop"), and viewers notice at once. Write what a Vietnamese developer would say out loud, then check that it still means what the source says (a translation error is a factual error).

When the owner corrects a line, add the pair to the table below with the reason, so the same mistake is not made twice. This map starts with generic entries; yours will grow.

## Phrase map

| Stiff (do not use) | Natural (use) | Why |
|---|---|---|
| Đừng bao giờ để AI tự chấm bài của chính nó | Đừng để AI tự kiểm tra chính mình | "Đừng bao giờ" and "của chính nó" are English emphasis carried across; "chấm bài" turns an idiom into a school scene. |
| Xóa trí nhớ agent mỗi vòng. Cố ý. | Mỗi vòng lại xóa sạch trí nhớ agent. Cố tình đấy. | "Cố ý" on its own is a translated "On purpose."; spoken Vietnamese adds a particle. |
| Một đợt migration qua hàng trăm file là quá lớn cho một lượt | Migrate hàng trăm file thì một lượt chạy không kham nổi | "là quá lớn cho" copies "is too big for". |
| việc dài dễ mất đà | việc dài dễ hụt hơi giữa chừng | "Mất đà" is a translation of "lose momentum"; "hụt hơi" is how people say it. |
| không mất khi khởi động lại | restart cũng không mất | Developers say "restart". |
| Và nó tự dừng khi lệnh kiểm tra pass | Lệnh kiểm tra pass là loop tự dừng | Lead with the condition, the way people speak. |
| không bao giờ được vừa tạo ra hành động vừa tự tuyên bố nó an toàn | không nên vừa tự nghĩ ra việc cần làm, vừa tự phán là an toàn | "Tuyên bố" and "tạo ra hành động" are dictionary words for "declare" and "invent an action". |
| Lượt chạy xong không có nghĩa là việc đã xong | Chạy xong một lượt chưa chắc việc đã xong | "Không có nghĩa là" copies "doesn't mean". |
| cổng kiểm tra | khâu kiểm tra | "Cổng" is a literal "gate". |
| công việc đã được kiểm chứng | việc đã qua kiểm tra | Passive "đã được" plus the formal "kiểm chứng" read as a report. |
| niềm tin đến từ những gì bạn đọc được | đọc được thì mới tin được | "Niềm tin đến từ" copies "trust comes from". |

## Patterns to avoid

- **Carried-over emphasis:** "Đừng bao giờ", "của chính nó", "thật đấy" at the end of a title, "hoàn toàn", "một cách" + adjective.
- **Passive voice:** "được … bởi", "đã được kiểm chứng". Name who does it.
- **Dictionary verbs:** "tuyên bố", "thực hiện", "tiến hành", "sở hữu", "đảm bảo rằng". Use everyday verbs: "làm", "chạy", "phán", "lo".
- **English word order:** a sentence that starts "Khi…, nó…" or "Với…, bạn có thể…" in every line. Vary it; lead with the point.
- **Long sentences.** One idea per spoken sentence, as in the English cut.

## Terms that stay in English

Vietnamese developers say these in English, so the voice says them in English too: agent, AI agent, model, context, loop, task list, card, Done, merge, migrate, transcript, tool call, test, pass, restart, file, commit, branch, worktree, prompt, Claude, Codex, app, upload, calendar, media library, analytics, team, code, GitHub, TikTok, Facebook, YouTube, Instagram, Threads. Add your own product names.

Say these in Vietnamese: lượt (turn), vòng (round, iteration), lệnh kiểm tra (verify command), mục tiêu (goal), kế hoạch (plan), cột (board column).

## Before review

1. Read every line out loud. If it sounds like a translation, rewrite it from the meaning, not from the English words.
2. Check the line against the phrase map and the patterns above.
3. Check it against the source quote: natural wording must not add or drop a claim.

Hooks get the same check. The Vietnamese hook patterns ("Cách để…", "Lý do thật sự…", "Đừng… nữa") and their rules are in the omninoise-strategy skill's `references/hooks.md`; pick the pattern that sounds natural in Vietnamese even when the English hook uses a different one.
