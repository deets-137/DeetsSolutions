# Splitting main.css — findings and outcome

**Status: executed (phase 1), branch `stats-and-more`.** The trigger fired
early: rather than wait for the next game's first commit, the split ran
ahead of the accounts phase-2 (game stats) work so the new stats box would
land in a per-page file instead of the bottom of a 5,100-line monolith.

Phase 1 moved **the two games out and the shared chrome into its own
file**. The journals, Home, League and DeetsRadio deliberately stayed in
`main.css` — see "What's left" below.

## What shipped

`styles/main.css` was 5,099 lines. It is now four files:

| File | Lines | Owns |
| ---- | ----- | ---- |
| `styles/chrome.css`   | ~1,010 | Token imports + everything every page needs |
| `styles/main.css`     | ~2,685 | One section per non-game tab |
| `cities/cities.css`   | ~726  | The DeetsCities block |
| `mahjong/mahjong.css` | ~717  | The DeetsMahjong block |

The cut was verified content-identical: stripping comments and blank lines
from the original and from the union of the four files yields byte-identical
sorted output (4,145 lines each side). No rule was rewritten, reordered
within its section, or dropped.

### The open question, answered

The plan asked whether to pull the shared kit into a named file or leave it
in `main.css`. **Named file: `styles/chrome.css`.** The deciding factor was
that the shared rules were not contiguous — they were scattered across six
ranges in three different "sections", including a global focus ring stranded
at the tail of the radio block and the `.account-btn` rules below mahjong.
A filename makes "this is shared, don't fork it" visible; a comment banner in
a 5k-line file did not.

`chrome.css` carries, in this order: the four `@import`s and the structural
tokens; reset, canvas/ocean/storm layers, sprite walkers; header, wordmark,
nav, mobile nav; the settings menu; `.page-bar`; the `.sotd__bar` /
`.sotd-toolbar` bar primitive; the `tb-` pill/popover kit; toasts; the focus
ring; `.account-btn`; and `.prose` / `.auth-done`.

### `.sotd__bar` is chrome, not journal CSS

Seven pages open with `.sotd__bar` — sotd, movies, league, radio, profile,
cities, mahjong. It was filed under the "Song of the Day" banner purely
because that is the tab it was born in. It moved to `chrome.css` **without
being renamed**: renaming churns seven pages of HTML and JS for cosmetics,
and the class name is load-bearing in each page's script. The misnomer is
now documented at its definition instead.

Bonus: CLAUDE.md requires `.page-bar` and `.sotd__bar` stay visually in
sync. They are now adjacent in one file, which makes that rule enforceable
by reading rather than by memory.

## Cascade order per page

```
styles/chrome.css        every page, first — carries the token imports
styles/main.css          non-game pages only
styles/table.css         game pages only (unchanged)
<game>/<game>.css        game pages only, last
```

`main.css` has **no `@import`s of its own** — it inherits chrome's token
cascade and must never be linked without it.

Two pages are now chrome-only and link nothing else: `privacy/index.html`
and `auth/done.html`. Both used exclusively shared classes; `auth/done.html`
went from downloading 5,099 lines to 1,009.

The game pages **no longer link `main.css` at all**. This was verified safe:
every shared class they use resolves in `chrome.css` or `table.css`, and the
only references to shared classes left in `main.css` are comments or
radio-scoped (`:root[data-radio-shell]`, `.radio-shell__actions`).

### Cascade regressions checked, none found

Moving the focus ring and `.account-btn` earlier could in principle let a
later page rule win where it previously lost. Verified three ways: no
selector string appears in both `chrome.css` and `main.css`; no selector
appears in both `chrome.css` and either game sheet; and the one rule that
overlaps behaviourally (`.sotd-cal__day.is-selected`, specificity 0-2-0)
already beat the ring (0-1-1) on specificity before the move, so order was
never what decided it.

## Cleanups done in the same pass

- **`tb-` namespace fixed.** `.tb-pop__head` and `.tb-pop__empty` were
  defined in `styles/table.css`, so they existed only on the two pages that
  link it. They moved to the `tb-` kit in `chrome.css` where the rest of the
  namespace lives.
- **`--seat-edge` token added.** The hairline `rgba(0, 0, 0, 0.25)` around a
  seat swatch was hardcoded in three places (`.gt-dot`,
  `.gt-colorpick__swatch`, and the profile page's own `.profile-swatch`) —
  an undeclared token-discipline exception. It is now one token in
  `chrome.css`, deliberately a fixed literal rather than a theme role
  because it outlines an *arbitrary user-picked hex* and must not follow the
  theme. It lives in `chrome.css` rather than `table.css` because `/profile/`
  renders the same picker without loading the table shell.
- The two remaining `rgba(0, 0, 0, 0.25)` literals in `cities/cities.css`
  (`.cities-token`, `.cities-vhint__bg`) are inside that file's **declared**
  board carve-out and are legal as-is.

## The first promotion the split made visible

Splitting the games into sibling files made it obvious that they had
independently built the same two things. Both were promoted immediately
after, in the same branch:

- **The turn timer.** `timerLeftMs`, `fmtClock`, the clock-text tick and the
  whole ring (`RING_R`/`RING_C`, `ringDot`, `tickRing`) were byte-identical
  in both games, as was the CSS ring kit. All of it now lives in
  `games/table.js` + `styles/table.css` as `TBL.timerRing` / `TBL.timerText`
  and `.gt-ring` — see [games.md](games.md), "Turn timer". The Durable
  Object always owned the clock itself; only the readouts were duplicated.
- **The seat accent.** `--cstrip` and `--mjstrip` were the same token under
  two names. Now `--gseat`, set through `TBL.seatAccent(node, seat)`.

The promotion also **fixed a live bug**: both games kept the ring's tick
handle in one module-global, so each new ring cancelled the previous one's
timeout. Cities never noticed (one active seat at a time), but mahjong's
claim window waits on several seats simultaneously — every ring but the
last silently froze at its first frame. Handles now live on the node.

Net: ~189 lines of duplicated game code replaced by ~124 shared lines.

The general lesson is written up as the **"Change radius"** table in
[games.md](games.md), which is where a session should start before editing
anything game-related.

## What's left (phase 2, unscheduled)

Still in `main.css`, one banner-delimited section each: Song of the Day,
Movies, Cool Stuff, Home, Resume, League, DeetsRadio, Profile. Radio (~1,130
lines) and Home (~500) are the two worth moving next.

**The blocker for the journals specifically:** the `.song*` card primitives
do not belong to sotd/movies alone. `league.js` and `radio.js` both use
`.song__chip`, and `home.js` uses a wider slice (`song__art`, `song__cover`,
`song__mono`, `song__play`, `song__link`, `song__links`, `song__tags`). The
card block cannot be cut cleanly until those chip/cover primitives are split
out into `chrome.css` first. That is a real refactor, not a cut-and-paste,
which is why phase 1 left it alone.

## Pre-existing issues found, not fixed

Not regressions — they predate the split and were left alone deliberately:

- `--font-display` and `--fs-h2` are **referenced but never defined** in any
  tier. Confirmed absent from `skin.css` at HEAD before the split too. They
  silently fall back to inherited values. Used by `.prose h2` among others.
- `--toast-accent` is referenced by the toast rules but set nowhere in CSS
  or JS that a repo-wide grep finds.

## What did not change

Token discipline (tier-2/3 tokens only, no hex, no hardcoded geometry), the
30-combo rule, the `gt-` prefix rule, the art carve-outs. Those are per-rule
constraints; the split is per-file.

**Look-and-feel verification is still Aditya's** — the mechanical checks
(every page 200s, every stylesheet resolves, no content lost, no cascade
crossings) all pass, but no browser has rendered these files.
