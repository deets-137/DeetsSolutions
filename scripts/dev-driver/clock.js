/* Dev driver, page half — the stepped clock (clock/*), the flight log
   (fly/log) and trap. Needs anims.js (it drives caught animations). */

/* ── the stepped clock: one clock for rAF loops AND animations ──
   anims/* only reaches Web/CSS Animations. A loop that writes styles
   every requestAnimationFrame (games/flights.js' chips) ignores them.
   clock/freeze swaps requestAnimationFrame and performance.now for a
   clock that only moves on clock/step, and catches every animation
   (anims/catch) so each one's local time follows the same clock. Page
   timers (setTimeout, Date.now) stay real: bots and the shell's own
   timers keep running, so pair it with pace?hold=1. */
var clk = null, clkAnim = new WeakMap(), flyLog = [], flySel = null;
var clkDone = new WeakSet();   // finished by the clock; a fill:forwards one stays listed, and isn't caught again
var realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window);
performance.now = function () { return clk ? clk.t : realNow(); };
// every real rAF goes through `pend`, so a freeze can take back callbacks
// already queued: a loop's next frame belongs to the stepped clock too,
// and a hidden tab would never run it at all
var pend = new Map(), pendN = 0;
window.requestAnimationFrame = function (fn) {
  if (clk) { clk.q.push(fn); return 1e9 + clk.q.length; }
  var key = ++pendN;
  pend.set(key, fn);
  realRaf(function (ts) { var f = pend.get(key); if (!f) return; pend.delete(key); f(ts); });
  return key;
};
var realCancel = window.cancelAnimationFrame.bind(window);
window.cancelAnimationFrame = function (h) {
  if (pend.delete(h)) return;
  if (clk && h > 1e9) { clk.q[h - 1e9 - 1] = function () {}; return; }
  realCancel(h);
};
function clockFreeze(a) {
  if (clk) return { frozen: true, t: 0, already: true };
  clk = { t: realNow(), t0: realNow(), q: [] };
  pend.forEach(function (fn) { clk.q.push(fn); });
  pend.clear();
  clkAnim = new WeakMap(); clkDone = new WeakSet();
  if (a.anims !== "0") C["anims/catch"]({ sel: a.animsel || "body" });
  return { frozen: true, t: 0 };
}
function clockAdvance(ms) {
  clk.t += ms;
  var q = clk.q; clk.q = [];
  q.forEach(function (fn) { try { fn(clk.t); } catch (e) {} });
  if (catcher) grab();
  caught = caught.filter(function (an) {
    var k = clkAnim.get(an);
    if (!k) { k = { at: clk.t - ms, base: an.currentTime || 0 }; clkAnim.set(an, k); }
    var t = k.base + (clk.t - k.at), end = an.effect ? an.effect.getComputedTiming().endTime : Infinity;
    // past its end, an animation FINISHES, as it would in real time: its
    // `finished` promise and onfinish fire (a page waiting on them goes on —
    // mahjong's tile flights land), and it leaves the caught set. A paused
    // one parked at its end would never finish at all.
    if (end !== Infinity && t >= end) { clkDone.add(an); try { an.finish(); } catch (e) {} return false; }
    an.currentTime = t;
    return true;
  });
}
// what the flight log records per step: each match's viewport centre,
// size, transform and opacity
function flySample() {
  if (!flySel) return;
  var row = { t: Math.round(clk.t - clk.t0), els: [] };
  document.querySelectorAll(flySel).forEach(function (e) {
    var r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    row.els.push({ x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
      w: +r.width.toFixed(1), h: +r.height.toFixed(1), transform: cs.transform, opacity: +cs.opacity });
  });
  flyLog.push(row);
}
// clock/freeze (&animsel= limits which animations follow it; anims=0 for none)
C["clock/freeze"] = function (a) { return clockFreeze(a); };
// clock/step?ms=200&by=10 — advance in `by` slices, each running the rAF
// queue and setting every caught animation's time; the flight log (if
// armed) samples every slice. Returns once a real frame has painted.
C["clock/step"] = async function (a) {
  if (!clk) throw new Error("the clock isn't frozen (clock/freeze or trap first)");
  var ms = Number(a.ms) || 0, by = Math.max(1, Number(a.by) || 10), left = ms;
  while (left > 0) { var d = Math.min(by, left); clockAdvance(d); flySample(); left -= d; }
  if (!ms) { clockAdvance(0); flySample(); }
  var p = await new Promise(function (resolve) {
    var done = false, fin = function (v) { if (!done) { done = true; resolve(v); } };
    realRaf(function () { realRaf(function () { fin(true); }); });
    setTimeout(function () { fin(false); }, 250);
  });
  return { t: Math.round(clk.t - clk.t0), painted: p, caught: caught.length, last: flyLog.length ? flyLog[flyLog.length - 1] : null };
};
// clock/thaw — real time again: queued rAF callbacks run on the next real
// frame, caught animations play on from where they stand
C["clock/thaw"] = function () {
  if (!clk) return { frozen: false };
  var q = clk.q, t = Math.round(clk.t - clk.t0);
  clk = null;
  q.forEach(function (fn) { window.requestAnimationFrame(fn); });
  C["anims/finish"]({ play: "1" });
  return { frozen: false, at: t };
};
C["clock/now"] = function () { return { frozen: !!clk, t: clk ? Math.round(clk.t - clk.t0) : null, queued: clk ? clk.q.length : 0 }; };

// fly/log?sel=.mj-flychip — start recording `sel` on every clock step
// (clears the old log); fly/log with no sel returns the log so far
C["fly/log"] = function (a) {
  if (a.sel) { flySel = a.sel; flyLog = []; if (clk) flySample(); return { recording: flySel }; }
  if (a.stop === "1") flySel = null;
  return { recording: flySel, steps: flyLog.length, log: flyLog };
};

// trap?sel=.mj-flychip&when=<js>&do=<js>&hold=1&freeze=1 — the instant a
// node matching `sel` joins the page (and `when`, if given, is true),
// freeze the stepped clock, hold the bots (hold=1, default on) and
// optionally the tab's messages (freeze=1). `do` starts the action that
// causes it. Synchronous on the insertion, so frame 0 is caught; rAF
// callbacks already queued move onto the stepped clock. `animsel`
// narrows which animations follow the clock (default all).
C.trap = function (a) {
  if (!a.sel) throw new Error("trap needs ?sel=");
  var AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
  var when = a.when ? new Function("return (" + a.when + "\n)") : null;
  return new Promise(function (resolve) {
    var to = null, mo = new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        for (var j = 0; j < recs[i].addedNodes.length; j++) {
          var n = recs[i].addedNodes[j];
          if (n.nodeType !== 1 || !(n.matches(a.sel) || n.querySelector(a.sel))) continue;
          var ok = true;
          if (when) { try { ok = !!when(); } catch (e) { ok = false; } }
          if (!ok) continue;
          mo.disconnect(); clearTimeout(to);
          clockFreeze(a);
          if (a.hold !== "0") { try { C.pace({ hold: "1" }); } catch (e) {} }
          if (a.freeze === "1") { try { C.freeze(); } catch (e) {} }
          if (flySel) { flyLog = []; flySample(); }
          resolve({ hit: true, node: safe(n), matches: document.querySelectorAll(a.sel).length });
          return;
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    to = setTimeout(function () { mo.disconnect(); resolve({ hit: false }); }, Math.min(Number(a.timeout) || 30000, 590000) - 500);
    if (a.do) {
      var act;
      try { act = new AsyncFn("return (" + a.do + "\n)"); } catch (e) { act = new AsyncFn(a.do); }
      act().catch(function () {});
    }
  });
};
