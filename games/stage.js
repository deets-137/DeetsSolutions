/* DeetsStage — a game table's phase change, SHARED (docs/games.md,
   "The stage"). Promoted out of mahjong.js on 2026-10-28, when cities
   became the second game to want it.

   A game whose phases all fill one stage (one footprint, his call
   2026-10-25: switching screens shouldn't jitter) moves only the dividers
   between its panels when the phase changes. Two halves:

   SEAMS. Just before the render, each panel is cloned (a ghost); after it,
   the ghosts of the panels that moved sit over the new layout at their old
   rects (one still in place just updates). Their contents fade out first,
   then the ghosts themselves: a divider opening across one old panel
   dissolves out of its surface, while the new contents come up through it.
   A new panel that spans an old divider starts with that divider cut out
   of it (an SVG mask of the old rects) and fills in. The panels' shadows
   move on a layer under them, old crossfading to new with plus-lighter, so
   an edge both layouts share never dims. Tokens: --seam-shift, --seam-ease.

   WAVES. The pieces inside the panels arrive in nested waves. Siblings
   step apart, each level deeper at NEST of its parent's step, so an inner
   wave runs quicker than the one it rides in. The whole tree is then
   fitted to the skin's --wave-span, first piece to last, however many
   pieces there are. Each piece rises by the skin's --boot-rise over
   --boot-dur / --boot-ease, the look change's own arrival, on `translate`
   / `scale` (which stack with a piece's own `transform`), to an implicit
   end keyframe so a dimmed piece lands on its own opacity. A scroll box
   with nothing to scroll is held at overflow: hidden for the wave (a
   rising piece would flash a scrollbar); in one that already scrolls its
   pieces only fade. Renders rebuild the panels while a wave runs (bots act
   at once), so apply() runs after every paint and anchors each piece to
   the wave's start: a piece rebuilt midway joins where its wave has got to.

   The game owns WHAT arrives in what order (opts.tree), and when a wave
   starts (wave(kind)); this file owns how. The lobby is shell-rendered, so
   its order lives here too (shellKids). Nothing here restyles a game's
   nodes: the ghost, shade and cut classes are gt- (styles/table.css).

   opts: root (where the skin tokens are read), bento (the panels' grid),
   panel (the panels' class), strip (attributes a ghost must not carry, so
   a query for a live panel never finds one), tree(kind) → [{ el, at }]
   (build it with walk), beforeApply() (optional). */
(function () {
  "use strict";
  var NEST = 0.6;
  // the shell's lobby (games/table.js) and seating board (games/seating.js),
  // in the order their rows arrive
  var SHELL_ALL = ["gt-lobby", "gt-lobby__seats", "gt-seat", "gt-seating", "gt-seating__grid"];
  function shellKids(n) {
    var c = n.classList;
    if (c.contains("gt-set")) return [].slice.call(n.querySelectorAll(".gt-set__opts > *"));
    if (c.contains("gt-seating__pad")) return [].slice.call(n.querySelectorAll(".gt-seating__dice > *"));
    for (var i = 0; i < SHELL_ALL.length; i++) if (c.contains(SHELL_ALL[i])) return [].slice.call(n.children);
    return null;   // not a shell node: the game says
  }

  function create(opts) {
    var ROOT = opts.root, BENTO = opts.bento, PANEL = opts.panel;
    var STRIP = opts.strip || /^(id$|aria-)/;
    var seamRun = null, wave = null;

    function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }
    function token(name) { return getComputedStyle(ROOT).getPropertyValue(name).trim(); }
    function ms(name) {
      var v = token(name);
      return (parseFloat(v) || 0) * (/ms$/.test(v) ? 1 : 1000);
    }
    function motionOk() {
      try { if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false; } catch (e) {}
      return !!BENTO.animate;
    }
    function seamReady() {
      // --seam-a must interpolate (@property in table.css); unregistered it would snap
      return motionOk() && !!(window.CSS && CSS.registerProperty);
    }
    function panels() {
      return [].slice.call(BENTO.querySelectorAll(":scope > ." + PANEL + ":not(.gt-seam-ghost)"));
    }
    function live(sel) {   // the live panels' pieces, never a seam ghost's
      return [].slice.call(BENTO.querySelectorAll(":scope > ." + PANEL + ":not(.gt-seam-ghost) " + sel));
    }

    /* ── seams ─────────────────────────────────────────────────── */
    // the panels as they stand, each with its ghost, when this render changes phase
    function before(changed) {
      if (!changed) return null;
      stopSeams();
      if (!seamReady()) return null;
      var snap = panelRects();
      if (snap) snap.tiles.forEach(function (t) { t.ghost = ghostOf(t.el); });
      return snap;
    }
    function ghostOf(tile) {
      var g = tile.cloneNode(true);
      [].slice.call(g.attributes).forEach(function (a) {
        if (STRIP.test(a.name)) g.removeAttribute(a.name);
      });
      g.classList.add("gt-seam-ghost");
      g.setAttribute("aria-hidden", "true");
      g.inert = true;
      g.style.display = getComputedStyle(tile).display;   // the new phase may hide its kind
      g.style.gridArea = "auto";   // placed in the bento's box, not its kind's (moved) grid area
      // inline, so a game's own `position` on its panel kinds can't outrank it
      g.style.position = "absolute"; g.style.margin = "0";
      // a clone starts unscrolled: note every scrolled box (the log runs to
      // its newest line) by document order, which the clone shares
      g.seamScrolls = [];
      [tile].concat([].slice.call(tile.querySelectorAll("*"))).forEach(function (n, i) {
        if (n.scrollTop || n.scrollLeft) g.seamScrolls.push([i, n.scrollTop, n.scrollLeft]);
      });
      return g;
    }
    function panelRects() {
      var box = BENTO.getBoundingClientRect();
      if (!box.width) return null;
      var tiles = [];
      panels().forEach(function (t) {
        var r = t.getBoundingClientRect();
        if (r.width && r.height) tiles.push({ el: t, x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height });
      });
      return { w: box.width, h: box.height, tiles: tiles };
    }
    function covers(a, b) {   // rect a holds rect b (half-pixel slack)
      return a.x <= b.x + 0.5 && a.y <= b.y + 0.5 && a.x + a.w >= b.x + b.w - 0.5 && a.y + a.h >= b.y + b.h - 0.5;
    }
    // a luminance mask: `show` rects white, then `cut` rects black over them,
    // each inset by `inset` (its corner radius shrinking with it)
    function seamMask(w, h, dx, dy, show, cut, inset, r) {
      function rects(list, fill) {
        return list.map(function (t) {
          return '<rect x="' + (t.x - dx + inset) + '" y="' + (t.y - dy + inset) +
            '" width="' + Math.max(0, t.w - 2 * inset) + '" height="' + Math.max(0, t.h - 2 * inset) +
            '" rx="' + Math.max(0, r - inset) + '" fill="' + fill + '"/>';
        }).join("");
      }
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
        '<mask id="m">' + rects(show, "#fff") + rects(cut, "#000") + '</mask>' +
        '<rect width="100%" height="100%" fill="#fff" mask="url(#m)"/></svg>';
      return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
    }
    function stopSeams() {
      if (!seamRun) return;
      var run = seamRun;
      seamRun = null;
      run.anims.forEach(function (a) { a.cancel(); });
      run.nodes.forEach(function (n) { n.remove(); });
      run.cuts.forEach(function (t) { t.classList.remove("gt-seam-cut"); t.style.removeProperty("--seam-cut"); });
      run.panels.forEach(function (t) { t.classList.remove("gt-seam-panel"); });
      BENTO.classList.remove("gt-seaming");
    }
    function shadeSet(list) {
      var set = el("div", "gt-seam-shade__set");
      list.forEach(function (t) {
        var b = el("div");
        b.style.cssText = "left:" + t.x + "px;top:" + t.y + "px;width:" + t.w + "px;height:" + t.h + "px";
        set.appendChild(b);
      });
      return set;
    }
    function shift(snap) {
      if (!snap) return;
      var after = panelRects();
      var dur = ms("--seam-shift");
      if (!after || !after.tiles.length || !dur) return;
      // only where a divider moves: a panel still at its own rect keeps
      // updating in place, as on any render (a phase that moves nothing)
      var moved = snap.tiles.filter(function (o) {
        return !after.tiles.some(function (n) { return n.el === o.el && covers(n, o) && covers(o, n); });
      });
      var cut = after.tiles.filter(function (n) {
        return !snap.tiles.some(function (o) { return covers(o, n); });
      });
      if (!moved.length && !cut.length) return;
      var r = parseFloat(getComputedStyle(after.tiles[0].el).borderTopLeftRadius) || 0;
      // the panels (live and ghost) drop their own shadows for the shade's
      var run = { anims: [], nodes: [], cuts: [], panels: after.tiles.map(function (t) { return t.el; }) };
      seamRun = run;
      run.panels.forEach(function (t) { t.classList.add("gt-seam-panel"); });
      BENTO.classList.add("gt-seaming");
      // the dividers and the new contents move together, after the old
      // contents have mostly gone
      var body = { duration: dur * 0.8, delay: dur * 0.2, easing: token("--seam-ease") || "ease-in-out", fill: "both" };
      var out = { duration: dur * 0.4, easing: token("--pop-ease") || "ease-out", fill: "forwards" };
      var shade = el("div", "gt-seam-shade");
      shade.setAttribute("aria-hidden", "true");
      var was = shadeSet(snap.tiles), now = shadeSet(after.tiles);
      shade.appendChild(was); shade.appendChild(now);
      BENTO.insertBefore(shade, BENTO.firstChild);
      run.nodes.push(shade);
      run.anims.push(was.animate([{ opacity: 1 }, { opacity: 0 }], body));
      run.anims.push(now.animate([{ opacity: 0 }, { opacity: 1 }], body));
      moved.forEach(function (t) {
        var g = t.ghost;
        g.classList.add("gt-seam-panel");
        g.style.left = t.x + "px"; g.style.top = t.y + "px";
        g.style.width = t.w + "px"; g.style.height = t.h + "px";
        BENTO.appendChild(g);
        var boxes = [g].concat([].slice.call(g.querySelectorAll("*")));
        g.seamScrolls.forEach(function (s) { boxes[s[0]].scrollTop = s[1]; boxes[s[0]].scrollLeft = s[2]; });
        run.nodes.push(g);
        // the clone restarts its contents' CSS animations: land each on its
        // end state, as the original shows it (a looping one just stops)
        g.getAnimations({ subtree: true }).forEach(function (a) {
          try { a.finish(); } catch (e) { a.cancel(); }
        });
        // one keyframe: each child fades from its own opacity (an away strip's 0.5)
        [].forEach.call(g.children, function (c) { run.anims.push(c.animate([{ opacity: 0 }], out)); });
        run.anims.push(g.animate([{ opacity: 1 }, { opacity: 0 }], body));
      });
      // a new panel not inside one old panel shows only where old panels were
      cut.forEach(function (n) {
        n.el.style.setProperty("--seam-cut", seamMask(n.w, n.h, n.x, n.y, snap.tiles, [], 0, r));
        n.el.classList.add("gt-seam-cut");
        run.cuts.push(n.el);
        run.anims.push(n.el.animate([{ "--seam-a": 0 }, { "--seam-a": 1 }], body));
      });
      Promise.all(run.anims.map(function (a) { return a.finished; }))
        .then(function () { if (seamRun === run) stopSeams(); }, function () {});
    }

    /* ── waves ─────────────────────────────────────────────────── */
    function waveStart(kind) {
      if (!kind || !motionOk()) return;
      stopWave();
      var rise = token("--boot-rise");
      var ty = /translateY\(([^)]+)\)/.exec(rise), sc = /scale\(([^)]+)\)/.exec(rise);
      wave = {
        kind: kind,
        t0: document.timeline.currentTime,
        // a phase change waits until the dividers are half dissolved
        lead: kind === "phase" && seamRun ? ms("--seam-shift") * 0.5 : 0,
        span: ms("--wave-span"),
        dur: ms("--boot-dur"),
        ease: token("--boot-ease") || "ease-out",
        from: { offset: 0, opacity: 0, translate: "0 " + (ty ? ty[1] : "0px"), scale: sc ? sc[1] : "1" },
        fade: { offset: 0, opacity: 0 },
        scale: 0,
        done: new WeakSet(),
        locks: []   // [box, its inline overflow before the wave]
      };
      var w = wave;
      w.end = setTimeout(function () { if (wave === w) stopWave(); }, w.lead + w.span + w.dur + 100);
    }
    function stopWave() {
      if (!wave) return;
      clearTimeout(wave.end);
      wave.locks.forEach(function (l) { l[0].style.overflow = l[1]; });
      wave = null;
    }
    // how a piece may arrive: rising, unless its scroll box already scrolls
    function waveRise(n, boxes) {
      for (var p = n.parentElement; p && p !== BENTO; p = p.parentElement) {
        var seen = boxes.get(p);
        if (seen === undefined) {
          var o = getComputedStyle(p);
          seen = /auto|scroll/.test(o.overflowX + o.overflowY)
            ? (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1 ? "scrolls" : "still")
            : "none";
          if (seen === "still") { wave.locks.push([p, p.style.overflow]); p.style.overflow = "hidden"; }
          boxes.set(p, seen);
        }
        if (seen === "scrolls") return false;
      }
      return true;
    }
    /* every piece with its raw offset into `out`: siblings step apart, a
       lone piece passes its parent's step down unchanged. An entry of
       `list` may be an array, a group that arrives as one (a hex's art,
       outline and token). kids(n) gives a piece's own pieces; skip(n), when
       true, walks a piece's pieces without moving the piece itself. */
    function walk(list, start, step, kids, out, skip) {
      var many = list.length > 1;
      list.forEach(function (n, i) {
        var at = start + (many ? i * step : 0);
        var group = Array.isArray(n) ? n : [n];
        group.forEach(function (m) {
          if (!(skip && skip(m))) out.push({ el: m, at: at });
          walk(kids(m), at, many ? step * NEST : step, kids, out, skip);
        });
      });
      return out;
    }
    function apply() {
      if (!wave) return;
      if (opts.beforeApply) opts.beforeApply();
      var pieces = opts.tree(wave.kind);
      var boxes = new Map();
      if (!wave.scale) {   // fixed on the first pass, so a rebuilt piece keeps its slot
        var last = pieces.reduce(function (m, p) { return Math.max(m, p.at); }, 0);
        wave.scale = last > 0 ? wave.span / last : 0;
      }
      pieces.forEach(function (p) {
        if (wave.done.has(p.el)) return;
        wave.done.add(p.el);
        var a = p.el.animate([waveRise(p.el, boxes) ? wave.from : wave.fade], {
          duration: wave.dur, delay: wave.lead + p.at * wave.scale, easing: wave.ease, fill: "backwards"
        });
        a.startTime = wave.t0;
      });
    }

    return {
      NEST: NEST,
      token: token, ms: ms, motionOk: motionOk, live: live,
      before: before, shift: shift,
      wave: waveStart, apply: apply, walk: walk, shellKids: shellKids,
      seaming: function () { return !!seamRun; },
      waving: function () { return !!wave; },
      waveKind: function () { return wave ? wave.kind : null; },
      stop: function () { stopSeams(); stopWave(); }
    };
  }
  window.DeetsStage = { create: create };
})();
