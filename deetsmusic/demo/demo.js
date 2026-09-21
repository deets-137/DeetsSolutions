/* DeetsMusic demo page (DeetsMusic repo: docs/features/WEB-DEMO.md §6).

   The app in the frame is the DeetsMusic build; its shim posts to this page:
     resize {w, h}  — the app set its window size (a surface change, the launch)
     min {w, h}     — the app's smallest window for that surface
     appearance     — the app changed its theme or skin: its box follows it
   Both sides check the origin: the frame is same-origin. */
(function () {
  "use strict";
  var S = window.DMD_STRINGS || {};
  var root = document.querySelector("[data-dmd]");
  if (!root) return;

  // ── Copy ──
  root.querySelectorAll("[data-s]").forEach(function (el) { el.textContent = S[el.dataset.s] || ""; });
  root.querySelectorAll("[data-s-label]").forEach(function (el) { el.setAttribute("aria-label", S[el.dataset.sLabel] || ""); });
  root.querySelectorAll("[data-s-title]").forEach(function (el) { el.setAttribute("title", S[el.dataset.sTitle] || ""); });

  var stage = root.querySelector("[data-dmd-stage]");
  var frame = root.querySelector("[data-dmd-frame]");
  var app = root.querySelector("[data-dmd-app]");

  // The app's own launch size until it names one (tauri.conf.json: 480 × 864).
  var size = { w: 480, h: 864 };

  // The app keeps its own size; a frame narrower than the page scales it down, so a
  // phone still sees the whole window.
  function layout() {
    var pad = frame.offsetWidth - frame.clientWidth + parseFloat(getComputedStyle(frame).paddingLeft) * 2;
    var room = Math.max(1, stage.clientWidth - pad);
    var k = Math.min(1, room / size.w);
    app.style.width = size.w + "px";
    app.style.height = size.h + "px";
    app.style.transform = k < 1 ? "scale(" + k + ")" : "";
    frame.style.width = Math.round(size.w * k + pad) + "px";
    frame.style.height = Math.round(size.h * k + pad) + "px";
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || e.source !== app.contentWindow) return;
    var d = e.data || {};
    if (d.type !== "deets-demo") return;
    if (d.kind === "resize" && d.w > 0 && d.h > 0) {
      size = { w: Math.round(d.w), h: Math.round(d.h) };
      layout();
    } else if (d.kind === "appearance" && d.look) {
      // The app's look reaches its own box only. The site's tokens hang on any
      // [data-theme] / [data-skin] element, so the box re-scopes them; the rest of
      // the page and the site's saved choice stay as they are.
      if (d.look.theme) frame.setAttribute("data-theme", d.look.theme);
      if (d.look.skin) frame.setAttribute("data-skin", d.look.skin);
    }
  });

  // The quick clusters: Look 1–4 (a theme + skin pair) and the Surfaces (Player, Mini,
  // Midi, Max). Each presses the app's own title-menu items (same-origin frame), so a
  // pick takes the app's real path: its transition, its look-schedule hold, its window
  // resize, and the messages above. A theme and a skin pressed back to back share one
  // transition; only the half that differs is pressed. Player and Mini are the two
  // halves of the menu's "Mini | Player" row (data-mini-choice).
  var looks = root.querySelectorAll("[data-dmd-look]");
  var surfaces = root.querySelectorAll("[data-dmd-surface]");
  function appRoot() {
    try { return app.contentDocument && app.contentDocument.documentElement; } catch (e) { return null; }
  }
  function attr(el, name) { return el.getAttribute(name) || ""; }
  // "mini player" / "mini cards" on mini, the bare surface name otherwise.
  function surfaceNow(el) {
    var s = attr(el, "data-surface");
    return s === "mini" ? s + " " + (attr(el, "data-mini") || "cards") : s;
  }
  function light(buttons, key, now) {
    buttons.forEach(function (b) {
      var on = b.dataset[key] === now;
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("home__cta--soft", !on);
    });
  }
  function mark() {
    var el = appRoot();
    if (!el) return;
    light(looks, "dmdLook", attr(el, "data-theme") + " " + attr(el, "data-skin"));
    light(surfaces, "dmdSurface", surfaceNow(el));
  }
  function press(selector) {
    var item = app.contentDocument.querySelector(selector);
    if (item) item.click();
  }
  looks.forEach(function (b) {
    b.addEventListener("click", function () {
      var el = appRoot();
      if (!el) return;
      var pair = b.dataset.dmdLook.split(" ");
      if (attr(el, "data-theme") !== pair[0]) press('[data-theme-choice="' + pair[0] + '"]');
      if (attr(el, "data-skin") !== pair[1]) press('[data-skin-choice="' + pair[1] + '"]');
    });
  });
  surfaces.forEach(function (b) {
    b.addEventListener("click", function () {
      var el = appRoot();
      if (!el || surfaceNow(el) === b.dataset.dmdSurface) return;
      var pick = b.dataset.dmdSurface.split(" ");
      press('[data-surface-choice="' + pick[0] + '"]' + (pick[1] ? '[data-mini-choice="' + pick[1] + '"]' : ""));
    });
  });
  // The app flips these attributes on <html> for every change, whoever made it (these
  // buttons, its own menu, the look schedule). A reload is a new document: watch again.
  var watcher = new MutationObserver(mark);
  function watch() {
    var el = appRoot();
    watcher.disconnect();
    if (el) watcher.observe(el, { attributes: true, attributeFilter: ["data-theme", "data-skin", "data-surface", "data-mini"] });
    mark();
  }
  app.addEventListener("load", watch);
  watch();

  // Start over: the app keeps a visitor's changes in this site's localStorage under
  // its own `deets.` keys (the site's own keys use `deets-`, so they stay).
  var reset = root.querySelector("[data-dmd-reset]");
  if (reset) reset.addEventListener("click", function () {
    if (!window.confirm(S.resetAsk || "")) return;
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf("deets.") === 0) localStorage.removeItem(k); });
    } catch (e) {}
    app.contentWindow.location.reload();
  });

  window.addEventListener("resize", layout);
  layout();
})();
