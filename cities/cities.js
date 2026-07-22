/* DeetsCities — page UI (docs/cities.md, "Page layout — the bento").

   Gate, lobby, SVG board + placement interactions, dice / players / log
   tiles, the role tile (hand + action pills), trade overlay, forced
   interrupts, and the game-over stats reveal. Transport-agnostic: talks to
   window.CitiesTransport (the ?mock in-page fake or the real WS client), which
   speaks the wire protocol from docs/cities.md. The rules live in engine.js;
   client affordances here (dimmed vertices, disabled pills) are COSMETIC — the
   server re-validates every action.

   Per the site's deliberate-duplication convention this file carries its own
   copy of the toolbar/popover kit (fifth copy: sotd, movies, league, radio,
   cities) — a fix to that machinery must be mirrored across all five.

   All flavor copy comes from strings.js; the terse mechanical LOG lines are
   authored here (rendered from typed event records, never sent as prose). The
   board + cards use the fixed game palette (a token-discipline carve-out, in
   main.css); everything else rides the themes.css / skin.css tokens. */
(function () {
  "use strict";

  var T = window.CitiesTransport;
  var S = window.CITIES_STRINGS || {};
  var Engine = window.CitiesEngine;
  var Colors = window.CitiesColors;
  var Boards = window.CITIES_BOARDS.BOARDS;
  var RES = Engine.RES;

  /* ── DOM handles ──────────────────────────────────────────────── */
  var BAR_INPUT = document.querySelector("[data-cities-code]");
  var CODE_POP = document.querySelector("[data-cities-code-pop]");
  var TOOLBAR = document.querySelector("[data-cities-toolbar]");
  var GATE = document.querySelector("[data-cities-gate]");
  var TABLE = document.querySelector("[data-cities-table]");
  var BIG = document.querySelector("[data-cities-big]");
  var DICE = document.querySelector("[data-cities-dice]");
  var PLAYERS = document.querySelector("[data-cities-players]");
  var LOG = document.querySelector("[data-cities-log]");
  var ROLE = document.querySelector("[data-cities-role]");
  var TRADE = document.querySelector("[data-cities-trade]");
  var DESKTOP = document.querySelector("[data-cities-desktop]");

  /* ── small helpers ────────────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function load(key, fb) { try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fb : v; } catch (e) { return fb; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  function slugify(raw) { return String(raw || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24); }
  function fmt(tpl, vals) { return String(tpl || "").replace(/\{(\w+)\}/g, function (_, k) { return vals && vals[k] != null ? vals[k] : ""; }); }
  function reduceMotion() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  var TOKEN_KEY = "deets-cities-token", NAME_KEY = "deets-cities-name", RECENTS_KEY = "deets-cities-recents";
  var CUSTOM_COLOR_KEY = "deets-cities-customhex";   // last custom hex Become'd — the picker's 7th swatch
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

  // No meta line on this page (the bento sits flush under the bar) — every
  // transient notice goes through the toast host. `opts` passes through
  // sticky / actions for the trade-accepted alert.
  function toast(text, kind, opts) {
    if (!window.DeetsToast) return { dismiss: function () {} };
    var o = { kind: kind || "info", text: text };
    if (opts) for (var k in opts) o[k] = opts[k];
    return window.DeetsToast.push(o);
  }

  /* ── display-name maps (from strings; the carve-out's labels) ─── */
  var RES_NAME = { wood: S.resWood, brick: S.resBrick, wheat: S.resWheat, sheep: S.resSheep, ore: S.resOre };
  var PIECE_NAME = { settlement: S.pieceSettlement, city: S.pieceCity, road: S.pieceRoad };
  var DEV_NAME = { knight: S.devKnight, road: S.devRoad, plenty: S.devPlenty, monopoly: S.devMonopoly, vp: S.devVp };
  var DEV_DESC = { knight: S.devKnightDesc, road: S.devRoadDesc, plenty: S.devPlentyDesc, monopoly: S.devMonopolyDesc, vp: S.devVpDesc };
  var BUILD_COST = { road: { wood: 1, brick: 1 }, settlement: { wood: 1, brick: 1, wheat: 1, sheep: 1 }, city: { ore: 3, wheat: 2 }, dev: { ore: 1, sheep: 1, wheat: 1 } };
  function resName(r) { return RES_NAME[r] || r; }
  function seatName(i) { return (model && model.seats && model.seats[i] && model.seats[i].name) || ("Seat " + (i + 1)); }

  /* ── popover kit (mirrored from league.js / radio.js) ─────────── */
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
  var logLines = [], connToast = null, spinUntil = 0;
  var LOGVIEW_KEY = "deets-cities-logview";
  var logView = load(LOGVIEW_KEY, "deck");   // log tile rail: "log" | "deck" — sticky across sessions, Deck by default
  var lastTurnSeat = null;   // players tile: scroll-to-active fires on change only
  var clockSkew = 0, timerHandle = null;   // clockSkew = Date.now() - server clock
  var ui = { mode: null, build: null, plentyPick: [], actionMenu: null, tradeHub: false, tradeTool: null, embargoPop: null, overExpanded: {}, colorOpen: null, colorDraft: null, botEdit: null, botDraft: null, botFocus: false };   // transient board-interaction state
  var acceptToasts = {};   // "offerId:seat" -> sticky accepted-toast handle
  var graceToasts = {};    // seat -> { handle, until, timer } — red disconnect-grace countdowns
  var offerCache = {};     // last-seen offer bundles (for the decline-fade ghost)
  var fadingOffers = {};   // id -> offer snapshot, briefly rendered fading out
  var ledger = null, ledgerSeat = null;   // "since your last turn" hand ledger (client-only; resets when my turn starts)
  var prevHand = null;     // my hand as of the PREVIOUS broadcast (monopoly-loss attribution)
  var lastDiscard = null;  // composition of my in-flight 7-discard (the event carries only the count)

  /* ── embargoes ("I hate you") — a CLIENT-side preference, per table ──
     Stored in localStorage keyed by table code + seat index. An embargoed
     seat's offers are auto-declined on arrival, and their responses to MY
     offers are treated as declined (their strip is never closeable). The
     server knows nothing about it. */
  var EMBARGO_KEY = "deets-cities-embargo";
  function embargoList() { var m = load(EMBARGO_KEY, {}); return (code && m[code]) || []; }
  function isEmbargoed(s) { return embargoList().indexOf(s) >= 0; }
  function toggleEmbargo(s) {
    var m = load(EMBARGO_KEY, {});
    var list = (code && m[code]) || [];
    var i = list.indexOf(s);
    if (i >= 0) list.splice(i, 1); else list.push(s);
    m[code] = list; save(EMBARGO_KEY, m);
    return i < 0;   // true = now embargoed
  }
  function declineOpenOffersFrom(s) {
    var me = mySeat();
    if (me == null) return;
    ((model && model.offers) || []).forEach(function (o) {
      if (o.from === s && !(o.responses && o.responses[me])) send({ type: "respond", offerId: o.id, action: "decline" });
    });
  }

  /* ═══ BAR: code combobox + recents ═════════════════════════════ */
  if (BAR_INPUT) {
    BAR_INPUT.placeholder = S.tableCodePlaceholder || "";
    BAR_INPUT.setAttribute("aria-label", S.tableCodePlaceholder || "Table code");
    BAR_INPUT.addEventListener("focus", function () { fillCodePop(); if (recents().length) openCodePop(); BAR_INPUT.select(); });
    BAR_INPUT.addEventListener("input", function () {
      var slug = slugify(BAR_INPUT.value);
      BAR_INPUT.setAttribute("data-slug", slug && slug !== BAR_INPUT.value ? slug : "");
    });
    BAR_INPUT.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commitCode(BAR_INPUT.value); BAR_INPUT.blur(); }
    });
  }
  var codeEntry = { ctrl: document.querySelector(".cities-code"), pill: null, pop: CODE_POP };
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
    BAR_INPUT.setAttribute("data-slug", "");
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
    // an existing table always offers BOTH pills — Sit down (grayed when
    // there's no seat to take: full lobby, or a running game) + Spectate
    var full = p.exists && p.phase === "lobby" && p.seated >= p.capacity;
    var canSit = p.exists && p.phase === "lobby" && !full;
    var line;
    if (refuseName) line = S.nameTaken;
    else if (!p.exists) line = fmt(S.createLine, { code: c });
    else if (full) line = fmt(S.peekFull, { spectators: p.spectators });
    else line = fmt(S.peekPlayers, { seated: p.seated, spectators: p.spectators });
    GATE.appendChild(el("p", "cities-gate__line", line));

    var form = el("div", "cities-gate__form");
    var stored = String(load(NAME_KEY, "")).trim();
    var nameInput = null;
    if (!stored || refuseName) {
      var wrap = el("label", "cities-gate__name");
      wrap.appendChild(el("span", "cities-gate__name-label", S.nameLabel));
      nameInput = el("input", "cities-gate__name-input"); nameInput.type = "text"; nameInput.maxLength = 24; nameInput.value = stored;
      wrap.appendChild(nameInput); form.appendChild(wrap);
    }
    var btns = [];
    function goBtn(label, asWatch, enabled) {
      var b = el("button", "tb-pill cities-gate__go");
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
      ui.wantSit = !asSpectator;   // opening or joining a lobby means "I want to play"; only Watch stays a spectator
      remember(c);
      try { history.replaceState(null, "", "#" + c); } catch (e) {}
    }).catch(function (err) {
      joining = false;
      var ec = err && err.code;
      if (ec === "name-taken") { renderGate(c, { exists: true, phase: "lobby", seated: 0, capacity: 6, spectators: 0 }, true); return; }
      toast(ec === "no-table" ? S.noTable : ec === "full" ? S.tableFull : S.peekFailed, "error");
    });
  }
  function leaveTable() {
    if (conn) conn.close();
    conn = null; model = null; joined = false; code = null; logLines = [];
    if (connToast) { connToast.dismiss(); connToast = null; }
    Object.keys(acceptToasts).forEach(function (k) { acceptToasts[k].dismiss(); });
    acceptToasts = {};
    clearGraceToasts();
    offerCache = {}; fadingOffers = {};
    ledger = null; ledgerSeat = null; prevHand = null; lastDiscard = null;
    document.removeEventListener("click", onEmbargoDocClick, true);
    document.removeEventListener("keydown", onEmbargoKey);
    ui = { mode: null, build: null, plentyPick: [], actionMenu: null, tradeHub: false, tradeTool: null, embargoPop: null, botEdit: null, botDraft: null, botFocus: false };
    tradeToolEl = null;
    lastTurnSeat = null;
    GATE.hidden = true; TABLE.hidden = true; DESKTOP.hidden = true;
    ROLE.style.minHeight = "";
    buildToolbar();
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }
  function send(msg) { if (conn) conn.send(msg); }

  /* ═══ MESSAGE HANDLING ═════════════════════════════════════════ */
  function onMessage(msg) {
    if (msg.type === "kicked") { toast(S.kickedMeta, "error"); leaveTable(); return; }
    if (msg.type === "closed") { toast(S.tableClosed, "info"); leaveTable(); return; }
    if (msg.type === "error") { toast(errText(msg.code), "error"); return; }
    if (msg.type === "snapshot") { prevHand = (model && model.you && model.you.hand) || null; model = stripMeta(msg); afterModel(msg); return; }
    if (msg.type === "state") {
      if (!model) model = {};
      prevHand = (model.you && model.you.hand) || null;   // pre-merge hand; safe to hold — every delivery is a fresh clone
      for (var k in msg) if (k !== "type" && k !== "v" && k !== "serverNow" && k !== "ev") model[k] = msg[k];
      afterModel(msg);
      return;
    }
  }
  function stripMeta(msg) { var m = {}; for (var k in msg) if (k !== "type" && k !== "v" && k !== "serverNow" && k !== "ev") m[k] = msg[k]; return m; }
  function afterModel(msg) {
    if (typeof msg.serverNow === "number") clockSkew = Date.now() - msg.serverNow;
    if (mySeat() !== ledgerSeat) { ledgerSeat = mySeat(); resetLedger(); }
    (msg.ev || []).forEach(handleEvent);
    sweepAcceptToasts();
    syncGraceToasts();
    // auto-sit: a "Sit down" / "Open table" gate join lands as a spectator in
    // the lobby; take a seat once (the toolbar's Sit/Stand governs after)
    if (ui.wantSit && model.phase === "lobby" && mySeat() == null) { ui.wantSit = false; send({ type: "sit" }); }
    // clear a placement mode that no longer applies
    if (ui.mode && !modeStillValid()) ui.mode = null;
    // decide board-interaction mode BEFORE rendering the board
    autoSetupMode();
    syncPendingMode();
    applySeatColors();
    GATE.hidden = true;
    render();
    // refresh AFTER handleEvent ran: the fade ghost needs the previous
    // broadcast's copy of an offer this broadcast just removed
    offerCache = {};
    (model.offers || []).forEach(function (o) { offerCache[o.id] = o; });
  }
  // pending interrupts I own drive the board's click affordances
  function syncPendingMode() {
    if (!model || model.phase !== "main" || !isMyTurn()) return;
    var p = model.turn.pending;
    if (!p) return;
    if (p.kind === "robber") ui.mode = "robber";
    else if (p.kind === "roads") ui.mode = "roads";
    else if (p.kind === "steal") ui.mode = "steal";
  }
  function handleEvent(e) {
    if (e.t === "roll") spinUntil = Date.now() + (reduceMotion() ? 0 : 620);
    // disconnect-grace trio (worker only; the mock never emits these). The
    // sticky countdown itself is model-driven — syncGraceToasts reads
    // seat.graceUntil — so these are just the one-shot resolution lines.
    if (e.t === "returned") toast(fmt(S.returnedToast, { name: seatName(e.seat) }), "success");
    if (e.t === "takeover") toast(fmt(S.takeoverToast, { name: seatName(e.seat) }), "warn");
    // an incoming offer pops the trade hub so the accept/decline is right
    // there — unless the sender is embargoed: then it's declined on sight
    if (e.t === "offer" && e.from !== mySeat()) {
      if (mySeat() != null && isEmbargoed(e.from)) send({ type: "respond", offerId: e.id, action: "decline" });
      else { ui.tradeHub = true; toast(fmt(S.offerIncoming, { name: seatName(e.from) }), "info"); }
    }
    if (e.t === "respond" && e.action === "accept") acceptToast(e);
    // a fully-declined offer fades out: snapshot it (the model has already
    // dropped it) and render the ghost briefly
    if (e.t === "offerGone" && e.declined && offerCache[e.id]) {
      (function (id) {
        fadingOffers[id] = offerCache[id];
        setTimeout(function () { delete fadingOffers[id]; if (model) render(); }, 600);
      })(e.id);
    }
    ledgerEvent(e);
    var line = logLine(e);
    if (line) { logLines.push(line); if (logLines.length > 120) logLines.shift(); }
  }

  /* ── the "since your last turn" hand ledger (client-only) ───────
     Accumulates EXTERNAL hand changes — rolls, steals both directions,
     monopoly, Year of Plenty, my 7-discards — per resource, with
     per-source counts feeding the row's hover title. Deliberately
     excludes my own builds/buys/trades (I clicked those; they aren't
     "visually quiet"). Resets when MY turn starts, on game start, and
     on seat change; lives only in session memory, so a mid-window
     refresh starts blank — same tradeoff as the log tile. */
  function resetLedger() {
    ledger = {};
    RES.forEach(function (r) { ledger[r] = { net: 0, parts: {}, order: [] }; });
  }
  function ledgerAdd(res, n, label) {
    if (!ledger || !ledger[res] || !n) return;
    var g = ledger[res];
    g.net += n;
    if (!(label in g.parts)) { g.parts[label] = 0; g.order.push(label); }
    g.parts[label] += n;
  }
  function ledgerEvent(e) {
    var me = mySeat();
    if (me == null || !ledger) return;
    if (e.t === "start" || (e.t === "turn" && e.seat === me)) { resetLedger(); return; }
    if (e.t === "gain" && e.seat === me) ledgerAdd(e.res, e.n, e.src === "dev" ? S.ledgerDev : S.ledgerRoll);
    if (e.t === "stealHidden" && e.res != null) {   // res rides the event only for the two parties
      if (e.to === me) ledgerAdd(e.res, 1, fmt(S.ledgerStole, { name: seatName(e.from) }));
      if (e.from === me) ledgerAdd(e.res, -1, fmt(S.ledgerRobbed, { name: seatName(e.to) }));
    }
    if (e.t === "monopoly") {
      if (e.seat === me) ledgerAdd(e.res, e.n, S.ledgerMonopolyGain);
      else if (prevHand) ledgerAdd(e.res, -(prevHand[e.res] || 0), fmt(S.ledgerMonopoly, { name: seatName(e.seat) }));
    }
    if (e.t === "discard" && e.seat === me && lastDiscard) {
      RES.forEach(function (r) { if (lastDiscard[r]) ledgerAdd(r, -lastDiscard[r], S.ledgerDiscard); });
      lastDiscard = null;
    }
  }
  // someone accepted MY open offer: a sticky success toast whose action closes
  // the deal (only the current player can close, so gate on my live turn)
  function acceptToast(e) {
    var o = (model.offers || []).filter(function (x) { return x.id === e.id; })[0];
    if (!o || o.from !== mySeat() || !isMyTurn() || e.seat === mySeat()) return;
    if (isEmbargoed(e.seat)) return;   // their accept counts for nothing
    var key = e.id + ":" + e.seat;
    if (acceptToasts[key]) acceptToasts[key].dismiss();
    acceptToasts[key] = toast(fmt(S.offerAccepted, { name: seatName(e.seat) }), "success", {
      sticky: true,
      actions: [
        { label: S.tradeClose + " · " + seatName(e.seat), onPick: function () { send({ type: "close", offerId: e.id, accepter: e.seat }); } },
        { label: S.toastDismiss }
      ]
    });
  }
  // retire accepted-toasts whose offer is gone, closed, or re-answered
  function sweepAcceptToasts() {
    Object.keys(acceptToasts).forEach(function (k) {
      var i = k.lastIndexOf(":"), id = k.slice(0, i), s = +k.slice(i + 1);
      var o = ((model && model.offers) || []).filter(function (x) { return x.id === id; })[0];
      var live = o && model.phase === "main" && o.responses && o.responses[s] === "accept" && !isEmbargoed(s);
      if (!live) { acceptToasts[k].dismiss(); delete acceptToasts[k]; }
    });
  }
  function errText(codeStr) {
    var map = { cost: S.errCost, loc: S.errLoc, turn: S.errTurn, phase: S.errPhase, rate: S.errRate, perm: S.errPerm, full: S.errFull, empty: S.errEmpty, supply: S.errSupply, "no-table": S.noTable, "name-taken": S.nameTaken, color: S.errColor, "color-taken": S.errColorTaken, flood: S.errFlood };
    return map[codeStr] || S.errPhase;
  }

  /* ── disconnect-grace countdown (the red toast) ─────────────────
     Authoritative state is the seat's graceUntil in every broadcast
     (docs/cities.md, "Disconnects → grace → bot takeover"), so the sticky
     toast is reconciled from the model — a spectator joining mid-grace
     sees it from their first snapshot, no `leaving` event needed. Ticks
     locally off serverNow's clockSkew, like the turn box. */
  function graceSecs(until) { return Math.max(0, Math.ceil((until - (Date.now() - clockSkew)) / 1000)); }
  function syncGraceToasts() {
    var live = {};
    (model.seats || []).forEach(function (s, i) { if (s && !s.empty && s.graceUntil && !s.bot) live[i] = s.graceUntil; });
    Object.keys(graceToasts).forEach(function (k) {
      if (live[k] == null) {
        clearInterval(graceToasts[k].timer);
        graceToasts[k].handle.dismiss();
        delete graceToasts[k];
      }
    });
    Object.keys(live).forEach(function (k) {
      if (graceToasts[k]) { graceToasts[k].until = live[k]; return; }
      var seat = +k;
      var entry = { until: live[k], handle: null, timer: null };
      var line = function () { return fmt(S.leavingToast, { name: seatName(seat), secs: graceSecs(entry.until) }); };
      entry.handle = toast(line(), "error", { sticky: true });
      entry.timer = setInterval(function () { entry.handle.update(line()); }, 250);
      graceToasts[k] = entry;
    });
  }
  function clearGraceToasts() {
    Object.keys(graceToasts).forEach(function (k) { clearInterval(graceToasts[k].timer); graceToasts[k].handle.dismiss(); });
    graceToasts = {};
  }

  /* ── typed events → terse mechanical log lines (Claude-authored) ─
     Entries are structured, resolved at event time (names can change later):
       { divider: "Turn 4: Vala" }             — full-width turn rule
       { parts: ["Vala +1 ", { res: "wood" }] } — strings + tinted resource words */
  function logLine(e) {
    var n = function (i) { return seatName(i); };
    var R = function (r) { return { res: r }; };
    var L = function () { return { parts: Array.prototype.slice.call(arguments) }; };
    switch (e.t) {
      case "roll": return L(n(e.seat) + " rolled " + (e.d[0] + e.d[1]) + " (" + e.d[0] + "+" + e.d[1] + ")");
      case "gain": return L(n(e.seat) + " +" + e.n + " ", R(e.res));
      case "build": return L(n(e.seat) + " built a " + (PIECE_NAME[e.kind] || e.kind).toLowerCase());
      case "robber7": return L(n(e.seat) + " rolled a 7");
      case "discard": return L(n(e.seat) + " discarded " + e.n);
      case "robber": return L(n(e.seat) + " moved the robber");
      case "stealHidden": return L(n(e.to) + " stole from " + n(e.from));
      case "devBought": return L(n(e.seat) + " bought a dev card");
      case "devPlayed": return L(n(e.seat) + " played " + (DEV_NAME[e.card] || e.card));
      case "monopoly": return L(n(e.seat) + " monopolized ", R(e.res), " (" + e.n + ")");
      case "bankTrade": return L(n(e.seat) + " traded " + (e.rate * (e.n || 1)) + " ", R(e.give), " → " + (e.n || 1) + " ", R(e.get));
      case "trade": return L(n(e.from) + " ⇄ " + n(e.to));
      case "award": return L(e.seat == null ? (awardName(e.kind) + " lost") : (n(e.seat) + " took " + awardName(e.kind)));
      case "turn": return { divider: e.n != null ? ("Turn " + e.n + ": " + n(e.seat)) : (n(e.seat) + "'s turn") };
      case "start": return L("Game on (" + e.frame + " board)");
      case "win": return L(n(e.seat) + " wins!");
      case "abandon": return L("Game abandoned");
      default: return null;
    }
  }
  function awardName(k) { return k === "longestRoad" ? S.awardRoad : S.awardArmy; }

  /* ── robber sprite swap point (assets/sprites/cities/README.md) ──
     Aditya's hand-drawn robber.png replaces the placeholder circle the
     moment the file exists — probed ONCE at load (a missing sprite costs
     one quiet 404, and rendering never re-fetches a broken image). */
  var ROBBER_SRC = "../assets/sprites/cities/robber.png";
  var robberSprite = false;
  (function () {
    var probe = new Image();
    probe.onload = function () { robberSprite = true; if (model) render(); };
    probe.src = ROBBER_SRC;
  })();

  /* ═══ GEOMETRY (render) ════════════════════════════════════════ */
  var SIZE = 42;
  function hexCenter(q, r) { return { x: SIZE * Math.sqrt(3) * (q + r / 2), y: SIZE * 1.5 * r }; }
  function vertexXY(vid) {
    var p = vid.split(","), q = +p[0], r = +p[1], c = hexCenter(q, r);
    return { x: c.x, y: c.y + (p[2] === "N" ? -SIZE : SIZE) };
  }
  function hexCorners(q, r) {
    var c = hexCenter(q, r), pts = [];
    for (var i = 0; i < 6; i++) {
      var a = (Math.PI / 180) * (60 * i - 30);
      pts.push((c.x + SIZE * Math.cos(a)).toFixed(1) + "," + (c.y + SIZE * Math.sin(a)).toFixed(1));
    }
    return pts.join(" ");
  }
  function geo() { return Engine.geoOf(model.board); }
  function mySeat() { return model && model.you ? model.you.seat : null; }
  function isMyTurn() { return model.turn && model.turn.seat === mySeat() && mySeat() != null; }

  /* ── client-side legality (cosmetic; server re-validates) ─────── */
  function touchesOwnRoad(v, seat) { var g = geo(); return (g.vertexEdges[v] || []).some(function (e) { return model.roads[e] === seat; }); }
  function roadConnects(e, seat) {
    var g = geo(), vs = g.edgeVertices[e];
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i], b = model.buildings[v];
      if (b && b.seat === seat) return true;
      if (b && b.seat !== seat) continue;
      var edges = g.vertexEdges[v] || [];
      for (var j = 0; j < edges.length; j++) if (edges[j] !== e && model.roads[edges[j]] === seat) return true;
    }
    return false;
  }
  function legalSettlements(setup) {
    var g = geo(), seat = mySeat(), out = [];
    Object.keys(g.vertexHexes).forEach(function (v) {
      if (model.buildings[v]) return;
      if ((g.vertexNeighbors[v] || []).some(function (n) { return model.buildings[n]; })) return;
      if (!setup && !touchesOwnRoad(v, seat)) return;
      // setup: the mandatory adjoining road needs a free edge (engine rule)
      if (setup && !(g.vertexEdges[v] || []).some(function (e) { return model.roads[e] == null; })) return;
      out.push(v);
    });
    return out;
  }
  function legalRoads(setup, lastVid) {
    var g = geo(), seat = mySeat(), out = [];
    Object.keys(g.edgeVertices).forEach(function (e) {
      if (model.roads[e] != null) return;
      if (setup) { if (g.edgeVertices[e].indexOf(lastVid) >= 0) out.push(e); return; }
      if (roadConnects(e, seat)) out.push(e);
    });
    return out;
  }
  function legalCities() {
    var seat = mySeat(), out = [];
    Object.keys(model.buildings).forEach(function (v) { if (model.buildings[v].seat === seat && model.buildings[v].kind === "settlement") out.push(v); });
    return out;
  }

  function modeStillValid() {
    if (!model || model.phase === "over") return false;
    if (ui.mode === "robber") return model.turn && model.turn.pending && model.turn.pending.kind === "robber" && isMyTurn();
    if (ui.mode === "steal") return model.turn && model.turn.pending && model.turn.pending.kind === "steal" && isMyTurn();
    if (ui.mode === "roads") return model.turn && model.turn.pending && model.turn.pending.kind === "roads" && isMyTurn();
    return true;
  }
  function autoSetupMode() {
    if (!model || model.phase !== "setup") return;
    if (model.setup.seq[model.setup.i] !== mySeat()) { ui.mode = null; return; }
    ui.mode = model.setup.need === "settlement" ? "place-settlement" : "place-road";
  }

  /* ═══ RENDER ═══════════════════════════════════════════════════ */
  function render() {
    if (!model) return;
    buildToolbar();
    // desktop-only guard
    var narrow = window.matchMedia("(max-width: 56rem)").matches;
    if (narrow) { TABLE.hidden = true; DESKTOP.hidden = false; DESKTOP.textContent = S.desktopOnly; return; }
    DESKTOP.hidden = true; TABLE.hidden = false; GATE.hidden = true;
    renderBig();
    renderDice();
    renderPlayers();
    renderLog();
    renderTrade();   // before the role tile — it may force the hub closed,
                     // and the Trade pill's active state must reflect that
    renderRole();
    fitRole();
    fitLog();   // sync: getBoundingClientRect forces the layout it needs (rAF is
                // throttled when the tab's backgrounded, so don't defer to it)
  }
  // Lock the role tile's height at the full play-area state (pills + reserved
  // tray) so the interrupt prompts — robber, steal, roads — that replace it
  // mid-turn can't shrink the tile (the universal layout rule). Cleared on
  // window resize (wrap points move) and on leaveTable.
  function fitRole() {
    if (!ROLE || TABLE.hidden || !ROLE.querySelector(".cities-play")) return;
    var h = ROLE.getBoundingClientRect().height;
    if (h) ROLE.style.minHeight = Math.ceil(h) + "px";
  }
  // Lock the log's height to the space left under the board, so the right
  // column bottom-aligns with the board tile instead of overflowing past it
  // (CSS grid 1fr can't do this on its own — an indefinite-height grid sizes
  // a 1fr track to max-content). Keeps the trade overlay in sync too.
  function fitLog() {
    if (!BIG || !LOG || TABLE.hidden) return;
    // Lock the log TILE to a fixed height reaching the board's bottom, so it
    // stays a consistent full size no matter how many lines it holds (the list
    // fills it and scrolls). Setting the tile height keeps the bento stable.
    var avail = BIG.getBoundingClientRect().bottom - LOG.getBoundingClientRect().top;
    if (avail > 60) LOG.style.height = Math.floor(avail) + "px";
    var list = LOG.querySelector(".cities-log__list");
    if (list) list.scrollTop = list.scrollHeight;
  }
  function seatedCount() { return (model.seats || []).filter(function (s) { return s && !s.empty; }).length; }

  /* ── toolbar (Invite · Watch/Sit · Leave · Close) ─────────────── */
  function buildToolbar() {
    TOOLBAR.textContent = "";
    if (!joined || !model) return;
    var mine = mySeat();
    // Invite
    TOOLBAR.appendChild(pill(S.invitePill, function () {
      var url = location.origin + location.pathname + (T.kind === "mock" ? "?mock" : "") + "#" + code;
      try { navigator.clipboard.writeText(url); toast(S.shareToast, "success"); } catch (e) { toast(url, "info"); }
    }));
    // View settings — a hover peek at the table's rules, available any time
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
    var wrap = el("span", "cities-setth");
    var b = el("button", "tb-pill"); b.type = "button"; b.setAttribute("aria-haspopup", "true");
    b.appendChild(el("span", "tb-pill__label", S.settingsPill));
    wrap.appendChild(b);
    var pop = el("div", "tb-pop cities-setth__pop"); pop.hidden = true;
    pop.appendChild(el("div", "tb-pop__head", S.lobbyTitle));
    pop.appendChild(settingRow(S.capacityLabel, String(model.settings.capacity)));
    pop.appendChild(settingRow(S.timerLabel, model.settings.timerSec ? fmt(S.timerSecs, { n: model.settings.timerSec }) : S.timerOff));
    pop.appendChild(settingRow(S.bettingLabel, model.settings.betting ? S.bettingOn : S.bettingOff));
    pop.appendChild(settingRow(S.resViewLabel, model.settings.resView !== false ? S.bettingOn : S.bettingOff));
    wrap.appendChild(pop);
    // Hover = transient peek; click = pin open through the popover kit (so
    // Esc / outside-click dismiss it like every other popover). The pinned
    // state survives toolbar rebuilds via ui.settingsPinned + entry.kind.
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
    if (ui.settingsPinned && openEntry && openEntry.kind === "setth") {
      openPop(entry);          // re-pin across the rebuild
      ui.settingsPinned = true;
    } else ui.settingsPinned = false;
    return wrap;
  }
  function settingRow(label, value) {
    var r = el("div", "cities-setth__row");
    r.appendChild(el("span", "cities-setth__k", label));
    r.appendChild(el("span", "cities-setth__v", value));
    return r;
  }

  /* ── BIG tile: lobby settings / board / stats ─────────────────── */
  function renderBig() {
    BIG.textContent = "";
    if (model.phase === "lobby") return renderLobby();
    if (model.phase === "over") return renderOver();
    renderBoard();
  }

  function renderLobby() {
    var wrap = el("div", "cities-lobby");
    wrap.appendChild(el("h2", "cities-lobby__title", S.lobbyTitle));
    var host = model.host;

    // capacity
    var capRow = el("div", "cities-set");
    capRow.appendChild(el("span", "cities-set__label", S.capacityLabel));
    var capOpts = el("div", "cities-set__opts");
    [3, 4, 5, 6].forEach(function (n) {
      var b = el("button", "cities-chip" + (model.settings.capacity === n ? " is-active" : ""), String(n));
      b.type = "button"; b.disabled = !host;
      b.addEventListener("click", function () { send({ type: "setSettings", capacity: n }); });
      capOpts.appendChild(b);
    });
    capRow.appendChild(capOpts); wrap.appendChild(capRow);

    // timer
    var tRow = el("div", "cities-set");
    tRow.appendChild(el("span", "cities-set__label", S.timerLabel));
    var tOpts = el("div", "cities-set__opts");
    [0, 45, 60, 90, 120].forEach(function (n) {
      var b = el("button", "cities-chip" + (model.settings.timerSec === n ? " is-active" : ""), n === 0 ? S.timerOff : fmt(S.timerSecs, { n: n }));
      b.type = "button"; b.disabled = !host;
      b.addEventListener("click", function () { send({ type: "setSettings", timerSec: n }); });
      tOpts.appendChild(b);
    });
    tRow.appendChild(tOpts); wrap.appendChild(tRow);

    // betting
    var bRow = el("div", "cities-set");
    bRow.appendChild(el("span", "cities-set__label", S.bettingLabel));
    var bOpts = el("div", "cities-set__opts");
    [["on", true], ["off", false]].forEach(function (o) {
      var b = el("button", "cities-chip" + (!!model.settings.betting === o[1] ? " is-active" : ""), o[1] ? S.bettingOn : S.bettingOff);
      b.type = "button"; b.disabled = !host;
      b.addEventListener("click", function () { send({ type: "setSettings", betting: o[1] }); });
      bOpts.appendChild(b);
    });
    bRow.appendChild(bOpts); wrap.appendChild(bRow);

    // in-game resources view (the board's Resources popover; default on)
    var rvOn = model.settings.resView !== false;
    var rvRow = el("div", "cities-set");
    rvRow.appendChild(el("span", "cities-set__label", S.resViewLabel));
    var rvOpts = el("div", "cities-set__opts");
    [["on", true], ["off", false]].forEach(function (o) {
      var b = el("button", "cities-chip" + (rvOn === o[1] ? " is-active" : ""), o[1] ? S.bettingOn : S.bettingOff);
      b.type = "button"; b.disabled = !host;
      b.addEventListener("click", function () { send({ type: "setSettings", resView: o[1] }); });
      rvOpts.appendChild(b);
    });
    rvRow.appendChild(rvOpts); wrap.appendChild(rvRow);

    // seats — your own dot (and, for the host, a bot's) is a button that
    // slides open the color picker below the row; colors lock at Start
    // because `recolor` is a lobby command (transport enforces it too)
    var seatList = el("div", "cities-lobby__seats");
    (model.seats || []).forEach(function (s, i) {
      var isBot = !s.empty && s.phantom;
      // host-only inline bot editor takes over the row (same height); a seat
      // a human claimed mid-edit drops the editor, like the color picker
      if (ui.botEdit === i && !(host && (s.empty || isBot))) { ui.botEdit = null; ui.botDraft = null; }
      if (ui.botEdit === i) { seatList.appendChild(botEditorRow(i)); return; }
      var row = el("div", "cities-seat" + (s.empty ? " cities-seat--empty" : ""));
      var editable = !s.empty && (s.seat === mySeat() || (host && s.phantom));
      row.appendChild(editable ? dotButton(s, i) : seatDot(i));
      var label = s.empty ? S.seatOpen : s.seat === mySeat() ? fmt(S.seatYou, { name: s.name }) : isBot ? fmt(S.botSeatTag, { name: s.name }) : s.name;
      if (host && isBot) {
        // the bot's name is the rename affordance (lobby-only — names lock at Start like colors)
        var nameBtn = el("button", "cities-seat__name cities-seat__namebtn", label); nameBtn.type = "button";
        nameBtn.setAttribute("aria-label", fmt(S.renameBotAria, { name: s.name }));
        nameBtn.addEventListener("click", function () { ui.botEdit = i; ui.botDraft = s.name; ui.botFocus = true; render(); });
        row.appendChild(nameBtn);
      } else row.appendChild(el("span", "cities-seat__name", label));
      if (model.hostSeat === i) row.appendChild(el("span", "cities-seat__badge", S.hostBadge));
      if (host && s.empty) {
        var add = el("button", "cities-seat__addbot", S.addBotButton); add.type = "button";
        add.addEventListener("click", function () { ui.botEdit = i; ui.botDraft = null; ui.botFocus = true; render(); });
        row.appendChild(add);
      }
      if (host && !s.empty && s.seat !== mySeat()) {
        var kick = el("button", "cities-seat__kick", "✕"); kick.type = "button";
        kick.setAttribute("aria-label", fmt(S.kickSeatAria, { name: s.name || "" }));
        kick.addEventListener("click", function () { send({ type: "kickSeat", seat: i }); });
        row.appendChild(kick);
      }
      seatList.appendChild(row);
      if (editable) seatList.appendChild(colorPicker(s, i));
    });
    if (ui.colorOpen != null) {
      // the open picker's seat stopped being editable (kicked, stood up,
      // capacity trim): forget it so a later rebuild doesn't reopen it
      var stillOpen = seatList.querySelector('[data-colorpick="' + ui.colorOpen + '"]');
      if (!stillOpen) { ui.colorOpen = null; ui.colorDraft = null; }
    }
    wrap.appendChild(seatList);

    // start (+ Shuffle: host randomizes the seated players' order)
    if (host) {
      var startRow = el("div", "cities-lobby__startrow");
      var start = el("button", "tb-pill cities-lobby__start");
      start.type = "button";
      start.appendChild(el("span", "tb-pill__label", S.startButton));
      var ready = seatedCount() >= 3;
      start.disabled = !ready;
      start.addEventListener("click", function () { send({ type: "start" }); });
      startRow.appendChild(start);
      var shuf = el("button", "tb-pill cities-lobby__start");
      shuf.type = "button";
      shuf.appendChild(el("span", "tb-pill__label", S.shufflePill));
      shuf.disabled = seatedCount() < 2;
      shuf.addEventListener("click", function () { send({ type: "shuffle" }); });
      startRow.appendChild(shuf);
      wrap.appendChild(startRow);
      wrap.appendChild(el("p", "cities-lobby__hint", ready ? S.startHint : S.startNeedsThree));
    }
    BIG.appendChild(wrap);
  }
  function seatDot(i) { var d = el("span", "cities-dot"); d.style.background = "var(--cseat-" + i + ")"; return d; }

  /* ── lobby: host-added bots (the addBot verb) ───────────────────
     "+ Bot" on an open seat (or the bot's own name, to rename) swaps the
     row for an inline editor at the same height: name input prefilled
     from the suggestion pool, Add sends addBot (re-adding at a bot's
     seat = rename), ✕ cancels. The draft rides ui.botDraft so
     broadcasts don't wipe mid-typing (the color picker's idiom). */
  var BOT_NAMES = ["Rook", "Vala", "Ozan", "Mira", "Deca"];   // prefill suggestions only — free text wins
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
    var row = el("div", "cities-seat cities-seat--edit");
    row.appendChild(seatDot(i));
    var input = el("input", "cities-seat__nameinput");
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
    var ok = el("button", "cities-seat__addgo", S.addBotGo); ok.type = "button";
    ok.addEventListener("click", go);
    row.appendChild(ok);
    var x = el("button", "cities-seat__kick", "✕"); x.type = "button";
    x.setAttribute("aria-label", S.addBotCancelAria);
    x.addEventListener("click", cancel);
    row.appendChild(x);
    // focus only when the editor OPENS — broadcast re-renders must not steal it
    if (ui.botFocus) { ui.botFocus = false; setTimeout(function () { if (input.isConnected) { input.focus(); input.select(); } }, 0); }
    return row;
  }
  // seat colors drive the --cseat-N slots (main.css game-palette carve-out
  // holds the preset fallbacks; a custom pick simply overrides its slot, so
  // every index-keyed render site — board, strips, log, over — follows along)
  function applySeatColors() {
    var root = document.querySelector(".cities");
    if (!root || !model) return;
    (model.seats || []).forEach(function (s, i) {
      if (s && s.color) root.style.setProperty("--cseat-" + i, s.color);
    });
  }

  /* ── lobby seat-color picker (dot → slide-open expand) ──────────
     The expand animates with the game-over superlatives' slide (the same
     grid-template-rows 0fr→1fr transition), which is why open/close flips
     a class on the LIVE node — a re-render would insert the panel already
     open and skip the motion. Open state + a mid-typing hex draft ride
     `ui.colorOpen` / `ui.colorDraft` so broadcasts don't wipe them. */
  function dotButton(s, i) {
    var b = el("button", "cities-seat__dotbtn"); b.type = "button";
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
    if (ui.colorOpen === i) toggleColorPick(i);   // animated close; the
    // broadcast then re-renders the roster with the new color applied
  }
  function colorPicker(s, i) {
    var wrap = el("div", "cities-colorpick" + (ui.colorOpen === i ? " is-open" : ""));
    wrap.setAttribute("data-colorpick", i);
    var slide = el("div", "cities-colorpick__inner");   // the 0fr→1fr track (bare, like the superlatives')
    var inner = el("div", "cities-colorpick__body");
    inner.appendChild(el("span", "cities-colorpick__label",
      s.seat === mySeat() ? S.colorYours : fmt(S.colorTheirs, { name: s.name })));
    // clash targets = every OTHER seat's color, positions preserved so a
    // clash index maps straight back to a seat for the "{name} has it" line
    var others = (model.seats || []).map(function (o) {
      return o.empty || o.seat === i ? null : o.color;
    });
    var sw = el("div", "cities-colorpick__swatches");
    Colors.PRESETS.forEach(function (hex) {
      var b = el("button", "cities-colorpick__swatch"); b.type = "button";
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
    // 7th swatch: YOUR custom color (device-local, saved when a hex is
    // Become'd) — select it again here, or the empty slot focuses the field
    var savedCustom = Colors.norm(load(CUSTOM_COLOR_KEY, null));
    var cb = el("button", "cities-colorpick__swatch cities-colorpick__swatch--custom");
    cb.type = "button";
    if (savedCustom) {
      cb.style.background = savedCustom;
      if (savedCustom === s.color) cb.classList.add("is-current");
      var cci = Colors.clash(savedCustom, others);
      if (cci >= 0 && savedCustom !== s.color) {
        cb.disabled = true;
        cb.title = fmt(S.colorTakenBy, { name: seatName(cci) });
        cb.setAttribute("aria-label", fmt(S.colorTakenBy, { name: seatName(cci) }));
      } else {
        cb.setAttribute("aria-label", S.colorCustomAria);
        cb.addEventListener("click", function () { sendRecolor(i, savedCustom); });
      }
    } else {
      cb.classList.add("is-empty");
      cb.setAttribute("aria-label", S.colorCustomAria);
      cb.addEventListener("click", function () { input.focus(); });   // var-hoisted; assigned below
    }
    sw.appendChild(cb);
    inner.appendChild(sw);
    // exact-hex row: seeded with the current color, validated as you type
    // (colors.js — the same check the transport re-runs), submit = Become...
    var row = el("div", "cities-colorpick__custom");
    row.appendChild(el("span", "cities-colorpick__hexlabel", S.colorHexLabel));
    var input = el("input", "cities-colorpick__hexinput");
    input.type = "text"; input.spellcheck = false; input.maxLength = 8;
    input.value = ui.colorDraft != null ? ui.colorDraft : s.color;
    var become = el("button", "cities-chip cities-colorpick__go", S.colorBecome);
    become.type = "button";
    var note = el("span", "cities-colorpick__msg");
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
      save(CUSTOM_COLOR_KEY, hex);   // remembers the 7th swatch across sessions
      sendRecolor(i, hex);
    }
    input.addEventListener("input", function () { ui.colorDraft = input.value; validate(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") becomeCustom();
    });
    become.addEventListener("click", becomeCustom);
    validate();
    row.appendChild(input); row.appendChild(become); row.appendChild(note);
    inner.appendChild(row);
    slide.appendChild(inner);
    wrap.appendChild(slide);
    return wrap;
  }

  /* ── the SVG board ────────────────────────────────────────────── */
  function renderBoard() {
    var g = geo();
    // bounds over vertices
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    Object.keys(g.vertexHexes).forEach(function (v) { var p = vertexXY(v); minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
    var pad = 34;
    var vb = [(minX - pad).toFixed(1), (minY - pad).toFixed(1), (maxX - minX + pad * 2).toFixed(1), (maxY - minY + pad * 2).toFixed(1)].join(" ");
    // robber mode: tokens (and the robber marker) go pointer-transparent so
    // the click lands on the target hex under them — the disc sits dead
    // center, exactly where people aim (odds hover resumes after the pick)
    var svg = svgEl("svg", { class: "cities-board" + (ui.mode === "robber" ? " is-picking" : ""), viewBox: vb, role: "img", "aria-label": "Board" });

    // hex fills + tokens
    model.board.hexes.forEach(function (h) {
      var hk = h.q + "," + h.r, c = hexCenter(h.q, h.r);
      var poly = svgEl("polygon", { points: hexCorners(h.q, h.r), class: "cities-hex", fill: "var(--cterr-" + h.terrain + ")" });
      var robberHere = model.board.robber === hk;
      if (ui.mode === "robber" && !robberHere) {
        poly.classList.add("cities-hex--target");
        poly.addEventListener("click", function () { send({ type: "moveRobber", hex: hk }); ui.mode = null; });
      }
      svg.appendChild(poly);
      if (h.token != null) {
        // grouped so the native <title> tooltip (the odds line) covers the
        // whole disc — circle, number, and pips
        var tg = svgEl("g", { class: "cities-tokeng" });
        tg.appendChild(svgEl("circle", { cx: c.x, cy: c.y, r: 15, class: "cities-token" }));
        var hot = h.token === 6 || h.token === 8;
        // number + pip row both live INSIDE the r15 disc: number baseline
        // nudged up, pips tucked under it (baseline +10 keeps the row clear
        // of the disc's bottom edge at +15)
        var txt = svgEl("text", { x: c.x, y: c.y + 1, class: "cities-token__num" + (hot ? " is-hot" : ""), "text-anchor": "middle" });
        txt.textContent = h.token;
        tg.appendChild(txt);
        tg.appendChild(svgEl("text", { x: c.x, y: c.y + 10, class: "cities-token__pips", "text-anchor": "middle" })).textContent = pips(h.token);
        var ways = 6 - Math.abs(7 - h.token);
        var tip = svgEl("title");
        tip.textContent = fmt(S.tokenOdds, {
          ways: ways, total: 36, pct: (ways * 100 / 36).toFixed(1),
          roll: (h.token === 8 || h.token === 11 ? "an " : "a ") + h.token
        });
        tg.appendChild(tip);
        svg.appendChild(tg);
      }
      if (robberHere) {
        if (robberSprite) {
          svg.appendChild(svgEl("image", { href: ROBBER_SRC, x: c.x - 14, y: c.y - 16, width: 28, height: 28, class: "cities-robber--sprite" }));
        } else {
          svg.appendChild(svgEl("circle", { cx: c.x, cy: c.y - 2, r: 11, class: "cities-robber" }));
        }
      }
    });

    // roads
    Object.keys(model.roads).forEach(function (e) {
      var vs = g.edgeVertices[e]; if (!vs) return;
      var a = vertexXY(vs[0]), b = vertexXY(vs[1]);
      svg.appendChild(svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "cities-road", stroke: "var(--cseat-" + model.roads[e] + ")" }));
    });

    // harbors (marker at edge midpoint) — painted AFTER built roads so a
    // coastal road never buries the port token, but BEFORE the placement
    // targets so a target on that edge stays clickable above the dot
    (model.board.harbors || []).forEach(function (hb) {
      var a = vertexXY(hb.vertices[0]), b = vertexXY(hb.vertices[1]);
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var grp = svgEl("g", { class: "cities-harbor" });
      // native tooltip: the visible label shows the rate (3:1 / 2:1), hover
      // reveals the traded resource ("Any" for a 3:1)
      var tip = svgEl("title", {});
      tip.textContent = hb.type === "any" ? S.harborAny : resName(hb.type);
      grp.appendChild(tip);
      grp.appendChild(svgEl("line", { x1: a.x, y1: a.y, x2: mx, y2: my, class: "cities-harbor__link" }));
      grp.appendChild(svgEl("line", { x1: b.x, y1: b.y, x2: mx, y2: my, class: "cities-harbor__link" }));
      grp.appendChild(svgEl("circle", { cx: mx, cy: my, r: 10, class: "cities-harbor__dot", fill: hb.type === "any" ? "var(--cterr-sea)" : "var(--cterr-" + hb.type + ")" }));
      var t = svgEl("text", { x: mx, y: my + 3, class: "cities-harbor__label", "text-anchor": "middle" });
      t.textContent = hb.type === "any" ? "3:1" : "2:1";
      grp.appendChild(t);
      svg.appendChild(grp);
    });

    // road placement targets
    if (ui.mode === "place-road" || ui.mode === "roads") {
      var setupRoad = model.phase === "setup";
      legalRoads(setupRoad, setupRoad ? model.setup.lastVid : null).forEach(function (e) {
        var vs = g.edgeVertices[e], a = vertexXY(vs[0]), b = vertexXY(vs[1]);
        var t = svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "cities-road cities-road--target" });
        t.addEventListener("click", function () { send({ type: "place", kind: "road", loc: e }); if (ui.mode === "place-road") ui.mode = null; });
        svg.appendChild(t);
      });
    }

    // buildings
    Object.keys(model.buildings).forEach(function (v) {
      var b = model.buildings[v], p = vertexXY(v);
      svg.appendChild(pieceShape(b.kind, p, b.seat));
    });
    // settlement placement targets — hovering one shows its "strength": the
    // adjacent hexes' pips pooled into one badge, so spots compare at a glance
    if (ui.mode === "place-settlement") {
      legalSettlements(model.phase === "setup").forEach(function (v) {
        var p = vertexXY(v);
        var t = svgEl("circle", { cx: p.x, cy: p.y, r: 9, class: "cities-vtarget" });
        t.addEventListener("click", function () { send({ type: "place", kind: "settlement", loc: v }); if (model.phase !== "setup") ui.mode = null; });
        t.addEventListener("mouseenter", function () { showVertexHint(svg, v, p); });
        t.addEventListener("mouseleave", hideVertexHint);
        svg.appendChild(t);
      });
    }
    if (ui.mode === "place-city") {
      legalCities().forEach(function (v) {
        var p = vertexXY(v);
        var t = svgEl("circle", { cx: p.x, cy: p.y, r: 11, class: "cities-vtarget" });
        t.addEventListener("click", function () { send({ type: "place", kind: "city", loc: v }); ui.mode = null; });
        svg.appendChild(t);
      });
    }
    // steal targets sit on the robber hex — handled in role tile prompt

    BIG.appendChild(svg);
    buildBoardPops();
  }
  function pips(tok) { var n = 6 - Math.abs(7 - tok); return new Array(n + 1).join("•"); }

  /* ── board popovers, bottom-left: Odds + Resources ──────────────
     A shared kit: each popover is an absolute overlay (z above the SVG)
     paired with a pill in the button row, so nothing touches board
     layout. Hovering a button shows its popover transiently; clicking
     pins it (ui.boardPop — cleared with the rest of ui on leave); a
     hover always outranks a pin so mousing between buttons previews
     either. A 150ms grace timer lets the cursor cross the gap from
     button to popover without it closing. Rebuilt every render like the
     rest of the tile, so new data appears live; panels are fixed-size
     and bars normalize against the current max, so nothing ever
     resizes. Odds reads model.dice; Resources reads model.gained (only
     sent while the table's In-Game Resources View setting is on — no
     data, no button). */
  var popHover = null, popTimer = null;
  function popOpenName() { return popHover || ui.boardPop || null; }
  function popSync() {
    var open = popOpenName();
    ["odds", "res"].forEach(function (name) {
      var p = BIG.querySelector('[data-pop="' + name + '"]');
      var b = BIG.querySelector('[data-popbtn="' + name + '"]');
      if (p) p.classList.toggle("is-open", open === name);
      if (b) b.setAttribute("aria-expanded", open === name ? "true" : "false");
    });
  }
  function popHoverIn(name) { return function () { clearTimeout(popTimer); popHover = name; popSync(); }; }
  function popDelayClose() {
    clearTimeout(popTimer);
    popTimer = setTimeout(function () { popHover = null; popSync(); }, 150);
  }
  function popButton(name, label) {
    var b = el("button", "tb-pill"); b.type = "button";
    b.setAttribute("data-popbtn", name);
    b.appendChild(el("span", "tb-pill__label", label));
    b.setAttribute("aria-expanded", popOpenName() === name ? "true" : "false");
    b.addEventListener("click", function () { ui.boardPop = ui.boardPop === name ? null : name; popSync(); });
    b.addEventListener("mouseenter", popHoverIn(name));
    b.addEventListener("mouseleave", popDelayClose);
    return b;
  }
  function popPanel(name) {
    var p = el("div", "cities-bpop" + (popOpenName() === name ? " is-open" : ""));
    p.setAttribute("data-pop", name);
    p.addEventListener("mouseenter", popHoverIn(name));
    p.addEventListener("mouseleave", popDelayClose);
    return p;
  }
  function buildBoardPops() {
    var row = el("div", "cities-boardbtns");
    var oddsPop = popPanel("odds");
    var dice = model.dice || {};
    var total = 0; for (var k in dice) total += dice[k];
    oddsPop.appendChild(el("div", "cities-odds__count", fmt(S.oddsRolls, { n: total })));
    var hint = el("div", "cities-odds__hint");   // reserved line — fills on bar hover
    oddsPop.appendChild(oddsChart(dice, total, hint));
    oddsPop.appendChild(hint);
    BIG.appendChild(oddsPop);
    row.appendChild(popButton("odds", S.oddsButton));
    if (model.gained) {
      var resPop = popPanel("res");
      resPop.appendChild(resChart(model.gained));
      BIG.appendChild(resPop);
      row.appendChild(popButton("res", S.resButton));
    }
    BIG.appendChild(row);
  }
  // Resources: one bar per seat in its player color — raw cards gained,
  // no resource breakdown, no captions (the numbers and names are it)
  function resChart(gained) {
    var svg = svgEl("svg", { class: "cities-odds__chart", viewBox: "0 0 356 150" });
    var n = gained.length, gap = 10, x0 = 6;
    var bw = (344 - (n - 1) * gap) / n;
    var base = 126, maxH = 100, maxC = 1, i;
    for (i = 0; i < n; i++) maxC = Math.max(maxC, gained[i]);
    for (i = 0; i < n; i++) {
      var x = x0 + i * (bw + gap);
      var h = Math.max(Math.round(gained[i] / maxC * maxH), 2);
      var r = svgEl("rect", { x: x.toFixed(1), y: base - h, width: bw.toFixed(1), height: h, rx: 3 });
      r.style.fill = "var(--cseat-" + i + ")";
      svg.appendChild(r);
      var ct = svgEl("text", { x: (x + bw / 2).toFixed(1), y: base - h - 5, "text-anchor": "middle", class: "cities-odds__n" });
      ct.textContent = gained[i];
      svg.appendChild(ct);
      var nm = svgEl("text", { x: (x + bw / 2).toFixed(1), y: 144, "text-anchor": "middle", class: "cities-odds__x" });
      var full = seatName(i), maxCh = Math.max(3, Math.floor(bw / 6.5));
      nm.textContent = full.length > maxCh ? full.slice(0, maxCh - 1) + "…" : full;
      svg.appendChild(nm);
    }
    svg.appendChild(svgEl("line", { x1: 4, y1: base, x2: 352, y2: base, class: "cities-odds__axis" }));
    return svg;
  }
  function oddsChart(dice, total, hint) {
    // 11 bars: x 6..350 — the 356 viewBox leaves 6px each side, centered
    var svg = svgEl("svg", { class: "cities-odds__chart", viewBox: "0 0 356 150" });
    var maxC = 1, s;
    for (s = 2; s <= 12; s++) maxC = Math.max(maxC, dice[s] || 0);
    var base = 126, maxH = 100, bw = 24, gap = 8, x0 = 6;
    for (s = 2; s <= 12; s++) {
      var x = x0 + (s - 2) * (bw + gap), c = dice[s] || 0;
      var hot = s === 6 || s === 8;
      var h = Math.max(Math.round(c / maxC * maxH), 2);
      var col = svgEl("g", { class: "cities-odds__col" });
      col.appendChild(svgEl("rect", { x: x, y: base - h, width: bw, height: h, rx: 3, class: "cities-odds__bar" + (hot ? " is-hot" : "") }));
      if (c > 0) {
        var ct = svgEl("text", { x: x + bw / 2, y: base - h - 5, "text-anchor": "middle", class: "cities-odds__n" });
        ct.textContent = c;
        col.appendChild(ct);
      }
      var xl = svgEl("text", { x: x + bw / 2, y: 144, "text-anchor": "middle", class: "cities-odds__x" + (hot ? " is-hot" : "") });
      xl.textContent = s;
      col.appendChild(xl);
      // invisible full-height column target so the whole lane hovers
      var hit = svgEl("rect", { x: x - gap / 2, y: 0, width: bw + gap, height: 150, class: "cities-odds__hit" });
      (function (sum, count) {
        hit.addEventListener("mouseenter", function () {
          var ways = 6 - Math.abs(7 - sum);
          var exp = (total * ways / 36).toFixed(1).replace(/\.0$/, "");
          hint.textContent = fmt(S.oddsHover, { x: exp, y: count });
        });
        hit.addEventListener("mouseleave", function () { hint.textContent = ""; });
      })(s, c);
      col.appendChild(hit);
      svg.appendChild(col);
    }
    svg.appendChild(svgEl("line", { x1: 4, y1: base, x2: 352, y2: base, class: "cities-odds__axis" }));
    return svg;
  }
  // pinned popovers: the usual popover-kit exits (outside click, Escape)
  document.addEventListener("click", function (e) {
    if (!ui.boardPop) return;
    if (e.target.closest && (e.target.closest(".cities-bpop") || e.target.closest("[data-popbtn]"))) return;
    ui.boardPop = null; popSync();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && ui.boardPop) { ui.boardPop = null; popSync(); }
  });
  // placement-strength badge: total pips of the hovered vertex's adjacent
  // tokened hexes, floated above the target (SVG overlay — nothing reflows).
  // One badge at a time; any re-render simply drops it with the old SVG.
  var vhint = null;
  function hexByKey(hk) {
    var hx = model.board.hexes;
    for (var i = 0; i < hx.length; i++) if (hx[i].q + "," + hx[i].r === hk) return hx[i];
    return null;
  }
  function showVertexHint(svg, v, p) {
    hideVertexHint();
    var sum = 0;
    (geo().vertexHexes[v] || []).forEach(function (hk) {
      var h = hexByKey(hk);
      if (h && h.token != null) sum += 6 - Math.abs(7 - h.token);
    });
    if (!sum) return;   // desert/sea-only corner: no badge beats an empty pill
    var w = sum * 3.6 + 10;
    var g = svgEl("g", { class: "cities-vhint" });
    g.appendChild(svgEl("rect", { x: (p.x - w / 2).toFixed(1), y: p.y - 27, width: w.toFixed(1), height: 13, rx: 6.5, class: "cities-vhint__bg" }));
    var t = svgEl("text", { x: p.x, y: p.y - 17, "text-anchor": "middle", class: "cities-vhint__pips" });
    t.textContent = new Array(sum + 1).join("•");
    g.appendChild(t);
    svg.appendChild(g);
    vhint = g;
  }
  function hideVertexHint() {
    if (vhint && vhint.parentNode) vhint.parentNode.removeChild(vhint);
    vhint = null;
  }
  function pieceShape(kind, p, seat) {
    var fill = "var(--cseat-" + seat + ")";
    if (kind === "city") return svgEl("rect", { x: p.x - 8, y: p.y - 8, width: 16, height: 16, rx: 2, class: "cities-piece cities-piece--city", fill: fill });
    // settlement: a small house = pentagon-ish; use a circle for the placeholder
    return svgEl("circle", { cx: p.x, cy: p.y, r: 7, class: "cities-piece cities-piece--settlement", fill: fill });
  }

  /* ── game over: stats + superlatives ──────────────────────────── */
  function renderOver() {
    var o = model.over || {};
    var wrap = el("div", "cities-over");
    // header: "Game Over" left, turn count right-aligned on the same line
    var head = el("div", "cities-over__head");
    head.appendChild(el("h2", "cities-over__title", S.gameOver));
    head.appendChild(el("span", "cities-over__turns", fmt(S.turnCount, { n: (o.stats && o.stats.turns) || 0 })));
    wrap.appendChild(head);
    // the winner is shown by the glowing row in the reveal table below, so no
    // subtitle line — only the abandoned (no-winner) case still needs prose.
    if (o.winner == null) wrap.appendChild(el("p", "cities-over__winner", S.abandoned));

    // superlatives over the full table
    var sup = el("div", "cities-over__supers");
    var stats = o.stats || { seats: [] };
    sup.appendChild(superCard("resources", S.superMostResources, stats.seats, function (s) { return sumHand(s.gained); }));
    sup.appendChild(superCard("haul", S.superBiggestHaul, stats.seats, function (s) { return s.biggestHaul; }));
    sup.appendChild(superCard("knights", S.superMostKnights, stats.seats, function (s) { return s.pieces.knights; }));
    sup.appendChild(superCard("robbed", S.superMostRobbed, stats.seats, function (s) { return s.robber.victimized; }));
    wrap.appendChild(sup);

    // per-seat VP reveal, winner first; ties keep seat order (stable sort)
    var table = el("div", "cities-over__reveal");
    (o.reveal || []).slice().sort(function (a, b) { return b.total - a.total; }).forEach(function (r) {
      var row = el("div", "cities-over__row" + (r.seat === o.winner ? " is-winner" : ""));
      row.appendChild(seatDot(r.seat));
      row.appendChild(el("span", "cities-over__name", seatName(r.seat)));
      row.appendChild(el("span", "cities-over__vp", fmt(S.vpShort, { n: r.total })));
      table.appendChild(row);
    });
    wrap.appendChild(table);

    if (model.host) {
      // Rematch re-enters the lobby with the same seats + settings; the
      // transport wiring for it lands with the worker (Phase 2). For now the
      // host leaves and re-opens the table.
      var rb = el("button", "tb-pill cities-over__rematch"); rb.type = "button";
      rb.appendChild(el("span", "tb-pill__label", S.rematchButton));
      rb.addEventListener("click", function () { toast("Rematch lands with the worker — reopen the table for now.", "info"); });
      wrap.appendChild(rb);
    }
    BIG.appendChild(wrap);
  }
  // A superlative card. Collapsed it names the leader + their value; click to
  // slide open the full field, ranked, showing where everyone else fell. The
  // slide is a grid-template-rows 0fr→1fr transition (see main.css) so it needs
  // no height measurement; the big tile scrolls internally, so an open card
  // never resizes the panel. Open state rides `ui.overExpanded[key]` so a
  // re-render (e.g. a spectator joining) doesn't collapse it.
  function superCard(key, label, seats, valueFn) {
    var ranked = rankStat(seats, valueFn);
    var c = el("button", "cities-super"); c.type = "button";
    c.appendChild(el("span", "cities-super__label", label));
    var v = el("span", "cities-super__who");
    // no meaningful leader (nobody scored above 0): show a dash, not expandable
    if (!ranked.length || ranked[0].value <= 0) { v.textContent = S.statHidden; c.appendChild(v); return c; }
    var top = ranked[0];
    v.appendChild(seatDot(top.seat));
    v.appendChild(el("span", "cities-super__name", seatName(top.seat)));
    v.appendChild(el("span", "cities-super__val", fmt(S.superValue, { n: top.value })));
    v.appendChild(el("span", "cities-super__caret"));
    c.appendChild(v);
    // the slide-open field: everyone below the leader, in rank order
    var more = el("div", "cities-super__more");
    var inner = el("div", "cities-super__more-inner");
    var list = el("div", "cities-super__rank-list");
    ranked.slice(1).forEach(function (r) {
      var row = el("div", "cities-super__rank");
      row.appendChild(seatDot(r.seat));
      row.appendChild(el("span", "cities-super__name", seatName(r.seat)));
      row.appendChild(el("span", "cities-super__val", fmt(S.superValue, { n: r.value })));
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
  function sumHand(gained) { var t = 0; RES.forEach(function (r) { ["rolls", "steals", "trades", "dev"].forEach(function (s) { t += (gained[s] && gained[s][r]) || 0; }); }); return t; }
  // full field ranked high→low by a stat; stable, so ties keep seat order
  function rankStat(arr, f) { return (arr || []).map(function (s, i) { return { seat: i, value: f(s) }; }).sort(function (a, b) { return b.value - a.value; }); }

  /* ── DICE tile ────────────────────────────────────────────────── */
  function renderDice() {
    if (timerHandle) { clearTimeout(timerHandle); timerHandle = null; }
    DICE.textContent = "";
    var d = model.turn && model.turn.dice;
    var spinning = Date.now() < spinUntil;
    // the timer box rides along from the lobby on (static duration until the
    // clock arms in main) so game start doesn't shift the dice left
    var timed = model.settings && model.settings.timerSec > 0;
    var row = el("div", "cities-dice__faces" + (spinning ? " is-spinning" : "") + (timed ? " cities-dice__faces--timed" : ""));
    var dice = el("div", "cities-dice__dice");
    dice.appendChild(el("div", "cities-die", d ? String(d[0]) : "–"));
    dice.appendChild(el("div", "cities-die", d ? String(d[1]) : "–"));
    row.appendChild(dice);
    if (timed) { var timer = el("div", "cities-timer"); row.appendChild(timer); tickTimer(timer); }
    DICE.appendChild(row);
    var caption = model.phase === "main"
      ? (model.turn.rolled && d ? fmt(S.diceLast, { name: seatName(model.turn.seat), sum: d[0] + d[1] }) : fmt(S.diceWaiting, { name: seatName(model.turn.seat) }))
      : "";
    DICE.appendChild(el("p", "cities-dice__cap", spinning ? S.diceRolling : caption));
    if (spinning) setTimeout(function () { if (Date.now() >= spinUntil) renderDice(); }, spinUntil - Date.now() + 20);
  }
  // seconds left on the current actor's turn, or null when the clock isn't armed
  function timerLeftMs() {
    if (!model.settings || !model.settings.timerSec || model.turnEndsAt == null) return null;
    return Math.max(0, model.turnEndsAt - (Date.now() - clockSkew));
  }
  function fmtClock(ms) { var s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function tickTimer(node) {
    var ms = timerLeftMs();
    if (ms == null) {                       // configured but not counting (e.g. a bot is thinking)
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

  /* ── PLAYERS tile ─────────────────────────────────────────────── */
  function renderPlayers() {
    // The tile is a fixed-height scroller (4 strips; 5-6 player tables
    // scroll). Re-renders keep the scroll position; a turn change scrolls
    // the active strip into view.
    var st = PLAYERS.scrollTop;
    PLAYERS.textContent = "";
    fillPlayers();
    PLAYERS.scrollTop = st;
    var turnSeat = model.phase === "main" && model.turn ? model.turn.seat : null;
    if (turnSeat !== lastTurnSeat) {
      lastTurnSeat = turnSeat;
      var act = PLAYERS.querySelector(".cities-pstrip.is-active");
      if (act) {
        var top = act.offsetTop, bot = top + act.offsetHeight;
        if (top < PLAYERS.scrollTop) PLAYERS.scrollTop = top;
        else if (bot > PLAYERS.scrollTop + PLAYERS.clientHeight) PLAYERS.scrollTop = bot - PLAYERS.clientHeight;
      }
    }
  }
  // Award pills, bottom-left of a strip. Both slots (Longest Road over Largest
  // Army) are ALWAYS laid out, so a strip reserves the space from the start and
  // never resizes (docs/cities.md: no UI piece resizes another). A held award
  // shows its name, accented + glowing (`is-held`); an unheld one shows the
  // seat's progress toward it ("{n}x Roads" = longest contiguous path, from
  // engine roadLens; "{n}x Knights" = knights played). In the lobby (pre-game)
  // both ride along ghosted, so Start swaps text in without reflow.
  function awardRow(opts) {
    var awards = el("div", "cities-pstrip__awards");
    awards.appendChild(awardPill(opts.ghost, opts.roadHeld,
      fmt(S.awardRoadHeld, { n: opts.roadCount || 0 }), fmt(S.roadProgress, { n: opts.roadCount || 0 })));
    awards.appendChild(awardPill(opts.ghost, opts.armyHeld,
      fmt(S.awardArmyHeld, { n: opts.armyCount || 0 }), fmt(S.armyProgress, { n: opts.armyCount || 0 })));
    return awards;
  }
  function awardPill(ghost, held, heldLabel, progressLabel) {
    var cls = "cities-pstrip__award" + (held ? " is-held" : "") + (ghost ? " is-ghost" : "");
    return el("span", cls, held ? heldLabel : progressLabel);
  }
  function fillPlayers() {
    // Lobby (no game state yet): strips for the occupied seats, with the
    // stat column riding along ghosted at its in-game size — so Start fills
    // numbers in instead of reflowing the tile.
    if (!model.players || !model.players.length) {
      (model.seats || []).forEach(function (s, i) {
        if (s.empty) return;
        var strip = el("div", "cities-pstrip");
        strip.style.setProperty("--cstrip", "var(--cseat-" + i + ")");
        var body = el("div", "cities-pstrip__body");
        var head = el("div", "cities-pstrip__head");
        head.appendChild(seatDot(i));
        head.appendChild(el("span", "cities-pstrip__name", seatName(i) + (i === mySeat() ? " ·" : "")));
        body.appendChild(head);
        body.appendChild(awardRow({ ghost: true }));
        strip.appendChild(body);
        var stat = el("div", "cities-pstrip__stat is-ghost");
        stat.appendChild(el("span", "cities-pstrip__vp", fmt(S.vpShort, { n: 0 })));
        stat.appendChild(el("span", "cities-pstrip__cards", fmt(S.handShort, { n: 0 })));
        stat.appendChild(el("span", "cities-pstrip__dev", fmt(S.devShort, { n: 0 })));
        strip.appendChild(stat);
        PLAYERS.appendChild(strip);
      });
      return;
    }
    (model.players || []).forEach(function (p, i) {
      var active = model.phase === "main" && model.turn.seat === i;
      var strip = el("div", "cities-pstrip" + (active ? " is-active" : "") + (model.seats[i] && !model.seats[i].connected ? " is-away" : ""));
      strip.style.setProperty("--cstrip", "var(--cseat-" + i + ")");
      var body = el("div", "cities-pstrip__body");
      var head = el("div", "cities-pstrip__head");
      head.appendChild(seatDot(i));
      // a botted seat (host-added, grace expired, or kicked mid-game) wears the tag
      var sMeta = model.seats[i];
      var nm = sMeta && (sMeta.bot || sMeta.phantom) ? fmt(S.botSeatTag, { name: seatName(i) }) : seatName(i);
      head.appendChild(el("span", "cities-pstrip__name", nm + (i === mySeat() ? " ·" : "")));
      if (isEmbargoed(i)) head.appendChild(el("span", "cities-badge", "🚫"));
      body.appendChild(head);
      body.appendChild(awardRow({
        roadHeld: model.awards && model.awards.longestRoad === i,
        armyHeld: model.awards && model.awards.largestArmy === i,
        roadCount: p.roadLen || 0,
        armyCount: p.knights || 0
      }));
      strip.appendChild(body);
      var stat = el("div", "cities-pstrip__stat");
      stat.appendChild(el("span", "cities-pstrip__vp", fmt(S.vpShort, { n: p.vp })));
      stat.appendChild(el("span", "cities-pstrip__cards", fmt(S.handShort, { n: p.handCount })));
      stat.appendChild(el("span", "cities-pstrip__dev", fmt(S.devShort, { n: p.devCount })));
      strip.appendChild(stat);
      attachEmbargoMenu(strip, i);
      PLAYERS.appendChild(strip);
    });
  }
  /* ── embargo context menu (right-click a player strip) ──────────
     Not the popover kit: strips are wiped by every broadcast (~650ms in the
     mock), so the menu's open/closed state lives in ui.embargoPop and the
     strip re-renders it open — a kit popover would vanish mid-click. */
  function attachEmbargoMenu(strip, i) {
    if (mySeat() == null || i === mySeat()) return;
    strip.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
      if (ui.embargoPop === i) return closeEmbargoPop();
      ui.embargoPop = i;
      document.addEventListener("click", onEmbargoDocClick, true);
      document.addEventListener("keydown", onEmbargoKey);
      render();
    });
    if (ui.embargoPop !== i) return;
    var pop = el("div", "tb-pop cities-embargo__pop");
    var b = el("button", "tb-pop__opt", isEmbargoed(i) ? S.embargoLift : S.embargoSet);
    b.type = "button";
    b.addEventListener("click", function () {
      var on = toggleEmbargo(i);
      closeEmbargoPop();
      if (on) declineOpenOffersFrom(i);
      sweepAcceptToasts();
      render();
    });
    pop.appendChild(b);
    strip.appendChild(pop);
  }
  function closeEmbargoPop() {
    ui.embargoPop = null;
    document.removeEventListener("click", onEmbargoDocClick, true);
    document.removeEventListener("keydown", onEmbargoKey);
    render();
  }
  function onEmbargoDocClick(e) { if (!e.target.closest || !e.target.closest(".cities-embargo__pop")) closeEmbargoPop(); }
  function onEmbargoKey(e) { if (e.key === "Escape") closeEmbargoPop(); }

  /* ── LOG tile: left rail (Log | Deck) + the active pane ────────── */
  function renderLog() {
    LOG.textContent = "";
    var wrap = el("div", "cities-logwrap");
    var rail = el("div", "cities-lograil");
    rail.appendChild(railBtn(S.logTab, "log"));
    rail.appendChild(railBtn(S.deckTab, "deck"));
    wrap.appendChild(rail);
    var pane = el("div", "cities-log__pane");
    if (logView === "deck") {
      pane.appendChild(buildDeck());
      wrap.appendChild(pane);
      LOG.appendChild(wrap);
      return;
    }
    var list = el("div", "cities-log__list");
    logLines.slice(-40).forEach(function (entry) { list.appendChild(logLineEl(entry)); });
    pane.appendChild(list);
    wrap.appendChild(pane);
    LOG.appendChild(wrap);
    list.scrollTop = list.scrollHeight;
    requestAnimationFrame(function () { list.scrollTop = list.scrollHeight; });
  }
  function railBtn(label, name) {
    var b = el("button", "cities-lograil__btn" + (logView === name ? " is-active" : ""), label);
    b.type = "button";
    b.setAttribute("aria-pressed", logView === name ? "true" : "false");
    b.addEventListener("click", function () {
      if (logView === name) return;
      logView = name; save(LOGVIEW_KEY, name);
      render();
    });
    return b;
  }
  function logLineEl(entry) {
    if (entry.divider) return el("div", "cities-log__turn", entry.divider);
    var line = el("div", "cities-log__line");
    entry.parts.forEach(function (p) {
      if (typeof p === "string") { line.appendChild(document.createTextNode(p)); return; }
      var s = el("span", "cities-log__res", resName(p.res));
      s.style.setProperty("--cres", "var(--cterr-" + p.res + ")");
      line.appendChild(s);
    });
    return line;
  }
  // Deck pane: the bank's public counts as mini hand-style cards + the dev
  // deck's remainder, an even 3-3 grid. Pre-game (no bank yet) shows em
  // dashes at the same card size — the pane never changes shape.
  function buildDeck() {
    var bank = (model && model.bank) || null;
    var wrap = el("div", "cities-deck");
    RES.forEach(function (r) {
      var chip = el("span", "cities-card cities-card--mini");
      chip.style.setProperty("--ccard", "var(--cterr-" + r + ")");
      chip.appendChild(el("span", "cities-card__n", bank && bank[r] != null ? String(bank[r]) : "—"));
      chip.appendChild(el("span", "cities-card__lbl", resName(r)));
      wrap.appendChild(chip);
    });
    // dev deck: TOTAL remaining only (per-type would leak drawn-but-unplayed
    // cards); the hover teaches the frame's FIXED shuffle mix instead
    var dev = el("span", "cities-card cities-card--mini");
    dev.style.setProperty("--ccard", "var(--title)");   // the in-hand dev-card idiom, not a sixth resource
    var left = model && model.devLeft != null ? String(model.devLeft) : "—";
    dev.appendChild(el("span", "cities-card__n", left));
    dev.appendChild(el("span", "cities-card__lbl", S.deckDevLabel));
    var spec = model && model.frame && Boards[model.frame] && Boards[model.frame].dev;
    if (spec && model.devLeft != null) {
      dev.title = fmt(S.devDeckTitle, { list: Object.keys(spec).map(function (k) { return spec[k] + "x " + (DEV_NAME[k] || k); }).join(", ") });
    }
    wrap.appendChild(dev);
    return wrap;
  }

  /* ── ROLE tile: player hand + action pills, or spectator note ─── */
  function renderRole() {
    ROLE.textContent = "";
    var seat = mySeat();
    if (seat == null) return renderSpectator();
    var p = model.turn && model.turn.pending;

    // a 7-discard takes over the whole play area
    if (model.phase === "main" && p && p.kind === "discard" && p.owed[seat] != null) { renderDiscard(p.owed[seat]); return; }

    // the inline build tray only lives while I can actually act
    var canAct = isMyTurn() && model.phase === "main" && model.turn.rolled && !p;
    if (!canAct) ui.actionMenu = null;

    // EVERY seated phase renders the same two-column play area — hand
    // top-left, controls top-right. The controls column grid-stacks the
    // full pills+tray gauge under whatever the phase shows instead (the
    // setup prompt, a robber/roads/steal prompt, nothing in lobby/over),
    // ghosting the gauge when covered — so the tile holds one size from
    // the lobby all the way to game over (the universal layout rule).
    var play = el("div", "cities-play");
    var handCol = el("div", "cities-play__hand");
    var ctrlCol = el("div", "cities-play__ctrl");
    var gauge = buildGauge(seat, canAct);
    var note = null;
    if (model.phase === "setup") {
      note = el("div", "cities-ctrlnote");
      note.appendChild(el("p", "cities-role__note", model.setup.seq[model.setup.i] === seat ? S.buildPrompt : S.metaSetup));
    } else if (model.phase === "main" && isMyTurn() && p && p.kind === "steal") {
      note = el("div", "cities-ctrlnote");
      renderSteal(p, note);
    } else if (model.phase === "main" && isMyTurn() && p && (p.kind === "robber" || p.kind === "roads")) {
      note = el("div", "cities-ctrlnote");
      note.appendChild(el("p", "cities-role__note", p.kind === "robber" ? S.robberPrompt : fmt(S.roadsPrompt, { n: p.left })));
    }
    if (note || model.phase !== "main") gauge.classList.add("is-ghost");
    ctrlCol.appendChild(gauge);
    if (note) ctrlCol.appendChild(note);
    renderHand(seat, handCol);
    renderLedger(handCol);
    play.appendChild(handCol);
    play.appendChild(ctrlCol);
    ROLE.appendChild(play);
  }
  // The pills + the reserved build tray — the controls column's constant-size
  // core, rendered in every phase (ghosted whenever a prompt or an idle phase
  // covers it) so the play area never changes height.
  function buildGauge(seat, canAct) {
    var gauge = el("div", "cities-gauge");
    var p = model.turn && model.turn.pending;
    var mine = model.phase === "main" && isMyTurn();
    var rolled = !!(model.turn && model.turn.rolled);
    var pills = el("div", "cities-actions");
    var rollAble = mine && !rolled && !p;
    var rollPill = actionPill(S.pillRoll, rollAble, function () { send({ type: "roll" }); });
    rollPill.classList.add("cities-act--roll");
    if (rollAble) rollPill.classList.add("is-glow");
    pills.appendChild(rollPill);
    pills.appendChild(actionPill(S.pillBuild, canAct, function () { toggleActionMenu("build"); }, ui.actionMenu === "build"));
    // Trade toggles the hub overlay (offers + initiate buttons); stays
    // usable off-turn while offers are open so an incoming trade can be
    // re-opened after dismissing the hub
    var tradeAble = canAct || !!(model.offers && model.offers.length);
    pills.appendChild(actionPill(S.pillTrade, tradeAble, function () { ui.tradeHub = !ui.tradeHub; ui.actionMenu = null; ui.mode = null; render(); }, ui.tradeHub));
    pills.appendChild(actionPill(S.pillEnd, canAct, function () { ui.mode = null; ui.actionMenu = null; send({ type: "endTurn" }); }));
    gauge.appendChild(pills);
    // The tray slot is ALWAYS in the DOM at full size: the build tray and
    // the cancel link are grid-stacked in one cell, the active one visible
    // and the rest visibility-hidden — so toggling Build never changes the
    // tile's size (the universal layout rule: nothing may resize or push).
    // Trade lives in the hub overlay (renderTrade), not the tray.
    var tray = el("div", "cities-tray");
    var bOpts = buildOptions(seat);
    if (ui.actionMenu !== "build") bOpts.classList.add("is-ghost");
    tray.appendChild(bOpts);
    var cancel = el("button", "cities-cancel", S.cancelBuild); cancel.type = "button";
    cancel.addEventListener("click", function () { ui.mode = null; render(); });
    if (!(ui.mode && ui.mode.indexOf("place") === 0)) cancel.classList.add("is-ghost");
    tray.appendChild(cancel);
    gauge.appendChild(tray);
    return gauge;
  }
  function actionPill(label, enabled, onClick, active) {
    var b = el("button", "tb-pill cities-act" + (active ? " is-active" : "")); b.type = "button";
    b.appendChild(el("span", "tb-pill__label", label));
    b.disabled = !enabled;
    if (active) b.setAttribute("aria-expanded", "true");
    if (enabled) b.addEventListener("click", onClick);
    return b;
  }
  function toggleActionMenu(name) { ui.actionMenu = ui.actionMenu === name ? null : name; ui.mode = null; render(); }
  function costText(cost) { return RES.filter(function (r) { return cost[r]; }).map(function (r) { return cost[r] + "x " + resName(r); }).join(", "); }
  function canAfford(hand, cost) { return RES.every(function (r) { return (hand[r] || 0) >= (cost[r] || 0); }); }
  function optButton(title, cost, enabled, onClick) {
    var b = el("button", "cities-opt"); b.type = "button"; b.disabled = !enabled;
    b.appendChild(el("span", "cities-opt__title", title));
    if (cost) b.appendChild(el("span", "cities-opt__cost", costText(cost)));
    if (enabled) b.addEventListener("click", onClick);
    return b;
  }
  function buildOptions(seat) {
    var hand = (model.you && model.you.hand) || {};
    // a right-aligned 2x2 grid, row-major: Road | Settlement / Dev | City
    var wrap = el("div", "cities-buildopts");
    wrap.appendChild(optButton(S.buildRoad, BUILD_COST.road, canAfford(hand, BUILD_COST.road), function () { ui.mode = "place-road"; ui.actionMenu = null; render(); }));
    wrap.appendChild(optButton(S.buildSettlement, BUILD_COST.settlement, canAfford(hand, BUILD_COST.settlement), function () { ui.mode = "place-settlement"; ui.actionMenu = null; render(); }));
    wrap.appendChild(optButton(S.buildDev, BUILD_COST.dev, canAfford(hand, BUILD_COST.dev), function () { ui.actionMenu = null; send({ type: "buyDev" }); }));
    wrap.appendChild(optButton(S.buildCity, BUILD_COST.city, canAfford(hand, BUILD_COST.city), function () { ui.mode = "place-city"; ui.actionMenu = null; render(); }));
    return wrap;
  }
  function renderHand(seat, parent) {
    var hand = (model.you && model.you.hand) || {};
    var wrap = el("div", "cities-hand");
    wrap.appendChild(el("h3", "cities-hand__title", S.handTitle));
    var res = el("div", "cities-hand__res");
    RES.forEach(function (r) {
      var chip = el("span", "cities-card");
      chip.style.setProperty("--ccard", "var(--cterr-" + r + ")");
      chip.appendChild(el("span", "cities-card__n", String(hand[r] || 0)));
      chip.appendChild(el("span", "cities-card__lbl", resName(r)));
      res.appendChild(chip);
    });
    wrap.appendChild(res);
    // dev cards live under the resources — playable ones are buttons, a VP is
    // an inert marker; hover any for what it does (docs/cities.md flavor).
    // The row is ALWAYS rendered (a ghost card holds its height while empty)
    // so the first dev card bought doesn't grow the tile.
    var dev = (model.you && model.you.dev) || [];
    wrap.appendChild(renderDevRow(dev));
    (parent || ROLE).appendChild(wrap);
  }
  /* The since-your-last-turn ledger, filling the hand column's slack.
     ALWAYS five rows in hand order (name + net delta) — rows never add,
     remove, or reorder, and the value cell reserves width, so nothing
     can jitter. Quiet resources show a dim dash; active rows carry the
     per-source breakdown on the native title (the dev-card hover idiom).
     Hidden entirely under 62rem (essentials-only; main.css). */
  function renderLedger(parent) {
    var wrap = el("div", "cities-ledger");
    wrap.appendChild(el("p", "cities-ledger__title", S.ledgerTitle));
    var rows = el("div", "cities-ledger__rows");
    RES.forEach(function (r) {
      var g = (ledger && ledger[r]) || { net: 0, parts: {}, order: [] };
      var quiet = !g.order.length;
      var name = el("span", "cities-ledger__res" + (quiet ? " is-quiet" : ""), resName(r));
      var val = el("span", "cities-ledger__n" + (quiet ? " is-quiet" : g.net < 0 ? " is-loss" : g.net > 0 ? " is-gain" : ""), quiet ? "—" : fmtNet(g.net));
      if (!quiet) {
        name.style.setProperty("--cres", "var(--cterr-" + r + ")");
        var tip = S.ledgerTitle + ": " + g.order.map(function (l) { return fmtNet(g.parts[l]) + " " + l; }).join(" · ");
        name.title = tip; val.title = tip;
      }
      rows.appendChild(name); rows.appendChild(val);
    });
    wrap.appendChild(rows);
    parent.appendChild(wrap);
  }
  function fmtNet(n) { return n > 0 ? "+" + n : n < 0 ? "−" + (-n) : "0"; }
  function renderDevRow(dev) {
    var row = el("div", "cities-devrow");
    if (!dev.length) {
      var ghost = el("button", "cities-devcard is-ghost"); ghost.type = "button";
      ghost.disabled = true; ghost.tabIndex = -1; ghost.setAttribute("aria-hidden", "true");
      ghost.appendChild(el("span", null, DEV_NAME.knight));
      row.appendChild(ghost);
      return row;
    }
    var canAct = isMyTurn() && model.phase === "main" && !(model.turn && model.turn.pending) && !(model.turn && model.turn.devPlayed);
    dev.forEach(function (d) {
      var isVp = d.card === "vp";
      var playable = canAct && d.playable && !isVp;
      var b = el("button", "cities-devcard" + (isVp ? " is-vp" : "") + (!d.playable && !isVp ? " is-locked" : "")); b.type = "button";
      b.appendChild(el("span", null, DEV_NAME[d.card] || d.card));
      if (DEV_DESC[d.card]) b.title = DEV_DESC[d.card];
      b.disabled = !playable;
      if (playable) b.addEventListener("click", function () { ui.actionMenu = null; playDevCard(d.card); });
      row.appendChild(b);
    });
    return row;
  }
  function renderDiscard(need) {
    var sel = {}; RES.forEach(function (r) { sel[r] = 0; });
    var wrap = el("div", "cities-discard");
    wrap.appendChild(el("p", "cities-role__note", fmt(S.discardPrompt, { n: need })));
    var hand = (model.you && model.you.hand) || {};
    var box = el("div", "cities-discard__box");
    var row = el("div", "cities-discard__cards");
    RES.forEach(function (r) {
      var chip = el("button", "cities-card cities-card--btn"); chip.type = "button";
      chip.style.setProperty("--ccard", "var(--cterr-" + r + ")");
      var nEl = el("span", "cities-card__n", "0/" + (hand[r] || 0));
      chip.appendChild(nEl); chip.appendChild(el("span", "cities-card__lbl", resName(r)));
      chip.addEventListener("click", function () {
        var picked = Object.keys(sel).reduce(function (a, k) { return a + sel[k]; }, 0);
        if (sel[r] < (hand[r] || 0) && picked < need) sel[r]++; else if (sel[r] > 0) sel[r]--;
        nEl.textContent = sel[r] + "/" + (hand[r] || 0);
        chip.classList.toggle("is-sel", sel[r] > 0);
        confirm.disabled = Object.keys(sel).reduce(function (a, k) { return a + sel[k]; }, 0) !== need;
      });
      row.appendChild(chip);
    });
    box.appendChild(row);
    var confirm = el("button", "cities-discard__go"); confirm.type = "button"; confirm.disabled = true;
    confirm.appendChild(el("span", null, S.discardGo));
    confirm.addEventListener("click", function () {
      lastDiscard = {}; RES.forEach(function (r) { lastDiscard[r] = sel[r]; });   // the ledger needs the composition; the event only carries the count
      send({ type: "discard", cards: sel });
    });
    box.appendChild(confirm);
    wrap.appendChild(box);
    ROLE.appendChild(wrap);
  }
  function renderSteal(p, parent) {
    parent.appendChild(el("p", "cities-role__note", S.stealPrompt));
    var row = el("div", "cities-steal");
    p.targets.forEach(function (s) {
      var b = el("button", "cities-chip"); b.type = "button";
      b.appendChild(seatDot(s)); b.appendChild(el("span", null, seatName(s)));
      b.addEventListener("click", function () { send({ type: "steal", target: s }); });
      row.appendChild(b);
    });
    parent.appendChild(row);
  }
  function renderSpectator() {
    ROLE.appendChild(el("p", "cities-role__note", S.spectatingNote));
    if (model.settings && model.settings.betting) {
      ROLE.appendChild(el("p", "cities-role__note cities-role__betting", S.bettingSoon));
      if (model.you && model.you.chips != null) ROLE.appendChild(el("p", "cities-role__chips", fmt(S.chipsLabel, { n: model.you.chips })));
    }
  }

  /* ── dev-card play (build/trade now use the in-panel option tray) ─ */
  function playDevCard(card) {
    if (card === "knight") { send({ type: "playDev", card: "knight" }); }
    else if (card === "road") { send({ type: "playDev", card: "road" }); }
    else if (card === "monopoly") { pickResource(S.monopolyPrompt, function (r) { send({ type: "playDev", card: "monopoly", args: { resource: r } }); }); }
    else if (card === "plenty") { pickTwo(S.plentyPrompt, function (a, b) { send({ type: "playDev", card: "plenty", args: { a: a, b: b } }); }); }
  }
  function pickResource(prompt, cb) {
    TRADE.hidden = false; TRADE.textContent = "";
    var panel = el("div", "cities-tpanel");
    panel.appendChild(el("h3", "cities-tpanel__title", prompt));
    var row = el("div", "cities-tpanel__res");
    RES.forEach(function (r) { var b = resButton(r); b.addEventListener("click", function () { closeTradePanel(); cb(r); }); row.appendChild(b); });
    panel.appendChild(row); addClose(panel); TRADE.appendChild(panel);
  }
  function pickTwo(prompt, cb) {
    var picks = [];
    TRADE.hidden = false; TRADE.textContent = "";
    var panel = el("div", "cities-tpanel");
    var title = el("h3", "cities-tpanel__title", prompt); panel.appendChild(title);
    var row = el("div", "cities-tpanel__res");
    RES.forEach(function (r) { var b = resButton(r); b.addEventListener("click", function () { picks.push(r); if (picks.length === 2) { closeTradePanel(); cb(picks[0], picks[1]); } else title.textContent = prompt + " (" + resName(r) + ")"; }); row.appendChild(b); });
    panel.appendChild(row); addClose(panel); TRADE.appendChild(panel);
  }
  function resButton(r) {
    var b = el("button", "cities-card cities-card--btn"); b.type = "button";
    b.style.setProperty("--ccard", "var(--cterr-" + r + ")");
    b.appendChild(el("span", "cities-card__lbl", resName(r)));
    return b;
  }
  function addClose(panel) {
    var x = el("button", "cities-tpanel__close", "✕"); x.type = "button";
    x.addEventListener("click", closeTradePanel);
    panel.appendChild(x);
  }
  // retire whatever tpanel is up and fall back to the hub (or hide) — every
  // panel exit funnels through here so a stale tpanel can never wedge the
  // overlay shut (renderTrade skips while one is in the DOM)
  function closeTradePanel() {
    TRADE.textContent = ""; TRADE.hidden = true;
    renderTrade();
  }

  /* ── TRADE tools (bank / players) — inline hub sections ───────── */
  // The Bank / Players toggles disclose their builder INLINE under the init
  // row. The built node is cached (tradeToolEl) and re-appended across
  // renders so in-progress picks survive the steady state broadcasts (bots
  // act every ~650ms); it rebuilds only when a toggle flips.
  var tradeToolEl = null;
  function closeTradeTool() { ui.tradeTool = null; tradeToolEl = null; }
  function toolToggle(label, name) {
    var active = ui.tradeTool === name;
    var b = optButton(label, null, true, function () {
      ui.tradeTool = active ? null : name;
      tradeToolEl = null;
      render();
    });
    if (active) { b.classList.add("is-active"); b.setAttribute("aria-expanded", "true"); }
    return b;
  }
  function bankTradeSection() {
    var harbors = (model.you && model.you.harbors) || {};
    var give = null, get = {}; RES.forEach(function (r) { get[r] = 0; });
    var sec = el("div", "cities-offers__tool");
    var giveRow = el("div", "cities-tpanel__res"); sec.appendChild(el("span", "cities-tpanel__lbl", S.tradeGive)); sec.appendChild(giveRow);
    var doTrade = el("button", "tb-pill cities-act"); doTrade.type = "button"; doTrade.disabled = true; doTrade.appendChild(el("span", "tb-pill__label", S.tradeClose));
    function rate(r) { return harbors[r] ? 2 : harbors.any ? 3 : 4; }
    RES.forEach(function (r) {
      var b = resButton(r); b.appendChild(el("span", "cities-card__n", rate(r) + ":1"));
      b.addEventListener("click", function () { give = r; mark(giveRow, b); refresh(); }); giveRow.appendChild(b);
    });
    // get side steps up/down per resource so multiple units trade at once
    // (one bankTrade {give, get, n} per stepped resource type)
    sec.appendChild(el("span", "cities-tpanel__lbl", S.tradeGet));
    sec.appendChild(stepperRow(get, refresh));
    function mark(row, btn) { row.querySelectorAll(".cities-card").forEach(function (x) { x.classList.remove("is-sel"); }); btn.classList.add("is-sel"); }
    function total() { return RES.reduce(function (a, r) { return a + get[r]; }, 0); }
    function refresh() { doTrade.disabled = !(give && total() > 0); }
    doTrade.addEventListener("click", function () {
      var want = compact(get), kinds = Object.keys(want);
      if (!give || !kinds.length || want[give]) { toast(S.errRate, "error"); return; }
      var hand = (model.you && model.you.hand) || {};
      if ((hand[give] || 0) < rate(give) * total()) { toast(S.errCost, "error"); return; }
      kinds.forEach(function (r) { send({ type: "bankTrade", give: give, get: r, n: want[r] }); });
      closeTradeTool(); render();
    });
    sec.appendChild(doTrade);
    return sec;
  }
  function offerBuilderSection() {
    var give = {}, get = {}; RES.forEach(function (r) { give[r] = 0; get[r] = 0; });
    var sec = el("div", "cities-offers__tool");
    sec.appendChild(el("span", "cities-tpanel__lbl", S.tradeGive));
    sec.appendChild(stepperRow(give));
    sec.appendChild(el("span", "cities-tpanel__lbl", S.tradeGet));
    sec.appendChild(stepperRow(get));
    var sendBtn = el("button", "tb-pill cities-act"); sendBtn.type = "button"; sendBtn.appendChild(el("span", "tb-pill__label", S.tradeSend));
    sendBtn.addEventListener("click", function () {
      var g = compact(give), h = compact(get);
      if (!Object.keys(g).length || !Object.keys(h).length) { toast(S.errRate, "error"); return; }
      var hand = (model.you && model.you.hand) || {};
      if (!canAfford(hand, g)) { toast(S.offerShort, "error"); return; }
      send({ type: "offer", give: g, get: h }); closeTradeTool(); render();
    });
    sec.appendChild(sendBtn);
    return sec;
  }
  function stepperRow(bag, onChange) {
    // 5 horizontal resource cards (like the hand): [−] value/label [+], laid
    // out 2-per-row with the fifth centered on the third row (CSS grid)
    var row = el("div", "cities-steps");
    RES.forEach(function (r) {
      var cell = el("div", "cities-step");
      cell.style.setProperty("--ccard", "var(--cterr-" + r + ")");
      var val = el("span", "cities-step__n", "0");
      var minus = el("button", "cities-step__b", "−"); minus.type = "button";
      var plus = el("button", "cities-step__b", "+"); plus.type = "button";
      minus.addEventListener("click", function () { if (bag[r] > 0) { bag[r]--; val.textContent = bag[r]; if (onChange) onChange(); } });
      plus.addEventListener("click", function () { bag[r]++; val.textContent = bag[r]; if (onChange) onChange(); });
      var body = el("div", "cities-step__body");
      body.appendChild(val);
      body.appendChild(el("span", "cities-step__lbl", resName(r)));
      cell.appendChild(minus); cell.appendChild(body); cell.appendChild(plus);
      row.appendChild(cell);
    });
    return row;
  }
  function compact(bag) { var o = {}; RES.forEach(function (r) { if (bag[r] > 0) o[r] = bag[r]; }); return o; }

  /* the trade hub docks over the board's right quarter: Bank / Players
     toggles up top disclosing their builder inline underneath, then the live
     offers. The Trade pill toggles the hub; an incoming offer opens it
     (handleEvent sets ui.tradeHub). */
  function renderTrade() {
    if (!TRADE || !TRADE.classList) return;
    // don't clobber a dev-card picker panel that's open
    if (TRADE.querySelector(".cities-tpanel")) return;
    var offers = (model.offers || []);
    var seat = mySeat();
    var fadeIds = Object.keys(fadingOffers);
    var canAct = seat != null && model.phase === "main" && isMyTurn() && model.turn.rolled && !model.turn.pending;
    // nothing to show and nothing to start — the hub falls closed (a fading
    // ghost holds it open long enough to be seen going)
    if (model.phase !== "main" || (!offers.length && !fadeIds.length && !canAct)) ui.tradeHub = false;
    if (!ui.tradeHub) { TRADE.hidden = true; TRADE.textContent = ""; closeTradeTool(); return; }
    TRADE.hidden = false; TRADE.textContent = "";
    var box = el("div", "cities-offers");
    var title = el("h3", "cities-offers__title");
    title.appendChild(el("span", null, S.tradeTitle));
    title.appendChild(el("span", "cities-offers__count", String(offers.length)));
    box.appendChild(title);
    if (canAct) {
      var init = el("div", "cities-offers__init");
      init.appendChild(toolToggle(S.tradeWithBank, "bank"));
      init.appendChild(toolToggle(S.tradeWithPlayers, "players"));
      box.appendChild(init);
      if (ui.tradeTool) {
        if (!tradeToolEl) tradeToolEl = ui.tradeTool === "bank" ? bankTradeSection() : offerBuilderSection();
        box.appendChild(tradeToolEl);
      }
    } else closeTradeTool();
    offers.forEach(function (o) {
      var mineOffer = o.from === seat;
      var incoming = seat != null && !mineOffer && !(o.responses && o.responses[seat]);
      var card = el("div", "cities-offer" + (mineOffer ? " is-mine" : "") + (incoming ? " is-incoming" : ""));
      if (mineOffer) card.style.setProperty("--cstrip", "var(--cseat-" + o.from + ")");
      var head = mineOffer ? fmt(S.offerFrom, { name: seatName(o.from) }) : fmt(S.offerToYou, { name: seatName(o.from) });
      card.appendChild(el("div", "cities-offer__head", head));
      card.appendChild(bundleView(S.tradeGive, o.give));
      card.appendChild(bundleView(S.tradeGet, o.get));
      var btns = el("div", "cities-offer__btns");
      if (seat != null) {
        if (mineOffer) {
          // participants as accent strips (the players-tile idiom): verdict at
          // a glance, and an accepted strip IS the close-the-deal button
          var status = el("div", "cities-offer__seats");
          (model.players || []).forEach(function (_p, s) {
            if (s === o.from) return;
            var verdict = o.responses && o.responses[s];
            // an embargoed seat reads as declined no matter what they said
            var emb = isEmbargoed(s);
            if (emb) verdict = "decline";
            var row = el("button", "cities-offer__seat" + (verdict === "accept" ? " is-accept" : verdict === "decline" ? " is-decline" : ""));
            row.type = "button";
            row.style.setProperty("--cstrip", "var(--cseat-" + s + ")");
            row.appendChild(seatDot(s));
            row.appendChild(el("span", "cities-offer__seatname", seatName(s)));
            row.appendChild(el("span", "cities-offer__verdict", emb ? "🚫" : verdict === "accept" ? "✓" : verdict === "decline" ? "✕" : "…"));
            if (verdict === "accept") {
              row.setAttribute("aria-label", S.tradeClose + " · " + seatName(s));
              row.addEventListener("click", function () { send({ type: "close", offerId: o.id, accepter: s }); });
            } else row.disabled = true;
            status.appendChild(row);
          });
          card.appendChild(status);
          var cancel = el("button", "cities-chip", S.tradeCancel); cancel.type = "button"; cancel.addEventListener("click", function () { send({ type: "cancel", offerId: o.id }); }); btns.appendChild(cancel);
        } else {
          var acc = el("button", "cities-chip", S.tradeAccept); acc.type = "button"; acc.addEventListener("click", function () { send({ type: "respond", offerId: o.id, action: "accept" }); }); btns.appendChild(acc);
          var dec = el("button", "cities-chip", S.tradeDecline); dec.type = "button"; dec.addEventListener("click", function () { send({ type: "respond", offerId: o.id, action: "decline" }); }); btns.appendChild(dec);
        }
      }
      card.appendChild(btns);
      box.appendChild(card);
    });
    // ghosts of fully-declined offers, fading out (no controls)
    fadeIds.forEach(function (id) {
      var o = fadingOffers[id];
      var ghost = el("div", "cities-offer cities-offer--fading" + (o.from === seat ? " is-mine" : ""));
      if (o.from === seat) ghost.style.setProperty("--cstrip", "var(--cseat-" + o.from + ")");
      ghost.appendChild(el("div", "cities-offer__head", o.from === seat ? fmt(S.offerFrom, { name: seatName(o.from) }) : fmt(S.offerToYou, { name: seatName(o.from) })));
      ghost.appendChild(bundleView(S.tradeGive, o.give));
      ghost.appendChild(bundleView(S.tradeGet, o.get));
      box.appendChild(ghost);
    });
    TRADE.appendChild(box);
  }
  function bundleView(label, bag) {
    var row = el("div", "cities-offer__row");
    row.appendChild(el("span", "cities-offer__lbl", label));
    RES.forEach(function (r) { var n = (bag && bag[r]) || 0; if (!n) return; var chip = el("span", "cities-minichip", n + "×"); chip.style.setProperty("--ccard", "var(--cterr-" + r + ")"); chip.appendChild(el("span", null, resName(r))); row.appendChild(chip); });
    return row;
  }

  /* ═══ BOOT ═════════════════════════════════════════════════════ */
  window.addEventListener("resize", function () {
    if (!joined || !model) return;
    ROLE.style.minHeight = "";   // wrap points moved — re-measure the lock
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
