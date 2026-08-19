# Data pipelines

Both journal tabs render a static JSON committed to this repo. The
generators live in the [DeetsOTD](https://github.com/deets-137/DeetsOTD) repo; this site never
calls an API at runtime. Never hand-edit the JSONs — regenerate them.

## SOTD → `sotd/songs.json`

DeetsOTD scans a Discord song-of-the-day channel, enriches links via the
Apple Music API, and exports a website-ready JSON (display data only — no
Discord server/channel/message ids):

```
cd ../DeetsOTD
python scan.py --enrich --web --web-out "../DeetsSolutions/sotd/songs.json"
```

`--enrich` is required, not optional: `--web` only archives and exports what
storage.db already holds, so without `--enrich` a newly-posted song lands
unresolved (blank track/artist, `"resolved": "no"`) and is never retried. If a
brand-new release still comes back unresolved — the free iTunes id lookup can
lag Apple Music's catalog by hours on day-of-release — just re-run the same
command later; `--enrich` re-attempts every post still missing a match.

Shape: `{ generated_at, channel, count, songs: [...] }` — each song carries
track/artist/album, artwork and 30-sec preview URLs, genre, duration,
release date, uploader, and the posted date.

A wrong match (a bare YouTube/Spotify title that resolved to a more-famous
namesake) is fixed at the source, not in the JSON: `python review.py search
"<track>"` to find it, then `python review.py fix <song_id> --url "<correct
link>"` (tags it `manual`), then regenerate. See DeetsOTD's `docs/USAGE.md`.

## Movies → `movies/movies.json`

The film journal lives in DeetsOTD's `storage.db` (tables `films` /
`film_watches`, alongside the song tables — see DeetsOTD's
`letterboxd_store.py`), and `movies.json` is exported from it — the JSON is
a rendering, never the state. Two sources feed the DB:

```
# nightly top-up: the public RSS feed (the last ~50 diary entries)
python ../DeetsOTD/letterboxd_web.py rss --web -o movies/movies.json

# seed / true-up: a full Letterboxd data export (letterboxd.com/settings/data/)
python ../DeetsOTD/letterboxd_web.py import <export-folder> --web -o movies/movies.json

# re-export alone (no fetch)
python ../DeetsOTD/letterboxd_web.py web -o movies/movies.json
```

- **RSS is the steady state** — `scripts/nightly-sotd.ps1` runs it right
  after the song pull and commits `movies.json` only on a real change. Feed
  entries are deduped on Letterboxd's stable per-entry guid, so re-reads are
  idempotent and a rating/review edit re-lands cleanly. Watch-only entries
  (no review) count as sittings; their boilerplate description is never
  stored as a review.
- **A full export is only needed** for history the feed can't see: likes
  and watchlist changes, diary edits/deletions older than the feed window,
  or a backfill bigger than ~50 entries. Re-importing replaces export-era
  rows but never touches feed-recorded ones; where the two overlap, the
  export's verbatim review text wins over the feed's HTML round-trip.
- Films join on `(Name, Year)` — verified unique per film in Letterboxd's
  export. Each film carries aggregates (latest watched date, rating, liked,
  rewatch, most recent review) **plus** a `watches` array: every diary
  sitting with its own date, rating, rewatch flag, and review. Aggregates
  are computed at export time, never stored. The page's Grouped /
  Every-watch toggle runs on the `watches` array.
- **Same-day films order by logging time**: the feed's `pubDate` (the only
  time-of-day Letterboxd exposes; the CSVs are date-only) is stored per
  watch and breaks watched-date ties, so a marathon night lists in watch
  order — provided the entries were logged in watch order. Pre-feed history
  has no timestamps and keeps Letterboxd's diary-position order.
- Watchlist films the account hasn't watched are included with
  `status: "watchlist"` (seeded from the export; a watch in the feed flips
  them to watched).
- The DB keeps more than the site shows (per-sitting likes, diary tags,
  TMDB ids, raw source payloads) — that's the analysis surface; query
  `storage.db` directly.

### TMDB posters

Letterboxd carries no artwork the site may hotlink, so if `TMDB_API_KEY` is
set in DeetsOTD's `.env` (free key: themoviedb.org → Settings → API), each
film's poster URL is resolved from TMDB and baked into the JSON (and
mirrored onto the film row in the DB; the cache means a steady-state run
never touches the network).

- **Films seen in the RSS feed carry their exact `tmdb_id`** — those resolve
  by direct lookup, no guessing. Export-only films fall back to a title
  search **validated on release year** (exact, then ±1 for regional premiere
  drift): TMDB ranks by popularity, so a naive "first hit" grabs a louder
  same-title namesake for underground/foreign films — the year check is what
  keeps the right poster. A film with no year takes TMDB's top hit.
- **Nothing is downloaded** — only the URL string is stored; visitors'
  browsers fetch images straight from `image.tmdb.org`.
- Lookups cache in `DeetsOTD/exports/tmdb_posters.json` (gitignored there),
  so a refresh only queries films it hasn't seen. Delete a film's cache
  entry to force a re-lookup, or **pin the right poster by hand**: set the
  film's `"<Name> (<Year>)"` key to the correct `/poster_path.jpg` (from the
  right film's TMDB page) — the cache is a plain override, not a read-only
  artifact, so an edit there survives every regen.
- No key still works: films fall back to the themed monogram tile.
- TMDB's API terms require visible attribution — the movies page footer
  carries it. Keep that if you restyle the page.

## Resume → `resume/AdityaSundaram_Resume.pdf`

The third generated artifact — but with the direction inverted: the
source of truth lives **in this repo**. `resume/index.html` holds the
resume content (verbatim from Aditya's master resume, which stays
outside the repo because it carries his phone + email), and its
`media="print"` stylesheet is the PDF layout. Rebuild after any content
edit:

```
powershell -File scripts/build-resume-pdf.ps1
```

The script stamps today's date into the page's "Resume - updated" line,
then prints the page to the PDF with headless Edge — so the page and the
download can never drift apart. Never edit the PDF directly, and never
paste text from a PDF without proofreading it: extraction mangles
hyphenation across line breaks (e.g. "show-stopping" → "showstopping").

When Aditya revises his master resume, the update loop is: sync the
page's text to the new version verbatim → run the script → commit the
page and PDF together.

## Publishing a refresh

The JSONs and the resume PDF are committed and served flat, so a refresh
is just: regenerate → `git commit` → `git push`, and Cloudflare Pages
redeploys.
