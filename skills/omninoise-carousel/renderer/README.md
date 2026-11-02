# carousel renderer

Still-image carousels (Instagram, Facebook, Threads, TikTok photo posts) rendered from a JSON spec. Remotion project, no audio. Every slide is a 1080x1350 (4:5) JPEG under 1 MB. It belongs to the `omninoise-carousel` skill; the skill's `SKILL.md` says when and why to use it.

## Use

```bash
bun install
bun run render-post <slug>   # <posts>/<slug>.json -> <out>/<slug>/<locale>-<nn>.jpg, both locales
bun run studio               # preview one sample slide; pass your own with: bun run studio -- --props=<file>
bun run typecheck && bun run lint && bun test
```

## Where it reads and writes

Resolved by `scripts/workspace.ts`, first hit wins:

| What | Order |
|---|---|
| Profile | `--profile <file>`, `$OMNINOISE_PROFILE`, else the nearest `omninoise.profile.yaml` above the current folder or above this renderer |
| Posts folder | `--posts <dir>`, `$OMNINOISE_POSTS`, `<workspace>/render/cards/posts`, else the bundled `example/` |
| Logo | `--brand <dir>` (a folder holding the file named by `brand.logo`), else `brand.logo` from the profile, else a placeholder in `public/brand/` |
| Brand text | `brand.name` (header and close slide) and `brand.hub` without its scheme (footer and close slide) from the profile |
| Output | `--out <dir>`, else `<workspace>/render/cards/out`, else `./out` |

The logo is copied into a scratch public folder (`.workspace/`, gitignored) as `brand/logo.png` for the render and removed afterwards. Each slide is one Remotion `still` of the `Slide` composition with its props passed as a file, so a workspace's posts never have to be bundled into the renderer.

## Spec (`<posts>/<slug>.json`)

`{ slug, claims, sources[], locales: { en, vi }, publish }`. Each locale is `{ series, slides[] }`; `en` and `vi` carry the same slides. `src/spec.ts` holds the types and `parsePost`, which throws with the path of any unknown slide type or missing field (`bun test` checks the bundled sample, and your posts too when `OMNINOISE_POSTS` points at them).

| `type` | Fields |
|---|---|
| `cover` | `title[]` (one string per line), `sub?` |
| `points` | `title`, `items[{text, tone?}]`, `note?` |
| `quote` | `title?`, `quote`, `source` |
| `flow` | `title`, `steps[{label, sub?, code?, tone?, branches?[{label, sub?, tone?}]}]`, `loop?{from,to,label}`, `note?`, `tip?` |
| `files` | `title`, `files[{path, tag?, reader?, lines[{text, tone?}]}]`, `link?{from,to,label}` (arrow in the gap between two adjacent cards), `note?` |
| `save` | `title`, `rows[{label, code}]` |
| `close` | `cta`, `link?` |

`tone` is `accent`, `danger`, `ok`, `muted` or `plain` (default). Inline markup in any text: `` `code` `` (mono chip) and `**word**` (accent, bold). Nothing else.

Sizes are chosen conservatively per slide type; the `flow` slide measures its nodes and scales down to fit up to five steps plus branches. Look at the renders before scheduling: text that is too long still wraps, it does not shrink.

## House rules

- Text comes from the post's `claims` file; every claim traces to your source ledger (`content/sources.yaml`).
- English slides go to channels whose `language` is `en`, Vietnamese slides to the `vi-first` ones. Check Vietnamese against the omninoise-seo skill's `references/vietnamese-style.md`.
- Never put a string from the profile's `ban` list on a slide.
- Palette and fonts (Be Vietnam Pro, Roboto Mono, fetched from Google Fonts at render time) match the explainer template. Swap the palette in `src/theme.ts`.
