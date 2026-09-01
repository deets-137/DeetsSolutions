# What is deets.solutions actually serving?
#
# Three-way compare of the two journal JSONs -- live prod vs origin/master vs
# your local HEAD -- because a two-way check cannot tell the two failure
# modes apart:
#
#   prod  != origin  ->  Cloudflare has not finished (or has failed) a deploy
#   origin != local  ->  the nightly commits never got pushed
#
# The JSONs are safe to read straight off the wire: `_headers` pins them to
# max-age=0/must-revalidate and Cloudflare serves them DYNAMIC, so a fetch
# always sees the true deployed bytes with no cache lag to work around.
# (Pages' ETag is opaque -- NOT the file's md5 -- so the JSON's own
# generated_at/count fields are the honest signal, and they are the artifact
# anyway.)
#
#   powershell -File scripts/prod-status.ps1
#
# Exit 0 = prod, origin and local all agree. Exit 1 = drift (see the verdict).

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# git writes UTF-8; without this PS 5.1 decodes it as the ANSI codepage and
# mangles non-ASCII track/film titles on the way into ConvertFrom-Json.
$prevEnc = [Console]::OutputEncoding
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$repo = Split-Path $PSScriptRoot -Parent
$base = "https://deets.solutions"

$feeds = @(
    @{ Name = "songs";  Path = "sotd/songs.json";     Items = "songs";  Date = "date" }
    @{ Name = "movies"; Path = "movies/movies.json";  Items = "movies"; Date = "watched_date" }
)

# Reduce a parsed JSON to the three things worth comparing.
function Summarize($json, $itemsKey, $dateKey) {
    if (-not $json) { return $null }
    $dates = @($json.$itemsKey | ForEach-Object { $_.$dateKey } | Where-Object { $_ })
    $latest = if ($dates) { ($dates | Sort-Object)[-1] } else { "-" }
    return [pscustomobject]@{
        Count     = $json.count
        Latest    = $latest
        Generated = ([string]$json.generated_at).Substring(0, 10)
    }
}

function FromWeb($path) {
    try {
        return Invoke-RestMethod -Uri "$base/$path" -TimeoutSec 25 `
            -Headers @{ "Cache-Control" = "no-cache" }
    } catch {
        Write-Host "  ! could not fetch $base/$path : $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

function FromGit($rev, $path) {
    $raw = & git -C $repo show "${rev}:${path}" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
    return ($raw | Out-String | ConvertFrom-Json)
}

try {
    # Refresh remote-tracking refs so origin/master is not itself stale.
    & git -C $repo fetch --quiet origin 2>$null | Out-Null

    Write-Host ""
    Write-Host "deets.solutions journal status  --  $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    Write-Host ("-" * 66)
    Write-Host ("{0,-8} {1,-22} {2,-22} {3}" -f "", "PROD", "ORIGIN/MASTER", "LOCAL HEAD")

    $drift = $false
    $prodBehind = $false
    $unpushed = $false

    foreach ($f in $feeds) {
        $prod   = Summarize (FromWeb $f.Path)                    $f.Items $f.Date
        $origin = Summarize (FromGit "origin/master" $f.Path)    $f.Items $f.Date
        $local  = Summarize (FromGit "HEAD" $f.Path)             $f.Items $f.Date

        function Cell($s) {
            if (-not $s) { return "unavailable" }
            return "{0} ({1})" -f $s.Count, $s.Latest
        }

        $line = "{0,-8} {1,-22} {2,-22} {3}" -f $f.Name, (Cell $prod), (Cell $origin), (Cell $local)
        $note = ""
        if ($prod -and $origin -and $prod.Count -ne $origin.Count) {
            $note = "  <- prod behind origin"; $prodBehind = $true; $drift = $true
        } elseif ($origin -and $local -and $origin.Count -ne $local.Count) {
            $note = "  <- unpushed"; $unpushed = $true; $drift = $true
        }
        Write-Host ($line + $note)
    }

    # Commit-level view, which also catches changes to non-JSON files.
    $ahead = (& git -C $repo rev-list --count "origin/master..HEAD").Trim()
    $behind = (& git -C $repo rev-list --count "HEAD..origin/master").Trim()
    $dirty = @(& git -C $repo status --porcelain -- sotd movies).Count

    Write-Host ""
    Write-Host "  commits: $ahead ahead / $behind behind origin/master"
    if ($dirty -gt 0) { Write-Host "  working tree: $dirty uncommitted change(s) under sotd/ or movies/" }

    Write-Host ("-" * 66)
    if (-not $drift -and $ahead -eq "0") {
        Write-Host "  IN SYNC - prod is serving the newest journals." -ForegroundColor Green
    } elseif ($unpushed -or $ahead -ne "0") {
        Write-Host "  UNPUSHED - the refresh is committed but never left this machine." -ForegroundColor Yellow
        Write-Host "  Fix: git -C '$repo' push"
    } elseif ($prodBehind) {
        Write-Host "  DEPLOY LAGGING - origin has newer journals than prod is serving." -ForegroundColor Yellow
        Write-Host "  A Pages build takes ~30-60s; if it persists, check the Cloudflare dashboard."
    }
    Write-Host ""

    if ($drift -or $ahead -ne "0") { exit 1 }
    exit 0
} finally {
    [Console]::OutputEncoding = $prevEnc
}
