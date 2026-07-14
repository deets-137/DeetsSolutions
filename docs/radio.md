# DeetsRadio — design (phase 3 built)

**Status (2026-07-13):** all three build phases are in. Rooms run on the
real transport (`radio/transport.js` → the sibling
[DeetsRadio](../../DeetsRadio) worker at `radio-api.deets.solutions`, a
Durable Object per room; deploy with `npx wrangler deploy` there);
`?mock` on the page URL selects the in-page mock instead, and `?api=<url>`
(honored on localhost only) points at a local `npx wrangler dev --port 8789`.
The Apple side is phase 2's: catalog search, `authorize()` behind the Music
Source pill, and the playback follower (full tracks when connected, 30 s
previews otherwise). The developer token signs locally — see
[The developer token](#the-developer-token).

Before ship: handwrite the remaining `[ph]` entries in `radio/strings.js`,
hand-draw the blank cover sprite, and tune sync feel (drift thresholds,
cover-up timing) against real network latency — the one pass the mock
could never host.

Design for the **DeetsRadio** tab (`radio/`, nav label "DeetsRadio"): shared
listening rooms. Anyone who knows a room's code joins it and hears the same
music at the same time — a communal queue, synchronized play/pause/skip/back,
and a shared history. Playback is per-listener through their own streaming
subscription (Apple Music or Spotify); what's shared is *state*, never audio.
Like [league.md](league.md), this tab needs a **Cloudflare Worker** — here
for a Durable Object per room — while the page itself stays flat HTML/CSS/JS.

Much of the UX is ported from the sibling **DeetsMusic** desktop app
(`../DeetsMusic`) — see [UX ports](#ux-ports-from-deetsmusic).

## Versioning

- **v0.9 — Apple only.** Ships with Apple Music (full tracks) + the no-login
  preview tier. A fresh MusicKit developer token is registered for this app
  (separate from DeetsMusic's). Spotify is **stubbed, not built**: `Entry`
  keeps its `spotify` slot (always `null`), the resolve pipeline runs its
  Apple half with the Spotify half behind a Worker config flag, and the
  Spotify connect button is hidden behind the same flag. Nothing in the
  protocol or storage changes when Spotify lands.
- **v1.0 — Spotify.** Flip the flag, add the PKCE flow + Web Playback SDK
  client, backfill `spotify` IDs lazily (a queue/history entry with
  `spotify: null` and an ISRC gets resolved on first sight by a v1 Worker).
- **v1.x — auto-continue** (designed below, built after the resolve pipeline
  is battle-tested).

## Decisions already made

- **Communal controls.** Knowing the room code = trusted. Anyone can
  play/pause/skip/back, add, remove, reorder. No host role, no auth tiers.
- **Rooms are durable.** A DeetsRadio ID persists (queue, history, settings
  survive everyone leaving). The room keeps "playing" while empty — rejoin
  and it's mid-song, like a real station.
- **Room codes are free-form with a create confirm.** The creator types any
  code; it's slugified (lowercase, `a–z 0–9 -`, 3–24 chars). Entering a code
  that doesn't exist shows a one-tap "No room called *X* — create it?" step,
  so a typo joins nothing and never mints a ghost room.
- **Preview listeners ride one honest clock.** A visitor with no subscription
  hears the first 30 s of each track (Apple preview asset), then silence until
  the room advances. No "preview room" mode — the room clock never bends.
- **Display names, no accounts.** A name in `localStorage`
  (`deets-radio-name`), sent with every command. Powers "added by" on queue
  rows and the listener list. Reusable by future site features.
- **No seeking, ever-visible progress.** The transport shows a read-only
  progress bar (room position over canonical duration); there is no seek
  command in the protocol.
- **Synced starts via countdown.** Human-initiated transport (play, skip,
  back, resume) schedules the start ~3.5 s out (`startsAt = now + LEAD`);
  clients preload during the lead and show a room-clock-synced 3-2-1 over
  the now-playing hero, then start together. Track-end advancement is
  seamless (no countdown) — see [Sync details](#sync-details).
- **All flavor/UI text is handwritten by Aditya.** Every user-facing string
  lives in `radio/strings.js` (one flat object); anything Claude writes
  there is a clearly marked placeholder (`[ph]` prefix) until replaced.
  Never invent site copy inline.
- **The bar is the doorway (League idiom).** No pre-join card: the page
  opens with the shared `.sotd__bar`, and a `.tb-ctrl` combobox — the
  station code IS the title — with a `.tb-pop` recents popover, exactly the
  League gamertag pattern.
- **Queue exhaustion: idle in v0.9.** Room goes quiet; the first `add` while
  idle starts playing it. Auto-continue is a later room setting (see
  [Auto-continue](#auto-continue-designed-deferred)).
- **Spotify in development mode is fine.** ~25 named users, added by hand in
  the Spotify dashboard. Apple side has no such cap.
- **Worker lives at `radio-api.deets.solutions`** (custom-domain binding on
  the Worker; one DNS record on the existing Cloudflare zone).

## The core mechanic: the room owns a clock, not audio

The Durable Object holds *logical transport state* — what's playing, whether
it's playing, and **when it started** (epoch ms). Each client computes
"where should I be right now" and nudges its local player when drift exceeds
~1.5–2 s. Sub-second lockstep is neither achievable nor needed; the target is
"same song, same few seconds" (the Spotify Jam standard).

**The room advances tracks, not the clients.** Every queue entry stores its
duration at add time; the DO sets a **Durable Object alarm** for the track's
end and advances the queue itself when it fires (works with zero listeners
connected — this is what makes an empty durable room keep playing). Clients
never act on their own player's "ended" event except to fall silent —
client-driven advancement would double-skip under drift.

Human-initiated starts are **scheduled, not immediate**: the room sets
`startsAt = now + LEAD` (~3.5 s, tunable) and broadcasts at once. Clients
spend the lead preloading (MusicKit queues the track; later, Spotify's Web
API start call fires inside the window) and render a 3-2-1 countdown off
the room clock — everyone's digits flip together — then start an
already-buffered track in unison. The countdown doesn't cover sync; it *is*
the sync. `startedAt > serverNow` ⇒ the room is in its counting state.

Transport rules:

- **play** (resume from pause): `startedAt = now + LEAD − pausedPosition`;
  broadcast; alarm at `startedAt + durationMs`. Countdown shows —
  `pausedPosition` **stays set through the lead** (cleared only by the next
  advance), so clients read the scheduled boundary as
  `startedAt + pausedPosition`, hold position frozen while the digits run,
  and the room clock never rewinds. Generally: *counting* ⇔
  `playing && startedAt + (pausedPosition ?? 0) > serverNow` (a fresh start
  has no `pausedPosition`, reducing to `startedAt > serverNow`).
- **play** (from idle, queue non-empty) / **skip** / **back**: current ↔
  history shuffle as appropriate (skip: current → history, next up becomes
  current; back: newest history entry → current, current returns to the
  *front* of the queue), then `startedAt = now + LEAD`; alarm reset.
  Countdown shows.
- **pause**: store `pausedPosition = max(0, now − startedAt)` — unless the
  room is mid-countdown, which cancels back to wherever the count started
  from (zero for a fresh start, the old `pausedPosition` for a resume);
  cancel alarm; broadcast.
- **track end** (alarm): same queue shuffle as skip but **seamless** —
  `startedAt = ` the previous track's exact end. The boundary is known in
  advance, so clients preload the next track against it and roll straight
  over. No countdown between songs; the radio doesn't clear its throat.
- **commands mid-countdown**: the room serializes, so skip/back during a
  countdown simply reschedules (`startsAt` moves); nothing races.
- **queue exhausted**: room idles (nothing playing). First `add` while idle
  starts playing it — with countdown. (Later: auto-continue, a room
  setting — see below.)

## Architecture

```
radio/index.html + js  (static, Cloudflare Pages — no build step)
  ├── wss://radio-api.deets.solutions/room/{id}
  │                     ──> CF Worker ──> Durable Object per room
  │                           ├─ private SQLite storage: queue, history,
  │                           │    settings, transport state
  │                           ├─ hibernatable WebSockets (one per listener)
  │                           ├─ alarm: track-end advancement
  │                           ├─ GET /room/{id}/peek: {exists, nowPlaying?,
  │                           │    listeners?} — powers create-confirm and
  │                           │    the join preview (no join required)
  │                           └─ resolve endpoint: ISRC cross-catalog match
  │                                (Apple developer token; Spotify
  │                                 client-credentials secret + the whole
  │                                 Spotify half behind a config flag in v0.9)
  ├── MusicKit JS (Apple CDN — documented exception to the no-CDN rule,
  │     this page only)
  └── Spotify Web Playback SDK (same exception)
```

The Worker is a single plain-JS file deployed with `wrangler` — no npm
dependencies, no build step, keeping the site's conventions in spirit. Free
tier (SQLite-backed DOs, hibernation) covers this comfortably.

### Why Durable Objects + WebSockets

- A room is an island: its own state, its own connections, strict ordering
  of commands because one object processes them serially. No cross-room
  coordination, no shared DB contention (D1 stays out of this design until
  a cross-room feature — e.g. a public room directory — needs it).
- **Hibernation API**: the DO is evicted from memory between messages while
  its WebSockets stay open. An idle room with listeners attached costs
  nothing; heartbeat ping/pong is answered by the platform without waking
  the object (`setWebSocketAutoResponse`).
- DO **storage** is a private per-object SQLite database (transactional,
  in-process, survives eviction) — distinct from D1, which is one shared
  central database over a binding.

## Protocol

All messages are small JSON over the room socket. Every server broadcast
carries `v` (state version, monotonic) and `serverNow` (room clock, epoch ms)
so clients keep a clock offset and detect missed updates (gap in `v` →
re-request snapshot).

**Client → room**

| msg | payload | effect |
|---|---|---|
| `join` | `{name, create?: bool}` | registers presence; server replies with `snapshot`. `create: true` initializes an uninitialized room (see below); without it, joining one is refused |
| `play` / `pause` | — | transport (see rules above) |
| `skip` / `back` | — | transport |
| `add` | `{entry, at?}` | resolved entry (see below) appended / inserted |
| `remove` | `{entryId}` | remove from queue |
| `reorder` | `{entryId, to}` | move within queue |
| `rename` | `{name}` | update display name |

**Room → clients**

| msg | payload |
|---|---|
| `snapshot` | full state: settings, transport, current, queue, history (bounded), listeners |
| `state` | delta broadcast after any mutation (same shape, only changed sections) |
| `presence` | listener joined/left/renamed |

Reconnect = new socket + `join` + fresh `snapshot`. No delta replay.

### Room state (DO storage)

A DO for any room ID technically always "exists" (`idFromName` never
fails), so existence = **a `room` row in storage**. `peek` on an
uninitialized object answers `{exists: false}` and persists nothing; the
room row is written only by the first `join` carrying `create: true` (set
by the Start-this-station button). A stray `join` without the flag on an
uninitialized room is refused — ghost rooms are impossible by construction.

```
room:      { id, createdAt, settings: { requireBothCatalogs: bool } }
transport: { playing: bool, startedAt: epochMs | null, pausedPosition: ms | null }
current:   Entry | null
queue:     Entry[]          (ordered)
history:   Entry[]          (append-only, newest last; repeats are real —
                             same philosophy as DeetsMusic's play log;
                             stored cap 500 oldest-trimmed, snapshot sends
                             the newest 50, column renders those)
```

### Entry — the provider-agnostic track

Resolved **once, at add time, in the Worker** (which holds the Spotify
client-credentials secret and the Apple developer token — clients never do
cross-catalog work):

```
{
  entryId,                    // nanoid-style, minted by the room
  isrc,                       // matching key; null if fuzzy-matched
  title, artist, album,
  artworkUrl,                 // Apple artwork template preferred
  apple:   { id, durationMs } | null,
  spotify: { id, durationMs } | null,
  previewUrl,                 // Apple 30s asset (Spotify previews are dead
                              //   for new apps since late 2024)
  durationMs,                 // canonical = max(provider durations); the
                              //   room clock advances on this
  match: "isrc" | "fuzzy" | "single",   // single = one catalog only
  addedBy, addedAt
}
```

In v0.9 every entry is minted with `spotify: null` and `match: "single"`;
the stored `isrc` is what lets a v1.0 Worker backfill Spotify IDs lazily
(resolve-on-first-sight for any entry it encounters with an ISRC and no
`spotify` block). **v0.9 ships without `POST /resolve` at all** — there is
no other catalog to match yet, so the adder's client sends the Apple
search result as the entry and the room's `sanitizeEntry()` rebuilds it
field-by-field (whitelist, length caps, https-only URLs, sane duration).
The endpoint arrives with the Spotify flag.

**Resolution flow** (Worker `POST /resolve`): adder's client sends the track
it picked from search (either provider) → Worker looks up the *other* catalog
by ISRC (`filter[isrc]=` on Apple, `isrc:` search on Spotify) → on a miss,
fall back to title + artist search with runtime match ±2 s (`match:"fuzzy"`)
→ still nothing: `match:"single"`. If the room has `requireBothCatalogs` on,
single-catalog adds are rejected with a reason the UI surfaces ("Not on
Spotify"); otherwise they're allowed and badged.

**Playing a gap**: any client with no playable asset for the current entry
(preview listener past 30 s; Spotify listener on an Apple-only track) sits
silent with a note in Now Playing — one mechanism covers both cases.

## Providers

| | Apple Music (v0.9) | Spotify (v1.0) | No account (v0.9) |
|---|---|---|---|
| SDK | MusicKit JS (Apple CDN) | Web Playback SDK | plain `<audio>` |
| Full tracks | subscribers | **Premium** subscribers | 30 s previews |
| Auth | `music.authorize()` popup — no server part | OAuth **PKCE**, client-side, no secret | none |
| Dev-side key | pre-signed developer-token JWT, `origin` claim locked to deets.solutions, ~6-month expiry, re-signed by the nightly Task Scheduler job (same pattern as the SOTD refresh) | app in **development mode**: ~25 allow-listed users; client-credentials secret lives in the Worker for catalog search | — |
| Sync control | local `play/pause/seek` | SDK local `pause/resume/seek`; *starting* a track is one Web API call (slightly laggier starts — drift correction absorbs it) | local `<audio>` seek |

Unlike DeetsMusic — whose Rust loopback-auth and token-injection machinery
exists only because WebView2 can't open OAuth popups — the browser needs none
of it. `authorize()` just works. None of the Rust side ports; none of it is
needed.

**Autoplay is gated on a gesture.** Browsers refuse `play()` until the page
has been interacted with, and MusicKit surfaces that refusal as its own
`alert()` — so neither engine even attempts playback before
`navigator.userActivation` says the page has seen a gesture (a hard refresh
into a live room lands silent with the "blocked" note until a tap), MusicKit
is configured with `suppressErrorDialog`, and the full-track engine never
overlaps `play()` calls while one is spinning up (overlapping starts were
the source of MusicKit's "undefined" alert).

### The developer token

Signed locally by `scripts/radio-token.ps1` — pure PowerShell, zero
dependencies (.NET's CNG imports the PKCS#8 key and signs ES256 in the
r‖s form JWS wants) — from credentials in `scripts/secrets/` (gitignored;
its README says what goes there). The JWT lands in `radio/dev-token.js`
and **is committed**: it ships to every visitor anyway, and its `origin`
claim is locked to `deets.solutions` + `localhost:8787`/`8788` (the two
dev-server ports in `.claude/launch.json`). Apple enforces that claim by
matching the request's `Origin` header — browsers always send one, but
headless calls must add it or they 401. Before writing, the script probes
one Apple catalog request with the fresh token and aborts on rejection. ~150-day expiry; the default run re-signs only
within 30 days of expiry (a fresh `iat` would otherwise churn commits)
and then commits just that one file, never pushes — the nightly-sotd
idiom, registered as a Task Scheduler job via
`scripts/register-nightly-radio-token.ps1`. While `dev-token.js` is the
null stub, the page quietly falls back to mock search and silent
playback.

## Page layout

Route: `radio/index.html`. Standard page chrome: site header + nav + Vibe
mount + pre-paint head script (copy per [ui.md](ui.md)). The page opens
with the journals' `.sotd__bar` (League-style, combobox in the title slot —
see the join flow below), not the plain `.page-bar`.

### Join & creation flow

Principle: **creating a station is naming it, not filling out a form.** The
doorway reuses the League tab's combobox idiom wholesale — same `.sotd__bar`
/ `.tb-ctrl` / `.tb-pop` kit ("the title IS the search",
[league/league.js](../league/league.js) around the combo-box section).

- **The combobox is the station field.** The bar's input takes a code; the
  slug forms live in muted mono as you type (`Friday Vibes!` →
  `friday-vibes`) — slugification as visible charm, not hidden coercion.
  Focus opens the `.tb-pop` with a **Your stations** group (rooms you've
  joined; `localStorage`, cap ~8 — the League recents idiom, one tap to
  rejoin). Enter commits.
- **Peek before you leap.** Committing a code hits `GET /room/{id}/peek` →
  `{exists, nowPlaying?, listeners?}`, rendered *below the bar* (where
  League renders profile/stats — no card, no modal). Exists: what you're
  walking into ("Now playing: … · N listening") + a Join button. Doesn't:
  "No station called *friday-vibes* yet." + a **Start this station**
  button. One endpoint serves both.
- **No auth wall.** You enter instantly as a preview listener; the **Music
  Source** toolbar pill *inside* the room connects Apple (the Spotify
  option appears when the v1.0 flag flips). Creation is two fields total —
  code and display name, and the name is asked once then remembered
  (`deets-radio-name`).
- **The gate disappears once you're known.** With a saved name, committing
  an *existing* code joins instantly — no gate at all. The gate renders
  only for create-confirm (always, so a typo never mints a room) or when
  no name is stored yet (first ever visit); on create-confirm with a saved
  name, the name field is omitted too.
- **The bar stays.** In-room, the combobox keeps the current code (it
  doubles as the room switcher); the `.sotd-toolbar` slot holds copy-link,
  connect, and the listener-count pill; the `sotd__meta` line carries room
  status text.
- **Stations are links.** `radio/#friday-vibes` deep-links with the code
  resolved on load (straight to peek); a mistyped link lands on
  create-confirm, never a ghost room.
- **Fresh-station empty state.** First landing in an empty room auto-focuses
  the search input with an add-the-first-song hint — the empty state
  teaches the loop.

### UI text is handwritten

All user-facing copy lives in **`radio/strings.js`** — one flat object the
rest of the code imports from; no string literals in components. Aditya
handwrites every entry; anything Claude scaffolds there carries a `[ph]`
prefix until replaced and must not ship. Handwritten so far (2026-07-13):
the four toolbar pills — **{n} Listeners · Invite · Music Source ·
Disconnect**. Still `[ph]`: tune-in placeholder · Your-stations group
label · peek/join line · create-confirm line + button · join-refused
line · Music-Source popover copy · empty-queue hint + "Up next" label ·
catalog-gap / preview-silence note · added-by / history labels ·
copy-link toast · disconnected/reconnecting line. (The countdown needs no
copy — bare digits, and at zero the album cover filling in is the go
signal. Decided.)

### The blank cover is a hand-drawn sprite

Any track without artwork (and the idle hero) shows
**`assets/sprites/radio/cover-blank.svg`** — currently a Claude-scaffolded
vinyl line-art placeholder that Aditya hand-draws over. Keep the filename
and path (radio.js and the `.radio-cover-blank` rule point at it);
neutral-on-transparent so it sits on every theme.

**In-room**, desktop — three columns under a persistent transport strip:

```
┌─────────────────────────────────────────────────────────┐
│  Now Playing strip: art (countdown overlay) · title /    │
│  artist · progress bar · back / play-pause / skip        │
├──────────────────┬──────────────────┬────────────────────┤
│  SEARCH          │  QUEUE           │  HISTORY           │
│  debounced bar;  │  now-playing     │  hero: last heard  │
│  click a song =  │  hero + "Up      │  "Previously" list │
│  Play Now; menus │  next" rows      │  newest first,     │
│  + recents chips │  (added-by,      │  repeats real,     │
│                  │  drag, menus)    │  re-add via menu   │
└──────────────────┴──────────────────┴────────────────────┘

Column order is Search → Queue → History (search leftmost — finding music
is the room's front door). The Queue card mirrors DeetsMusic's qcard
anatomy exactly: a `.qnow`-style now-playing hero chip on top, then an
"Up next" label over the rows; the History card tops with the same hero
(last heard). Toolbar pills: Listeners (names popover) · Invite
(copy link) · Music Source (provider connect) · Disconnect.
```

**Mobile** (≤ 41rem, the site's existing breakpoint): transport strip stays
pinned; the three columns collapse into the mobile-nav tab pattern
(Queue | Search | History), one visible at a time. **Mobile is tabled
(2026-07-13)** beyond that existing collapse: queue/history row menus are
right-click only (the ⋯ kebabs were removed — rows stay narrow), which has
no touch path on iOS. Long-press handlers / mobile-native behaviors are a
later, deliberate pass.

The progress bar is **display-only, permanently** — it shows room position
over canonical duration; the protocol has no seek command. (Decided:
recorded here so nobody "adds" it.)

## UX ports from DeetsMusic

Port the **anatomy, not the pixels**: DeetsMusic has its own parallel
token system; every component here is re-expressed in this site's
`themes.css` roles + `skin.css` tokens and must survive all 30 combos.

| Piece | Source (`../DeetsMusic/src/`) | What we take |
|---|---|---|
| Queue rows | `qcard.ts`, `queue-rows.ts` | row anatomy (idx · art · title/artist), bounded render + "+N more", drag-to-reorder with deferred re-render during drag, click-to-jump ⇒ becomes click-to-vote-skip? No — v1: click does nothing, actions live in the menu |
| Now-playing hero | `qcard.ts` (`.qnow`), `history-card.ts` | hero block: 96px art, title/artist stack, `--idle` / `--loading` states — plus a new `--counting` state: bare digits 3 · 2 · 1 hold the hero art's place, and at zero the album cover fills in as music starts — the art reveal IS the go signal (decided; no glyph, no word at zero) |
| Transport strip | `now-playing-card.ts` (`.np`) | cover · meta · progress · prev/play/next layout, inline SVG icon set, disabled-state handling (the scrubber becomes a non-interactive progress fill) |
| Search card | `search-card.ts` | always-on debounced bar (300 ms), recents-as-empty-state (`localStorage`, cap 8), and the queueing idiom one-to-one: **click a song = Play Now**, menu = Play Now / Play Next / Add to Queue (Play Now in a room = front-queue + skip; a plain add when the room is idle). History rows carry the same three-item menu. Sectioned results as **horizontal scrollers** on the site's thin themed scrollbar (Artists · Songs two rows deep · Albums · Playlists — DeetsMusic's `.search__scroller` anatomy) with a **pane stack**: artist → Albums scroller + Top Songs, album/playlist → its tracks, ‹ back pops (fills memoized). The category filter and go-to-artist menu items are not ported. |
| Context menu | `context-menu.ts` | right-click menu kit: Play Next / Move to Top / Move to Bottom / Remove on queue rows; Add to Queue / Play Next on search + history rows |
| History log | `history-card.ts` | hero + "Previously" list, newest first, append-only with real repeats |
| Empty art | shared | `♪` placeholder block idiom |

Explicitly **not** ported: library/playlists/rewind/radio-stations cards,
album-color aurora, the card/layout-bus engine (three fixed columns don't
need a card registry), anything Rust.

Site-side ports (from this repo, not DeetsMusic): the League tab's
combobox — `.tb-ctrl` input + `.tb-pop` popover with grouped `optButton`
entries — becomes the station field, and the `.sotd-toolbar` pill slot
holds the room controls. Per the site's deliberate-duplication convention
(`sotd.js` / `movies.js` / `league.js` each carry their own copy of the
toolbar/popover kit), `radio.js` carries its own too — a fix to that
machinery must be mirrored across all four.

## Build order (UI first)

The page talks to the room through a **transport interface** (connect, send,
onMessage); the protocol above is the contract. Two implementations: the
real WebSocket client, and `radio/transport-mock.js` — an in-page fake room
that speaks the protocol *verbatim* (snapshot, versioned `state` broadcasts,
`presence`), runs the transport rules locally, and can simulate a phantom
second listener so multi-user UI states are stylable without a server. The
mock stays in the repo as a dev tool (query-flag selected), not a throwaway.

1. ✅ **Shell + columns on mock** (built 2026-07-13) — bar combobox +
   gate/creation flow, three columns, transport strip with countdown,
   context menus, drag-reorder, mobile tab collapse, `#code` deep links.
   The mock persists rooms in `localStorage` (durable-room feel across
   reloads), fakes ~150 ms latency, and simulates a phantom listener
   ("Mockingbird") who joins and queues a song — `RadioTransport.phantom
   = false` disables, `RadioTransport.wipe()` resets all mock rooms.
2. ✅ **Real MusicKit** (built 2026-07-13) — `radio/apple.js`: real catalog
   search (REST + the dev token; falls back to the mock catalog while the
   token stub is unsigned), `authorize()` / `unauthorize()` behind the
   Music Source pill, and the playback follower — MusicKit full tracks
   when connected, the 30 s preview `<audio>` otherwise, drift-corrected
   against the room clock at the §Sync-details thresholds. Entries with
   no playable asset sit silent with a note; mock-catalog entries stay
   silent without one. A genuinely working *solo* DeetsRadio.
3. ✅ **Worker + DO** (built 2026-07-13) — the sibling
   [DeetsRadio](../../DeetsRadio) repo: one plain-JS ES-module worker,
   `RadioRoom` DO per room (SQLite-backed, free tier). Hibernatable
   WebSockets (`ping`/`pong` auto-answered without waking the object),
   storage-alarm track advancement (an empty durable room keeps playing;
   a slept-through backlog of short tracks catches itself up one alarm at
   a time), `GET /room/{code}/peek`, and the join/create refusal that
   makes ghost rooms impossible. The DO ports the mock's `COMMANDS`
   verbatim and never trusts a client blob — `sanitizeEntry()` rebuilds
   every add (field whitelist, length caps, https-only URLs, 1 s–2 h
   duration), queue capped at 200, messages at 16 KB. Write-lean by
   design: one batched `storage.put` per mutation, presence broadcasts
   persist nothing, history rides DO SQLite rows (500 would outgrow the
   128 KB per-value cap). Client side, `radio/transport.js` owns
   reconnect (backoff + rejoin with `create:false`, surfaced as
   `conn.onStatus("down"|"up")` → the disconnected/reconnected meta
   copy) and `v`-gap detection (a skipped state version forces a
   reconnect; the fresh snapshot repairs the model). Still owed: the
   sync-feel pass (drift thresholds, command-latency cover-up timing)
   tuned against real network latency — don't tune it on the mock.

Caveat, on purpose: **don't polish sync feel against the mock** — it's
zero-latency and will make cover-up timings feel wrong. That pass belongs
in step 3.

## Sync details

- **Clock offset**: every broadcast carries `serverNow`; client keeps a
  rolling offset estimate. Expected position =
  `serverNow_est − startedAt` (or `pausedPosition`).
- **Drift correction**: if `|localPosition − expected| > 1.75 s`, seek. Rate-
  limit corrections (≥ 5 s apart) to avoid seek-thrash on slow networks.
- **Track start**: scheduled (`startsAt` in the future) — clients preload
  during the lead and start together at the boundary; the 3-2-1 renders off
  the room clock. Late joiners get no countdown: they land mid-song and
  seek to expected position like any drift correction. Seamless track-end
  rolls preload against the known alarm boundary.
- **Command latency**: hides inside the first countdown beat — a pressed
  skip shows its countdown when the broadcast lands (~100–300 ms), well
  inside the lead. No optimistic-echo hack needed; pause is the only
  instant-feeling command and its broadcast is fast enough alone.
- **Duration mismatch** (same ISRC, different masters): room advances on
  canonical (max) duration; each client clamps seeks to its own asset length;
  worst case a couple seconds of end-of-track silence.

## Auto-continue (designed, deferred)

A room setting (default **off**), built in v1.x. When the queue would
exhaust, the room appends tracks itself — as ordinary resolved Entries with
`addedBy: "DeetsRadio"` — so everything downstream (clock, sync, history,
Spotify listeners) is untouched. Auto-continue is purely a queue *producer*.

- **Never uses provider station/autoplay features.** MusicKit stations own
  their queue client-side and can't sync (DeetsMusic's radio card is the
  cautionary tale); Spotify's `/recommendations` endpoint is dead for new
  development-mode apps (late 2024). So the **Apple catalog is the sole
  recommendation source**, Worker-side, developer token only.
- **Pick flow**: seed from the last few history entries → Apple
  similar-artists → top songs → filter tracks played recently in this room →
  candidate → the same `/resolve` pipeline as a human add (ISRC → Spotify
  ID, badge, dual durations).
- **`requireBothCatalogs` interplay**: a human add gets rejected when
  unmatched; an auto-pick is silently discarded and the next candidate tried.
  Auto-continue never surfaces a catalog gap unless the room allows them.
- **Suspends while the room is empty.** The manual queue still plays out to
  an empty room (durable-room charm), but the room won't self-refill with
  nobody listening — no abandoned station crawling the API forever. Refill
  resumes on the next join.
- **Top-up policy**: keep ~2 auto entries queued ahead (append when
  `queue.length < 2` at track-advance time), so listeners can see and — by
  removing/reordering — veto what's coming.

## Limits & costs

- **Spotify dev mode**: ~25 allow-listed users; extended quota realistically
  unavailable to hobby apps. Accepted.
- **Apple**: requires active Apple Developer Program membership ($99/yr —
  already held for DeetsMusic) for the MusicKit key.
- **Cloudflare free tier**: SQLite-backed DOs + hibernating WebSockets +
  alarms are all included; hobby-scale rooms are effectively free.
- **CDN exception**: MusicKit JS and Spotify SDK load from their vendors'
  CDNs on this page only — a documented carve-out from the site's no-CDN
  rule (both are DRM-touching first-party SDKs; self-hosting is neither
  possible nor licensed).

## Open questions (deferred, not blockers)

- **Room directory / discovery**: would need D1 + a public flag. Not v1.
- **Kick/ban or room reset**: communal trust model punts on this; a room
  gone wrong can be abandoned for a new code.

Settled and recorded above so nobody "fixes" them later: no seek (display-
only progress bar), volume is always local-only, queue exhaustion idles in
v0.9 with auto-continue as a designed v1.x setting.
