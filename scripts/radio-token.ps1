# DeetsRadio developer-token signer (docs/radio.md, "Providers").
#
# Signs the Apple Music developer token — an ES256 JWT with the `origin`
# claim locked to deets.solutions (+ localhost:8787 for dev) — and writes
# it to radio/dev-token.js, which IS committed: the token ships to every
# visitor anyway; the origin lock is what makes that safe.
#
# Credentials live in scripts/secrets/ (gitignored — see the README there):
#   apple.json  { teamId, keyId, privateKeyFile }
#   AuthKey_XXXXXXXXXX.p8
#
# Default run re-signs ONLY when the current token is within -RenewWithinDays
# of expiry (a fresh JWT differs every signing via iat, so unconditional
# signing would churn commits). -Force signs unconditionally. On a new token
# it stages and commits JUST radio/dev-token.js — never pushes (the
# nightly-sotd idiom: nothing reaches the live site unattended).
#
#   powershell -File scripts/radio-token.ps1 -Force     # first run / re-key
#   powershell -File scripts/radio-token.ps1            # nightly (gated)
#
# Zero dependencies: .NET's CNG imports the PKCS#8 key and signs ES256 in
# the r||s format JWS wants. Output is logged to scripts/radio-token.log.

param(
    [int]$RenewWithinDays = 30,
    [int]$ExpiryDays = 150,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$repo    = Split-Path $PSScriptRoot -Parent
$secrets = Join-Path $PSScriptRoot "secrets"
$outFile = Join-Path $repo "radio\dev-token.js"
$log     = Join-Path $PSScriptRoot "radio-token.log"

function Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding utf8
}

function B64Url([byte[]]$bytes) {
    [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}
function B64UrlDecode([string]$s) {
    $t = $s.Replace("-", "+").Replace("_", "/")
    switch ($t.Length % 4) { 2 { $t += "==" } 3 { $t += "=" } }
    [Convert]::FromBase64String($t)
}

Log "=== radio token signer starting ==="

# ── credentials ──────────────────────────────────────────────────────────
$cfgPath = Join-Path $secrets "apple.json"
if (-not (Test-Path $cfgPath)) {
    Log "ERROR: $cfgPath not found - see scripts/secrets/README.md"; exit 1
}
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
foreach ($field in "teamId", "keyId", "privateKeyFile") {
    if (-not $cfg.$field) { Log "ERROR: apple.json is missing '$field'"; exit 1 }
}
$p8Path = Join-Path $secrets $cfg.privateKeyFile
if (-not (Test-Path $p8Path)) { Log "ERROR: $p8Path not found"; exit 1 }

# ── expiry gate ──────────────────────────────────────────────────────────
# Read the exp out of the token we already ship; skip when it's still fresh.
if (-not $Force -and (Test-Path $outFile)) {
    $existing = Get-Content $outFile -Raw
    if ($existing -match '"(eyJ[^"]+)"') {
        try {
            $payload = [Text.Encoding]::UTF8.GetString((B64UrlDecode ($Matches[1].Split(".")[1]))) | ConvertFrom-Json
            $expires = [DateTimeOffset]::FromUnixTimeSeconds([long]$payload.exp)
            $daysLeft = [int]($expires - [DateTimeOffset]::UtcNow).TotalDays
            if ($daysLeft -gt $RenewWithinDays) {
                Log "Current token good for $daysLeft more days (renews at $RenewWithinDays) - nothing to do."
                Log "=== done ==="
                exit 0
            }
            Log "Current token expires in $daysLeft days - re-signing."
        } catch {
            Log "Could not parse the existing token ($($_.Exception.Message)) - re-signing."
        }
    }
}

# ── load the .p8 (PEM PKCS#8 -> CNG) ─────────────────────────────────────
$pem = Get-Content $p8Path -Raw
$b64 = ($pem -replace "-----(BEGIN|END) PRIVATE KEY-----", "") -replace "\s", ""
$der = [Convert]::FromBase64String($b64)
$cng = [System.Security.Cryptography.CngKey]::Import(
    $der, [System.Security.Cryptography.CngKeyBlobFormat]::Pkcs8PrivateBlob)
$ecdsa = New-Object System.Security.Cryptography.ECDsaCng($cng)
$ecdsa.HashAlgorithm = [System.Security.Cryptography.CngAlgorithm]::Sha256

# ── build + sign the JWT ─────────────────────────────────────────────────
$now = [DateTimeOffset]::UtcNow
$header = @{ alg = "ES256"; kid = $cfg.keyId } | ConvertTo-Json -Compress
$claims = [ordered]@{
    iss    = $cfg.teamId
    iat    = $now.ToUnixTimeSeconds()
    exp    = $now.AddDays($ExpiryDays).ToUnixTimeSeconds()
    origin = @("https://deets.solutions", "http://localhost:8787", "http://localhost:8788")
} | ConvertTo-Json -Compress

$signingInput = (B64Url ([Text.Encoding]::UTF8.GetBytes($header))) + "." +
                (B64Url ([Text.Encoding]::UTF8.GetBytes($claims)))
$sig = $ecdsa.SignData([Text.Encoding]::UTF8.GetBytes($signingInput))  # r||s, JWS-ready
$jwt = $signingInput + "." + (B64Url $sig)
$expStamp = $now.AddDays($ExpiryDays).ToString("yyyy-MM-dd")
Log "Signed (kid $($cfg.keyId), exp $expStamp)."

# ── live probe: one catalog request proves the token before we ship it ───
# Apple enforces the origin claim by matching the Origin header, so the
# probe must send one — an origin-locked token 401s on headerless requests.
try {
    $probe = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 `
        -Uri "https://api.music.apple.com/v1/catalog/us/search?types=songs&limit=1&term=test" `
        -Headers @{ Authorization = "Bearer $jwt"; Origin = "https://deets.solutions" }
    Log "Apple accepted the token (HTTP $($probe.StatusCode))."
} catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status) {
        Log "ERROR: Apple rejected the token (HTTP $status) - dev-token.js left untouched."
        Log "       Check teamId/keyId/.p8 in scripts/secrets/."
        exit 1
    }
    Log "WARNING: probe request failed ($($_.Exception.Message)) - continuing unverified."
}

# ── write radio/dev-token.js ─────────────────────────────────────────────
$js = @"
/* DeetsRadio - Apple Music developer token (generated by scripts/radio-token.ps1).
   Public by design: an origin-locked ES256 JWT that ships to every visitor.
   Re-signed automatically when within $RenewWithinDays days of expiry
   (see scripts/register-nightly-radio-token.ps1). Do not hand-edit.
   exp: $expStamp */
window.RADIO_DEV_TOKEN = "$jwt";
"@
[System.IO.File]::WriteAllText($outFile, $js.Replace("`r`n", "`n"),
    (New-Object System.Text.UTF8Encoding($false)))
Log "Wrote radio/dev-token.js."

# ── commit ONLY the token file (never push) ──────────────────────────────
Push-Location $repo
try {
    & git add -- "radio/dev-token.js"
    & git commit -m "DeetsRadio: re-sign developer token (exp $expStamp)" | ForEach-Object { Log "git: $_" }
    Log "Committed. Not pushed - run: git -C '$repo' push"
} finally {
    Pop-Location
}

Log "=== done ==="
