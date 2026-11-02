# Sources and the fact gate

Every factual claim in a script, caption, slide or end card traces to a source in the ledger. The gate is a habit, not a tool: nothing is recorded, rendered or scheduled until each factual sentence has a ledger id and a quoted sentence beside it.

## The ledger: `content/sources.yaml`

```yaml
# id     stable key used by backlog items and claims.md
# kind   blog | repo | project | comic | docs | metrics
# title  as published
# url    public URL
# remote where the text was read from
# checked date this entry was last verified against the live source
sources:
  - id: blog-example-post
    kind: blog
    title: "A post you wrote"
    url: https://example.com/posts/example/
    date: 2026-06-07
    checked: 2026-10-28
  - id: docs-example-tool
    kind: docs
    title: "Example tool docs"
    url: https://example.com/docs/
    checked: 2026-11-01
```

- A source that is not in the ledger cannot be cited.
- Only material cleared for public use goes in. A private repo, a private run log or a page behind a login is not a source for a public claim.
- A site behind a login can still be a source you read yourself (read its feed through your secret wrapper), but panels, images and text you republish need the owner's clearance.
- **Docs are a source kind.** They change, so re-read the claim the day before its video renders. Feature lists from third-party tutorials are not sources.
- Repo `description` and `stars` change: re-read before quoting a number.

## `claims.md` beside every video and carousel

A table with one row per spoken line or slide: the line, the Vietnamese line, and the source sentence it rests on, quoted. Add:

- the hook's pattern and the line that pays it off;
- a list of simplifications ("another builds it" stands for the tool writing the scenes and running the render; the owner still sets the brief and reviews);
- on-screen text and pictures and what supports each (an illustration is labelled as one);
- the voice or music used, so the AI disclosure is traceable.

If a sentence has no quote, cut the sentence.

## What the gate refuses

- A number the source does not give.
- A caveat dropped: "early", "pre-alpha", "stubbed" stay in.
- A licence claim when two files in the repo disagree about the licence.
- A paraphrased quote that changes the claim. A Vietnamese quote slide that paraphrases an English source is labelled "(ý chính)".
- A real product screen, account, post or person painted by an image model. Draw it in code or leave it out.
- A terminal recording from a real project or chat. Terminal demos run only in a throwaway demo folder.

## Reading a Vietnamese line against its source

A translation error is a factual error. Check each Vietnamese line against the same source sentence as its English line, not against the English line.
