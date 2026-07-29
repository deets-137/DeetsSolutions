# Deets accounts — sign in with Google

A profile that follows you across the site: a display name and a seat
colour that the game tables pick up automatically, instead of retyping
them at every gate.

Phase 1 was **auth only**; the profile page (`/profile/`, "The profile
page" below) is the first thing built on top of it. Still true either
way: **no game worker changes** — `games/table-do.js` and both vendored
copies are untouched, so signing in cannot break a live table.

---

## What we store

Nothing that identifies a person.

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,      -- ours (uuid), never Google's
  google_sub    TEXT UNIQUE NOT NULL,  -- opaque, per-app, meaningless elsewhere
  display_name  TEXT,
  seat_color    INTEGER,               -- "#rrggbb", the colors.js contract (see below)
  token_epoch   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
```

**No email.** We request `openid profile` only — the `email` scope is
never asked for, so Google never sends it and there is nothing to
discard. The consent screen reads "see your name and profile picture"
rather than naming an address.

Three choices worth keeping:

- **`id` is ours, `google_sub` is a column.** Adding a second sign-in
  method later is a new `identities` table, not a migration of
  everything holding a user id.
- **`display_name` is seeded from Google's `given_name` once, on first
  sign-in, and never overwritten.** Rename yourself and it stays
  renamed. This is what makes it an account rather than a mirror of a
  Google profile.
- **`seat_color` is a preference, not a claim.** The gate offers it
  first if it's free at that table; the existing clash UI handles the
  rest. On the wire it is a `"#rrggbb"` hex validated by the vendored
  `colors.js` — the exact grammar a lobby seat speaks, so any color you
  can Become at a table you can be by default. (Phase 1 stored a preset
  *index* 0..5; the worker maps surviving integer rows through the
  presets on read, and they become hexes on the next save. SQLite
  affinity keeps both shapes in the one column — no migration.)

`token_epoch` exists so a session can be invalidated everywhere without
a sessions table — `/me` reads the user row anyway, so checking it is
free.

---

## The worker

`DeetsAccounts` → `id.deets.solutions`, one D1 database, no Durable
Objects. Sibling repo, deployed with `npx wrangler deploy`, exactly like
[league](league.md) and [radio](radio.md).

| Route | Does |
|---|---|
| `GET /login?return=` | 302 to Google, PKCE challenge |
| `GET /cb` | exchange code, upsert user, set cookie, 302 to `auth/done.html` |
| `GET /me` | `{id, name, color}` or 401 |
| `PATCH /me` | update `name` / `color` |
| `POST /logout` | clear the cookie |
| `POST /ingest` | a finished game from a game worker — see [stats.md](stats.md) |
| `GET /me/stats` | aggregates + match history for the signed-in user |
| `GET /me/export` | the same rows as CSV or JSON |

The bottom three are phase 2. `/ingest` is the only write path that isn't a
signed-in user acting on themselves, so it carries its own shared secret
(`INGEST_SECRET`) and is **closed** when that secret is unset. `/me` stays
`{id, name, color}` — the stats live one route over so every page's sign-in
check doesn't pay for them.

`node scripts/check.mjs` in the worker repo runs the whole results pipeline
against an in-memory SQLite, no wrangler and no deploy.

### PKCE without storage

Before redirecting, `/login` sets a short-lived `__Host-ds_pkce` cookie
holding the code verifier and a nonce, and puts the return URL in a
signed `state`. `/cb` verifies the state signature, matches the nonce
against the cookie, and checks the return URL resolves to an allowed
origin — an **open-redirect guard**, since `return` is attacker-supplied
in the general case.

No KV, no cleanup alarm, no eventual-consistency window. The cookie is
the storage and it expires itself.

### The session cookie

`ds_sess` on `.deets.solutions` — `HttpOnly`, `Secure`, `SameSite=Lax`,
30 days. The value is `base64url(payload).base64url(HMAC-SHA256)` signed
with `SESSION_SECRET`. Payload is `{u, e, iat}` — user id, token epoch,
issued-at. Nothing secret rides in it; the signature is what matters.

`SameSite=Lax` rather than `Strict` because the sign-in flow **returns
from a cross-site redirect** and a Strict cookie would not be sent on
that navigation.

### CORS

The site and the worker are different origins, so `/me` and `PATCH /me`
need `credentials: "include"` on the browser side and, on the worker
side, an **exact** `Access-Control-Allow-Origin` echo plus
`Access-Control-Allow-Credentials: true`. Wildcard origins are illegal
with credentials — the browser rejects the response.

---

## The new-tab flow

Sign-in opens a **new tab**, which is not a cosmetic choice: it means
the original tab is never navigated away from, so **a live game socket
survives sign-in**. The alternative — a full-page redirect out of a
table and back — would force a reconnect on the way home.

```
[games dropdown] --click--> window.open('id.deets.solutions/login?return=…')
                                        |
                              Google consent screen
                                        |
                              id.deets.solutions/cb
                                (sets ds_sess cookie)
                                        |
                          deets.solutions/auth/done.html
                                        |
                    BroadcastChannel('deets-account') ──> original tab
                                        |                 re-fetches /me
                      location.replace('/profile/')       flips to ✓
```

Four things this depends on:

- **`window.open()` fires directly in the click handler.** No `await`
  before it, or the popup blocker eats it. If it's blocked anyway
  (`open()` returns null) we fall back to a toast with a clickable link.
- **`auth/done.html` is a site page, not worker-returned HTML.** Copy
  stays on the site and the page themes like everything else. On
  success it broadcasts, then **becomes the profile page** via
  `location.replace` (so Back skips the blink); the error hashes
  (`denied`, `expired`, …) still render right there, readable. The
  original tab is untouched either way — that's the broadcast's job.
- **`BroadcastChannel`, with a `localStorage` write as fallback.** The
  site already syncs theme/skin across tabs via `storage` events, so
  this is an established pattern here.
- **Not `window.opener.postMessage`** — that needs `rel=noopener`
  dropped, which hands the OAuth tab a handle on the page. Broadcast
  gets the same result without it.

`window.close()` works because the tab was script-opened.

---

## The site

`js/account.js` — shared chrome, one copy on every page, alongside
`controls.js` and `toast.js`.

It calls `/me` once with `credentials: "include"`, painting immediately
from a `localStorage` cache and revalidating behind it, so navigating
between pages doesn't flash a signed-out state on every load.

### The button

Injected at runtime into the **Games** `.nav-group__menu`. It is *not*
hardcoded into markup, because the nav is duplicated in every page's
HTML and a static button would need adding to all of them and keeping in
sync forever. `controls.js` already establishes runtime nav injection.

Anatomy is [DeetsRadio's account button](radio.md) — a label plus a
status icon where **the icon is the status**: ✓ in, ✕ out, spinner
working, `aria-pressed` carrying it for screen readers.

Signed out, clicking it starts sign-in. Signed in, the label is your
name and clicking it **goes to your profile** — sign-out lives on the
profile page now, not on this button. One care on the way there: if the
page has a **live table socket** (`DeetsTable.joined()` — lobby or game
in progress), same-tab navigation would tear it down, so the profile
opens in a new tab instead. Same instinct as sign-in's new tab.

**The mobile menu needs its own append.** `buildNavMenu()` clones
`a[data-nav-core]` — a `<button>` won't come along, so without this the
control silently vanishes below the 56rem breakpoint.

### Gate prefill

The one touch to game code, and it's additive: `table.js` reads a stored
name at `NAME_KEY` already, so the account name becomes its fallback and
`seat_color` seeds the colour picker. **Guests are unaffected** — every
existing path still works, signed out.

The radio gate speaks the same contract (`radio/radio.js`): the profile
name is the fallback, a name typed at the gate is radio's name and wins,
and `NAME_KEY` is only written when the field was actually typed into —
so a profile rename keeps reaching every gate instead of being shadowed
by a stamped copy. Signed in, existing stations join instantly under the
profile name.

In a game lobby, your own seat name is click-to-edit (the bot editor's
row, `rename` verb — [games.md](games.md)). Typing there saves the
game's local name; the **Reset** button (signed in only) puts the
profile name back on the seat *and clears the local override*, re-opening
the profile pipe.

This matters more than it looks. These are party games joined from a
texted link; putting sign-in in front of the gate would add friction at
exactly the moment it costs you a player. Signing in is an affordance in
the site chrome, never a step in joining.

---

## The profile page

`/profile/` — the account's home, and where sign-in lands. League's
page anatomy: the `.sotd__bar` carries your display name where League's
carries the Riot ID, a toolbar holds Sign out, and a **bento grid** of
boxes sits underneath. Not in any nav menu — your name in the Games
dropdown is the way in. `profile/profile.js` paints everything from
`DeetsAccount` state; signed out, the grid is a single sign-in
invitation, and nothing 404s.

One box so far — **Appearance**: display name (the one thing a lobby
won't let you edit) and the account color. The color picker mirrors the
lobby seat picker's anatomy — six preset swatches, a seventh custom
slot, an exact-hex "Become..." row validated by the same `colors.js` —
minus the clash checks, because a profile has no other seats. Both
fields write through `DeetsAccount.update()` → `PATCH /me`, so every
open tab's chrome picks the change up.

Copy on the page is **inline** — the accounts-chrome precedent
(`account.js`, `auth/done.html`), not the games' `[ph]` strings.js
convention. The grid is deliberately roomy: stats boxes (phase 2),
default table settings, and deeper customization each land as a new
box, not a redesign.

---

## Local dev

The session cookie is scoped to `.deets.solutions` and is invisible to
`localhost:8787`, and Google only redirects to registered URIs. So local
sign-in cannot work against prod.

`?mock` gives a fake signed-in account entirely in the browser — same
opt-out convention as the game transports. Without it, iterating on the
button means deploying, which is untenable.

**The mock does not exercise the OAuth flow.** Like the game mocks and
their disconnect handling, the real handshake can only be tested
against the deployed worker.

---

## Google Cloud

Project `lucid-diode-502505-j8` ("DeetsSolutions"). Consent screen:
**External**, published to production, scopes `openid profile` only.

**No logo, deliberately.** A custom logo triggers Google's brand
verification — a review queue — and re-uploading re-triggers it. With
only non-sensitive scopes and no logo, publishing is immediate and
anyone with a Google account can sign in with no test-user list to
maintain. The logo can be added later, behind verification, if it's
ever worth the wait.

Publishing needs an **authorized domain**, which Google only accepts
once `deets.solutions` is verified in Search Console, and a **privacy
policy URL** (`/privacy/`).

Billing is not required — OAuth with non-sensitive scopes is free.

Two non-issues worth recording so they aren't rediscovered:

- **Test-mode refresh tokens expire after 7 days.** Irrelevant here: we
  do one code exchange and issue our own session. No Google refresh
  token is ever stored.
- **There is no API for creating a consumer OAuth client.** The IAP
  OAuth Admin APIs that came closest were shut down 2026-03-19. The
  console step is genuinely manual, once.

---

## Beyond phase 1

**Built (2026-07-27): seats carry the account uid.** Not via an `auth`
field on `join` as first sketched — the `ds_sess` cookie is scoped to
`.deets.solutions`, so it already rides the WebSocket upgrade to every
game worker; the DO verifies its HMAC against the shared
`SESSION_SECRET` and tags the seat. Cross-device seat reclaim falls out
of that ([games.md](games.md), "Identity and rejoin" — dark seats only,
kick severs, uid never broadcast).

**Built, not yet deployed (2026-07-28) — results and stats.** Finished
tables POST themselves over a service binding under an idempotency key of
`game:tableId:rematchIndex`, and D1 grew six tables for the outcome, the
occupancy and the event stream. The verified per-seat uid the reclaim work
added is exactly the hook they hang on.

Two things the design pass changed from the sketch above. A table where a
seat changed hands is **not** flagged unrated — `unrated` is a verdict, and
a verdict baked into a row is one you can't revise; the spans ledger records
the occupancy as fact and lets any read-time policy decide. And the uid
turned out to be **deleted from a seat on every departure path**, so
attribution had to be recorded as it happened rather than read at game over.

**See [stats.md](stats.md)** for the standings model, the schema, what each
engine counts, and the three deploys still owed.
