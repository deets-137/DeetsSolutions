# Onboarding — the first-run walk

> **Built 2026-09-24, on the home page only.** All copy is `[ph]`, waiting for his pass.
> Ported from DeetsMusic's walk (DeetsMusic repo: `src/walk.ts`,
> `docs/features/ONBOARDING.md` §4). Read that doc for the ideas behind it; this one only
> covers what the site does differently.

Deets and Happy, the sprites that stroll along the bottom of every page (`js/walkers.js`),
walk to the thing each step names and stand beside it. A speech card in the toast material
holds the sentence.

**Files:** `js/walk.js` (the steps, the `[ph]` copy table `W`, and the logic),
the walk block in `styles/main.css`, the `--walk-*` tokens in `styles/skin.css`, and
the Settings › Tips row in `js/controls.js`.

## The steps (his picks, 2026-09-24)

| # | Stands by | Moves on when |
|---|---|---|
| 1 | the name (`.page-bar__title`): hello | Next |
| 2 | the DeetsMusic nav menu (App + Demo); on narrow screens, the DeetsMusic home card | Next, or the menu opens (hover/focus) |
| 3 | the Cool Stuff card title | Next |
| 4 | the Resume button | Next |
| 5 | the Vibe button | Next, or the Vibe menu opens |
| 6 | the middle of the screen: the send-off, with **Let's go** | — |

Steps 2 and 5 have an `openText`, a shorter line the card switches to while that menu is
open. The walk waits for the menu to close before it walks to the next step.

## What's different from DeetsMusic

- **Next is always on the card.** In the app, doing the thing moves the step on, and Next
  only appears after 9 s. On the site almost every thing to do is a link, and following a
  link leaves the page. So Next is there from the start, and only the two steps whose thing
  to try doesn't leave the page (a hover menu, the Vibe menu) also move on by themselves.
- **The layer sits under the header** (z 9; header 10). Both menus the walk asks you to
  open live in the header, so they always draw over the walk and the pointer never lands
  on the card on its way into a menu. The walk also steps aside, like the app's.
- **State is `localStorage["deets-tour"]`**: the NEXT step, `0` = done. There is no
  settings file to put it in. A visitor who follows a link mid-walk picks it up at the same
  step when they come back to the home page.

## When it runs

- **First visit to the home page.** "First" means no `deets-*` key in localStorage. Anyone
  who has picked a look, changed a setting or signed in has one, so regular visitors are
  never shown it unprompted.
- **`deets.solutions/?tour`**: always starts at step 1. This is the URL to put on job
  applications. The parameter is removed from the URL, so a reload resumes the walk instead
  of starting it again.
- **Settings › Tips › Show the tour again** opens `/?tour` from any page.
- Skip the tour, Let's go and Escape all end it (`deets-tour` = 0). Escape doesn't end it
  while a header menu is open, because that Escape closes the menu.
- While it runs, `walkers.js` sends no ambient strolls. Deets can't be in two places.
- Reduced motion: the sprites are placed, not walked, nothing pulses, and the walk still
  works.

## Testing

Clear the key and reload, or open `/?tour`:

```js
localStorage.removeItem("deets-tour")   // then reload: runs only if no other deets-* key exists
```

## Not built

- Walks on other pages (games, journals, DeetsMusic). This was considered and not picked
  on 2026-09-24; the home walk comes first.
- A framing header on `/deetsmusic/demo/`. That's part of the recruiter-path idea in
  HANDOFF, not this walk.
