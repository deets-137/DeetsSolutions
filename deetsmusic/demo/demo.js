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
