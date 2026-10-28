/* DeetsMahjong — page UI (docs/mahjong.md, "Page layout — the bento").

   Gate, lobby, the table (four rotated seat zones around a center well),
   dice / players / log tiles, the rack tile (my hand + action pills), the
   claim window overlay, seating rolls, hand-over settlement, and the
   game-over reveal. Transport-agnostic: talks to window.MahjongTransport
   (the ?mock in-page fake or the real WS client). The rules live in
   engine.js; client affordances here (clickable tiles, glowing pills) are
   COSMETIC — the server re-validates every action.

   Per the site's deliberate-duplication convention this file carries its own
   copy of the toolbar/popover kit (sixth copy: sotd, movies, league, radio,
   cities, mahjong) — a fix to that machinery must be mirrored across all six.

   All flavor copy comes from strings.js; the terse mechanical LOG lines are
   authored here (rendered from typed event records, never sent as prose).
   The TILES use the fixed mahjong palette (a token-discipline carve-out in
   mahjong.css); everything else rides the themes.css / skin.css tokens. */
(function () {
  "use strict";

  var S = window.MAHJONG_STRINGS || {};
  var Engine = window.MahjongEngine;
  var Colors = window.DeetsColors;

  /* ── DOM handles ──────────────────────────────────────────────── */
  var BAR_INPUT = document.querySelector("[data-mj-code]");
  var CODE_POP = document.querySelector("[data-mj-code-pop]");
  var TOOLBAR = document.querySelector("[data-mj-toolbar]");
  var GATE = document.querySelector("[data-mj-gate]");
  var TABLE = document.querySelector("[data-mj-table]");
  var BIG = document.querySelector("[data-mj-big]");
  var DICE = document.querySelector("[data-mj-dice]");
  var PLAYERS = document.querySelector("[data-mj-players]");
  var WALL = document.querySelector("[data-mj-wall]");
  var LOG = document.querySelector("[data-mj-log]");
  var ROLE = document.querySelector("[data-mj-role]");
  var CLAIM = document.querySelector("[data-mj-claim]");
  var GUIDE = document.querySelector("[data-mj-guide]");
  var DESKTOP = document.querySelector("[data-mj-desktop]");

  var DECK_KEY = "deets-mahjong-deck";           // tile art: per VIEWER, never on the wire
  var ARRANGE_KEY = "deets-mahjong-autoarrange"; // "Auto-Arrange" toggle (default on)
  // the seating roll (his timing, 2026-10-26): each seat's dice tumble for
  // ROLL_MS, on its pad and on the dice tile; the roll that settles the
  // seating (the last one, or a tie) then rests SEAT_PAUSE before the game
  // or the re-roll goes on (games/seating.js, shared with cities)
  var ROLL_MS = window.DeetsSeating.ROLL_MS, SEAT_PAUSE = window.DeetsSeating.PAUSE_MS;
  var BREAK_MS = 620;   // the wall-break roll's tumble (three dice, the dice tile)
  var CLEAR_FIELDS = ["claims", "handOver", "turnEndsAt", "seating", "breakRoll", "turn",
                      // a rematch omits the whole game — the lobby must not paint one
                      "order", "round", "needBreak", "wallLeft", "wallBack", "pond", "players", "over"];

  /* ═══ THE TABLE SHELL ══════════════════════════════════════════
     games/table.js owns the socket, the code combobox, the gate, the
     lobby (seats, bots, seat colors), the toolbar, the disconnect-grace
     toasts and the render frame — the same shell DeetsCities wears. This
     file supplies the tiles, the rack and the rules-facing UI. `model` is
     rebound by onModel on every broadcast, so the rest of the file reads
     it exactly as it always did. */
  var model = null;
  var TBL = window.DeetsTable.create({
    ns: "mahjong",
    api: "https://mahjong-api.deets.solutions",
    mock: window.MahjongTransport,       // transport-mock.js, selected by ?mock
    strings: S,
    // the difficulty vocabulary is the ENGINE's; the shell only renders it
    botTiers: window.MahjongEngine.BOT_TIER_LIST,
    rootSel: ".mj",
    capacity: 4,
    minSeats: 4,
    narrowOk: true,   // WIP: no desktop-only note while the narrow layout is designed
    iconToolbar: true,   // Invite / Settings / Leave as icons (games/table.js)
    openButton: true,    // the code's + / sit button stands in for the gate (games/table.js)
    startNeedsHint: S.startNeedsFour,
    errExtra: { loc: S.errLoc },
    /* fields the worker omits when absent must clear, not linger */
    clearFields: CLEAR_FIELDS,
    stageMessage: stageTable,
    clearYouFields: ["claims", "canWin", "kongs", "drawn", "nearWin", "handValue", "hand"],
    els: {
      bar: BAR_INPUT, codePop: CODE_POP, codeCtrl: document.querySelector(".gt-code"),
      toolbar: TOOLBAR, gate: GATE, table: TABLE, big: BIG, log: LOG, desktop: DESKTOP
    },
    onModel: function (m) { model = m; },
    beforeMerge: function (isSnapshot) { if (isSnapshot) { TQ.batch = []; tqFinish(false); } },
    onEvent: handleEvent,
    logLine: function (e) {
      var line = logLine(e);
      if (line && e._hold) line.hold = e._hold;   // shown once its tile lands (tile flights)
      return line;
    },
    postEvents: function () { choreograph(); },   // the batch's steps hold their pieces BEFORE the render
    blockRender: function () { return dragActive; },   // a rack drag owns the DOM until it drops
    render: paint,
    // chips and tile flights launch AFTER render: their targets exist now
    postRender: function () { FLY.flush(); tqPump(); },
    onLeave: onLeave,
    onRematch: resetGameUi,
    extraPills: function () { return [deckPill()]; },
    seatExtra: beginnerToggle,
    lobbySettings: lobbySettings,
    settingsRows: function () {
      var st = model.settings;
      return [
        [S.minFaanLabel, String(st.minFaan)],
        [S.windsLabel, st.winds === 4 ? S.windsFour : (st.winds === 0 ? S.windsHand : S.windsOne)],
        [S.timerLabel, st.timerSec ? fmt(S.timerSecs, { n: st.timerSec }) : S.timerOff]
      ];
    }
  });
  // shell utilities under their old names — the rest of the file is unchanged
  var el = TBL.el, load = TBL.load, save = TBL.save, fmt = TBL.fmt, slugify = TBL.slugify;
  var reduceMotion = TBL.reduceMotion, toast = TBL.toast, seatDot = TBL.seatDot;
  var mySeat = TBL.mySeat, seatName = TBL.seatName, seatedCount = TBL.seatedCount;
  var logLines = TBL.logLines, ui = TBL.ui;
  function send(msg) { TBL.send(msg); }
  function render() { TBL.render(); }
  function leaveTable() { TBL.leave(); }
  function fitLog() { TBL.fitLog(".mj-log__list"); }

  /* ── rack / table state (this game's own) ─────────────────────── */
  ui.deckPinned = false; ui.logPinned = false; ui.kongPick = false; ui.minFaanDraft = null; ui.overExpanded = {};
  ui.autoArrange = load(ARRANGE_KEY, true); ui.handOrder = null;
  ui.guideOpen = false; ui.guideScroll = 0; ui.guideSecOpen = {};
  var spinUntil = 0, spinDice = 2;
  var lastActor = null;
  var tumbleHandle = null;
  var lastDice = null;    // { seat, d:[..] } — the dice tile's latest roll
  var dragActive = false; // a rack tile is being dragged — suppress re-renders mid-drag



  /* ── tile display (the mahjong palette carve-out's labels) ────── */
  var SUIT_GLYPH = { m: "萬", p: "筒", s: "條" };           // 萬 筒 條
  var HONOR_GLYPH = { we: "東", ws: "南", ww: "西", wn: "北",   // 東南西北
                      dr: "中", dg: "發", dw: "白" };               // 中 發 白
  var FLOWER_GLYPH = { f: "花", g: "季" };                      // 花 季
  var WIND_NAME = function () { return [S.windE, S.windS, S.windW, S.windN]; };
  function tileName(t) {
    if (HONOR_GLYPH[t]) {
      return { we: S.windE, ws: S.windS, ww: S.windW, wn: S.windN,
               dr: S.dragonR, dg: S.dragonG, dw: S.dragonW }[t];
    }
    var c = t.charAt(0), n = +t.charAt(1);
    if (c === "f") return fmt(S.flowerName, { n: n });
    if (c === "g") return fmt(S.seasonName, { n: n });
    var suit = { m: S.suitM, p: S.suitP, s: S.suitS }[c];
    return fmt(S.tileNum, { n: n, suit: suit });
  }
  /* sprite swap points (assets/sprites/mahjong/{deck}/): tile-{id}.png
     replaces a face's glyphs; back.png replaces the woven tile back. Two
     deck styles ship (numeral — big number + suit glyph; traditional —
     drawn pips, bamboo sticks, characters); the deck is a PER-VIEWER
     setting (localStorage, never on the wire) — tile art is a legibility
     call, not a table rule, so no host picks it for you and it can flip
     mid-hand. Every file of every deck is probed ONCE at load — a missing
     sprite costs one quiet 404 and that face falls back to the CSS glyph. */
  var SPRITE_ROOT = "../assets/sprites/mahjong/";
  var DECKS = ["numeral", "traditional"];
  var deckPref = (function () {
    var d = load(DECK_KEY, null);
    return DECKS.indexOf(d) >= 0 ? d : "numeral";
  })();
  function curDeck() { return deckPref; }
  function deckName(d) { return d === "traditional" ? S.deckTraditional : S.deckNumeral; }
  function setDeck(d) {
    if (DECKS.indexOf(d) < 0 || d === deckPref) return;
    deckPref = d; save(DECK_KEY, d);
    if (model) render();
  }
  var sprites = {};
  DECKS.forEach(function (d) {
    sprites[d] = {};
    Engine.KINDS.concat(Engine.FLOWERS).map(function (t) { return "tile-" + t; }).concat(["back"]).forEach(function (name) {
      var probe = new Image();
      probe.onload = function () { sprites[d][name] = true; if (model && d === curDeck()) render(); };
      probe.src = SPRITE_ROOT + d + "/" + name + ".png";
    });
  });
  // one tile face. size: "" | "mini". Click behavior is the caller's.
  function tileEl(t, size) {
    var b = el("span", "mj-tilef" + (size ? " mj-tilef--" + size : ""));
    b.setAttribute("data-tile", t);
    b.title = tileName(t);
    if (sprites[curDeck()]["tile-" + t]) {
      var img = document.createElement("img");
      img.className = "mj-tilef__art";
      img.src = SPRITE_ROOT + curDeck() + "/tile-" + t + ".png";
      img.alt = tileName(t);
      b.appendChild(img);
      return b;
    }
    var c = t.charAt(0);
    if (HONOR_GLYPH[t]) {
      var cls = c === "d" ? " mj-ink--" + t : " mj-ink--wind";
      b.appendChild(el("span", "mj-tilef__big" + cls, t === "dw" ? "" : HONOR_GLYPH[t]));
      if (t === "dw") b.classList.add("mj-tilef--frame");   // the white dragon is an empty frame
    } else if (c === "f" || c === "g") {
      b.appendChild(el("span", "mj-tilef__num mj-ink--flower", t.charAt(1)));
      b.appendChild(el("span", "mj-tilef__suit mj-ink--flower", FLOWER_GLYPH[c]));
    } else {
      b.appendChild(el("span", "mj-tilef__num mj-ink--" + c, t.charAt(1)));
      b.appendChild(el("span", "mj-tilef__suit mj-ink--" + c, SUIT_GLYPH[c]));
    }
    return b;
  }
  function backEl(size) {
    var b = el("span", "mj-tilef mj-tilef--back" + (size ? " mj-tilef--" + size : ""));
    if (sprites[curDeck()].back) {
      b.classList.add("is-art");   // sprite carries its own frame — drop the CSS ::after
      var img = document.createElement("img");
      img.className = "mj-tilef__art";
      img.src = SPRITE_ROOT + curDeck() + "/back.png";
      img.alt = "";
      b.appendChild(img);
    }
    return b;
  }





  /* The roll that settles the seating — the last one in, or the one that
     ties the lead — arrives in the same broadcast as its outcome (seated:
     the game begins; seatReroll: the tied rolls clear). Staged in two:
     first the table still seating with that roll on it (it tumbles, then
     rests), then — ROLL_MS + SEAT_PAUSE later — the real broadcast minus
     the roll already shown. The shell queues anything newer behind it
     (games/table.js, "Staging"), so a bot dealer's wall break waits too.
     The opening's later beats hold the table the same way, for as long as
     they play (see "The opening" below): the seats taking their places and
     the wall going up (seated, nextHand), and the deal (breakRoll). */
  function stageTable(msg, m) {
    if (msg.type !== "state" || !m) return null;
    var ev = msg.ev || [];
    var has = function (t) { return ev.some(function (e) { return e.t === t; }); };
    var staged = SEATING.stage(msg, m, CLEAR_FIELDS);
    if (staged || !motionOk()) return staged;
    if (has("seated")) return { now: msg, ms: tokenMs("--morph") + 2 * tokenMs("--build-layer"), later: [] };
    if (has("nextHand")) return { now: msg, ms: 2 * tokenMs("--build-layer"), later: [] };
    if (has("breakRoll") && has("deal")) return { now: msg, ms: BREAK_MS + dealMs(), later: [] };
    return null;
  }

  /* ═══ THE OPENING (his design, 2026-10-26) ═════════════════════
     After the seating roll's pause, each seat's pad morphs into its seat
     box on the board. Then the wall goes up the way it's built at a real
     table, all four sides at once, each from its player's right hand (a
     pinwheel), one layer and then the second, each layer one
     --build-layer. Only then does the break's Roll appear, in the middle
     of the felt, for the dealer. The roll tumbles on the dice tile, and
     the deal comes off the wall from the break: 4 tiles to each seat from
     the dealer round the table, again, again, then 1 each. The dealer's
     14th is the hand's first draw (a tile flight, like any draw), and
     flowers are replaced after it, as tile flights too.
     A new hand builds its wall and deals the same way; only the morph
     belongs to the first. Every beat is pinned to the document timeline,
     so a render in the middle of one picks it up where it stands. The
     server has moved on meanwhile: stageTable holds the broadcasts behind
     each beat, so a bot dealer's break and first discard wait their turn. */
  var OPEN = null;   // { t0, morph, buildT0, buildEnd, done:WeakSet, morphSeen }
  var DEAL = null;   // { t0, end, steps:[{ seat, n, before, launch }], done }
  function tl() { return document.timeline ? document.timeline.currentTime : performance.now(); }
  function startOpening(morph) {
    if (!motionOk()) { OPEN = null; return; }
    var t0 = tl(), m = morph ? tokenMs("--morph") : 0, layer = tokenMs("--build-layer");
    OPEN = { t0: t0, morph: morph, morphMs: m, buildT0: t0 + m, layer: layer, buildEnd: t0 + m + 2 * layer, done: new WeakSet() };
    // the break's Roll appears once the wall stands
    var o = OPEN;
    setTimeout(function () { if (OPEN === o && model) TBL.render(); }, m + 2 * layer + 20);
  }
  function building() { return !!OPEN && tl() < OPEN.buildEnd; }
  function morphing() { return !!OPEN && OPEN.morph && tl() < OPEN.buildEnd; }
  function dealMs() {
    return 15 * tokenMs("--deal-step") + 3 * tokenMs("--deal-gap") + tokenMs("--deal-fly");
  }
  // the deal is ON only while its time runs — never on a flag alone, so a
  // late or lost timer can't leave it hiding hands
  function dealing() { return !!DEAL && tl() < DEAL.end; }
  function stopDeal() { if (DEAL) clearTimeout(DEAL.timer); DEAL = null; }
  function startDeal() {
    stopDeal();
    if (!motionOk() || !model.order || !model.round) return;
    var step = tokenMs("--deal-step"), t0 = tl() + BREAK_MS;
    var seats = [0, 1, 2, 3].map(function (w) { return model.order[(model.round.dealerIdx + w) % 4]; });
    var steps = [], had = {}, i = 0;
    [4, 4, 4, 1].forEach(function (n) {
      seats.forEach(function (s) {
        steps.push({ seat: s, n: n, before: had[s] || 0, launch: t0 + i * step });
        had[s] = (had[s] || 0) + n; i++;
      });
    });
    DEAL = { t0: t0, end: t0 + dealMs(), steps: steps, launched: 0 };
    // the hand's own flights (the dealer's 14th, flowers) wait for the deal
    // (tqPump asks dealing()). The deal keeps its OWN timer: it once rode
    // the queue's beat, which tqFinish clears (a hidden tab, a snapshot),
    // and the deal never ended — every slot past 13 stayed hidden, the
    // drawn tile with them
    var d = DEAL;
    d.timer = setTimeout(function () {
      if (DEAL !== d) return;
      DEAL = null; TBL.render(); tqPump();
    }, d.end - tl() + 30);
    steps.forEach(function (s) {
      setTimeout(function () { if (DEAL === d) dealLaunch(s); }, s.launch - tl());
    });
  }
  // tiles off the wall so far, and tiles landed in one seat's hand so far
  function dealTaken() {
    var now = tl(), n = 0;
    DEAL.steps.forEach(function (s) { if (s.launch <= now) n += s.n; });
    return n;
  }
  function dealLanded(seat) {
    var now = tl(), gap = tokenMs("--deal-gap"), fly = tokenMs("--deal-fly"), n = 0;
    DEAL.steps.forEach(function (s) {
      if (s.seat !== seat) return;
      for (var k = 0; k < s.n; k++) if (s.launch + k * gap + fly <= now) n++;
    });
    return n;
  }
  // the slots a seat's dealt tiles land in: my rack, or the backs in my zone
  function dealSlots(seat) {
    var q = seat === mySeat() ? ".mj-rack__tiles > *"
      : '.mj-zone[data-zone="' + seat + '"] .mj-zone__backs > *';
    return [].slice.call(document.querySelectorAll(".mj " + q))
      .filter(function (n) { return !n.closest(".gt-seam-ghost"); });
  }
  // the felt and hands as the deal stands right now (after every render,
  // every launch and every landing)
  function dealPaint() {
    if (!dealing()) return;
    var taken = Math.floor(dealTaken() / 2);
    BIG.querySelectorAll(".mj-tilef--wall[data-fpos]").forEach(function (st) {
      // the deal's 52 tiles are the 26 stacks clockwise from the break
      if (+st.getAttribute("data-fpos") < 26) st.classList.toggle("is-gone", +st.getAttribute("data-fpos") < taken);
    });
    [0, 1, 2, 3].forEach(function (s) {
      var shown = dealLanded(s);
      dealSlots(s).forEach(function (n, i) { n.style.visibility = i < shown ? "" : "hidden"; });
    });
  }
  // one chunk leaves the wall: its tiles fly, one after the next, from the
  // stacks they came off to the slots they fill
  function dealLaunch(s) {
    var gap = tokenMs("--deal-gap"), fly = seamToken("--deal-fly");
    var flyMs = tokenMs("--deal-fly"), ease = fly.replace(/^\S+\s*/, "") || "ease-out";
    var box = BENTO.getBoundingClientRect();
    var before = DEAL.steps.reduce(function (n, x) { return x.launch < s.launch ? n + x.n : n; }, 0);
    var froms = [];
    for (var k = 0; k < s.n; k++) {
      var st = BIG.querySelector('.mj-tilef--wall[data-fpos="' + Math.floor((before + k) / 2) + '"]');
      froms.push(st ? st.getBoundingClientRect() : null);
    }
    dealPaint();   // the stacks leave the wall as the chunk lifts
    var slots = dealSlots(s.seat);
    for (var k2 = 0; k2 < s.n; k2++) {
      var slot = slots[s.before + k2], from = froms[k2];
      if (!slot || !from) continue;
      var to = slot.getBoundingClientRect();
      var c = slot.cloneNode(true);
      c.classList.add("mj-dealfly");
      c.setAttribute("aria-hidden", "true");
      c.style.cssText = "position:absolute;margin:0;visibility:visible;left:" + (to.left - box.left) + "px;top:" +
        (to.top - box.top) + "px;width:" + to.width + "px;height:" + to.height + "px";
      BENTO.appendChild(c);
      var dx = (from.left + from.width / 2) - (to.left + to.width / 2);
      var dy = (from.top + from.height / 2) - (to.top + to.height / 2);
      var sc = Math.max(from.width, from.height) / Math.max(to.width, to.height) || 1;
      var a = c.animate([
        { transform: "translate(" + dx + "px," + dy + "px) scale(" + sc + ")", opacity: 0.6 },
        { transform: "none", opacity: 1 }
      ], { duration: flyMs, delay: k2 * gap, easing: ease, fill: "backwards" });
      (function (node) { a.onfinish = function () { node.remove(); dealPaint(); }; a.oncancel = function () { node.remove(); }; })(c);
    }
  }

  /* The pads become the seat boxes: each pad (its clone) flies and resizes
     into its seat's box on the board while its dice fade, and the box shows
     as the clone lands. Captured before the render that leaves seating. */
  function morphBefore(wasPhase) {
    if (!OPEN || !OPEN.morph || OPEN.morphSeen || wasPhase !== "seating" || model.phase !== "play") return null;
    OPEN.morphSeen = true;
    return SEATING.morphBefore();
  }
  function morphRun(pads) {
    SEATING.morphRun(pads, function (seat) { return BIG.querySelector('.mj-zone[data-zone="' + seat + '"]'); },
      OPEN ? OPEN.morphMs : 0, seamToken("--morph").replace(/^\S+\s*/, "") || "ease-out");
  }

  /* The hand ends: each seat's box glides off the board into its row of
     the hand-over panel (his call, 2026-10-27), the opening's morph run
     the other way. A clone of the box flies and resizes onto the row
     while its tiles fade (the name rides along), and the row shows as the
     clone lands, one row after another. Once per hand-over; a reload onto
     a finished hand just shows the rows. */
  var hoKey = null;
  function handOverBefore() {
    var s = model.handOver;
    if (!s) { hoKey = null; return null; }
    var key = JSON.stringify([s.prevailing, s.hand, s.result, s.seat, s.scores]);
    if (key === hoKey) return null;
    hoKey = key;
    if (!s.hands || !motionOk()) return null;
    var box = BENTO.getBoundingClientRect(), out = [];
    BIG.querySelectorAll(".mj-zone[data-zone]").forEach(function (z) {
      var r = z.getBoundingClientRect();
      if (!r.width) return;
      out.push({ seat: +z.getAttribute("data-zone"), el: z.cloneNode(true), x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height });
    });
    return out.length ? out : null;
  }
  function handOverRun(zones) {
    if (!zones) return;
    var box = BENTO.getBoundingClientRect();
    var ms = tokenMs("--morph") || 600, ease = seamToken("--morph").replace(/^\S+\s*/, "") || "ease-out";
    zones.forEach(function (z) {
      var row = BIG.querySelector('.mj-horow[data-horow="' + z.seat + '"]');
      if (!row) return;
      var r = row.getBoundingClientRect();
      var k = [].indexOf.call(row.parentNode.children, row), delay = k * ms * 0.15;
      var g = z.el;
      // the turn's highlight stays on the board: carried along, one box flew
      // bolder than the rest and landed on whichever row it belonged to
      g.classList.remove("is-active");
      g.classList.add("mj-morph", "mj-hoglide");
      g.removeAttribute("data-zone");
      g.setAttribute("aria-hidden", "true");
      g.inert = true;
      g.style.cssText += ";position:absolute;margin:0;box-sizing:border-box;left:" + z.x + "px;top:" + z.y +
        "px;width:" + z.w + "px;height:" + z.h + "px";
      BENTO.appendChild(g);
      var from = { left: z.x + "px", top: z.y + "px", width: z.w + "px", height: z.h + "px" };
      var to = { left: (r.left - box.left) + "px", top: (r.top - box.top) + "px", width: r.width + "px", height: r.height + "px" };
      var a = g.animate([from, to], { duration: ms, delay: delay, easing: ease, fill: "both" });
      // the board's tiles fade at once; the name rides along
      [].forEach.call(g.children, function (c) {
        if (!c.classList.contains("mj-zone__head")) c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.35, delay: delay, fill: "both" });
      });
      // the row shows under the clone as it lands, the clone lets go
      row.animate([{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }], { duration: ms, delay: delay, easing: "linear", fill: "backwards" });
      g.animate([{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: ms, delay: delay, easing: "linear", fill: "forwards" });
      a.onfinish = function () { g.remove(); };
    });
  }

  /* The wall goes up: every stack lands at the one-tile look (the same
     0.55 a half-eaten stack wears), then fills in as the top tile lands
     on it. Side by side from each player's right hand, all four at once. */
  function buildApply() {
    if (!OPEN || tl() >= OPEN.buildEnd + 50) return;
    var L = OPEN.layer, d = Math.min(tokenMs("--build-stack"), L), T = 2 * L;
    BIG.querySelectorAll(".mj-tilef--wall[data-k]").forEach(function (st) {
      if (OPEN.done.has(st)) return;
      OPEN.done.add(st);
      var j = (+st.getAttribute("data-k")) % 18;
      var s1 = j / 17 * (L - d), s2 = L + s1;
      var a = st.animate([
        { offset: 0, opacity: 0, translate: "0 -4px", scale: "1" },
        { offset: s1 / T, opacity: 0, translate: "0 -4px", scale: "1" },
        { offset: (s1 + d) / T, opacity: 0.55, translate: "0 0", scale: "1" },
        { offset: s2 / T, opacity: 0.55, translate: "0 0", scale: "1" },
        { offset: (s2 + d * 0.6) / T, opacity: 1, translate: "0 0", scale: "1.08" },
        { offset: Math.min(1, (s2 + d) / T), opacity: 1, translate: "0 0", scale: "1" }
      ], { duration: T, delay: OPEN.morphMs, easing: "ease-out", fill: "backwards" });
      a.startTime = OPEN.t0;
    });
  }

  function handleEvent(e) {
    if (e.t === "seatRoll" || e.t === "breakRoll") {
      lastDice = { seat: e.seat, d: e.d };
      spinDice = e.d.length;
      spinUntil = Date.now() + (reduceMotion() ? 0 : e.t === "seatRoll" ? ROLL_MS : BREAK_MS);
      if (e.t === "seatRoll") SEATING.spin(e.seat);
    }
    // the opening's beats (see "The opening")
    if (e.t === "seated") startOpening(true);
    if (e.t === "nextHand") startOpening(false);
    if (e.t === "breakRoll") startDeal();
    if (e.t === "deal") ui.handOrder = null;   // fresh hand → re-seed the manual arrangement
    if (e.t === "discard" && model.turn && e.seat === mySeat()) { /* no toast for my own act */ }
    if (e.t === "claimsOpen" && !e.robbing && e.seats.indexOf(mySeat()) >= 0) {
      toast(fmt(S.claimToast, { name: seatName(e.from), tile: tileName(e.tile) }), "info");
    }
    if (e.t === "win" && e.robbing && e.from === mySeat()) {
      toast(fmt(S.robbedToast, { name: seatName(e.seat) }), "error");
    }
    if (e.t === "handOver" && e.summary && e.summary.result === "win") {
      var s = e.summary;
      if (s.seat === mySeat()) toast(fmt(S.winToast, { n: s.value }), "success");
      else if (s.discarder === mySeat()) toast(fmt(S.dealInToast, { name: seatName(s.seat) }), "error");
    }
    // disconnect-grace trio (worker only; the mock never emits these). The
    collectFlight(e);
    // the shell appends the log line (cfg.logLine) and owns the presence toasts
  }

  /* ── typed events → terse mechanical log lines ────────────────── */
  function logLine(e) {
    var n = function (i) { return seatName(i); };
    var TL = function (t) { return { tile: t }; };
    var L = function () { return { parts: Array.prototype.slice.call(arguments) }; };
    var MELD = { pung: "pung", kong: "kong", kongA: "kong", kongC: "concealed kong", chow: "chow" };
    switch (e.t) {
      case "seatRoll": return L(n(e.seat) + " rolled " + (e.d[0] + e.d[1]));
      case "seatReroll": return L("Tie — rolling again");
      case "seated": return L(n(e.order[0]) + " deals as East");
      case "breakRoll": return L(n(e.seat) + " broke the wall at " + (e.d[0] + e.d[1] + e.d[2]));
      case "deal": return { divider: windLabel(e.prevailing) + " " + e.hand + ": " + n(e.dealer) + " deals" };
      case "flower": return L(n(e.seat) + " drew ", TL(e.tile));
      case "discard": return L(n(e.seat) + " discarded ", TL(e.tile));
      case "meld": return e.tile
        ? L(n(e.seat) + " called " + (MELD[e.kind] || e.kind) + " on ", TL(e.tile))
        : L(n(e.seat) + " declared a concealed kong");
      case "kongTry": return L(n(e.seat) + " adds to a kong: ", TL(e.tile));
      case "win": return e.selfDraw ? L(n(e.seat) + " wins by self-draw!") : L(n(e.seat) + " wins off " + n(e.from) + (e.robbing ? " (robbed the kong!)" : ""));
      case "handOver": return e.summary.result === "drawn" ? L("Exhaustive draw") : null;
      case "newWind": return { divider: windLabel(e.prevailing) + " round begins" };
      case "gameOver": return L(n(e.winner) + " wins the match!");
      case "start": return L("Table starts — roll for seats");
      case "takeover": return L(n(e.seat) + " is now a bot");
      default: return null;
    }
  }
  function windLabel(i) { return WIND_NAME()[i % 4]; }
  function orderIdx(seat) { return model.order ? model.order.indexOf(seat) : seat; }
  function seatWind(seat) {
    if (!model.order || !model.round) return null;
    return (orderIdx(seat) - model.round.dealerIdx + 4) % 4;
  }
  function dealerSeat() { return model.order ? model.order[model.round.dealerIdx] : null; }
  // who the table is waiting on right now (timer ring + players tile accents)
  function activeSeats() {
    if (!model || model.phase === "lobby" || model.phase === "over") return [];
    if (model.phase === "seating") {
      var scope = (model.seating && model.seating.reroll) || [0, 1, 2, 3];
      return scope.filter(function (s) { return !(model.seating && model.seating.rolls[s]); });
    }
    if (model.handOver) return [];
    if (model.claims) return claimRevealed() ? model.claims.waiting || [] : [];
    if (model.needBreak) return [dealerSeat()];
    if (model.turn) return [model.turn.seat];
    return [];
  }

  /* ═══ RENDER ═══════════════════════════════════════════════════ */
  /* the shell's render frame calls this once the toolbar, the desktop-only
     guard and the gate/table visibility are settled (games/table.js) */
  function paint() {
    var wasPhase = paintedPhase;
    // the rack as it stood, so the tiles that stay can slide to their new places
    var rackWas = wasPhase === model.phase && !TQ.noFlip ? snapRack() : null;
    TQ.noFlip = false;
    HOLD = tqHolds();
    var morph = morphBefore(wasPhase);   // before seamBefore moves paintedPhase on
    var hoGlide = handOverBefore();      // the seat boxes, before the panel covers them
    var before = seamBefore();
    TABLE.dataset.phase = model.phase;   // CSS hook: the narrow lobby sheds the side tiles
    renderBig();
    renderDice();
    renderPlayers();
    renderWallPanel();
    renderLog();
    renderClaim();
    renderRole();
    renderGuide();
    fitLog();
    flipRack(rackWas);
    tqSweep();
    seamShift(before);
    waveStart(wasPhase);
    waveApply();
    morphRun(morph);
    handOverRun(hoGlide);
    buildApply();
    dealPaint();
  }
  /* ── the stage: every phase fills one stage, so lobby → seating →
     play → over → lobby only moves the dividers between panels (the
     seams), and the pieces inside them arrive in nested waves (his calls,
     2026-10-25). How both run is shared since 2026-10-28, when cities
     wanted them too: games/stage.js. This file says when a wave starts and
     what arrives in what order. */
  var BENTO = TABLE.querySelector(".mj-bento");
  var STAGE = window.DeetsStage.create({
    root: TABLE, bento: BENTO, panel: "mj-tile", strip: /^(data-mj|id$|aria-)/,
    tree: waveTree,
    // the stats reveal's own entrance (mj-overin) would double the wave and,
    // rising, make its scroll box look scrolled: the wave is its entrance now
    beforeApply: function () {
      live(".mj-over").forEach(function (o) {
        o.getAnimations().forEach(function (a) { if (a.animationName === "mj-overin") a.cancel(); });
      });
    }
  });
  var paintedPhase = null;
  function seamToken(name) { return STAGE.token(name); }
  function tokenMs(name) { return STAGE.ms(name); }
  function motionOk() { return STAGE.motionOk(); }
  function live(sel) { return STAGE.live(sel); }   // the live panels' pieces, never a seam ghost's
  // the panels as they stand, each with its ghost, when this render changes phase
  function seamBefore() {
    var was = paintedPhase;
    paintedPhase = model.phase;
    return STAGE.before(!!was && was !== model.phase);
  }
  function seamShift(before) { STAGE.shift(before); }

  /* ── waves: when a phase changes, and when each new hand is dealt, the
     pieces inside the panels arrive in nested waves (his call, 2026-10-25):
     the panels in turn, the seats from the dealer, the tiles within each
     seat, the wall's four sides and each side's stacks. */
  var WAVE_NEST = STAGE.NEST;
  var paintedHandOver = false, paintedBreak = false;
  function waveStart(wasPhase) {
    var inPlay = model.phase === "play" && !model.handOver;
    var built = inPlay && paintedHandOver;                      // Next hand: a fresh wall
    var dealt = inPlay && paintedBreak && !model.needBreak;     // the break: hands dealt
    paintedHandOver = !!model.handOver;
    paintedBreak = !!model.needBreak;
    var shifted = wasPhase && wasPhase !== model.phase;
    // the opening's own build and deal stand in for those two waves
    if (OPEN) built = false;
    if (dealing()) dealt = false;
    STAGE.wave(shifted ? "phase" : built ? "build" : dealt ? "deal" : null);
  }
  function waveApply() { STAGE.apply(); }
  // the order a seat's pieces arrive in: from the dealer in play order
  // (East first, the deal), by seat before the winds are drawn
  function dealRank(seat) {
    if (!model.order || !model.round) return seat;
    return (orderIdx(seat) - model.round.dealerIdx + 4) % 4;
  }
  function byDeal(list, seatOf) {
    return list.slice().sort(function (a, b) { return dealRank(seatOf(a)) - dealRank(seatOf(b)); });
  }
  // the seat whose wall a felt side is (the side in front of it)
  function sideSeat(side) {
    for (var s = 0; s < 4; s++) if (side.classList.contains("mj-wall__side--" + POS_CLS[displayPos(s)])) return s;
    return 0;
  }
  // the lobby's rows and the seating pads are the shell's (STAGE.shellKids)
  var WAVE_ALL = ["mj-over", "mj-over__supers", "mj-over__reveal", "mj-dice__faces", "mj-dice__dice",
    "mj-wall__side", "mj-wallbar__seats", "mj-log__list", "mj-play", "mj-rack", "mj-rack__tiles",
    "mj-rack__melds", "mj-play__ctrl", "mj-actions"];
  // a piece's own pieces, in the order they arrive
  function waveKids(n) {
    var shell = STAGE.shellKids(n);
    if (shell) return shell;
    function q(s) { return [].slice.call(n.querySelectorAll(s)); }
    var c = n.classList;
    if (c.contains("mj-board")) {
      // the seat boxes the opening's pads morph into are placed by the
      // morph alone: a rise after it (the skin's --boot-rise) read as a
      // second move once they'd landed
      var zones = morphing() ? [] : byDeal(q(":scope > .mj-zone"), function (z) { return +z.getAttribute("data-zone"); });
      return q(":scope > .mj-feltwrap").concat(zones);
    }
    // each side is entered at its player's right hand (renderFelt's order)
    // (a wall going up has its own build — buildApply — not the wave)
    if (c.contains("mj-feltwrap")) return (building() ? [] : byDeal(q(".mj-wall__side"), sideSeat)).concat(q(".mj-felt__pond > *"));
    if (c.contains("mj-zone")) return q(".mj-zone__backs > *, .mj-zone__melds > *");
    if (c.contains("mj-pstrip")) return q(".mj-pstrip__head, .mj-pstrip__tags, .mj-pstrip__stat");
    for (var i = 0; i < WAVE_ALL.length; i++) if (c.contains(WAVE_ALL[i])) return q(":scope > *");
    return [];
  }
  function panelKids(p) {
    var kids = [].slice.call(p.children);
    return p === PLAYERS ? byDeal(kids, function (s) { return kids.indexOf(s); }) : kids;
  }
  // nor does the board rise under the morphing pads (its other pieces still arrive)
  function boardHeld(n) { return morphing() && n.classList.contains("mj-board"); }
  // every piece with its raw offset (STAGE.walk)
  function waveTree(kind) {
    var out = [];
    if (kind === "build") return STAGE.walk(live(".mj-feltwrap"), 0, 1, waveKids, out, boardHeld);
    if (kind === "deal") {
      // seat by seat from the dealer, my rack in my turn, tile by tile
      byDeal([0, 1, 2, 3], function (s) { return s; }).forEach(function (s, i) {
        STAGE.walk(s === mySeat() ? live(".mj-rack__tiles > *").concat(live(".mj-rack__melds > *"))
          : live('.mj-zone[data-zone="' + s + '"] .mj-zone__backs > *').concat(live('.mj-zone[data-zone="' + s + '"] .mj-zone__melds > *')),
          i, WAVE_NEST, waveKids, out, boardHeld);
      });
      return out;
    }
    [BIG, DICE, PLAYERS, WALL, LOG, ROLE]
      .filter(function (p) { return !p.hidden && p.getClientRects().length; })
      .forEach(function (p, i) { STAGE.walk(panelKids(p), i, WAVE_NEST, waveKids, out, boardHeld); });
    return out;
  }
  /* ── wall panel: the live count + round marker (between Players
     and Log — the felt center carries no text) ──────────────────── */
  function renderWallPanel() {
    WALL.textContent = "";
    var inHand = model.round != null && (model.phase === "play" || model.phase === "over");
    WALL.hidden = !inHand;
    if (!inHand) return;
    // the tiles-left tip covers the wall readout only — as the narrow bar
    // the tile also carries the seat boxes and Log, each with its own.
    // A tile still waiting to lift off the wall still counts (tile flights).
    var left = model.wallLeft != null ? model.wallLeft + HOLD.front + HOLD.back : null;
    var tip = fmt(S.wallLeftTip, { n: left != null ? left : 0 });
    var bar = MERGE_MQ.matches;
    WALL.title = bar ? "" : tip;
    var back = backEl("mini");
    if (bar) back.title = tip;
    WALL.appendChild(back);
    var col = el("div", "mj-wallpanel");
    if (bar) col.title = tip;
    col.appendChild(el("div", "mj-wallpanel__count", left != null ? fmt(S.wallLeft, { n: left }) : "–"));
    col.appendChild(el("div", "mj-wallpanel__round", fmt(S.roundLine, { wind: windLabel(model.round.prevailing), n: model.round.hand })));
    WALL.appendChild(col);
    if (MERGE_MQ.matches) { WALL.appendChild(barSeats()); WALL.appendChild(barLog()); }
  }
  /* below 64rem the wall panel is the BAR above the board: after a divider,
     one box per seat in play order from the dealer (leftmost), each its
     seat color with the score. It stands in for the players tile, which
     sits out the narrow layout with the dice and the log. */
  function barSeats() {
    var wrap = el("div", "mj-wallbar__seats");
    var active = activeSeats();
    var order = model.order || [0, 1, 2, 3];
    var from = model.order ? model.round.dealerIdx : 0;
    for (var k = 0; k < order.length; k++) {
      var i = order[(from + k) % order.length];
      var s = model.seats && model.seats[i];
      if (!s || s.empty) continue;
      var p = model.players && model.players[i];
      var box = el("div", "mj-wallbar__seat" + (active.indexOf(i) >= 0 ? " is-active" : "") + (!s.connected ? " is-away" : ""));
      TBL.seatAccent(box, i);
      box.title = seatName(i);
      box.setAttribute("aria-label", seatName(i));
      box.appendChild(seatDot(i));
      // the full "{n} pts" and the bare number; the box's width picks one
      box.appendChild(el("span", "mj-wallbar__pts", fmt(S.scoreShort, { n: p ? p.score : 0 })));
      box.appendChild(el("span", "mj-wallbar__num", String(p ? p.score : 0)));
      wrap.appendChild(box);
    }
    return wrap;
  }
  /* the bar's last control: Log, after a divider. Its popover is the
     toolbar Settings pill's (the shell's pop kit): hover peeks, a click
     pins it open across re-renders, outside click / Escape closes. */
  function barLog() {
    var wrap = el("span", "mj-wallbar__logctl");
    var b = el("button", "tb-pill"); b.type = "button";
    b.setAttribute("aria-haspopup", "true");
    b.appendChild(el("span", "tb-pill__label", S.logPill));
    wrap.appendChild(b);
    var pop = el("div", "tb-pop mj-logpop"); pop.hidden = true;
    var list = el("div", "mj-log__list");
    shownLines().forEach(function (entry) { list.appendChild(logLineEl(entry)); });
    pop.appendChild(list);
    wrap.appendChild(pop);
    function show() { pop.hidden = false; list.scrollTop = list.scrollHeight; }
    var entry = { ctrl: wrap, pill: b, pop: pop, kind: "mjlog" };
    function peek() { if (TBL.pop.current() !== entry) show(); }
    function unpeek() { if (TBL.pop.current() !== entry) pop.hidden = true; }
    wrap.addEventListener("mouseenter", peek);
    wrap.addEventListener("mouseleave", unpeek);
    b.addEventListener("focus", peek);
    b.addEventListener("blur", unpeek);
    b.addEventListener("click", function () {
      TBL.pop.toggle(entry);
      ui.logPinned = TBL.pop.current() === entry;
      if (ui.logPinned) show();
    });
    var cur = TBL.pop.current();
    if (ui.logPinned && cur && cur.kind === "mjlog") { TBL.pop.open(entry); show(); }
    else ui.logPinned = false;
    return wrap;
  }

  /* two live faces from a deck, for the chips + popover options. Only
     sprites that actually loaded show — a bare placeholder deck reads as
     its name alone rather than two broken frames. */
  /* ── Beginner: the chick ─────────────────────────────────────────
     A Beginner wins at 0 faan (engine minFaanFor). Every human seat in the
     lobby shows the chick, outlined when off; the host may flip any seat
     and a player their own (friends moderate), lobby only. In play it rides
     beside a beginner's name as a static badge. The glyph follows the
     toolbar icons' standard (24-unit grid, --icon-stroke) and the toggle's
     flap rides --icon-spring. Lobby rows rebuild on every broadcast, so
     each seat's glyph is built ONCE and moved into each new row — its Web
     Animation survives the move. */
  var CHICKS = {};
  function chickSvg(key) {
    if (key != null && CHICKS[key]) return CHICKS[key];
    function s(name, attrs, parent) {
      var n = document.createElementNS("http://www.w3.org/2000/svg", name);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(n);
      return n;
    }
    var svg = s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
    s("circle", { "class": "mj-chick__body", cx: 12, cy: 13, r: 6.5 }, svg);
    s("path", { d: "M11.2 6.7q.4-1.8 1.6-1.2q.2-1.4 1.4-.6" }, svg);              // tuft
    s("circle", { "class": "mj-chick__eye", cx: 13.8, cy: 10.6, r: 0.65 }, svg);
    s("path", { d: "M18.3 11.6L20.6 12.4L18.4 13.3" }, svg);                      // beak
    var wing = s("g", { "class": "mj-chick__wing" }, svg);
    s("path", { d: "M7.6 13.4C8.4 12 10.4 11.9 11.2 13.2C10.6 14.9 8.7 15.3 7.6 13.4Z" }, wing);
    s("path", { d: "M10.4 19.4V21M13.6 19.4V21M9.4 21h2M12.6 21h2" }, svg);      // feet
    if (key != null) CHICKS[key] = svg;
    return svg;
  }
  // every press answers: ON is the full double flap and hop; OFF is one
  // small tuck of the wing as the chick settles back down
  function flapChick(svg, on) {
    try { if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (e) {}
    if (!svg.animate) return;
    var v = getComputedStyle(document.documentElement).getPropertyValue("--icon-spring").trim();
    var ms = (parseFloat(v) || 0.42) * (/^[\d.]+ms/.test(v) ? 1 : 1000) * 1.5;
    var ease = v.replace(/^\S+\s*/, "") || "ease";
    if (!on) {
      svg.querySelector(".mj-chick__wing").animate([
        { transform: "rotate(0deg)" }, { transform: "rotate(-14deg)", offset: 0.35 }, { transform: "rotate(0deg)" }
      ], { duration: ms * 0.6, easing: ease });
      svg.animate([
        { transform: "translateY(0)" }, { transform: "translateY(1px)", offset: 0.35 }, { transform: "translateY(0)" }
      ], { duration: ms * 0.6, easing: ease });
      return;
    }
    svg.querySelector(".mj-chick__wing").animate([
      { transform: "rotate(0deg)" }, { transform: "rotate(-34deg)", offset: 0.22 },
      { transform: "rotate(6deg)", offset: 0.44 }, { transform: "rotate(-24deg)", offset: 0.66 },
      { transform: "rotate(0deg)" }
    ], { duration: ms, easing: ease });
    svg.animate([
      { transform: "translateY(0)" }, { transform: "translateY(-1.5px)", offset: 0.3 }, { transform: "translateY(0)" }
    ], { duration: ms, easing: ease });
  }
  // the lobby seat row's chick (the shell's seatExtra hook) — humans only
  // A press flips the chick at once and remembers what it asked for, so a
  // second press before the broadcast lands flips it BACK (not re-sends the
  // same value off a stale row); the entry clears once the model agrees.
  var chickPending = {};
  function beginnerToggle(s, i) {
    if (s.bot || s.phantom) return null;
    if (chickPending[i] === !!s.beginner) delete chickPending[i];
    var on = i in chickPending ? chickPending[i] : !!s.beginner;
    var can = i === mySeat() || model.host;
    var b = el(can ? "button" : "span", "mj-chick mj-chick--toggle" + (on ? " is-on" : ""));
    var label = on ? S.beginnerOn : S.beginnerOff;
    b.title = label;
    b.setAttribute("aria-label", label);
    var svg = chickSvg("seat" + i);
    b.appendChild(svg);
    if (can) {
      b.type = "button";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", function () {
        var next = !(i in chickPending ? chickPending[i] : !!(model.seats[i] && model.seats[i].beginner));
        chickPending[i] = next;
        b.classList.toggle("is-on", next);
        b.setAttribute("aria-pressed", next ? "true" : "false");
        flapChick(svg, next);
        send({ type: "setBeginner", seat: i, on: next });
      });
    }
    return b;
  }
  // the static badge beside a beginner's name in play
  function chickBadge(seat) {
    var sv = model.seats && model.seats[seat];
    if (!sv || !sv.beginner) return null;
    var b = el("span", "mj-chick is-on");
    b.title = S.beginnerOn;
    b.setAttribute("aria-label", S.beginnerOn);
    b.appendChild(chickSvg(null));
    return b;
  }

  function deckSamples(d, node) {
    ["tile-p5", "tile-s3"].forEach(function (name) {
      if (!sprites[d][name]) return;
      var img = document.createElement("img");
      img.className = "mj-deck__sample"; img.alt = "";
      img.src = SPRITE_ROOT + d + "/" + name + ".png";
      node.appendChild(img);
    });
  }
  /* Tile art — a per-VIEWER pill (localStorage), not a table setting, so
     it lives in the toolbar in EVERY phase: a deck you can't read is
     swappable mid-hand, not just from the lobby. */
  function deckPill() {
    var wrap = el("span", "tb-ctrl");
    var b = el("button", "tb-pill"); b.type = "button";
    b.setAttribute("aria-haspopup", "true"); b.setAttribute("aria-expanded", "false");
    b.appendChild(el("span", "tb-pill__label", S.deckPillLabel));
    var val = el("span", "tb-pill__value", curDeck() === "traditional" ? S.deckTraditionalShort : S.deckNumeralShort);
    b.title = S.deckLabel + ": " + deckName(curDeck());
    b.appendChild(val);
    b.appendChild(el("span", "tb-pill__caret", "▾"));
    wrap.appendChild(b);
    var pop = el("div", "tb-pop mj-deck__pop"); pop.hidden = true;
    DECKS.forEach(function (d) {
      var o = el("button", "tb-pop__opt" + (curDeck() === d ? " is-active" : ""));
      o.type = "button";
      var lead = el("span", "mj-deck__lead");
      lead.appendChild(el("span", null, deckName(d)));
      deckSamples(d, lead);
      o.appendChild(lead);
      o.addEventListener("click", function () { TBL.pop.close(); setDeck(d); });
      pop.appendChild(o);
    });
    wrap.appendChild(pop);
    var entry = { ctrl: wrap, pill: b, pop: pop, kind: "deck" };
    b.addEventListener("click", function () {
      TBL.pop.toggle(entry);
      ui.deckPinned = TBL.pop.current() === entry;
    });
    var open = TBL.pop.current();
    if (ui.deckPinned && open && open.kind === "deck") TBL.pop.open(entry);
    else ui.deckPinned = false;
    return wrap;
  }

  /* ── BIG tile: lobby / seating / the table / game over ────────── */
  function renderBig() {
    BIG.textContent = "";
    if (model.phase === "lobby") return TBL.renderLobby(BIG);
    if (model.phase === "over") return renderOver();
    if (model.phase === "seating") return renderSeating();
    renderTable();
    if (model.handOver) renderHandOver();
  }

  /* The shell renders the lobby (title, seats, bots, seat colors, Start);
     these are DeetsMahjong's own setting rows. Minimum faan keeps its
     custom text box, so that row is built by hand rather than as a
     plain chip choice. */
  function lobbySettings(wrap) {
    var st = model.settings, host = model.host;

    // minimum faan: 0 / 1 / 3 / custom text box
    var mfRow = TBL.setRow(S.minFaanLabel);
    var mf = st.minFaan;
    [0, 1, 3].forEach(function (n) {
      mfRow.opts.appendChild(TBL.chip(String(n), mf === n, !host, function () {
        ui.minFaanDraft = null; send({ type: "setSettings", minFaan: n });
      }));
    });
    var custom = el("input", "gt-set__custom" + ([0, 1, 3].indexOf(mf) < 0 ? " is-active" : ""));
    custom.type = "text"; custom.maxLength = 2; custom.disabled = !host;
    custom.setAttribute("aria-label", S.minFaanCustomAria);
    custom.value = ui.minFaanDraft != null ? ui.minFaanDraft : ([0, 1, 3].indexOf(mf) < 0 ? String(mf) : "");
    custom.addEventListener("input", function () { ui.minFaanDraft = custom.value; });
    custom.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var n = parseInt(custom.value, 10);
      if (!isNaN(n) && n >= 0 && n <= 13) { ui.minFaanDraft = null; send({ type: "setSettings", minFaan: n }); }
    });
    custom.addEventListener("blur", function () {
      var n = parseInt(custom.value, 10);
      if (!isNaN(n) && n >= 0 && n <= 13 && n !== model.settings.minFaan) { ui.minFaanDraft = null; send({ type: "setSettings", minFaan: n }); }
    });
    mfRow.opts.appendChild(custom);
    wrap.appendChild(mfRow);

    // no faan-cap row (his call, 2026-10-25): the cap is fixed at the
    // engine's default 13, which only ever bites on limit hands
    // match length: one hand, one wind (default), or four winds
    wrap.appendChild(TBL.choiceRow(S.windsLabel, "winds",
      [[0, S.windsHand], [1, S.windsOne], [4, S.windsFour]], st.winds));
    var timerRow = TBL.choiceRow(S.timerLabel, "timerSec",
      [[0, S.timerOff], [45, fmt(S.timerSecs, { n: 45 })], [60, fmt(S.timerSecs, { n: 60 })],
       [90, fmt(S.timerSecs, { n: 90 })], [120, fmt(S.timerSecs, { n: 120 })]], st.timerSec);
    // plus a free box for any budget the presets don't offer (5–600s)
    timerRow.opts.appendChild(TBL.numChip("timerSec", st.timerSec, [0, 45, 60, 90, 120], S.timerCustom, 5, 600));
    wrap.appendChild(timerRow);

    // tile art: NOT a table setting — every viewer picks their own deck
    // (localStorage, mirrored by the toolbar pill), so these chips are
    // live for guests too. Chips carry live sample sprites.
    var dRow = TBL.setRow(S.deckLabel);
    DECKS.forEach(function (d) {
      var b = TBL.chip("", curDeck() === d, false, function () { setDeck(d); });
      b.classList.add("mj-deck__chip");
      b.appendChild(el("span", null, deckName(d)));
      deckSamples(d, b);
      dRow.opts.appendChild(b);
    });
    wrap.appendChild(dRow);
  }



  /* ── seating: four dice pads, highest deals as East ───────────── */
  // the board, the tumble, the staging and the pads' morph are shared
  // (games/seating.js); the dice and the Roll pill are mahjong's own
  var SEATING = window.DeetsSeating.create({
    root: BIG, bento: TABLE.querySelector(".mj-bento"),
    S: { title: S.seatingTitle, note: S.seatingNote, reroll: S.seatingReroll }, fmt: fmt,
    seating: function () { return model.seating; },
    seats: function () { return model.seats; },
    mySeat: function () { return mySeat(); },
    seatName: function (i) { return seatName(i); },
    seatDot: function (i) { return seatDot(i); },
    accent: function (node, i) { TBL.seatAccent(node, i); },
    die: function (v) { return el("div", "mj-die mj-die--small", v == null ? "–" : String(v)); },
    rollPill: function (enabled, onClick) {
      var p = actionPill(S.rollPill, enabled, onClick);
      p.classList.add("mj-act--roll");
      if (enabled) p.classList.add("is-glow");
      return p;
    },
    roll: function () { send({ type: "rollSeat" }); }
  });
  function renderSeating() { BIG.appendChild(SEATING.render()); }

  /* ── the table: four rotated seat zones around a center well ──── */
  // display position of a seat for THIS viewer: 0 bottom (me), then
  // counterclockwise in play order — 1 right, 2 top, 3 left
  function displayPos(seat) {
    var anchor = mySeat() != null ? mySeat() : (model.order ? model.order[0] : 0);
    if (!model.order) return (seat - anchor + 4) % 4;
    return (orderIdx(seat) - orderIdx(anchor) + 4) % 4;
  }
  var POS_CLS = ["bottom", "right", "top", "left"];
  /* too narrow for side seats beside the felt (phones, small windows): the
     felt goes on top and shrinks to fit, and every seat stacks under it as
     a full-width row, me first, then the rest in play order. Mirrors the
     48rem query in mahjong.css. */
  var STACK_MQ = window.matchMedia("(max-width: 48rem)");
  STACK_MQ.addEventListener("change", function () { if (model) render(); });
  function renderTable() {
    var stacked = STACK_MQ.matches;
    var board = el("div", "mj-board" + (stacked ? " mj-board--stacked" : ""));
    board.setAttribute("data-mj-board", "");
    var active = activeSeats();
    var zones = [];
    for (var seat = 0; seat < 4; seat++) {
      var pos = POS_CLS[displayPos(seat)];
      var zone = el("div", "mj-zone mj-zone--" + (stacked ? "row" : pos) + (active.indexOf(seat) >= 0 ? " is-active" : ""));
      zone.setAttribute("data-zone", seat);
      TBL.seatAccent(zone, seat);
      var p = model.players[seat];

      // head: dot + name + wind + dealer marker
      var head = el("div", "mj-zone__head");
      head.appendChild(seatDot(seat));
      head.appendChild(el("span", "mj-zone__name", seatName(seat) + (seat === mySeat() ? " ·" : "")));
      var zck = chickBadge(seat); if (zck) head.appendChild(zck);
      var w = seatWind(seat);
      if (w != null) {
        var wt = el("span", "mj-zone__wind" + (w === 0 ? " is-dealer" : ""), HONOR_GLYPH[Engine.WINDS[w]]);
        wt.title = windLabel(w) + (w === 0 ? " · " + S.dealerTag : "");
        head.appendChild(wt);
      }
      zone.appendChild(head);

      // concealed hand: face-down backs for others, nothing for me (the rack
      // tile shows my tiles); spectators see backs all around
      var isSide = !stacked && (pos === "left" || pos === "right");
      var dir = pos === "left" ? "l" : "r";
      var backs = null;
      if (seat !== mySeat()) {
        // a tile on its way out still sits in the hand; one on its way in
        // keeps a hidden slot at the end of the row (tile flights)
        backs = el("div", "mj-zone__backs");
        var incoming = HOLD.into[seat] || [];
        var nb = p.handCount + (HOLD.out[seat] || 0);
        for (var i = 0; i < nb; i++) {
          var bk = backEl("mini");
          var inIdx = i - (nb - incoming.length);
          if (inIdx >= 0) pending(bk, incoming[inIdx]);
          backs.appendChild(bk);
        }
      }

      // melds + flowers, face up — side seats sit AT the table: everything
      // sideways, melds running down a second column beside the hand
      var mrow = el("div", "mj-zone__melds" + (isSide ? " mj-zone__melds--side" : ""));
      appendMeldsFlowers(mrow, seat, isSide ? dir : null);
      if (isSide) {
        var body = el("div", "mj-zone__sidebody");
        if (backs) body.appendChild(backs);
        body.appendChild(mrow);
        zone.appendChild(body);
      } else {
        if (backs) zone.appendChild(backs);
        zone.appendChild(mrow);
      }

      zones[displayPos(seat)] = zone;
    }

    if (stacked) {
      board.appendChild(renderFelt());
      zones.forEach(function (z) { board.appendChild(z); });
    } else {
      zones.forEach(function (z) { board.appendChild(z); });
      board.appendChild(renderFelt());
    }
    BIG.appendChild(board);
  }

  /* ── the felt: the wall square around the shared discard pond ──
     72 two-tile stacks in the classical pinwheel (each side overhangs
     the next corner). Depletion is cosmetic bookkeeping off public
     counts: front draws eat clockwise from the dealer's real break
     point, replacement (rear) draws eat backwards from it; the wall's
     CONTENTS never reach the client (docs/mahjong.md, hidden info).
     Stacks are indexed 0..71 screen-clockwise — bottom right→left,
     left bottom→top, top left→right, right top→bottom — so every
     side is entered at its seated player's right hand, which is where
     the break count starts in the real ritual. */
  var SIDE_ORDER = ["bottom", "left", "top", "right"];   // canonical clockwise
  function breakStackIndex() {
    if (!model.breakRoll || !model.order || !model.round) return 0;
    var sum = model.breakRoll[0] + model.breakRoll[1] + model.breakRoll[2];
    // the dealer counts `sum` seats counterclockwise starting with himself;
    // the wall in front of that seat is broken `sum` stacks from its right
    var sideSeat = model.order[(model.round.dealerIdx + ((sum - 1) % 4)) % 4];
    return SIDE_ORDER.indexOf(POS_CLS[displayPos(sideSeat)]) * 18 + (sum - 1) % 18;
  }
  function renderFelt() {
    var wrap = el("div", "mj-feltwrap");
    var felt = el("div", "mj-felt");
    wrap.appendChild(felt);
    felt.setAttribute("data-mj-center", "");
    var drawn = model.wallLeft != null ? 144 - model.wallLeft : 0;
    var rear = model.wallLeft != null ? Math.max(0, (model.wallBack || 0) - HOLD.back) : 0;
    // a draw still waiting its turn leaves its tile on the wall (tile flights)
    var front = Math.max(0, drawn - (model.wallBack || 0) - HOLD.front);
    // mid-deal the wall holds what the deal hasn't lifted yet; flower
    // replacements come off the back after it (tile flights)
    if (dealing()) { front = dealTaken(); rear = 0; }
    var brk = breakStackIndex();
    var sides = {};
    SIDE_ORDER.forEach(function (pos) { sides[pos] = el("div", "mj-wall__side mj-wall__side--" + pos); });
    for (var k = 0; k < 72; k++) {
      var st = backEl("wall");
      var fpos = (k - brk + 72) % 72;                    // clockwise distance from the break
      var rpos = (brk - 1 - k + 144) % 72;               // backwards distance from the break
      st.setAttribute("data-k", k);                      // the build's order (each side from its right hand)
      st.setAttribute("data-fpos", fpos);                // the deal's order (clockwise from the break)
      if (fpos < Math.floor(front / 2) || rpos < Math.floor(rear / 2)) st.classList.add("is-gone");
      else {
        if (fpos === Math.floor(front / 2)) {
          if (front % 2) st.classList.add("is-half");
          st.setAttribute("data-wall-front", "");        // the next draw slips out here
        }
        if (rpos === Math.floor(rear / 2)) {
          if (rear % 2) st.classList.add("is-half");
          st.setAttribute("data-wall-back", "");         // replacements come off here
        }
      }
      sides[SIDE_ORDER[Math.floor(k / 18)]].appendChild(st);
    }
    SIDE_ORDER.forEach(function (pos) { felt.appendChild(sides[pos]); });

    // the shared pond: every discard in play order; hover names the thrower
    var pond = el("div", "mj-felt__pond");
    pond.setAttribute("data-mj-pond", "");
    // A discard in flight keeps a hidden slot; a claimed tile stays in the
    // pond until it lifts off toward the claimant's melds (tile flights).
    var entries = model.pond || [];
    entries.forEach(function (d, idx) {
      var te = tileEl(d.tile, "mini");
      te.title = fmt(S.pondTip, { name: seatName(d.seat) });
      var isNewest = idx === entries.length - 1;
      if (isNewest && model.claims && model.claims.from === d.seat && !model.claims.robbing) te.classList.add("is-hot");
      if (HOLD.pond[idx]) pending(te, HOLD.pond[idx]);
      pond.appendChild(te);
    });
    if (HOLD.claim) {
      var ct = tileEl(HOLD.claim.tile, "mini");
      ct.setAttribute("data-step-from", HOLD.claim.id);
      pond.appendChild(ct);
    }
    felt.appendChild(pond);
    // the break, in the middle of the felt — once the wall stands. The
    // dealer gets the Roll; everyone else is told who's rolling.
    if (model.needBreak && !building()) {
      var brkBox = el("div", "mj-felt__break");
      var meBreaks = dealerSeat() === mySeat();
      brkBox.appendChild(el("p", "mj-felt__note",
        meBreaks ? S.breakPromptYou : fmt(S.breakPrompt, { name: seatName(dealerSeat()) })));
      if (meBreaks) {
        var bp = actionPill(S.rollPill, true, function () { send({ type: "rollBreak" }); });
        bp.classList.add("mj-act--roll", "is-glow");
        brkBox.appendChild(bp);
      }
      felt.appendChild(brkBox);
    }
    return wrap;
  }
  // a sideways board tile: the shared rectangle transposed, face rotated
  // toward the table center (left seat +90°, right seat −90°)
  function rotWrap(tile, dir) {
    var w = el("span", "mj-rots" + (dir === "r" ? " mj-rots--r" : ""));
    w.appendChild(tile);
    return w;
  }
  function meldEl(m, size, dir) {
    var wrap = el("span", "mj-meld");
    function put(node) { wrap.appendChild(dir ? rotWrap(node, dir) : node); }
    if (m.kind === "kongC") {
      // a concealed kong shows two backs framing two faces (identity hidden
      // until the reveal? HK convention shows it face-down; keep backs + count)
      for (var i = 0; i < 4; i++) put(backEl(size));
      return wrap;
    }
    var n = m.kind === "kong" || m.kind === "kongA" ? 4 : 3;
    if (m.kind === "chow") {
      var s = Engine.suitOf(m.tile), lo = Engine.numOf(m.tile);
      for (var j = 0; j < 3; j++) put(tileEl(s + (lo + j), size));
      return wrap;
    }
    for (var k = 0; k < n; k++) put(tileEl(m.tile, size));
    return wrap;
  }
  // a seat's face-up melds then flowers, into a zone's row or my rack's.
  // One still in flight keeps its place hidden until it lands (tile flights).
  function appendMeldsFlowers(row, seat, dir) {
    var p = model.players[seat];
    var hm = HOLD.meld[seat] || {}, hf = HOLD.flower[seat] || {};
    p.melds.forEach(function (m, i) {
      var me = meldEl(m, "mini", dir);
      if (hm[i]) pending(me, hm[i]);
      row.appendChild(me);
    });
    p.flowers.forEach(function (f, i) {
      var fe = tileEl(f, "mini");
      fe.classList.add("mj-tilef--flower");
      var node = dir ? rotWrap(fe, dir) : fe;
      if (hf[i]) pending(node, hf[i]);
      row.appendChild(node);
    });
  }

  /* ── hand-over settlement (overlays the board tile) ───────────── */
  function renderHandOver() {
    var s = model.handOver;
    var wrap = el("div", "mj-handover");
    enterOnce(wrap, ["handOver", s.prevailing, s.hand, s.result, s.seat, s.scores]);
    var panel = el("div", "mj-handover__panel");
    var won = s.result !== "drawn";
    if (!won) {
      panel.appendChild(el("h3", "mj-handover__title", S.handDrawnLine));
      panel.appendChild(el("p", "mj-handover__line", fmt(S.dealerRepeats, { name: seatName(s.dealer) })));
    } else {
      panel.appendChild(el("h3", "mj-handover__title" + (s.limit ? " is-limit" : ""),
        fmt(s.selfDraw ? S.handWinSelf : S.handWinLine, { name: seatName(s.seat), faan: s.faan })));
      if (s.limit) panel.appendChild(el("p", "mj-handover__limit", S.handWinLimit));
    }
    if (s.hands) panel.appendChild(handRowsEl(s));
    else if (won) panel.appendChild(winningHandEl(s));   // an older worker's summary
    if (won) {
      // faan breakdown
      var parts = el("div", "mj-handover__parts");
      (s.parts || []).forEach(function (x) {
        var row = el("div", "mj-handover__part");
        row.appendChild(el("span", "mj-handover__pname", faanName(x.key)));
        row.appendChild(el("span", "mj-handover__pval", String(x.faan)));
        parts.appendChild(row);
      });
      var tot = el("div", "mj-handover__part is-total");
      tot.appendChild(el("span", "mj-handover__pname", fmt(S.faanTotal, { n: s.faan })));
      tot.appendChild(el("span", "mj-handover__pval", "+" + s.value));
      parts.appendChild(tot);
      panel.appendChild(parts);
      // payments ride the rows; an older summary without hands lists them
      if (!s.hands) {
        var pays = el("div", "mj-handover__pays");
        (s.payments || []).forEach(function (n, seat2) {
          if (!n) return;
          var row = el("div", "mj-handover__pay");
          row.appendChild(seatDot(seat2));
          row.appendChild(el("span", null, fmt(S.paysLabel, { name: seatName(seat2), n: n })));
          pays.appendChild(row);
        });
        panel.appendChild(pays);
      }
    }
    // no clock: the host deals the next hand, so the table can talk first
    if (model.host) {
      var next = el("button", "tb-pill mj-handover__next");
      next.type = "button";
      next.appendChild(el("span", "tb-pill__label", S.nextHandButton));
      next.addEventListener("click", function () { send({ type: "nextHand" }); });
      panel.appendChild(next);
    } else {
      panel.appendChild(el("p", "mj-handover__wait", model.hostSeat != null
        ? fmt(S.nextHandWait, { name: seatName(model.hostSeat) }) : S.nextHandWaitHost));
    }
    wrap.appendChild(panel);
    BIG.appendChild(wrap);
    fitHandRows(wrap);
  }
  /* Every seat's hand, one row each (his call, 2026-10-27): the winner on
     top, then play order (a drawn hand starts from the dealer). A row is
     the seat's box (its accent edge, name, wind), its hand on ONE line,
     and what it paid or took. The rows' tiles share one scale, shrunk to
     fit the widest (fitHandRows). */
  function handRowsEl(s) {
    var won = s.result !== "drawn";
    var first = won ? s.seat : s.dealer;
    var order = model.order || [0, 1, 2, 3];
    var seats = [0, 1, 2, 3].map(function (k) { return order[(order.indexOf(first) + k) % 4]; });
    var box = el("div", "mj-handover__rows" + (won ? "" : " is-drawn"));
    seats.forEach(function (seat) {
      var row = el("div", "mj-horow" + (won && seat === s.seat ? " is-winner" : ""));
      row.setAttribute("data-horow", seat);
      TBL.seatAccent(row, seat);
      var head = el("div", "mj-horow__head");
      head.appendChild(seatDot(seat));
      head.appendChild(el("span", "mj-horow__name", seatName(seat)));
      var w = seatWind(seat);
      if (w != null) {
        var wt = el("span", "mj-zone__wind" + (w === 0 ? " is-dealer" : ""), HONOR_GLYPH[Engine.WINDS[w]]);
        wt.title = windLabel(w) + (w === 0 ? " · " + S.dealerTag : "");
        head.appendChild(wt);
      }
      row.appendChild(head);
      var line = el("div", "mj-horow__tiles");
      line.appendChild(handLineEl(s.hands[seat]));
      row.appendChild(line);
      var pay = el("span", "mj-horow__pay");
      if (won) {
        var n = seat === s.seat ? s.value : -(s.payments[seat] || 0);
        pay.textContent = n > 0 ? "+" + n : String(n);
        if (n < 0) pay.classList.add("is-paid");
      }
      if (won) row.appendChild(pay);
      box.appendChild(row);
    });
    return box;
  }
  // one shared scale so every row's hand fits its line; measured unscaled
  function fitHandRows(wrap) {
    var lines = wrap.querySelectorAll(".mj-horow__tiles");
    var k = 1;
    lines.forEach(function (ln) {
      var need = ln.firstChild.offsetWidth, room = ln.clientWidth;
      if (need > 0 && room > 0) k = Math.min(k, (room - 2) / need);   // a hair of slack for the tile edge
    });
    if (k < 1) lines.forEach(function (ln) { ln.firstChild.style.zoom = String(Math.floor(k * 1000) / 1000); });
  }
  /* A hand laid out as it formed: dragons, winds, then the suits (pungs,
     kongs and chows alike, melded or concealed), a rule, the pair, then an
     unfinished hand's loose tiles, a rule, the flowers. Seven pairs line up
     in the same order; a hand with no arrangement (thirteen orphans) shows
     its tiles sorted. At the hand-over everything is revealed, so a
     concealed kong shows its faces. */
  function tileRank(t) {
    var d = Engine.DRAGONS.indexOf(t), w = Engine.WINDS.indexOf(t);
    if (d >= 0) return d;
    if (w >= 0) return 10 + w;
    return 20 + "mps".indexOf(Engine.suitOf(t)) * 10 + Engine.numOf(t);
  }
  function byRank(a, b) { return tileRank(a.tile) - tileRank(b.tile); }
  function groupEl(tiles) {
    var w = el("span", "mj-meld");
    tiles.forEach(function (t) { w.appendChild(tileEl(t, "")); });
    return w;
  }
  function shownMeldEl(m) {
    return m.kind === "kongC" ? groupEl([m.tile, m.tile, m.tile, m.tile]) : meldEl(m, "");
  }
  function handLineEl(h) {
    var row = el("div", "mj-handover__hand");
    // the rule rides the group it sets apart, so nothing strands it; the
    // first group on the line needs none
    function ruled(node) { if (row.firstChild) node.classList.add("is-ruled"); return node; }
    var arr = h.arrangement;
    if (arr && arr.pairs) {
      arr.pairs.map(function (t) { return { tile: t }; }).sort(byRank)
        .forEach(function (x) { row.appendChild(groupEl([x.tile, x.tile])); });
    } else if (arr && arr.sets) {
      arr.sets.concat(h.melds || []).sort(byRank).forEach(function (m) { row.appendChild(shownMeldEl(m)); });
      if (arr.pair) row.appendChild(ruled(groupEl([arr.pair, arr.pair])));
      var rest = (arr.rest || []).slice().sort(function (a, b) { return tileRank(a) - tileRank(b); });
      if (rest.length) row.appendChild(ruled(groupEl(rest)));
    } else {
      (h.melds || []).slice().sort(byRank).forEach(function (m) { row.appendChild(shownMeldEl(m)); });
      var loose = (h.tiles || []).slice().sort(function (a, b) { return tileRank(a) - tileRank(b); });
      if (loose.length) row.appendChild(groupEl(loose));
    }
    if ((h.flowers || []).length) {
      var fl = ruled(el("span", "mj-meld"));
      h.flowers.forEach(function (f) {
        var fe = tileEl(f, "");
        fe.classList.add("mj-tilef--flower");
        fl.appendChild(fe);
      });
      row.appendChild(fl);
    }
    return row;
  }
  // an older worker's summary: the winner's hand alone
  function winningHandEl(s) {
    return handLineEl({ tiles: s.tiles, melds: s.melds, flowers: s.flowers, arrangement: s.arrangement });
  }
  function faanName(key) {
    var k = "faan" + key.charAt(0).toUpperCase() + key.slice(1);
    return S[k] || key;
  }

  /* ── scoring guide (handover-style overlay on the board tile) ───
     The quiet Scoring pill's popup: every faan pattern with its value
     and a one-line blurb, the limit hands, and the payment rules, in
     sections that START COLLAPSED (open state rides ui.guideSecOpen).
     LIVE MARKS: `you.handValue` (transport-computed — scoreProgress
     mid-hand, full scoreHand once the drawn hand completes) lights the
     rows the viewer already holds and sums per-section chips on the
     collapsed headers, so "where are my points from" reads without
     expanding. Faan values restate the engine's contract
     (scoreDecomposition); the intro reads the live table settings.
     Anti-jitter: no entrance animation, instant (transition-free)
     expand/collapse. The guide is the VIEWER's, not the table's: it lives
     in its own layer over the board ([data-mj-guide], a bento sibling),
     and a broadcast rebuilds it only when what it shows changed (the live
     marks, the table's minimum and cap). Rebuilt with the board on every
     message, as it was before 2026-10-27, a click on a section or on
     Scoring itself was lost whenever a bot moved between press and
     release: the button pressed was gone. The Scoring pill is one node
     kept across renders for the same reason. */
  var GUIDE_SECTIONS = [
    { head: "guideSecShape", items: [["allChows", "1"], ["allPungs", "3"], ["sevenPairs", "4"], ["halfFlush", "3"], ["fullFlush", "7"]] },
    { head: "guideSecWinds", items: [["dragonPung", "1"], ["smallDragons", "+3"], ["seatWind", "1"], ["prevWind", "1"], ["smallWinds", "+3"]] },
    { head: "guideSecWon", note: "guideWonNote",
      items: [["selfDraw", "1"], ["concealed", "1"], ["robbingKong", "1"], ["kongReplacement", "1"], ["lastTileDraw", "1"], ["lastTileDiscard", "1"]] },
    { head: "guideSecFlowers", items: [["noFlowers", "1"], ["seatFlower", "1"], ["flowerQuad", "+2"]] }
  ];
  var GUIDE_LIMITS = ["thirteenOrphans", "heavenly", "earthly", "allHonors", "greatDragons", "greatWinds", "allKongs", "nineGates"];
  function guideDesc(key) {
    var k = "guideDesc" + key.charAt(0).toUpperCase() + key.slice(1);
    return S[k] || "";
  }
  function openGuide() { ui.guideOpen = true; renderGuide(); }
  function closeGuide() {
    if (!ui.guideOpen) return;
    ui.guideOpen = false; ui.guideScroll = 0; ui.guideSecOpen = {};
    renderGuide();
  }
  GUIDE.addEventListener("click", function (e) { if (e.target === GUIDE) closeGuide(); });
  var guideKey = null;   // what the open guide shows; a broadcast that leaves it alone skips the rebuild
  var guidePill = null;  // the Scoring pill, one node across renders
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeGuide(); });
  // base chip value of a faan total under this table's cap (2^faan)
  function chipBase(faan) { return Math.pow(2, Math.min(faan, model.settings.capFaan)); }
  // handValue parts → one entry per pattern key, duplicates aggregated
  function partsByKey(parts) {
    var byKey = {}, order = [];
    (parts || []).forEach(function (x) {
      if (!byKey[x.key]) { byKey[x.key] = { key: x.key, count: 0, faan: 0 }; order.push(byKey[x.key]); }
      byKey[x.key].count++; byKey[x.key].faan += x.faan;
    });
    return order;
  }
  function guideRow(held, key, valLabel) {
    var h = held[key];
    var row = el("div", "mj-guide__row" + (h ? " is-held" : ""));
    row.appendChild(el("span", "mj-guide__check", "✓"));
    var nm = faanName(key) + (h && h.count > 1 ? " ×" + h.count : "");
    row.appendChild(el("span", "mj-guide__name", nm));
    row.appendChild(el("span", "mj-guide__desc", guideDesc(key)));
    if (valLabel || h) row.appendChild(el("span", "mj-guide__badge" + (h ? " is-held" : ""), h ? "+" + h.faan : valLabel));
    return row;
  }
  // a collapsed-by-default section: header button + rows; a held-sum
  // chip on the header keeps live points visible while collapsed
  function guideSection(body, id, labelNode, heldFaan, fill) {
    var open = !!ui.guideSecOpen[id];
    var btn = el("button", "mj-guide__sec" + (open ? " is-open" : ""));
    btn.type = "button";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.appendChild(el("span", "mj-guide__caret"));
    btn.appendChild(labelNode);
    if (heldFaan > 0) btn.appendChild(el("span", "mj-guide__heldchip", "+" + heldFaan));
    btn.addEventListener("click", function () {
      ui.guideSecOpen[id] = !open;
      renderGuide();
    });
    body.appendChild(btn);
    if (open) fill();
  }
  function renderGuide() {
    if (!ui.guideOpen || !model || !model.settings) {
      GUIDE.hidden = true; GUIDE.textContent = ""; guideKey = null;
      return;
    }
    var key = JSON.stringify([model.you && model.you.handValue, model.settings.minFaan,
      model.settings.capFaan, ui.guideSecOpen]);
    if (key === guideKey) return;
    guideKey = key;
    GUIDE.textContent = "";
    GUIDE.hidden = false;
    var wrap = GUIDE;
    var panel = el("div", "mj-guide__panel");
    var head = el("div", "mj-guide__head");
    head.appendChild(el("h3", "mj-guide__title", S.guideTitle));
    var x = el("button", "mj-guide__close", "✕");
    x.type = "button";
    x.setAttribute("aria-label", S.guideCloseAria);
    x.addEventListener("click", closeGuide);
    head.appendChild(x);
    panel.appendChild(head);
    var body = el("div", "mj-guide__body");
    body.appendChild(el("p", "mj-guide__intro",
      fmt(S.guideIntro, { min: model.settings.minFaan, cap: model.settings.capFaan })));
    // live bar + held map: only when the table deals me a handValue
    var hv = model.you && model.you.handValue;
    var held = {};
    if (hv) {
      partsByKey(hv.parts).forEach(function (r) { held[r.key] = r; });
      var live = el("div", "mj-guide__live");
      var lh = el("div", "mj-guide__livehead");
      lh.appendChild(el("span", "mj-guide__livetitle", S.guideLiveTitle));
      lh.appendChild(el("span", "mj-guide__livefaan", fmt(S.faanTotal, { n: hv.faan })));
      live.appendChild(lh);
      var note = S.guideLiveNote;
      if (hv.complete) {
        note = hv.faan >= model.settings.minFaan
          ? fmt(S.guideLivePays, { n: chipBase(hv.faan) })
          : fmt(S.nearWinLine, { n: hv.faan, min: model.settings.minFaan });
      }
      live.appendChild(el("p", "mj-guide__livenote", note));
      body.appendChild(live);
    }
    function heldSum(keys) {
      var n = 0;
      keys.forEach(function (k) { if (held[k]) n += held[k].faan; });
      return n;
    }
    GUIDE_SECTIONS.forEach(function (sec) {
      var keys = sec.items.map(function (it) { return it[0]; });
      guideSection(body, sec.head, el("span", "mj-guide__seclabel", S[sec.head]), heldSum(keys), function () {
        sec.items.forEach(function (it) { body.appendChild(guideRow(held, it[0], it[1])); });
        if (sec.note) body.appendChild(el("p", "mj-guide__note", S[sec.note]));
      });
    });
    var llabel = el("span", "mj-guide__seclabel");
    llabel.appendChild(document.createTextNode(S.guideSecLimit + " "));
    llabel.appendChild(el("span", "mj-guide__limitbadge", fmt(S.guideLimitBadge, { n: model.settings.capFaan })));
    guideSection(body, "limits", llabel, heldSum(GUIDE_LIMITS), function () {
      GUIDE_LIMITS.forEach(function (key) { body.appendChild(guideRow(held, key, null)); });
    });
    guideSection(body, "pay", el("span", "mj-guide__seclabel", S.guideSecPay), 0, function () {
      [[S.guidePayBase, S.guidePayBaseVal], [S.guidePayDiscard, S.guidePayDiscardVal], [S.guidePaySelf, S.guidePaySelfVal]]
        .forEach(function (p2) {
          var row = el("div", "mj-guide__payrow");
          row.appendChild(el("span", "mj-guide__payk", p2[0]));
          row.appendChild(el("span", "mj-guide__payv", p2[1]));
          body.appendChild(row);
        });
    });
    panel.appendChild(body);
    wrap.appendChild(panel);
    // scroll position survives a rebuild (a live mark changed, a section toggled)
    body.scrollTop = ui.guideScroll;
    body.addEventListener("scroll", function () { ui.guideScroll = body.scrollTop; });
  }

  /* ── game over ────────────────────────────────────────────────── */
  /* A panel's entrance (mj-overin) plays once per panel. Every resize step
     and every broadcast rebuilds the board, and replaying a fade on each
     made the hand-over panel flicker while a window was dragged. */
  var enteredKey = null;
  function enterOnce(node, id) {
    var key = JSON.stringify(id);
    if (key === enteredKey) return;
    enteredKey = key;
    node.classList.add("is-entering");
  }
  function renderOver() {
    var o = model.over || {};
    var wrap = el("div", "mj-over");
    enterOnce(wrap, ["over", model.code, o.hands, o.scores]);
    var head = el("div", "mj-over__head");
    head.appendChild(el("h2", "mj-over__title", S.gameOver));
    head.appendChild(el("span", "mj-over__turns", fmt(S.handCount, { n: o.hands || 0 })));
    wrap.appendChild(head);

    var sup = el("div", "mj-over__supers");
    var stats = o.stats || [];
    sup.appendChild(superCard("wins", S.superMostWins, stats, function (s) { return s.wins; }));
    sup.appendChild(superCard("faan", S.superBestHand, stats, function (s) { return s.bestFaan; }));
    sup.appendChild(superCard("kongs", S.superMostKongs, stats, function (s) { return s.kongs; }));
    sup.appendChild(superCard("dealins", S.superMostDealIns, stats, function (s) { return s.dealIns; }));
    wrap.appendChild(sup);

    var table = el("div", "mj-over__reveal");
    // standings ride the view from Engine.standings (docs/stats.md) — the
    // client does not decide a finish. The score sort remains the fallback so
    // a table on an older worker still reveals in order.
    var rows = (o.standings || []).length
      ? o.standings.slice()
      : (o.scores || []).map(function (score, seat) { return { seat: seat, score: score, rank: null, tied: false }; })
          .sort(function (a, b) { return b.score - a.score; });
    rows.forEach(function (r) {
      var row = el("div", "mj-over__row" + (r.seat === o.winner ? " is-winner" : ""));
      row.appendChild(seatDot(r.seat));
      row.appendChild(el("span", "mj-over__name", seatName(r.seat)));
      if (r.rank != null) row.appendChild(el("span", "mj-over__place", placeLabel(r.rank, r.tied)));
      row.appendChild(el("span", "mj-over__vp", fmt(S.scoreShort, { n: r.score })));
      table.appendChild(row);
    });
    wrap.appendChild(table);

    if (model.host) {
      var rb = el("button", "tb-pill mj-over__rematch"); rb.type = "button";
      rb.appendChild(el("span", "tb-pill__label", S.rematchButton));
      // host rematch: the table drops back to the lobby settings (seats,
      // colors, and bots persist) and Start deals a fresh match
      rb.addEventListener("click", function () { send({ type: "rematch" }); });
      wrap.appendChild(rb);
    }
    BIG.appendChild(wrap);
  }
  // "1st" / "T-3rd" — a shared rank is marked rather than silently making two
  // seats look like they finished apart
  function placeLabel(rank, tied) {
    var base = S.ordinals[rank - 1] || String(rank);
    return tied ? fmt(S.placeTied, { place: base }) : base;
  }
  function superCard(key, label, seats, valueFn) {
    var ranked = (seats || []).map(function (s, i) { return { seat: i, value: valueFn(s) }; })
      .sort(function (a, b) { return b.value - a.value; });
    var c = el("button", "mj-super"); c.type = "button";
    c.appendChild(el("span", "mj-super__label", label));
    var v = el("span", "mj-super__who");
    if (!ranked.length || ranked[0].value <= 0) { v.textContent = S.statHidden; c.appendChild(v); return c; }
    var top = ranked[0];
    v.appendChild(seatDot(top.seat));
    v.appendChild(el("span", "mj-super__name", seatName(top.seat)));
    v.appendChild(el("span", "mj-super__val", fmt(S.superValue, { n: top.value })));
    v.appendChild(el("span", "mj-super__caret"));
    c.appendChild(v);
    var more = el("div", "mj-super__more");
    var inner = el("div", "mj-super__more-inner");
    var list = el("div", "mj-super__rank-list");
    ranked.slice(1).forEach(function (r) {
      var row = el("div", "mj-super__rank");
      row.appendChild(seatDot(r.seat));
      row.appendChild(el("span", "mj-super__name", seatName(r.seat)));
      row.appendChild(el("span", "mj-super__val", fmt(S.superValue, { n: r.value })));
      list.appendChild(row);
    });
    inner.appendChild(list); more.appendChild(inner); c.appendChild(more);
    c.setAttribute("aria-expanded", ui.overExpanded[key] ? "true" : "false");
    c.addEventListener("click", function () {
      var open = c.getAttribute("aria-expanded") !== "true";
      c.setAttribute("aria-expanded", open ? "true" : "false");
      ui.overExpanded[key] = open;
    });
    return c;
  }

  /* ── DICE tile (cities' tumble, verbatim idiom) ───────────────── */
  function dieFace(v) { return el("div", "mj-die", v != null ? String(v) : "–"); }
  function renderDice() {
    if (tumbleHandle) { clearInterval(tumbleHandle); tumbleHandle = null; }
    DICE.textContent = "";
    var d = lastDice ? lastDice.d : null;
    var spinning = Date.now() < spinUntil;
    var settled = !spinning && spinUntil > 0 && Date.now() - spinUntil < 500;
    var timed = model.settings && model.settings.timerSec > 0;
    var row = el("div", "mj-dice__faces" + (spinning ? " is-spinning" : settled ? " is-settled" : "") + (timed ? " mj-dice__faces--timed" : ""));
    var dice = el("div", "mj-dice__dice");
    var count = spinning ? spinDice : d ? d.length : 2;
    var rnd = function () { return 1 + Math.floor(Math.random() * 6); };
    for (var i = 0; i < count; i++) dice.appendChild(dieFace(spinning ? rnd() : d ? d[i] : null));
    if (spinning) {
      tumbleHandle = setInterval(function () {
        if (Date.now() >= spinUntil) { clearInterval(tumbleHandle); tumbleHandle = null; return; }
        dice.textContent = "";
        for (var j = 0; j < count; j++) dice.appendChild(dieFace(rnd()));
      }, 70);
    }
    row.appendChild(dice);
    if (timed) { var timer = el("div", "mj-timer"); row.appendChild(timer); TBL.timerText(timer); }
    DICE.appendChild(row);
    var caption = "";
    if (lastDice && !spinning) {
      var sum = lastDice.d.reduce(function (a, x) { return a + x; }, 0);
      caption = lastDice.d.length === 3
        ? fmt(S.breakRolled, { name: seatName(lastDice.seat), sum: sum })
        : fmt(S.seatingRolled, { name: seatName(lastDice.seat), sum: sum });
    }
    DICE.appendChild(el("p", "mj-dice__cap", caption));
    if (spinning) setTimeout(function () { if (Date.now() >= spinUntil) renderDice(); }, spinUntil - Date.now() + 20);
  }
  /* The turn timer — both readouts — belongs to the shell now
     (games/table.js, "Turn timer"): TBL.timerRing(seat) for an active
     seat's dot, TBL.timerText(node) for the clock text. The DO owns the
     clock; mahjong only decides whether to arm it (settings.timerSec)
     and where the readouts hang. The shell keeps each ring's tick handle
     on its own node, which matters here: a claim window waits on several
     seats at once, so several rings run simultaneously. */

  /* ── PLAYERS tile (strips + timer ring on the active seats) ───── */
  function renderPlayers() {
    var st = PLAYERS.scrollTop;
    PLAYERS.textContent = "";
    var active = activeSeats();
    var timed = model.settings && model.settings.timerSec > 0;
    (model.seats || []).forEach(function (s, i) {
      if (s.empty) return;
      var isActive = active.indexOf(i) >= 0 && model.phase !== "lobby";
      var strip = el("div", "mj-pstrip" + (isActive ? " is-active" : "") + (!s.connected ? " is-away" : ""));
      strip.dataset.seat = i;
      TBL.seatAccent(strip, i);
      var body = el("div", "mj-pstrip__body");
      var head = el("div", "mj-pstrip__head");
      head.appendChild(isActive && timed && model.turnEndsAt ? TBL.timerRing(i) : seatDot(i));
      var nm = (s.bot || s.phantom) ? fmt(S.botSeatTag, { name: seatName(i) }) : seatName(i);
      head.appendChild(el("span", "mj-pstrip__name", nm + (i === mySeat() ? " ·" : "")));
      var pck = chickBadge(i); if (pck) head.appendChild(pck);
      body.appendChild(head);
      // wind + dealer tag row (ghosted pre-game so Start doesn't reflow)
      var tags = el("div", "mj-pstrip__tags");
      var w = model.phase !== "lobby" && model.order ? seatWind(i) : null;
      var wtag = el("span", "mj-pstrip__tag" + (w === 0 ? " is-held" : "") + (w == null ? " is-ghost" : ""),
        w != null ? windLabel(w) + (w === 0 ? " · " + S.dealerTag : "") : windLabel(0));
      tags.appendChild(wtag);
      body.appendChild(tags);
      strip.appendChild(body);
      var stat = el("div", "mj-pstrip__stat" + (model.players ? "" : " is-ghost"));
      var p = model.players && model.players[i];
      stat.appendChild(el("span", "mj-pstrip__vp", fmt(S.scoreShort, { n: p ? p.score : 0 })));
      stat.appendChild(el("span", "mj-pstrip__cards", fmt(S.tilesShort, { n: p ? shownCount(i) : 0 })));
      strip.appendChild(stat);
      PLAYERS.appendChild(strip);
    });
    PLAYERS.scrollTop = st;
    var turnSeat = active.length === 1 ? active[0] : null;
    if (turnSeat !== lastActor) {
      lastActor = turnSeat;
      var act = PLAYERS.querySelector(".mj-pstrip.is-active");
      if (act) {
        var top = act.offsetTop, bot = top + act.offsetHeight;
        if (top < PLAYERS.scrollTop) PLAYERS.scrollTop = top;
        else if (bot > PLAYERS.scrollTop + PLAYERS.clientHeight) PLAYERS.scrollTop = bot - PLAYERS.clientHeight;
      }
    }
  }

  /* ── LOG tile ─────────────────────────────────────────────────── */
  function renderLog() {
    LOG.textContent = "";
    var list = el("div", "mj-log__list");
    shownLines().forEach(function (entry) { list.appendChild(logLineEl(entry)); });
    LOG.appendChild(list);
    list.scrollTop = list.scrollHeight;
    requestAnimationFrame(function () { list.scrollTop = list.scrollHeight; });
  }
  // a discard's, flower's or claim's line waits for its tile to land
  function shownLines() {
    return logLines.filter(function (entry) { return !(entry.hold && entry.hold.pending); }).slice(-50);
  }
  function logLineEl(entry) {
    if (entry.divider) return el("div", "mj-log__turn", entry.divider);
    var line = el("div", "mj-log__line");
    entry.parts.forEach(function (p) {
      if (typeof p === "string") { line.appendChild(document.createTextNode(p)); return; }
      var s = el("span", "mj-log__tile", tileName(p.tile));
      var c = p.tile.charAt(0);
      var ink = HONOR_GLYPH[p.tile] ? (c === "d" ? p.tile : "wind") : (c === "f" || c === "g" ? "flower" : c);
      s.classList.add("mj-log__tile--" + ink);
      line.appendChild(s);
    });
    return line;
  }

  /* ── CLAIM window ───────────────────────────────────────────────
     Centered over the felt (top-aligned when narrow). The window asks in
     tiers, win/pung/kong, then the chow seat (engine claimTier), and
     waits on them with no clock. An asked seat sees its options at once;
     everyone else sees who's still deciding only after CLAIM_REVEAL_MS, so
     a quick pass names nobody (his calls, 2026-10-27). The eye in the
     panel's corner fades it while held, to read the tiles beneath. */
  var CLAIM_REVEAL_MS = 5000;
  var claimSeen = { key: null, at: 0, timer: 0 };
  function claimRevealed() {
    var cl = model.claims;
    if (!cl) return false;
    var key = cl.from + ":" + cl.tile + ":" + cl.tier + ":" + (model.pond ? model.pond.length : 0);
    if (key !== claimSeen.key) {
      claimSeen.key = key; claimSeen.at = Date.now();
      clearTimeout(claimSeen.timer);
      claimSeen.timer = setTimeout(render, CLAIM_REVEAL_MS);
    }
    return Date.now() - claimSeen.at >= CLAIM_REVEAL_MS;
  }

  // the eye: open while the panel shows, closed while held. Its strokes
  // follow his drawing (chat, 2026-10-27); closing swings the upper lid
  // down onto the lower one and hides the pupil.
  function eyeSvg() {
    function s(name, attrs, parent) {
      var n = document.createElementNS("http://www.w3.org/2000/svg", name);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(n);
      return n;
    }
    var svg = s("svg", { viewBox: "52 57 176 176", "aria-hidden": "true" });
    s("path", { "class": "mj-eye__lid", d: "M62 152Q140 40 218 150" }, svg);
    s("path", { "class": "mj-eye__shut", d: "M62 152Q140 196 218 150" }, svg);
    s("path", { d: "M66 155Q140 228 214 152" }, svg);
    s("ellipse", { "class": "mj-eye__pupil", cx: 145, cy: 157, rx: 24, ry: 33, transform: "rotate(12 145 157)" }, svg);
    return svg;
  }
  var claimUI = null;    // { wrap, eye, box, sig }: built once, so a hold survives broadcasts
  function claimShell() {
    if (claimUI) return claimUI;
    var wrap = el("div", "mj-claimwrap");
    var eye = el("button", "mj-eye"); eye.type = "button";
    eye.setAttribute("aria-label", S.claimPeek); eye.title = S.claimPeek;
    eye.appendChild(eyeSvg());
    function peek(on) {
      wrap.classList.toggle("is-peek", on);
      eye.setAttribute("aria-pressed", on ? "true" : "false");
    }
    eye.addEventListener("pointerdown", function (e) {
      if (e.button) return;
      e.preventDefault();
      try { eye.setPointerCapture(e.pointerId); } catch (_) {}
      peek(true);
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (t) {
      eye.addEventListener(t, function () { peek(false); });
    });
    eye.addEventListener("keydown", function (e) {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); peek(true); }
    });
    eye.addEventListener("keyup", function (e) { if (e.key === " " || e.key === "Enter") peek(false); });
    eye.addEventListener("blur", function () { peek(false); });
    eye.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    window.addEventListener("blur", function () { peek(false); });
    window.addEventListener("resize", placeClaim);
    if (window.ResizeObserver) new ResizeObserver(placeClaim).observe(BIG);   // a reflow that isn't a window resize
    BIG.addEventListener("scroll", placeClaim, { passive: true });
    wrap.appendChild(eye);
    claimUI = { wrap: wrap, eye: eye, box: null, sig: null, peek: peek };
    return claimUI;
  }
  // centre the panel on the felt's own box, not the board's; narrow, at its top
  function placeClaim() {
    if (!CLAIM || CLAIM.hidden) return;
    var felt = BIG.querySelector(".mj-felt");
    if (!felt) return;
    var c = CLAIM.getBoundingClientRect(), f = felt.getBoundingClientRect();
    CLAIM.style.setProperty("--mj-claim-x", (f.left + f.width / 2 - c.left) + "px");
    CLAIM.style.setProperty("--mj-claim-y", (f.top + f.height / 2 - c.top) + "px");
    CLAIM.style.setProperty("--mj-claim-top", Math.max(0, f.top - c.top) + "px");
  }
  function hideClaim() {
    CLAIM.hidden = true;
    if (claimUI) { claimUI.peek(false); claimUI.sig = null; }
  }
  function renderClaim() {
    if (!CLAIM) return;
    var cl = model.claims;
    var my = model.you && model.you.claims;
    // the panel opens once the discard has landed in the pond (tile flights)
    if (!cl || model.phase !== "play" || HOLD.discard) return hideClaim();
    if (!my && !(claimRevealed() && cl.waiting && cl.waiting.length)) return hideClaim();
    var ui2 = claimShell();
    if (!ui2.wrap.parentNode) CLAIM.appendChild(ui2.wrap);
    CLAIM.hidden = false;
    // rebuild only when the panel's content changes, so a bot's ack doesn't
    // restart the pulse or drop a hover
    var sig = JSON.stringify([cl.from, cl.tile, cl.robbing, my || null, my ? null : cl.waiting]);
    if (sig !== ui2.sig) {
      ui2.sig = sig;
      var box = buildClaimBox(cl, my);
      if (ui2.box) ui2.wrap.replaceChild(box, ui2.box); else ui2.wrap.insertBefore(box, ui2.eye);
      ui2.box = box;
    }
    placeClaim();
  }
  function buildClaimBox(cl, my) {
    var box = el("div", "mj-claimbox" + (my ? " is-incoming" : ""));
    var title = el("h3", "mj-claimbox__title",
      cl.robbing ? fmt(S.robTitle, { name: seatName(cl.from) }) : fmt(S.claimTitle, { name: seatName(cl.from) }));
    box.appendChild(title);
    if (cl.tile) {
      var big = el("div", "mj-claimbox__tile");
      big.appendChild(tileEl(cl.tile, ""));
      box.appendChild(big);
    }
    if (my) {
      var btns = el("div", "mj-claimbox__btns");
      function claimBtn(label, action, tiles, glow) {
        var b = el("button", "tb-pill mj-act" + (glow ? " is-glow" : ""));
        b.type = "button";
        b.appendChild(el("span", "tb-pill__label", label));
        b.addEventListener("click", function () { send({ type: "claim", action: action, tiles: tiles || null }); });
        return b;
      }
      if (my.options.indexOf("win") >= 0) btns.appendChild(claimBtn(S.claimWin, "win", null, true));
      if (my.options.indexOf("kong") >= 0) btns.appendChild(claimBtn(S.claimKong, "kong"));
      if (my.options.indexOf("pung") >= 0) btns.appendChild(claimBtn(S.claimPung, "pung"));
      if (my.options.indexOf("chow") >= 0) {
        if (my.chows.length === 1) btns.appendChild(claimBtn(S.claimChow, "chow", my.chows[0]));
        else {
          box.appendChild(el("p", "mj-claimbox__lbl", S.chowPick));
          var crow = el("div", "mj-claimbox__chows");
          my.chows.forEach(function (pair) {
            var cb = el("button", "mj-claimbox__chow"); cb.type = "button";
            cb.appendChild(tileEl(pair[0], "mini"));
            cb.appendChild(tileEl(pair[1], "mini"));
            cb.addEventListener("click", function () { send({ type: "claim", action: "chow", tiles: pair }); });
            crow.appendChild(cb);
          });
          box.appendChild(crow);
        }
      }
      btns.appendChild(claimBtn(S.pillPass, "pass"));
      box.appendChild(btns);
    } else {
      box.appendChild(el("p", "mj-claimbox__lbl", S.claimWaiting));
      var waitRow = el("div", "mj-claimbox__waits");
      (cl.waiting || []).forEach(function (s) {
        var chip = el("span", "mj-claimbox__wait");
        chip.appendChild(seatDot(s));
        chip.appendChild(el("span", null, seatName(s)));
        waitRow.appendChild(chip);
      });
      box.appendChild(waitRow);
    }
    return box;
  }

  /* ── ROLE tile: my rack + action pills ────────────────────────── */
  function myTurnToDiscard() {
    return model.phase === "play" && model.turn && model.turn.seat === mySeat() &&
           !model.claims && !model.handOver && !model.needBreak;
  }
  /* Below 64rem (the stacked bento) the rack merges into MY seat zone on
     the board instead of its own tile under it: one "you" section, no
     duplicate name strip. Only while the board is up — seating's Roll and
     the lobby keep the role tile. */
  var MERGE_MQ = window.matchMedia("(max-width: 64rem)");
  MERGE_MQ.addEventListener("change", function () { if (model) render(); });
  function mergedZone() {
    if (!MERGE_MQ.matches || mySeat() == null) return null;
    return BIG.querySelector('.mj-zone[data-zone="' + mySeat() + '"]');
  }
  function rackRow() { return document.querySelector(".mj [data-rack]"); }
  function renderRole() {
    ROLE.textContent = "";
    var seat = mySeat();
    var zone = mergedZone();
    // the seating roll has no hand yet: Roll lives on my pad (renderSeating)
    ROLE.hidden = !!zone || model.phase === "seating";
    if (model.phase === "seating") return;
    if (seat == null) { ROLE.appendChild(el("p", "mj-role__note", S.spectatingNote)); return; }
    var play = el("div", "mj-play");
    var rack = el("div", "mj-rack");
    var head = el("div", "mj-rack__head");
    head.appendChild(el("h3", "mj-rack__title", S.handTitle));
    var canDiscard = myTurnToDiscard();
    var manual = !ui.autoArrange;   // manual = drag to arrange, drag out to discard
    // Every phase's prompt rides the right end of the title line (one font,
    // mj-role__note), just left of the controls divider — it's appended to
    // `head` from the phase branches below, beside the "your hand" title. The
    // near-win hint (a structural win sitting under the table's faan minimum)
    // is the exception: it keeps its own quiet styling and stands in for the
    // discard prompt when present.
    var nw = canDiscard && model.you && model.you.nearWin;
    function headNote(text) { head.appendChild(el("span", "mj-role__note", text)); }
    rack.appendChild(head);
    // Auto-Arrange on → the engine-sorted hand, tap a tile to discard (default).
    // Off → my own arrangement (ui.handOrder, reconciled each render as tiles
    // come and go); drag to reorder, drag a tile up out of the strip to discard.
    var row = el("div", "mj-rack__tiles" + (canDiscard && !manual ? " is-live" : "") + (manual ? " is-manual" : ""));
    row.setAttribute("data-rack", "");
    var hand = (model.you && model.you.hand) || [];
    var order = manual ? reconcileOrder(hand) : hand;
    ui.handOrder = manual ? order : null;
    order.forEach(function (t) { row.appendChild(rackTile(t, { tap: canDiscard && !manual, drag: manual, isDrawn: false })); });
    if (model.you && model.you.drawn != null) {
      var dt = rackTile(model.you.drawn, { tap: canDiscard && !manual, drag: manual, isDrawn: true });
      // still in flight from the wall: its slot waits, already tappable
      if (HOLD.drawn) pending(dt, HOLD.drawn);
      row.appendChild(dt);
    }
    rack.appendChild(row);

    // my melds + flowers under the hand — the row is ALWAYS present (its CSS
    // reserves one mini-tile row) so the rack doesn't grow when the first
    // flower or meld of the hand lands
    var mrow = el("div", "mj-rack__melds");
    if (model.players && model.players[seat]) appendMeldsFlowers(mrow, seat, null);
    rack.appendChild(mrow);

    // Auto-Arrange toggle, bottom-right of the hand section — only while there's
    // a hand to arrange (in play, before the settlement reveal).
    if (model.phase === "play" && !model.handOver && model.you && model.you.hand) {
      var foot = el("div", "mj-rack__foot");
      foot.appendChild(arrangeToggle());
      rack.appendChild(foot);
    }
    play.appendChild(rack);

    // controls column: action pills only — the prompt rode off to the title
    // line above, so on your turn the pills sit level with the title row.
    var ctrl = el("div", "mj-play__ctrl");
    if (model.needBreak) {
      // the break's Roll lives in the middle of the felt (renderFelt)
    } else if (model.phase === "play" && !model.handOver) {
      // every prompt for this phase rides the title line beside "your hand":
      // near-win keeps its quiet hint styling and stands in for the discard
      // prompt, the rest share the mj-role__note font.
      if (nw) {
        var hint = el("span", "mj-rack__hint", fmt(S.nearWinLine, { n: nw.faan, min: nw.need }));
        hint.title = fmt(S.nearWinLine, { n: nw.faan, min: nw.need });
        head.appendChild(hint);
      } else if (canDiscard) headNote(manual ? S.discardHintManual : S.discardHint);
      else if (model.claims) { if (claimRevealed()) headNote(S.claimWaiting); }   // quiet until the reveal
      else if (model.turn) headNote(fmt(S.drawWaiting, { name: seatName(model.turn.seat) }));
      var pills = [];
      var canWin = canDiscard && model.you && model.you.canWin;
      var winP = actionPill(S.pillWin, !!canWin, function () { send({ type: "win" }); });
      if (canWin) winP.classList.add("is-glow");
      else if (canDiscard && model.you && model.you.nearWin) {
        winP.title = fmt(S.nearWinLine, { n: model.you.nearWin.faan, min: model.you.nearWin.need });
      }
      // Kong only shows while one is declarable (his call, 2026-10-25): it's
      // rare, and a standing disabled pill crowded the narrow rack
      var kongs = (canDiscard && model.you && model.you.kongs) || [];
      if (kongs.length) {
        pills.push(actionPill(S.pillKong, true, function () {
          if (kongs.length === 1) { send({ type: "kong", tile: kongs[0] }); ui.kongPick = false; }
          else { ui.kongPick = !ui.kongPick; render(); }
        }, ui.kongPick));
      }
      if (pills.length) ctrl.appendChild(wrapPills(pills));
      if (ui.kongPick && kongs.length > 1) {
        var krow = el("div", "mj-kongpick");
        krow.appendChild(el("p", "mj-claimbox__lbl", S.kongPick));
        kongs.forEach(function (t) {
          var kb = el("button", "mj-claimbox__chow"); kb.type = "button";
          kb.appendChild(tileEl(t, "mini"));
          kb.addEventListener("click", function () { ui.kongPick = false; send({ type: "kong", tile: t }); });
          krow.appendChild(kb);
        });
        ctrl.appendChild(krow);
      }
      if (!canDiscard) ui.kongPick = false;
      // Mahjong! and the quiet Scoring share one split button at the
      // column's bottom right (his call, 2026-10-25): Mahjong! greys out
      // until a win is on and glows alone when it is; Scoring opens the guide
      if (!guidePill) {
        guidePill = actionPill(S.pillGuide, true, openGuide);
        guidePill.classList.add("mj-act--quiet");
      }
      var guideP = guidePill;
      var split = el("div", "mj-split");
      split.appendChild(winP);
      split.appendChild(guideP);
      ctrl.appendChild(split);
    }
    play.appendChild(ctrl);
    if (zone) {
      // the prompt rides the zone's name line, just left of the wind chip
      zone.classList.add("has-rack");
      var zh = zone.querySelector(".mj-zone__head");
      zh.insertBefore(head, zh.querySelector(".mj-zone__wind"));
      zone.appendChild(play);
    } else ROLE.appendChild(play);
  }
  function wrapPills(list) {
    var w = el("div", "mj-actions");
    list.forEach(function (b) { w.appendChild(b); });
    return w;
  }
  function actionPill(label, enabled, onClick, active) {
    var b = el("button", "tb-pill mj-act" + (active ? " is-active" : "")); b.type = "button";
    b.appendChild(el("span", "tb-pill__label", label));
    b.disabled = !enabled;
    if (enabled) b.addEventListener("click", onClick);
    return b;
  }
  function rackTile(t, o) {
    var b = el("button", "mj-racktile"); b.type = "button";
    if (o.isDrawn) b.classList.add("mj-racktile--drawn");
    b.appendChild(tileEl(t, ""));
    b.title = tileName(t);
    b.disabled = !(o.tap || o.drag);
    if (o.tap) b.addEventListener("click", function () {
      b.classList.add("is-lifting");   // rises at once; the flight takes it from here
      send({ type: "discard", tile: t });
    });
    if (o.drag) attachTileDrag(b, t, o.isDrawn);
    return b;
  }

  /* ── manual-arrange order (Auto-Arrange off) ──────────────────────
     ui.handOrder is a persistent SEQUENCE of tile ids — my chosen order.
     Tiles are fungible strings with duplicates, so it's reconciled by
     MULTISET each render: keep the ids I still hold in the order I put
     them, drop any I no longer hold, and drop in freshly gained tiles
     (a kept draw, a post-kong reshuffle) at their canonical sorted spot.
     Never leaves the client — arrangement is mine, and the hand is hidden
     info (docs/mahjong.md). */
  function countsOf(list) { var c = {}; list.forEach(function (t) { c[t] = (c[t] || 0) + 1; }); return c; }
  function insertSorted(out, t) {
    for (var i = 0; i < out.length; i++) if (out[i] > t) { out.splice(i, 0, t); return; }
    out.push(t);
  }
  function reconcileOrder(hand) {
    var want = countsOf(hand), prev = ui.handOrder || [], used = {}, out = [];
    prev.forEach(function (t) {
      if ((used[t] || 0) < (want[t] || 0)) { out.push(t); used[t] = (used[t] || 0) + 1; }
    });
    Object.keys(want).forEach(function (t) {
      for (var k = used[t] || 0; k < want[t]; k++) insertSorted(out, t);
    });
    return out;
  }

  /* ── tile drag (manual mode): reorder within the strip, or up-and-out
     to discard. Pointer Events (mouse + touch, no deps). Renders are
     suppressed for the drag's duration (dragActive) so the strip is
     stable under the pointer; the drop applies to ui.handOrder (reorder)
     or fires a discard, then re-renders. The drawn tile drags only to
     discard — it isn't part of the arranged hand. */
  function attachTileDrag(btn, tile, isDrawn) {
    btn.addEventListener("pointerdown", function (ev) {
      if (ev.button != null && ev.button !== 0) return;
      ev.preventDefault();
      var row = rackRow();
      if (!row) return;
      var felt = document.querySelector("[data-mj-center]");
      var canDiscard = myTurnToDiscard();
      var pid = ev.pointerId, startX = ev.clientX, startY = ev.clientY;
      var engaged = false, ghost = null, gap = null, discardArm = false, dropIndex = null;
      // handOrder tiles present in the strip, minus the one being dragged
      function others() {
        return Array.prototype.filter.call(row.querySelectorAll(".mj-racktile"), function (n) {
          return n !== btn && !n.classList.contains("mj-racktile--drawn");
        });
      }
      function engage() {
        engaged = true; dragActive = true;
        var r = btn.getBoundingClientRect();
        ghost = btn.cloneNode(true);
        ghost.className = "mj-racktile mj-racktile--ghost" + (isDrawn ? " mj-racktile--drawn" : "");
        ghost.style.cssText = "position:fixed;margin:0;pointer-events:none;width:" +
          r.width + "px;height:" + r.height + "px;left:" + r.left + "px;top:" + r.top + "px;";
        ghost._dx = startX - r.left; ghost._dy = startY - r.top;
        document.body.appendChild(ghost);
        if (!isDrawn) { gap = el("div", "mj-rack__gap"); gap.style.width = r.width + "px"; gap.style.height = r.height + "px"; }
        btn.style.display = "none";   // the gap stands in for the moved tile
      }
      function update(x, y) {
        ghost.style.left = (x - ghost._dx) + "px";
        ghost.style.top = (y - ghost._dy) + "px";
        var rr = row.getBoundingClientRect();
        discardArm = canDiscard && y < rr.top - 6;   // lifted up out of the strip, toward the board
        ghost.classList.toggle("is-discard", discardArm);
        if (felt) felt.classList.toggle("is-discardarm", discardArm);
        if (isDrawn) { dropIndex = null; if (gap && gap.parentNode) gap.parentNode.removeChild(gap); return; }
        if (discardArm) { dropIndex = null; if (gap.parentNode) gap.parentNode.removeChild(gap); return; }
        var list = others(), idx = list.length;
        for (var i = 0; i < list.length; i++) {
          var b = list[i].getBoundingClientRect();
          if (x < b.left + b.width / 2) { idx = i; break; }
        }
        dropIndex = idx;
        var drawnEl = row.querySelector(".mj-racktile--drawn");
        if (idx >= list.length) { if (drawnEl) row.insertBefore(gap, drawnEl); else row.appendChild(gap); }
        else row.insertBefore(gap, list[idx]);
      }
      function cleanup() {
        document.removeEventListener("pointermove", onMove, true);
        document.removeEventListener("pointerup", onUp, true);
        document.removeEventListener("pointercancel", onUp, true);
        if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
        if (gap && gap.parentNode) gap.parentNode.removeChild(gap);
        if (felt) felt.classList.remove("is-discardarm");
        btn.style.display = "";
      }
      function onMove(e) {
        if (e.pointerId !== pid) return;
        if (!engaged) { if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 5) return; engage(); }
        update(e.clientX, e.clientY);
      }
      function onUp(e) {
        if (e.pointerId !== pid) return;
        var wasEngaged = engaged, doDiscard = discardArm, idx = dropIndex;
        // btn is still in the DOM (display:none) at its original slot, so its
        // index among hand tiles is the authoritative source index (duplicates)
        var srcIdx = wasEngaged && !isDrawn ? Array.prototype.filter.call(
          row.querySelectorAll(".mj-racktile"),
          function (n) { return !n.classList.contains("mj-racktile--drawn"); }).indexOf(btn) : -1;
        // a tile dropped on the felt flies on from where it was let go
        if (doDiscard) TQ.dropAt = { t: Date.now(), end: endOf(ghost, true) };
        dragActive = false;
        cleanup();
        if (!wasEngaged) return;                              // never crossed the threshold — a no-op tap
        if (doDiscard) { send({ type: "discard", tile: tile }); return; }
        if (!isDrawn && idx != null && ui.handOrder) {
          var arr = ui.handOrder.slice(), from = arr.indexOf(tile);
          if (srcIdx >= 0) from = srcIdx;
          if (from >= 0) { arr.splice(from, 1); arr.splice(idx, 0, tile); ui.handOrder = arr; }
        }
        render();
      }
      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("pointerup", onUp, true);
      document.addEventListener("pointercancel", onUp, true);
    });
  }

  function arrangeToggle() {
    var b = el("button", "mj-arrange" + (ui.autoArrange ? " is-on" : "")); b.type = "button";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", ui.autoArrange ? "true" : "false");
    b.title = S.arrangeTip;
    b.appendChild(el("span", "mj-arrange__label", S.arrangeLabel));
    var track = el("span", "mj-arrange__track");
    track.appendChild(el("span", "mj-arrange__thumb"));
    b.appendChild(track);
    b.addEventListener("click", function () {
      ui.autoArrange = !ui.autoArrange;
      save(ARRANGE_KEY, ui.autoArrange);
      if (ui.autoArrange) ui.handOrder = null;   // snap back to the engine sort
      render();
    });
    return b;
  }

  /* ── tile flights: the table plays one move at a time ───────────
     docs/mahjong.md, "Tile flights". A broadcast still renders the
     instant it arrives; what it MOVED is presented in order. Each
     discard, draw, flower and claimed tile becomes a step in TQ. While a
     step waits, its origin keeps the tile (a back in the hand, a stack
     on the wall, the claimed tile in the pond) and its destination keeps
     a hidden slot; the renderers read both from HOLD (tqHolds). Then the
     step lifts the tile, glides a copy of it from the tile's own
     rectangle to its slot's, sets it down, and reveals the slot on the
     frame the copy goes. Counts and log lines follow the landing. My own
     discard or claim never waits: it finishes whatever is still playing
     and goes at once. Client-only theater — the engine, the wire and the
     model never wait for it.

     The copy runs on Web Animations (transform and opacity only), so it
     stays smooth while a bot's broadcast rebuilds the board under it. A
     tile keeps its size: it lifts, rides a small hop (a scale-up for its
     height off the table, with its shadow), and settles. The settlement's
     score chips still ride the shared chip layer, pop and shrink and all
     (games/flights.js). */
  var FLY = GameFlights.create({
    section: "section.mj",
    layerClass: "mj-flylayer",
    ms: 700, spread: 160, jitter: 10,
    alive: function () { return !!model; }
  });
  var FLY_STEP = FLY.STEP;
  function stripPoint(seat) { return FLY.point(PLAYERS.querySelector('.mj-pstrip[data-seat="' + seat + '"]')) || FLY.point(PLAYERS); }
  function chipScore() { return el("span", "mj-flychip mj-flychip--score"); }
  var launchChip = FLY.launch;
  var clearFlights = FLY.clear;

  var TQ = {
    steps: [],       // steps not yet landed, in play order
    batch: [],       // this broadcast's events, until postEvents turns them into steps
    running: null,   // the step in the air
    beat: null,      // the pause after a landing, before the next step
    seq: 0,
    landed: [],      // copies whose slot is revealed; the next paint removes them
    dropAt: null,    // where a dragged discard was let go
    pondTail: null,  // the pond's newest tile (a chow's event names its low tile, not the claimed one)
    noFlip: false    // a new hand: the rack arrives with the wave, not sliding
  };
  var HOLD = tqHolds();
  var DRAW_K = [0.6, 0.7, 0.6];   // a draw's lift, glide and settle against a discard's
  function flightsOn() {
    return motionOk() && !document.hidden && !!model && model.phase === "play" && !!model.players;
  }
  function tokenPx(name) { return parseFloat(seamToken(name)) || 0; }
  function pending(node, id) { node.classList.add("is-pending"); node.setAttribute("data-step", id); }
  function release(e) { if (e._hold) e._hold.pending = false; }

  /* what the waiting and flying steps keep back from the model's picture */
  function tqHolds() {
    var me = TQ.steps.length ? mySeat() : null;
    var h = { front: 0, back: 0, pond: {}, claim: null, out: {}, into: {}, meld: {}, flower: {}, drawn: null, discard: false };
    TQ.steps.forEach(function (s) {
      var wait = s.state === "wait";
      if (s.kind === "discard") {
        h.pond[s.at] = s.id; h.discard = true;
        if (wait && s.seat !== me) h.out[s.seat] = (h.out[s.seat] || 0) + 1;
        return;
      }
      if (s.kind === "meld") {
        if (wait) h.claim = { tile: s.tile, id: s.id };
        (h.meld[s.seat] = h.meld[s.seat] || {})[s.at] = s.id;
        // the claimant's own tiles leave the hand when the meld lands
        if (s.seat !== me) h.out[s.seat] = (h.out[s.seat] || 0) + s.fromHand;
        return;
      }
      if (wait) h[s.src]++;
      if (s.kind === "flower") (h.flower[s.seat] = h.flower[s.seat] || {})[s.at] = s.id;
      else if (s.seat === me) h.drawn = s.id;
      else (h.into[s.seat] = h.into[s.seat] || []).push(s.id);
    });
    return h;
  }
  // a seat's tile count as the board shows it right now
  function shownCount(seat) {
    var n = model.players[seat].handCount + (HOLD.out[seat] || 0) - (HOLD.into[seat] || []).length;
    return seat === mySeat() && HOLD.drawn ? n - 1 : n;
  }

  /* postEvents: this broadcast's moves become steps, before the render
     that would otherwise show them all at once */
  function choreograph() {
    var evs = TQ.batch; TQ.batch = [];
    var tail = TQ.pondTail;
    var pond = (model && model.pond) || [];
    TQ.pondTail = pond.length ? pond[pond.length - 1].tile : null;
    if (!evs.length) return;
    var me = mySeat();
    var fresh = evs.some(function (e) { return /^(deal|nextHand|handOver|gameOver)$/.test(e.t); });
    if (fresh || !flightsOn()) {
      // a new hand (its wave carries it), a settlement, or no motion: as it stands
      evs.forEach(release); tqFinish(false);
      if (fresh) TQ.noFlip = true;
      return;
    }
    if (me != null && evs.some(function (e) {
      return e.seat === me && (e.t === "discard" || (e.t === "meld" && e.from != null));
    })) tqFinish(false);
    // where each piece lands: walk the model back to before this batch
    var pondN = pond.length, fl = {}, md = {};
    model.players.forEach(function (p, i) { fl[i] = p.flowers.length; md[i] = p.melds.length; });
    evs.forEach(function (e) {
      if (e.t === "discard") pondN--;
      if (e.t === "flower") fl[e.seat]--;
      if (e.t === "meld" && e.from != null) { pondN++; md[e.seat]--; }
    });
    // a turn's first draw comes off the front; a flower or a kong sends the next to the back
    var fromBack = false;
    evs.forEach(function (e) {
      var s = null;
      if (e.t === "discard") {
        s = { kind: "discard", seat: e.seat, tile: e.tile, at: pondN++ };
        if (e.seat === me) s.from = myDiscardFrom(e.tile);
        tail = e.tile;
      } else if (e.t === "draw") {
        s = { kind: "draw", seat: e.seat, src: fromBack ? "back" : "front",
              tile: e.seat === me && model.you ? model.you.drawn : null };
        fromBack = false;
      } else if (e.t === "flower") {
        s = { kind: "flower", seat: e.seat, tile: e.tile, src: fromBack ? "back" : "front", at: fl[e.seat]++ };
        fromBack = true;
      } else if (e.t === "meld") {
        if (/kong/.test(e.kind)) fromBack = true;
        if (e.from != null && tail) {
          s = { kind: "meld", seat: e.seat, tile: tail, fromHand: e.kind === "kong" ? 3 : 2,
                at: md[e.seat]++ };
          pondN--;
          tail = pondN > 0 && pond[pondN - 1] ? pond[pondN - 1].tile : null;
        }
      }
      if (!s) { release(e); return; }
      s.id = "tq" + (++TQ.seq); s.state = "wait"; s.hold = e._hold || null;
      TQ.steps.push(s);
    });
    TQ.dropAt = null;
  }
  // my discard leaves from the tile I tapped (risen already) or let go of
  function myDiscardFrom(tile) {
    if (TQ.dropAt && Date.now() - TQ.dropAt.t < 5000) return TQ.dropAt.end;
    var row = rackRow();
    if (!row) return null;
    var sel = '[data-tile="' + tile + '"]';
    var pick = row.querySelector(".mj-racktile.is-lifting " + sel) || row.querySelector(".mj-racktile--drawn " + sel);
    if (!pick) { var all = row.querySelectorAll(".mj-racktile " + sel); pick = all[all.length - 1]; }
    return endOf(pick);
  }

  /* a tile's place on screen: its centre, its upright size, its turn, and
     how far it already stands off the table. Anything lying sideways (a
     side seat's backs, a side wall's stacks) is an upright tile turned a
     quarter, so a flight can turn it on the way. */
  function endOf(node, airborne) {
    if (!node) return null;
    var t = node.classList.contains("mj-tilef") ? node : node.querySelector(".mj-tilef");
    if (!t) return null;
    var r = t.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var rot = 0, turned = t.closest(".mj-rots");
    if (turned) rot = turned.classList.contains("mj-rots--r") ? -90 : 90;
    else if (r.width > r.height) rot = t.closest(".mj-zone--right, .mj-wall__side--right") ? -90 : 90;
    var lift = 0, btn = t.closest(".mj-racktile");
    if (airborne) lift = Infinity;
    else if (btn) {
      var m = getComputedStyle(btn).transform;
      if (m && m !== "none") lift = Math.max(0, -new DOMMatrixReadOnly(m).m42);
    }
    var cs = getComputedStyle(t);
    return {
      x: r.left + r.width / 2, y: r.top + r.height / 2,
      w: rot ? r.height : r.width, h: rot ? r.width : r.height, rot: rot, lift: lift,
      back: t.classList.contains("mj-tilef--back"),
      mini: t.classList.contains("mj-tilef--mini") || t.classList.contains("mj-tilef--wall"),
      radius: cs.borderRadius, edge: cs.borderBottomWidth
    };
  }
  function tqFrom(s) {
    if (s.kind === "discard") {   // a seat's hand: the last back still showing
      var bs = BIG.querySelectorAll('.mj-zone[data-zone="' + s.seat + '"] .mj-zone__backs > .mj-tilef:not(.is-pending)');
      return endOf(bs[bs.length - 1]);
    }
    if (s.kind === "meld") return endOf(BIG.querySelector('[data-step-from="' + s.id + '"]'));
    return endOf(BIG.querySelector(s.src === "back" ? "[data-wall-back]" : "[data-wall-front]"));
  }
  function tqTo(s) {
    var n = document.querySelector('.mj [data-step="' + s.id + '"]');
    if (n && s.kind === "meld") n = n.querySelector('[data-tile="' + s.tile + '"]') || n.querySelector(".mj-tilef");
    return endOf(n);
  }

  function tqPump() {
    if (TQ.running || TQ.beat || dealing()) return;   // the deal's own timer pumps after it
    var waiting = TQ.steps.filter(function (s) { return s.state === "wait"; });
    if (!waiting.length) return;
    if (!flightsOn() || waiting.length > 8) { tqFinish(true); return; }
    // more than a turn behind (a claim chain, a tab catching up): double time
    tqRun(waiting[0], waiting.length > 2 ? 2 : 1);
  }
  function tqRun(s, rate) {
    var from = s.from || tqFrom(s), to = tqTo(s);
    if (!from || !to) { tqLand(s); return; }
    var k = s.kind === "draw" || s.kind === "flower" ? DRAW_K : [1, 1, 1];
    var m = { rise: tokenPx("--tile-rise"), drop: tokenPx("--tile-drop"), hop: tokenPx("--tile-hop") };
    // a tile already partway up (tapped, dragged) only finishes its rise
    var still = m.rise > 0 ? Math.max(0, 1 - from.lift / m.rise) : 1;
    m.L = Math.max(1, tokenMs("--tile-lift") * k[0] / rate * still);
    m.G = tokenMs("--tile-glide") * k[1] / rate;
    m.S = tokenMs("--tile-settle") * k[2] / rate;
    var c = tqCopy(from, to, s.tile);
    FLY.layer().appendChild(c.node);
    s.copy = c.node;
    s.anims = tqAnimate(c, from, to, m);
    s.state = "fly"; TQ.running = s;
    // the origin lets go as the copy rises (my discard's tile is already gone)
    if (!(s.kind === "discard" && s.seat === mySeat())) render();
    s.anims[0].finished.then(function () { if (s.state === "fly") tqLand(s); }, function () {});
    // A window Chrome has stopped rendering (covered, not "hidden") lets an
    // animation reach its end without settling its promise, which would
    // stall the queue. Timers still run there, so one checks in. A copy
    // paused on purpose (the dev driver's stepped clock) is left alone.
    (function watch() {
      s.watch = setTimeout(function () {
        if (s.state !== "fly") return;
        if (s.anims[0].playState === "finished") tqLand(s); else watch();
      }, m.L + m.G + m.S + 100);
    })();
  }
  function tqLand(s) {
    var i = TQ.steps.indexOf(s);
    if (i >= 0) TQ.steps.splice(i, 1);
    clearTimeout(s.watch);
    s.state = "done";
    if (s.hold) s.hold.pending = false;
    if (s.copy) TQ.landed.push(s.copy);
    if (TQ.running === s) TQ.running = null;
    render();   // the slot shows its tile; this paint's sweep takes the copy on the same frame
    var beat = s.kind === "discard" || s.kind === "meld" ? tokenMs("--tile-beat") : 0;
    if (beat) TQ.beat = setTimeout(function () { TQ.beat = null; tqPump(); }, beat);
    else tqPump();
  }
  // everything still waiting or flying lands now, as it stands
  function tqFinish(doRender) {
    if (TQ.beat) { clearTimeout(TQ.beat); TQ.beat = null; }
    var had = TQ.steps.length;
    TQ.steps.forEach(function (s) {
      clearTimeout(s.watch);
      s.state = "done";
      if (s.hold) s.hold.pending = false;
      if (s.copy) TQ.landed.push(s.copy);
    });
    TQ.steps = []; TQ.running = null;
    if (had && doRender) render();
  }
  function tqSweep() {
    TQ.landed.forEach(function (n) {
      n.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); });
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    TQ.landed = [];
  }
  // a hidden tab plays nothing: it shows the table as it stands
  document.addEventListener("visibilitychange", function () { if (document.hidden && TQ.steps.length) tqFinish(true); });

  /* the copy: an upright tile at the larger end's size, scaled and turned
     to fit either end. A back that becomes a face (a draw into my hand, a
     flower, another seat's discard) turns over at mid-flight. */
  function tqCopy(from, to, tile) {
    var big = from.w * from.h >= to.w * to.h ? from : to;
    var node = el("div", "mj-fly");
    node.style.width = big.w + "px"; node.style.height = big.h + "px";
    var shade = el("div", "mj-fly__shade");
    shade.style.borderRadius = big.radius;
    var hop = el("div", "mj-fly__hop");
    var card = el("div", "mj-fly__card");
    function face(n) { n.style.borderRadius = big.radius; n.style.borderBottomWidth = big.edge; card.appendChild(n); return n; }
    var size = big.mini ? "mini" : "";
    var b = from.back || !tile ? face(backEl(size)) : null;
    var f = tile ? face(tileEl(tile, size)) : null;
    hop.appendChild(card);
    node.appendChild(shade); node.appendChild(hop);
    return { node: node, shade: shade, hop: hop, card: card, back: b, face: f, W: big.w, H: big.h };
  }
  function tqAt(p, dy, W, H) {
    return "translate(" + (p.x - W / 2).toFixed(1) + "px," + (p.y - H / 2 + dy).toFixed(1) + "px) rotate(" +
      p.rot + "deg) scale(" + (p.w / W).toFixed(4) + "," + (p.h / H).toFixed(4) + ")";
  }
  function tqAnimate(c, from, to, m) {
    var T = m.L + m.G + m.S, o1 = m.L / T, o2 = (m.L + m.G) / T, mid = (o1 + o2) / 2;
    var ease = seamToken("--tile-ease") || "ease-in-out", pop = seamToken("--pop-ease") || "ease-out";
    var opt = { duration: T, fill: "forwards" };
    var up = Math.min(0, from.lift - m.rise);   // a tile already risen (tapped, dragged) rises no further
    var dist = Math.sqrt((to.x - from.x) * (to.x - from.x) + (to.y - from.y) * (to.y - from.y));
    var hop = 1 + m.hop * Math.max(0.4, Math.min(1, dist / 400));   // a short hop stays lower
    var anims = [
      c.node.animate([
        { offset: 0, transform: tqAt(from, 0, c.W, c.H), easing: pop },
        { offset: o1, transform: tqAt(from, up, c.W, c.H), easing: ease },
        { offset: o2, transform: tqAt(to, -m.drop, c.W, c.H), easing: "ease-out" },
        { offset: 1, transform: tqAt(to, 0, c.W, c.H) }
      ], opt),
      c.hop.animate([
        { offset: 0, transform: "scale(1)" },
        { offset: o1, transform: "scale(1)", easing: "ease-out" },
        { offset: mid, transform: "scale(" + hop.toFixed(3) + ")", easing: "ease-in" },
        { offset: o2, transform: "scale(1)" },
        { offset: 1, transform: "scale(1)" }
      ], opt),
      c.shade.animate([
        { offset: 0, opacity: 0, transform: "none" },
        { offset: o1, opacity: 0.8, transform: "translateY(" + (m.rise / 2) + "px)" },
        { offset: mid, opacity: 0.55, transform: "translateY(" + m.rise + "px) scale(1.04)" },
        { offset: o2, opacity: 0.7, transform: "translateY(" + m.drop + "px)" },
        { offset: 1, opacity: 0, transform: "none" }
      ], opt)
    ];
    if (c.back && c.face) {
      var f = (o2 - o1) * 0.18;
      anims.push(c.card.animate([
        { offset: 0, transform: "scaleX(1)" },
        { offset: mid - f, transform: "scaleX(1)", easing: "ease-in" },
        { offset: mid, transform: "scaleX(0.05)", easing: "ease-out" },
        { offset: mid + f, transform: "scaleX(1)" },
        { offset: 1, transform: "scaleX(1)" }
      ], opt));
      anims.push(c.face.animate([
        { offset: 0, opacity: 0 }, { offset: mid, opacity: 0 }, { offset: mid, opacity: 1 }, { offset: 1, opacity: 1 }
      ], opt));
    }
    return anims;
  }

  /* the rack slides instead of jumping: every tile that stays moves from
     where it stood to its new place (a discard's gap closing, the drawn
     tile sorting into the hand). Matched by face and order — identical
     tiles are interchangeable, so a swap between them can't be seen. */
  function snapRack() {
    var row = rackRow();
    // a wave is still raising the rack's tiles: their rects are mid-rise, not places
    if (!row || !motionOk() || STAGE.waving()) return null;
    var seen = {}, out = {};
    row.querySelectorAll(".mj-racktile").forEach(function (b) {
      var t = b.querySelector("[data-tile]");
      if (!t) return;
      var id = t.getAttribute("data-tile"), n = seen[id] = (seen[id] || 0) + 1;
      var r = b.getBoundingClientRect();
      out[id + "#" + n] = { x: r.left, y: r.top };
    });
    return out;
  }
  function flipRack(was) {
    var row = was && rackRow();
    if (!row) return;
    var seen = {}, dur = tokenMs("--tile-glide") * 0.85, ease = seamToken("--tile-ease") || "ease";
    row.querySelectorAll(".mj-racktile").forEach(function (b) {
      var t = b.querySelector("[data-tile]");
      if (!t) return;
      var id = t.getAttribute("data-tile"), n = seen[id] = (seen[id] || 0) + 1;
      var w = was[id + "#" + n];
      if (!w || b.classList.contains("is-pending")) return;
      var r = b.getBoundingClientRect(), dx = w.x - r.left, dy = w.y - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      b.animate([{ transform: "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)" }, { transform: "none" }],
        { duration: dur, easing: ease });
    });
  }
  // every event joins the batch choreograph() reads; a move that writes a
  // log line holds it back until its tile lands
  function collectFlight(e) {
    if (e.t === "discard" || e.t === "flower" || (e.t === "meld" && e.from != null)) e._hold = { pending: true };
    TQ.batch.push(e);
    if (reduceMotion()) return;
    if (e.t === "handOver" && e.summary && e.summary.result === "win") {
      (function (s) {
        FLY.push(function () {
          var i = 0;
          (s.payments || []).forEach(function (n, seat2) {
            if (!n) return;
            for (var k = 0; k < Math.min(3, Math.ceil(n / 32)) ; k++) {
              (function (ii) {
                launchChip(chipScore(), function () { return stripPoint(seat2); },
                  function () { return stripPoint(s.seat); }, ii * FLY_STEP);
              })(i++);
            }
          });
        });
      })(e.summary);
    }
  }

  /* ── letting go of ONE game: the tile caches, the rack order and any open
     tool. Both exits run it — leaving the table, and the host's rematch
     dropping the table back to the lobby ─────────────────────────── */
  function resetGameUi() {
    clearFlights();
    stopDeal(); OPEN = null;   // the opening's beats belong to the game being let go
    TQ.batch = []; tqFinish(false); tqSweep();
    lastDice = null; lastActor = null;
    ui.deckPinned = false; ui.logPinned = false; ui.kongPick = false; ui.minFaanDraft = null; ui.overExpanded = {};
    ui.handOrder = null; ui.guideOpen = false; ui.guideScroll = 0; ui.guideSecOpen = {};
    dragActive = false;
  }
  /* ── leaving: the shell drops the socket, the model and its own lobby
     state; this clears what's DeetsMahjong's alone ───────────────── */
  function onLeave() {   // the next table's first phase isn't a change
    resetGameUi(); STAGE.stop();
    paintedPhase = null; paintedHandOver = paintedBreak = false;
  }

  /* ═══ BOOT ═════════════════════════════════════════════════════ */
  TBL.boot();
})();
