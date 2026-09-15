# Deets.Solutions — Handoff / Status

> Cold-start guide — read first. A hand-built static site on Cloudflare Pages (no build
> step, no dependencies) plus a ring of sibling Cloudflare Worker repos: journals, Radio,
> League, four live games, accounts, and the DeetsMusic support page.
>
> **Where things stand (2026-09-15):** the DeetsMusic UI port (steps 1–4, 6, 8) and the
> DeetsMusic page are live. **Board threads, all four steps, are BUILT and committed in
> both repos but NOT pushed and NOT deployed** — and step 1 closes a leak that is live
> until the worker is. **Next: his copy pass on the new `[ph]` strings, then the deploy,
> in the order under [Next up](#next-up).**

**What a "what's next?" should answer from:** the [Next up](#next-up) list below, top
down. When a session plans, finishes, or parks something, it updates this file in the same
commit. Designs live in the topic docs; this file only points at them.

Rules of the house: [CLAUDE.md](../CLAUDE.md) (the Never list, copy, CSS, games). Structure:
[README.md](../README.md). Deeper docs, by area:
[architecture.md](architecture.md) · [ui.md](ui.md) · [css-split.md](css-split.md) ·
[ui-direction.md](ui-direction.md) (the DeetsMusic UI port) · [support.md](support.md)
(DeetsMusic page + DeetsSupport worker) · [accounts.md](accounts.md) · [stats.md](stats.md) ·
[data.md](data.md) · [league.md](league.md) · [radio.md](radio.md) · [youtube.md](youtube.md).
Games — **read [games.md](games.md) first**: [design-language.md](design-language.md) ·
[bots.md](bots.md) · [realtime.md](realtime.md) · [cities.md](cities.md) ·
[mahjong.md](mahjong.md) · [poker.md](poker.md) · [tanks.md](tanks.md).

---

## Run it

```bash
python -m http.server 8787
```

- `.claude/launch.json` has `deets-site` (8787) plus `-alt` (8788) and `-alt2` (8789).
  Several Deets apps run on this PC at once, so take a free one rather than failing on a
  busy port.
- **Live mode against production workers only works from 8787 or 8788** — those are the
  dev origins in the workers' `ALLOWED_ORIGINS`. 8789 is fine for `?mock`.
- `?mock` on every game, Radio and `/deetsmusic/` runs the page against an in-page mock
  that speaks the worker's exact wire shapes.
- `node <game>/engine.js` runs a game engine's self-checks.
- Visual verification is Aditya's: check console + DOM counts, then hand off.

## Ship it

- **Site:** push to `master`; Cloudflare Pages deploys. `_headers` keeps CSS/JS at
  `max-age=0` (CLAUDE.md "CSS").
- **Workers:** `npx wrangler deploy` in the sibling repo. Deploys need his explicit ask.
  After any DeetsSupport deploy, smoke every mint-host route (support.md, "Decisions
  already made").
- **Resume:** `powershell -File scripts/build-resume-pdf.ps1`, commit both files.
- **Journals:** the `journal-refresh` skill; never hand-edit the JSONs.

---

## Next up

Newest plan first. Each entry: status, the doc that holds the design, the first step.

**2026-09-15 — DeetsMusic board threads: BUILT (all four steps), unpushed, undeployed.**
Design: **[support.md "Threads"](support.md)**. Clicking a Suggestions or Known issues card
opens `#p=<pid>`, a read-only thread; signed-in accounts comment on it under their profile
name and colour; the owner's right-click menu moderates a row. Commits: this repo `a9252cd`,
`3b3f6d5`, `a6cfe59`, `f9773fd`; `../DeetsSupport` `c30c52a`, `dd1128c`, `5a32a35`,
`1df8c86`. Both trees are clean; neither is pushed.

Both questions the plan left open were settled by what the code already said, and both are
written up in support.md: the commenter's **name rides the request** (DeetsAccounts' session
payload is `{u, e, iat}` — no name — and it proves nothing either way), and a comment is a
**widened `replies` row**, not a new table (one thread, one chronology, one hidden flag, and
the intake breaker already counts `replies`).

**What is left, in order:**
1. **His copy pass.** 21 new `[ph]` strings in `deetsmusic/strings.js` — the thread page, the
   comment box and sign-in prompt, and the moderation menu. Nothing with `[ph]` ships.
2. **His visual pass** at http://localhost:8787/deetsmusic/?mock. On `?mock` you are signed in
   AND the owner; **signing out in the page** is the one local way to see what a stranger is
   sent (no hidden rows, no comment box). Three seeded member comments sit on "[mock] A
   lyrics card", one of them hidden.
3. **The deploy — order matters** ([support.md "Shipping step 1"](support.md)): both D1
   migrations first (`2026-09-15-pid.sql`, then `2026-09-15-comments.sql`), then
   `npx wrangler deploy` + the mint-host smoke, then push the site **a minute later** —
   `GET /posts` sits in a 60 s edge cache and the old shape has no `pid`.

⚠ **The leak step 1 closes is live until that deploy lands.** Public `GET /posts` still
returns each post's secret `code`, which closes the post, replies as its reporter and reads
its `meta`. Every code that has sat on a public board since 2026-09-11 should be treated as
known.

Not testable locally, so first on the list once it is live: the `ds_sess` cookie never
reaches localhost, so a REAL sign-in, a real comment and the owner's real moderation have
only ever run against the mock.

**2026-09-15 — site UI port: steps 5 and 7 open.** Design: **[ui-direction.md](ui-direction.md)**.
- Step 5, the look schedule: he chose **one shared synchronous `js/prepaint.js`** over the
  inline pre-paint head scripts. Mind the `RETIRED` / `R` map rule in CLAUDE.md.
- Step 7, the arrow-key pass.
- Three `[ph]` strings in the `S` table of `js/controls.js` await his wording: the sun/moon
  labels and the "Animate look changes" hint.

**DeetsMusic page — follow-ons** ([support.md "Open"](support.md)):
- Apple in status: needs his read of the D.7 terms.
- Help before "report".
- Health routes on the other workers (only the mint and this site have one).
- `POST_RL` is shared by posts, replies, votes and closes; split it if the boards get busy.
- The in-app report form, redactor and My reports are DeetsMusic-repo work (its HANDOFF).

---

## Parked and unmerged

Last recorded state, from session memory — **verify against git before acting.**

| Item | State | Doc / where |
|---|---|---|
| **DeetsShips** | Built + worker deployed (private repo). Site branch `DeetsShips` unmerged, last commit 2026-08-01. His copy pass owed (`ships/strings.js` all `[ph]`). Merge is his call. | `docs/ships.md` on the branch |
| **King of the Coop** | Scaffold on branch `King-Of-The-Coop` (2026-07-22). Waiting on his hand-edit of `docs/coop-mechanics.csv` and his answers on the Farmer, techs and objectives. Never invent mechanics. | `docs/coop.md` on the branch; prototype in `../KingOfTheCoop` |
| **`deets-imperium` branch** | Last commit 2026-08-21 (a SOTD refresh). Purpose unrecorded — ask him. | — |
| **Radio seek armor r3** | Unverified since 2026-07-16; his two-browser test is the gate. YouTube Data API key parked (null). | [youtube.md "Sync armor"](youtube.md) |
| **Cities** | Disconnect-rejoin not verified live; robber-UI chat queued. | [cities.md](cities.md) |
| **Poker** | Top-up rebuy not built. | [poker.md](poker.md) |
| **Accounts stats** | Outbox sweep and Elo not built; bot tier isn't on results rows yet (goes with Elo). | [stats.md](stats.md) |
| **Tanks** | Campaign live on master; worker, PvP and stats unbuilt. Doom is design-only. | [tanks.md](tanks.md), [realtime.md](realtime.md) |
| **Mahjong** | Bots draw ~51% of hands (needs real shanten counting). | [bots.md](bots.md) |

---

## Known gotchas

- **Registry writes from a Claude desktop session are not real.** The app is an MSIX
  package, so `HKCU\Software\Classes` writes from its shells land in a private hive
  (DeetsMusic HANDOFF, 2026-09-13). Anything that must reach the real registry runs from
  his own terminal.
- **Two sessions push in parallel.** Fetch and check each repo against origin before
  building, especially the worker repos.
- **The `ds_sess` cookie never reaches localhost.** Owner and signed-in paths are only
  real on deets.solutions; `?mock` fakes them.
- **Mocks don't model disconnects** — rejoin behavior is only testable live.
- **A same-document hash navigation doesn't reload.** Use `location.reload()` when testing
  a page in the browser pane.
- **A re-vendor can strip live features.** Check what the deployed workers carry before
  re-vendoring `games/table-do.js` while a games branch sits unmerged.
