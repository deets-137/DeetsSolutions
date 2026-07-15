# DeetsRadio — Spotify (SHELVED 2026-07-14; kept as reference)

**Shelved (2026-07-14, same day it was written):** Aditya chose the
**YouTube route** for the free full-track tier instead — no per-listener
setup, no Premium requirement, mainstream catalog coverage. Spotify gets
wired in later only if still needed. Everything below stays valid as the
design of record for that day (the BYO/PKCE architecture, the `resolve`
protocol verb — which the YouTube route reuses verbatim with a
`youtube: {videoId, durationMs}` block — and the invariants). Nothing
Spotify-specific should be built until this banner comes off.

**Status (2026-07-14):** design only, written after a rethink of
[radio.md](radio.md)'s original v1.0 plan. Spotify's **February 2026
platform changes** invalidated the "site app + worker secret" shape this
doc's predecessor assumed; the redesign below is *fully BYO* — zero
app-side Spotify credentials. Aditya is thinking it out further and wants
a live test with one friend before any of it is built. Nothing here is
implemented; `Entry.spotify` is still always `null`.

## The February 2026 platform reality

Spotify's dev-mode rules changed 2026-02-11 (existing apps migrated
2026-03-09; ours never existed, so we're fully on the new rules):

- **5 users per app** (down from 25), **1 Client ID per developer**, and
  the app **owner must hold an active Spotify Premium subscription**.
- Endpoint diet: batch `GET /tracks` removed (fetch individually),
  `/artists/{id}/top-tracks` and `/browse/*` removed, **search `limit`
  capped at 10**. Track previews stayed dead (gone for new apps since
  late 2024 — the design already leans on Apple's preview assets).
- Auth flows unchanged: **PKCE**, client credentials, and the **Web
  Playback SDK** all still work in dev mode. The SDK still requires the
  *listener* to be Premium.

Sources: Spotify's 2026-02-06 developer blog post ("Update on Developer
Access and Platform Security") and the February 2026 Web API migration
guide on developer.spotify.com.

## The decision: fully BYO, zero credentials on our side

The original plan (radio.md "Versioning" + the resolve endpoint) put a
client-credentials **secret in the worker** for ISRC resolution and a
**site Client ID** for listener auth. Both die here, for one killer
reason each:

- The site app's owner must be Premium — Aditya is an Apple Music user
  and would be paying for Spotify Premium purely to own a resolver
  credential.
- The 5-user cap makes a site-owned allowlist a dead end anyway.

Instead, observe who *consumes* `spotify` IDs: only Spotify-connected
listeners — each of whom is holding a perfectly good access token of
their own. So the resolve job moves client-side and the whole app-side
credential surface evaporates.

**Invariants (record these; they're the design):**

1. **No app-side Spotify credential exists.** No worker secret, no site
   Client ID, no dashboard app owned by Aditya, no allowlist.
2. **No listener secret ever.** PKCE is built for public clients: the
   Client ID (public by design) is the only thing a listener pastes.
   Their app's secret sits unused in their own dashboard, forever.
3. **The worker never learns Spotify exists** — except as an opaque
   `spotify: {id, durationMs}` block it sanitizes like any client blob.
   Listener tokens live in the listener's `localStorage` and talk only
   to Spotify's own endpoints; they never ride our wire.

### What this supersedes in radio.md (edit when built)

- "Versioning → v1.0": PKCE stays, but no worker config flag, no
  client-credentials secret, no `POST /resolve` endpoint — resolve is a
  **protocol verb**, below.
- "Architecture" diagram: the resolve endpoint line goes away.
- "Entry": `match` gains no new values, but the *canonical duration
  freeze* rule below is new.
- "Decisions": the "~25 named users" bullet is dead; replace with BYO.
- "Providers" table, Spotify column: auth = "OAuth PKCE against a
  per-listener BYO Client ID"; dev-side key = "none".
- The principle "clients never do cross-catalog work" **inverts** — it
  existed because the worker held the secrets; now the only tokens in
  existence are client-side, so client-side resolve is the natural home,
  not a compromise.
- The deferred Apple-token proxy hardening (radio.md "The developer
  token") loses its "ride the Spotify secret work" excuse — the worker
  gains no catalog machinery at all now. That hardening stands alone
  whenever it happens.

### What gets demoted

- **`requireBothCatalogs` → dormant.** Add-time enforcement needed a
  server that could check both catalogs. The settings field stays in the
  room schema (it's already there) but no UI grows for it in v1.0; the
  catalog-gap NP note + the gap collector (`POST /gaps`) remain the
  pressure valve. Revisit in v1.x if gaps actually annoy anyone.
- **Search stays Apple-only.** Catalog search runs on the Apple developer
  token (no listener login involved), so Spotify listeners search fine
  today; their picks resolve to Spotify IDs at add time via their own
  token. One search card, one pane stack, one artwork pipeline. The cost
  — an Apple-catalog gap is unsearchable even when Spotify has the track
  — is accepted and measured by the gap collector.

## Auth: PKCE in a popup

- **Flow**: Authorization Code + PKCE. Client ID only, no secret, both
  for the initial grant and every refresh. Refresh tokens **rotate**
  under PKCE — persist the new one on every refresh or the session dies
  in an hour.
- **Popup, not redirect** (recommended; confirm before building): a
  full-page redirect kills the room — socket drops, MusicKit unloads,
  return lands autoplay-blocked. Instead `connect()` opens a popup to
  Spotify's authorize URL; the registered redirect URI is a tiny static
  callback page (**new file: `radio/spotify-callback.html`**) that
  `postMessage`s the `code` back to the opener and closes itself. The
  room never blinks — matches the Apple `authorize()` feel.
- **Redirect URIs each listener registers in their own app** (exact
  strings, rendered with a copy button in the connect panel):
  - `https://deets.solutions/radio/spotify-callback.html`
  - `http://127.0.0.1:8787/radio/spotify-callback.html` (dev; Spotify
    requires the loopback **IP literal** — `localhost` is refused —
    though HTTP is allowed on loopback)
- **Scopes**: `streaming user-read-email user-read-private` (the SDK's
  documented trio) + `user-modify-playback-state` (the Web API start
  call) + `user-read-playback-state`.
- **localStorage** (beside `deets-radio-name` / `deets-radio-token`):
  - `deets-radio-spotify-client` — the pasted Client ID
  - `deets-radio-spotify-auth` — `{refreshToken, accessToken, expiresAt}`
- **No default Client ID.** There is no site app, so the field is empty
  until the listener pastes one — their own, or a friend's shared one
  (a ≤5 crew can socially share one member's app; the code can't tell
  and doesn't care). A v1.1 nicety kept in the back pocket: an owner-set
  `spotifyClientId` in room settings that *prefills* the field for that
  room (Client IDs are public; broadcasting one is fine). Sugar, not
  structure — not v1.0.

## Resolve: a protocol verb, not an endpoint

**New client→room message, mirrored verbatim across `radio/transport.js`,
`radio/transport-mock.js` (no-op or echo), and `../DeetsRadio`
`src/index.js` — the three-way contract rule applies.**

| msg | payload | effect |
|---|---|---|
| `resolve` | `{entryId, spotify: {id, durationMs}, match: "isrc"\|"fuzzy"}` | backfills the `spotify` block on a current/queue/history entry that has none — needs the **queue** capability |

Worker rules (all in the DO's command `switch`,
`../DeetsRadio/src/index.js` ~224, beside `case "add"`):

- Sanitize like everything else: `id` string ≤64, duration bounds as in
  `sanitizeEntry()` (src/index.js:66) — and **delete the
  `spotify: null` hardcode at src/index.js:86** so `add` accepts a
  sanitized `spotify` block too (a Spotify-connected adder fills it
  before sending).
- Only fills a **missing** block — never overwrites an existing one
  (first resolver wins; keeps a griefer from flipping IDs on live
  entries).
- Gated on the **queue** capability (src/index.js ~559's `capsFor`
  check) — proportionate to the trust model; a restricted listener can't
  poison entries.
- **Canonical `durationMs` is frozen at add time.** radio.md says
  "canonical = max(provider durations)", but rewriting duration after the
  alarm is scheduled would move a live track's end. Resolve never touches
  `durationMs`; a longer Spotify master just clamps to its own asset
  (the existing duration-mismatch rule already covers the worst case:
  a couple seconds of end-of-track silence, or the tail cut off).
- Broadcasts as an ordinary `state` delta (the changed entry's section).

**Client policy** (in the new `radio/spotify.js`): on connect/join,
resolve the **current entry + next 2 queue entries** immediately, then
the rest of the queue opportunistically (one at a time, idle-paced);
history only on demand (re-add). Every lookup uses the listener's own
token: `GET /v1/search?q=isrc:<ISRC>&type=track` (limit 10 is plenty),
fuzzy fallback = title + artist search with runtime match ±2 s. Entries
with no ISRC and no fuzzy hit stay `spotify: null` — the gap note plays
its usual role. Coverage is opportunistic by construction (backfill only
happens while a Spotify listener is connected) — which is exactly when a
`spotify` block has any value, so this is self-correcting.

## Playback: `radio/spotify.js`, a sibling of apple.js

Same contract `radio.js` already speaks (see
[radio/apple.js](../radio/apple.js) — `window.RadioApple`), exposed as
`window.RadioSpotify`:

- `connect()` / `disconnect()` / `authorized()` / `onAuthChange(cb)` —
  what the Music Source popover calls (radio.js ~691–757,
  `fillConnectPop` + the `A.connect()` handler at ~724).
- `follow(view)` / `note()` / `stop()` — the follower interface fed from
  `tick()` (radio.js:1054–1076; today it feeds `A.follow` only — see
  the mux below).
- Engine internals:
  - Web Playback SDK creates one device; **starting a track is a Web API
    call** — `PUT /me/player/play?device_id=…` with
    `{uris: ["spotify:track:<id>"], position_ms}`. Laggier than
    MusicKit's local start; the 3.5 s countdown lead was sized to absorb
    exactly this. Seamless track-end rolls will land a few hundred ms
    soft before drift correction settles — accepted; Apple stays the
    gold-standard listener.
  - Pause/resume/seek are SDK-local (`player.pause()` etc.); drift
    correction seeks at the same thresholds apple.js uses (`DRIFT_MS`
    1750 / `CORRECTION_GAP_MS` 5000, apple.js:20–21) — keep the
    constants shared or mirrored.
  - **Port the wedge-proofing wholesale** (apple.js `followFull`, :231):
    silence/hold check first on every tick, timestamped in-flight
    latches that expire, no overlapping start calls, a load-sequence
    counter. The SDK's failure modes differ from MusicKit's but the
    armor is the same shape.
  - Token refresh happens inside the engine (rotating refresh token,
    persisted each time); a dead refresh token = quiet fall back to
    preview tier + the connect pill shows signed-out.
- **The follower mux** (radio.js `tick()`, :1054): today `A.follow(view)`
  is unconditional. v1.0 rule: **exactly one engine follows** — Spotify
  when `RadioSpotify.authorized()`, else Apple (whose own internal
  fallback to the preview `<audio>` already handles the
  Apple-signed-out case). The preview tier stays Apple's — Spotify has
  no preview assets. `note()` merges the same way (the followed engine's
  note wins). A listener signed into *both* is Spotify-first only
  because a rule must exist; revisit if anyone real ever does it.
- **`playable()` / gap logic** (apple.js:213 has the Apple version):
  Spotify edition keys on `entry.spotify` — a missing block after the
  resolve pass = the catalog-gap note, same one mechanism.
- **SDK script tag** in `radio/index.html` beside MusicKit's — the
  documented CDN exception (radio.md "Limits & costs") already names
  both vendors. Load it lazily on first connect if easy; it's dead
  weight for Apple/preview listeners.

## The joining-friend flow (why the friction is acceptable)

1. Friend taps `radio/#code` → peek → name (first visit only) → **in,
   hearing the room** on 30 s Apple previews. No login, no wall.
2. Music Source → Spotify. First time ever: the connect panel's BYO
   walkthrough — dashboard, create app (needs their Premium, which the
   SDK requires anyway), paste our redirect URI (copy button), paste
   their Client ID back. **3–5 min, once ever per person.** Then the
   PKCE popup → approve → full tracks. The room played previews under
   them the whole time.
3. Every later visit: link → auto-join → silent token refresh → full
   tracks. Zero friction beyond the same one autoplay tap Apple
   listeners need.

Runtime seams they'll live with: softer track-boundary starts, catalog
gaps sit silent with the NP note, non-Premium Spotify users stay preview
listeners forever (the SDK excludes them regardless of any key scheme —
previews are the universal floor, not a locked door).

## Codepath map

| Path | Change |
|---|---|
| `radio/spotify.js` | **new** — PKCE + token refresh, SDK device, follower engine, resolve policy (everything above) |
| `radio/spotify-callback.html` | **new** — static popup landing: `postMessage` the code to opener, close |
| [radio/radio.js](../radio/radio.js) | follower mux in `tick()` (:1054–1076); Music Source popover grows the Spotify block — Client ID field + BYO walkthrough (`fillConnectPop`, ~691); add path fills `spotify` when the adder is connected (search commit, ~1589) |
| [radio/apple.js](../radio/apple.js) | untouched except any shared-constant extraction (`DRIFT_MS` etc.) |
| [radio/strings.js](../radio/strings.js) | new `[ph]` entries: Spotify connect blurb, BYO walkthrough steps, Client ID field label, premium-required line, resolve/gap stays as-is. **Aditya writes all of it**; `[ph]` until then |
| [radio/transport.js](../radio/transport.js) | `resolve` verb (thin — it's just `send`) |
| [radio/transport-mock.js](../radio/transport-mock.js) | `resolve` mirrored (mock accepts + broadcasts it) |
| `../DeetsRadio/src/index.js` | `case "resolve"` beside `add` (~224); `sanitizeEntry` accepts a sanitized `spotify` block (drop the `null` hardcode, :86); queue-cap gate (~559) |
| `radio/index.html` | SDK script tag (CDN exception) |
| [docs/radio.md](radio.md) | the "supersedes" list above, applied when built |

No worker secrets, no Wrangler config, no new endpoints, no storage
migration (the `spotify` slot has been in every entry since v0.9).

## Open questions (Aditya's, before building)

- **Popup PKCE**: confirmed comfortable? (The alternative — full
  redirect — survives via the `#code` deep link but lands
  autoplay-blocked and drops/rejoins the socket.)
- **Mid-song handover**: when the popup closes mid-track, does full
  playback take over immediately (seek the SDK to expected position) or
  at the next track boundary? Immediate is nicer and the drift machinery
  makes it nearly free — but decide, don't drift into it.
- **Sync-feel pass first**: radio.md still owes drift/cover-up tuning
  against real network latency. Spotify's laggier Web-API starts lean on
  those thresholds *harder* than MusicKit — do that pass before or with
  this build, not after.
- **First live test** (the friend): friend needs Premium + their own
  dashboard app. Checklist: BYO walkthrough friction (time it), popup
  flow on their browser, countdown start together, drift over ~10 min,
  a catalog-gap entry, a track-end seamless roll, kill/restore their
  network (reconnect + token refresh), and their adds resolving both
  ways.
