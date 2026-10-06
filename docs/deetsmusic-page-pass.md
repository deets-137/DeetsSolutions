# DeetsMusic page — the product pass (tagline, features, screenshots, trust)

A plan for `deets.solutions/deetsmusic/` so a cold visitor understands what DeetsMusic is,
sees it, and trusts the download. **Planned 2026-10-06; pass 1 BUILT the same day, not
committed — his visual and copy passes are owed (§8).** This doc is written for an
agent who takes over in this repo with no other context. Read it top to bottom once, then
[CLAUDE.md](../CLAUDE.md) (the Never list and the copy rule) and [support.md](support.md) ("The
page") before you touch a file.

Terms used here:
- **The page** = `deetsmusic/index.html` + `deetsmusic.js` + `strings.js` + `mock.js`, and the
  `dm-` section at the bottom of `styles/main.css`.
- **The app** = DeetsMusic, the Windows desktop app. Its repo is the sibling
  `../DeetsMusic` (GitHub: `deets-137/DeetsMusicWindows`).
- **Pass 1** = the work this doc says to build now (§3).
- **`[ph]`** = a placeholder string. Claude may add only these. Aditya writes the real copy.

---

## 1. Where this came from

On 2026-10-06 Aditya showed Claude two reviews written by another AI agent ("hark"):
a review of the page and a market read on Apple Music players for Windows. Claude checked
both against the app's code and docs. The verdicts are below so nobody re-does that work.

### 1a. The page review (hark), with the verdict

| # | hark's point | Verdict |
| --- | --- | --- |
| 1 | Tagline under the H1 ("A full Apple Music player for Windows 11"), and say Free | **Yes — pass 1.** The app is free. |
| 2 | 2–3 screenshots and a Features list on the page; features today show only in the changelog, and pictures sit one submenu away on Demo | **Yes — pass 1.** The largest gap. |
| 3 | Requirements + Trust block: Windows build, x64, WebView2, AirPlay firewall prompt, license, GitHub link, VirusTotal link | **Yes — pass 1.** The repo is public (confirmed §2). |
| 4 | Support path: which board takes bugs, which takes ideas, one real contact | Later (§6). The boards already exist; GitHub Issues and Discussions are OFF on purpose (app README). |
| 5 | Polish: faint secondary text fails contrast in dark themes; the earlier-releases row needs a scroll cue; a sticky Download pill | Later (§6). |
| — | Collapse the changelog below the features | Pass 1 places Features above Release notes; a collapse is later. |
| — | Say whether the app sends telemetry | Later (§6). The true answer today is in §4c. |
| — | Explain the Apple sign-in, when it expires, how to sign out | Later (§6). |
| — | Put Resume, GitHub, LinkedIn on this page | **No** for Resume and LinkedIn: it makes a product page a portfolio page. The GitHub link goes in the Trust block. The portfolio path is the home walk ([onboarding.md](onboarding.md)). |

### 1b. The market read (hark), with the verdict

hark's summary, kept for context. **The numbers are NOT verified** (Reddit upvote counts,
competitor prices, FocalSonic's details). Open each source before any of it is quoted in public.

- **Demand:** r/AppleMusic threads complain about the official Windows app: RAM use, sign-in
  loops, crashes, lossless stalls. The official app still holds about 4.2★ on the Microsoft
  Store; the pain sits with power users.
- **Most-asked features:** reliability, low RAM/CPU, Last.fm, Discord status, library sorting,
  EQ, casting, Windows 10 support. DeetsMusic already has Last.fm, Discord, AirPlay to a
  HomePod, a mini player, self-update, an EQ.
- **Competitors (unverified):** Cider (paid, the usual Reddit answer), FocalSonic (paid,
  Microsoft Store, Windows 11 only), stem2k, AMWin-RP, Apple's web player.
- **Only DeetsMusic has:** listening rooms with friends, and CLI / MCP control by an AI agent.
- **Risks:** Apple's MusicKit terms (no charge, no "indirect" money for access; do not modify
  the content), Apple can revoke the developer key, no third-party app gets lossless.
- **Ideas:** publish RAM / CPU / cold-start benchmarks; lead with rooms and agent control;
  consider Windows 10; launch on r/AppleMusic, then r/lastfm, r/discordapp, r/Windows11,
  winget, Show HN.

Claude's verdict on the market read:
- **The terms clause is real.** The app's own `docs/integrations/ROOMS.md` quotes it: "You agree
  not to require payment for or indirectly monetize access to the Apple Music service (e.g.
  in-app purchase, advertising, requesting user info)." The EQ risk was already accepted
  (the app's Apple-terms review, §7.6).
- **Benchmarks are cheap here:** the app repo has `scripts/heaviness-sample.ps1` and
  `npm run bench`. A fair run measures every app on one PC with one script, and the method is
  published with the numbers.
- **Windows 10:** Tauri v2 and WebView2 run on it. Some Glass effects likely need Windows 11.
  Unchecked.

## 2. His decisions (2026-10-06)

1. **Build pass 1 now** (§3): tagline, Features list, screenshots, Requirements + Trust block.
2. **The GitHub repo is public.** Claude confirmed it with `gh repo view
   deets-137/DeetsMusicWindows`: visibility PUBLIC, license MIT,
   `https://github.com/deets-137/DeetsMusicWindows`. **[support.md](support.md) "The page" still
   says the repo is private** — that line is now wrong; it was corrected in the same commit as
   this doc.
3. **No Microsoft Store.** The app has its own Authenticode code-signing certificate, and the
   plan is word of mouth. Do not propose a Store listing.
4. **A tip jar: yes, but before the Reddit launch post, not now.** It is not in pass 1. See §6
   for what must be settled first (the terms clause in §1b).
5. **The page is partly a portfolio piece.** Aditya is applying for jobs and says so openly.
   **The product comes first.** So: the page must read as a product page to a music listener.
   The engineering story (Rust, Tauri, DRM playback, agent control) can be visible, but it
   never pushes the listener's content down. Recruiters get their own path (the home walk,
   [onboarding.md](onboarding.md)).
6. **Update the website's Ocean skin** to match the app's current Ocean (§7). A separate piece
   of work from pass 1.

### 2a. The forks, settled (2026-10-06, same day)

Pass 1 (§3):
- **Tagline:** start from the app's own line, with Free in it: `[ph]Free. A lightweight Apple
  Music player for Windows 11.` (he writes the final words).
- **Features:** two groups. The everyday features in a grid first; an **"Only in DeetsMusic"
  row below it** (listening rooms, control from an AI app or a terminal).
- **Screenshots:** Midi Home, Max overview, Compass, **in the visitor's own look.** All 30
  theme × skin pairs are shot (the theme and skin ids match the app's), converted to WebP when
  copied in, and the page swaps them live when the look changes. A visitor downloads 3.
- **Requirements + Trust:** a small box of its own after Features. **No VirusTotal.**
- **Later the same day (desk test):** the app's menu offers only four skins (no Vanilla), so the
  Vanilla pictures were dropped (72 files) and a Vanilla visitor sees **Press**. The section is
  titled **Demos**; he approved the tagline, the box titles and the three captions (the click
  line and the alt texts stay `[ph]`). The Ocean glow is **stronger than the app's**, with a
  chroma lift for dull covers (§7e). Then he approved the rest of the copy: the box is
  **Features**, the looks tile reads **6 themes × 4 skins** ("24 looks"), and every pass-1 string
  is his, the three picture alt texts too (zero `[ph]`). The eight feature tiles are one size, the
  six in 3 + 3 with the "Only" pair centered under them (one grid, `.dm-pitch__tiles`).

Ocean (§7c):
- **Scope:** the swell **plus the glow from the deep.** The site has no player, so the glow
  takes **today's Song of the Day cover** (mzstatic art sends CORS headers, so a canvas can
  read it). No heave, no ripples.
- **Painting:** port the app's painter to plain JS in `js/`, painted in a Worker at load.
- **Tanks keeps its old sea.**

## 3. Pass 1 — what to build

Four blocks. Each lists its place, its files, its strings, and the forks that are Aditya's.
**Bring him the forks before you build** (the house rule: he decides every fork). Short
options, your recommendation first.

### 3a. Tagline

- **Place:** in the page bar, directly under `<h1 class="page-bar__title">DeetsMusic</h1>`
  (`deetsmusic/index.html`, about line 99).
- **String:** a new `tagline` key in `deetsmusic/strings.js`, with a `[ph]` prefix.
- **Source words to offer him:**
  - The app's own `shortDescription` (`../DeetsMusic/src-tauri/tauri.conf.json`): "A lightweight
    Apple Music player for Windows 11."
  - hark's: "A full Apple Music player for Windows 11."
  - His positioning (the app's `docs/guide/marketing.md` §1, his words 2026-10-01): "DeetsMusic
    has no algorithm. It helps you choose what you listen to on purpose."
- **Fork for him:** the words, and whether "Free" is in the tagline or in the Download pill.
- **Style:** the page bar's secondary text family. Use existing tokens; check contrast in a dark
  theme (hark found faint text fails there, §6).

### 3b. Features list

- **Place:** a new full-width box `dm-box dm-box--wide`, id `features`, **after the Install +
  Status row and before Release notes.** This also answers "the changelog competes with the
  Download card": the features come first.
- **Content:** 6–8 items, each one short heading + one sentence. Strings in `strings.js`,
  `[ph]` prefix, one key per item (`feat1Title`, `feat1Body`, …).
- **Proposed items** (hark's lead list, checked against what is shipped). Every item below is
  shipped in the app; the doc to check each claim is in brackets (app repo):
  1. **Last.fm scrobbling** (`docs/integrations/LASTFM.md`)
  2. **Discord status and Friends** (`docs/integrations/FRIENDS.md`)
  3. **Play on a HomePod** — AirPlay (`docs/integrations/AIRPLAY.md`)
  4. **Listening rooms** — listen along with friends (`docs/integrations/ROOMS.md`)
  5. **Mini, Midi and Max** — one window, several sizes, swappable cards
     (`docs/architecture/SURFACES-AND-CARDS.md`)
  6. **6 themes × 5 skins** (`docs/architecture/UI-ARCHITECTURE.md`)
  7. **Control it from an AI app or a terminal** — CLI and MCP (`docs/integrations/AGENT.md`)
  8. **Equalizer** (`docs/features/SOUND.md`)
  Others he may prefer: the Diary, Rewind, Song of the Day, Compass (Ctrl+Space), Rulez.
- **Never claim** (the app's `docs/guide/marketing.md` §10): Spotify, Adaptive sound, Suggest
  Less, Skinz, Hop in, the Layout rows, a second Search card, usage counts, anything in the
  app's `docs/ideas/`. When in doubt, the app's `docs/ops/RELEASE-NOTES.md` is what shipped.
- **Forks for him:** which items, their order, the box title, and whether the two items only
  DeetsMusic has (rooms, agent control) lead.
- **Layout:** follow the page's existing bento anatomy (`dm-` prefix). A grid of small tiles is
  the likely shape. Every value is a token; it must survive all 30 theme × skin combos.

### 3c. Screenshots

- **Place:** inside or beside the Features box (fork for him), 2–3 pictures.
- **How to make them:** in the app repo, `node scripts/shots.mjs` drives the web demo (the real
  UI with mock songs) in headless Edge and writes PNGs to `shots/<app version>/`. The guide is
  the app's `docs/guide/SHOTS.md` (§3 the shot list, §5 the output). Shots that exist today
  (0.25.1): `midi-home`, `max-overview`, `compass-open` (Moonlight × Glass). Add a shot to
  `shots.json` for any new picture; do not hand-crop a screen capture.
- **Where they go here:** `assets/deetsmusic/shots/<name>.png` (a new folder). Keep each file
  small: the site has no build step, so the file served is the file committed. Export at the
  size shown, about 2× for sharp text, and check the weight before commit.
- **Mock data only.** The pictures come from the demo's mock tracks, so they show no real
  library. Do not take pictures of Aditya's own app.
- **Alt text** is a string in `strings.js` (`[ph]`).
- **Forks for him:** which shots (a proposal: Midi Home, Max overview, the mini player); which
  look (one look for all, or a different theme per shot to show the themes); whether a picture
  links to the demo (`/deetsmusic/demo/`).
- **Note:** the shots runner exists in the app repo. Do not build a new capture tool.
- **As built (2026-10-06):** three pictures (`max-overview`, `midi-home`, `compass-open`) in all
  30 looks, named `<shot>.<theme>-<skin>.webp`. `deetsmusic.js` (`renderShots`) sets each
  `<img>`'s src from `<html>`'s `data-theme` / `data-skin` and follows a change. Each picture
  links to `demo/`. WebP at about 2× display width (Max 960 px, Midi 600 px), quality 82.
- **Re-shooting** (when the app's look changes):
  1. Shoot from a clean checkout of the app at a release, never the working tree: another
     session may have work in progress. `git worktree add --detach <scratch>/dm-shots HEAD`, with
     `node_modules` as a junction to the app's own.
  2. **The trap:** through the junction, the worktree shares Vite's dependency cache with the
     app repo. Every page then fails with `504 (Outdated Optimize Dep)`, and every shot comes out
     as a blank, flat-colored frame. Give the scratch copy its own cache: add
     `cacheDir: ".vite-shots-cache"` to its `vite.demo.config.ts` (scratch only, never commit).
  3. `node scripts/shots.mjs --only midi-home,max-overview,compass-open --out <scratch>/shots`.
  4. Convert with Pillow (dev-time only): resize to the widths above, save WebP q82, and reject
     any frame whose pixels barely vary (a blank one). Copy the 90 files over the old ones.

### 3d. Requirements + Trust block

- **Place:** fork for him — inside the Install box under `installNeeds`, or a small box of its
  own after Features. The existing `installNeeds` string is his ("Windows 11 and an Apple Music
  subscription.") — **do not edit it**; add new keys beside it.
- **Facts (verified 2026-10-06, §4):** Windows 11, x64; the installer is a per-user NSIS setup
  about 7–9 MB (the page already shows the live size from the releases route); WebView2 (part of
  Windows 11); signed by Aditya Sundaram (Authenticode); AirPlay asks once for a Windows firewall
  rule on the first Connect (one UAC prompt); MIT license; source on GitHub.
- **Links:** the GitHub repo URL. The license: link to `LICENSE` in the repo.
- **VirusTotal — fork for him:** a link per release means someone uploads each new installer to
  VirusTotal at release time. That is a new step in the app's release flow
  (`docs/ops/RELEASE.md`). Options: (a) skip VirusTotal; the signature and the public source do
  the trust work (recommended for pass 1); (b) add the step to the release flow and a `vt` field
  to the releases route; (c) a hand-pasted link for the latest release only.
- **Windows 10:** do not claim it. The app says Windows 11 and nobody has tested 10.

### 3e. Files touched by pass 1

- `deetsmusic/index.html` — the new markup (no copy in it: `data-s` keys only).
- `deetsmusic/strings.js` — new `[ph]` keys. The CLAUDE.md copy table says DeetsMusic has
  "zero `[ph]` left"; update that row in the same commit.
- `styles/main.css` — the `dm-` section only.
- `assets/deetsmusic/shots/` — the pictures.
- `deetsmusic/mock.js` — only if a new block reads data (pass 1 needs none).
- `deetsmusic/deetsmusic.js` — only if a block needs behavior (pass 1 likely needs none).

## 4. The fact sheet (verified 2026-10-06)

Sources are in the app repo unless noted.

### 4a. Product
- Name and one-liner: "A lightweight Apple Music player for Windows 11." (`tauri.conf.json`
  `shortDescription`).
- Free. No account with DeetsMusic. An Apple Music subscription is needed.
- Repo: `https://github.com/deets-137/DeetsMusicWindows`, public, MIT.
- **GitHub Issues and Discussions are OFF**, and pull requests are not merged (app README). So the
  GitHub link is for reading the source, not for support. Support is this page's boards and the
  app's Settings › Bugs form.

### 4b. Install
- Windows 11, x64. NSIS per-user installer (`tauri.conf.json` `bundle.targets`).
- Signed by Aditya Sundaram (Authenticode, since 0.5.0). SmartScreen still warns until download
  reputation builds; the page already explains this (support.md "The page").
- Updates install silently through the app's updater.
- AirPlay: the first Connect asks for one inbound firewall rule (one UAC prompt)
  (`docs/integrations/AIRPLAY.md`).

### 4c. Privacy and telemetry — what is true today
From the app README "Privacy":
- Sign-in, library, search and playback go straight to Apple. The Apple sign-in token stays on
  the PC.
- The app fetches a developer token from `music-api.deets.solutions/token` about once a week;
  the request carries the app version and a fixed build key, nothing about the user.
- The log stays on the PC. It leaves only in a bug report with Attach log on, and the user sees
  the text first.
- "No analytics, no listening history leaves your PC."
- **Check before you write a telemetry line:** Last.fm (when the user connects it), Discord
  presence, Friends and listening rooms each send something by the user's choice. A "no
  telemetry" line must not read as "nothing ever leaves". **Usage counts are designed, not
  built** (app `docs/features/USAGE-COUNTS.md`); if they ship, the page's privacy text changes
  in the same release.

## 5. The house rules that bite here

- **Copy:** Claude adds `[ph]` strings only. Never edit an un-prefixed string. Aditya leads the
  page's design (support.md "The page").
- **No dependencies, no build step.** Plain HTML/CSS/JS.
- **Tokens only.** No hex, no hard-coded px in a rule. Survive all 30 theme × skin combos.
- **Run it:** `python -m http.server 8787` (or a free port; see HANDOFF.md "Run it").
  `?mock` gives the page sample data.
- **Verification is his.** Check the console and the DOM counts, then hand off. Do not run a long
  click-through.
- **Update [HANDOFF.md](HANDOFF.md) "Next up"** in the same commit as the work.
- Commit only when he asks.

## 6. Later — not in pass 1

In rough order. Each one is his fork before it is built.

1. **Support path** (hark #4): one line that says the Suggestions board takes ideas, Known
   issues takes bugs, and the app's Settings › Bugs form sends a private report with the log.
   One real contact — fork for him (an email, Discord). GitHub Issues stay off.
2. **Contrast** (hark #5): measure the page's faint secondary text (the installer size, the
   requirements line, the uptime labels) in every dark theme. Fix it at the token, not per rule.
3. **The earlier-releases row:** a cue that it scrolls sideways.
4. **A sticky Download pill** once the hero scrolls away.
5. **Collapse Release notes** under Features.
6. **A privacy / telemetry line** from §4c.
7. **Sign-in explainer:** how the Apple sign-in works, when it expires, how to sign out. Read the
   app's `docs/architecture/DATA-ARCHITECTURE.md` (auth) first.
8. **Benchmarks** (market read): RAM, CPU, cold start against Apple's app and the others. The
   tools are in the app repo (`scripts/heaviness-sample.ps1`, `npm run bench`). Publish the
   method with the numbers.
9. **The tip jar — before the Reddit launch post.** His decision (§2). Before it is built:
   read Apple's MusicKit terms on "indirectly monetize access" and decide how the tip jar is
   worded and placed so it pays for the developer's work, not for access to Apple Music. That
   reading is his. Then: the provider, where the link sits (this page, the app, or both), and
   its copy.
10. **The Reddit launch post** (r/AppleMusic first): screenshots, honest limits (no lossless, no
    exclusive mode, Windows 11 only), fast replies. Needs pass 1, the tip jar, and ideally the
    benchmarks.
11. **winget** — a free channel that fits "no Microsoft Store". Not decided; offer it.

## 7. The Ocean skin on the site — bring it up to the app — BUILT 2026-10-06 (uncommitted)

**His ask (2026-10-06): update the website's Ocean theming.** Settled in §2a, then built the
same day. 7a–7d below are the plan as written before the build; **7e is what was built.**

### 7e. What was built (2026-10-06)
- **Files:** `js/ocean.js` (controller, a port of the app's `src/ocean.ts`),
  `js/ocean-worker.js` (the painter, a port of `src/ocean-texture.ts` + `src/ocean-worker.ts`,
  plain JS, classic Worker), `js/controls.js` (new `.ocean` markup; loads `ocean.js` the first
  time the skin is Ocean; `DeetsAppearance.offerSotd` / `heldSotd`; the old trains kept as
  `buildClassicOcean()`), `styles/chrome.css` (§Ambient layers: bands, glow, pause / reduced
  motion / Off; the classic sea under `.ocean[data-sea="classic"]`; skin import bumped to
  `?v=2026-10-06`), `styles/skin.css` (the app's `--ocean-*` tokens, values one to one),
  one line each in `js/home.js` and `sotd/sotd.js` (hand songs.json over),
  `tanks/designer.html` (`data-ocean-sea="classic"`). Docs: [ui.md](ui.md) "Motion",
  [architecture.md](architecture.md), [tanks.md](tanks.md), [ui-direction.md](ui-direction.md).
- **The swell** is the app's: same rows, bands, seeds, tokens, roll and bob timings, the
  `light-dark()` crest ink, the trough shade, REPAINT_PX 24, dpr capped at 2.
- **The glow** is the app's `asGlow` and CSS (`--ocean-glow` 0.28, 2.4 s crossfade), fed by
  today's SOTD cover (the newest song with `artwork_url`; songs.json lists oldest first).
- **Deviations from the app:**
  - The cover's color is found from pixels, not Apple's palette (the site has none): the
    60×60 cover is binned (3 bits a channel), the bins covering ≥ 4 % of it (up to 6; else the
    top 3) are the candidates, and the most colorful wins, as `albumColor` ranks bg/c1/c2.
  - No heave, ripples, neon album light or `.ocean__heave` wrapper (§2a scope).
  - No-Worker / no-OffscreenCanvas fallback: the painter loads as a plain script and paints
    on the main thread, one band per task (the app needs no fallback).
  - While the radio shell is open, the parent page's sea is `display: none`: the shell covers
    it, and the framed page runs its own.
  - Paths resolve from `controls.js`'s own `src`, keeping its `?v=`.
- **Verified** (headless Edge, fresh profile): `/`, `/sotd/`, `/deetsmusic/?mock`, `/tanks/`,
  `/radio/` in all 6 themes with skin Ocean: the three bands get blob backgrounds and fade
  in, `--ocean-glow-color` is set, no console errors from the sea (the only errors are the
  local-origin CORS blocks on `id.` / `music-api.` and missing tank sprite PNGs, both
  unrelated). `/tanks/designer.html` builds the classic trains and never loads `ocean.js`.
  The main-thread fallback (OffscreenCanvas removed) paints too. A page with no SOTD fetches
  songs.json once and caches the color.
- **Left for him:** the visual pass in all 6 themes (light and dark), on a weak machine
  too (§7d's cost check was not run). The radio shell's hide-the-parent-sea rule was not
  exercised headless. No new strings.

### 7a. What the site has
`js/controls.js` injects an ocean layer: masked tile boxes from a geometry table, rolling
(`wave-roll`) and bobbing (`wave-bob`), stepped at `--ambient-fps`, held still under reduced
motion. Sand edges on cards (`data-ocean-edges="sand"`, `main.css` §Ocean sand edges). Docs:
[ui.md](ui.md) "Ambient layers", [ui-direction.md](ui-direction.md) "Ambient layers".

### 7b. What the app has now (shipped 0.14.0, 2026-09-23)
The app's `docs/features/OCEAN.md` §3. In short:
- The masked wave trains were **replaced** (they gave no depth and cost the most when idle).
- **A swell in perspective:** about 29 rows of Gerstner crests, thin and close at the horizon,
  tall and wide at the bottom; three bands (far, middle, near) that roll at their own speed
  (90 / 90 / 100 s) and bob a little. Each band is painted once to a PNG (in a Web Worker) and
  only moved by the compositor. No masks.
- The water gets darker toward the bottom; each wave's body hides the water behind it.
- The crest ink is a `light-dark()` pair: lifted on a light theme, sunk on a dark theme.
- **Glow from the deep** in the album's color, **heave** with the music's loudness, and
  **ripples** at a play or a drop. These three come from the player.
- Card opacity row; sand edges still work.
- What he liked and wanted kept: "deep, ominous, powerful", and the sunken cards. He rejected a
  brighter, caustic-light version as "a swimming pool".

### 7c. What to settle with him first
1. **Scope.** The swell (rows, depth, bands) is the core and fits a static site. The glow, heave
   and ripples need a player; the site has none outside Radio and the demo. Options: (a) the
   swell only (recommended); (b) the swell plus a ripple at a click; (c) also the glow from the
   home page's DeetsMusic card or the SOTD cover.
2. **How to paint it.** The app paints the bands in a Worker with TypeScript
   (`src/ocean-texture.ts`, `src/ocean-worker.ts`). The site has no build step: port it to plain
   JS in `js/`, or pre-render the band PNGs per theme and ship them as files (cheaper at run time,
   but a theme change needs a set of files per theme).
3. **Tanks** is pinned to Ocean × Moonlight and injects its own ocean layer
   ([tanks.md](tanks.md) "the injected ocean layer"). Decide whether Tanks follows the new sea or
   keeps the old one.
4. **The sand edges and the Ocean sliders** (ui.md "Skin sliders") must keep working.

### 7d. Rules for the build
- One shared ocean module, like the rest of the ambient layers in `controls.js`. Do not copy it
  per page.
- Animate only `transform` and `opacity`. Pause while the tab is hidden. Reduced motion: hold
  still, stay visible (the site's existing rule).
- Every color from the theme roles; the crest ink, water and trough as tokens.
- Check cost on a weak machine: the app moved to painted bands because masked layers were the
  idle cost without a GPU.

## 8. Desk test for pass 1 (he runs it)

1. Open `localhost:8787/deetsmusic/?mock`. The tagline sits under the title. Every new string
   shows `[ph]`.
2. Below Install and Status: the Features box with its items, then the screenshots. Then
   Release notes.
3. The Requirements + Trust lines show the facts in §4b and a working GitHub link.
4. Switch through a light and a dark theme and all five skins (the Vibe menu). Nothing breaks,
   and the secondary text is readable in the dark themes.
5. Narrow the window to phone width. The features and pictures stack; nothing scrolls sideways.
6. The console is clean.
