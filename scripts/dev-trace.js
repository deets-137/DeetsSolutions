/* Dev trace — the page half (2026-11-23). Local dev only: scripts/dev.js puts
   it FIRST in every page's <head>, not deferred, so its listeners are in place
   before the page's first frame (a page transition is decided then:
   `pagereveal` fires before the first render, `pageswap` as the old page
   leaves). Never in the served tree, never on Pages.

   It records what happens around every page change and while a page runs,
   and posts it to the dev driver's side port, which keeps the log
   (scripts/dev-driver-server.js; read it with curl /__dev/trace, see
   docs/tooling.md §3c):
     click        a link you clicked (and when, for click-to-page timing)
     swap / hide  the old page leaving: did a view transition start, which
                  navigation type, did the page go into the back/forward cache
     arrive       the new page: navigation type, from where, ms since the click,
                  window, cores, memory, network
     reveal       pagereveal: did a view transition run, the transition names
                  in the nav (duplicates abort it), font state at first frame,
                  the layout at that moment (wide query, widths, body box)
     vt-ready / vt-skipped / vt-finished   the transition's outcome and reason
     bfcache-restore / bfcache-miss        a back/forward page from memory, or
                  the browser's reasons it was not (notRestoredReasons)
     first-frame  the layout again at the first frame after reveal
     frames       frame pacing for 1.5 s after arrival: frames, dropped, worst
     loaf         long animation frames (>50 ms) with the scripts that filled them
     shift        layout shifts, with the elements that moved
     paint        first paint, first contentful paint, largest contentful paint
     fonts        faces that finished loading, and when (vs. first paint)
     resources    what loaded from cache, what was revalidated (304), what
                  came over the network, and the slowest render-blocking ones
     lag          the main thread was busy: a timer fired late by > 50 ms
     cpu          the system's CPU pressure (Chrome's Compute Pressure API)
     slow-input   an interaction that took > 100 ms to paint
     error        uncaught errors and rejections
   Its own cost: one small blocking script per page, a timer every 500 ms,
   and a rAF loop for the first 1.5 s. Turn it off with DEETS_TRACE=0. */
(function () {
  "use strict";
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;

  var SIDE = "http://" + location.hostname + ":__SIDE_PORT__";
  var CLICK_KEY = "deets-dev-trace-click";
  var LAST_KEY = "deets-dev-trace-last";
  var visit = Math.random().toString(16).slice(2, 8);
  var page = location.pathname + location.search;
  var queue = [];

  function store(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ms(v) { return v == null ? null : Math.round(v); }

  function emit(kind, data) {
    queue.push({ at: new Date().toISOString(), t: ms(performance.now()), tab: read("deets-dev-tab"),
      visit: visit, page: page, kind: kind, data: data || {} });
    if (queue.length >= 40) flush(false);
  }
  function flush(leaving) {
    if (!queue.length) return;
    var body = JSON.stringify(queue);
    queue = [];
    // text/plain keeps it a "simple" cross-origin request (no preflight)
    if (leaving && navigator.sendBeacon) {
      navigator.sendBeacon(SIDE + "/trace", new Blob([body], { type: "text/plain" }));
      return;
    }
    fetch(SIDE + "/trace", { method: "POST", headers: { "content-type": "text/plain" }, body: body, keepalive: true })
      .catch(function () {});
  }
  setInterval(function () { flush(false); }, 1000);

  /** Describes an element in a few words: tag, id, first class, a bit of text. */
  function describe(el) {
    if (!el || !el.tagName) return null;
    var cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/)[0] : "";
    var text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24);
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls + (text ? ' "' + text + '"' : "");
  }

  function system() {
    var c = navigator.connection;
    return {
      cores: navigator.hardwareConcurrency || null,
      memGB: navigator.deviceMemory || null,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      net: c ? c.effectiveType + (c.saveData ? " save-data" : "") : null
    };
  }

  /** The view-transition names in the nav, and any used twice (a duplicate
   *  makes the browser abort the whole transition). */
  function names() {
    var seen = {}, dup = [];
    var els = document.querySelectorAll(".site-nav, .site-nav *");
    for (var i = 0; i < els.length; i++) {
      var n = getComputedStyle(els[i]).viewTransitionName;
      if (!n || n === "none") continue;
      if (seen[n]) dup.push(n);
      seen[n] = describe(els[i]);
    }
    // the glass slides to the current page's item (chrome.css, "The wide layout")
    var cur = document.querySelector('.site-nav a[aria-current="page"]');
    return { count: Object.keys(seen).length, tile: cur ? describe(cur) : null, duplicates: dup };
  }

  /** Which layout the page is in right now: does the wide layout's media
   *  query match, what width the page sees, and how the body is laid out. */
  function layoutNow() {
    var b = document.body;
    var bs = b ? getComputedStyle(b) : null;
    var r = b ? b.getBoundingClientRect() : null;
    return {
      wide: matchMedia("(min-width: 82rem)").matches,
      innerWidth: innerWidth, clientWidth: document.documentElement.clientWidth,
      body: bs ? bs.display + " " + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "w" : "no body yet",
      sheets: document.styleSheets.length
    };
  }

  /** Font faces not yet loaded: at the first frame, these paint late. */
  function fontsPending() {
    var out = [];
    if (document.fonts && document.fonts.forEach) {
      document.fonts.forEach(function (f) { if (f.status === "loading") out.push(f.family.replace(/"/g, "") + " " + f.weight); });
    }
    return { status: document.fonts ? document.fonts.status : null, loading: out };
  }

  /* ── leaving ───────────────────────────────────────────────── */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank" || e.defaultPrevented) return;
    var href = a.getAttribute("href");
    if (href.charAt(0) === "#") return;
    emit("click", { href: href, text: describe(a) });
    store(CLICK_KEY, JSON.stringify({ href: a.href, at: Date.now() }));
  }, true);

  window.addEventListener("pageswap", function (e) {
    var a = e.activation;
    emit("swap", {
      vt: !!e.viewTransition,
      to: a && a.entry ? a.entry.url.replace(location.origin, "") : null,
      type: a ? a.navigationType : null
    });
    flush(true);
  });
  window.addEventListener("pagehide", function (e) {
    store(LAST_KEY, page);
    emit("hide", { bfcache: e.persisted });
    flush(true);
  });

  /* ── arriving ──────────────────────────────────────────────── */
  var nav = performance.getEntriesByType("navigation")[0];
  var click = null;
  try { click = JSON.parse(read(CLICK_KEY) || "null"); } catch (e) {}
  store(CLICK_KEY, null);
  emit("arrive", {
    type: nav ? nav.type : null,
    activation: window.navigation && navigation.activation ? navigation.activation.navigationType : null,
    from: read(LAST_KEY),
    sinceClickMs: click && click.href === location.href ? Date.now() - click.at : null,
    prerendered: nav && nav.activationStart > 0 ? ms(nav.activationStart) + "ms" : false,
    browser: navigator.userAgentData ? navigator.userAgentData.brands.filter(function (b) { return !/Not.?A.?Brand/.test(b.brand); })
      .map(function (b) { return b.brand + " " + b.version; }).join(", ") : navigator.userAgent,
    viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
    system: system()
  });
  if (nav && nav.type === "back_forward" && nav.notRestoredReasons) {
    var r = nav.notRestoredReasons, why = [];
    (function walk(n) {
      if (!n) return;
      (n.reasons || []).forEach(function (x) { why.push(x.reason || x); });
      (n.children || []).forEach(walk);
    })(r);
    emit("bfcache-miss", { blocked: r.blocked, reasons: why });
  }

  window.addEventListener("pagereveal", function (e) {
    var vt = e.viewTransition;
    // A page restored from the back/forward cache reveals again; its own
    // arrive was long ago, so say which this is.
    // the look is read here, not at arrive: this script runs before the
    // pre-paint script sets it, so arrive would see the HTML's defaults
    emit("reveal", { vt: !!vt, names: names(), fonts: fontsPending(), layout: layoutNow(),
      look: [document.documentElement.getAttribute("data-theme"), document.documentElement.getAttribute("data-skin")] });
    // and again at the first frame after it: did the layout change between?
    requestAnimationFrame(function () { emit("first-frame", { layout: layoutNow() }); });
    frames(vt ? "transition" : "arrival", 1500);
    if (!vt) return;
    var t0 = performance.now();
    vt.ready.then(
      function () { emit("vt-ready", { ms: ms(performance.now() - t0) }); },
      function (err) { emit("vt-skipped", { reason: err ? (err.name + ": " + err.message) : "unknown" }); }
    );
    vt.finished.then(function () { emit("vt-finished", { ms: ms(performance.now() - t0) }); }, function () {});
  });
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) { page = location.pathname + location.search; emit("bfcache-restore", { system: system() }); }
  });

  /* ── frames: pacing for a while after arrival ──────────────── */
  function frames(label, span) {
    var gaps = [], last = 0, end = performance.now() + span;
    requestAnimationFrame(function step(now) {
      if (last) gaps.push(now - last);
      last = now;
      if (now < end) return requestAnimationFrame(step);
      if (!gaps.length) return emit("frames", { label: label, frames: 0, note: "no frames (hidden tab?)" });
      var sorted = gaps.slice().sort(function (a, b) { return a - b; });
      var beat = sorted[Math.floor(sorted.length / 2)];   // the display's frame time
      var dropped = 0;
      gaps.forEach(function (g) { if (g > beat * 1.5) dropped += Math.round(g / beat) - 1; });
      emit("frames", {
        label: label, frames: gaps.length, hz: Math.round(1000 / beat),
        dropped: dropped, worstMs: ms(sorted[sorted.length - 1])
      });
    });
  }

  /* ── the browser's own timing entries ──────────────────────── */
  function observe(type, fn, opts) {
    try {
      new PerformanceObserver(function (list) { list.getEntries().forEach(fn); })
        .observe(Object.assign({ type: type, buffered: true }, opts || {}));
    } catch (e) { /* this browser doesn't report that type */ }
  }
  observe("paint", function (p) { emit("paint", { name: p.name, ms: ms(p.startTime) }); });
  var lcp = null;
  observe("largest-contentful-paint", function (p) { lcp = { ms: ms(p.startTime), el: describe(p.element) }; });
  observe("layout-shift", function (s) {
    if (s.value < 0.001) return;
    emit("shift", {
      value: Math.round(s.value * 1000) / 1000, input: s.hadRecentInput,
      moved: (s.sources || []).slice(0, 4).map(function (x) {
        var a = x.previousRect, b = x.currentRect;
        return describe(x.node) + (a && b ? " " + Math.round(a.x) + "," + Math.round(a.y) + " " + Math.round(a.width) + "w → " +
          Math.round(b.x) + "," + Math.round(b.y) + " " + Math.round(b.width) + "w" : "");
      })
    });
  });
  var loafs = 0;
  observe("long-animation-frame", function (f) {
    if (++loafs > 30) return;   // a busy page: the first 30 say enough
    emit("loaf", {
      ms: ms(f.duration), blockingMs: ms(f.blockingDuration), at: ms(f.startTime),
      styleLayoutMs: ms(f.styleAndLayoutStart ? f.startTime + f.duration - f.styleAndLayoutStart : null),
      scripts: (f.scripts || []).slice(0, 3).map(function (s) {
        return { ms: ms(s.duration), by: s.invoker, src: (s.sourceURL || "").replace(location.origin, "") + (s.sourceFunctionName ? " " + s.sourceFunctionName : "") };
      })
    });
  });
  observe("event", function (ev) {
    if (ev.duration < 100) return;
    emit("slow-input", { name: ev.name, ms: ms(ev.duration), target: describe(ev.target) });
  }, { durationThreshold: 104 });

  if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener("loadingdone", function (e) {
      emit("fonts", { loaded: (e.fontfaces || []).map(function (f) { return f.family.replace(/"/g, "") + " " + f.weight; }), ms: ms(performance.now()) });
    });
  }

  /* ── resources: cache, revalidated, network; what blocked rendering ── */
  window.addEventListener("load", function () {
    setTimeout(function () {
      var list = performance.getEntriesByType("resource"), cache = 0, revalidated = 0, network = 0, blocking = [];
      list.forEach(function (r) {
        var how = r.transferSize === 0 ? "cache" : r.encodedBodySize > 0 && r.transferSize < 1024 && r.transferSize < r.encodedBodySize ? "304" : "network";
        if (how === "cache") cache++; else if (how === "304") revalidated++; else network++;
        if (r.renderBlockingStatus === "blocking") blocking.push({ src: r.name.replace(location.origin, ""), ms: ms(r.duration), how: how });
      });
      blocking.sort(function (a, b) { return b.ms - a.ms; });
      emit("resources", {
        total: list.length, cache: cache, revalidated: revalidated, network: network,
        blocking: blocking.slice(0, 6),
        doc: nav ? { responseMs: ms(nav.responseEnd), domReadyMs: ms(nav.domContentLoadedEventEnd), loadMs: ms(nav.loadEventEnd || performance.now()) } : null,
        lcp: lcp
      });
    }, 1000);
  });

  /* ── load: a late timer, and the system's CPU pressure ─────── */
  var due = performance.now() + 500;
  setInterval(function () {
    var late = performance.now() - due;
    due = performance.now() + 500;
    if (late > 50 && document.visibilityState === "visible") emit("lag", { lateMs: ms(late), heapMB: system().heapMB });
  }, 500);
  if ("PressureObserver" in window) {
    try {
      var cpu = new PressureObserver(function (recs) {
        var r = recs[recs.length - 1];
        emit("cpu", { state: r.state });
      });
      Promise.resolve(cpu.observe("cpu", { sampleInterval: 1000 })).catch(function (err) { emit("cpu", { error: String(err) }); });
    } catch (e) { emit("cpu", { error: String(e) }); }
  }

  document.addEventListener("visibilitychange", function () { emit("visibility", { state: document.visibilityState }); });
  window.addEventListener("error", function (e) { emit("error", { text: (e.message || "error") + (e.filename ? " @ " + e.filename.replace(location.origin, "") + ":" + e.lineno : "") }); });
  window.addEventListener("unhandledrejection", function (e) { emit("error", { text: "unhandled rejection: " + (e.reason && e.reason.message || e.reason) }); });
})();
