# Accounts — setup checklist

Everything that can't be done from a terminal, in order, with the exact
values to paste. Design lives in [accounts.md](accounts.md); this is the
runbook.

**Status (2026-07-27): ALL DONE, live-tested.** The domain was already
verified in Search Console; the consent screen is published; the OAuth
client exists; the worker is deployed to `id.deets.solutions` with the
D1 schema applied and `SESSION_SECRET` set. Aditya ran step 6's live
sign-in end to end the same day — the full handshake works. The failure
notes at the bottom stay for the next time something stumbles.

---

## 1. Verify the domain in Google Search Console

Publishing needs an *authorized domain*, and Google only accepts domains
verified there.

1. https://search.google.com/search-console → add property → **Domain** →
   `deets.solutions`
2. It gives you a TXT record. Add it in Cloudflare DNS (same place the
   worker custom domains live).
3. Back in Search Console, hit Verify.

DNS can take a few minutes. Do this first so it's propagating while you
do step 2.

---

## 2. OAuth consent screen

Console → **APIs & Services → OAuth consent screen**, project
**DeetsSolutions** (`lucid-diode-502505-j8`).

| Field | Value |
|---|---|
| User type | **External** |
| App name | `DeetsSolutions` |
| User support email | your gmail |
| App logo | **leave empty** — see below |
| Application home page | `https://deets.solutions` |
| Privacy policy link | `https://deets.solutions/privacy/` |
| Terms of service link | leave empty |
| Authorized domain | `deets.solutions` |
| Developer contact | your gmail |

**Scopes:** add `openid` and `.../auth/userinfo.profile`. **Do not add
`userinfo.email`.** If email is on the list, the whole no-PII design is
pointless — the whole point is that Google never sends it.

**Leave the logo empty.** A custom logo puts the app into Google's brand
verification review queue, and re-uploading later re-triggers it. Empty
logo + non-sensitive scopes = publish immediately, no review, no
test-user list. The Deets sprite can be added later if the wait is ever
worth it; it needs squaring and upscaling first (it's 32×64, Google wants
120×120).

Then **Publish app** → confirm. Status should read *In production*. This
is what means you never add anyone by hand.

---

## 3. Create the OAuth client

Console → **APIs & Services → Credentials → Create credentials → OAuth
client ID**.

| Field | Value |
|---|---|
| Application type | **Web application** |
| Name | `deets-accounts` (internal only, nobody sees it) |
| Authorized JavaScript origins | *(leave empty — we never call Google from the browser)* |
| Authorized redirect URIs | `https://id.deets.solutions/cb` |

That redirect URI must match **exactly** — no trailing slash. A mismatch
is the single most common failure here and Google's error says
`redirect_uri_mismatch` in plain English when it happens.

Keep the **Client ID** and **Client secret** on screen for step 5.

---

## 4. Cloudflare: the custom domain

The worker's route is `id.deets.solutions`. Wrangler creates the DNS
record itself on first deploy, so there is nothing to do by hand here —
just don't be surprised when a new record appears.

---

## 5. Deploy the worker

```bash
cd "C:\Users\Aditya Sundaram\Documents\DeetsAccounts"
```

Create the database:

```bash
npx wrangler d1 create deets-accounts
```

Paste the printed `database_id` into `wrangler.jsonc` (it currently says
`PASTE_DATABASE_ID_HERE`), and paste the **Client ID** from step 3 over
`PASTE_CLIENT_ID_HERE` in the same file.

Apply the schema:

```bash
npx wrangler d1 execute deets-accounts --remote --file=schema.sql
```

Two secrets. The Google one is from step 3:

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

The session one is ours — any long random string. This generates and
copies one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | clip
```

```bash
npx wrangler secret put SESSION_SECRET
```

Deploy:

```bash
npx wrangler deploy
```

---

## 6. Test it live

Local sign-in **cannot work** — the cookie is scoped to
`.deets.solutions` and Google won't redirect to localhost. So this is a
production test, and the site changes need to be live first.

The site changes are merged to master and live, so this is just:

1. Open https://deets.solutions, hover **Games**. There should be a
   **Sign in** row with a red ✕.
2. Click it. A new tab opens → Google account picker → the tab flashes a
   "Signed in" page and closes itself.
3. The original tab's button should flip to your name with a green ✓,
   **without you touching it**. That's the BroadcastChannel handshake.
4. Open a game gate. It should skip the name prompt and use your profile
   name.
5. Click the button again to sign out.

For the UI alone, without any of the above:
http://localhost:8787/?mock gives a fake signed-in account.

---

## What's likely to break, and where to look

**`redirect_uri_mismatch`** — step 3's URI doesn't exactly match
`https://id.deets.solutions/cb`. Most likely cause by far.

**The new tab lands on the "Signed in" page but the original tab doesn't
update.** BroadcastChannel didn't land. `js/account.js` also listens for
a `storage` event as a fallback, and re-checks on tab focus, so switching
back to the original tab should fix it within a second. If it doesn't,
the bug is in `onSignal()` — check the console in both tabs.

**The tab doesn't close itself.** Some browsers refuse `window.close()`.
Harmless — the page says "You can close this tab" and the sign-in
already worked.

**Button says "Sign in" even though you just signed in, and stays that
way after a refresh.** That's the cookie not being set or not being sent:
check the response headers on `/cb` in devtools, and confirm the cookie's
Domain is `.deets.solutions`.

**A CORS error on `/me`.** `ALLOWED_ORIGINS` in `wrangler.jsonc` must
contain the exact origin you're browsing from. `https://deets.solutions`
and `https://www.deets.solutions` are both listed; if you browse a
Cloudflare preview URL it won't be.

---

## What is deliberately NOT built

- **Results and stats.** Phase 1 was auth only. (Since then: the profile
  page landed, and seats now carry a verified uid for cross-device
  reclaim — see [accounts.md](accounts.md), "Beyond phase 1". Results
  POSTing is still future.)
- **Sign-out-everywhere.** The `token_epoch` column exists and is
  checked, but nothing bumps it. It's a manual D1 update if ever needed.
- **The app logo**, per step 2.

## Files this touched

| File | |
|---|---|
| `../DeetsAccounts/` | new sibling worker repo, deployed to `id.deets.solutions` |
| `docs/accounts.md` | design |
| `docs/accounts-setup.md` | this |
| `js/account.js` | new shared chrome |
| `auth/done.html` | new — the sign-in landing tab |
| `privacy/index.html` | new — required to publish |
| `styles/main.css` | `.account-btn`, `.prose`, `.auth-done` appended |
| `games/table.js` | name fallback + one-shot colour seed, both additive |
| every page's `<head>` | `js/account.js` script tag |
