# Apple Music credentials (DeetsRadio developer token)

Drop the MusicKit signing credentials here. **Nothing real in this folder
is committed** — `.gitignore` excludes everything under `scripts/secrets/`
except this README.

## What goes here

1. Your **`.p8`** MusicKit private key, e.g. `AuthKey_YYYYYYYYYY.p8`.
2. **`apple.json`**, filled in:

```json
{
  "teamId": "XXXXXXXXXX",
  "keyId": "YYYYYYYYYY",
  "privateKeyFile": "AuthKey_YYYYYYYYYY.p8"
}
```

- `teamId` — developer.apple.com/account → Membership (10 chars).
- `keyId` — the 10-char Key ID matching the `.p8` (Certificates,
  Identifiers & Profiles → Keys).
- `privateKeyFile` — the `.p8` filename, relative to this folder.

Same shape as DeetsMusic's `src-tauri/secrets/` — the key can be shared
between the two apps; each signs its own JWT.

## Then

```
powershell -File scripts/radio-token.ps1 -Force
```

signs the ES256 developer-token JWT (~150-day expiry, `origin` claim locked
to deets.solutions + localhost:8787/8788, the two dev-server ports) and
writes `radio/dev-token.js`, which
IS committed — the origin lock is what makes that safe. The nightly Task
Scheduler job (`scripts/register-nightly-radio-token.ps1`) re-signs it when
it comes within 30 days of expiry.
