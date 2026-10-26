---
status: sop
sources: []
updated: 2026-10-25
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
