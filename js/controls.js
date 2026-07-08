/* Settings controls — theme + skin switching, mirroring the DeetsMusic
   title menu. Two orthogonal axes persisted independently in localStorage
   and applied as data-theme / data-skin on <html>, so every page shares
   one selection.

   The attributes are also set inline in each page's <head> (before CSS) to
   avoid a flash of the defaults on load; this script wires the picker,
   keeps localStorage in sync, and injects the ocean + storm layers. */
(function () {
  "use strict";

  var AXES = {
    theme: {
      attr: "data-theme",
      key: "deets-theme",
      // No saved choice: follow the OS light/dark preference, landing on
      // Fairy (light) or Moonlight (dark). Kept in sync with the inline
      // pre-paint script in each page's <head>.
      def: function () { return prefersDark() ? "moonlight" : "fairy"; },
      options: [
        { id: "fairy",     label: "Fairy" },
        { id: "glade",     label: "Glade" },
        { id: "sepia",     label: "Sepia" },
        { id: "moonlight", label: "Moonlight" },
        { id: "hornet",    label: "Hornet" },
        { id: "viper",     label: "Viper" },
      ],
    },
    skin: {
      attr: "data-skin",
      key: "deets-skin",
      // No saved choice: CyberStorm on desktop, but Ocean on mobile — its calm
      // roll suits a phone better than the storm. Kept in sync with the inline
      // pre-paint script in each page's <head>.
      def: function () { return isMobile() ? "ocean" : "cyberstorm"; },
      options: [
        { id: "vanilla",    label: "Vanilla" },
        { id: "desk",       label: "Desk" },
        { id: "ocean",      label: "Ocean" },
        { id: "glass",      label: "Glass" },
        { id: "cyberstorm", label: "CyberStorm" },
      ],
    },
  };

  function prefersDark() {
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches; }
    catch (e) { return false; }
  }

  function isMobile() {
    try { return window.matchMedia("(max-width: 41rem)").matches; }
    catch (e) { return false; }
  }

  // A `def` may be a literal id or a function resolving one at call time
  // (the theme axis reads the OS preference).
  function fallback(axis) {
    return typeof axis.def === "function" ? axis.def() : axis.def;
  }

  function current(axis) {
    try {
      var saved = localStorage.getItem(axis.key);
      if (saved) return saved;
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
     the "Deets" wordmark itself becomes the trigger for a dropdown of every
     destination (Home + the page's own links). Desktop is untouched — the
     wordmark stays a plain home link and the inline nav shows; the media
     query in main.css hides this menu and the mobile-only affordances there.
     Links are CLONED from the live .site-nav so the destinations (and each
     page's aria-current) stay defined in one place: the page's markup. */
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

    nav.querySelectorAll("a").forEach(function (link) {
      var item = link.cloneNode(true);
      item.className = "nav-menu__item";
      item.setAttribute("role", "menuitem");
      menu.appendChild(item);
    });
    brand.appendChild(menu);

    function mobile() { return window.matchMedia("(max-width: 41rem)").matches; }
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

  /* Inject the ocean SVG once. Inert (CSS display:none) unless the active
     skin opts in via --ocean-display (Ocean). Three seamless wave-train
     patterns replace the old radial-gradient scallops, whose arcs crossed
     at tile corners and littered the canvas with chevron artifacts. Each
     tile is one full sine period (Q + T reflection), so the curve's value
     AND tangent match at the tile edge — no seam, no crossings. Each train
     is an opaque fill below a hairline crest, so a nearer swell occludes
     the ones behind it. Geometry lives here; ink/fill are theme roles and
     motion is skin tokens (see .ocean in main.css). */
  function buildOcean(suffix) {
    // The pattern ids must be unique per SVG instance: the home Vibe panel
    // renders its own scoped ocean alongside this page-level one, and two
    // <pattern id="ocean-swell-1"> would make every url(#…) ref resolve to
    // the first, painting the panel with the page's theme. A suffix keeps
    // each instance's refs pointing at its own patterns.
    var idsuf = suffix ? "-" + suffix : "";
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "ocean");
    svg.setAttribute("aria-hidden", "true");
    var defs = document.createElementNS(NS, "defs");
    svg.appendChild(defs);
    // [tile width, tile height, crest baseline, amplitude], farthest first
    // so the nearest train paints last (on top).
    var SWELLS = { 3: [80, 46, 26, 4], 2: [64, 38, 22, 5], 1: [48, 30, 17, 6] };
    [3, 2, 1].forEach(function (n) {
      var s = SWELLS[n], W = s[0], H = s[1], c = s[2], a = s[3];
      var crest = "M0 " + c + " Q" + W / 4 + " " + (c - a) + " " + W / 2 + " " + c +
                  " T" + W + " " + c;
      var pat = document.createElementNS(NS, "pattern");
      pat.setAttribute("id", "ocean-swell-" + n + idsuf);
      pat.setAttribute("width", W);
      pat.setAttribute("height", H);
      pat.setAttribute("patternUnits", "userSpaceOnUse");
      var fill = document.createElementNS(NS, "path");
      fill.setAttribute("class", "ocean__fill");
      fill.setAttribute("d", crest + " L" + W + " " + H + " L0 " + H + " Z");
      pat.appendChild(fill);
      var line = document.createElementNS(NS, "path");
      line.setAttribute("class", "ocean__crest ocean__crest--" + n);
      line.setAttribute("d", crest);
      pat.appendChild(line);
      defs.appendChild(pat);
      // bob (g) and roll (rect) are separate elements so their transform
      // animations compose instead of overwriting each other.
      var g = document.createElementNS(NS, "g");
      g.setAttribute("class", "ocean__bob ocean__bob--" + n);
      var rect = document.createElementNS(NS, "rect");
      rect.setAttribute("class", "ocean__roll ocean__roll--" + n);
      rect.setAttribute("fill", "url(#ocean-swell-" + n + idsuf + ")");
      g.appendChild(rect);
      svg.appendChild(g);
    });
    return svg;
  }
  function injectOcean() {
    if (document.body.querySelector(":scope > .ocean")) return;
    document.body.insertBefore(buildOcean(""), document.body.firstChild);
  }

  /* Inject the storm SVG once. It's inert (CSS display:none) unless the
     active skin opts in via --storm-display (CyberStorm). Two bolts whose
     geometry + motion are skin tokens; ink is the theme's --title. */
  function buildStorm() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "storm");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    ["storm__bolt storm__bolt--1", "storm__bolt storm__bolt--2",
     "storm__bolt storm__bolt--3", "storm__bolt storm__bolt--4"].forEach(function (cls) {
      var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("class", cls);
      p.setAttribute("pathLength", "1");
      svg.appendChild(p);
    });
    return svg;
  }
  function injectStorm() {
    if (document.body.querySelector(":scope > .storm")) return;
    document.body.insertBefore(buildStorm(), document.body.firstChild);
  }

  // One source of truth for the appearance axes, shared with home.js's Vibe
  // panel: the option lists + default logic live only here, and the storm /
  // ocean SVG builders are reused so the panel's scoped preview draws the
  // exact same geometry as the page background.
  window.DeetsAppearance = {
    axes: AXES,
    get: function (name) { return current(AXES[name]); },
    set: function (name, id) { apply(AXES[name], id); },
    buildStorm: buildStorm,
    buildOcean: buildOcean,
  };

  function init() { injectOcean(); injectStorm(); buildMenu(); buildNavMenu(); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
