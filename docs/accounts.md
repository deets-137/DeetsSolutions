# Deets accounts — sign in with Google

A profile that follows you across the site: a display name and a seat
colour that the game tables pick up automatically, instead of retyping
them at every gate.

Phase 1 — this document — is **auth only**. No results, no stats, no
profile page. The deliberate consequence is that **no game worker
changes**: `games/table.js`, `games/table-do.js` and both vendored
copies are untouched, so signing in cannot break a live table.

---

## What we store

Nothing that identifies a person.

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,      -- ours (uuid), never Google's
  google_sub    TEXT UNIQUE NOT NULL,  -- opaque, per-app, meaningless elsewhere
  display_name  TEXT,
  seat_color    INTEGER,               -- 0..5, the --gseat-N contract
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
  rest.

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
                                 window.close()           flips to ✓
```

Four things this depends on:

- **`window.open()` fires directly in the click handler.** No `await`
  before it, or the popup blocker eats it. If it's blocked anyway
  (`open()` returns null) we fall back to a toast with a clickable link.
- **`auth/done.html` is a site page, not worker-returned HTML.** Copy
  stays on the site and the page themes like everything else.
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

**The mobile menu needs its own append.** `buildNavMenu()` clones
`a[data-nav-core]` — a `<button>` won't come along, so without this the
control silently vanishes below the 56rem breakpoint.

### Gate prefill

The one touch to game code, and it's additive: `table.js` reads a stored
name at `NAME_KEY` already, so the account name becomes its fallback and
`seat_color` seeds the colour picker. **Guests are unaffected** — every
existing path still works, signed out.

This matters more than it looks. These are party games joined from a
texted link; putting sign-in in front of the gate would add friction at
exactly the moment it costs you a player. Signing in is an affordance in
the site chrome, never a step in joining.

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

## Not in phase 1

Results and stats. When they come: `join` gains an optional `auth`
field, the seat record gains a `uid`, game workers verify the session
signature locally against a shared HMAC secret (no network hop on the
join path), and finished tables POST results over a service binding
with an idempotency key of `game:tableId:rematchIndex`.

None of that is built. It's recorded here only so phase 1's shape makes
sense — the account id is the hook everything later hangs on.
