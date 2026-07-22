# Nightly Song-of-the-Day refresh.
#
# Pulls new posts from the Discord SOTD channel via the sibling DeetsOTD
# repo, enriches them, and rewrites sotd/songs.json. If (and only if) the
# JSON changed, it stages JUST that file and commits — it does NOT push,
# so a bad pull can never reach the live site unattended. Push manually
# after a glance:  git -C <repo> push
#
# Wire it to Task Scheduler to run each evening (see scripts/register-nightly-sotd.ps1),
# or run by hand:
#   powershell -File scripts/nightly-sotd.ps1
#
# All output is also appended to scripts/nightly-sotd.log for unattended runs.

$ErrorActionPreference = "Stop"

$repo    = Split-Path $PSScriptRoot -Parent                 # ...\DeetsSolutions
$otd     = Join-Path (Split-Path $repo -Parent) "DeetsOTD"  # sibling ...\DeetsOTD
$songs   = Join-Path $repo "sotd\songs.json"
$log     = Join-Path $PSScriptRoot "nightly-sotd.log"
$channel = "1463626949430612267"

function Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding utf8
}

Log "=== nightly SOTD refresh starting ==="

if (-not (Test-Path $otd))   { Log "ERROR: DeetsOTD repo not found at $otd"; exit 1 }
if (-not (Test-Path $songs)) { Log "ERROR: songs.json not found at $songs"; exit 1 }

# Resolve a python interpreter.
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
    $python = "C:\Users\Aditya Sundaram\AppData\Local\Programs\Python\Python312\python.exe"
}
if (-not (Test-Path $python)) { Log "ERROR: python not found ($python)"; exit 1 }

# Content fingerprint that IGNORES generated_at (which is re-stamped every
# run). Without this, the file always differs and we'd commit every night
# even when no new songs arrived.
function ContentHash($path) {
    if (-not (Test-Path $path)) { return "" }
    return & $python -c "import json,io,hashlib;d=json.load(io.open(r'$path',encoding='utf-8'));d.pop('generated_at',None);print(hashlib.sha256(json.dumps(d,sort_keys=True,ensure_ascii=False).encode('utf-8')).hexdigest())"
}

# Fingerprint before, so we only commit on a real change.
$before = ContentHash $songs

# Run the scan from inside the DeetsOTD repo (config.py + .env live there).
Push-Location $otd
try {
    $out = & $python "scan.py" $channel "--enrich" "--web" "--web-out" $songs 2>&1
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
foreach ($l in $out) { Log "scan: $l" }
if ($code -ne 0) { Log "ERROR: scan.py exited $code - leaving songs.json untouched"; exit $code }

$after = ContentHash $songs
if ($after -eq $before) {
    Log "No new songs - nothing to commit (generated_at bumped only)."
    Log "=== done ==="
    exit 0
}

# New songs arrived: rebuild the link-preview card (sotd/og.jpg + the
# stamped <meta> block in sotd/index.html) so shared links embed the
# newest song. A failure here (e.g. artwork CDN down) must not block the
# songs.json commit - log and commit the JSON alone.
$ogFiles = @()
$ogOut = & $python (Join-Path $PSScriptRoot "build-sotd-og.py") 2>&1
foreach ($l in $ogOut) { Log "og: $l" }
if ($LASTEXITCODE -eq 0) {
    $ogFiles = @("sotd/og.jpg", "sotd/index.html")
} else {
    Log "WARN: build-sotd-og.py exited $LASTEXITCODE - committing songs.json only"
}

# Commit ONLY songs.json (+ the regenerated preview card). The working
# tree may hold other unrelated edits, so never `git add -A` here.
Push-Location $repo
try {
    & git add -- "sotd/songs.json" $ogFiles
    $count = & $python -c "import json,io;print(json.load(io.open(r'$songs',encoding='utf-8'))['count'])"
    $today = Get-Date -Format "yyyy-MM-dd"
    & git commit -m "SOTD: nightly refresh $today ($count songs)" | ForEach-Object { Log "git: $_" }
    Log "Committed. Not pushed - run: git -C '$repo' push"
} finally {
    Pop-Location
}

Log "=== done ==="
