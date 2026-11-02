# Hooks: open a loop the viewer has to close

The first line decides whether anyone watches the second. A hook works by opening a gap: it says there is a way, a reason or a mistake, and holds the answer back, so not knowing it itches ("tò mò, khó chịu, phải xem tiếp"). The video then closes that gap with what the source says. Why it is house style: a plain opening ('Here is how X works') gives the viewer no reason to stay, and a hook that translates word for word from English reads as machine output in Vietnamese, so each language gets its own.

Every video script (explainer narration, montage first caption), every carousel cover and every caption's first line starts from this bank. Write the hook **before** the rest of the script, because the script is the answer to it.

## Rules

1. **Withhold, never mislead.** The hook holds back the answer; it never promises one the video does not give. Every "how", "reason", "mistake" or number in it is paid off in the video and traced in `claims.md` to your source ledger (`content/sources.yaml`). No source, no hook.
2. **Pay it off late, not next.** Do not answer the hook in the second sentence. Set up the pain first, land the answer in the second half (about 60 to 75% of the runtime), and keep the end card for the follow line.
3. **Short.** Spoken English hook: 8 words or fewer. Spoken Vietnamese hook: about the same speaking time, 12 syllables (tiếng) or fewer. Both are audible inside the first second or two. Backlog and cover hook: 60 characters or fewer.
4. **Concrete.** Name the tool, the task or the pain ("Claude Code", "a 300-file migration", "your agent forgets"), never a vague "this trick".
5. **"I" only with a receipt.** A first-person hook ("I stopped…", "Tôi đã sai khi…") needs a source that records the owner doing it. Otherwise speak to the viewer ("you", "bạn") or about the thing itself.
6. **Contrarian about a practice, never a person.** "Stop doing X" targets a habit or a piece of advice. Never a named company, product or creator: the channel teaches, it does not pick fights.
7. **No empty bait.** Banned because nothing in the video can pay them off: "You won't believe…" / "Bạn sẽ không tin…", "This changes everything", "insane", "shocking", a number that is not in the source.
8. **Write each language for itself.** The Vietnamese hook is written from the meaning, not translated from the English one (the omninoise-seo skill's `references/vietnamese-style.md`). The two may use different patterns.

## Pick a pattern

Pick the type that fits the idea, draft three hooks from different rows, read them out loud, and keep the one that makes you want the answer. Record the pattern used in `claims.md` beside the hook line.

The tech examples show the shape only. A real hook still needs its own source, and a first-person or numeric example is usable only when a source records it.

### 1. Curiosity: a gap in what the viewer knows (default)

| English | Tiếng Việt | Tech example (EN / VI) |
|---|---|---|
| How to … | Cách để … | How to make an agent finish a 3-hour task / Cách để agent tự làm xong việc 3 tiếng |
| The fastest way to … | Cách nhanh nhất để … | The fastest way to review AI code / Cách nhanh nhất để review code AI viết |
| The real reason … | Lý do thật sự … | The real reason your agent forgets / Lý do thật sự agent cứ quên việc |
| What nobody tells you about … | Điều không ai nói với bạn về … | What nobody tells you about long agent runs / Điều không ai nói về agent chạy lâu |
| Why nobody talks about … | Sao không ai nhắc tới … | Why nobody talks about agent memory / Sao không ai nhắc tới trí nhớ của agent |
| Here's what happened when … | Chuyện gì xảy ra khi … | Here's what happened when two AIs shared one task / Chuyện gì xảy ra khi hai AI chung một việc |
| This one setting … | Chỉnh đúng một chỗ này … | This one setting stops runaway loops / Chỉnh đúng một chỗ này là loop hết chạy loạn |
| If I started over, I'd … | Làm lại từ đầu, tôi sẽ … | If I started over, I'd write the test first / Làm lại từ đầu, tôi sẽ viết test trước |
| I was wrong about … | Tôi đã sai khi … | I was wrong about letting AI grade itself / Tôi đã sai khi để AI tự kiểm tra mình |

### 2. Relatable: the viewer sees their own pain

| English | Tiếng Việt | Tech example (EN / VI) |
|---|---|---|
| Ever felt … | Bạn có bao giờ thấy … | Ever felt your agent got dumber mid-task? / Có bao giờ thấy agent làm nửa chừng thì lú? |
| Everyone has hit … | Ai cũng từng dính … | Everyone has hit the context limit / Ai cũng từng dính vụ hết context |
| If you've ever struggled with … | Nếu bạn từng vật vã với … | If you've ever fought a flaky test / Nếu bạn từng vật vã với test lúc pass lúc fail |
| You're not the only one who … | Không phải mỗi bạn bị … | You're not the only one losing AI chats / Không phải mỗi bạn bị mất chat với AI |
| I wish someone told me this before … | Ước gì có người nói điều này trước khi … | I wish I knew this before my first agent / Ước gì biết điều này trước khi dùng agent |
| It's not your fault that … | Không phải lỗi của bạn khi … | It's not your fault the AI drifts / Không phải lỗi của bạn khi AI làm lệch đề |

### 3. Contrarian: a common practice, turned over

| English | Tiếng Việt | Tech example (EN / VI) |
|---|---|---|
| Stop … | Đừng … nữa | Stop making your LLM deterministic / Đừng cố bắt LLM trả lời y hệt nữa |
| You don't need … | Bạn không cần … | You don't need a bigger model / Bạn không cần model to hơn |
| Everyone says …, but … | Ai cũng bảo …, nhưng thật ra … | Everyone says write better prompts. Wrong lever. / Ai cũng bảo viết prompt hay hơn, nhưng không phải chỗ đó |
| The worst mistake you can make with … | Sai lầm tệ nhất khi dùng … | The worst mistake with AI agents / Sai lầm tệ nhất khi dùng AI agent |
| Don't fall for … | Đừng mắc bẫy … | Don't fall for "one agent does it all" / Đừng mắc bẫy "một agent làm hết" |
| This advice is outdated: … | Lời khuyên này lỗi thời rồi: … | "Keep prompts short" is outdated advice / "Prompt càng ngắn càng tốt" lỗi thời rồi |

### 4. Result: a number or an outcome, stated as fact

Only with the owner's own number, quoted in a source.

| English | Tiếng Việt | Tech example (EN / VI) |
|---|---|---|
| How I [result] in [time] | Cách tôi [kết quả] chỉ trong [thời gian] | How I shipped 7 videos in one day / Cách tôi ra 7 video chỉ trong một ngày |
| The biggest lesson after … | Bài học lớn nhất sau … | The biggest lesson after 100 agent runs / Bài học lớn nhất sau 100 lượt chạy agent |
| This mistake cost me … | Sai lầm này làm tôi mất … | This mistake cost me a day of tokens / Sai lầm này đốt của tôi cả ngày token |
| This finally worked after I tried everything | Thử đủ kiểu, cuối cùng cách này chạy | Tried every prompt. This finally worked. / Thử đủ kiểu prompt, cuối cùng cách này mới chạy |

### 5. Action: the viewer is about to do the thing

Best for "Save this" carousels and guides. It is the opening, not a second follow line.

| English | Tiếng Việt | Tech example (EN / VI) |
|---|---|---|
| Don't … before you … | Đừng … trước khi … | Don't merge AI code before you check this / Đừng merge code AI viết khi chưa xem cái này |
| Save this if … | Lưu lại nếu … | Save this if you run agents overnight / Lưu lại nếu bạn hay để agent chạy qua đêm |
| Do this before you … | Làm cái này trước khi … | Do this before your next long agent run / Làm cái này trước khi cho agent chạy lâu |
| Send this to someone who … | Gửi cho đứa bạn đang … | Send this to whoever still copy-pastes from ChatGPT / Gửi cho đứa bạn còn copy-paste từ ChatGPT |
| Before you give up on …, try … | Trước khi bỏ …, thử … | Before you give up on agents, try this / Trước khi bỏ agent, thử cái này đã |

## Longer templates (captions and cover lines)

Too long to speak inside the first seconds, but good as the first caption line or a two-line cover:

- "I could get [what the viewer wants] in [time], but not the way I expected…" / "Tôi tưởng [điều người xem muốn] mất [thời gian], hóa ra không như mình nghĩ…"
- "If you still [weaker method], stop. Before you scroll, here's the proof." / "Nếu bạn vẫn còn [cách kém hiệu quả] thì dừng lại. Khoan lướt, có bằng chứng đây."
- "Can we agree [thing] is the most underrated part of [niche]?" / "Công nhận đi, [thứ đó] là phần bị xem nhẹ nhất trong [lĩnh vực]."
- "If you've struggled with [problem] while trying to [goal], this gives you clarity." / "Nếu bạn từng vật vã với [vấn đề] khi cố [mục tiêu], mẹo này sẽ gỡ rối cho bạn."
- "This changed how I [hobby/workflow]. Give me 30 seconds." / "Cái này đổi hẳn cách tôi [việc đó]. Cho tôi 30 giây."

## Checklist before the script goes on

- [ ] The hook names something concrete and opens a question the viewer cannot answer yet.
- [ ] The answer lands in the second half, and `claims.md` shows its source.
- [ ] English: 8 words or fewer spoken. Vietnamese: about 12 syllables or fewer, read out loud, not a translation.
- [ ] No banned bait, no number the source does not give, no "I" without a receipt, no named target.
- [ ] The cover (`src/cover.tsx` in the explainer template, carousel slide 1) and the caption's first line use the same hook, or a variant of the same pattern.
