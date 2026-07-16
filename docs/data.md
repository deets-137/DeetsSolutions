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
python scan.py --web --web-out "../DeetsSolutions/sotd/songs.json"
```

Shape: `{ generated_at, channel, count, songs: [...] }` — each song carries
track/artist/album, artwork and 30-sec preview URLs, genre, duration,
release date, uploader, and the posted date.

A wrong match (a bare YouTube/Spotify title that resolved to a more-famous
namesake) is fixed at the source, not in the JSON: `python review.py search
"<track>"` to find it, then `python review.py fix <song_id> --url "<correct
link>"` (tags it `manual`), then regenerate. See DeetsOTD's `docs/USAGE.md`.

## Movies → `movies/movies.json`

`letterboxd_web.py` merges a [Letterboxd data export](https://letterboxd.com/settings/data/)
(a folder of CSVs) into one JSON:

```
python ../DeetsOTD/letterboxd_web.py <export-folder> -o movies/movies.json
```

- Joins watched / diary / ratings / reviews / likes / watchlist on
  `(Name, Year)` — verified unique per film in Letterboxd's export.
- Each film carries aggregates (latest watched date, rating, liked, rewatch
  count, most recent review) **plus** a `watches` array: every diary sitting
  with its own date, rating, rewatch flag, and review (reviews pair to their
  sitting via film + watched date). The page's Grouped / Every-watch toggle
  runs on this.
- Watchlist films the account hasn't watched are included with
  `status: "watchlist"`.

### TMDB posters

Letterboxd exports carry no artwork, so if `TMDB_API_KEY` is set in
DeetsOTD's `.env` (free key: themoviedb.org → Settings → API), the script
looks each film up on TMDB search and bakes the poster URL into the JSON.

- **Matches are validated on release year** (exact, then ±1 for regional
  premiere drift). TMDB ranks by popularity, so a naive "first hit" grabs a
  louder same-title namesake for underground/foreign films — the year check
  is what keeps the right poster. A film with no year falls back to TMDB's
  top hit.
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
