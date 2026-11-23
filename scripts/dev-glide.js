/* Dev glide picker (2026-11-23). Local dev only: scripts/dev.js puts it in
   every page's <head>, right after the dev trace, not deferred. Never in the
   served tree, never on Pages.

   Tries motion curves for the nav glass's glide between pages (chrome.css,
   "The wide layout"; tokens --dur-glide / --ease-glide in skin.css). A pick
   is saved in localStorage and set on <html> as inline custom properties
   before this page's first frame, which is when the incoming page's
   transition reads them. So pick a curve, then click around the nav.
   "Site default" removes the override. When one feels right, copy its
   values into skin.css. docs/tooling.md §3d. */
(function () {
  "use strict";
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;

  var KEY = "deets-dev-glide";
  var PRESETS = [
    { id: "default",    name: "Site default (Heavy)",              ease: null, ms: null },
    { id: "weighted",   name: "Weighted: slow, fast, settle",       ease: "cubic-bezier(0.65, 0, 0.35, 1)", ms: 360 },
    { id: "heavy",      name: "Heavy: long wind-up, firm landing",  ease: "cubic-bezier(0.83, 0, 0.17, 1)", ms: 440 },
    { id: "soft",       name: "Soft in-out (CSS ease-in-out)",      ease: "ease-in-out",                     ms: 340 },
    { id: "accelerate", name: "Accelerate: speeds up to the end",   ease: "cubic-bezier(0.5, 0, 0.75, 0)",   ms: 300 },
    { id: "settle",     name: "Settle: slow start, small overshoot", ease: "cubic-bezier(0.6, 0, 0.25, 1.2)", ms: 420 },
    { id: "before",     name: "Before: quick start, eases out",     ease: "cubic-bezier(0.3, 0.7, 0.2, 1)",  ms: 280 },
    { id: "linear",     name: "Linear (for comparison)",            ease: "linear",                          ms: 300 }
  ];

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function save(v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) {} }
  function apply(v) {
    var s = document.documentElement.style;
    if (v && v.ease) { s.setProperty("--ease-glide", v.ease); s.setProperty("--dur-glide", v.ms + "ms"); }
    else { s.removeProperty("--ease-glide"); s.removeProperty("--dur-glide"); }
  }
  var pick = load();
  apply(pick);   // now, before the first frame

  function build() {
    var css = document.createElement("style");
    css.textContent =
      ".dg-pill{position:fixed;left:calc(var(--space-3) + 6.5rem);bottom:var(--space-3);z-index:2147483000;" +
      "font:inherit;font-family:var(--font-body);color:var(--text);background:var(--surface);" +
      "border:1px solid var(--border);border-radius:var(--radius-control);padding:var(--space-1) var(--space-2);cursor:pointer;opacity:.6}" +
      ".dg-pill:hover,.dg-pill[aria-expanded=true]{opacity:1;border-color:var(--title)}" +
      ".dg-panel{position:fixed;left:var(--space-3);bottom:calc(var(--space-3) + 2.6rem);z-index:2147483000;width:22rem;" +
      "display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);font-family:var(--font-body);font-size:.85rem;" +
      "color:var(--text);background:var(--menu-surface);border:1px solid var(--border);border-radius:var(--radius-panel);box-shadow:var(--shadow-panel)}" +
      ".dg-panel[hidden]{display:none}" +
      ".dg-panel label{display:flex;gap:var(--space-2);align-items:center;cursor:pointer}" +
      ".dg-panel input[type=text]{flex:1;font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-control);padding:2px var(--space-2)}" +
      ".dg-panel .dg-now{color:var(--subtext);font-size:.78rem;word-break:break-all}" +
      ".dg-panel svg{width:100%;height:4.5rem}";
    document.head.appendChild(css);

    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "dg-pill"; btn.setAttribute("aria-expanded", "false");
    var panel = document.createElement("div");
    panel.className = "dg-panel"; panel.hidden = true;

    var rows = PRESETS.map(function (p) {
      return '<label><input type="radio" name="dg" value="' + p.id + '"> ' + p.name + (p.ms ? " · " + p.ms + " ms" : "") + "</label>";
    }).join("");
    panel.innerHTML =
      "<strong>Glide curve</strong>" + rows +
      '<label>Duration <input type="range" min="120" max="900" step="20" data-dg-ms style="flex:1"> <span data-dg-msv></span></label>' +
      '<label>Custom <input type="text" data-dg-ease placeholder="cubic-bezier(…) or linear(…)"></label>' +
      '<svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><path data-dg-curve fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' +
      '<div class="dg-now" data-dg-now></div>' +
      '<div class="dg-now">Pick, then click around the nav. Copy a keeper into skin.css (--ease-glide, --dur-glide).</div>';

    var msIn = panel.querySelector("[data-dg-ms]"), msV = panel.querySelector("[data-dg-msv]");
    var easeIn = panel.querySelector("[data-dg-ease]"), now = panel.querySelector("[data-dg-now]");
    var curve = panel.querySelector("[data-dg-curve]");

    function current() {
      var cs = getComputedStyle(document.documentElement);
      return { ease: cs.getPropertyValue("--ease-glide").trim(), ms: Math.round(parseFloat(cs.getPropertyValue("--dur-glide")) * (/ms$/.test(cs.getPropertyValue("--dur-glide").trim()) ? 1 : 1000)) };
    }
    /** Draws the curve: time across, progress up (a cubic-bezier only). */
    function draw(ease) {
      var m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(ease || "");
      var named = { "linear": [0, 0, 1, 1], "ease-in-out": [0.42, 0, 0.58, 1], "ease": [0.25, 0.1, 0.25, 1] };
      var p = m ? m.slice(1).map(Number) : named[ease];
      if (!p) { curve.setAttribute("d", ""); return; }
      var y = function (v) { return 55 - v * 50; };
      curve.setAttribute("d", "M0," + y(0) + " C" + p[0] * 100 + "," + y(p[1]) + " " + p[2] * 100 + "," + y(p[3]) + " 100," + y(1));
    }
    function sync() {
      var c = current();
      var id = pick ? pick.id : "default";
      panel.querySelectorAll("input[name=dg]").forEach(function (r) { r.checked = r.value === id; });
      msIn.value = c.ms; msV.textContent = c.ms + " ms";
      easeIn.value = pick && pick.id === "custom" ? pick.ease : "";
      now.textContent = "Now: " + c.ease + ", " + c.ms + " ms" + (pick ? " (dev override)" : " (skin.css)");
      btn.textContent = "Glide: " + (pick ? (PRESETS.filter(function (p) { return p.id === pick.id; })[0] || { name: "Custom" }).name.split(":")[0] : "default");
      draw(c.ease);
    }
    function set(v) { pick = v; save(v); apply(v); sync(); }

    panel.addEventListener("change", function (e) {
      if (e.target.name === "dg") {
        var p = PRESETS.filter(function (x) { return x.id === e.target.value; })[0];
        set(p.ease ? { id: p.id, ease: p.ease, ms: p.ms } : null);
      }
    });
    msIn.addEventListener("input", function () {
      var c = current();
      set({ id: pick ? pick.id : "custom", ease: pick ? pick.ease : c.ease, ms: Number(msIn.value) });
    });
    easeIn.addEventListener("change", function () {
      var v = easeIn.value.trim();
      if (!v) return;
      if (!CSS.supports("transition-timing-function", v)) { now.textContent = "Not a valid curve: " + v; return; }
      set({ id: "custom", ease: v, ms: Number(msIn.value) });
    });
    btn.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      btn.setAttribute("aria-expanded", String(!panel.hidden));
    });
    document.body.appendChild(panel);
    document.body.appendChild(btn);
    sync();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
