---
status: sop
sources: []
updated: 2026-11-23
---
# LESSONS — mistakes already paid for on this site

Modeled on the DeetsMusic repo's `docs/LESSONS.md`. This file decides no
forks; he does. It records what went wrong once, so the next session doesn't
pay for it again. Add a lesson when a mistake costs real time. Give it a
date, what happened, and the rule that would have stopped it. Rules
themselves live in [CLAUDE.md](../CLAUDE.md). This is the why behind some of
them.

## Code

- **Promote, don't copy (games).** The turn timer and the `--gseat` accent
  were each written twice before being promoted, and a bug rode along in
  the copy. When two games need one thing, it goes up a level
  ([games.md](games.md), "Change radius").
- **The mock and the worker run byte-identical vendored files.** Editing
  `table-do.js`, `colors.js` or an `engine.js` without re-vendoring means
  the mock tests different code from prod.
- **A theme or skin rename without a `RETIRED` entry silently resets every
  visitor who picked it.** The pre-paint scripts (19 pages) and their CSP
  hashes have to move together ([architecture.md](architecture.md)).
- **Mocks don't model disconnects.** Rejoin behavior that passes in `?mock`
  has proved nothing. It can only be tested live.

## Caching and deploy

- **`_headers` applies, but the zone's Browser Cache TTL (4 h) overrides
  `max-age=0` on CSS/JS** (found 2026-09-15). A deploy can pair fresh HTML
  with a 4-hour-old script; that's how the board-threads up-arrow broke.
  Until his dashboard setting is changed, bump the `?v=` stamps.
- **Locally, a cached `mahjong.js` ran stale code without any sign** (found
  before 2026-10-25). The dev proxy now sends JS/CSS `no-store`
  ([tooling.md](tooling.md), §1).

## Testing in the browser

- **Don't drive the mock through pasted harnesses** (2026-10-25). A 40-line
  harness had to be re-pasted after every reload, Gate and Add Bot clicks
  were flaky (Add Bot has a confirm step), and waits past about 45 s killed
  the Chrome tool's call. Use the dev driver's curl API
  ([tooling.md](tooling.md), §3).
- **The site's CSP blocks anything a dev tool adds**: another port's
  connections, `eval`. The dev proxy loosens it locally only. Never loosen
  it in `_headers`.
- **Restore what a test changes**: the look, mock tables, the recents list.
  He tests look-and-feel himself and should find the page as he left it.

## Page transitions (re-dezine, 2026-11-23)

The sliding nav tile took five rounds to get right. Each round fixed a real cause, but
the biggest one showed only when the trace was read from his browser.

- **Measure in his browser before guessing.** Rounds 1 to 4 were reasoned from the code:
  pages with no tile, the sticky panel's scroll offset, items that moved, fonts. All were
  real, and he still saw blips. The dev trace ([tooling.md](tooling.md) §3c) showed the
  main cause in one read: 15 of 18 arrivals refused the transition. Headless passed
  every time, at 1681 px and at his 3432 px. Headless is not his browser. For anything
  timing- or browser-dependent, turn the trace on first and ask him to click around.
- **Headless timing means nothing at his window size.** Headless Edge renders in
  software, so a transition arrival at 3432 × 1274 first-painted at 1.1–1.9 s with or
  without a change. A fix was nearly reverted for a "regression" that was the baseline.
  Measure a baseline in the same setup before blaming a change, and take timing from his
  trace.
- **Put the `@view-transition` opt-in inline in each page's `<head>`, not in a
  stylesheet.** His Edge refused about half its arrivals with "ViewTransition opt-in
  disabled". Three fixes in turn each helped and none was enough:
  1. moving the opt-in out of the width media query: 2 of 11 glided;
  2. `<link rel="expect" href="#main" blocking="render">` plus `<main id="main">`: 6 of 13;
  3. the same in InPrivate, which ruled out extensions: 9 of 16.

  Headless passed every time, so only his trace could judge each one. The research found
  the cause. The spec checks the opt-in at `pagereveal` as "the last @view-transition rule
  in document", so a rule in a stylesheet still loading then is not seen. `chrome.css`
  `@import`s four sheets. Another project hit the same error, 9 of 9 with its opt-in
  sheet delayed, and moving the rule inline took it to 0
  ([anuarhdz/surface-elements#24](https://github.com/anuarhdz/surface-elements/pull/24);
  spec: [CSS View Transitions 2](https://drafts.csswg.org/css-view-transitions-2/),
  §12.3 and §12.5). Every page now has an inline
  `<style>@view-transition { navigation: auto; } …</style>` before `chrome.css`, and keeps
  the `expect` marker. **Confirmed in his Edge the same day: 13 of 13 page changes
  glided**, each about 300 ms.
- **The default view transition crossfades the whole page.** With a moving background and
  a glass (backdrop-blur) panel, that read as a flicker. Turn off `root`'s animation and
  name only what should move.
- **A name may appear once per page**, or the browser drops the whole transition. Key each
  nav item's name by its own path.
- **Anything placed by script after the first frame jumps under a transition.** The
  section list moved into the panel after the first frame until `section-nav.js` got
  `blocking="render"`.
- **`font-display` needs a cached font to pay off.** `fallback` waits 100 ms for the face,
  but the dev server revalidated every font on every page, so the page showed no text.
  The fonts are now immutable for a year in `_headers`.
- **The dev driver's EventSource kept every dev page out of the back/forward cache**, so
  Back and Forward behaved unlike the live site. It now closes on `pagehide`.
- **What would have caught it sooner:** (1) the trace, from the first blip report; (2) a
  page inventory listing each page's render-blocking scripts, whether it has a nav tile,
  and which stylesheets it loads. "Only Portfolio and Resume work" would have pointed at
  their one difference at once; (3) testing at his window size, not a default.
  The dev driver's tab list showed his main window at 3432 × 1274, DPR 1 (2026-11-23).

## Running the dev server from a Claude session

- **Stopping Claude's background `npm run dev` task leaves the server running**
  (2026-11-23). Only the shell wrapper dies. `node scripts/dev.js` keeps 8787, and the
  restart quietly lands on the next free port, still serving the old code on 8787. Stop
  it by its tree: find the `cmd.exe /d /s /c node scripts/dev.js` parent of whatever
  listens on 8787, then `taskkill /PID <it> /T /F`. Check the port is free before
  starting again.

## Working in worktrees

- **A worktree has no `node_modules`.** Link the main checkout's with a
  junction, and remove it with `rmdir` (never `rm -rf`, which follows the
  link and deletes the real thing).
- **Other sessions push from parallel worktrees.** Sync with origin before
  building on master.

## Docs

- **Status written into an index goes stale on its own** (2026-10-25). The
  CLAUDE.md map still called `rooms-status.md` and the DeetsMusic page pass
  "not built" after both were built. Status now lives in each doc's front
  matter, and `scripts/docs-check.js` checks links and front matter.
