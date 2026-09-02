# Nightly journal refresh: Song-of-the-Day + the movie log.
#
# Songs: pulls new posts from the Discord SOTD channel via the sibling
# DeetsOTD repo, enriches them, and rewrites sotd/songs.json.
# Movies: ingests the Letterboxd RSS feed into DeetsOTD's storage.db and
# rewrites movies/movies.json from it (letterboxd_web.py rss --web).
# Projects: asks GitHub (via the gh CLI) for each portfolio project's last
# commit date and rewrites cool-stuff/projects.json (build-project-dates.py).
# The three are independent — a failure in one never blocks the others.
#
# If (and only if) a JSON changed, it stages JUST the changed files,
# commits, and pushes — Cloudflare Pages then redeploys, so an unattended
# run carries all the way through to the live site. Verify what prod is
# actually serving with:  powershell -File scripts/prod-status.ps1
#
# A push that is not a fast-forward is left ALONE (logged, exit 1): he
# pushes from parallel sessions, and this job must never rewrite or
# clobber work it did not create. Resolve those by hand.
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
$movies  = Join-Path $repo "movies\movies.json"
$projects = Join-Path $repo "cool-stuff\projects.json"
$log     = Join-Path $PSScriptRoot "nightly-sotd.log"
$channel = "1463626949430612267"

function Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding utf8
}

Log "=== nightly journal refresh starting ==="

if (-not (Test-Path $otd))    { Log "ERROR: DeetsOTD repo not found at $otd"; exit 1 }
if (-not (Test-Path $songs))  { Log "ERROR: songs.json not found at $songs"; exit 1 }
if (-not (Test-Path $movies)) { Log "ERROR: movies.json not found at $movies"; exit 1 }

# Resolve a python interpreter.
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
    $python = "C:\Users\Aditya Sundaram\AppData\Local\Programs\Python\Python312\python.exe"
}
if (-not (Test-Path $python)) { Log "ERROR: python not found ($python)"; exit 1 }

# Content fingerprint that IGNORES generated_at (which is re-stamped every
# run). Without this, the file always differs and we'd commit every night
# even when nothing new arrived.
function ContentHash($path) {
    if (-not (Test-Path $path)) { return "" }
    return & $python -c "import json,io,hashlib;d=json.load(io.open(r'$path',encoding='utf-8'));d.pop('generated_at',None);print(hashlib.sha256(json.dumps(d,sort_keys=True,ensure_ascii=False).encode('utf-8')).hexdigest())"
}

# Fingerprints before, so we only commit on a real change.
$songsBefore    = ContentHash $songs
$moviesBefore   = ContentHash $movies
$projectsBefore = ContentHash $projects

# ── Songs: scan the Discord channel (config.py + .env live in DeetsOTD) ──
Push-Location $otd
try {
    $out = & $python "scan.py" $channel "--enrich" "--web" "--web-out" $songs 2>&1
    $songsCode = $LASTEXITCODE
} finally {
    Pop-Location
}
foreach ($l in $out) { Log "scan: $l" }
if ($songsCode -ne 0) { Log "ERROR: scan.py exited $songsCode - songs.json left untouched" }

# ── Movies: Letterboxd RSS feed -> storage.db -> movies.json ──
Push-Location $otd
try {
    $out = & $python "letterboxd_web.py" "rss" "--web" "-o" $movies 2>&1
    $moviesCode = $LASTEXITCODE
} finally {
    Pop-Location
}
foreach ($l in $out) { Log "rss: $l" }
if ($moviesCode -ne 0) { Log "ERROR: letterboxd_web.py exited $moviesCode - movies.json left untouched" }

# ── Projects: GitHub last-commit dates -> cool-stuff/projects.json ──
$out = & { $ErrorActionPreference = 'Continue'; & $python (Join-Path $PSScriptRoot "build-project-dates.py") 2>&1 }
$projectsCode = $LASTEXITCODE
foreach ($l in $out) { Log "projects: $l" }
if ($projectsCode -ne 0) { Log "ERROR: build-project-dates.py exited $projectsCode - projects.json left untouched" }

if ($songsCode -ne 0 -and $moviesCode -ne 0 -and $projectsCode -ne 0) { exit 1 }

$songsChanged    = ($songsCode -eq 0)    -and ((ContentHash $songs)    -ne $songsBefore)
$moviesChanged   = ($moviesCode -eq 0)   -and ((ContentHash $movies)   -ne $moviesBefore)
$projectsChanged = ($projectsCode -eq 0) -and ((ContentHash $projects) -ne $projectsBefore)

if (-not ($songsChanged -or $moviesChanged -or $projectsChanged)) {
    Log "No new songs, films, or commits - nothing to commit (generated_at bumped only)."
    Log "=== done ==="
    exit 0
}

$files = @()
$parts = @()
if ($songsChanged) {
    $files += "sotd/songs.json"
    $count = & $python -c "import json,io;print(json.load(io.open(r'$songs',encoding='utf-8'))['count'])"
    $parts += "$count songs"

    # New songs arrived: rebuild the link-preview card (sotd/og.jpg + the
    # stamped <meta> block in sotd/index.html) so shared links embed the
    # newest song. A failure here (e.g. artwork CDN down) must not block the
    # commit - log and commit the JSONs alone.
    $ogOut = & $python (Join-Path $PSScriptRoot "build-sotd-og.py") 2>&1
    foreach ($l in $ogOut) { Log "og: $l" }
    if ($LASTEXITCODE -eq 0) {
        $files += @("sotd/og.jpg", "sotd/index.html")
    } else {
        Log "WARN: build-sotd-og.py exited $LASTEXITCODE - committing JSONs only"
    }
}
if ($moviesChanged) {
    $files += "movies/movies.json"
    $count = & $python -c "import json,io;print(json.load(io.open(r'$movies',encoding='utf-8'))['count'])"
    $parts += "$count films"
}
if ($projectsChanged) {
    $files += "cool-stuff/projects.json"
    $parts += "project dates"
}

# Commit ONLY the refreshed journal files. The working tree may hold other
# unrelated edits, so never `git add -A` here.
$journals = @($songsChanged, $moviesChanged, $projectsChanged) | Where-Object { $_ }
$label = if ($journals.Count -gt 1) { "Journals" }
         elseif ($songsChanged) { "SOTD" }
         elseif ($moviesChanged) { "Movies" } else { "Projects" }
Push-Location $repo
try {
    & git add -- $files
    $today = Get-Date -Format "yyyy-MM-dd"
    & git commit -m "${label}: nightly refresh $today ($($parts -join ', '))" | ForEach-Object { Log "git: $_" }

    # Push so the refresh actually reaches the live site. Anything that is
    # not a clean fast-forward (diverged remote, no network) is reported and
    # left for a human - never force, never auto-rebase.
    # git push writes its progress to stderr even on success, and under
    # $ErrorActionPreference='Stop' a 2>&1 redirect turns that into a
    # terminating NativeCommandError. Drop to Continue for the call itself.
    $pushOut = & { $ErrorActionPreference = 'Continue'; & git push 2>&1 }
    $pushCode = $LASTEXITCODE
    foreach ($l in $pushOut) { Log "push: $l" }
    if ($pushCode -eq 0) {
        Log "Pushed. Cloudflare Pages will redeploy; verify with scripts/prod-status.ps1"
    } else {
        Log "ERROR: git push exited $pushCode - commit is local only, prod NOT updated"
    }
} finally {
    Pop-Location
}

if ($pushCode -ne 0) { Log "=== done (push failed) ==="; exit 1 }

Log "=== done ==="
