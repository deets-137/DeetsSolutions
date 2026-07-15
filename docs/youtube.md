# DeetsRadio — YouTube (v1.0, shipped 2026-07-15)

YouTube is DeetsRadio's **free full-track tier**: the keyless IFrame
player plays label-delivered recordings for listeners with no Apple
Music subscription. Chosen over Spotify the same day that plan was
written and shelved ([spotify.md](spotify.md) keeps it as reference —
its `resolve`-verb architecture is reused here). Why YouTube won: no
per-listener setup, no Premium requirement, and it's the only
free-to-listen source that overlaps the mainstream catalog.

Built 2026-07-14/15. The chunk-by-chunk build history lives in git
(29b0da6 → the pending-matches commit); this doc describes what
shipped and how it behaves.

## Status

Live: the engine + grown hero, three protocol verbs
(`resolve`/`setVideo`/`setSong`), the Match Desk with pending matches,
YouTube-first adds with the keyless fallback, the quota ledger, the
personal-silence treatment, and the **D1 match registry** (created
2026-07-15, id `226fdbd7`, `MATCHES` binding deployed — worker version
`182ef7ab` at radio-api.deets.solutions). Every user-facing string is
Aditya's — **zero `[ph]` remain**, the ship gate in strings.js is
clear.

Two open items:

- **The Data API key is PARKED** (`radio/yt-key.js` is `null`) — see
  "The key & quota" for what that turns off and how to restore it.
- ⚠ **The seek armor (round 3, seamless-first) is BUILT but
  UNVERIFIED** — see "Sync armor"; Aditya's two-browser test is the
  gate, and the debug telemetry documented there is how to read a
  failure.

## The key & quota (parked at launch)

`radio/yt-key.js` ships `null`. The key only ever powered the METERED
Data API calls — playback is the keyless IFrame API and never touches
it. Parked because the 10k-unit/day quota is ONE pool shared by every
visitor, each device keeps its own optimistic ledger, and at park time
the D1 registry didn't exist yet so nothing amortized. (The registry
is live now — restoring is Aditya's call.)

**What still works keyless:** playback of matched entries, the whole
Match Desk (oEmbed is keyless — `setVideo`/`setSong` in full), matched
search-box pastes (the oEmbed fallback), and pending matches for the
misses. **What's off:** the auto-resolver (`resolve()` and
`resolveSweep` sit out on `Y.hasKey()`), video-only entry minting (no
duration source), and the `embeddable` pre-check (a disabled video
attached at the desk surfaces at playback as the gap treatment).

**Restore:** put the key back in yt-key.js — recover it from the
Google Cloud console or this file's git history at 29b0da6 (it's
referrer-locked to deets.solutions + the dev ports; regenerating in
the console is the cautious option since 29b0da6 is public). Two
shapes: full restore, or the **"key on, resolver off" split** — the
overload risk was always the 100-unit *search*, not the 1-unit
`videos.list` a paste costs (10k pastes/day fit the allowance), so a
flag gating `resolve()` alone re-buys video-only adds and the
embeddable check at ~zero quota risk.

**Quota mechanics** (`radio/youtube.js`): a per-device ledger
(`deets-radio-yt-quota` localStorage) resets on the Pacific day —
Google's boundary; Google exposes no remaining-quota endpoint and the
key is shared, so it counts THIS device's spend only. Every `apiGet`
carries its unit cost (search 100, `videos.list` 1); a 403 marks the
day exhausted; `resolve()` refuses below 101 units. A full resolve
costs 101 units ⇒ ~99 songs/day when live; the D1 registry amortizes
that to once per unique song EVER; beyond that, Google's
quota-increase request form is the only legitimate expansion.
**Odesli is DEAD for YouTube** (probed live 2026-07-15:
`linksByPlatform` carries no youtube or spotify keys, two mainstream
tracks) — an Odesli-first resolver leg was built and removed the same
day; don't re-add without re-probing.

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
  D1 registry amortizes this to one search per unique song ever.
  The key is committed referrer-locked — the Apple dev-token exposure
  pattern, an accepted tradeoff, not a secret.
- **oEmbed is keyless.** `youtube.com/oembed?url=…` returns title /
  channel / thumbnail free — the match desk and the keyless paste
  fallback run on it; only duration + `status.embeddable` need a Data
  API `videos.list` (1 unit).
- **Ads are the sync tax.** An ad-tier listener's pre-roll starts at the
  countdown's zero; they hear the song late and drift-seek to position
  when it ends. Premium listeners and ad-free videos start clean. No
  engineering fixes this; Art-Track preference softens it.
- **No ISRC anywhere** in YouTube's public surface — matching is
  Topic-channel search + duration ±2 s (high precision in practice), or
  a human at the Match Desk. Odesli/song.link is **not a dependency**
  (see the dead-probe note above).
- **Mobile footnote** (for the tabled mobile pass): iOS pauses
  background *video* (not audio) — a YouTube-tier phone can't lock its
  screen. Desktop background tabs keep playing (timers throttle to ~1 s;
  drift correction absorbs it).

## Decisions

- **Tier order is per-entry.** Apple keeps an entry only when it can
  actually play it (connected AND the entry has an apple id); else a
  video-carrying entry with the YouTube box enabled plays video (so a
  YT-only entry plays video even for subscribers); else AM previews
  (toggle); else silence with the gap note. (Originally per-listener;
  revised 2026-07-15 with YouTube-first adds.)
- **Music Source popover: YouTube gets an account-style box** beside
  Apple Music's — same anatomy, but its one control is an enable toggle
  (no auth exists). Both boxes are **icon-only** (2026-07-15): the
  status-text line is gone, the icon IS the status (check / ✕ /
  spinner; `aria-pressed` says it for screen readers). The previews
  toggle reads **"AM Previews"**.
- **AM is the source of truth.** Search stays Apple-catalog; queue /
  history / search render Apple metadata + artwork; `youtube:
  {id, durationMs}` is an annotation on the entry, never its identity.
  The one exception: an unmatched paste with the key LIVE mints a
  **YT-only entry** (`apple: null`, parsed title/artist, video thumb as
  artwork) — which the desk's `setSong` can upgrade to a real Apple
  identity later, video intact. (Keyless, the miss parks as a pending
  match instead — see below.)
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
  (custom text isn't a thing browsers allow anymore).
- **Bottom strip (≤66 rem shell):** the NP-card grid gains a
  **full-width ~200 px video row** above the art/center/controls rows
  (chunky but anatomical — the strip simply grows while a video plays
  there). No floating mini-tile.

## The player layer: never reparent an iframe

Moving an iframe in the DOM **reloads it** — playback dies and ads
replay. The room UI reparents wholesale (the site-shell dock), so the
player cannot ride the NP card's nodes. Same inversion as the shell
itself: **the player never moves; the layout moves under it.**

One persistent fixed-position layer holds the single IFrame player.
The active `.radio-np__art` is one DOM node wherever it reparents; the
layer rect-tracks it (rAF + ResizeObserver + scroll/resize) and sits
exactly over it. Hidden **only** while cued (countdown lead) or the
engine is inactive — never while playing (TOS). The reveal happens
after the grow settles, so the tracker never chases a moving box
mid-reveal. The dock needs nothing: its art slot is already a 304 px
square (19 rem dock), legal as-is.

**Stacking:** the layer is z-index **4** — under the sticky toolbar's
5, so the video tucks under the bar and scrolls with its card;
`:root[data-radio-shell] .radio-yt-layer` bumps it to 38 (above the
shell frame at 35, below menus at 40, under toasts at 50) only while
the shell is up — the shell already stamps that attribute, no JS.

## The engine: `radio/youtube.js`

Same contract radio.js speaks to `RadioApple` — `follow(view)` /
`note()` / `stop()`, fed from `tick()` — plus the rect layer above.
The mux is per-entry (see Decisions).

| Room event | Engine op |
|---|---|
| scheduled start | `cueVideoById(id, startSeconds)` in the lead → `playVideo()` at the boundary |
| pause | `pauseVideo()` — local, instant |
| skip / back / track-end | not a player op: the room broadcasts a new `current`; the engine loads the new ID and chases |
| drift > 1.75 s | `seekTo(expected + seekPad, true)` — same `DRIFT_MS` / `CORRECTION_GAP_MS` constants as apple.js, PLUS the adaptive seek pad (see "Sync armor") |
| mid-song join | `loadVideoById(id, expectedSeconds)` |
| video ends early | ignored except fall-silent — the room's alarm advances, never the client |

apple.js's wedge armor is ported wholesale (`followFull`): silence
check first on every tick, timestamped in-flight latches that expire,
no overlapping starts, a load-sequence counter. `iframe_api` loads
lazily on first activation — dead weight for Apple listeners.
`playsinline` for iOS. Volume local, as everywhere.

## Sync armor: seamless-first correction — ⚠ round 3, UNVERIFIED

The problem: MusicKit seeks are near-instant, IFrame seeks REBUFFER,
so a naive `seekTo(expected)` lands behind the clock by the buffer
time, still outside `DRIFT_MS`, and re-seeks forever — in lockstep on
every listener, because they all chase the same room clock. Every
seek/cue therefore aims **ahead** at `expected + seekPad`, and the pad
is re-measured from where playback actually lands (`est = seekPad −
err` for padded ops, `−err` for bare starts — algebra that recovers
the true cost).

**The design rule, set by Aditya after two failed rounds: seamless
beats synced.** Continuous audio slightly behind the room always beats
stuttering sync purity. Everything below serves that.

- **Bounded learning.** A landing's `est` only counts when it
  plausibly measured a seek/spin-up (`0 ≤ est ≤ 2×PAD_MAX`), and one
  landing can at most DOUBLE the pad. `PAD_MAX` is 4 s — the pad
  models a *seek's* cost, and healthy seeks measured ~150–300 ms.
  Evidence for the bound: a background-tab capture (Chrome throttles
  silent tabs to one timer tick per MINUTE) produced a 60 s "landing
  error" that round 2's unbounded jump rule trusted — pad slammed to
  its cap, the next seek overshot by 20 s, and the pause-trap froze
  the video for 20 invisible seconds. Aditya's live capture showed the
  same poisoning (`padBefore: 13793` — nothing real costs 13.8 s).
- **Re-anchor, don't chase.** Behind by more than `REANCHOR_MS` (8 s)
  — a stall era, a throttled tab — chasing learns garbage; the armor
  does ONE decisive `loadVideoById` at the clock instead: a single
  brief buffer, then playing on time. Evidence: Aditya's window sat
  31.8 s behind with a perfectly healthy network (`videoplayback` all
  200 at ~100–300 ms) — the lag was accumulated history, not
  bandwidth, and exactly one reload away from gone.
- **The landed-ahead pause is capped at 3 s** (`WAIT_MAX_MS`). A pause
  is the free correction (the clock walks to us), but a long frozen
  frame reads as a hang; overshoots beyond the cap seek BACKWARD
  through content that just buffered — cheap. TOS binds a player only
  *while playing*, so the paused frame stays visible.
- **Strikes back the cadence off** — consecutive behind-landings widen
  the correction gap 5 → 10 → 20 → 40 s, so a link that can't land a
  correction degrades to an occasional catch-up, not a stutter loop.
  A clean landing or track change resets it.
- Round-2 fixes that carry forward: a drift-seek's settle survives the
  start latch (`settlingPadded` no longer overwritten by the stale
  `cuePadded`), and `cuePadded` is spent once measured, so mid-play
  stalls measure as bare.

**Debug telemetry** (left in on purpose — capped ring, numbers only):
`RadioYouTube.dbg()` returns the follower's event log (`cue` / `start`
/ `state` / `land` / `seek` / `seekback` / `anchor` / `wait` /
`resume` / `wedge` / `error` / `stop`, with `err`/`est`/pad/strikes);
`localStorage["deets-radio-yt-debug"] = "1"` live-tails it to the
console as `[yt]` lines. This is how the round-2 failures were
diagnosed; keep it.

**Verification owed (the wrap-gate that remains):** two side-by-side
browsers, same room, video track. Expect at most a brief buffer at
start plus one more at any catch-up; a ≤3 s frozen frame is the
landed-ahead pause working; worst case is a correction every ~40 s.
If it still misbehaves, flip the debug flag and read the `[yt]` rows —
`anchor` spam means the environment is stalling the player itself
(see below), not the armor.

**The environment finding (2026-07-15, his Edge windows):** an ad
blocker (`ERR_BLOCKED_BY_CLIENT` on `youtubei/log_event`, `ptracking`,
`generate_204`) correlated with the player deterministically stalling
every ~3.5 s of media — with ZERO armor events; the player starved
itself. After disabling the blocker the stalls persisted in that
session (suspects: Edge Tracking Prevention Strict, anti-adblock
limbo persisting per-session) but the network showed healthy 200s —
and the armor's job in that world is exactly the seamless-first
behavior above. "Ads must not be blocked" is literally in the API
TOS; a player at war with a blocker cannot be engineered around from
our side.

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
   **Parked with the key**: `resolve()` and the client sweep
   (`resolveSweep` — current + next 2, once per entry per session,
   needs `Y.hasKey()` + `canQueue()`) sit out while yt-key.js is null.
3. **Nothing** — entry stays video-less; YouTube-tier listeners fall to
   AM previews / the gap note. The Match Desk is the human override at
   any point.

**Protocol — three verbs, mirrored verbatim across
`radio/transport.js`, `radio/transport-mock.js`, and
`../DeetsRadio/src/index.js`** (the three-way contract rule):

| msg | payload | rules |
|---|---|---|
| `resolve` | `{entryId, youtube: {id, durationMs}, source: "topic"\|"vevo"\|"search"}` | fill-missing **only**, never overwrites (griefer can't flip a live video); **queue** capability; DO sanitizes (11-char `[A-Za-z0-9_-]` id, duration bounds) and persists to D1 with the claimed source |
| `setVideo` | `{entryId, youtube: {id, durationMs}}` | the Match Desk's verb: **overwrite allowed**; **queue** capability; works on the *current* entry (wrong-video-right-now is the motivating case — the follower chases the new ID next tick and drift-seeks); logs a **manual** association to D1 |
| `setSong` | `{entryId, song: {…full Apple identity…}}` | the desk's second verb — `setVideo`'s flip side: re-pins the entry's **Apple identity** (title/artist/album/artwork/ISRC/apple/previewUrl through `sanitizeEntry`'s field rules); **overwrite allowed**; **queue** capability; the youtube block and add provenance survive; logs to D1 as **manual** with `apple_id` |

**Canonical duration:** frozen on the *current* entry (the alarm is
scheduled off it; a mismatched video clamps — worst case a few seconds
of tail silence). A `setVideo` on a **queued** entry may rewrite
`durationMs` from the video's real length (no alarm depends on it
yet). `setSong` holds the same line: the current entry keeps its
frozen `durationMs` under a re-pin; a queued entry adopts the new
song's length. `sanitizeEntry` (worker src/index.js) accepts the
`youtube` block on `add` too; the `spotify: null` hardcode stays.

## YouTube-first adds: paste a link into the search box

The search field is dual-mode page-wide: **links mean video, words
mean songs** (`parseYtId` is URL-only — any 11-letter word like
"temperature" would otherwise read as a video id). A pasted YouTube
link takes the lookup → reverse-match path; URLs stay out of the
Recents chips. Apple search remains the front door — this is an
addition, not a replacement.

**With the key live:** one 1-unit `videos.list`
(`snippet,contentDetails,status` — title/channel/thumb/duration/
embeddable in a single metered call, no oEmbed; `Y.lookup` is memoized
per session, misses un-memo so a flaky network can retry) →
`Y.parseTitle` guess → FREE Apple reverse-search, duration ±2 s → a
one-result pane: a match mints the full dual entry, a miss mints a
**YT-only entry** (thumb artwork, parsed title/artist). Adds ride
`source: "manual"` — a pasted video is a human pick, curated-grade D1
provenance. **Embed-disabled** videos warn (`ytAddNoEmbed`) and the
entry adds WITHOUT the dead block — resolveSweep or the desk finds a
playable video later.

**Keyless (current state):** `Y.oembed(id)` substitutes — same shape
as `lookup` but `durationMs: 0` and `embeddable` unknowable (reported
true; a refusal surfaces at playback as the gap treatment). The same
title-parse → Apple reverse-match runs (shared `ytMatch(seq, info,
keyless)`), but keyless matching takes the TOP hit — there's no
duration to test against, and the one-result pane is human-reviewed
before anything adds. A match mints the dual entry with the **Apple
clone carrying the load-bearing durationMs** (the room alarm schedules
off it); the video block rides as `{id, durationMs: 0}` (0 = unknown,
setVideo's idiom). A miss can't mint — no real duration — so it
**parks as a pending match** (next section) and the pane acks with
`ytAddParked`.

**Title parsing** (`Y.parseTitle`): Topic uploads are label-clean (the
channel IS "<Artist> - Topic", the title IS the song); everything else
gets bracketed-noise stripping, an "Artist - Title" split, and the
channel (minus VEVO/Official dressing) as the artist fallback. "Live"
is deliberately NOT noise — a live cut is a different recording.

## Pending matches: the keyless miss path

An unmatched keyless paste parks as a **pending match** — a
**device-local** list (`deets-radio-pending` localStorage, cap 20
oldest-out, `{id, title, channel}` from oEmbed), deliberately never on
the wire. A room-shared pending list was weighed and rejected: it's
real DO/protocol surface for an item that by definition can't play,
and the paster is the person with the context to match it.

**Desk presentation:** pending rows sit PINNED ON TOP of the Match
Desk list under the "Waiting to be matched" label — wide 16:9 video
thumb (i.ytimg mqdefault), parsed title/channel, `--pause` hourglass
badge (`ICON_WAIT`), hairline rule before the entry rows. The desk
renders whenever pending exist, even with an empty queue.

**Workbench (pending row selected):** video thumb → oEmbed title →
search field BELOW the video ("Search Apple Music" catalog,
words-only) → top-5 Apple results → **two-step commit**: clicking a
result only ARMS `pendingPick` (highlight + a persistent picked-song
pane — search results are transient DOM that a broadcast re-render
wipes, and Confirm must never act on something the user can't see);
the **"Confirm link"** button performs it — a clone of the picked song
with `youtube: {id, durationMs: 0}` through `sendAll([entry], "later",
"manual")`, so it lands at the queue bottom, rides the queue cap, and
D1 remembers the pair. **"Remove from queue"** is the local discard.
Search + Confirm hide without `canQueue()`; Remove stays (it's local).

**The nudge:** a sticky warn toast with a Dismiss action
(`pendingToast`; `pendingToastOne` is the singular) raised on room
entry and whenever the pending count CHANGES; a manual dismiss holds
it down until the count changes again; retired at zero and on leave.

**The door this closes:** true YT-only tracks — a video with no Apple
match anywhere can never play under this model. Keyless they were
impossible anyway (no duration source); if the key returns, a 1-unit
`videos.list` could offer "add as video-only" on a stuck pending item
— the two designs compose.

## The Match Desk

Bottom-right, mirroring the crew panel (bottom-left) — the room's two
service windows. Visible to everyone; **edits ride the queue
capability** (they mutate entries — no new permission concept). The
name, like every string on the page, is Aditya's.

Two internal columns:

- **Left — the room's songs** (pending matches pinned on top, above).
  Scrollable list of current + queue (existing row anatomy: art ·
  title/artist), each with a match badge: **has-video ✓ (`--go`) ·
  none ✕**. (A three-tier badge with provenance was designed;
  per-entry provenance doesn't ride the wire, so it stays a later
  nicety.) Click a row → the right half selects it. A second entry
  point: right-click a queue row → "Fix video" jumps here with that
  row selected.
- **Right — the workbench.** One **dual-mode field** at the top:
  **pasting a YouTube link applies immediately** — no confirm step
  (`setVideo`; the "Received!" ack shows in the status line, and the
  broadcast's badge flip replaces it within a beat); **typing anything
  else searches the free Apple catalog, songs only**, five compact
  rows under the field, and clicking one re-pins the entry's Apple
  identity (`setSong`). The placeholder leads with the likelier act —
  "Paste a YouTube link" while the entry has no video, "Search Apple
  Music" once it does — but the field stays dual-mode either way. Undo
  either way is doing it again differently. Below the field: the
  **attached AM song** (art · title/artist — dimmed while the entry is
  YT-only), then the attached video (thumbnail + title via keyless
  oEmbed). The status line wears `--go` — both its messages are
  success acks. A focus guard skips desk re-renders mid-typing, and
  commit paths blur the field so the broadcast's re-render can land.

Desktop-only for now, like the crew panel (mobile pass is tabled).

## Personal silence (room plays, this device doesn't)

When the room is playing but THIS device hears nothing (catalog gap /
preview over / previews toggled off), ONE red sticky toast stands for
as long as the silence lasts (`silenceOff`, retired the moment audio
returns or the room idles), the NP note names the cause, and the
progress row PARKS (0%, no elapsed, dimmed `.radio-np--muted`) — the
bar shows what YOU hear; the room clock is untouched. Full rule in
[radio.md](radio.md) (the progress-bar bullet). An `apple: null` entry
landing in apple.js's none-branch notes "gap" WITHOUT reporting to the
gap collector (which is Apple-id-keyed).

## The D1 registry: resolve cache + curation memory

**LIVE since 2026-07-15** — database `deets-radio-matches` (id
`226fdbd7`), `MATCHES` binding in `../DeetsRadio/wrangler.jsonc`,
table lazy-created on first write. The first D1 use in DeetsRadio —
[radio.md](radio.md) recorded "D1 stays out until a cross-room feature
needs it"; a cross-room match memory is that feature. The worker
**fails open** without the binding (adds still work, videos just don't
auto-attach).

```
matches(
  isrc      TEXT,               -- the key (Apple-minted entries always have one)
  video_id  TEXT,
  duration_ms INTEGER DEFAULT 0,-- the video's length (rides every write)
  apple_id  TEXT,               -- the Apple song id, when known —
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
with ZERO metered units — no search, no videos.list.

- **Concrete rows** (`topic` / `vevo`, duration-verified) come from the
  auto-resolver via `resolve`; deterministic provenance.
- **Manual rows** come from the desk via `setVideo`/`setSong` and
  YT-first/pending adds; each repeat of the same (isrc, video)
  increments `votes` — repeated human choices converge, and one bad
  paste can be out-voted. This is why no confirm/deny is needed.
- **Pick rule at add time: concrete row if present, else the
  most-voted manual row, else the live auto-resolver.** Known corner,
  accepted: a *wrong* concrete match (Topic search grabbed a remaster)
  can be fixed in-room via `setVideo` but re-attaches on future adds.
  Aditya handles this with **periodic manual review** of the registry
  (`npx wrangler d1 execute` in `../DeetsRadio`, or a later read-only
  `GET /matches` in the `GET /gaps` idiom); a bad concrete row gets
  deleted or hand-replaced there. Revisit the precedence rule only if
  review turns up real churn.
- **All D1 reads and writes happen DO-side** (adds, `resolve`,
  `setVideo`, `setSong`) — no new public endpoints, nothing else to
  rate-limit. Hobby scale is deep inside the free tier.

## Codepath map (where things live)

| Path | What it holds |
|---|---|
| [radio/yt-key.js](../radio/yt-key.js) | the Data API key slot (currently `null` — parked; the file's comment is the re-enable guide) |
| [radio/youtube.js](../radio/youtube.js) | the engine (contract above), the fixed player layer + rect tracker, lazy `iframe_api` load, the auto-resolver, `lookup` (metered) + `oembed` (keyless), `parseTitle`, the quota ledger |
| [radio/radio.js](../radio/radio.js) | per-entry mux in `tick()`; Music Source boxes (`fillConnectPop`); `runYtAdd`/`ytMatch`/`renderYtPane` (the paste flow); the Match Desk (`renderDesk` + pending state + `syncPendingToast`); `resolveSweep`; queue-row "Fix video"; `beforeunload` guard |
| [radio/apple.js](../radio/apple.js) | shared drift constants; the "off"/"gap" notes the silence treatment reads |
| [styles/main.css](../styles/main.css) | `.radio-np--video` grow mode; `.radio-yt-layer`; `.radio-service` grid; `.radio-desk*` (incl. the pending-match block); bottom-strip video row |
| [radio/strings.js](../radio/strings.js) | every user-facing string — all Aditya's, zero `[ph]` |
| [radio/transport.js](../radio/transport.js) / [transport-mock.js](../radio/transport-mock.js) | the three verbs mirrored (mock applies them locally, no D1) |
| `../DeetsRadio/src/index.js` | verbs beside `add`; `sanitizeEntry` accepts `youtube`; D1 lookup at add time; D1 writes on resolve/setVideo/setSong |
| `../DeetsRadio/wrangler.jsonc` | the live `MATCHES` D1 binding |
| `radio/index.html` | yt-key + youtube script tags; `.radio-service` wrapper (`iframe_api` itself injects lazily) |

## Deferred (in order of likely arrival)

- **The seek-pad verification** — the one open gate (see "Sync
  armor").
- **Key restore decision** — full, or the "key on, resolver off"
  split ("The key & quota").
- **Registry review pass** — periodic, manual, Aditya's: read the
  matches table, delete or replace bad concrete rows. The
  concrete-over-manual pick rule leans on this existing.
- **D1 flip-back for YT-first adds** — the reverse lookup the
  `apple_id` column exists for: at paste time, a known `video_id`
  returns its `apple_id`, the client fetches the song from Apple
  (free) and mints the dual entry with **zero metered units** — makes
  repeat pastes of room favorites quota-immune, and gives keyless
  pastes of known videos an exact match instead of a top-hit guess.
  The binding is live now; the data is already being written.
- **Wrong-Apple-match guard beyond the pane** — the pane shows exactly
  which Apple song matched *before* the add, and `setSong` fixes
  identity after; if live use still surfaces wrong matches that stick
  (keyless top-hit matching raises the odds), consider a confidence
  check (artist-name fuzzy match, restored duration test when the key
  returns).
- **Odesli enrichment** — only if Topic search misses enough to
  matter, and only after re-probing (it was dead 2026-07-15).
- **Mobile pass** — inherits the iOS background-video footnote.
