# The weekly review

One review a week, written to `content/metrics/week-NN.md`, ending with at most three decisions. The method matters more than the numbers.

## Collect

For every post that is more than a day old, read analytics with `analyticsTool` (`postId`, `days: 7`). The figures are running totals since the post went out, as each platform reports them: YouTube, Instagram and Threads "views", Facebook "plays". Write the date and time you read them. Note what is missing:

- A TikTok video published by hand from an inbox draft has no per-video numbers in Omninoise (`missing: true`). Use the channel total only, and attribute none of it to a video.
- YouTube counts lag. A 0 on a video less than a day old means nothing yet.
- Say if the week had no comments and no shares; that is a finding, not noise.

## Look first for visibility

Before you read performance, check that nothing is private or hidden: open the posts logged out, and check that the Meta apps are Live. A low number on a post nobody could see is not a result.

## Tabulate

One row per video: kind, when it went out, views on each platform, total, likes. Then average by kind (a kind needs at least two videos older than a day to average). Compare kinds, not individual videos, and give the number of videos behind each average.

Judge each format by its own measure:

| Format | Look at |
|---|---|
| Video | views, and retention or completion where the platform shows it |
| Carousel | saves, shares, completion; not likes |
| Everything | comments and shares, because a platform rewards those |

## Caveats to write down

Every review lists what cannot be separated: a format that always went out in one slot, a series that started the same day as a new cadence, a platform with a short history. Do not read a cause out of a confound.

## Decide, one variable at a time

Pick at most three experiments for next week and change one variable per experiment: the hook style, the length, or the time slot. If you change the hook style and the slot together, you will not know which one worked.

- If a carousel underperforms, fix slide 1 or the framework, not the middle.
- Compare carousels with videos in the next review before changing the mix.
- Move a series to the front if its kind clearly outperforms (in the example week, developer tools averaged about 590 views, architecture and concepts about 390, and a story series about 65, though the story series shared one slot).
- Decide the slot and the cadence again only after two weeks.

## What the review is not

It is not a report to a boss. It is the input to the next week's backlog. End it with the three decisions and the date of the next review.
