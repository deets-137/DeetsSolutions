"""Build cool-stuff/projects.json - the last-commit date of every project.

The portfolio cards are hand-written HTML with no dates, so the home
page's project strip has nothing to sort "most recent" by. This script
asks GitHub (through the authenticated `gh` CLI, so private repos count)
for the newest commit behind each project and writes one small JSON:

    { "generated_at": "...",
      "projects": { "<project name>": { "updated": "2026-08-18",
                                        "repos": ["DeetsFilm", ...] }, ... } }

Keyed by the card's `.project__name` text, which is what home.js reads.

Where a project's repos come from, in order:
  1. its card's GitHub links in cool-stuff/index.html (deets-137 repos only),
  2. the OVERRIDES table below - projects with no public link (private
     repos), or whose code lives in a folder of this site repo. A
     "Repo:path/" source dates the newest commit that touched that path.
The newest date across a project's sources wins.

Run by scripts/nightly-sotd.ps1, or by hand:

    python scripts/build-project-dates.py
"""

import io
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PAGE = REPO / "cool-stuff" / "index.html"
OUT = REPO / "cool-stuff" / "projects.json"
OWNER = "deets-137"
SITE = "DeetsSolutions"

# Project name -> extra sources. "Repo" = that repo's default branch;
# "Repo:path/" = newest commit touching that path in that repo.
OVERRIDES = {
    "DeetsFilm":     ["DeetsFilm", "DeetsFilmWorker"],
    "DeetsBeats":    ["DeetsBeats"],
    "DeetsPixels":   ["DeetsPixels"],
    "DeetsCities":   ["DeetsCities", SITE + ":cities/"],
    "DeetsMahjong":  ["DeetsMahjong", SITE + ":mahjong/"],
    "DeetsPoker":    ["DeetsPoker", SITE + ":poker/"],
    "DeetsTanks":    [SITE + ":tanks/"],
    "DeetsShips":    ["DeetsShips"],
    "DeetsRadio":    [SITE + ":radio/"],
    "DeetsLeague":   [SITE + ":league/"],
    "DeetsAccounts": ["DeetsAccounts", SITE + ":profile/"],
}


def gh(*args):
    out = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8")
    if out.returncode != 0:
        raise RuntimeError("gh %s failed: %s" % (" ".join(args), out.stderr.strip()))
    return json.loads(out.stdout)


def projects_from_page():
    """[(name, [repo, ...])] in page order, repos from the card's links."""
    html = io.open(PAGE, encoding="utf-8").read()
    found = []
    for block in re.findall(r'<article class="project">(.*?)</article>', html, re.S):
        m = re.search(r'<h3 class="project__name">\s*(.*?)\s*</h3>', block, re.S)
        if not m:
            continue
        name = re.sub(r"\s+", " ", m.group(1))
        repos = re.findall(r'href="https://github\.com/' + OWNER + r'/([\w.-]+)', block)
        found.append((name, repos))
    return found


def default_branch_dates():
    """{repo: ISO date} for every repo the account owns, one GraphQL call."""
    q = ('{ viewer { repositories(first: 100, ownerAffiliations: OWNER) { nodes { '
         'name defaultBranchRef { target { ... on Commit { committedDate } } } } } } }')
    data = gh("api", "graphql", "-f", "query=" + q)
    dates = {}
    for node in data["data"]["viewer"]["repositories"]["nodes"]:
        ref = node.get("defaultBranchRef") or {}
        date = (ref.get("target") or {}).get("committedDate")
        if date:
            dates[node["name"]] = date
    return dates


def path_date(repo, path):
    data = gh("api", "repos/%s/%s/commits?path=%s&per_page=1" % (OWNER, repo, path))
    return data[0]["commit"]["committer"]["date"] if data else None


def main():
    if not PAGE.exists():
        print("cool-stuff/index.html not found", file=sys.stderr)
        return 1
    branch_dates = default_branch_dates()
    result = {}
    missing = []
    for name, linked in projects_from_page():
        sources = list(dict.fromkeys(linked + OVERRIDES.get(name, [])))
        best = None
        for src in sources:
            if ":" in src:
                repo, path = src.split(":", 1)
                date = path_date(repo, path)
            else:
                date = branch_dates.get(src)
            if date and (best is None or date > best):
                best = date
        if best:
            result[name] = {"updated": best[:10], "repos": sources}
        else:
            missing.append(name)

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "projects": result,
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(payload, indent=1, ensure_ascii=False) + "\n")
    print("wrote %s (%d projects dated)" % (OUT.relative_to(REPO), len(result)))
    if missing:
        print("no repo found for: " + ", ".join(missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
