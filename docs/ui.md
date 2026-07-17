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
of [main.css](../styles/main.css) (around the `.settings__trigger` rule).

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
otherwise the theme follows the OS light/dark preference (**Fairy** light /
**Moonlight** dark) and the skin defaults to **CyberStorm** on desktop,
**Ocean** on mobile (≤ 41rem; note the nav collapses earlier, at 56rem —
the two breakpoints are deliberately different).

That default logic lives in **two places on purpose**: the `AXES[...].def`
fields in `controls.js`, and the inline pre-paint `<script>` in every page's
`<head>` (which resolves both axes before CSS paints, so there's no flash of
the wrong look). **Change one, change the other** — they must stay in sync.
Adding a page means copying that head script too.

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

## The home Vibe panel

A second appearance picker, on the home page only: a bento tile that lets a
visitor **preview** a theme × skin combo in place before committing it
site-wide. Where the Vibe menu applies instantly and globally, the Vibe panel
is preview-then-confirm. Markup lives in [index.html](../index.html)
(`.vibe`, built out by [js/home.js](../js/home.js)'s `initVibe()`); styles
are the "Vibe panel" section of [main.css](../styles/main.css).

### Single source of truth

The options and default logic are **not** duplicated here.
[controls.js](../js/controls.js) exposes `window.DeetsAppearance`:

- `axes` — the same `AXES` table the Vibe menu builds from (option lists + keys).
- `get(name)` / `set(name, id)` — read the confirmed choice / apply one
  (`"theme"` or `"skin"`).
- `buildStorm()` / `buildOcean(suffix)` — the decorative-layer SVG builders,
  reused so the panel's scoped preview draws the exact same geometry as the
  page background. `buildOcean` takes an id suffix because two oceans coexist
  on the home page (page + panel) and their `<pattern>` ids must not collide.

`home.js` reads these; it never re-lists the six themes or five skins.

### The morph: a scoped "canvas window"

The trick is the same self-tasting used by the menu's chips, applied to the whole
panel. `.vibe` carries `data-theme` / `data-skin` set to the **pending**
pick, so its entire interior re-resolves the token cascade to that combo —
surface, type, shape, and its own scoped storm / ocean / grid — while
`<html>` (the rest of the page) stays on the confirmed look. The panel frame
is card material, but the interior stage deliberately shows the **canvas**
treatment (not the card plate) so the storm/waves/grid preview is visible;
`.vibe__stage::before` mirrors `body::before`'s texture, and the injected
`.storm` / `.ocean` are re-pinned from `position: fixed` to `absolute` so
they fill the panel box instead of the viewport.

The two lists are the exception — "everything but the menu items morphs."
Each `.flyout__item` chip sets its **own** `data-*`, so a theme chip still
tastes its own color and a skin chip its own typeface, floating on the
morphing stage. The lists reuse the dropdown's `.flyout` material and chip
styling verbatim (the Vibe menu above), just laid out inline rather
than as a pop-out. Two details keep them tidy at a fixed panel size:
`.vibe__col { min-width: 0 }` forces the two `1fr` columns to split evenly
(otherwise the title-faced Skin column's wider words outgrow Theme), and the
lists carry a themed scrollbar (`--subtext` thumb, `scrollbar-gutter: stable`)
for the Theme column, which overflows at six options.

### State: pending vs confirmed

`initVibe()` keeps two records — `confirmed` (seeded from `get()`) and
`pending`. Clicking a chip updates `pending`, repaints the panel's `data-*`,
and re-marks the checked chip; nothing is persisted. **Reset** and
**Confirm** share the panel's title row (`.vibe__head` / `.vibe__actions`),
so the columns keep the vertical space a separate footer would cost. Reset
(shown only while pending differs from confirmed) reverts to the baseline;
Confirm calls `DeetsAppearance.set()` for both axes, which writes `<html>` +
`localStorage` and fires a `deets:appearance` event that the Vibe menu
listens for to re-sync its own dots, so the two pickers never disagree.
If JS fails to build the panel it stays `hidden`, so there's no empty shell.

### Placement

The panel is a grid item in `.home__grid`. At width (≥ 41rem) the grid is a
bento via `grid-template-areas`: the portfolio leads full-width, SOTD and
Movies stack down the left, and the Vibe panel rides the right column
spanning that whole stack. Narrower, the grid collapses to one column and the
panel becomes a natural-height tile; under 30rem its two chip lists stack.

Because the panel spans two `auto` rows, its own content would otherwise feed
back into the row sizing — so a taller-typed pending skin would grow the
tracks and drag the SOTD/Movies column up with it. To keep the size steady
across skins, at the bento breakpoint the panel's `.vibe__stage` is floated
out of flow (`position: absolute; inset: 0`), contributing nothing to the
tracks: the left stack alone sizes the rows and the panel just fills to match,
its lists scrolling if a skin ever needs more room. (The stage stays in-flow
at narrow widths, so the stacked tile keeps its natural height.)

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
`{ dismiss }`; the API contract is documented in the file's header.

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
