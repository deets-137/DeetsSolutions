# Data pipelines

Both journal tabs render a static JSON committed to this repo. The
generators live in the [DeetsOTD](../../DeetsOTD) repo; this site never
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

- **Nothing is downloaded** — only the URL string is stored; visitors'
  browsers fetch images straight from `image.tmdb.org`.
- Lookups cache in `DeetsOTD/exports/tmdb_posters.json` (gitignored there),
  so a refresh only queries films it hasn't seen. Delete a film's cache
  entry to force a re-lookup (e.g. after TMDB fixes a wrong match).
- No key still works: films fall back to the themed monogram tile.
- TMDB's API terms require visible attribution — the movies page footer
  carries it. Keep that if you restyle the page.

## Publishing a refresh

The JSONs are committed and served flat, so a data refresh is just:
regenerate → `git commit` → `git push`, and Cloudflare Pages redeploys.
