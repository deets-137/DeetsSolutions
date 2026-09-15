/* Settings controls — theme + skin switching, mirroring the DeetsMusic
   title menu. Two orthogonal axes persisted independently in localStorage
   and applied as data-theme / data-skin on <html>, so every page shares
   one selection.

   The attributes are also set inline in each page's <head> (before CSS) to
   avoid a flash of the defaults on load; this script wires the picker,
   keeps localStorage in sync, and injects the ocean + aurora + storm layers. */
(function () {
  "use strict";

  var AXES = {
    theme: {
      attr: "data-theme",
      key: "deets-theme",
      // No saved choice: follow the OS light/dark preference, landing on
      // Lilac (light) or Black & Red (dark). Both axes read the SAME
      // preference, so a first visit lands on one of two curated pairs —
      // Press × Lilac or Retro-Future × Black & Red. Kept in sync with the
      // inline pre-paint script in each page's <head>.
      def: function () { return prefersDark() ? "black-red" : "lilac"; },
      options: [
        { id: "lilac",        label: "Lilac" },
        { id: "green",        label: "Green" },
        { id: "sepia",        label: "Sepia" },
        { id: "moonlight",    label: "Moonlight" },
        { id: "black-yellow", label: "Black & Yellow" },
        { id: "black-red",    label: "Black & Red" },
      ],
    },
    skin: {
      attr: "data-skin",
      key: "deets-skin",
      // No saved choice: the skin follows the OS light/dark preference too —
      // Press on light (ink on stock wants a light stock), Retro-Future on
      // dark. Pairs with the theme default above; no longer a screen-width
      // call. Kept in sync with the inline pre-paint script in each page's
      // <head>.
      def: function () { return prefersDark() ? "retro-future" : "press"; },
      options: [
        { id: "vanilla",      label: "Vanilla" },
        { id: "press",        label: "Press" },
        { id: "ocean",        label: "Ocean" },
        { id: "glass",        label: "Glass" },
        { id: "retro-future", label: "Retro-Future" },
      ],
    },
  };

  function prefersDark() {
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches; }
    catch (e) { return false; }
  }

  // A `def` may be a literal id or a function resolving one at call time
  // (the theme axis reads the OS preference).
  function fallback(axis) {
    return typeof axis.def === "function" ? axis.def() : axis.def;
  }

  // Retired ids still sitting in someone's localStorage, mapped to their
  // successor. Kept in sync with the inline pre-paint script in each page's
  // <head>, which applies the same map before first paint.
  //
  // One map serves BOTH axes — safe only while no id appears on both. The
  // 2026-08-08 rename is the bulk of it: four themes and one skin traded
  // their vibe names for what they actually are, and a visitor who picked
  // one of them keeps their choice instead of falling back to the default.
  var RETIRED = {
    desk:       "press",         // retired skin → successor
    fairy:      "lilac",
    glade:      "green",
    hornet:     "black-yellow",
    viper:      "black-red",
    cyberstorm: "retro-future",
  };

  function current(axis) {
    try {
      var saved = localStorage.getItem(axis.key);
      if (saved) return RETIRED[saved] || saved;
    } catch (e) {}
    return fallback(axis);
  }

  function apply(axis, id) {
    document.documentElement.setAttribute(axis.attr, id);
    try { localStorage.setItem(axis.key, id); } catch (e) {}
    // Announce the change so any other picker on the page (the Vibe menu, the
    // home Vibe panel) can re-sync its checked state to the new truth.
    document.dispatchEvent(new CustomEvent("deets:appearance", {
      detail: { attr: axis.attr, id: id },
    }));
  }

  /* Build one accordion group: a clickable header row + a flyout panel of
     chips that drops in below it. Each chip carries the axis data-* so its
     tokens resolve to that choice (a theme chip tastes color; a skin chip
     tastes typeface). Clicking the header toggles the panel. */
  function buildRow(name, axis, groups) {
    var active = current(axis);
    apply(axis, active);

    var group = document.createElement("div");
    group.className = "menu__group";

    var row = document.createElement("button");
    row.type = "button";
    row.className = "menu__row";
    row.setAttribute("data-row", name);
    row.setAttribute("aria-expanded", "false");

    var label = document.createElement("span");
    label.className = "menu__label";
    label.textContent = name.charAt(0).toUpperCase() + name.slice(1);

    var chev = document.createElement("span");
    chev.className = "menu__chev";
    chev.setAttribute("aria-hidden", "true");
    chev.textContent = "‹";   /* points at the flyout, which opens to the left */

    var flyout = document.createElement("div");
    flyout.className = "flyout";
    flyout.setAttribute("role", "menu");
    flyout.setAttribute("aria-label", label.textContent);

    axis.options.forEach(function (opt) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "flyout__item";
      chip.setAttribute("role", "menuitemradio");
      chip.setAttribute(axis.attr, opt.id);   // live taste of this choice
      chip.setAttribute("aria-checked", String(opt.id === active));
      chip.textContent = opt.label;

      chip.addEventListener("click", function () {
        apply(axis, opt.id);
        flyout.querySelectorAll(".flyout__item").forEach(function (el) {
          el.setAttribute("aria-checked", String(el === chip));
        });
      });

      flyout.appendChild(chip);
    });

    // Header toggles this group; opening it collapses the others (accordion).
    row.addEventListener("click", function () {
      var willOpen = !group.classList.contains("is-open");
      groups.forEach(function (g) {
        g.classList.remove("is-open");
        g.querySelector(".menu__row").setAttribute("aria-expanded", "false");
      });
      if (willOpen) {
        group.classList.add("is-open");
        row.setAttribute("aria-expanded", "true");
      }
    });

    row.appendChild(label);
    row.appendChild(chev);
    group.appendChild(row);
    group.appendChild(flyout);
    return group;
  }

  function buildMenu() {
    var mount = document.querySelector("[data-settings]");
    if (!mount) return;

    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "settings__trigger";
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
    trigger.textContent = "Vibe";

    var menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    var groups = [];
    var themeGroup = buildRow("theme", AXES.theme, groups);
    var skinGroup = buildRow("skin", AXES.skin, groups);
    groups.push(themeGroup, skinGroup);
    menu.appendChild(themeGroup);
    menu.appendChild(skinGroup);

    function open() {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      document.addEventListener("click", onOutside, true);
      document.addEventListener("keydown", onKey);
    }
    function close() {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onOutside, true);
      document.removeEventListener("keydown", onKey);
    }
    function onOutside(e) { if (!mount.contains(e.target)) close(); }
    function onKey(e) { if (e.key === "Escape") { close(); trigger.focus(); } }

    trigger.addEventListener("click", function () { menu.hidden ? open() : close(); });

    // If the choice changes elsewhere (the home Vibe panel's Confirm), bring
    // this menu's dots back in line with the document's live attributes.
    document.addEventListener("deets:appearance", function () {
      menu.querySelectorAll(".flyout__item").forEach(function (chip) {
        var attr = chip.hasAttribute("data-theme") ? "data-theme" : "data-skin";
        chip.setAttribute("aria-checked", String(
          chip.getAttribute(attr) === document.documentElement.getAttribute(attr)));
      });
    });

    mount.appendChild(trigger);
    mount.appendChild(menu);
  }

  /* Mobile nav menu: on narrow viewports the inline nav links don't fit, so
     the "Deets" wordmark itself becomes the trigger for a dropdown. Desktop
     is untouched — the wordmark stays a plain home link and the inline nav
     shows; the media query in chrome.css hides this menu and the mobile-only
     affordances there. Links are CLONED from the live .site-nav so the
     destinations (and each page's aria-current) stay defined in one place:
     the page's markup. The menu carries only the links marked
     data-nav-core (Home + the essentials — the deep-cut tabs are
     desktop-only by design); a page with nothing marked gets them all. */
  function buildNavMenu() {
    var brand = document.querySelector(".site-brand");
    var wordmark = brand && brand.querySelector(".wordmark");
    var nav = document.querySelector(".site-nav");
    if (!brand || !wordmark || !nav) return;

    var menu = document.createElement("div");
    menu.className = "nav-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    var home = document.createElement("a");
    home.className = "nav-menu__item";
    home.setAttribute("role", "menuitem");
    home.href = "/";
    home.textContent = "Home";
    menu.appendChild(home);

    var links = nav.querySelectorAll("a[data-nav-core]");
    if (!links.length) links = nav.querySelectorAll("a");
    links.forEach(function (link) {
      var item = link.cloneNode(true);
      item.className = "nav-menu__item";
      item.setAttribute("role", "menuitem");
      item.removeAttribute("data-nav-core");
      menu.appendChild(item);
    });
    brand.appendChild(menu);

    // Mirrors the CSS nav-collapse breakpoint (56rem), which is wider than
    // the 41rem phone breakpoint the rest of the site uses: six inline links
    // + the Vibe button overflow tablet widths long before phone widths.
    function mobile() { return window.matchMedia("(max-width: 56rem)").matches; }
    function open() {
      menu.hidden = false;
      wordmark.setAttribute("aria-expanded", "true");
      document.addEventListener("click", onOutside, true);
      document.addEventListener("keydown", onKey);
    }
    function close() {
      menu.hidden = true;
      wordmark.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onOutside, true);
      document.removeEventListener("keydown", onKey);
    }
    function onOutside(e) { if (!brand.contains(e.target)) close(); }
    function onKey(e) { if (e.key === "Escape") { close(); wordmark.focus(); } }

    // The wordmark is a menu trigger only while mobile; on desktop it's a
    // normal home link. syncMode keeps its ARIA honest as the viewport crosses
    // the breakpoint (and closes an open menu on the way up).
    function syncMode() {
      if (mobile()) {
        wordmark.setAttribute("aria-haspopup", "true");
        wordmark.setAttribute("aria-expanded", String(!menu.hidden));
      } else {
        if (!menu.hidden) close();
        wordmark.removeAttribute("aria-haspopup");
        wordmark.removeAttribute("aria-expanded");
      }
    }

    wordmark.addEventListener("click", function (e) {
      if (!mobile()) return;            // desktop: follow the home link
      e.preventDefault();
      menu.hidden ? open() : close();
    });
    window.addEventListener("resize", syncMode);
    syncMode();
  }

  /* The ambient layers (ocean / aurora / storm). Each is injected once and
     inert (CSS display:none) until the active skin opts in via its
     --*-display token. Motion is CSS (chrome.css + skin.css keyframes) and
     animates transform + opacity only, so the compositor moves already-
     rasterized boxes instead of repainting the page every frame. */
  function layer(cls) {
    var el = document.createElement("div");
    el.className = cls;
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  function inject(el) {
    if (document.body.querySelector(":scope > ." + el.className)) return;
    document.body.insertBefore(el, document.body.firstChild);
  }

  /* Ocean: three wave trains, each an opaque fill under a hairline crest,
     so a nearer swell occludes the ones behind it. Each tile is one full
     sine period (Q + T reflection), so the curve's value AND tangent match
     at the tile edge: no seam, no crossings. The tiles are CSS masks built
     here from the geometry table; ink/fill are theme roles (.ocean in
     chrome.css). */
  function svgMask(w, h, body) {
    return 'url("data:image/svg+xml,' + encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='" + w + "' height='" + h + "'>" +
      body + "</svg>") + '")';
  }
  function buildOcean() {
    var sea = layer("ocean");
    // [tile width, tile height, crest baseline, amplitude], farthest first
    // so the nearest train paints last (on top).
    var SWELLS = { 3: [80, 46, 26, 4], 2: [64, 38, 22, 5], 1: [48, 30, 17, 6] };
    [3, 2, 1].forEach(function (n) {
      var s = SWELLS[n], W = s[0], H = s[1], c = s[2], a = s[3];
      var crest = "M0 " + c + " Q" + W / 4 + " " + (c - a) + " " + W / 2 + " " + c +
                  " T" + W + " " + c;
      // bob and roll are separate boxes so their transform animations
      // compose instead of overwriting each other.
      var bob = document.createElement("div");
      bob.className = "ocean__bob ocean__bob--" + n;
      var roll = document.createElement("div");
      roll.className = "ocean__roll ocean__roll--" + n;
      roll.style.setProperty("--swell-tile", W + "px " + H + "px");
      roll.style.setProperty("--swell-fill",
        svgMask(W, H, "<path d='" + crest + " L" + W + " " + H + " L0 " + H + " Z'/>"));
      roll.style.setProperty("--swell-crest",
        svgMask(W, H, "<path d='" + crest + "' fill='none' stroke='#000' stroke-width='1'/>"));
      bob.appendChild(roll);
      sea.appendChild(bob);
    });
    return sea;
  }

  /* Aurora: three blobs, one gradient each (Glass's --aurora-* tokens). */
  function buildAurora() {
    var sky = layer("aurora");
    [1, 2, 3].forEach(function (n) {
      sky.appendChild(document.createElement("div")).className = "aurora__blob aurora__blob--" + n;
    });
    return sky;
  }

  /* Storm: four bolts, two down each edge. A bolt is painted once (glow
     included) and revealed by a WIPE: the strike box slides down and clips
     it while the hold box counter-slides, so the bolt itself stays still.
     Geometry is skin tokens; ink is the theme's --title. */
  function buildStorm() {
    var NS = "http://www.w3.org/2000/svg";
    var storm = layer("storm");
    [1, 2, 3, 4].forEach(function (n) {
      var strike = storm.appendChild(document.createElement("div"));
      strike.className = "storm__strike storm__strike--" + n;
      var hold = strike.appendChild(document.createElement("div"));
      hold.className = "storm__hold";
      var svg = hold.appendChild(document.createElementNS(NS, "svg"));
      svg.setAttribute("class", "storm__svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.appendChild(document.createElementNS(NS, "path")).setAttribute("class", "storm__bolt");
    });
    return storm;
  }

  /* The loops hold still while the tab is hidden (play-state keeps their
     place, so they resume without a jump). */
  function watchVisibility() {
    var root = document.documentElement;
    function sync() {
      if (document.hidden) root.setAttribute("data-ambient", "paused");
      else root.removeAttribute("data-ambient");
    }
    document.addEventListener("visibilitychange", sync);
    sync();
  }

  // One source of truth for the appearance axes: the option lists + default
  // logic live only here.
  window.DeetsAppearance = {
    axes: AXES,
    get: function (name) { return current(AXES[name]); },
    set: function (name, id) { apply(AXES[name], id); },
  };

  function init() {
    inject(buildOcean()); inject(buildAurora()); inject(buildStorm());
    watchVisibility(); buildMenu(); buildNavMenu();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
