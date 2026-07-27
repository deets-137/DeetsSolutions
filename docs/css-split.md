# Splitting main.css — findings and plan

**Status: planned, not executed.** The trigger is the first commit of the
next game tab, whichever game that turns out to be (poker, King of the
Coop, or something else) — the new game gets born into its own CSS file
instead of migrated later, and the existing page sections move out in the
same sitting. Until then, nothing changes; keep adding to `main.css` as
usual.

## Findings (snapshot: 2026-07-27, commit b2979f4)

The repo is *not* uniformly heavy. `index.html` is 201 lines, each tab
already has its own HTML file, and the JS is already factored the way we
want it (one page-local script per page, shared machinery in `games/` and
`js/`). None of that needs restructuring.

The one genuine candidate is `styles/main.css` — 4,934 lines — and it is
already "split" in every way except being one file. The `====` section
banners map it cleanly (line numbers will drift; the banners are the
durable anchors):

| Section (by banner)                              | Lines       | ~Size |
| ------------------------------------------------ | ----------- | ----- |
| Site chrome: frame, header, nav, wordmark        | 1–448       | 450   |
| Settings menu (theme/skin picker)                | 449–628     | 180   |
| SOTD + the shared journal card/toolbar kit       | 629–1308    | 680   |
| Movies                                           | 1309–1366   | 60    |
| Cool Stuff                                       | 1367–1456   | 90    |
| Home                                             | 1457–1957   | 500   |
| Resume                                           | 1958–2045   | 90    |
| League                                           | 2046–2376   | 330   |
| DeetsRadio                                       | 2377–3505   | 1,130 |
| DeetsCities                                      | 3506–4223   | 715   |
| DeetsMahjong                                     | 4224–4934   | 710   |

Over half the file is the three newest tabs (radio, cities, mahjong), and
everything from the radio banner down is fully page-scoped — no rule in
those sections is used by any other page. The seams are clean; the split
is a mechanical cut-and-paste, not a refactor.

## Why split (and why not yet)

1. **Every page pays for every page.** All ~5k lines ship to someone
   loading the resume. Minor on a flat static site, but it grows by
   ~700 lines per game.
2. **Parallel-session merge conflicts.** Work happens in parallel Claude
   sessions that each push; one monolithic file that every feature
   touches is the repo's biggest conflict magnet. Per-page files make a
   radio-polish session and a mahjong-polish session conflict-free.
3. **Navigability.** The banners still work at 5k lines; they will not
   at 6k+ with a fourth game section.

Against splitting *preemptively*: the file works today, the banners still
navigate it, and a split with no motivating feature is churn. Doing it as
the next game's first commit means the split pays for itself immediately.

## The plan

**Per-page files live next to their page**, mirroring the JS convention
(`radio/radio.js` → `radio/radio.css`):

- `radio/radio.css`, `cities/cities.css`, `mahjong/mahjong.css` — the
  big three, ~2,550 lines out.
- The new game starts life in `<game>/<game>.css`.
- Optional, only if the sitting is going smoothly: `js/../home` has no
  directory, so Home (500 lines) would go to `styles/home.css`; League
  (330) to `league/league.css`. Movies, Cool Stuff, and Resume are too
  small to be worth their own files — they stay.

**What stays in main.css** (slimmed to roughly its first 1,300 lines):
the site chrome, the settings menu, the page-bar, and the shared journal
card + toolbar/pill/popover kit. That kit is genuinely multi-page CSS —
unlike its JS, which the journals deliberately duplicate — so it keeps a
single copy. Open question for the sitting: whether to pull the kit into
a named `styles/journal-kit.css` so the "this is shared, don't fork it"
rule is visible in the filename, or leave it in main.css. Either is fine;
don't duplicate it per journal.

**Cascade order per page** — each page's `<head>` links, in order:

```
styles/palette.css → themes.css → skin.css   (token tiers, unchanged)
styles/main.css                              (shared chrome + kits)
styles/table.css                             (game pages only, unchanged)
<page>/<page>.css                            (the moved section)
```

The page file loads last, preserving today's source order for any
equal-specificity overrides. Sections are page-scoped so the risk is low,
but keep the order anyway.

**Mechanics:** pure cut-and-paste by banner — no rule rewrites, no
selector changes, the banner comment becomes the new file's header. Then
verify every page loads clean (console, DOM counts) and spot-check a few
theme×skin combos; look-and-feel verification is Aditya's, as always.
Estimated effort: about an hour of careful moves plus verification.

**What does not change:** token discipline (tier-2/3 tokens only, no hex,
no hardcoded geometry), the 30-combo rule, the `gt-` prefix rule, the art
carve-outs. Those are per-rule constraints; the split is per-file.

## Doc touch-points when executing

The split lands in prose too — sweep the docs for "main.css" mentions and
update at least:

- [games.md](games.md) "Adding a game" step 5 ("`styles/main.css` — one
  block") becomes "`<game>/<game>.css`".
- [architecture.md](architecture.md) — the intro says every page loads
  `styles/main.css`; the tier table's Tier 4 line needs the per-page
  files added.
- [CLAUDE.md](../CLAUDE.md) — the token-discipline bullet names
  `styles/main.css`; widen it to cover the per-page files.
- This file — flip the status line to executed, with the commit.
