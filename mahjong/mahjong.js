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

  var T = window.MahjongTransport;
  var S = window.MAHJONG_STRINGS || {};
  var Engine = window.MahjongEngine;
  var Colors = window.MahjongColors;

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

  /* ── small helpers ────────────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function load(key, fb) { try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fb : v; } catch (e) { return fb; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  function slugify(raw) { return String(raw || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24); }
  function fmt(tpl, vals) { return String(tpl || "").replace(/\{(\w+)\}/g, function (_, k) { return vals && vals[k] != null ? vals[k] : ""; }); }
  function reduceMotion() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  var TOKEN_KEY = "deets-mahjong-token", NAME_KEY = "deets-mahjong-name", RECENTS_KEY = "deets-mahjong-recents";
  var CUSTOM_COLOR_KEY = "deets-mahjong-customhex";
  var ARRANGE_KEY = "deets-mahjong-autoarrange";   // "Auto-Arrange" toggle (default on)
  function deviceToken() {
    var t = load(TOKEN_KEY, null);
    if (t) return t;
    var bytes = new Uint8Array(16);
    try { crypto.getRandomValues(bytes); } catch (e) { for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256); }
    t = Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    save(TOKEN_KEY, t);
    return t;
  }
  function recents() { return load(RECENTS_KEY, []); }
  function remember(code) {
    var r = recents().filter(function (c) { return c !== code; });
    r.unshift(code); save(RECENTS_KEY, r.slice(0, 6));
  }
  function toast(text, kind, opts) {
    if (!window.DeetsToast) return { dismiss: function () {} };
    var o = { kind: kind || "info", text: text };
    if (opts) for (var k in opts) o[k] = opts[k];
    return window.DeetsToast.push(o);
  }

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
     drawn pips, bamboo sticks, characters); the deck is a host-picked
     TABLE setting (settings.deck), synced to everyone like minFaan. Every
     file of every deck is probed ONCE at load — a missing sprite costs
     one quiet 404 and that face falls back to the CSS glyph placeholder. */
  var SPRITE_ROOT = "../assets/sprites/mahjong/";
  var DECKS = ["numeral", "traditional"];
  function curDeck() {
    var d = model && model.settings && model.settings.deck;
    return DECKS.indexOf(d) >= 0 ? d : "numeral";
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

  /* ── popover kit (mirrored from league/radio/cities) ──────────── */
  var openEntry = null;
  function closePop() {
    if (!openEntry) return;
    openEntry.pop.hidden = true;
    if (openEntry.pill) openEntry.pill.setAttribute("aria-expanded", "false");
    openEntry = null;
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onDocKey);
  }
  function onDocClick(e) { if (openEntry && !openEntry.ctrl.contains(e.target)) closePop(); }
  function onDocKey(e) { if (e.key === "Escape") { var p = openEntry; closePop(); if (p && p.pill) p.pill.focus(); } }
  function openPop(entry) {
    closePop();
    entry.pop.hidden = false;
    if (entry.pill) entry.pill.setAttribute("aria-expanded", "true");
    openEntry = entry;
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onDocKey);
  }
  function togglePop(entry) { if (openEntry === entry) closePop(); else openPop(entry); }

  /* ── connection state ─────────────────────────────────────────── */
  var conn = null, model = null, code = null;
  var joined = false, joining = false, peekSeq = 0;
  var logLines = [], connToast = null, spinUntil = 0, spinDice = 2;
  var lastActor = null;
  var clockSkew = 0, timerHandle = null, ringHandle = null, tumbleHandle = null, nextHandTick = null;
  var lastDice = null;    // { seat, d:[..] } — the dice tile's latest roll
  var ui = { colorOpen: null, colorDraft: null, botEdit: null, botDraft: null, botFocus: false,
             settingsPinned: false, kongPick: false, minFaanDraft: null, overExpanded: {},
             autoArrange: load(ARRANGE_KEY, true), handOrder: null };
  var seen = null;        // previous render's ponds/melds/flowers — new pieces animate in
  var dragActive = false; // a rack tile is being dragged — suppress re-renders mid-drag

  /* ═══ BAR: code combobox + recents ═════════════════════════════ */
  if (BAR_INPUT) {
    BAR_INPUT.placeholder = S.tableCodePlaceholder || "";
    BAR_INPUT.setAttribute("aria-label", S.tableCodePlaceholder || "Table code");
    BAR_INPUT.addEventListener("focus", function () { fillCodePop(); if (recents().length) openCodePop(); BAR_INPUT.select(); });
    BAR_INPUT.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commitCode(BAR_INPUT.value); BAR_INPUT.blur(); }
    });
  }
  var codeEntry = { ctrl: document.querySelector(".mj-code"), pill: null, pop: CODE_POP };
  function openCodePop() { openPop(codeEntry); }
  function fillCodePop() {
    CODE_POP.textContent = "";
    var r = recents();
    if (!r.length) { CODE_POP.appendChild(el("div", "tb-pop__empty", S.yourTables)); return; }
    CODE_POP.appendChild(el("div", "tb-pop__head", S.yourTables));
    r.forEach(function (c) {
      var b = el("button", "tb-pop__opt", c);
      b.type = "button";
      b.addEventListener("click", function () { closePop(); commitCode(c); });
      CODE_POP.appendChild(b);
    });
  }

  /* ═══ GATE: peek → sit / watch / open ══════════════════════════ */
  function commitCode(raw) {
    var c = slugify(raw);
    if (!c) return;
    closePop();
    BAR_INPUT.value = c;
    if (joining || (joined && c === code)) return;
    if (joined) leaveTable();
    var seq = ++peekSeq;
    T.peek(c).then(function (p) {
      if (seq !== peekSeq || joining || joined) return;
      renderGate(c, p);
    }).catch(function () { if (seq === peekSeq && !joined) toast(S.peekFailed, "error"); });
  }
  function renderGate(c, p, refuseName) {
    GATE.hidden = false; GATE.textContent = "";
    TABLE.hidden = true; DESKTOP.hidden = true;
    var full = p.exists && p.phase === "lobby" && p.seated >= p.capacity;
    var canSit = p.exists && p.phase === "lobby" && !full;
    var line;
    if (refuseName) line = S.nameTaken;
    else if (!p.exists) line = fmt(S.createLine, { code: c });
    else if (full) line = fmt(S.peekFull, { spectators: p.spectators });
    else line = fmt(S.peekPlayers, { seated: p.seated, spectators: p.spectators });
    GATE.appendChild(el("p", "mj-gate__line", line));

    var form = el("div", "mj-gate__form");
    var stored = String(load(NAME_KEY, "")).trim();
    var nameInput = null;
    if (!stored || refuseName) {
      var wrap = el("label", "mj-gate__name");
      wrap.appendChild(el("span", "mj-gate__name-label", S.nameLabel));
      nameInput = el("input", "mj-gate__name-input"); nameInput.type = "text"; nameInput.maxLength = 24; nameInput.value = stored;
      wrap.appendChild(nameInput); form.appendChild(wrap);
    }
    var btns = [];
    function goBtn(label, asWatch, enabled) {
      var b = el("button", "tb-pill mj-gate__go");
      b.type = "button"; b.disabled = !enabled;
      b.appendChild(el("span", "tb-pill__label", label));
      b.addEventListener("click", function () {
        var who = nameInput ? nameInput.value.trim() : stored;
        if (!who) { toast(S.nameNeeded, "error"); if (nameInput) nameInput.focus(); return; }
        save(NAME_KEY, who);
        btns.forEach(function (x) { x.el.disabled = true; });
        joinTable(c, who, !p.exists, asWatch).then(function () {
          if (!joined) btns.forEach(function (x) { x.el.disabled = !x.enabled; });
        });
      });
      btns.push({ el: b, enabled: enabled });
      form.appendChild(b);
      return b;
    }
    var first;
    if (!p.exists) first = goBtn(S.createButton, false, true);
    else {
      first = goBtn(S.sitButton, false, canSit);
      goBtn(S.watchButton, true, true);
    }
    GATE.appendChild(form);
    if (nameInput) nameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); (first.disabled ? btns[btns.length - 1].el : first).click(); }
    });
  }

  /* ── join / leave ─────────────────────────────────────────────── */
  function joinTable(c, who, create, asSpectator) {
    if (joining || (joined && c === code)) return Promise.resolve();
    joining = true; peekSeq++;
    return T.connect(c, { name: who, create: !!create, token: deviceToken() }).then(function (cn) {
      joining = false; conn = cn; code = c; joined = true; logLines = [];
      cn.onMessage(onMessage);
      if (cn.onStatus) cn.onStatus(function (s) {
        if (!joined) return;
        if (s === "down") { if (!connToast) connToast = toast(S.connDown, "error"); }
        else { if (connToast) { connToast.dismiss(); connToast = null; } toast(S.connUp, "success"); }
      });
      ui.wantSit = !asSpectator;
      remember(c);
      try { history.replaceState(null, "", "#" + c); } catch (e) {}
    }).catch(function (err) {
      joining = false;
      var ec = err && err.code;
      if (ec === "name-taken") { renderGate(c, { exists: true, phase: "lobby", seated: 0, capacity: 4, spectators: 0 }, true); return; }
      toast(ec === "no-table" ? S.noTable : ec === "full" ? S.tableFull : S.peekFailed, "error");
    });
  }
  function leaveTable() {
    if (conn) conn.close();
    conn = null; model = null; joined = false; code = null; logLines = [];
    if (connToast) { connToast.dismiss(); connToast = null; }
    clearFlights();
    seen = null; lastDice = null; lastActor = null;
    ui = { colorOpen: null, colorDraft: null, botEdit: null, botDraft: null, botFocus: false,
           settingsPinned: false, kongPick: false, minFaanDraft: null, overExpanded: {},
           autoArrange: load(ARRANGE_KEY, true), handOrder: null };
    dragActive = false;
    GATE.hidden = true; TABLE.hidden = true; DESKTOP.hidden = true;
    buildToolbar();
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }
  function send(msg) { if (conn) conn.send(msg); }

  /* ═══ MESSAGE HANDLING ═════════════════════════════════════════ */
  function onMessage(msg) {
    if (msg.type === "kicked") { toast(S.kickedMeta, "error"); leaveTable(); return; }
    if (msg.type === "closed") { toast(S.tableClosed, "info"); leaveTable(); return; }
    if (msg.type === "error") { toast(errText(msg.code), "error"); return; }
    if (msg.type === "snapshot") { model = stripMeta(msg); seen = null; afterModel(msg); return; }
    if (msg.type === "state") {
      if (!model) model = {};
      for (var k in msg) if (k !== "type" && k !== "v" && k !== "serverNow" && k !== "ev") model[k] = msg[k];
      // fields the mock omits when absent must clear, not linger
      ["claims", "handOver", "handOverAt", "turnEndsAt", "seating", "breakRoll", "turn"].forEach(function (f) {
        if (!(f in msg)) delete model[f];
      });
      if (model.you) {
        ["claims", "canWin", "kongs", "drawn", "nearWin"].forEach(function (f) {
          if (!(f in msg.you)) delete model.you[f];
        });
      }
      afterModel(msg);
      return;
    }
  }
  function stripMeta(msg) { var m = {}; for (var k in msg) if (k !== "type" && k !== "v" && k !== "serverNow" && k !== "ev") m[k] = msg[k]; return m; }
  function afterModel(msg) {
    if (typeof msg.serverNow === "number") clockSkew = Date.now() - msg.serverNow;
    (msg.ev || []).forEach(handleEvent);
    if (ui.wantSit && model.phase === "lobby" && mySeat() == null) { ui.wantSit = false; send({ type: "sit" }); }
    applySeatColors();
    GATE.hidden = true;
    render();
    flushFlights();
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
    if (e.t === "takeover") toast(fmt(S.takeoverToast, { name: seatName(e.seat) }), "warn");
    collectFlight(e);
    var line = logLine(e);
    if (line) { logLines.push(line); if (logLines.length > 140) logLines.shift(); }
  }
  function errText(codeStr) {
    var map = { turn: S.errTurn, phase: S.errPhase, loc: S.errLoc, perm: S.errPerm, full: S.errFull,
                "no-table": S.noTable, "name-taken": S.nameTaken, color: S.errColor,
                "color-taken": S.errColorTaken, flood: S.errFlood };
    return map[codeStr] || S.errPhase;
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
  function seatName(i) { return (model && model.seats && model.seats[i] && model.seats[i].name) || ("Seat " + (i + 1)); }
  function mySeat() { return model && model.you ? model.you.seat : null; }
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
  function render() {
    if (!model) return;
    if (dragActive) return;   // a rack drag owns the DOM until it drops
    buildToolbar();
    var narrow = window.matchMedia("(max-width: 56rem)").matches;
    if (narrow) { TABLE.hidden = true; DESKTOP.hidden = false; DESKTOP.textContent = S.desktopOnly; return; }
    DESKTOP.hidden = true; TABLE.hidden = false; GATE.hidden = true;
    renderBig();
    renderDice();
    renderPlayers();
    renderWallPanel();
    renderLog();
    renderClaim();
    renderRole();
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
  function fitLog() {
    if (!BIG || !LOG || TABLE.hidden) return;
    var avail = BIG.getBoundingClientRect().bottom - LOG.getBoundingClientRect().top;
    if (avail > 60) LOG.style.height = Math.floor(avail) + "px";
    var list = LOG.querySelector(".mj-log__list");
    if (list) list.scrollTop = list.scrollHeight;
  }
  function seatedCount() { return (model.seats || []).filter(function (s) { return s && !s.empty; }).length; }

  /* ── toolbar (Invite · View Settings · Sit/Stand · Leave · Close) ─ */
  function buildToolbar() {
    TOOLBAR.textContent = "";
    if (!joined || !model) return;
    var mine = mySeat();
    TOOLBAR.appendChild(pill(S.invitePill, function () {
      var url = location.origin + location.pathname + (T.kind === "mock" ? "?mock" : "") + "#" + code;
      try { navigator.clipboard.writeText(url); toast(S.shareToast, "success"); } catch (e) { toast(url, "info"); }
    }));
    if (model.settings) TOOLBAR.appendChild(viewSettingsPill());
    if (model.phase === "lobby") {
      if (mine == null) TOOLBAR.appendChild(pill(S.sitPill, function () { send({ type: "sit" }); }));
      else TOOLBAR.appendChild(pill(S.standButton, function () { send({ type: "stand" }); }));
    }
    TOOLBAR.appendChild(pill(S.leavePill, function () { leaveTable(); }));
    if (model.host) {
      var cp = pill(S.closePill, function () {
        if (cp._armed) { send({ type: "closeTable" }); } else { cp._armed = true; cp.querySelector(".tb-pill__label").textContent = S.closeConfirm; setTimeout(function () { if (cp.isConnected) { cp._armed = false; cp.querySelector(".tb-pill__label").textContent = S.closePill; } }, 2600); }
      });
      TOOLBAR.appendChild(cp);
    }
  }
  function pill(label, onClick) {
    var b = el("button", "tb-pill"); b.type = "button";
    b.appendChild(el("span", "tb-pill__label", label));
    b.addEventListener("click", onClick);
    return b;
  }
  function viewSettingsPill() {
    var wrap = el("span", "mj-setth");
    var b = el("button", "tb-pill"); b.type = "button"; b.setAttribute("aria-haspopup", "true");
    b.appendChild(el("span", "tb-pill__label", S.settingsPill));
    wrap.appendChild(b);
    var pop = el("div", "tb-pop mj-setth__pop"); pop.hidden = true;
    pop.appendChild(el("div", "tb-pop__head", S.lobbyTitle));
    pop.appendChild(settingRow(S.minFaanLabel, String(model.settings.minFaan)));
    pop.appendChild(settingRow(S.capFaanLabel, String(model.settings.capFaan)));
    pop.appendChild(settingRow(S.windsLabel, model.settings.winds === 4 ? S.windsFour : (model.settings.winds === 0 ? S.windsHand : S.windsOne)));
    pop.appendChild(settingRow(S.timerLabel, model.settings.timerSec ? fmt(S.timerSecs, { n: model.settings.timerSec }) : S.timerOff));
    pop.appendChild(settingRow(S.deckLabel, curDeck() === "traditional" ? S.deckTraditional : S.deckNumeral));
    wrap.appendChild(pop);
    var entry = { ctrl: wrap, pill: b, pop: pop, kind: "setth" };
    function peek() { if (openEntry !== entry) pop.hidden = false; }
    function unpeek() { if (openEntry !== entry) pop.hidden = true; }
    wrap.addEventListener("mouseenter", peek);
    wrap.addEventListener("mouseleave", unpeek);
    b.addEventListener("focus", peek);
    b.addEventListener("blur", unpeek);
    b.addEventListener("click", function () {
      togglePop(entry);
      ui.settingsPinned = openEntry === entry;
    });
    if (ui.settingsPinned && openEntry && openEntry.kind === "setth") openPop(entry);
    else ui.settingsPinned = false;
    return wrap;
  }
  function settingRow(label, value) {
    var r = el("div", "mj-setth__row");
    r.appendChild(el("span", "mj-setth__k", label));
    r.appendChild(el("span", "mj-setth__v", value));
    return r;
  }

  /* ── BIG tile: lobby / seating / the table / game over ────────── */
  function renderBig() {
    BIG.textContent = "";
    if (model.phase === "lobby") return renderLobby();
    if (model.phase === "over") return renderOver();
    if (model.phase === "seating") return renderSeating();
    renderTable();
    if (model.handOver) renderHandOver();
  }

  function renderLobby() {
    var wrap = el("div", "mj-lobby");
    wrap.appendChild(el("h2", "mj-lobby__title", S.lobbyTitle));
    var host = model.host;

    // minimum faan: 0 / 1 / 3 / custom text box (host decision, chat 2026-07-23)
    var mfRow = el("div", "mj-set");
    mfRow.appendChild(el("span", "mj-set__label", S.minFaanLabel));
    var mfOpts = el("div", "mj-set__opts");
    var mf = model.settings.minFaan;
    [0, 1, 3].forEach(function (n) {
      var b = el("button", "mj-chip" + (mf === n ? " is-active" : ""), String(n));
      b.type = "button"; b.disabled = !host;
      b.addEventListener("click", function () { ui.minFaanDraft = null; send({ type: "setSettings", minFaan: n }); });
      mfOpts.appendChild(b);
    });
    var custom = el("input", "mj-set__custom" + ([0, 1, 3].indexOf(mf) < 0 ? " is-active" : ""));
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
    mfOpts.appendChild(custom);
    mfRow.appendChild(mfOpts); wrap.appendChild(mfRow);

    // faan cap
    var capRow = el("div", "mj-set");
    capRow.appendChild(el("span", "mj-set__label", S.capFaanLabel));
    var capOpts = el("div", "mj-set__opts");
    [8, 10, 13].forEach(function (n) {
      var b = el("button", "mj-chip" + (model.settings.capFaan === n ? " is-active" : ""), String(n));
      b.type = "button"; b.disabled = !host;
      b.addEventListener("click", function () { send({ type: "setSettings", capFaan: n }); });
      capOpts.appendChild(b);
    });
    capRow.appendChild(capOpts); wrap.appendChild(capRow);

    // match length: one hand, one wind (default), or four winds
    var wRow = el("div", "mj-set");
    wRow.appendChild(el("span", "mj-set__label", S.windsLabel));
    var wOpts = el("div", "mj-set__opts");
    [[0, S.windsHand], [1, S.windsOne], [4, S.windsFour]].forEach(function (o) {
      var b = el("button", "mj-chip" + (model.settings.winds === o[0] ? " is-active" : ""), o[1]);
      b.type = "button"; b.disabled = !host;
      b.addEventListener("click", function () { send({ type: "setSettings", winds: o[0] }); });
      wOpts.appendChild(b);
    });
    wRow.appendChild(wOpts); wrap.appendChild(wRow);

    // turn timer
    var tRow = el("div", "mj-set");
    tRow.appendChild(el("span", "mj-set__label", S.timerLabel));
    var tOpts = el("div", "mj-set__opts");
    [0, 45, 60, 90, 120].forEach(function (n) {
      var b = el("button", "mj-chip" + (model.settings.timerSec === n ? " is-active" : ""), n === 0 ? S.timerOff : fmt(S.timerSecs, { n: n }));
      b.type = "button"; b.disabled = !host;
      b.addEventListener("click", function () { send({ type: "setSettings", timerSec: n }); });
      tOpts.appendChild(b);
    });
    tRow.appendChild(tOpts); wrap.appendChild(tRow);

    // tile art: which sprite deck the whole table sees (cosmetic, host's
    // call like every other setting). Chips carry live sample sprites.
    var dRow = el("div", "mj-set");
    dRow.appendChild(el("span", "mj-set__label", S.deckLabel));
    var dOpts = el("div", "mj-set__opts");
    DECKS.forEach(function (d) {
      var b = el("button", "mj-chip mj-deck__chip" + (curDeck() === d ? " is-active" : ""));
      b.type = "button"; b.disabled = !host;
      b.appendChild(el("span", null, d === "numeral" ? S.deckNumeral : S.deckTraditional));
      ["tile-p5", "tile-s3"].forEach(function (name) {
        if (!sprites[d][name]) return;
        var img = document.createElement("img");
        img.className = "mj-deck__sample"; img.alt = "";
        img.src = SPRITE_ROOT + d + "/" + name + ".png";
        b.appendChild(img);
      });
      b.addEventListener("click", function () { send({ type: "setSettings", deck: d }); });
      dOpts.appendChild(b);
    });
    dRow.appendChild(dOpts); wrap.appendChild(dRow);

    // seats (four, always)
    var seatList = el("div", "mj-lobby__seats");
    (model.seats || []).forEach(function (s, i) {
      var isBot = !s.empty && s.phantom;
      if (ui.botEdit === i && !(host && (s.empty || isBot))) { ui.botEdit = null; ui.botDraft = null; }
      if (ui.botEdit === i) { seatList.appendChild(botEditorRow(i)); return; }
      var row = el("div", "mj-seat" + (s.empty ? " mj-seat--empty" : ""));
      var editable = !s.empty && (s.seat === mySeat() || (host && s.phantom));
      row.appendChild(editable ? dotButton(s, i) : seatDot(i));
      var label = s.empty ? S.seatOpen : s.seat === mySeat() ? fmt(S.seatYou, { name: s.name }) : isBot ? fmt(S.botSeatTag, { name: s.name }) : s.name;
      if (host && isBot) {
        var nameBtn = el("button", "mj-seat__name mj-seat__namebtn", label); nameBtn.type = "button";
        nameBtn.setAttribute("aria-label", fmt(S.renameBotAria, { name: s.name }));
        nameBtn.addEventListener("click", function () { ui.botEdit = i; ui.botDraft = s.name; ui.botFocus = true; render(); });
        row.appendChild(nameBtn);
      } else row.appendChild(el("span", "mj-seat__name", label));
      if (model.hostSeat === i) row.appendChild(el("span", "mj-seat__badge", S.hostBadge));
      if (host && s.empty) {
        var add = el("button", "mj-seat__addbot", S.addBotButton); add.type = "button";
        add.addEventListener("click", function () { ui.botEdit = i; ui.botDraft = null; ui.botFocus = true; render(); });
        row.appendChild(add);
      }
      if (host && !s.empty && s.seat !== mySeat()) {
        var kick = el("button", "mj-seat__kick", "✕"); kick.type = "button";
        kick.setAttribute("aria-label", fmt(S.kickSeatAria, { name: s.name || "" }));
        kick.addEventListener("click", function () { send({ type: "kickSeat", seat: i }); });
        row.appendChild(kick);
      }
      seatList.appendChild(row);
      if (editable) seatList.appendChild(colorPicker(s, i));
    });
    if (ui.colorOpen != null) {
      var stillOpen = seatList.querySelector('[data-colorpick="' + ui.colorOpen + '"]');
      if (!stillOpen) { ui.colorOpen = null; ui.colorDraft = null; }
    }
    wrap.appendChild(seatList);

    if (host) {
      var startRow = el("div", "mj-lobby__startrow");
      var start = el("button", "tb-pill mj-lobby__start");
      start.type = "button";
      start.appendChild(el("span", "tb-pill__label", S.startButton));
      var ready = seatedCount() === 4;
      start.disabled = !ready;
      start.addEventListener("click", function () { send({ type: "start" }); });
      startRow.appendChild(start);
      var shuf = el("button", "tb-pill mj-lobby__start");
      shuf.type = "button";
      shuf.appendChild(el("span", "tb-pill__label", S.shufflePill));
      shuf.disabled = seatedCount() < 2;
      shuf.addEventListener("click", function () { send({ type: "shuffle" }); });
      startRow.appendChild(shuf);
      wrap.appendChild(startRow);
      wrap.appendChild(el("p", "mj-lobby__hint", ready ? S.startHint : S.startNeedsFour));
    }
    BIG.appendChild(wrap);
  }
  function seatDot(i) { var d = el("span", "mj-dot"); d.style.background = "var(--mjseat-" + i + ")"; return d; }

  var BOT_NAMES = ["Rook", "Vala", "Ozan", "Mira", "Deca"];
  function nextBotName() {
    var used = {};
    (model.seats || []).forEach(function (s) { if (s && !s.empty && s.name) used[s.name.toLowerCase()] = 1; });
    for (var pi = 0; ; pi++) {
      var gen = Math.floor(pi / BOT_NAMES.length);
      var name = BOT_NAMES[pi % BOT_NAMES.length] + (gen ? " " + (gen + 1) : "");
      if (!used[name.toLowerCase()]) return name;
    }
  }
  function botEditorRow(i) {
    var row = el("div", "mj-seat mj-seat--edit");
    row.appendChild(seatDot(i));
    var input = el("input", "mj-seat__nameinput");
    input.type = "text"; input.maxLength = 24;
    input.value = ui.botDraft != null ? ui.botDraft : nextBotName();
    input.setAttribute("aria-label", S.addBotNameAria);
    input.addEventListener("input", function () { ui.botDraft = input.value; });
    var go = function () {
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      send({ type: "addBot", seat: i, name: name });
      ui.botEdit = null; ui.botDraft = null; render();
    };
    var cancel = function () { ui.botEdit = null; ui.botDraft = null; render(); };
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") go();
      else if (ev.key === "Escape") cancel();
    });
    row.appendChild(input);
    var ok = el("button", "mj-seat__addgo", S.addBotGo); ok.type = "button";
    ok.addEventListener("click", go);
    row.appendChild(ok);
    var x = el("button", "mj-seat__kick", "✕"); x.type = "button";
    x.setAttribute("aria-label", S.addBotCancelAria);
    x.addEventListener("click", cancel);
    row.appendChild(x);
    if (ui.botFocus) { ui.botFocus = false; setTimeout(function () { if (input.isConnected) { input.focus(); input.select(); } }, 0); }
    return row;
  }
  function applySeatColors() {
    var root = document.querySelector(".mj");
    if (!root || !model) return;
    (model.seats || []).forEach(function (s, i) {
      if (s && s.color) root.style.setProperty("--mjseat-" + i, s.color);
    });
  }

  /* ── lobby seat-color picker (cities' slide-open expand) ──────── */
  function dotButton(s, i) {
    var b = el("button", "mj-seat__dotbtn"); b.type = "button";
    b.setAttribute("data-colorseat", i);
    b.setAttribute("aria-expanded", ui.colorOpen === i ? "true" : "false");
    b.setAttribute("aria-label", fmt(S.colorDotAria, { name: s.name }));
    b.appendChild(seatDot(i));
    b.addEventListener("click", function () { toggleColorPick(i); });
    return b;
  }
  function toggleColorPick(i) {
    ui.colorOpen = ui.colorOpen === i ? null : i;
    ui.colorDraft = null;
    Array.prototype.forEach.call(BIG.querySelectorAll("[data-colorpick]"), function (p) {
      p.classList.toggle("is-open", +p.getAttribute("data-colorpick") === ui.colorOpen);
    });
    Array.prototype.forEach.call(BIG.querySelectorAll("[data-colorseat]"), function (b) {
      b.setAttribute("aria-expanded", +b.getAttribute("data-colorseat") === ui.colorOpen ? "true" : "false");
    });
  }
  function sendRecolor(i, hex) {
    send({ type: "recolor", seat: i, color: hex });
    if (ui.colorOpen === i) toggleColorPick(i);
  }
  function colorPicker(s, i) {
    var wrap = el("div", "mj-colorpick" + (ui.colorOpen === i ? " is-open" : ""));
    wrap.setAttribute("data-colorpick", i);
    var slide = el("div", "mj-colorpick__inner");
    var inner = el("div", "mj-colorpick__body");
    inner.appendChild(el("span", "mj-colorpick__label",
      s.seat === mySeat() ? S.colorYours : fmt(S.colorTheirs, { name: s.name })));
    var others = (model.seats || []).map(function (o) {
      return o.empty || o.seat === i ? null : o.color;
    });
    var sw = el("div", "mj-colorpick__swatches");
    Colors.PRESETS.forEach(function (hex) {
      var b = el("button", "mj-colorpick__swatch"); b.type = "button";
      b.style.background = hex;
      if (hex === s.color) b.classList.add("is-current");
      var ci = Colors.clash(hex, others);
      if (ci >= 0) {
        b.disabled = true;
        b.title = fmt(S.colorTakenBy, { name: seatName(ci) });
        b.setAttribute("aria-label", fmt(S.colorTakenBy, { name: seatName(ci) }));
      } else {
        b.setAttribute("aria-label", S.colorSwatchAria);
        b.addEventListener("click", function () { sendRecolor(i, hex); });
      }
      sw.appendChild(b);
    });
    var savedCustom = Colors.norm(load(CUSTOM_COLOR_KEY, null));
    var cb = el("button", "mj-colorpick__swatch mj-colorpick__swatch--custom");
    cb.type = "button";
    if (savedCustom) {
      cb.style.background = savedCustom;
      if (savedCustom === s.color) cb.classList.add("is-current");
      var cci = Colors.clash(savedCustom, others);
      if (cci >= 0 && savedCustom !== s.color) {
        cb.disabled = true;
        cb.title = fmt(S.colorTakenBy, { name: seatName(cci) });
      } else {
        cb.setAttribute("aria-label", S.colorCustomAria);
        cb.addEventListener("click", function () { sendRecolor(i, savedCustom); });
      }
    } else {
      cb.classList.add("is-empty");
      cb.setAttribute("aria-label", S.colorCustomAria);
      cb.addEventListener("click", function () { input.focus(); });
    }
    sw.appendChild(cb);
    inner.appendChild(sw);
    var row = el("div", "mj-colorpick__custom");
    row.appendChild(el("span", "mj-colorpick__hexlabel", S.colorHexLabel));
    var input = el("input", "mj-colorpick__hexinput");
    input.type = "text"; input.spellcheck = false; input.maxLength = 8;
    input.value = ui.colorDraft != null ? ui.colorDraft : s.color;
    var become = el("button", "mj-chip mj-colorpick__go", S.colorBecome);
    become.type = "button";
    var note = el("span", "mj-colorpick__msg");
    function validate() {
      var hex = Colors.norm(input.value);
      var ci = hex ? Colors.clash(hex, others) : -1;
      var bad = !hex ? (input.value.trim() ? S.colorBadHex : "")
              : ci >= 0 ? fmt(S.colorClashWith, { name: seatName(ci) }) : "";
      note.textContent = bad;
      become.disabled = !hex || ci >= 0;
      return become.disabled ? null : hex;
    }
    function becomeCustom() {
      var hex = validate();
      if (!hex) return;
      save(CUSTOM_COLOR_KEY, hex);
      sendRecolor(i, hex);
    }
    input.addEventListener("input", function () { ui.colorDraft = input.value; validate(); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") becomeCustom(); });
    become.addEventListener("click", becomeCustom);
    validate();
    row.appendChild(input); row.appendChild(become); row.appendChild(note);
    inner.appendChild(row);
    slide.appendChild(inner);
    wrap.appendChild(slide);
    return wrap;
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
      pad.style.setProperty("--mjstrip", "var(--mjseat-" + i + ")");
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
      zone.style.setProperty("--mjstrip", "var(--mjseat-" + seat + ")");
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
    var ms = Math.max(0, model.handOverAt - (Date.now() - clockSkew));
    node.textContent = fmt(S.nextHandAuto, { n: Math.ceil(ms / 1000) });
    nextHandTick = setTimeout(function () { if (node.isConnected) tickNextHand(node); }, 250);
  }
  function faanName(key) {
    var k = "faan" + key.charAt(0).toUpperCase() + key.slice(1);
    return S[k] || key;
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
      rb.addEventListener("click", function () { toast(S.rematchSoon, "info"); });
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
    return Math.max(0, model.turnEndsAt - (Date.now() - clockSkew));
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
      strip.style.setProperty("--mjstrip", "var(--mjseat-" + i + ")");
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

  /* ═══ BOOT ═════════════════════════════════════════════════════ */
  window.addEventListener("resize", function () {
    if (!joined || !model) return;
    render();
  });
  function boot() {
    var hash = slugify((location.hash || "").replace(/^#/, ""));
    if (hash) { BAR_INPUT.value = hash; commitCode(hash); }
  }
  window.addEventListener("hashchange", function () {
    var h = slugify((location.hash || "").replace(/^#/, ""));
    if (h && h !== code) commitCode(h);
  });
  boot();
})();
