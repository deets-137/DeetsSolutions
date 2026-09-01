---
name: journal-refresh
description: Pull the latest Song-of-the-Day and Letterboxd entries from the sibling DeetsOTD repo, then commit and push if (and only if) real new songs or films landed. Use when asked to refresh the journals, pull SOTD/movies, run the DeetsOTD pull, or update songs.json / movies.json.
---

# Journal refresh (SOTD + movies)

Runs the same pipeline as the nightly Task Scheduler job, but attended: you
review the result and push. Touches **only** `sotd/` and `movies/` — never
stage or commit anything else, even if the working tree is dirty.

## 1. Check the tree first

```
git -C <repo> status --short
```

A pre-existing modification to `sotd/songs.json` or `movies/movies.json` is
almost always a `generated_at`-only bump left by an unattended nightly run
(the script re-stamps that field but correctly declines to commit it).
**Leave it — do not revert and do not commit it.** The refresh below
overwrites the file anyway and re-fingerprints on content, ignoring
`generated_at`.

If any *other* file is dirty, note it and carry on; the script stages an
explicit file list, never `git add -A`.

## 2. Run the refresh

```
powershell -File scripts/nightly-sotd.ps1
```

That single script does everything: `scan.py --enrich --web` for songs,
`letterboxd_web.py rss --web` for films, a content fingerprint that ignores
`generated_at`, the `build-sotd-og.py` link-preview rebuild when songs
changed, a commit of just the changed journal files, and a `git push`. The
two halves are independent -- one failing never blocks the other.

Never hand-run the underlying Python or hand-edit either JSON; see
[data.md](../../docs/data.md).

## 3. Verify prod actually caught up

The script pushes, but a push is not a deploy. Confirm what the live site is
serving:

```
powershell -File scripts/prod-status.ps1
```

It compares prod against `origin/master` against local HEAD, which is what
separates "Cloudflare has not built yet" from "the commit never left this
machine". Exit 0 means all three agree.

- **Reports IN SYNC** -> done, say what landed.
- **Reports DEPLOY LAGGING** -> a Pages build runs ~30-60s. Re-run once
  after a short wait. If it is still lagging, stop and say so rather than
  re-pushing; the fix is in the Cloudflare dashboard, not in another commit.
- **Reports UNPUSHED** -> the script's push failed (it logs the git error and
  exits 1). Report the error verbatim. Most likely a diverged remote, since
  Aditya pushes from parallel sessions -- **never force-push and never
  auto-rebase** to clear it; that is his call.
- **Script logged "No new songs or films"** -> nothing was committed and
  nothing to verify. Say so and stop. Do not create an empty commit.
- **A stage errored** (non-zero exit for `scan.py` or `letterboxd_web.py`) ->
  report it verbatim, and say which half still made it out.

## 4. Always report unresolved songs

Finish by listing songs in `sotd/songs.json` where `resolved != "yes"` —
count plus each straggler's posted date and link. The script's output only
says "Enriched N/M"; it never names them, and an unresolved song renders on
the site with a blank track and artist.

```
python -c "import json,io;d=json.load(io.open('sotd/songs.json',encoding='utf-8'));u=[s for s in d['songs'] if s.get('resolved')!='yes'];print(len(u));[print(s['date'],s['author'],s['url']) for s in u]"
```

Day-of-release lag is the usual cause and re-running the refresh later fixes
it. A link iTunes structurally can't match (album pages, bare YouTube
titles) needs a manual correction in DeetsOTD — `review.py fix` — which is
Aditya's call, not something to do unprompted.
