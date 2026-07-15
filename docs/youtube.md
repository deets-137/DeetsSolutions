# DeetsRadio — YouTube (v1.0 design, not built)

## Build log (update after every chunk — cold-handoff anchor)

Build started 2026-07-14. Chunks, in order; mark ✅ with notes as they land:

1. ✅ **Engine + hero** (2026-07-14) — all landed and verified live on
   the mock (console clean; synthetic entry drove the real IFrame player:
   video played letterboxed in the grown 200px hero, layer tracking the
   art slot; popover shows Apple Music + YouTube boxes, "AM Previews").
   Files: `radio/yt-key.js` (null stub), `radio/youtube.js`, radio.js
   (mux in tick() + `activeEngine`, `Y.attachTo(art)` in buildNP,
   Y.stop()+class reset in leaveRoom, YouTube box in fillConnectPop),
   main.css (art transition + `--video` mode ~line 2066, strip video row
   in the 66rem block, `.radio-yt-layer`), strings.js (previewToggle →
   "AM Previews" + ytLabel his; ytOn/ytOff `[ph]`), index.html (yt-key +
   youtube script tags). ⚠ Shape decision made in code: the entry block
   is **`youtube: {id, durationMs}`** (matches the apple provider shape
   and the worker's `provider()` sanitizer) — NOT `videoId` as earlier
   prose said; the protocol tables below are updated.
2. ✅ **Protocol + worker** (2026-07-14) — verified on the mock end to
   end: resolve fills a missing block, a second resolve is refused
   (fill-missing-only), setVideo overwrites, a bad id is rejected.
   transport.js needed NO change (generic send passthrough).
   transport-mock.js: `resolve`/`setVideo` in COMMANDS + QUEUE_VERBS,
   `findEntry` + `ytBlock` mirrors. Worker (`../DeetsRadio/src/index.js`,
   node --check clean, NOT yet deployed — deploy rides the site publish):
   QUEUE_VERBS grew both verbs; `sanitizeEntry` now emits
   `youtube: ytBlock(e.youtube)` (11-char id whitelist, `YT_SOURCES`
   set); `command()` is **async** now (one call site awaits, line ~565);
   `case "add"` consults D1 first (registry outranks the adder's block)
   and remembers adder-resolved blocks; `findEntry` (current+queue only —
   history re-adds go through add); D1 helpers `d1()`/`matchPick()`/
   `matchWrite()` — **fail-open without the MATCHES binding**, lazy
   CREATE TABLE, concrete-first pick rule (topic<vevo<search, then votes),
   votes bump on conflict, provenance never downgrades. wrangler.jsonc
   carries the commented-out `d1_databases` block + the
   `npx wrangler d1 create deets-radio-matches` instruction (deploys
   stay green before the DB exists). Client: `resolveSweep()` in
   radio.js after renderAll — current + next 2, once per entry per
   session, skips mock entries, needs Y.hasKey() && canQueue().
3. ✅ **Match desk** (2026-07-14/15) — verified live on the mock: rows
   render with ✓/✕ badges, click-to-select syncs the workbench, pasting
   a URL (Enter or paste event) sent `setVideo`, the badge flipped, the
   oEmbed title resolved (CORS works), AND the broadcast drove the
   engine mux into video mode end-to-end. Console clean. Files:
   index.html (`.radio-service` wrapper: crew + `[data-radio-desk]`),
   radio.js (`renderDesk` + `deskSelect` + `parseYtId` + `deskMeta`
   oEmbed cache; DESK const; leaveRoom reset; "fix video" queue-menu
   item; input-focus guard so re-renders don't eat typing; commit blurs
   so the broadcast's re-render lands), strings.js (`menuFixVideo` +
   five desk strings, all `[ph]`), main.css (`.radio-service` grid +
   `.radio-desk*` block before `.radio-crew`). Notes: badges are
   two-state (has video / none) — per-entry provenance doesn't ride the
   wire, so the doc's three-tier badge is a later nicety; setVideo
   sends `durationMs: 0` (engine treats 0 as unknown; the registry
   still gets the id — a later `videos.list` enrich is optional).
4. ✅ **beforeunload guard + doc sync** (2026-07-15) — guard in radio.js
   above the boot section (armed while joined && playing); radio.md's
   Versioning v1.0 bullet + the D1 sentence now point here.
5. ✅ **YT-first adds + setSong** (2026-07-15) — the Deferred bullet
   scoped that morning, built the same day; Aditya's green light grew it
   past "zero worker changes": the desk re-pins the **AM song** too
   (`setSong`), and D1 remembers `apple_id` for the future flip-back.
   Verified live on the mock end to end: a matched paste minted the full
   dual entry (Apple art, ISRC) and drove video in the grown hero; an
   unmatched paste minted a YT-only entry (thumb artwork, parsed
   title/artist); the desk mini-search re-pinned that entry's identity
   with its video block surviving (the curation flow); setVideo
   overwrite + oEmbed title still good; the embed-disabled branch fired
   the warn toast and added minus the dead block; "temperature" typed
   into search stayed a search (no quota); console clean; ~3 units
   spent, ledger debited honestly. **Shape decisions made in code:**
   - **No oEmbed in the paste flow** — `videos.list` with part
     `snippet,contentDetails,status` is still 1 unit and carries
     title/channel/thumbnail, so a pasted link costs ONE metered call
     (the desk workbench keeps oEmbed for attached-video titles).
     `Y.lookup(videoId)` is memoized per session; misses un-memo so a
     flaky network can retry.
   - **`parseYtId` is URL-only now** (the bare 11-char branch is gone):
     both fields are dual-mode — links mean video, words mean songs —
     and any 11-letter word ("temperature") is a valid-shaped id.
     `deskBadLink` died with it: non-link desk text searches instead of
     erroring.
   - **`add` carries `source: "manual"` on YT-first adds** (optional
     arg threaded through sendAll/songMenu/songSearchRow); the worker
     accepts it beside the robot sources — a pasted video is a human
     pick, curated-grade D1 provenance.
   - **Embed-disabled** (`embeddable: false`): warn toast
     (`ytAddNoEmbed`) and the entry still adds WITHOUT the dead block
     (Aditya's call) — a matched entry picks up a working video via
     resolveSweep like any Apple add; a miss adds video-less with the
     pane status saying why; the desk is the fix either way.
   - **apple.js gap note extended**: an `apple: null` entry landing in
     its none-branch notes "gap" (toast + parked bar) WITHOUT reporting
     to the gap collector (Apple-id-keyed) — otherwise a YT-only track
     with the box off sat silent under a rolling bar, the exact
     reads-as-a-bug live testing flagged.
   - **setSong's result click blurs the input** (setVideo's idiom) so
     the broadcast's re-render lands past the desk focus guard.
   Files: radio.js (`runYtAdd`/`renderYtPane`/`pickByDuration` after
   runSearch; URL-only `parseYtId`; PER-ENTRY mux in tick() — Apple
   keeps an entry only when authorized AND it has an apple id, so
   YT-only entries play video even for subscribers; desk dual-mode
   input + song results + attached-song pane), youtube.js (`Y.lookup`,
   `Y.parseTitle`), apple.js (gap-note branch), transport-mock.js
   (`setSong` + QUEUE_VERBS), worker (`setSong` case, QUEUE_VERBS,
   `matchWrite(+apple_id)`, add accepts "manual"), strings.js (ytAdd*
   ×5 + deskNoSongs/deskSongSent, all `[ph]`; deskPaste reworded [was
   `[ph]`]; deskBadLink removed), main.css (`.radio-ytadd__status`,
   `.radio-desk__results`, `.radio-desk__song`). **The worker deploy
   now rides the site publish** — `setSong` is additive (old worker ×
   new page = desk song re-pin silently no-ops), but the feature isn't
   live until `npx wrangler deploy`.

6. ⚠ **Seek-rebuffer armor (2026-07-15, late) — BUILT, NOT YET VERIFIED.
   ⇒ RESUME HERE: Aditya tests in the morning.** His two-browser live
   test (one InPrivate + his own, same room, video track) was choppy —
   the video reloaded every few seconds, both browsers in lockstep.
   Diagnosis: a **seek-rebuffer loop**. MusicKit seeks are near-instant;
   IFrame seeks REBUFFER, so `seekTo(expected)` lands behind the clock
   by the buffer time, still outside `DRIFT_MS`, and re-seeks every
   `CORRECTION_GAP_MS` (5 s) forever — in sync on every listener,
   because they all chase the same room clock (two players on one
   machine made buffering slower and the loop nastier). apple.js
   documents the same born-behind problem and one-shot-resyncs it
   (apple.js:280); the YT engine needed a stronger version. The fix, all
   in youtube.js `follow()`: (1) every seek/cue aims **ahead** at
   `expected + seekPad` (starts at 1200 ms, clamped 250–4000); (2) the
   pad is **adaptive** — the first playing tick after a start/seek
   measures the landing error and folds it in (padded ops correct it,
   bare scheduled starts re-estimate it from spin-up), averaged to damp
   noise; (3) that landing tick also sets `lastCorrection` — one
   drift-free settle window, never an instant second correction.
   `node --check` clean; mock playback NOT re-run (bedtime).
   **Morning test script:** same two-browser setup, queue a video
   track; expect ONE buffer at the start, then stable playback — no
   ~5 s reload rhythm. Late-join a third browser mid-song: it should
   land once, near-position, and settle. If a pre-roll ad plays, one
   catch-up seek after it ends is the documented platform tax, not the
   bug. If it's still choppy, suspect the pad measurement (log
   `seekPad` in the settle branch) before anything else.
7. ✅ **Data API parked for launch (2026-07-15, Aditya's call)** —
   `radio/yt-key.js` is `null` again for the public push (the key is
   recoverable from the Google Cloud console or the file's git
   history; it's referrer-locked).
   Why: the 10k-unit/day quota is ONE pool shared by every visitor, the
   D1 registry is still uncreated so nothing amortizes, and each device
   keeps its own optimistic ledger — public traffic could exhaust the
   day fast. Keyless degradation is the designed inert mode, no code
   changes: resolver + resolveSweep sit out (`Y.hasKey()` gates), a
   pasted YT link lands on `ytAddFailed` (no duration ⇒ can't mint),
   the Music Source box just omits the quota line; playback (keyless
   IFrame) and the desk (keyless oEmbed `setVideo`/`setSong`) still
   work in full. Re-enable = restore the key, ideally after
   `npx wrangler d1 create deets-radio-matches` + binding so quota
   amortizes to once per unique song ever.

`radio/yt-key.js` (Claude added the missing quotes — a bare identifier
throws at load). Resolver verified live from localhost: a real search
returned a `- Topic` Art Track with duration inside ±2 s, source
"topic" — key valid, referrer lock admits the dev port. Each resolve
costs 101 units (search 100 + videos.list 1) ⇒ ~99 songs/day.

**Live-test round 2 (2026-07-15, three more of Aditya's calls, all
verified on the mock):** (1) **desk paste field moved to the top** of
the workbench (input → status → thumb → title). (2) **Quota guard +
display**: `youtube.js` keeps a per-device ledger
(`deets-radio-yt-quota` localStorage, resets on the Pacific day —
Google's boundary; Google exposes no remaining-quota endpoint, and the
key is shared, so this counts THIS device's spend only). Every apiGet
carries its unit cost (search 100, videos.list 1); a 403 marks the day
exhausted; `resolve()` refuses below 101 units; `Y.quotaLeft()` is
public and the Music Source YouTube box shows `ytQuota` (`[ph]`,
~matches left = quotaLeft/101). (3) **Layer stacking fix**: the video
was floating OVER the sticky toolbar when scrolling — the layer is
z-index **4** now (under the toolbar's 5), so it tucks under the bar
with its card; `:root[data-radio-shell] .radio-yt-layer` bumps it to
38 only while the shell frame (35) is up. No JS needed — the shell
already stamps that attribute. **Odesli is DEAD for YouTube (probed
live 2026-07-15)**: `linksByPlatform` carries no youtube (or spotify)
keys at all, verified on two mainstream tracks — an Odesli-first
resolver leg was built and removed the same day; the comment in
youtube.js says don't re-add without re-probing. Cheap-quota reality:
the D1 registry (still uncreated!) is the real lever — once per unique
song ever; beyond that, Google's quota-increase request form is the
only legitimate expansion. Resolver re-verified post-rework: Khalid
"Intro" → VEVO match, duration-checked, ledger debited (9899 left).

**Live-test round 1 (2026-07-15, Aditya on the real transport):** both
reported bugs — resolve doing nothing, desk paste "eaten" — were one
cause: the live worker predated the verbs (unknown type = silent no-op).
**Worker DEPLOYED (version a396431b)** with Aditya's go-ahead; D1 still
uncreated (fail-open — resolve works but nothing is remembered across
rooms, and every session re-spends quota until the binding lands).
The key he pasted needed quotes (bare identifier throws) — fixed, and
the resolver verified live: a real search returned a Topic Art Track.
Two UX changes from his direction: (1) **personal-silence treatment** —
when the room plays but THIS device hears nothing (gap / preview over /
previews off), a warn toast fires once per track+cause, the NP note
names it (apple.js now emits note "off" for previews-toggled-off,
formerly silent by design), and the progress row PARKS (0%, no elapsed,
dimmed via `.radio-np--muted`) — the bar shows what you hear, not what
the room does; the room clock is untouched (revises radio.md's
ever-rolling display-only bar). Verified on the mock end to end.
(2) `deskSent` `[ph]` string — desk paste now acks in the status line
immediately (wired into commit(); the broadcast's badge flip replaces
it within a beat). deskSent's status line is also red-styled
(`.radio-desk__status` wears `--stop`) — fine for the bad-link case it
was built for, mildly odd for the ack; a `--go` variant is a one-line
polish if it bothers Aditya.

**BUILD COMPLETE (2026-07-15) — all FIVE chunks in, verified on the mock,
console clean. NOT committed, worker NOT deployed** (the live worker is
a396431b, which predates `setSong`). Remaining before ship, all
Aditya-side: (1) ~~Data API key~~ IN (see above); (2) optionally
`npx wrangler d1 create deets-radio-matches` + uncomment the binding in
`../DeetsRadio/wrangler.jsonc` (worker fails open without it — and until
it exists, nothing is remembered across rooms and the `apple_id`
flip-back column collects nothing); (3) worker deploy
`npx wrangler deploy` — `setSong` is additive so no lockstep, but the
desk's song re-pin no-ops until the deploy lands, so it should ride the
site publish; (4) the `[ph]` copy pass (now including the 7 chunk-5
strings); (5) his look-and-feel pass at localhost:8787 — the hero grow,
the desk (now dual-mode with the attached-song pane), the YT-first add
pane, video playback with a real queue.

Not automatable, Aditya-side: create the Data API key (Google Cloud,
referrer-locked) → `radio/yt-key.js`; `npx wrangler d1 create` for the
registry + binding in wrangler.jsonc; copy pass over new `[ph]` strings.

**Status (2026-07-14):** design only. This is the chosen v1.0 route —
YouTube as the **free full-track tier** — decided the same day the
Spotify plan was written and shelved ([spotify.md](spotify.md) keeps that
design as reference; its `resolve`-verb architecture is reused here).
Why YouTube won: no per-listener setup, no Premium requirement, and it's
the only free-to-listen source that overlaps the mainstream catalog.
Nothing here is implemented; `Entry` still carries no `youtube` block.

## The platform reality (verified 2026-07-14)

- **Playback needs no credentials at all.** The IFrame Player API is
  free and keyless — a third documented CDN exception
  (`youtube.com/iframe_api`) beside MusicKit's, this page only.
- **The API TOS ("Required Minimum Functionality") binds the UI:** the
  player must be **at least 200×200 px**, must not be overlaid or
  obscured *while playing*, must not play hidden, audio must never be
  separated from video (no audio-only mode — it can't exist even as a
  cheat), ads must not be blocked, YouTube's own chrome stays.
- **Topic channels are the catalog key.** Auto-generated "Art Tracks"
  live on `<Artist> - Topic` channels and are the label-delivered
  recordings — visually a static cover on a 16:9 canvas, so the "video"
  usually reads as a big album cover. The resolver prefers them (calmer
  UI, fewer ads than music videos).
- **Search costs quota.** The Data API's default allowance is 10 000
  units/day; one search = 100 units → **~100 searches/day** per key. The
  D1 registry (below) amortizes this to one search per unique song ever.
  The key is committed referrer-locked — the Apple dev-token exposure
  pattern, an accepted tradeoff, not a secret.
- **oEmbed is keyless.** `youtube.com/oembed?url=…` returns title /
  channel / thumbnail free — the match desk browses matches on it; only
  duration + `status.embeddable` need a Data API `videos.list` (1 unit).
- **Ads are the sync tax.** An ad-tier listener's pre-roll starts at the
  countdown's zero; they hear the song late and drift-seek to position
  when it ends. Premium listeners and ad-free videos start clean. No
  engineering fixes this; Art-Track preference softens it.
- **No ISRC anywhere** in YouTube's public surface — matching is
  Topic-channel search + duration ±2 s (high precision in practice), or
  a human at the match desk. Odesli/song.link (Linktree-owned since
  2021, alive but rate-limited 10/min and flaky under load) is **not a
  dependency**; optional enrichment at most.
- **Mobile footnote** (for the tabled mobile pass): iOS pauses
  background *video* (not audio) — a YouTube-tier phone can't lock its
  screen. Desktop background tabs keep playing (timers throttle to ~1 s;
  drift correction absorbs it).

## Decisions

- **Tier order per listener:** Apple full (connected) → YouTube (entry
  has a video + the YouTube box enabled) → AM previews (toggle) →
  silence with the gap note. ~~Per-listener, not per-entry~~ *Revised
  2026-07-15 (YT-first adds): the mux is **per-entry** — Apple keeps an
  entry only when it can actually play it (connected AND the entry has
  an apple id), so a YT-only entry plays video even for subscribers.
  Apple-minted entries behave exactly as this bullet always said.*
- **Music Source popover: YouTube gets an account-style box** beside
  Apple Music's — same anatomy, but its one control is an enable toggle
  (no auth exists). The previews toggle relabels to **"AM Previews"**
  (Aditya's copy, dictated 2026-07-14 — goes in unprefixed). New desk /
  box strings are `[ph]` until he writes them.
- **AM is the source of truth.** Search stays Apple-catalog; queue /
  history / search render Apple metadata + artwork; `youtube:
  {videoId, durationMs}` is an annotation on the entry, never its
  identity. *Amended 2026-07-15: YouTube-first adds are BUILT (chunk 5)
  as an addition, not a replacement — Apple search stays the front
  door, and a matched paste mints a normal Apple-identity entry. The
  one exception to "never its identity": an unmatched paste mints a
  **YT-only entry** (`apple: null`, parsed title/artist, video thumb as
  artwork) — which the desk's `setSong` can upgrade to a real Apple
  identity later, video intact.*
- **Hero sizing is tier-scoped, not per-entry.** When a listener's
  active source is YouTube, the NP art holds ~200 px square for the
  whole session — video tracks show the player, fallback tracks show
  cover art at the same size. No per-track height bounce; seamless
  rolls crossfade inside a box that never moves.
- **The grow rides the countdown.** On the session's first video track
  the art eases 72 → 200 px during the 3-2-1 (the count overlay is
  `inset: 0`, so the digits stretch with the box for free); the video
  reveals at zero — the go-signal idiom intact, now with theater.
  Timing comes from skin motion tokens (`--dur-*`/`--ease-*`), never
  hardcoded (30-combo rule; reduced-motion skins flatten it).
- **Letterboxing accepted.** A 16:9 video in a square slot means black
  bars — un-themeable content, like album art itself. (A 16:9 strip
  slot was considered; square keeps the dock silhouette. Revisitable.)
- **`beforeunload` leave-guard is room-wide, not YouTube's** — armed
  while joined and playing, shows the browser's generic "Leave site?"
  (custom text isn't a thing browsers allow anymore). Belongs to every
  listener; arguably owed since v0.9.
- **Bottom strip (≤66 rem shell) — decided 2026-07-14:** the NP-card
  grid gains a **full-width ~200 px video row** above the
  art/center/controls rows (chunky but anatomical — the strip simply
  grows while a video plays there). No floating mini-tile.

## The player layer: never reparent an iframe

Moving an iframe in the DOM **reloads it** — playback dies and ads
replay. The room UI reparents wholesale (the site-shell dock), so the
player cannot ride the NP card's nodes. Same inversion as the shell
itself: **the player never moves; the layout moves under it.**

One persistent fixed-position layer (z ≈ 38: above the shell frame at
35, below menus at 40, under toasts at 50) holds the single IFrame
player. The active `.radio-np__art` is one DOM node wherever it
reparents; the layer rect-tracks it (rAF + ResizeObserver +
scroll/resize) and sits exactly over it. Hidden **only** while cued
(countdown lead) or the engine is inactive — never while playing (TOS).
The reveal happens after the grow settles, so the tracker never chases
a moving box mid-reveal. The dock needs nothing: its art slot is
already a 304 px square (19 rem dock), legal as-is.

## The engine: `radio/youtube.js`

Same contract radio.js speaks to `RadioApple` — `follow(view)` /
`note()` / `stop()`, fed from `tick()` (radio.js:1054) — plus the rect
layer above. The mux becomes: Apple `authorized()` → apple.js (full);
else entry has `youtube` + box enabled → youtube.js; else apple.js
(which lands on previews or the gap note internally).

| Room event | Engine op |
|---|---|
| scheduled start | `cueVideoById(id, startSeconds)` in the lead → `playVideo()` at the boundary |
| pause | `pauseVideo()` — local, instant |
| skip / back / track-end | not a player op: the room broadcasts a new `current`; the engine loads the new ID and chases |
| drift > 1.75 s | `seekTo(expected + seekPad, true)` — same `DRIFT_MS` / `CORRECTION_GAP_MS` constants as apple.js, PLUS the adaptive seek pad (chunk 6): IFrame seeks rebuffer, so aiming at the bare clock lands behind it and loops |
| mid-song join | `loadVideoById(id, expectedSeconds)` |
| video ends early | ignored except fall-silent — the room's alarm advances, never the client |

Port apple.js's wedge armor wholesale (`followFull`, apple.js:231):
silence check first on every tick, timestamped in-flight latches that
expire, no overlapping starts, a load-sequence counter. Load
`iframe_api` lazily on first activation — dead weight for Apple
listeners. `playsinline` for iOS. Volume local, as everywhere.

## Resolve: D1 first, robot second, human above both

Pick order when an entry needs a video (at add, and backfill for
pre-existing entries):

1. **D1 registry** (below) — the DO queries it directly at add time;
   a known song gets its video attached server-side, instantly, no
   client work, no quota.
2. **Auto-resolver, client-side** — Data API search `artist + title`,
   prefer `- Topic` channels (then `…VEVO`), verify duration ±2 s and
   `status.embeddable`; report via the `resolve` verb. The DO persists
   the result back to D1 with provenance, so this runs **once per
   unique song, ever, across all rooms** — the quota amortizer.
3. **Nothing** — entry stays video-less; YouTube-tier listeners fall to
   AM previews / the gap note. The match desk is the human override at
   any point.

**Protocol — two verbs, mirrored verbatim across `radio/transport.js`,
`radio/transport-mock.js`, and `../DeetsRadio/src/index.js`** (the
three-way contract rule):

| msg | payload | rules |
|---|---|---|
| `resolve` | `{entryId, youtube: {id, durationMs}, source: "topic"\|"vevo"\|"search"}` | fill-missing **only**, never overwrites (griefer can't flip a live video); **queue** capability; DO sanitizes (11-char `[A-Za-z0-9_-]` id, duration bounds) and persists to D1 with the claimed source |
| `setVideo` | `{entryId, youtube: {id, durationMs}}` | the match desk's verb: **overwrite allowed**; **queue** capability; works on the *current* entry (wrong-video-right-now is the motivating case — the follower chases the new ID next tick and drift-seeks); logs a **manual** association to D1 |
| `setSong` | `{entryId, song: {…full Apple identity…}}` | the desk's SECOND verb (2026-07-15) — `setVideo`'s flip side: re-pins the entry's **Apple identity** (title/artist/album/artwork/ISRC/apple/previewUrl through `sanitizeEntry`'s field rules); **overwrite allowed**; **queue** capability; the youtube block and add provenance (entryId/addedBy/addedAt) survive; logs (new isrc, attached video) to D1 as **manual** with `apple_id` |

**Canonical duration:** frozen on the *current* entry (the alarm is
scheduled off it; a mismatched video clamps — worst case a few seconds
of tail silence, the existing rule). A `setVideo` on a **queued** entry
may rewrite `durationMs` from the video's real length (no alarm depends
on it yet). `setSong` holds the same line: the current entry keeps its
frozen `durationMs` under a re-pin; a queued entry adopts the new
song's length. `sanitizeEntry` (worker src/index.js:66) gains the
`youtube` block on `add` too, so a video attached at add time rides in
sanitized; the `spotify: null` hardcode stays.

## The match desk

Bottom-right, mirroring the crew panel (which is bottom-left, half the
content column) — the room's two service windows. Visible to everyone;
**edits ride the queue capability** (they mutate entries — no new
permission concept).

Two internal columns:

- **Left — the room's songs.** Scrollable list of current + queue
  (existing row anatomy: art · title/artist), each with a match badge:
  **pinned/concrete ✓ · auto ~ · none ✕**. Click a row → the right half
  selects it.
- **Right — the workbench.** One **dual-mode field** at the top
  (2026-07-15; was YouTube-links-only): **pasting a YouTube link
  applies immediately** — no confirm step (`setVideo`); **typing
  anything else searches the free Apple catalog, songs only**, five
  compact rows under the field, and clicking one re-pins the entry's
  Apple identity (`setSong`) — the page-wide rule: links mean video,
  words mean songs. Undo either way is doing it again differently.
  Below the field: the **attached AM song** (art · title/artist —
  dimmed while the entry is YT-only, i.e. `apple: null`), then the
  attached video (thumbnail + title via keyless oEmbed). A second entry
  point: right-click a queue row → a "fix video" menu item jumps here
  with that row selected.

All desk strings are Aditya's (`[ph]` until written), including the
desk's name. Desktop-only for now, like the crew panel (mobile pass is
tabled).

## The D1 registry: resolve cache + curation memory

The **first D1 use in DeetsRadio** — [radio.md](radio.md) recorded "D1
stays out until a cross-room feature needs it"; a cross-room match
memory is that feature, through the door the doc left open. One table,
binding on the existing worker:

```
matches(
  isrc      TEXT,               -- the key (Apple-minted entries always have one)
  video_id  TEXT,
  duration_ms INTEGER DEFAULT 0,-- the video's length (rides every write)
  apple_id  TEXT,               -- 2026-07-15: the Apple song id, when known —
                                -- backfills on conflict, never nulls out
  source    TEXT,               -- "topic" | "vevo" | "search" | "manual"
  votes     INTEGER DEFAULT 1,  -- manual associations accumulate
  updated_at INTEGER,
  PRIMARY KEY (isrc, video_id)
)
```

`apple_id` + `duration_ms` exist for the **deferred flip-back**: a
future YT-first paste of a known video looks up `video_id → apple_id`,
fetches the song from Apple (free, dev token), and mints the dual entry
with ZERO metered units — no search, no videos.list. The DB was still
uncreated when the column landed, so this was schema, not migration.

- **Concrete rows** (`topic` / `vevo`, duration-verified) come from the
  auto-resolver via `resolve`; deterministic provenance.
- **Manual rows** come from the desk via `setVideo`; each paste of the
  same (isrc, video) increments `votes` — repeated human choices
  converge, and one bad paste can be out-voted. This is why no
  confirm/deny is needed.
- **Pick rule at add time (decided 2026-07-14): concrete row if
  present, else the most-voted manual row, else the live
  auto-resolver.** Known corner, accepted: a *wrong* concrete match
  (Topic search grabbed a remaster) can be fixed in-room via `setVideo`
  but re-attaches on future adds. Aditya handles this with **periodic
  manual review** of the registry rather than an automatic override —
  reading D1 directly (`npx wrangler d1 execute` in `../DeetsRadio`) or
  a later read-only `GET /matches` in the `GET /gaps` idiom; a bad
  concrete row gets deleted or hand-replaced there. Revisit the
  precedence rule only if review turns up real churn.
- **All D1 reads and writes happen DO-side** (adds, `resolve`,
  `setVideo`) — no new public endpoints, nothing else to rate-limit.
  Hobby scale is deep inside the free tier.

## Codepath map

| Path | Change |
|---|---|
| `radio/youtube.js` | **new** — engine (contract above), the fixed player layer + rect tracker, lazy `iframe_api` load, the client auto-resolver (Topic/VEVO search + duration/embeddable check) |
| [radio/radio.js](../radio/radio.js) | follower mux in `tick()` (:1054); Music Source popover: YouTube box + "AM Previews" relabel (`fillConnectPop`, ~691); the match desk (build beside the crew panel); queue-row "fix video" menu item; `beforeunload` guard |
| [radio/apple.js](../radio/apple.js) | untouched except shared-constant extraction (`DRIFT_MS`, `CORRECTION_GAP_MS`) |
| [styles/main.css](../styles/main.css) | `.radio-np--video` grow mode on `.radio-np__art` (:2066, transition on skin tokens); the player layer block; match-desk columns; bottom-strip answer (:2848) once decided |
| [radio/strings.js](../radio/strings.js) | "AM Previews" (his, unprefixed); `[ph]`: YouTube box label/blurb, desk name + labels, fix-video menu item, badges |
| [radio/transport.js](../radio/transport.js) / [transport-mock.js](../radio/transport-mock.js) | `resolve` + `setVideo` mirrored (mock applies them locally, no D1) |
| `../DeetsRadio/src/index.js` | both verbs beside `add` (~224, capability gate ~559); `sanitizeEntry` accepts `youtube` (:66); D1 lookup at add time; D1 writes on resolve/setVideo |
| `../DeetsRadio/wrangler.jsonc` | D1 binding + the table migration |
| `radio/index.html` | nothing at load — `iframe_api` injects lazily |
| [docs/radio.md](radio.md) | on build: Providers table gains the YouTube column; tier order; the D1 sentence updates |

## Deferred (in order of likely arrival)

- **Registry review pass** — periodic, manual, Aditya's: read the
  matches table (wrangler d1 or a future `GET /matches`), delete or
  replace bad concrete rows. The concrete-over-manual pick rule leans
  on this existing.
- **D1 flip-back for YT-first adds** — the reverse lookup the
  `apple_id` column exists for (scoped with chunk 5, deliberately not
  built): at add time (or paste time), a known `video_id` returns its
  `apple_id`, the client fetches the song from Apple (free) and mints
  the dual entry with **zero metered units** — beats even chunk 5's
  1-unit cost, and makes repeat pastes of room favorites quota-immune.
  Needs the D1 binding to actually exist first; the data is already
  being written.
- **Wrong-Apple-match guard beyond the pane** — the YT-first pane
  shows exactly which Apple song matched *before* the add, and
  `setSong` fixes identity after; if live use still surfaces wrong
  matches that stick, consider a confidence check (artist-name fuzzy
  match on top of duration ±2 s).
- **Odesli enrichment** — only if Topic search misses enough to matter;
  the gap collector will say.
- **Mobile pass** — inherits the iOS background-video footnote.

**Graduated from this list:** YouTube-first adds (SCOPED 2026-07-15
morning, BUILT the same day — chunk 5 in the build log; the scope grew
by Aditya's call to include the desk's `setSong` and the D1 `apple_id`
column, retiring the "zero worker changes" constraint).
