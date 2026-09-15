# UI

The site's interface components: how they're built, what markup and
classes they use, and the tokens they lean on. This is the component-level
companion to [architecture.md](architecture.md) — that file explains the
theme × skin token tiers and the page layout; this one documents the
interactive chrome that sits on top of them. Start there for the token
system; come here to change a control.

Every component below must survive all 30 theme × skin combos and reference
only tier-2/3 tokens (no hex codes, no hardcoded geometry) — see the token
discipline note in [architecture.md](architecture.md#appearance-system-theme--skin).

## The appearance picker (Vibe menu)

The site's one piece of app-like UI: a single header button that opens a
two-axis theme/skin chooser. Built entirely by
[js/controls.js](../js/controls.js); styled in the "Settings menu" section
of [chrome.css](../styles/chrome.css) (around the `.settings__trigger` rule).

### Mount and injection

Each page carries one empty mount at the right end of the header, after the
nav links:

```html
<span class="settings" data-settings></span>
```

On load, `controls.js` (`buildMenu()`) finds `[data-settings]`, injects the
`.settings__trigger` button — labelled **Vibe** — and appends a hidden
`.menu` popover. If the mount is absent the script no-ops — pages opt in by
placing the span.
The same script also injects the two decorative background layers (ocean,
storm) that certain skins opt into; those are documented in
[architecture.md](architecture.md#appearance-system-theme--skin), not here.

### Structure: trigger → menu → group → flyout

The menu is a **two-level accordion + flyout**, not a flat list:

```
.settings                     mount span (position: relative anchor)
└─ .settings__trigger         the Vibe button (aria-haspopup, aria-expanded)
└─ .menu                      popover, hugs the right edge (right: 0)
   ├─ .menu__group            one per axis; gets .is-open when expanded
   │  ├─ .menu__row           clickable header button (Theme / Skin) + ‹ chev
   │  └─ .flyout              chip panel; opens LEFT (right: 100%)
   │     └─ .flyout__item     one chip per option (role menuitemradio)
   └─ .menu__group            (the second axis)
```

`buildRow(name, axis, groups)` builds one group from an entry in the `AXES`
table. Clicking a `.menu__row` toggles `.is-open` on its group and collapses
the others (accordion — only one axis open at a time). The `.flyout` is shown
purely by CSS (`.menu__group.is-open .flyout { display: flex }`) — there are
no hover targets or dead-zone gaps to chase.

The flyout opens to the **left** because the menu is pinned to the right edge
of the header (under the right-aligned Vibe button); the ‹ chevron points at
where it will appear.

### Self-tasting chips

The nice trick: every `.flyout__item` sets its *own* axis attribute
(`chip.setAttribute(axis.attr, opt.id)`), so its tokens resolve to *that*
choice. A theme chip shows its own color; a skin chip renders its label in
its own `--font-title`. Skin chips sit on `--surface` (skins name no color)
and bump their font a hair for legibility (`.flyout__item[data-skin]`). The
active chip carries `aria-checked="true"` and shows a `•` in a reserved
right gutter (`.flyout__item::after`).

### State, defaults, and no-flash

`apply(axis, id)` sets `data-theme` / `data-skin` on `<html>` and persists to
`localStorage` under `deets-theme` / `deets-skin`. A saved choice wins;
otherwise **both** axes follow the OS light/dark preference, landing on one
of two curated pairs: **Press × Lilac** in light, **Retro-Future × Black &
Red** in dark. (Screen width no longer enters into it — the old
Retro-Future-desktop / Ocean-mobile split is gone.)

A saved choice is resolved through `RETIRED`, a map of retired ids to their
successor, before it is applied — and `apply()` then writes the successor
back, so the migration self-heals on first load. One map serves both axes
(safe only while no id sits on both). It currently carries the retired `desk`
skin plus the five ids renamed on 2026-08-08; see
[architecture.md](architecture.md), "Renaming a theme or skin id".

That default logic lives in **two places on purpose**: the `AXES[...].def`
fields in `controls.js`, and the inline pre-paint `<script>` in every page's
`<head>` (which resolves both axes before CSS paints, so there's no flash of
the wrong look). The `RETIRED` map is mirrored there too, as `R`. **Change
one, change the other** — all three must stay in sync. Adding a page means
copying that head script too.

### Dismissal and keyboard

- Trigger toggles the menu; `aria-expanded` tracks open state.
- Flyouts are `role="menu"`; chips are `role="menuitemradio"` with
  `aria-checked`.
- **Escape** closes the menu and refocuses the trigger.
- **Outside click** closes it (capture-phase listener on `document`,
  scoped by `mount.contains(e.target)`).

### Material tokens

The menu and flyouts adopt the skin's panel material through two skin tokens
(`skin.css`): `--menu-surface` (opaque `--surface` for most skins; a
translucent `color-mix` for Glass) and `--menu-backdrop` (`none`, except
Glass's `blur(16px) saturate(1.4)`). Shape comes from `--radius-panel` /
`--shadow-panel`, matching the page bar and journal control bars.

### Known constraints (read before a revamp)

- **The picker itself isn't responsive**, and no longer needs to be: the menu
  hugs the right edge and its flyout opens left (into the screen), so it fits
  down to phone widths. What *is* responsive is the nav beside it — see the
  mobile nav menu below.
- **Click-only chips.** Despite radio semantics there's no arrow-key roving
  between chips, and the accordion rows aren't arrow-navigable either.
  Selection and dismissal are keyboard-reachable via Tab/Enter/Escape, but
  in-menu arrow navigation is not implemented.
- **Two axes are assumed.** The DOM and accordion behavior generalize to N
  groups, but the "menu hugs right, flyout opens left" geometry is tuned for
  the button's right-of-header placement.
- **Every combo, every token.** Any new surface, chip state, or animation
  must resolve through tier-2/3 roles and hold up across all 30 combos — add
  a role rather than a literal.

## The mobile nav menu

Below the 56rem breakpoint the six inline nav links plus the Vibe button
don't fit (they overflow tablet widths, not just phones — which is why this
sits wider than the 41rem skin-default breakpoint), so the nav collapses:
the inline `.site-nav` is hidden and
the **"Deets" wordmark itself becomes the trigger** for a `.nav-menu`
dropdown of every destination (Home + the page's links, with a `▾` caret).
Desktop is untouched — the wordmark stays a plain home link and the inline
nav shows.

Built by `controls.js`'s `buildNavMenu()`, mounted in `.site-brand` (the
wordmark's `position: relative` anchor). Two decisions keep it honest:

- **Links are cloned from the live `.site-nav`**, so the destinations and each
  page's `aria-current` stay defined in one place — the page's own markup —
  rather than re-listed in JS. A "Home" link is prepended (the wordmark no
  longer navigates on mobile). Only links marked **`data-nav-core`** are
  cloned (currently SOTD + Cool Stuff, on every page's nav): the deep-cut
  tabs — Movies, DeetsRadio, League, Resume — are desktop-only by design.
  A page with no marked links falls back to cloning them all.
- **The wordmark serves both roles from one element.** Its click handler
  checks `matchMedia("(max-width: 56rem)")`: when narrow it opens the menu
  (`preventDefault`), on desktop it follows the `/` link. `syncMode()` (run on
  load and `resize`) adds/removes `aria-haspopup` / `aria-expanded` as the
  viewport crosses the breakpoint, and closes an open menu on the way up.

Dismissal mirrors the Vibe menu: Escape (refocusing the wordmark) and
outside-click, both scoped to `.site-brand`. CSS hides `.nav-menu` outright
at ≥ 56rem so it can never show on desktop.

## Motion

Ported from DeetsMusic 2026-09-15 ([ui-direction.md](ui-direction.md), steps 1–3).

- **Base durations** are DeetsMusic's: `--dur-fast .12s`, `--dur-med .18s`. Skins still
  override (Press `.1/.16`, Glass `.2`, Retro-Future `.08`).
- **Pop.** Every floating panel (`.menu`, `.nav-menu`, `.tb-pop`) fades and scales in from
  the corner it hangs from, driven by its `hidden` attribute: `@starting-style` plus
  `transition: display … allow-discrete`, no JS. Tokens are `--pop-in/-out/-shift/-scale/-ease`
  in `skin.css`. A left-anchored panel sets `--pop-origin: top left` in its own rule.
  `.flyout` (keyed on `.menu__group.is-open`) and `.nav-group__menu` (keyed on `:hover` /
  `:focus-within`) carry twin rules. `.pop-enter` with `--pop-i` staggers rows in, for the
  settings panel to come.
  - **Measuring a pop:** use `offsetWidth`/`offsetHeight`, never
    `getBoundingClientRect()`, right after showing it. The rect reads the 0.97 starting
    scale (radio.js / deetsmusic.js context menus).
- **Ambient layers** (ocean, aurora, storm) are injected by `controls.js` and animate only
  `transform` and `opacity`:
  - Ocean: masked tile boxes (masks built from the geometry table in `controls.js`).
  - Glass's aurora: its own `.aurora` layer of three drifting blobs (`--aurora-*` tokens),
    no longer a `background-position` drift on `body::before`. `--canvas-bg` is for still
    patterns only.
  - Storm: a clip wipe (strike box slides, hold box counter-slides) instead of a
    `stroke-dashoffset` draw under a drop-shadow.
  - Loops step at `--ambient-fps` (30) where `round()` and unit division are supported,
    and pause while the tab is hidden (`data-ambient="paused"`).
- **Reduced motion:** aurora freezes, ocean holds still but stays visible, storm hides,
  pops appear instantly, `--hover-lift` is `none`, and spinners slow to `--dur-spin: 2.4s`
  rather than stopping.
- **Focus ring** covers `a`, `button`, `summary`, `select`, `[role=switch]`,
  `[role=slider]`. Text inputs show focus with their own border.

## The page bar and shared chrome

The header panel that opens Home, Resume, and Cool Stuff (`.page-bar`), and
its relationship to the journals' sticky `.sotd__bar`, is documented in
[architecture.md](architecture.md#page-bar). The journal toolbar/popover kit
(pills, facet popovers, search — duplicated between `sotd.js` and
`movies.js`) is covered in
[architecture.md](architecture.md#toolbar--popover-kit). Those aren't
repeated here; this doc is the appearance-picker reference.

## Toasts (js/toast.js)

Shared chrome like `controls.js` — loaded on every page, deliberately NOT
part of the duplicated toolbar kit (a toast has no page-specific logic).
`window.DeetsToast.push({ kind, text, sticky, timeout, actions })` →
`{ dismiss, update }`; the API contract is documented in the file's
header (`update(text)` rewrites the toast in place — the cities page's
disconnect-grace countdown ticks through it).

- **Host**: a fixed top-right column under the header (`.toast-host`,
  z 50 — above the radio site-shell (35) and row menus (40), so the room
  reaches you while browsing in the shell). Newest on top, capped at 4
  (the oldest timed toast yields first). `aria-live="polite"`; an error
  toast carries `role="alert"`.
- **Severity wears the traffic-light roles** (2026-07-14, Aditya's call):
  success `--go`, warn `--pause`, error `--stop` as a left accent stripe;
  info stays neutral (`--panel-border`). Every theme — the monochrome
  ones included — expresses them in-family for free, since the roles
  already exist per theme.
- **Timed by default** (3.2 s): a thin countdown bar drains over the
  toast's life; hovering pauses bar and reaper together. `sticky: true`
  never times out — give it an action; **Dismiss is an ordinary action
  button** on sticky toasts (timed ones get none). Fly-in from the right
  on `--dur-med`/`--ease-ui`; reduced-motion drops the slide.
- **Zero copy in the module.** Callers own their strings — the radio page
  feeds `strings.js` entries (its transient pops migrated 2026-07-14:
  invite copied, perm denied, disconnected sticky + reconnect,
  kicked, room closed, and the sticky audio-blocked toast that the
  unblocking click retires; the meta line keeps persistent status).
  Ephemeral by design: no history, no queue beyond the visible stack.
