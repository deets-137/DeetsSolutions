# UI direction: pulling DeetsMusic's UI back into the site

> Written 2026-09-15 as a build brief. It says what to take and in what order; it is not
> a record of shipped work. When a piece lands, move its description into
> [ui.md](ui.md) / [architecture.md](architecture.md) and delete it from here.

## The premise

DeetsMusic's look system **started as a copy of this site's**: the same 6 themes, the same
5 skins, the same `RETIRED` ids, the same toast. Since then DeetsMusic has had about two
weeks of UI work (2026-09-10 → 09-15) and the site has had none. So this is **catching up
a fork**, not adopting a new design. Color roles are almost identical. The drift is in the
skin tier (motion, pop, settings tokens), in the settings UI, and in motion polish.

Sources in `../DeetsMusic`:

| What | Where |
| --- | --- |
| Skin tokens (the biggest diff) | `src/styles/skin.css` |
| Settings card | `src/styles/settings.css`, `src/settings-card.ts`, `docs/SETTINGS.md` |
| Pop motion | `src/styles.css` §Pop, `src/pop.ts` (commit `21d3183`) |
| Toasts | `src/styles/toast.css`, `src/toast.ts` |
| Look schedule | `src/look-schedule.ts`, `docs/LOOK-SCHEDULE.md` (commit `c978fc6`) |
| Launch / look-change cover | `src/styles.css` §Launch cover, `appearance.ts`, `boot-cover.ts` |
| Ambient layers at a 30 fps cap | commit `e931c8c` |
| **The best static template** | `extension/options/options.css`: about 60 lines of plain CSS already on these tokens |

It's all TypeScript there. The site has no build step, so **port to plain JS by hand; never
import from DeetsMusic**.

---

## 1. Settings: from the Vibe menu to "menu plus a Settings panel"

### Today
The Vibe menu has two accordion groups (Theme, Skin), each with a flyout of chips that
preview themselves. It has no motion, no arrow keys, and a `role=menu` nested inside
another `role=menu` ([ui.md](ui.md), "Known constraints").

### Direction: DeetsMusic's hybrid
- **The Vibe menu keeps the fast switches.** Theme › and Skin › stay, with the chips that
  preview themselves. Keep that trick exactly.
- **A new last row, "Settings…"**, opens a **Settings panel**. Rule carried over from
  DeetsMusic: *each control lives in exactly one place*. Theme and skin are never
  repeated as rows in the panel. The only exception is the day/night look pickers below,
  which are schedule settings, not the current look.
- **Panel form on the web.** There is no bento slot to summon a card into, so pick one:
  - **(a) Recommended: a right-anchored pop panel** under the header. Same material as
    `.menu`, `max-height` bounded by the viewport, and its own scroll. Escape and outside
    click close it, like the menu.
  - (b) A `/settings/` page. That means one more page carrying the head script, and the
    page loses its context.

### Panel anatomy (lift `settings.css` nearly verbatim; rename `.set__*` if you like)
- **One scrolling column.** No sidebar, no tabs, no boxes.
- **Sections** get uppercase subtext headers over a 1px `--border` hairline. Each header
  is a fold button: a chevron, the title, and a row count on the right.
  - Folds persist per section title.
  - Opening a section staggers its rows in (pop motion, section 2). Closing is instant.
- **Row kinds**
  - **Toggle.** The whole row is `<button role="switch" aria-checked>`. There is no switch
    graphic, only a `•` in a right gutter. This is the same dot as the chips, so the menu
    and the panel speak one idiom.
  - **Choice.** A label plus a **split pill** of up to 3 halves (`radiogroup`, with
    `aria-pressed` on each half). More than 3 options becomes a small menu half. The pill
    wraps under the label only when the row is too narrow. The focus ring goes **inset**,
    because the pill clips.
  - **Range.** A label, a slider, and a tabular-numbers value.
    - Dragging writes a CSS custom property on `<html>` as a live preview. Releasing
      commits.
    - Arrow keys step, Shift steps 10, Home and End jump to the ends.
  - **Conditional rows** (`when`). Skin-only rows show only while that skin is active.
    Their hint starts with "Glass only." and so on.
- **Everything applies live.** No Save button, no Reset. Keep focus in place across
  re-renders.
- **Hints are only a `title` tooltip.** Status lines are `aria-live="polite"` subtext.
- **Scrollbar fades in only when needed.** `scrollbar-gutter: stable`, plus an
  `@property --set-thumb` color that a ResizeObserver toggles with `is-scrollable`.
- **Deep link.** `requestSetting(rowId)` opens the panel, unfolds the row's section,
  scrolls the row to center, and plays the 1600 ms `set-flash` wash. This lets a toast's
  **[Settings]** button point at the right row. Under reduced motion the wash holds, then
  snaps off.

### Rows worth porting (DeetsMusic key → site meaning)

| Section | Row | Site notes |
| --- | --- | --- |
| Look | **Change look at**: Sunrise and sunset / Set times / System / Off | "Windows mode" becomes `prefers-color-scheme` (live via `matchMedia` change). Sun times come from the time zone (`Intl`), never geolocation, same as DeetsMusic. Port `look-schedule.ts`'s math to plain JS. |
| Look | **Day look · Night look**: split [theme ▾ \| skin ▾] | Defaults are the current OS pairs: Lilac × Press and Black & Red × Retro-Future. |
| Look | **Day runs** (set times only), **Shift sun times** (sun only) | Conditional rows. |
| Look | **Menu pick lasts**: Until next change / For good | What a Vibe-menu click does while a schedule is on. |
| Look | **Animate look changes** | The veil → wait → lift cover (section 2). |
| Look | **Animate backgrounds**: On / Reduced / Off | Drives ocean, storm and aurora. Reduced sets `--ambient-fps: 15`. OS reduced motion always wins. |
| Look | Glass sliders (Canvas glow, Dim canvas, Backlight, Tint cards), Ocean **Draw card edges** + **Sand width** | Only once the matching skin CSS is ported (section 3). Order the Glass sliders back to front, the way the layers paint. |
| Site | **Open menus on hover**: click / hover | The desktop nav groups are hover-only CSS today. This setting would need a JS dropdown primitive (DeetsMusic `dropdown.ts`: 150 ms grace, `aria-expanded`). |
| Site | **Show notices**: Everything / Failures | Gate in `toast.js` `push()`. |

**Skip** everything app-specific: Window, Playback, Apple Music, Playlists, Rewind,
Connections, Updates, Bugs. A per-page section later (Radio volume, game prefs) fits the
same row kinds.

### Storage and pre-paint (the load-bearing part)
- **Keep `deets-theme` / `deets-skin` exactly as they are.** They are a contract with every
  visitor. DeetsMusic uses `deets.theme`; don't "align" to it.
- **Put new preferences in one JSON key, `deets-settings`** (DeetsMusic's `deets.settings`
  pattern), with `setting()`, `setSetting()` and `onSettingsChange()` in `controls.js`. Fold
  state goes in its own key, `deets-settings-folds`.
- **The look schedule must resolve before paint**, or a night visitor gets a flash of the
  day look. So the schedule check has to join the pre-paint head script on **all 15 pages**,
  next to `R`.
  - **Decision for Aditya:** keep pasting it inline, or move the head script to one
    **synchronous** `<script src="/js/prepaint.js">` (no `defer`/`async`). A synchronous
    head script still runs before paint, and it collapses 15 copies into one. The cost is
    one blocking request (cached, and small under `_headers`' revalidate policy).
  - If you choose the file, update the "Renaming a theme or skin id" procedure in
    architecture.md and CLAUDE.md's `RETIRED` note.

---

## 2. Motion: take the pop system and the look-change cover

### Pop panels (highest value, lowest risk)
Every `[hidden]` popover animates in and out with no JS, using `@starting-style` and
`transition: display … allow-discrete`:

```css
.pop { transform-origin: var(--pop-origin, top right);
  --pop-from: translateY(calc(-1 * var(--pop-shift))) scale(var(--pop-scale));
  transition: opacity var(--pop-in) var(--pop-ease), transform var(--pop-in) var(--pop-ease),
              display var(--pop-in) allow-discrete; }
.pop[hidden] { display: none; opacity: 0; transform: var(--pop-from); transition-duration: var(--pop-out); }
@starting-style { .pop:not([hidden]) { opacity: 0; transform: var(--pop-from); } }
```

- **Apply `.pop` to** `.menu`, `.flyout`, `.nav-menu`, `.tb-pop`, and the new Settings panel.
  - `.tb-pop` is markup in the four duplicated journal kits. Adding a class there is a
    **mirror-in-all-four** change (sotd, movies, league, radio).
- **Row stagger:** `.pop-enter` with `--pop-i` and `--pop-stagger: .03s`, capped at 12 rows.
- **Browsers without `@starting-style`** just toggle instantly. That's an acceptable
  fallback.
- **Heads-up:** `.flyout` is shown by `display:flex` on `.is-open`, not by `[hidden]`.
  Either switch it to `hidden` or give it an `.is-open` twin of the rule.

### Look-change cover
- **What it does.** Changing theme or skin runs an opaque `--canvas` cover through stages
  on `<html data-boot>`:
  1. **veil:** the cover fades in.
  2. **wait:** the look swaps and the new skin's fonts load underneath. The cover's color
     glides to the new canvas.
  3. **lift:** the cover fades out and page blocks rise in a stagger.
- **Per-skin timing tokens:** `--boot-dur`, `--boot-ease`, `--boot-rise`, `--boot-stagger`.
  - Press: quick and short.
  - Ocean: slow and deep.
  - Retro-Future: skewed slide.
- **A CSS safety animation** removes the cover after 4 s no matter what.
- **Gated by** "Animate look changes" and OS reduced motion.
- **Site caveat:** DeetsMusic lifts bento cards. The site needs its own list of what
  "rises" per page type (the `.page-bar` plus the first content blocks). Games should just
  get the veil. Don't stagger game boards.
- **Launch fade:** *not* on first page load for the site. Page navigations are full
  reloads, and a cover on every click would feel slow. Only use it for look changes.

### Ambient layers (ocean, storm, aurora)
- **The problem:** the site currently has **no reduced-motion rule for any of them**.
- **Port `e931c8c`:**
  - Animate only `transform` and `opacity`.
  - Step the animation at `--ambient-fps` via `steps(round(dur * fps))`, with the easing
    baked into the keyframes.
  - Pause while `document.hidden`.
- **Under reduced motion:**
  - Aurora freezes.
  - Ocean holds still and stays visible.
  - Storm is **hidden**, because a frozen half-drawn bolt reads as a bug.

### Other reduced-motion gaps to close while you're in there
- `--hover-lift` transforms
- the nav-group slide
- the account spinner (slow it down rather than stopping it)

---

## 3. Token catch-up (do this first; everything above leans on it)

Diff `DeetsSolutions/styles/skin.css` (~315 lines) against `DeetsMusic/src/styles/skin.css`
(~760 lines). The site lacks these tokens:

| Group | Tokens | Take? |
| --- | --- | --- |
| Pop | `--pop-in/-out/-grow/-stagger/-shift/-scale/-ease` | **Yes** |
| Settings | `--set-section-gap`, `--set-row-h`, `--set-range-w`, `--set-range-val-w`, `--set-pill-pad`, `--set-pill-radius`, `--set-menu-min-w/-max-h`, `--set-flash-dur` | **Yes.** Convert px to the site's rem spacing scale (`--space-*` lives in chrome.css, in rem). |
| Boot/cover | `--boot-*`, `--cover-in-dur`, `--boot-safety`, per skin | Yes, with the cover |
| Ambient | `--ambient-fps` | Yes |
| Glass sliders | `--glass-canvas`, `--glass-canvas-dim`, `--glass-backlight`, `--glass-tint` and the Glass rules that read them | Optional, with the slider rows |
| Ocean sand edge | `--ocean-sand`, `--sand-reach` | Optional |
| Nav panes | `--nav-at-*`, `--nav-dur/-ease` | **No.** In-card pane navigation has no site equivalent. |
| Scrubber handle masks | per skin | Only if a range row ships. It gives the sliders the skin's handle shape for free. |

**Reconcile the base motion values on purpose; don't blindly copy.**
- Site base: `--dur-fast .14s`, `--dur-med .22s`.
- DeetsMusic base: `.12s`, `.18s`.
- Per-skin overrides already match: Press `.1/.16`, Glass `.2`, Retro-Future `.08`.

Recommend taking DeetsMusic's base values so both products feel identical.

Also:
- **Focus ring.** Extend `chrome.css`'s `a, button` rule to cover `[role=switch]`,
  `[role=slider]`, `summary`, and `select`. Text inputs keep DeetsMusic's "the hairline is
  the box" rule: no ring, and the field's border shows focus.
- **Input "canvas well".** `--canvas` fill, 1px `--border`, `--radius-control`, a
  borderless input inside, a leading 14px magnifier, and a themed × instead of the native
  cancel button. Use it for the journal search fields.

---

## 4. Components worth lifting (after the above)

- **Split pill.** One border, halves cut by a hairline. Use it wherever the site has
  adjacent pills doing one job, e.g. a journal sort field plus direction.
- **Menu section labels.** Title font, subtext size, uppercase, `.06em`. Use them in
  `.tb-pop__head` and the nav-group menus so every "shelf" header has one voice.
- **Submenu flyout edge.** DeetsMusic's flyout sits touching the menu (`left:100%`), with
  JS-latched open state rather than `:hover`, so an input inside survives typing. Adopt
  that if the site ever puts a field in a flyout.
- **Toast parity check.** The site already has the stripe, countdown and hover-pause.
  DeetsMusic adds:
  - a **question toast**, which always shows even under "Failures"
  - a **[Settings] action** that deep-links a row
  - a max width of 304px

  Diff `toast.css` against `chrome.css`'s toast block. Take the tiering; keep the site's
  z-index 50 and cap of 4.
- **Confirm-by-rearming.** A destructive button changes to "Sure?" and disarms after 3 s.
  Use it for the owner moderation actions on /deetsmusic/ and for leave-table buttons.
- **Busy dot.** A 6px dot pulsing to opacity .25 over .9s, for search-in-flight. It's
  cheaper than a spinner.

## 5. Explicitly not pulling

- Bento layout
- Titlebar and traffic lights
- Surfaces (mini/midi/max)
- In-card pane navigation
- Drag-and-drop ghosts
- The volume pill (Radio has its own)
- Album aurora and album-derived text colors
- Now Playing layout

These are app chrome with no page analogue.

## 6. Accessibility, fixed on the way (neither product has these yet; site first)

- **Menu semantics.** The Vibe root becomes a plain disclosure (`aria-expanded` on the
  trigger) holding groups. Only the chip flyouts keep `role=menu`.
- **Focus.** Move focus into the menu or panel on open and return it to the trigger on
  close. That already happens on Escape; make it happen on every close.
- **Arrow keys.**
  - Up and Down move between menu rows.
  - Left and Right move between chips and within a split pill.
  - Home and End jump to the ends.

  This fixes the ui.md "Click-only chips" constraint. Once it's proven, port it back to
  DeetsMusic.
- **Escape closes desktop nav groups.** That needs the dropdown primitive from section 1.

---

## Build order for the morning

1. **Tokens.** Pop, settings, ambient-fps and focus-ring coverage go into `skin.css` /
   `chrome.css`, then reconcile the base durations. Nothing visible changes yet except
   timing.
2. **Pop motion.** Apply it to `.menu`, `.flyout` and `.nav-menu`, then to `.tb-pop` in all
   four journal kits.
3. **Ambient reduced-motion and the fps cap.** This is a standalone accessibility fix.
4. **Settings store and panel shell.** Add the `deets-settings` key, the "Settings…" row,
   the panel with fold sections, and the toggle and choice row kinds. First rows: Animate
   backgrounds, Show notices.
5. **Look schedule.** Decide the head-script question first, then add the schedule rows,
   the day/night looks, and "Menu pick lasts".
6. **Look-change cover** and its toggle.
7. **Keyboard pass** on the menu and panel.
8. Optional: the range row and the Glass/Ocean skin sliders.

Per step:
- Run the console and DOM check.
- **Check all 30 combos.**
- Add any new label to the page's `strings.js` with a `[ph]` prefix. Reusing DeetsMusic's
  labels as the draft is fine, but they still need his pass on the site.
- Keep ui.md current. Its "Known constraints" section shrinks as items land.
- Visual pass is Aditya's.

## Open decisions (Aditya's)

1. Settings as a pop panel (recommended) or a `/settings/` page.
2. Keep 15 inline head scripts or move to one synchronous `js/prepaint.js`.
3. Adopt DeetsMusic's base `--dur-fast/-med` (.12/.18) or keep the site's (.14/.22).
4. Whether the site gets Glass and Ocean's skin sliders at all, or stays at the simpler
   skins.
5. "Open menus on hover" on the site: worth building the JS dropdown primitive?
