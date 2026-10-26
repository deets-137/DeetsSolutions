---
status: project
sources: [radio/radio.js, radio/transport.js, radio/transport-mock.js, radio/strings.js]
updated: 2026-10-14
---
# DeetsMusic Rooms on the site — the Radio tab rebuilt as the rooms web port

> **Opened 2026-10-14** for a DeetsSolutions session to pick up. The design and the owner's
> calls are in the DeetsMusic repo: `../DeetsMusic/docs/features/WebRooms.md`. **Read its §1,
> §3, §6, §7, §9.7 and §10 first.** This doc is the site's part only (WebRooms.md §9.3 H: "the
> site page") and the steps around it. **Nothing on the site is built.** The app side is built
> and checked in a browser (WebRooms.md §10.4). The rooms worker change is NOT deployed.

**Terms used here.**
- **The port**: the DeetsMusic app's own Search, Queue, History and Now Playing cards, built for
  a browser (`npm run listen:build` in the DeetsMusic repo → `dist-listen/`). It joins and
  starts rooms on the DeetsMusicRooms worker (`rooms.deets.solutions`).
- **The Radio tab**: `radio/` on this site today, on the old DeetsRadio worker
  (`radio-api.deets.solutions`). See [radio.md](radio.md) and [youtube.md](youtube.md).
- **The site-shell**: the Radio tab's way to keep a room playing while the visitor reads other
  site pages: they load in a frame OVER the room page ([radio.md](radio.md), "The site-shell").
- **The page**: what `deets.solutions/radio/` becomes.

---

## 1. What he decided (2026-10-13, in the DeetsMusic session)

| # | His call |
|---|---|
| W1 | A web member gets in **by the 8-character room code only** (typed, or from the invite link). |
| W2 | **Rebuild the Radio tab** as the port. No listener management on the site. No Match Desk. **YouTube torn out.** |
| W3 | **No friends** on the web. A web member is a guest with a typed name. |
| W4 | **Reuse the Radio tab's developer token** (`radio/dev-token.js` and its nightly job stay). |
| T | **Now Playing is the app's card, 1:1**, in place of the Radio tab's own player strip. |
| H | **History lists the room's songs** (the worker's last 50). |
| R | **A web visitor may start a room**, with no guest-controls panel, so it is **open to everyone**. |
| S | **Keep the site-shell**: the room keeps playing while the visitor browses the site. |
| N | The name is **"DeetsMusic Rooms"** on the menu link and the page. The URL stays `/radio/`. |
| P | **Phones: not now.** No phone layout and no phone test. |
| — | **No sign-in probe** (his call): the Radio tab already signs in and plays full songs from this origin. The port keeps that shape: MusicKit runs in the TOP page (§3). |
| — | The old DeetsRadio worker **goes offline** after the page is live (§6). |

Rules that follow from his calls (WebRooms.md §3): every listener needs an Apple Music
subscription and signs in (no 30-second preview tier); no YouTube entries; catalog songs only.

---

## 2. What the page is today (seen 2026-10-14 on `npm run dev`, a 530 px wide window)

**Out of a room** (`/radio/`): the site header (Deets menu, the Google sign-in, Vibe). Under
it, the large title **"Radio Room Code"** is itself the code field. Under that, one line in his
words: *"Type in the Radio Room Code to tune in to a room (duh). This is what DeetsMusic's
Friends feature used to be haha"*. Nothing else shows. The Ocean sea fills the page.

**In a room** (`/radio/?mock`, then a code and **Open the Room**), top to bottom:
1. The code as the title (here `CLAUDETEST`).
2. A row of chips: **1 Listeners ▾**, **Invite**, **Music Source ▾**, **Disconnect**, **Close Room**.
3. The player strip: the cover (his blank-cover sprite), "Silence / Queue something to …", a
   bar, Previous / Play / Next, a volume square.
4. The three-tab switch: **Search | Queue | History**, one card shown at a time.
5. The Search card: "Search (using the Apple Music Catalog)" and the Recents chips.
6. The **Listeners** card: the Open / Restricted pill, and per member the Queue and Play/Pause
   **R | E** pills and a ×.
7. The **Match Desk** card (the YouTube matching), under the fold.

Hidden parts in the markup: `radio-gate` (the join preview), `radio-room`, `radio-crew` (the
Listeners card), `radio-desk` (the Match Desk).

---

## 3. What the page becomes

- The site header stays, with **"DeetsMusic Rooms"** in place of "DeetsRadio" (§1 N).
- **The port fills the page**: Now Playing over the Queue on the left, Search and History beside
  them. This is the app's own Max layout with two cards (WebRooms.md §10.3 item 1).
- **MusicKit runs in the top page**, `/radio/` itself, as in the Radio tab today. The port is
  NOT a frame inside a host page (the web demo is; this page must not be). This is why no
  sign-in probe was needed (§1).
- **The site-shell** (§1 S): a same-origin click in the site header loads that page in a frame
  over this one, and the room plays on. The dock the shell shows (today: a square player over a
  tabbed Queue | Search | History column, a bottom strip under 66rem) is rebuilt around the
  port's cards.
- **Joining:** the port's Room panel (the app's, with less): Apple Music › Sign in, Your name,
  Start a room, Join with a code. In a room: the code, Copy code, Copy invite link, the member
  list, End room or Leave room. No Permissions, no Remove (WebRooms.md §10.2).
- A link `/radio/?code=K7QM4XHT` opens the panel with the code filled in. The worker's invite
  page (`rooms.deets.solutions/j/<CODE>`) has a **Listen in your browser** button that opens it.

---

## 4. Open forks (his) — 2 real forks

**F1. How the port's look and the site's look share one page.** The app and the site use the
SAME theme attribute (`data-theme`, `data-skin` on `<html>`) and the SAME token names
(`--canvas` and the rest; the site's tiers were ported from the app's). With both stylesheets
on one top page, one side's values overwrite the other's. The web demo avoids this with a frame,
which this page cannot use (§3).
- **A (recommended): scope the port's styles at build time.** The DeetsMusic build rewrites the
  port's CSS so every rule applies only under the port's root element (`html[data-theme]` →
  `.dm-root[data-theme]`, `:root` → `.dm-root`). The site header keeps the site's look; the
  cards keep the app's. Cost: a Vite step in the DeetsMusic repo, and a check that every app
  selector that starts at `html` or `body` still matches.
- B: the page drops the site's stylesheets and draws its header with the app's tokens. Cost: the
  Radio page's header looks a little different from every other site page.
- C: the port in a same-origin frame, like the demo. Cost: Apple's sign-in window inside a frame
  is untested (his "no probe" call covered the top page only), and the site-shell would have
  two frames on one page.

**F2. The out-of-room entry.** Today the page opens on his large "Radio Room Code" title field
and his line under it. The port opens on its cards, with the Room panel behind the title bar's
Room item.
- **A (recommended): keep his entry.** Out of a room, the page shows his title field and his
  line. A code in it calls the port's own join (the same code path as the Room panel's Join).
  Start a room and Sign in sit under it as two buttons. In a room, the cards take the page.
  Cost: a small bridge from the site's field to the port's `joinRoom` and `startRoom`, and new
  strings (he writes them; `[ph]` until then).
- B: the port's Room panel only. The page opens on the empty cards. Cost: his entry and his line
  go.

Everything else follows from his calls. **Copy:** every new string goes into
`radio/strings.js` with a `[ph]` prefix, and he replaces it (CLAUDE.md, "Copy"). The Radio tab's
current strings are all his; take out only the ones whose feature goes (§5).

---

## 5. What comes out of the site

- `radio/radio.js` (2,451 lines), `radio/apple.js` (442), `radio/transport.js` (191),
  `radio/transport-mock.js` (585), `radio/youtube.js` (619), `radio/yt-key.js`.
- The radio rules in `styles/main.css` (about 313 lines), and the few in `chrome.css` and `skin.css`.
- The Match Desk, the D1 match registry's page side, the auto-resolver, the crew panel, kick,
  the Open / Restricted mode, the device tokens, the preview listener.
- [youtube.md](youtube.md) becomes history; [radio.md](radio.md) gets a header that points here.
- **Stays:** `radio/dev-token.js` and its nightly re-sign job (§1 W4); the blank-cover sprite
  `assets/sprites/radio/cover-blank.svg` (his drawing; the port can use it for an empty cover
  if he wants, a later call).
- **The YouTube key** in `yt-key.js` stays in this PUBLIC repo's git history after the file
  goes. He revokes it in the Google Cloud console.

---

## 6. The order of work

1. **His two forks** (§4).
2. **DeetsMusic repo:** F1's build step, if he picks A. Then `npm run listen:build`, and a
   `listen:publish` step like `demo:publish` that copies `dist-listen/` into this repo's
   `radio/app/` (WebRooms.md §10.6 item 2). The built files are never hand-edited here, as with
   `deetsmusic/demo/app/`.
3. **This repo:** `radio/index.html` becomes the page (§3): the site header, the port's root,
   the site-shell, the token script `./dev-token.js`, and F2's entry.
4. **The rooms worker deploy** (the owner's call, from `../DeetsMusicRooms`): it adds
   `https://deets.solutions` as an allowed origin, the `client` field, and the invite page's
   new button. Until then the live worker refuses a room made from this page. A rooms deploy
   drops every live room socket.
5. **The desk test:** WebRooms.md §10.5, then on a Mac in Safari against deets.solutions.
6. **The old Radio tab out** (§5), in the same commit as step 3 or right after.
7. **The old worker offline** (WebRooms.md §6.1): export the `deets-radio-matches` D1 to a
   file; delete the `deets-radio` worker, its custom domain, its two Durable Object classes
   and the D1; archive the DeetsRadio repo; revoke the YouTube key; update this repo's
   CLAUDE.md "Backends" table and HANDOFF.

---

## 7. How to run each side today

- **The site:** `npm run dev` in this repo (`scripts/dev.js`, a free port from 8787 up).
  The old tab's in-room view without a worker: `/radio/?mock`.
- **The port on its own:** `npm run listen` in the DeetsMusic repo. It takes port 8787 or 8788
  (the only two localhost ports the token's `origin` claim allows), so start it BEFORE the
  site's dev server, or the site takes 8787 first. The live rooms worker already allows any
  localhost origin, so the port works against it now.
