/* Dev driver, page half — animations: catch, seek, sample and finish the
   page's Web/CSS Animations (anims/*). */

/* ── animation stepping (document.getAnimations) ─────────────── */
var caught = [], catcher = null, catchSel = null;
function describe(an) {
  var tg = an.effect && an.effect.target, timing = an.effect ? an.effect.getComputedTiming() : {};
  return {
    name: an.animationName || an.transitionProperty || an.id || an.constructor.name,
    // detached: a re-render replaced the node, so this animation will never be seen
    target: tg ? safe(tg) : null, detached: tg ? !tg.isConnected : null, playState: an.playState,
    currentTime: an.currentTime, duration: timing.duration, endTime: timing.endTime
  };
}
function grab() {
  document.getAnimations().forEach(function (an) {
    var tg = an.effect && an.effect.target;
    if (!tg || caught.indexOf(an) >= 0 || clkDone.has(an)) return;
    var el = tg.nodeType === 1 ? tg : tg.parentElement;
    if (el && (el.matches(catchSel) || el.closest(catchSel))) {
      an.pause(); caught.push(an);
      // under the stepped clock, an animation's local time follows the clock from here
      if (clk) clkAnim.set(an, { at: clk.t, base: an.currentTime || 0 });
    }
  });
}
// anims/catch?sel=.mj-tile — pause matching animations the moment they start
C["anims/catch"] = function (a) {
  if (!a.sel) throw new Error("anims/catch needs ?sel=");
  if (catcher) catcher.disconnect();
  caught = []; catchSel = a.sel;
  catcher = new MutationObserver(grab);
  catcher.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  grab();
  return { watching: catchSel, caught: caught.map(describe) };
};
// anims/until?sel=.mj-bento&until=<js>&do=<js>&freeze=1 — catch a moment
// that a bot (or `do`) brings about: arm the catch, start `do` (not
// awaited, so it can loop — clicking Roll until it lands, say), poll
// `until` in the page every 10 ms, and the instant it's true freeze the
// view (if asked) and seek everything caught to 0. The server's `wait`
// polls every 400 ms, far too late to catch a 1 s transition.
C["anims/until"] = async function (a) {
  if (!a.until) throw new Error("anims/until needs ?until=<js>");
  C["anims/catch"]({ sel: a.sel || "body" });
  var AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
  var cond = new AsyncFn("return (" + a.until + "\n)");
  var doErr = null;
  if (a.do) {
    var act;
    try { act = new AsyncFn("return (" + a.do + "\n)"); } catch (e) { act = new AsyncFn(a.do); }
    act().catch(function (e) { doErr = String(e && e.message || e); });
  }
  var end = Date.now() + Math.min(Number(a.timeout) || 30000, 590000) - 500, hit = false;
  while (Date.now() < end) {
    try { hit = !!(await cond()); } catch (e) { hit = false; }
    if (hit) break;
    await sleep(10);
  }
  var frozen = false;
  if (hit && (a.freeze === "1" || a.freeze === true)) { C.freeze(); frozen = true; }
  seekAll(0);
  return { hit: hit, frozen: frozen, caught: caught.length, doError: doErr };
};
C["anims/list"] = function () {
  if (catcher) grab();
  return { watching: catchSel, caught: caught.map(describe) };
};
// a painted frame after a seek, so a screenshot right after shows it (two
// rAFs; a background tab may never fire them, hence the fallback)
function painted() {
  return new Promise(function (resolve) {
    var done = false, fin = function (v) { if (!done) { done = true; resolve(v); } };
    requestAnimationFrame(function () { requestAnimationFrame(function () { fin(true); }); });
    setTimeout(function () { fin(false); }, 250);
  });
}
function seekAll(ms) {
  if (catcher) grab();
  caught.forEach(function (an) { an.currentTime = ms; });
}
// anims/seek?ms=120 — every caught animation to that local time, still
// paused; returns once a frame has painted (`painted: false` = the tab is
// in the background and a screenshot may lag). `list=1` for every animation.
C["anims/seek"] = async function (a) {
  seekAll(Number(a.ms) || 0);
  var p = await painted();
  return a.list === "1" ? { painted: p, caught: caught.map(describe) } : { ms: Number(a.ms) || 0, caught: caught.length, painted: p };
};
// anims/sample?at=0,250,500&sel=.mj-tile * — seek through each time and
// read what a viewer would see, from computed style (reliable where a
// background tab's screenshot isn't): of the `sel` matches, how many are
// still hidden (opacity < 0.05) or moving (translate/scale not at rest),
// and every scroll box (inside `box`, default the whole page) that
// overflows at that moment — a scrollbar flashing. `each=1` lists the
// matches' own values (first 40).
C["anims/sample"] = async function (a) {
  var times = String(a.at || "0").split(",").map(Number);
  var sel = a.sel || "*", boxSel = a.box || "body";
  var out = [];
  for (var i = 0; i < times.length; i++) {
    seekAll(times[i]);
    await painted();
    var els = [].slice.call(document.querySelectorAll(sel));
    var row = { ms: times[i], matched: els.length, hidden: 0, moving: 0, overflow: [] };
    var each = [];
    els.forEach(function (e) {
      var cs = getComputedStyle(e), op = +cs.opacity;
      var mv = (cs.translate && cs.translate !== "none" && !/^0px( 0px)?$/.test(cs.translate)) || (cs.scale && cs.scale !== "none" && cs.scale !== "1");
      if (op < 0.05) row.hidden++;
      if (mv) row.moving++;
      if (a.each === "1" && each.length < 40) each.push({ el: safe(e), opacity: +op.toFixed(3), translate: cs.translate, scale: cs.scale });
    });
    document.querySelectorAll(boxSel + " *").forEach(function (e) {
      var cs = getComputedStyle(e);
      if (/auto|scroll/.test(cs.overflowX + cs.overflowY) && (e.scrollHeight > e.clientHeight + 0.5 || e.scrollWidth > e.clientWidth + 0.5)) {
        row.overflow.push(safe(e));
      }
    });
    if (a.each === "1") row.each = each;
    out.push(row);
  }
  return { caught: caught.length, samples: out };
};
// anims/finish — jump caught animations to their end and stop watching
// (anims/finish?play=1 lets them run on from where they are instead)
C["anims/finish"] = function (a) {
  if (catcher) { grab(); catcher.disconnect(); catcher = null; }
  var out = caught.map(function (an) {
    try { if (a.play === "1") an.play(); else an.finish(); } catch (e) {}
    return describe(an);
  });
  caught = []; catchSel = null;
  return { released: out };
};
