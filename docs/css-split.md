# The stylesheets — architecture, and what's left to split

**Status: phase 1 executed 2026-07-28.** The games and the shared chrome are
out of `main.css`. The journals, Home, League and DeetsRadio are still in it;
phase 2 is unscheduled. **Archive this file once phase 2 lands** — until then
the "What's left" section below is the only record of why it stopped here.

## Current architecture

Five files, loaded in this order:

```
styles/chrome.css        every page, FIRST — carries the token @imports
styles/main.css          non-game pages only (no @imports of its own)
styles/table.css         game pages only — the gt- table shell
<game>/<game>.css        game pages only, last
```

| File | Lines | Owns |
| ---- | ----- | ---- |
| `styles/chrome.css`   | ~1,030 | Token imports + everything every page needs |
| `styles/main.css`     | ~2,685 | One section per non-game tab |
| `styles/table.css`    | ~265  | The shared game table shell |
| `cities/cities.css`   | ~715  | The DeetsCities block |
| `mahjong/mahjong.css` | ~705  | The DeetsMahjong block |

`chrome.css` carries, in order: the four `@import`s and the structural
tokens; reset, canvas/ocean/storm layers, sprite walkers; header, wordmark,
nav, mobile nav; the settings menu; `.page-bar`; the `.sotd__bar` /
`.sotd-toolbar` bar primitive; the `tb-` pill/popover kit; toasts; the focus
ring; `.account-btn`; `.prose` / `.auth-done`.

**`main.css` must never be linked without `chrome.css`** — it has no imports,
so on its own it resolves no tokens at all.

**Game pages do not link `main.css`.** If a game needs a rule that lives
there, the rule is in the wrong file — promote it to `chrome.css` rather than
copy it. See the "Change radius" table in [games.md](games.md).

Two pages are chrome-only: `privacy/index.html` and `auth/done.html`.

### `.sotd__bar` is chrome, not journal CSS

Seven pages open with it — sotd, movies, league, radio, profile, cities,
mahjong. It was filed under the "Song of the Day" banner only because that is
the tab it was born in. It lives in `chrome.css` now, **unrenamed**: the class
name is load-bearing in seven scripts, and renaming it buys nothing. It sits
beside `.page-bar`, which it is required to stay visually in sync with
(CLAUDE.md) — a rule that is now enforceable by reading rather than memory.

## What's left (phase 2, unscheduled)

Still in `main.css`, one banner-delimited section each: Song of the Day,
Movies, Cool Stuff, Home, Resume, League, DeetsRadio, Profile. **Radio
(~1,130 lines) and Home (~500) are the two worth moving**; Movies, Cool Stuff
and Resume are too small to earn their own files.

**The blocker for the journals specifically:** the `.song*` card primitives
are not sotd/movies-only. `league.js` and `radio.js` both use `.song__chip`,
and `home.js` uses a wider slice (`song__art`, `song__cover`, `song__mono`,
`song__play`, `song__link`, `song__links`, `song__tags`). The card block
cannot be cut cleanly until those chip/cover primitives are promoted to
`chrome.css` first. That is a real refactor, not a cut-and-paste, which is why
phase 1 left it alone.

## Pre-existing issues found, still unfixed

Not regressions — they predate the split:

- **`--font-display` and `--fs-h2` are referenced but never defined** in any
  tier. Confirmed absent from `skin.css` before the split too. They silently
  fall back to inherited values. `.prose h2` is one user.
- **`--toast-accent`** is referenced by the toast rules but set nowhere in CSS
  or JS that a repo-wide grep finds.
- **`games/colors.js` has a stale comment** placing the `--gseat-*` carve-out
  in `main.css`; it is in `table.css`. Left alone deliberately — that file is
  vendored byte-identically into three worker repos, so a comment fix forces a
  re-vendor. Fold it into the next vendored change.

## What did not change

Token discipline (tier-2/3 tokens only, no hex, no hardcoded geometry), the
30-combo rule, the `gt-` prefix rule, the art carve-outs. Those are per-rule
constraints; the split is per-file.

---

## History

**Why it happened.** Every page shipped all 5,099 lines — `auth/done.html`
included, which could render 14% of them. But size was the weak argument. The
real ones were that one monolithic file is the repo's biggest merge-conflict
magnet across parallel sessions, and that a fourth game would have pushed it
past 5,800 lines with four games' CSS on every page.

**How it was verified.** Comments and blank lines stripped, the original and
the union of the new files sorted to the same 4,145 lines — no rule rewritten,
reordered within its section, or dropped. All 12 pages 200, every stylesheet
resolving, and no selector string appearing on both sides of a new file
boundary. The one behavioural overlap (`.sotd-cal__day.is-selected`, 0-2-0,
vs the focus ring, 0-1-1) was already decided by specificity, not order.

**What it immediately exposed.** Splitting the games into sibling files made
it obvious they had independently built the same two things, both promoted in
the same branch:

- **The turn timer.** `timerLeftMs`, `fmtClock`, the clock-text tick and the
  whole ring were byte-identical in both games, as was the CSS ring kit. Now
  `TBL.timerRing` / `TBL.timerText` and `.gt-ring` — see [games.md](games.md).
  The Durable Object always owned the clock; only the readouts were doubled.
- **The seat accent.** `--cstrip` and `--mjstrip`, the same token under two
  names. Now `--gseat` via `TBL.seatAccent(node, seat)`.

The promotion **fixed a live bug**: both games kept the ring's tick handle in
one module-global, so each new ring cancelled the previous one's timeout.
Cities never noticed (one active seat at a time); mahjong's claim window waits
on several seats at once, so every ring but the last froze at its first frame.

Two cleanups rode along: `.tb-pop__head` / `.tb-pop__empty` moved out of
`table.css` into the `tb-` kit that owns the namespace, and the seat-swatch
hairline became `--seat-edge` (hardcoded in three places, the profile page
having its own copy). It stays a fixed literal on purpose — it outlines an
arbitrary user-picked hex, so it must not follow the theme.

The general lesson is the **"Change radius"** table in [games.md](games.md).
