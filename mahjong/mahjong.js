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
   main.css); everything else rides the themes.css / skin.css tokens. */
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
  var DESKTOP = document.querySelector("[data-mj-desktop]");

  var DECK_KEY = "deets-mahjong-deck";           // tile art: per VIEWER, never on the wire
  var ARRANGE_KEY = "deets-mahjong-autoarrange"; // "Auto-Arrange" toggle (default on)

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
    rootSel: ".mj",
    capacity: 4,
    minSeats: 4,
    startNeedsHint: S.startNeedsFour,
    errExtra: { loc: S.errLoc },
    /* fields the worker omits when absent must clear, not linger */
    clearFields: ["claims", "handOver", "handOverAt", "turnEndsAt", "seating", "breakRoll", "turn"],
    clearYouFields: ["claims", "canWin", "kongs", "drawn", "nearWin", "handValue"],
    els: {
      bar: BAR_INPUT, codePop: CODE_POP, codeCtrl: document.querySelector(".mj-code"),
      toolbar: TOOLBAR, gate: GATE, table: TABLE, big: BIG, log: LOG, desktop: DESKTOP
    },
    onModel: function (m) { model = m; },
    beforeMerge: function (isSnapshot) { if (isSnapshot) seen = null; },
    onEvent: handleEvent,
    logLine: logLine,
    blockRender: function () { return dragActive; },   // a rack drag owns the DOM until it drops
    render: paint,
    postRender: flushFlights,
    onLeave: onLeave,
    extraPills: function () { return [deckPill()]; },
    lobbySettings: lobbySettings,
    settingsRows: function () {
      var st = model.settings;
      return [
        [S.minFaanLabel, String(st.minFaan)],
        [S.capFaanLabel, String(st.capFaan)],
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
  ui.deckPinned = false; ui.kongPick = false; ui.minFaanDraft = null; ui.overExpanded = {};
  ui.autoArrange = load(ARRANGE_KEY, true); ui.handOrder = null;
  ui.guideOpen = false; ui.guideScroll = 0; ui.guideSecOpen = {};
  var spinUntil = 0, spinDice = 2;
  var lastActor = null;
  var timerHandle = null, ringHandle = null, tumbleHandle = null, nextHandTick = null;
  var lastDice = null;    // { seat, d:[..] } — the dice tile's latest roll
  var seen = null;        // previous render's ponds/melds/flowers — new pieces animate in
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





  function handleEvent(e) {
    if (e.t === "seatRoll" || e.t === "breakRoll") {
      lastDice = { seat: e.seat, d: e.d };
      spinDice = e.d.length;
      spinUntil = Date.now() + (reduceMotion() ? 0 : 620);
    }
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
    if (model.claims) return model.claims.waiting || [];
    if (model.needBreak) return [dealerSeat()];
    if (model.turn) return [model.turn.seat];
    return [];
  }

  /* ═══ RENDER ═══════════════════════════════════════════════════ */
  /* the shell's render frame calls this once the toolbar, the desktop-only
     guard and the gate/table visibility are settled (games/table.js) */
  function paint() {
    renderBig();
    renderDice();
    renderPlayers();
    renderWallPanel();
    renderLog();
    renderClaim();
    renderRole();
    renderGuide();
    fitLog();
    snapshotSeen();
  }
  /* ── wall panel: the live count + round marker (between Players
     and Log — the felt center carries no text) ──────────────────── */
  function renderWallPanel() {
    WALL.textContent = "";
    var inHand = model.round != null && (model.phase === "play" || model.phase === "over");
    WALL.hidden = !inHand;
    if (!inHand) return;
    WALL.title = fmt(S.wallLeftTip, { n: model.wallLeft != null ? model.wallLeft : 0 });
    WALL.appendChild(backEl("mini"));
    var col = el("div", "mj-wallpanel");
    col.appendChild(el("div", "mj-wallpanel__count", model.wallLeft != null ? fmt(S.wallLeft, { n: model.wallLeft }) : "–"));
    col.appendChild(el("div", "mj-wallpanel__round", fmt(S.roundLine, { wind: windLabel(model.round.prevailing), n: model.round.hand })));
    WALL.appendChild(col);
  }

  /* two live faces from a deck, for the chips + popover options. Only
     sprites that actually loaded show — a bare placeholder deck reads as
     its name alone rather than two broken frames. */
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
    b.appendChild(el("span", "tb-pill__label", S.deckLabel));
    b.appendChild(el("span", "tb-pill__value", deckName(curDeck())));
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

    wrap.appendChild(TBL.choiceRow(S.capFaanLabel, "capFaan",
      [[8, "8"], [10, "10"], [13, "13"]], st.capFaan));
    // match length: one hand, one wind (default), or four winds
    wrap.appendChild(TBL.choiceRow(S.windsLabel, "winds",
      [[0, S.windsHand], [1, S.windsOne], [4, S.windsFour]], st.winds));
    wrap.appendChild(TBL.choiceRow(S.timerLabel, "timerSec",
      [[0, S.timerOff], [45, fmt(S.timerSecs, { n: 45 })], [60, fmt(S.timerSecs, { n: 60 })],
       [90, fmt(S.timerSecs, { n: 90 })], [120, fmt(S.timerSecs, { n: 120 })]], st.timerSec));

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
  function renderSeating() {
    var wrap = el("div", "mj-seating");
    wrap.appendChild(el("h2", "mj-seating__title", S.seatingTitle));
    wrap.appendChild(el("p", "mj-seating__note", S.seatingNote));
    var grid = el("div", "mj-seating__grid");
    var st = model.seating || { rolls: [] };
    var scope = st.reroll || [0, 1, 2, 3];
    (model.seats || []).forEach(function (s, i) {
      var pad = el("div", "mj-seating__pad" + (scope.indexOf(i) >= 0 && !st.rolls[i] ? " is-waiting" : ""));
      pad.style.setProperty("--mjstrip", "var(--gseat-" + i + ")");
      var head = el("div", "mj-seating__head");
      head.appendChild(seatDot(i));
      head.appendChild(el("span", "mj-seating__name", seatName(i) + (i === mySeat() ? " ·" : "")));
      pad.appendChild(head);
      var diceRow = el("div", "mj-seating__dice");
      var r = st.rolls[i];
      if (r) {
        r.forEach(function (v) { diceRow.appendChild(el("div", "mj-die mj-die--small", String(v))); });
        diceRow.appendChild(el("span", "mj-seating__sum", String(r[0] + r[1])));
      } else {
        diceRow.appendChild(el("div", "mj-die mj-die--small", "–"));
        diceRow.appendChild(el("div", "mj-die mj-die--small", "–"));
      }
      pad.appendChild(diceRow);
      grid.appendChild(pad);
    });
    wrap.appendChild(grid);
    if (st.reroll) wrap.appendChild(el("p", "mj-seating__note", fmt(S.seatingReroll, { names: st.reroll.map(seatName).join(", ") })));
    BIG.appendChild(wrap);
  }

  /* ── the table: four rotated seat zones around a center well ──── */
  // display position of a seat for THIS viewer: 0 bottom (me), then
  // counterclockwise in play order — 1 right, 2 top, 3 left
  function displayPos(seat) {
    var anchor = mySeat() != null ? mySeat() : (model.order ? model.order[0] : 0);
    if (!model.order) return (seat - anchor + 4) % 4;
    return (orderIdx(seat) - orderIdx(anchor) + 4) % 4;
  }
  var POS_CLS = ["bottom", "right", "top", "left"];
  function renderTable() {
    var board = el("div", "mj-board");
    board.setAttribute("data-mj-board", "");
    var active = activeSeats();
    for (var seat = 0; seat < 4; seat++) {
      var pos = POS_CLS[displayPos(seat)];
      var zone = el("div", "mj-zone mj-zone--" + pos + (active.indexOf(seat) >= 0 ? " is-active" : ""));
      zone.setAttribute("data-zone", seat);
      zone.style.setProperty("--mjstrip", "var(--gseat-" + seat + ")");
      var p = model.players[seat];

      // head: dot + name + wind + dealer marker
      var head = el("div", "mj-zone__head");
      head.appendChild(seatDot(seat));
      head.appendChild(el("span", "mj-zone__name", seatName(seat) + (seat === mySeat() ? " ·" : "")));
      var w = seatWind(seat);
      if (w != null) {
        var wt = el("span", "mj-zone__wind" + (w === 0 ? " is-dealer" : ""), HONOR_GLYPH[Engine.WINDS[w]]);
        wt.title = windLabel(w) + (w === 0 ? " · " + S.dealerTag : "");
        head.appendChild(wt);
      }
      zone.appendChild(head);

      // concealed hand: face-down backs for others, nothing for me (the rack
      // tile shows my tiles); spectators see backs all around
      var isSide = pos === "left" || pos === "right";
      var dir = pos === "left" ? "l" : "r";
      var backs = null;
      if (seat !== mySeat()) {
        backs = el("div", "mj-zone__backs");
        for (var i = 0; i < p.handCount; i++) backs.appendChild(backEl("mini"));
      }

      // melds + flowers, face up — side seats sit AT the table: everything
      // sideways, melds running down a second column beside the hand
      var mrow = el("div", "mj-zone__melds" + (isSide ? " mj-zone__melds--side" : ""));
      p.melds.forEach(function (m) { mrow.appendChild(meldEl(m, "mini", isSide ? dir : null)); });
      p.flowers.forEach(function (f) {
        var fe = tileEl(f, "mini");
        fe.classList.add("mj-tilef--flower");
        mrow.appendChild(isSide ? rotWrap(fe, dir) : fe);
      });
      if (isSide) {
        var body = el("div", "mj-zone__sidebody");
        if (backs) body.appendChild(backs);
        body.appendChild(mrow);
        zone.appendChild(body);
      } else {
        if (backs) zone.appendChild(backs);
        zone.appendChild(mrow);
      }

      board.appendChild(zone);
    }

    board.appendChild(renderFelt());
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
    var rear = model.wallLeft != null ? (model.wallBack || 0) : 0;
    var front = drawn - rear;
    var brk = breakStackIndex();
    var sides = {};
    SIDE_ORDER.forEach(function (pos) { sides[pos] = el("div", "mj-wall__side mj-wall__side--" + pos); });
    for (var k = 0; k < 72; k++) {
      var st = backEl("wall");
      var fpos = (k - brk + 72) % 72;                    // clockwise distance from the break
      var rpos = (brk - 1 - k + 144) % 72;               // backwards distance from the break
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
    var entries = model.pond || [];
    entries.forEach(function (d, idx) {
      var te = tileEl(d.tile, "mini");
      te.title = fmt(S.pondTip, { name: seatName(d.seat) });
      var isNewest = idx === entries.length - 1;
      if (isNewest && !(seen && seen.pondN != null && idx < seen.pondN)) te.classList.add("is-fresh");
      if (isNewest && model.claims && model.claims.from === d.seat && !model.claims.robbing) te.classList.add("is-hot");
      pond.appendChild(te);
    });
    if (model.needBreak) {
      pond.appendChild(el("p", "mj-felt__note",
        dealerSeat() === mySeat() ? S.breakPromptYou : fmt(S.breakPrompt, { name: seatName(dealerSeat()) })));
    }
    felt.appendChild(pond);
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
  // pond/meld/flower counts snapshot — the next render's "what's new" diff
  function snapshotSeen() {
    if (!model || !model.players) { seen = null; return; }
    var s = { pondN: (model.pond || []).length, melds: {}, flowers: {} };
    model.players.forEach(function (p, i) {
      s.melds[i] = p.melds.length;
      s.flowers[i] = p.flowers.length;
    });
    seen = s;
  }

  /* ── hand-over settlement (overlays the board tile) ───────────── */
  function renderHandOver() {
    var s = model.handOver;
    var wrap = el("div", "mj-handover");
    var panel = el("div", "mj-handover__panel");
    if (s.result === "drawn") {
      panel.appendChild(el("h3", "mj-handover__title", S.handDrawnLine));
      panel.appendChild(el("p", "mj-handover__line", fmt(S.dealerRepeats, { name: seatName(s.dealer) })));
    } else {
      panel.appendChild(el("h3", "mj-handover__title" + (s.limit ? " is-limit" : ""),
        fmt(s.selfDraw ? S.handWinSelf : S.handWinLine, { name: seatName(s.seat), faan: s.faan })));
      if (s.limit) panel.appendChild(el("p", "mj-handover__limit", S.handWinLimit));
      // the winning hand, revealed
      var handRow = el("div", "mj-handover__hand");
      (s.tiles || []).forEach(function (t) { handRow.appendChild(tileEl(t, "")); });
      (s.melds || []).forEach(function (m) { handRow.appendChild(meldEl(m, "")); });
      (s.flowers || []).forEach(function (f) {
        var fe = tileEl(f, "");
        fe.classList.add("mj-tilef--flower");
        handRow.appendChild(fe);
      });
      panel.appendChild(handRow);
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
      // payments
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
    var next = el("button", "tb-pill mj-handover__next");
    next.type = "button";
    next.appendChild(el("span", "tb-pill__label", S.nextHandButton));
    next.addEventListener("click", function () { send({ type: "nextHand" }); });
    if (mySeat() == null) next.disabled = true;
    panel.appendChild(next);
    var auto = el("p", "mj-handover__auto");
    panel.appendChild(auto);
    tickNextHand(auto);
    wrap.appendChild(panel);
    BIG.appendChild(wrap);
  }
  function tickNextHand(node) {
    if (nextHandTick) { clearTimeout(nextHandTick); nextHandTick = null; }
    if (!model || !model.handOverAt) { node.textContent = ""; return; }
    var ms = Math.max(0, model.handOverAt - (Date.now() - TBL.skew()));
    node.textContent = fmt(S.nextHandAuto, { n: Math.ceil(ms / 1000) });
    nextHandTick = setTimeout(function () { if (node.isConnected) tickNextHand(node); }, 250);
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
     expand/collapse, scroll preserved across re-renders, and held
     state flips classes/text only — the page rebuilds on every state
     message while the popup is open, and it must hold still. */
  var GUIDE_SECTIONS = [
    { head: "guideSecShape", items: [["allChows", "1"], ["allPungs", "3"], ["halfFlush", "3"], ["fullFlush", "7"]] },
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
  function closeGuide() {
    if (!ui.guideOpen) return;
    ui.guideOpen = false; ui.guideScroll = 0; ui.guideSecOpen = {};
    render();
  }
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
      render();
    });
    body.appendChild(btn);
    if (open) fill();
  }
  function renderGuide() {
    if (!ui.guideOpen || !model || !model.settings) return;
    var wrap = el("div", "mj-guide");
    wrap.addEventListener("click", function (e) { if (e.target === wrap) closeGuide(); });
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
    BIG.appendChild(wrap);
    // scroll position survives the wholesale re-render on every message
    body.scrollTop = ui.guideScroll;
    body.addEventListener("scroll", function () { ui.guideScroll = body.scrollTop; });
  }

  /* ── game over ────────────────────────────────────────────────── */
  function renderOver() {
    var o = model.over || {};
    var wrap = el("div", "mj-over");
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
    (o.scores || []).map(function (score, seat) { return { seat: seat, score: score }; })
      .sort(function (a, b) { return b.score - a.score; })
      .forEach(function (r) {
        var row = el("div", "mj-over__row" + (r.seat === o.winner ? " is-winner" : ""));
        row.appendChild(seatDot(r.seat));
        row.appendChild(el("span", "mj-over__name", seatName(r.seat)));
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
    if (timerHandle) { clearTimeout(timerHandle); timerHandle = null; }
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
    if (timed) { var timer = el("div", "mj-timer"); row.appendChild(timer); tickTimer(timer); }
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
  function timerLeftMs() {
    if (!model.settings || !model.settings.timerSec || model.turnEndsAt == null) return null;
    return Math.max(0, model.turnEndsAt - (Date.now() - TBL.skew()));
  }
  function fmtClock(ms) { var s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function tickTimer(node) {
    var ms = timerLeftMs();
    if (ms == null) {
      node.textContent = fmtClock(model.settings.timerSec * 1000);
      node.classList.remove("is-live", "is-urgent");
      return;
    }
    node.textContent = fmtClock(ms);
    node.classList.add("is-live");
    node.classList.toggle("is-urgent", ms <= 10000);
    if (timerHandle) clearTimeout(timerHandle);
    timerHandle = setTimeout(function () { if (node.isConnected) tickTimer(node); }, 250);
  }

  /* ── PLAYERS tile (strips + timer ring on the active seat) ────── */
  var RING_R = 8.5, RING_C = 2 * Math.PI * RING_R;
  function ringDot(i) {
    var wrap = el("span", "mj-pstrip__ringwrap");
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "mj-pstrip__ring");
    svg.setAttribute("viewBox", "0 0 22 22");
    svg.setAttribute("aria-hidden", "true");
    var track = document.createElementNS(svgNS, "circle");
    track.setAttribute("cx", 11); track.setAttribute("cy", 11); track.setAttribute("r", RING_R);
    track.setAttribute("class", "mj-pstrip__ringtrack");
    svg.appendChild(track);
    var arc = document.createElementNS(svgNS, "circle");
    arc.setAttribute("cx", 11); arc.setAttribute("cy", 11); arc.setAttribute("r", RING_R);
    arc.setAttribute("class", "mj-pstrip__ringarc");
    arc.setAttribute("stroke-dasharray", RING_C.toFixed(2));
    svg.appendChild(arc);
    wrap.appendChild(svg);
    wrap.appendChild(seatDot(i));
    tickRing(arc);
    return wrap;
  }
  function tickRing(arc) {
    var ms = timerLeftMs();
    if (ms == null) {
      arc.style.strokeDashoffset = "0";
      arc.classList.remove("is-urgent");
    } else {
      arc.style.strokeDashoffset = (RING_C * (1 - ms / (model.settings.timerSec * 1000))).toFixed(2);
      arc.classList.toggle("is-urgent", ms <= 10000);
    }
    if (ringHandle) clearTimeout(ringHandle);
    ringHandle = setTimeout(function () { if (arc.isConnected) tickRing(arc); }, 250);
  }
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
      strip.style.setProperty("--mjstrip", "var(--gseat-" + i + ")");
      var body = el("div", "mj-pstrip__body");
      var head = el("div", "mj-pstrip__head");
      head.appendChild(isActive && timed && model.turnEndsAt ? ringDot(i) : seatDot(i));
      var nm = (s.bot || s.phantom) ? fmt(S.botSeatTag, { name: seatName(i) }) : seatName(i);
      head.appendChild(el("span", "mj-pstrip__name", nm + (i === mySeat() ? " ·" : "")));
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
      stat.appendChild(el("span", "mj-pstrip__cards", fmt(S.tilesShort, { n: p ? p.handCount : 0 })));
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
    logLines.slice(-50).forEach(function (entry) { list.appendChild(logLineEl(entry)); });
    LOG.appendChild(list);
    list.scrollTop = list.scrollHeight;
    requestAnimationFrame(function () { list.scrollTop = list.scrollHeight; });
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

  /* ── CLAIM window (the trade-hub overlay, repurposed) ─────────── */
  function renderClaim() {
    if (!CLAIM) return;
    var cl = model.claims;
    var my = model.you && model.you.claims;
    if (!cl || model.phase !== "play") { CLAIM.hidden = true; CLAIM.textContent = ""; return; }
    CLAIM.hidden = false; CLAIM.textContent = "";
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
    CLAIM.appendChild(box);
  }

  /* ── ROLE tile: my rack + action pills ────────────────────────── */
  function myTurnToDiscard() {
    return model.phase === "play" && model.turn && model.turn.seat === mySeat() &&
           !model.claims && !model.handOver && !model.needBreak;
  }
  function renderRole() {
    ROLE.textContent = "";
    var seat = mySeat();
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
      row.appendChild(rackTile(model.you.drawn, { tap: canDiscard && !manual, drag: manual, isDrawn: true }));
    }
    rack.appendChild(row);

    // my melds + flowers under the hand — the row is ALWAYS present (its CSS
    // reserves one mini-tile row) so the rack doesn't grow when the first
    // flower or meld of the hand lands
    var p = model.players && model.players[seat];
    var mrow = el("div", "mj-rack__melds");
    if (p) {
      p.melds.forEach(function (m) { mrow.appendChild(meldEl(m, "mini")); });
      p.flowers.forEach(function (f) {
        var fe = tileEl(f, "mini");
        fe.classList.add("mj-tilef--flower");
        mrow.appendChild(fe);
      });
    }
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
    if (model.phase === "seating") {
      var scope = (model.seating && model.seating.reroll) || [0, 1, 2, 3];
      var mustRoll = scope.indexOf(seat) >= 0 && !(model.seating && model.seating.rolls[seat]);
      headNote(mustRoll ? S.seatingYou : fmt(S.seatingWaiting, { names: activeSeats().map(seatName).join(", ") }));
      var rollP = actionPill(S.rollPill, mustRoll, function () { send({ type: "rollSeat" }); });
      rollP.classList.add("mj-act--roll");
      if (mustRoll) rollP.classList.add("is-glow");
      ctrl.appendChild(wrapPills([rollP]));
    } else if (model.needBreak) {
      var meBreaks = dealerSeat() === seat;
      headNote(meBreaks ? S.breakPromptYou : fmt(S.breakPrompt, { name: seatName(dealerSeat()) }));
      var bp = actionPill(S.rollPill, meBreaks, function () { send({ type: "rollBreak" }); });
      bp.classList.add("mj-act--roll");
      if (meBreaks) bp.classList.add("is-glow");
      ctrl.appendChild(wrapPills([bp]));
    } else if (model.phase === "play" && !model.handOver) {
      // every prompt for this phase rides the title line beside "your hand":
      // near-win keeps its quiet hint styling and stands in for the discard
      // prompt, the rest share the mj-role__note font.
      if (nw) {
        var hint = el("span", "mj-rack__hint", fmt(S.nearWinLine, { n: nw.faan, min: nw.need }));
        hint.title = fmt(S.nearWinLine, { n: nw.faan, min: nw.need });
        head.appendChild(hint);
      } else if (canDiscard) headNote(manual ? S.discardHintManual : S.discardHint);
      else if (model.claims) headNote(S.claimWaiting);
      else if (model.turn) headNote(fmt(S.drawWaiting, { name: seatName(model.turn.seat) }));
      var pills = [];
      var canWin = canDiscard && model.you && model.you.canWin;
      var winP = actionPill(S.pillWin, !!canWin, function () { send({ type: "win" }); });
      if (canWin) winP.classList.add("is-glow");
      else if (canDiscard && model.you && model.you.nearWin) {
        winP.title = fmt(S.nearWinLine, { n: model.you.nearWin.faan, min: model.you.nearWin.need });
      }
      pills.push(winP);
      var kongs = (canDiscard && model.you && model.you.kongs) || [];
      var kongP = actionPill(S.pillKong, kongs.length > 0, function () {
        if (kongs.length === 1) { send({ type: "kong", tile: kongs[0] }); ui.kongPick = false; }
        else { ui.kongPick = !ui.kongPick; render(); }
      }, ui.kongPick);
      pills.push(kongP);
      ctrl.appendChild(wrapPills(pills));
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
      // the quiet Scoring pill sits alone at the column's bottom right
      var guideP = actionPill(S.pillGuide, true, function () { ui.guideOpen = true; render(); });
      guideP.classList.add("mj-act--quiet", "mj-act--guide");
      ctrl.appendChild(guideP);
    }
    play.appendChild(ctrl);
    ROLE.appendChild(play);
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
    if (o.tap) b.addEventListener("click", function () { send({ type: "discard", tile: t }); });
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
      var row = ROLE.querySelector("[data-rack]");
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

  /* ── tile fly-ins (cities' steering chip layer, tile edition) ───
     Client-only theater derived from the same typed events the log
     consumes: a discard flies rack/zone → pond, a claimed tile pond →
     the claimant's melds, a settlement flies score chips losers →
     winner. Chips live in a document-FIXED overlay and STEER: every rAF
     re-queries the destination, so a re-rendered zone is tracked. */
  var flights = [], flyRaf = null, pendingFlights = [];
  var FLY_MS = 700, FLY_STEP = 90;
  function flyLayer() {
    var l = document.querySelector(".mj-flylayer");
    if (!l) {
      l = el("div", "mj-flylayer");
      // inside <section class="mj"> so the tile palette resolves
      (document.querySelector("section.mj") || document.body).appendChild(l);
    }
    return l;
  }
  function rectPoint(elm) {
    if (!elm) return null;
    var r = elm.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, el: elm };
  }
  function zonePoint(seat) { return rectPoint(BIG.querySelector('[data-zone="' + seat + '"]')); }
  function pondPoint() { return rectPoint(BIG.querySelector("[data-mj-pond]")) || centerPoint(); }
  function centerPoint() { return rectPoint(BIG.querySelector("[data-mj-center]")) || rectPoint(BIG); }
  function wallFrontPoint() { return rectPoint(BIG.querySelector("[data-wall-front]")) || centerPoint(); }
  function wallBackPoint() { return rectPoint(BIG.querySelector("[data-wall-back]")) || centerPoint(); }
  function rackPoint() { return rectPoint(ROLE.querySelector("[data-rack]")); }
  function stripPoint(seat) { return rectPoint(PLAYERS.querySelector('.mj-pstrip[data-seat="' + seat + '"]')) || rectPoint(PLAYERS); }
  function seatSpot(seat) {
    if (seat === mySeat()) return rackPoint() || stripPoint(seat);
    return zonePoint(seat) || stripPoint(seat);
  }
  function chipTile(t) {
    var c = el("span", "mj-flychip");
    c.appendChild(t ? tileEl(t, "mini") : backEl("mini"));
    return c;
  }
  function chipScore() { return el("span", "mj-flychip mj-flychip--score"); }
  function launchChip(node, fromFn, toFn, delay) {
    setTimeout(function () {
      if (!model) return;
      var from = fromFn(); if (!from) return;
      var sx = from.x + (Math.random() - 0.5) * 10, sy = from.y + (Math.random() - 0.5) * 10;
      node.style.transform = "translate(" + sx.toFixed(1) + "px," + sy.toFixed(1) + "px) scale(0)";
      flyLayer().appendChild(node);
      flights.push({ el: node, sx: sx, sy: sy, to: toFn, t0: performance.now(), dur: FLY_MS + (Math.random() - 0.5) * 160 });
      if (flyRaf == null) flyRaf = requestAnimationFrame(stepFlights);
    }, delay || 0);
  }
  function stepFlights(now) {
    // Two passes, deliberately: resolve every destination (each f.to() is a
    // querySelector + getBoundingClientRect) BEFORE writing any transform, so a
    // read can't force a sync layout in the middle of the write loop. The chips
    // ride a position:fixed overlay, so their transforms never dirty the board.
    var frame = flights.map(function (f) {
      var p = Math.min(1, (now - f.t0) / f.dur);
      return { f: f, p: p, to: f.to() || { x: f.sx, y: f.sy } };
    });
    flights = [];
    frame.forEach(function (o) {
      var f = o.f, p = o.p, to = o.to;
      var e = 1 - Math.pow(1 - p, 3);
      var s;
      if (p < 0.12) s = (p / 0.12) * 1.2;
      else if (p < 0.24) s = 1.2 - ((p - 0.12) / 0.12) * 0.2;
      else if (p > 0.85) s = 1 - ((p - 0.85) / 0.15) * 0.7;
      else s = 1;
      f.el.style.transform = "translate(" + (f.sx + (to.x - f.sx) * e).toFixed(1) + "px," + (f.sy + (to.y - f.sy) * e).toFixed(1) + "px) scale(" + s.toFixed(3) + ")";
      // landing: the chip shrinks out (the pond's own is-fresh pop and the
      // re-rendered zone acknowledge arrival — no bump on the container, which
      // scaled a whole panel and read as a flinch every bot turn)
      if (p >= 1) { if (f.el.parentNode) f.el.parentNode.removeChild(f.el); }
      else flights.push(f);
    });
    flyRaf = flights.length ? requestAnimationFrame(stepFlights) : null;
  }
  function clearFlights() {
    flights.forEach(function (f) { if (f.el.parentNode) f.el.parentNode.removeChild(f.el); });
    flights = []; pendingFlights = [];
  }
  function collectFlight(e) {
    if (reduceMotion()) return;
    if (e.t === "discard") {
      (function (seat, tile) {
        pendingFlights.push(function () {
          launchChip(chipTile(tile), function () { return seatSpot(seat); }, pondPoint, 0);
        });
      })(e.seat, e.tile);
      return;
    }
    if (e.t === "draw") {
      (function (seat) {
        pendingFlights.push(function () {
          launchChip(chipTile(null),
            wallFrontPoint, function () { return seatSpot(seat); }, 0);
        });
      })(e.seat);
      return;
    }
    if (e.t === "flower") {
      (function (seat, tile) {
        pendingFlights.push(function () {
          launchChip(chipTile(tile), wallBackPoint, function () { return seatSpot(seat); }, 0);
        });
      })(e.seat, e.tile);
      return;
    }
    if (e.t === "meld" && e.from != null) {
      (function (seat, from, tile) {
        pendingFlights.push(function () {
          launchChip(chipTile(tile), pondPoint, function () { return seatSpot(seat); }, 0);
        });
      })(e.seat, e.from, e.tile);
      return;
    }
    if (e.t === "handOver" && e.summary && e.summary.result === "win") {
      (function (s) {
        pendingFlights.push(function () {
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
  function flushFlights() {
    var fl = pendingFlights; pendingFlights = [];
    fl.forEach(function (go) { go(); });
  }

  /* ── leaving: the shell drops the socket, the model and its own lobby
     state; this clears what's DeetsMahjong's alone ───────────────── */
  function onLeave() {
    clearFlights();
    seen = null; lastDice = null; lastActor = null;
    ui.deckPinned = false; ui.kongPick = false; ui.minFaanDraft = null; ui.overExpanded = {};
    ui.handOrder = null; ui.guideOpen = false; ui.guideScroll = 0; ui.guideSecOpen = {};
    dragActive = false;
  }

  /* ═══ BOOT ═════════════════════════════════════════════════════ */
  TBL.boot();
})();
