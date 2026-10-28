/* DeetsSeating — the seating roll's board, SHARED (docs/games.md, "The
   seating roll"). Promoted out of mahjong.js on 2026-10-28, when cities
   took the same roll for its turn order.

   Each seat rolls two dice on its own pad; the engine ranks them and only
   tied seats re-roll (each engine owns its rule: `seating: { rolls,
   reroll }`, the `rollSeat` verb, the `seatRoll` / `seatReroll` / `seated`
   events). This file is the page half every such game shares:

   - render(): the board — a title, a note, one pad per seat (its dot, its
     name, two dice and the sum), my Roll on my own pad right of my dice.
     The Roll stays once I've rolled, disabled, so the pad never changes
     shape. A fresh roll tumbles on its pad for ROLL_MS, then settles.
   - spin(seat): a seatRoll arrived; that pad tumbles.
   - stage(msg, m, clearFields): the roll that settles the seating (the last
     one in, or the one that ties) arrives in the same broadcast as its
     outcome. Staged in two: first the table still seating with that roll
     on it (it tumbles, then rests), then, ROLL_MS + PAUSE_MS later, the real
     broadcast minus the roll already shown. The shell queues anything newer
     behind it (games/table.js, "Staging"), so a bot's first move waits too.
   - morphBefore() / morphRun(pads, target, ms, ease): once the seating
     settles, each pad's clone flies and resizes into the box that seat
     takes in play (the game names it: target(seat) → element) while its
     dice fade, and the box shows under it as it lands.

   The game supplies what is its own: the die's art, the Roll pill, the
   seats' names, dots and accent, and the strings. Classes are gt- and live
   in styles/table.css; a game styles only its own nodes inside them (its
   dice). The lobby-order wave reads these pads through stage.js's
   shellKids. */
(function () {
  "use strict";
  var ROLL_MS = 500, PAUSE_MS = 1000;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function reduceMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }

  /* opts: root (the element the board renders into — the pads are found
     there), bento (the panels' grid, for the morph), S { title, note,
     reroll } (strings; reroll takes {names}), fmt(str, vars),
     seating() → { rolls, reroll } | null, seats() → the model's seats,
     mySeat(), seatName(i), seatDot(i) → node, accent(node, i),
     die(v | null) → node (the game's small die; null for an unrolled one),
     rollPill(enabled, onClick) → node, roll() (sends rollSeat). */
  function create(opts) {
    var padSpin = {};   // seat → when its pad's tumble ends

    function spin(seat) { if (!reduceMotion()) padSpin[seat] = Date.now() + ROLL_MS; }
    function owed(st, i) {
      var scope = st.reroll;
      return (!scope || scope.indexOf(i) >= 0) && !st.rolls[i];
    }

    function render() {
      var wrap = el("div", "gt-seating");
      wrap.appendChild(el("h2", "gt-seating__title", opts.S.title));
      wrap.appendChild(el("p", "gt-seating__note", opts.S.note));
      var grid = el("div", "gt-seating__grid");
      var st = opts.seating() || { rolls: [] };
      var me = opts.mySeat();
      (opts.seats() || []).forEach(function (s, i) {
        if (!s || s.empty) return;
        var pad = el("div", "gt-seating__pad" + (owed(st, i) ? " is-waiting" : ""));
        pad.setAttribute("data-seat", i);   // the morph finds its target by it
        opts.accent(pad, i);
        var head = el("div", "gt-seating__head");
        head.appendChild(opts.seatDot(i));
        head.appendChild(el("span", "gt-seating__name", opts.seatName(i) + (i === me ? " ·" : "")));
        pad.appendChild(head);
        var diceRow = el("div", "gt-seating__dice");
        var r = st.rolls[i];
        if (r) {
          // a fresh roll tumbles here as on the dice tile, then settles; the
          // sum keeps its place, unseen, until the dice stop
          var left = (padSpin[i] || 0) - Date.now();
          if (left > 0) { diceRow.classList.add("is-spinning"); diceRow.dataset.until = padSpin[i]; }
          else if (left > -340) diceRow.classList.add("is-settled");
          r.forEach(function (v) {
            var d = opts.die(left > 0 ? 1 + Math.floor(Math.random() * 6) : v);
            d.dataset.v = v;
            // rebuilt mid-settle (the next seat's roll): pick the bounce up
            // where it was rather than start it over
            if (left <= 0) d.style.animationDelay = left + "ms";
            diceRow.appendChild(d);
          });
          diceRow.appendChild(el("span", "gt-seating__sum", String(r[0] + r[1])));
        } else {
          diceRow.appendChild(opts.die(null));
          diceRow.appendChild(opts.die(null));
        }
        // my Roll rides my own pad, right of the dice
        if (i === me) {
          var must = owed(st, i);
          var p = opts.rollPill(must, function () { opts.roll(); });
          p.classList.add("gt-seating__roll");
          diceRow.appendChild(p);
        }
        pad.appendChild(diceRow);
        grid.appendChild(pad);
      });
      wrap.appendChild(grid);
      if (st.reroll) wrap.appendChild(el("p", "gt-seating__note", opts.fmt(opts.S.reroll, { names: st.reroll.map(opts.seatName).join(", ") })));
      tumble();
      return wrap;
    }

    /* the pads' tumble: one ticker for every spinning pad, reading the DOM
       each tick (a broadcast may have rebuilt the pads mid-roll): random
       faces every 70 ms, then the real ones, the settle, and the sum */
    var tick = null;
    function tumble() {
      if (tick) return;
      tick = setInterval(function () {
        var rows = opts.root.querySelectorAll(".gt-seating__dice.is-spinning");
        if (!rows.length) { clearInterval(tick); tick = null; return; }
        var now = Date.now();
        [].forEach.call(rows, function (row) {
          var done = now >= +row.dataset.until;
          [].forEach.call(row.querySelectorAll("[data-v]"), function (d) {
            var v = +d.dataset.v;
            var n = opts.die(done ? v : 1 + Math.floor(Math.random() * 6));
            n.dataset.v = v;
            d.parentNode.replaceChild(n, d);
          });
          if (done) { row.classList.remove("is-spinning"); row.classList.add("is-settled"); }
        });
      }, 70);
    }

    /* the settling roll, staged (see the header) */
    function stage(msg, m, clearFields) {
      if (msg.type !== "state" || !m || m.phase !== "seating" || !m.seating) return null;
      var ev = msg.ev || [];
      var rolls = ev.filter(function (e) { return e.t === "seatRoll"; });
      var settles = ev.some(function (e) { return e.t === "seated" || e.t === "seatReroll"; });
      if (!rolls.length || !settles) return null;
      var now = { type: "state", ev: rolls };
      // a staged state keeps every field the table had (the timer's deadline
      // included), so only the dice change on screen
      clearFields.forEach(function (f) { if (f in m) now[f] = m[f]; });
      if (m.you) now.you = m.you;   // the shell's merge reads msg.you whenever the model has one
      var shown = m.seating.rolls.slice();
      rolls.forEach(function (e) { shown[e.seat] = e.d; });
      now.phase = "seating";
      now.seating = { rolls: shown, reroll: m.seating.reroll || null };
      var later = {};
      for (var k in msg) later[k] = msg[k];
      later.ev = ev.filter(function (e) { return e.t !== "seatRoll"; });
      return { now: now, ms: (reduceMotion() ? 0 : ROLL_MS) + PAUSE_MS, later: [later] };
    }

    /* the pads become the boxes the seats take in play: captured before
       the render that leaves seating, flown after it */
    function morphBefore() {
      var box = opts.bento.getBoundingClientRect(), pads = [];
      opts.root.querySelectorAll(".gt-seating__pad[data-seat]").forEach(function (p) {
        var r = p.getBoundingClientRect();
        pads.push({ seat: +p.getAttribute("data-seat"), el: p.cloneNode(true), x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height });
      });
      return pads.length ? pads : null;
    }
    function morphRun(pads, target, ms, ease) {
      if (!pads) return;
      // the seating board's own fading ghost must not show a second set of pads
      opts.bento.querySelectorAll(".gt-seam-ghost .gt-seating__pad").forEach(function (p) { p.style.visibility = "hidden"; });
      var box = opts.bento.getBoundingClientRect();
      pads.forEach(function (p) {
        var zone = target(p.seat);
        if (!zone) return;
        var z = zone.getBoundingClientRect();
        var g = p.el;
        g.classList.add("gt-morph");
        g.removeAttribute("data-seat");
        g.setAttribute("aria-hidden", "true");
        g.inert = true;
        g.style.cssText += ";position:absolute;margin:0;box-sizing:border-box;left:" + p.x + "px;top:" + p.y +
          "px;width:" + p.w + "px;height:" + p.h + "px";
        opts.bento.appendChild(g);
        var to = { left: (z.left - box.left) + "px", top: (z.top - box.top) + "px", width: z.width + "px", height: z.height + "px" };
        var from = { left: p.x + "px", top: p.y + "px", width: p.w + "px", height: p.h + "px" };
        var a = g.animate([from, to], { duration: ms, easing: ease, fill: "forwards" });
        // the dice and the Roll fade at once; the name rides along
        [].forEach.call(g.querySelectorAll(".gt-seating__dice"), function (d) {
          d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.35, fill: "forwards" });
        });
        // the box shows under the clone as it lands, the clone lets go
        zone.animate([{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }], { duration: ms, easing: "linear" });
        g.animate([{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: ms, easing: "linear", fill: "forwards" });
        a.onfinish = function () { g.remove(); };
      });
    }

    return { spin: spin, render: render, stage: stage, morphBefore: morphBefore, morphRun: morphRun };
  }
  window.DeetsSeating = { create: create, ROLL_MS: ROLL_MS, PAUSE_MS: PAUSE_MS };
})();
