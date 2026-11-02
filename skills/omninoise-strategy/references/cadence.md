# Cadence and slots

The cadence is a decision made from numbers, and it changes. This is the reasoning to reuse, not a schedule to copy.

## What a good cadence looks like

- **Several videos a day is possible** once the pipeline is automated, but each one must still pass the gate. A cadence the checks cannot keep pace with is too high.
- **Every video goes to every channel at the same minute.** In one scheduling call, one post per channel. Different cuts per channel are fine (English for some, Vietnamese for others), the time is the same.
- **A carousel a day** at its own slot, between the video slots, so the two formats do not compete for the same minute.
- **A buffer.** Keep two or three days queued. A failed render, a failed upload or a platform outage then leaves no gap.

## Slots

Choose slots from where the audience is awake, then adjust from analytics. A noon slot in one country is the middle of the night on the other side of the world. Example: 12:00 in Vietnam is 01:00 in New York, so it mostly reaches Asia and Europe, while a 20:00 slot there is morning in the US. If your audience is global, spread slots across time zones rather than stacking them.

Review the slots after two weeks of analytics, not after one video.

## Why one video cannot judge a slot

Two things change at once when a video goes out: its time and its format. If both videos of a format were scheduled in the same slot, the slot and the format cannot be told apart. And with several clips a day, a clip's views partly reflect the slot it sits in and the competition between same-day clips. Before you decide a slot is weak, put the same kind of video in two different slots and compare.

## Changing the plan mid-week

- Move a post with `postChangeDateTool` and `action: "schedule"`. `update` leaves the publish job at its old time, so a post "moved" that way still goes out at the old time. Move every post of a group, not one channel of it.
- Keep the order that keeps scripts true: a video that says "I showed this earlier this week" goes out after the video it refers to, in the same week.
- A video that misses its slot moves to the next free slot, in the same week, rather than being rushed past its checks.
- After a pack-the-week change, check the queue with `postsListTool`: one post per channel per slot, state `QUEUE`, no `error`.

## TikTok drafts count against you

While the TikTok app is unaudited, every TikTok post is an inbox draft the owner publishes by hand. Four videos a day is four hand-published drafts a day. Count that before you raise the cadence.

## After the queue empties

State in the plan the date the last queued video goes out and the date the next batch must be ready, so the gap is visible before it happens.
