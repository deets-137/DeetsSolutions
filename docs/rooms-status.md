# The Rooms status row — what this site needs to set it up

> **Written 2026-09-17. The site side was built the same day** — §2b's markup is in
> `deetsmusic/index.html`, §2c's string is in `deetsmusic/strings.js` (approved by him the
> same day, no `[ph]` left), and `?mock`
> serves the row as healthy in every mode but `empty`. **§2a, the D1 insert, has not been
> run**, so the row reads "Not monitored" until it is. The worker it watches
> **is live**: `rooms.deets.solutions` (repo
> [DeetsMusicRooms](https://github.com/deets-137/DeetsMusicRooms), design in
> `../DeetsMusic/docs/integrations/ROOMS.md`). This doc is the site's side only — one more row in the
> DeetsMusic page's Status box, with its own dot, word, line and strip.
>
> It is **one insert and a paste**: one D1 row, one markup block, one string, and no new
> JavaScript. The page already loops over every `[data-dm-status-row]` and asks
> `/status?app=<id>` for each ([support.md](support.md), "The page").

**Terms used here.** **Rooms** — DeetsMusic's listening rooms: several copies of the app
follow one queue and one clock, each playing through its own Apple Music subscription.
**The worker** — `deetsmusic-rooms`, on `rooms.deets.solutions`. **The row** — a line in
the Status box: a dot, a subject, a word, a lead line and the six-hour strip.

---

## 1. What the row is watching

`GET https://rooms.deets.solutions/health` — the same shape the other two rows probe.

```json
{ "ok": true, "v": 1, "minV": 1 }
```

Three things make it safe to probe every five minutes:

1. **It answers before the rate limit.** The worker limits `POST /room`, `peek` and the
   socket join to 30 per minute per IP; `/health` is checked first, so the cron never
   spends that budget. (This is the same rule the installer row needed: the cron's
   in-process probe has no client IP of its own.)
2. **It touches no room.** No Durable Object is woken, nothing is written, and no room
   code, member name or queue is read. The reply is three constants.
3. **It reports the kill switch.** While the worker's `KILL_ROOMS` var is set, `/health`
   answers **503** with `{"ok": false, "reason": "off"}` — so switching rooms off shows as
   a red dot rather than a green one over a closed door.

Unlike the other two rows, this probe is a **real fetch across the edge**, because the
worker is a different worker on a different custom domain. So this row, alone of the
three, does see DNS and the edge — if it goes red while the other two are green, the
network between Support and Rooms is a live suspect.

---

## 2. The three changes

### 2a. One D1 row in DeetsSupport

The cron probes every app that has a `health_url` ([support.md](support.md), "What we
store"). Adding the row is the whole of the worker-side work:

```sql
INSERT INTO apps (id, label, health_url, sort)
VALUES ('deetsmusic-rooms', 'DeetsMusic rooms',
        'https://rooms.deets.solutions/health', 2);
```

```bash
npx wrangler d1 execute deets-support --remote --command "INSERT INTO apps (id, label, health_url, sort) VALUES ('deetsmusic-rooms', 'DeetsMusic rooms', 'https://rooms.deets.solutions/health', 2);"
```

`sort` 2 puts it under the Gatekeeper (0) and the installer (1). Checks start on the next
five-minute tick, and the strip fills over six hours; until then the row reads
`statusEmpty` on its own.

### 2b. One markup block in `deetsmusic/index.html`

Paste under the `deetsmusic-installer` row. It is the same block with two attributes
changed — nothing new to style, and `deetsmusic.js` picks it up with no edit:

```html
<div class="dm-status__row" data-dm-status-row="deetsmusic-rooms">
  <div class="dm-status__now">
    <span class="dm-dot" data-dm-status-dot data-state="unknown" aria-hidden="true"></span>
    <span class="dm-status__subject" data-s="statusSubject_rooms"></span>
    <span class="dm-status__word" data-dm-status-word></span>
  </div>
  <p class="dm-lead" data-dm-status-line hidden></p>
  <div class="dm-strip" data-dm-strip aria-hidden="true" hidden></div>
  <div class="dm-strip__legend" data-dm-strip-legend aria-hidden="true" hidden>
    <span data-s="stripOld"></span><span data-s="stripNow"></span>
  </div>
</div>
```

### 2c. Strings in `deetsmusic/strings.js`

One new string — the row's subject, **approved by Aditya in chat on 2026-09-17**:

```js
statusSubject_rooms: "DeetsMusic rooms:",
```

The words under the dot (`status_up`, `status_degraded`, `status_down`, `status_unknown`)
and the strip legend are already written and shared by every row.

---

## 3. What the dot means here

This is the part worth getting right, because "down" means something different for rooms
than it does for the other two rows.

| Reading | What is true for someone using DeetsMusic |
|---|---|
| **Up** | Rooms can be started and joined. |
| **Down** | **Rooms stop, including rooms already playing.** The worker keeps the clock, so when it is unreachable the apps in a room go quiet at the end of the song they are on and wait. Everything else in DeetsMusic keeps working — the library, playback on your own, playlists, the mint. |
| **Down, while the other two are up** | Only rooms are affected. Nobody's music stops unless they are in a room. |
| **Off (`KILL_ROOMS`)** | Deliberate. New rooms are refused and new members cannot join; rooms already running are left alone to finish. The dot reads down, and the reason in the strip cell is the 503. |

That "including rooms already playing" line is the one a visitor most needs, and the row
cannot say it — a status row is a dot and a word. If the box ever grows a sentence per
row, this is the sentence for this one. **Aditya's words, not mine, when it does.**

---

## 4. What the site must NOT show

The worker knows every live room's code, its members' display names and its queue. **None
of that belongs on a status page**, and `/status` never carries it: the row shows a dot, a
word and the check history, exactly like the other two. There is no room count on the
page, and the worker exposes no route that would give one.

A room code is the only thing protecting a room — eight characters, unlisted, no directory
(`../DeetsMusic/docs/integrations/ROOMS.md` §6). A "rooms live now" number would be harmless; a list
would not be. Do not add one without deciding which it is.

---

## 5. If the row goes red

1. `curl https://rooms.deets.solutions/health` — a 503 with `"reason": "off"` is the kill
   switch, not a fault. Clear `KILL_ROOMS` in the worker's `wrangler.jsonc` and deploy.
2. `npx wrangler tail deetsmusic-rooms` from the DeetsMusicRooms repo.
3. `node scripts/check.mjs https://rooms.deets.solutions` in that repo drives the whole
   protocol against the live worker — 28 checks. Note that two runs inside a minute trip
   the worker's own IP limit and the second will report failures: that is the guard
   working, not a fault.
4. Cloudflare dashboard → Workers → `deetsmusic-rooms`. The free-tier limit it reaches
   first is SQLite rows written (`../DeetsMusic/docs/integrations/ROOMS.md` §3.2), which is about 200
   evening-long rooms a day.

---

## 6. Not in scope here

The **Radio tab moving onto this worker** is a separate, older plan and is **not part of
this row** — see [HANDOFF.md](HANDOFF.md), "Next up". DeetsMusic decided on 2026-09-17
that the site is out of scope for rooms (`../DeetsMusic/docs/integrations/ROOMS.md` §13), so the Radio
tab keeps its own worker and its own name until this site decides otherwise. This doc adds
a status row for a worker the site does not otherwise talk to.
