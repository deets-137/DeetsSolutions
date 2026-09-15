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

  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  /* ── Chrome copy for the Settings panel ────────────────────────────
     Labels, hints, and options are DeetsMusic's own (his words there); a
     [ph] entry is a site-only placeholder awaiting his pass. */
  var S = {
    settings: "Settings",
    look: "Look and feel",
    motion: "Animate look changes",
    motionHint: "[ph] Theme and skin changes fade the page out and back in. Off: they change at once",
    bgMotion: "Animate backgrounds",
    bgMotionHint: "The moving Ocean, Glass, and Retro-Future backgrounds. Reduced: fewer updates, less CPU. Off: they hold still",
    on: "On",
    reduced: "Reduced",
    off: "Off",
    oceanEdges: "Draw card edges",
    oceanEdgesHint: "Ocean only. Sand: the card edges break into grains, like a dark beach",
    sand: "Sand",
    soft: "Soft",
    oceanSand: "Sand width",
    oceanSandHint: "Ocean only. How far the sand reaches into each card",
    glassCanvas: "Canvas glow",
    glassCanvasHint: "Glass only. How brightly the colors glow on the background. The cards do not change",
    glassDim: "Dim canvas",
    glassDimHint: "Glass only. Darkens the space between the cards. The cards stay as bright",
    glassBacklight: "Backlight",
    glassBacklightHint: "Glass only. A light behind each card, under its tint",
    glassTint: "Tint cards",
    glassTintHint: "Glass only. The card color over the backlight. Less tint: more glow",
    toasts: "Show notices",
    toastsHint: "Everything: confirmations too. Failures: only when an action couldn't do what it said",
    everything: "Everything",
    failures: "Failures",
  };

  /* ── Settings store ────────────────────────────────────────────────
     One JSON object under `deets-settings` (DeetsMusic's `deets.settings`
     pattern; key names match its store). Theme and skin stay in their own
     `deets-theme` / `deets-skin` keys: those are a contract with every
     visitor. Defaults are DeetsMusic's. js/toast.js reads `toasts` straight
     from storage. */
  var SETTINGS_KEY = "deets-settings";
  var FOLDS_KEY = "deets-settings-folds";
  var DEFAULTS = {
    appearanceMotion: true,    // theme/skin changes play the cover; OS reduced motion still wins
    backgroundMotion: "on",    // ambient layers: on = 30 fps, reduced = 15, off = still (storm hides)
    oceanEdges: "soft",        // Ocean: "sand" breaks the card edges into grains
    oceanSand: 15,             // Ocean sand: 0–100 across --sand-reach-min…max
    glassCanvasGlow: 50,       // Glass, 0–100: aurora strength (50 = as the skin writes it)
    glassCanvasDim: 0,         // Glass, 0–100: darkens the canvas; the cards undo it
    glassBacklight: 50,        // Glass, 0–100: the light behind each card
    glassTint: 55,             // Glass, 0–100: the card color over the backlight
    toasts: "all",             // "failures" = warn + error (+ questions) only
  };
  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; }
    catch (e) { return {}; }
  }
  var store = (function () {
    var saved = readJSON(SETTINGS_KEY), out = {}, k;
    for (k in saved) out[k] = saved[k];          // keep keys a later version added
    for (k in DEFAULTS) if (!(k in out)) out[k] = DEFAULTS[k];
    return out;
  })();
  var settingListeners = [];
  function setting(key) { return store[key]; }
  function setSetting(key, value) {
    if (store[key] === value) return;
    store[key] = value;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(store)); } catch (e) {}
    settingListeners.slice().forEach(function (cb) { cb(key); });
  }
  function onSettingsChange(cb) {
    settingListeners.push(cb);
    return function () {
      var i = settingListeners.indexOf(cb);
      if (i >= 0) settingListeners.splice(i, 1);
    };
  }

  /* Settings that restyle the page, published on <html>: data-bg-motion,
     data-ocean-edges, and the skin sliders as custom properties the skin
     blocks in skin.css read (other skins ignore them). Applied at once, so a
     returning visitor's values land as early as this deferred script runs. */
  var SKIN_PROPS = {
    glassTint:       ["--glass-tint", "%"],
    glassBacklight:  ["--glass-backlight", ""],
    glassCanvasGlow: ["--glass-canvas", ""],
    glassCanvasDim:  ["--glass-canvas-dim", ""],
    oceanSand:       ["--ocean-sand", ""],
  };
  function clamp100(v) { return Math.max(0, Math.min(100, Math.round(Number(v) || 0))); }
  // Show a slider value without writing the store (a drag).
  function previewSkin(key, v) {
    var p = SKIN_PROPS[key];
    document.documentElement.style.setProperty(p[0], clamp100(v) + p[1]);
  }
  function applySettings(key) {
    var root = document.documentElement;
    if (!key || key === "backgroundMotion") root.setAttribute("data-bg-motion", setting("backgroundMotion"));
    if (!key || key === "oceanEdges") root.setAttribute("data-ocean-edges", setting("oceanEdges"));
    Object.keys(SKIN_PROPS).forEach(function (k) {
      if (!key || key === k) previewSkin(k, setting(k));
    });
  }
  applySettings();
  onSettingsChange(applySettings);

  /* ── Look-change cover (DeetsMusic appearance.ts) ──────────────────
     A theme or skin pick runs under the cover (chrome.css, <html data-boot>):
       veil — the cover fades in over the old look (the OUTGOING skin's
              --cover-in-dur),
       wait — opaque: the look swaps and the new skin's fonts load,
       lift — the cover fades and the page blocks rise (the INCOMING skin's
              --boot-*); the attribute goes when the rise ends.
     A second pick during veil or wait joins the same cover; one during the
     lift fades the cover back in. Snaps when Animate look changes is off or
     the OS asks for reduced motion. Never on page load: navigations are full
     reloads, and a cover on every click would feel slow. */
  var SKIN_FONTS = {
    vanilla: ['12px "Liberation Serif"'],
    press: ['12px "Anton"', '12px "IBM Plex Mono"'],
    ocean: ['12px "Cinzel"', '12px "Spectral"'],
    glass: [],
    "retro-future": ['12px "Orbitron"', '12px "Rajdhani"'],
  };
  var cover = { phase: null, jobs: [], timer: 0 };
  // A time token ("0.8s" / "70ms") in ms.
  function tokenMs(name) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    var n = parseFloat(v);
    if (!isFinite(n)) return 0;
    return /ms$/.test(v) ? n : n * 1000;
  }
  // A frame, or 100 ms when the tab is hidden and frames stop.
  function nextFrame() {
    return new Promise(function (r) { requestAnimationFrame(function () { r(); }); setTimeout(r, 100); });
  }
  function lookChange(fn, skin) {
    var root = document.documentElement;
    if (!setting("appearanceMotion") || reducedMotion()) { fn(); return; }
    cover.jobs.push({ fn: fn, skin: skin });
    if (cover.phase === "veil" || cover.phase === "wait") return;   // joins the cover coming in
    clearTimeout(cover.timer);
    cover.phase = "veil";
    root.setAttribute("data-boot", "veil");
    cover.timer = setTimeout(swapLook, tokenMs("--cover-in-dur") + 30);
  }
  function swapLook() {
    var root = document.documentElement;
    cover.phase = "wait";
    root.setAttribute("data-boot", "wait");
    var batch = cover.jobs;
    cover.jobs = [];
    var faces = [];
    batch.forEach(function (j) {
      j.fn();
      if (j.skin) faces = faces.concat(SKIN_FONTS[j.skin] || []);
    });
    var loads = document.fonts && document.fonts.load
      ? faces.map(function (f) { return document.fonts.load(f).catch(function () {}); })
      : [];
    // The new look's first frames paint under the cover, not during the rise.
    Promise.all(loads).then(nextFrame).then(nextFrame).then(function () {
      if (cover.jobs.length) return swapLook();          // a pick arrived while fonts loaded
      cover.phase = "lift";
      root.setAttribute("data-boot", "lift");
      var rising = Math.min(document.querySelectorAll(".site-main > *").length, 6);
      var total = tokenMs("--boot-dur") + tokenMs("--boot-stagger") * Math.max(0, rising - 1);
      cover.timer = setTimeout(function () {
        cover.phase = null;
        if (root.getAttribute("data-boot") === "lift") root.removeAttribute("data-boot");
      }, total + 50);
    });
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
        // Under the look-change cover (unless Animate look changes is off).
        lookChange(function () { apply(axis, opt.id); }, axis.attr === "data-skin" ? opt.id : null);
        flyout.querySelectorAll(".flyout__item").forEach(function (el) {
          el.setAttribute("aria-checked", String(el === chip));
        });
      });

      flyout.appendChild(chip);
    });

    // Header toggles this group; opening it collapses the others (accordion).
    row.addEventListener("click", function () { toggleGroup(group, groups); });

    row.appendChild(label);
    row.appendChild(chev);
    group.appendChild(row);
    group.appendChild(flyout);
    return group;
  }

  /* Open or close one menu group, closing the others (the accordion).
     `force` pins the outcome. Returns whether the group is now open. */
  function toggleGroup(group, groups, force) {
    var willOpen = force === undefined ? !group.classList.contains("is-open") : force;
    groups.forEach(function (g) {
      if (g === group && willOpen) return;
      g.classList.remove("is-open");
      g.querySelector(".menu__row").setAttribute("aria-expanded", "false");
    });
    if (willOpen) {
      group.classList.add("is-open");
      group.querySelector(".menu__row").setAttribute("aria-expanded", "true");
    }
    return willOpen;
  }

  function make(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  /* Rows that slide in one after another (DeetsMusic pop.ts): the panel's
     rows when Settings opens, a section's rows when it unfolds. Only the
     first 12 animate, so a long section never hides its tail behind the
     stagger. Reduced motion: nothing moves. */
  function enterRows(els) {
    if (reducedMotion()) return;
    Array.prototype.slice.call(els, 0, 12).forEach(function (node, i) {
      node.style.setProperty("--pop-i", String(i));
      node.classList.add("pop-enter");
      node.addEventListener("animationend", function done(e) {
        if (e.target !== node) return;
        node.classList.remove("pop-enter");
        node.removeEventListener("animationend", done);
      });
    });
  }

  /* ── The Settings panel (the Vibe menu's last row) ─────────────────
     Ported from DeetsMusic's settings card. A control lives in exactly one
     place: theme and skin stay in their flyouts above. Everything applies
     live; there is no Save. Row kinds: toggle (key: boolean), choice (key +
     up to three [value, label] options, a split pill), range (key 0–100; a
     drag previews through previewSkin, the release writes the store). A row
     with `when` shows only while it holds (the skin-only rows). */
  function skinIs(id) { return document.documentElement.getAttribute("data-skin") === id; }
  function glass() { return skinIs("glass"); }
  var SECTIONS = [
    {
      title: S.look,
      defaultOpen: true,
      rows: [
        { kind: "toggle", id: "motion", label: S.motion, hint: S.motionHint, key: "appearanceMotion" },
        { kind: "choice", id: "bgmotion", label: S.bgMotion, hint: S.bgMotionHint, key: "backgroundMotion",
          options: [["on", S.on], ["reduced", S.reduced], ["off", S.off]] },
        { kind: "choice", id: "oceanedges", label: S.oceanEdges, hint: S.oceanEdgesHint, key: "oceanEdges",
          options: [["sand", S.sand], ["soft", S.soft]],
          when: function () { return skinIs("ocean"); } },
        { kind: "range", id: "oceansand", label: S.oceanSand, hint: S.oceanSandHint, key: "oceanSand", unit: "%",
          when: function () { return skinIs("ocean") && setting("oceanEdges") === "sand"; } },
        // Glass: the layers in paint order, back to front — the background
        // (glow, then its dim), then the card (its backlight, then the tint).
        { kind: "range", id: "glasscanvas", label: S.glassCanvas, hint: S.glassCanvasHint, key: "glassCanvasGlow", unit: "%", when: glass },
        { kind: "range", id: "glassdim", label: S.glassDim, hint: S.glassDimHint, key: "glassCanvasDim", unit: "%", when: glass },
        { kind: "range", id: "glassbacklight", label: S.glassBacklight, hint: S.glassBacklightHint, key: "glassBacklight", unit: "%", when: glass },
        { kind: "range", id: "glasstint", label: S.glassTint, hint: S.glassTintHint, key: "glassTint", unit: "%", when: glass },
        { kind: "choice", id: "toasts", label: S.toasts, hint: S.toastsHint, key: "toasts",
          options: [["all", S.everything], ["failures", S.failures]] },
      ],
    },
  ];

  // A range row's slider: pointer drag previews, release commits; arrows step
  // 1 (Shift 10), Home / End jump to the ends.
  function wireRange(el, out, r) {
    var dragging = false, last = clamp100(setting(r.key));
    function valueAt(x) {
      var b = el.getBoundingClientRect();
      return b.width > 0 ? clamp100((x - b.left) / b.width * 100) : last;
    }
    function show(v) {
      last = v;
      el.style.setProperty("--slider-fill", v + "%");
      el.setAttribute("aria-valuenow", String(v));
      out.textContent = v + r.unit;
      previewSkin(r.key, v);
    }
    el.addEventListener("pointerdown", function (e) {
      dragging = true;
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      el.focus({ preventScroll: true });
      show(valueAt(e.clientX));
    });
    el.addEventListener("pointermove", function (e) { if (dragging) show(valueAt(e.clientX)); });
    function end() {
      if (!dragging) return;
      dragging = false;
      setSetting(r.key, last);
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", function (e) {
      var step = e.shiftKey ? 10 : 1;
      var delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step }[e.key];
      var to = e.key === "Home" ? 0 : e.key === "End" ? 100
             : delta === undefined ? null : clamp100(setting(r.key)) + delta;
      if (to === null) return;
      e.preventDefault();
      setSetting(r.key, clamp100(to));
    });
  }

  function buildSettings(groups) {
    var NS = "http://www.w3.org/2000/svg";
    var group = make("div", "menu__group menu__group--settings");
    var row = make("button", "menu__row");
    row.type = "button";
    row.setAttribute("data-row", "settings");
    row.setAttribute("aria-expanded", "false");
    row.appendChild(make("span", "menu__label", S.settings));
    var chev = row.appendChild(make("span", "menu__chev", "▾"));
    chev.setAttribute("aria-hidden", "true");

    var wrap = make("div", "menu__set");
    var clip = wrap.appendChild(make("div", "menu__set-clip"));
    var body = clip.appendChild(make("div", "set"));
    group.appendChild(row);
    group.appendChild(wrap);

    // Section folds: only a user's own fold persists, as title → open.
    var folds = readJSON(FOLDS_KEY);
    function isOpen(s) {
      return Object.prototype.hasOwnProperty.call(folds, s.title) ? !!folds[s.title] : !!s.defaultOpen;
    }
    function saveFolds() {
      try { localStorage.setItem(FOLDS_KEY, JSON.stringify(folds)); } catch (e) {}
    }
    function shownRows(s) { return s.rows.filter(function (r) { return !r.when || r.when(); }); }
    function opened() { return group.classList.contains("is-open"); }

    // The row a request() opened fades a wash; a negative delay keeps its
    // clock when a later render rebuilds the row.
    var flashId = null, flashAt = 0;

    function headEl(s, count, open, index) {
      var h = make("h3", "set__head" + (open ? "" : " is-collapsed"));
      var b = h.appendChild(make("button", "set__fold"));
      b.type = "button";
      b.setAttribute("aria-expanded", String(open));
      b.setAttribute("data-focus", "fold:" + index);
      var svg = b.appendChild(document.createElementNS(NS, "svg"));
      svg.setAttribute("class", "set__chev");
      svg.setAttribute("viewBox", "0 0 10 6");
      svg.setAttribute("aria-hidden", "true");
      svg.appendChild(document.createElementNS(NS, "path")).setAttribute("d", "M1 1l4 4 4-4");
      b.appendChild(make("span", null, s.title));
      if (count) b.appendChild(make("span", "set__count", String(count)));
      b.addEventListener("click", function () {
        folds[s.title] = !open;
        saveFolds();
        render();
        // The opened section's rows slide in under its header; a close is instant.
        if (!open) enterRows(body.querySelectorAll('[data-section="' + index + '"] .set__row'));
      });
      return h;
    }

    function rowEl(r) {
      var node, label = make("span", "set__label", r.label);
      if (r.kind === "toggle") {
        node = make("button", "set__row set__row--toggle");
        node.type = "button";
        node.setAttribute("role", "switch");
        node.setAttribute("aria-checked", String(!!setting(r.key)));
        node.setAttribute("data-focus", "row:" + r.id);
        node.appendChild(label);
        node.appendChild(make("span", "set__dot")).setAttribute("aria-hidden", "true");
        node.addEventListener("click", function () { setSetting(r.key, !setting(r.key)); });
      } else if (r.kind === "choice") {
        node = make("div", "set__row set__row--choice");
        node.appendChild(label);
        var split = node.appendChild(make("div", "set__split"));
        split.setAttribute("role", "radiogroup");
        split.setAttribute("aria-label", r.label);
        r.options.forEach(function (o) {
          var half = split.appendChild(make("button", "set__half", o[1]));
          half.type = "button";
          half.setAttribute("aria-pressed", String(setting(r.key) === o[0]));
          half.setAttribute("data-focus", "row:" + r.id + ":" + o[0]);
          half.addEventListener("click", function () { setSetting(r.key, o[0]); });
        });
      } else {
        var v = clamp100(setting(r.key));
        node = make("div", "set__row set__row--range");
        node.appendChild(label);
        var slider = node.appendChild(make("div", "set__range"));
        slider.tabIndex = 0;
        slider.setAttribute("role", "slider");
        slider.setAttribute("aria-label", r.label);
        slider.setAttribute("aria-valuemin", "0");
        slider.setAttribute("aria-valuemax", "100");
        slider.setAttribute("aria-valuenow", String(v));
        slider.setAttribute("data-focus", "row:" + r.id);
        slider.style.setProperty("--slider-fill", v + "%");
        slider.appendChild(make("div", "set__range-track")).appendChild(make("div", "set__range-fill"));
        slider.appendChild(make("span", "set__range-handle")).setAttribute("aria-hidden", "true");
        var out = node.appendChild(make("span", "set__range-val", v + r.unit));
        wireRange(slider, out, r);
      }
      node.setAttribute("data-set-row", r.id);
      if (r.hint) node.title = r.hint;   // hints are a tooltip only; labels stand alone
      var since = performance.now() - flashAt;
      if (r.id === flashId && since < tokenMs("--set-flash-dur")) {
        node.classList.add("is-flash");
        node.style.animationDelay = -Math.round(since) + "ms";
      }
      return node;
    }

    // Rebuilt on every change (a dozen rows). Focus and scroll stay put.
    function render() {
      var active = document.activeElement;
      var focusKey = active && body.contains(active) ? active.getAttribute("data-focus") : null;
      var top = body.scrollTop;
      body.textContent = "";
      SECTIONS.forEach(function (s, i) {
        var rows = shownRows(s), open = isOpen(s);
        var sec = body.appendChild(make("section", "set__section"));
        sec.setAttribute("data-section", String(i));
        sec.appendChild(headEl(s, rows.length, open, i));
        if (open) rows.forEach(function (r) { sec.appendChild(rowEl(r)); });
      });
      body.scrollTop = top;
      if (focusKey) {
        Array.prototype.some.call(body.querySelectorAll("[data-focus]"), function (n) {
          if (n.getAttribute("data-focus") !== focusKey) return false;
          n.focus({ preventScroll: true });
          return true;
        });
      }
      markScrollable();
    }
    // The scrollbar thumb fades in only while the rows outgrow the panel.
    function markScrollable() {
      body.classList.toggle("is-scrollable", body.scrollHeight > body.clientHeight + 1);
    }
    if (window.ResizeObserver) new ResizeObserver(markScrollable).observe(body);

    row.addEventListener("click", function () {
      if (toggleGroup(group, groups)) {
        render();
        enterRows(body.querySelectorAll(".set__head, .set__row"));
      }
    });
    onSettingsChange(function () { if (opened()) render(); });
    // Skin-only rows come and go with the skin.
    document.addEventListener("deets:appearance", function () { if (opened()) render(); });

    // Deep link: open Settings, unfold the row's section, bring the row into
    // view, and flash it. The caller opens the menu first.
    function request(id) {
      var s = SECTIONS.filter(function (x) {
        return x.rows.some(function (r) { return r.id === id; });
      })[0];
      if (!s) return;
      toggleGroup(group, groups, true);
      if (!isOpen(s)) { folds[s.title] = true; saveFolds(); }
      flashId = id;
      flashAt = performance.now();
      render();
      var node = body.querySelector('[data-set-row="' + id + '"]');
      if (node) node.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    }

    return { group: group, request: request };
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
    var settingsPanel = buildSettings(groups);
    groups.push(themeGroup, skinGroup, settingsPanel.group);
    menu.appendChild(themeGroup);
    menu.appendChild(skinGroup);
    menu.appendChild(settingsPanel.group);

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

    // DeetsSettings.request(rowId): open the menu at that Settings row (a
    // toast's [Settings] action points here).
    window.DeetsSettings.request = function (id) {
      if (menu.hidden) open();
      settingsPanel.request(id);
    };

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

  // The settings store for page scripts. `request` is wired once the Vibe
  // menu exists (buildMenu); before that it does nothing.
  window.DeetsSettings = {
    get: setting,
    set: setSetting,
    onChange: onSettingsChange,
    request: function () {},
  };

  function init() {
    inject(buildOcean()); inject(buildAurora()); inject(buildStorm()); inject(layer("boot-cover"));
    watchVisibility(); buildMenu(); buildNavMenu();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
