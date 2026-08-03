/* DeetsPoker — the table UI (docs/poker.md).

   The shared shell (games/table.js) owns the gate, lobby, seats, toolbar,
   reconnect, and the turn-timer readouts; this file supplies the felt, the
   hand panel, the roster, and the shell's hooks. All flavor copy comes from
   strings.js ([ph] convention); the terse mechanical LOG lines are the one
   Claude-authored exception, rendered from typed event records.

   Money is integer cents everywhere on the wire; fmtMoney() is the ONLY
   place cents become text. */
(function () {
  "use strict";

  var S = window.POKER_STRINGS;
  var Engine = window.PokerEngine;
  var Colors = window.DeetsColors;

  var BAR_INPUT = document.querySelector("[data-pk-code]");
  var CODE_POP = document.querySelector("[data-pk-code-pop]");
  var TOOLBAR = document.querySelector("[data-pk-toolbar]");
  var GATE = document.querySelector("[data-pk-gate]");
  var TABLE = document.querySelector("[data-pk-table]");
  var BIG = document.querySelector("[data-pk-big]");
  var PLAYERS = document.querySelector("[data-pk-players]");
  var ROLE = document.querySelector("[data-pk-role]");
  var LOG = document.querySelector("[data-pk-log]");
  var LOG_LIST = document.querySelector("[data-pk-log-list]");
  var DESKTOP = document.querySelector("[data-pk-desktop]");

  var model = null;
  var TBL = window.DeetsTable.create({
    ns: "poker",
    api: "https://poker-api.deets.solutions",
    mock: window.PokerTransport,        // transport-mock.js
    // phase 1: no worker yet, so the mock runs WITHOUT ?mock. Drop this
    // flag when ../DeetsPoker deploys (docs/poker.md, "Build phases").
    mockDefault: true,
    strings: S,
    rootSel: ".pk",
    capacity: 12,
    minSeats: 2,
    // locked to "none": no bots mid-game, ever — standing, kicks, and grace
    // expiry all cash the seat out (engine `concede`). The shell hides the
    // single-mode row.
    rejoinModes: ["none"],
    startNeedsHint: S.startNeedsTwo,
    logCap: 150,
    errExtra: { raise: S.errRaise, chips: S.errChips, seating: S.errSeating,
                blind: S.blindBad, buyin: S.buyInBad },
    /* fields the worker omits when absent must clear, not linger — every
       broadcast is a full view, so an omission means genuinely gone. A
       rematch omits the lot: the lobby must not paint a discarded game. */
    clearFields: ["handNo", "dealer", "street", "board", "waiting", "blinds",
                  "players", "pot", "turn", "handOver", "handOverAt", "votes",
                  "over", "turnEndsAt"],
    clearYouFields: ["hole", "options", "myVote", "canBuyIn"],
    els: {
      bar: BAR_INPUT, codePop: CODE_POP, codeCtrl: document.querySelector(".gt-code"),
      toolbar: TOOLBAR, gate: GATE, table: TABLE, big: BIG, log: LOG, desktop: DESKTOP
    },
    onModel: function (m) {
      var prevTurn = model && model.turn ? model.turn.seat : null;
      model = m;
      if (!m) return;
      var mine = mySeat();
      if (m.turn && mine != null && m.turn.seat === mine && prevTurn !== mine) {
        toast(S.yourTurnToast, "info");
      }
    },
    onEvent: handleEvent,
    logLine: logLine,
    render: paint,
    postRender: function () {
      seedDistinctColor();
      fitLog();
    },
    onLeave: resetGameUi,
    onRematch: resetGameUi,
    extraPills: extraPills,
    lobbySettings: lobbySettings,
    settingsRows: function () {
      var st = model.settings;
      return [
        [S.capacityLabel, String(st.capacity)],
        [S.buyInLabel, fmtMoney(st.buyIn)],
        [S.blindLabel, fmtMoney(st.bigBlind / 2) + " / " + fmtMoney(st.bigBlind)],
        [S.timerLabel, st.timerSec ? fmt(S.timerSecs, { n: st.timerSec }) : S.timerOff],
        [S.minRaiseLabel, minRaiseLabel(st.minRaise)],
        [S.seatingLabel, st.seating === "open" ? S.seatingOpen : S.seatingLobby],
        [S.chipsLabel, st.chips.map(function (c) { return fmtMoney(c.v); }).join(" · ")]
      ];
    }
  });
  // shell utilities under their old names — the board code reads them as ever
  var el = TBL.el, load = TBL.load, save = TBL.save, fmt = TBL.fmt;
  var toast = TBL.toast, seatDot = TBL.seatDot, seatAccent = TBL.seatAccent;
  var mySeat = TBL.mySeat, seatName = TBL.seatName;
  var logLines = TBL.logLines, ui = TBL.ui;
  function send(msg) { TBL.send(msg); }
  function render() { TBL.render(); }
  function fitLog() { TBL.fitLog(".pk-log__list"); }

  /* ── page state (this game's own; broadcasts must not wipe drafts) ── */
  ui.raiseOpen = false;       // the tray under the action buttons
  ui.raiseDraft = null;       // cents OVER the current bet ("Raise by")
  ui.chipDrafts = null;       // the lobby chip-ladder inputs mid-typing
  ui.chipDrag = null;         // index of the ladder token being dragged
  var colorSeeded = false;    // one auto-recolor attempt per clash
  var overTick = null;        // the interstitial's countdown handle

  function resetGameUi() {
    ui.raiseOpen = false; ui.raiseDraft = null;
    ui.chipDrafts = null; ui.chipDrag = null;
    if (overTick) { clearTimeout(overTick); overTick = null; }
  }

  /* ── money (the ONE cents → text spot) ────────────────────────── */
  function fmtMoney(cents) {
    if (cents == null) return "";
    if (cents < 100) return cents + "¢";
    var d = cents / 100;
    return "$" + (cents % 100 ? d.toFixed(2) : String(Math.round(d)));
  }
  function minRaiseLabel(mode) {
    return mode === "double" ? S.minRaiseDouble : mode === "none" ? S.minRaiseNone : S.minRaisePrev;
  }
  function chipValsNow() {
    return (model.settings.chips || []).map(function (c) { return c.v; });
  }

  /* ── cards ────────────────────────────────────────────────────── */
  var SUIT_GLYPH = { s: "♠", h: "♥", d: "♦", c: "♣" };
  function cardEl(card, big) {
    var cls = "pk-card" + (big ? " pk-card--big" : "");
    if (!card) return el("span", cls + " pk-card--slot");
    var red = card.charAt(1) === "h" || card.charAt(1) === "d";
    var n = el("span", cls + (red ? " pk-card--red" : " pk-card--black"));
    n.appendChild(el("span", null, card.charAt(0) === "T" ? "10" : card.charAt(0)));
    n.appendChild(el("span", "pk-card__suit", SUIT_GLYPH[card.charAt(1)]));
    return n;
  }

  /* ── auto-recolor past the presets (docs/poker.md, "Seat colors") ──
     colors.js knows six presets; a 7th+ lobby sit is assigned a duplicate
     fallback. When MY color clashes with an earlier seat's, claim a random
     clash-free hex instead — profile colors got their shot first via the
     shell's own seeding. One attempt per clash so a refusal can't loop. */
  function seedDistinctColor() {
    if (!model || model.phase !== "lobby") { colorSeeded = false; return; }
    var mine = mySeat();
    if (mine == null) { colorSeeded = false; return; }
    var seats = model.seats || [];
    var me = seats[mine];
    if (!me || !me.color) return;
    var others = seats.map(function (s, i) {
      return s && !s.empty && i !== mine ? s.color : null;
    });
    if (Colors.clash(me.color, others) < 0) { colorSeeded = false; return; }
    if (colorSeeded) return;
    colorSeeded = true;
    for (var k = 0; k < 60; k++) {
      var hex = "#" + ("00000" + Math.floor(Math.random() * 0x1000000).toString(16)).slice(-6);
      if (Colors.clash(hex, others) < 0) { send({ type: "recolor", seat: mine, color: hex }); return; }
    }
  }

  /* ── toolbar: poker's own pills (docs/poker.md, "Ending a game") ── */
  function extraPills() {
    if (!model || model.phase === "lobby") return [];
    var pills = [];
    var mine = mySeat();
    var seatedMe = mine != null;
    var live = model.players && mine != null && model.players[mine] && !model.players[mine].left;
    if (model.phase !== "over") {
      if (live) {
        var v = model.votes || { n: 0, need: 1 };
        var vp = TBL.pill(S.voteEndPill, function () { send({ type: "voteEnd" }); });
        vp.appendChild(el("span", "tb-pill__label", " " + fmt(S.voteEndCount, { n: v.n, need: v.need })));
        if (model.you && model.you.myVote) vp.classList.add("is-active");
        pills.push(vp);
      }
      if (model.host) {
        var ep = TBL.pill(S.endGamePill, function () {
          if (ep._armed) { send({ type: "endGame" }); }
          else {
            ep._armed = true; ep.querySelector(".tb-pill__label").textContent = S.endGameConfirm;
            setTimeout(function () {
              if (ep.isConnected) { ep._armed = false; ep.querySelector(".tb-pill__label").textContent = S.endGamePill; }
            }, 2600);
          }
        });
        pills.push(ep);
      }
      if (!seatedMe && model.settings.seating === "open" &&
          (model.seats || []).length < model.settings.capacity) {
        pills.push(TBL.pill(S.sitInPill, function () { send({ type: "sitIn" }); }));
      }
    }
    return pills;
  }

  /* ── lobby settings (the host's rows; chips disabled for guests) ── */
  function lobbySettings(wrap) {
    var st = model.settings;
    var host = model.host;

    var caps = [];
    for (var c = 2; c <= 12; c++) caps.push([c, String(c)]);
    wrap.appendChild(TBL.choiceRow(S.capacityLabel, "capacity", caps, st.capacity));

    // buy-in: whole-dollar presets + a free box (any amount, engine-checked)
    var buyRow = TBL.choiceRow(S.buyInLabel, "buyIn",
      [[500, "$5"], [1000, "$10"], [2000, "$20"], [5000, "$50"], [10000, "$100"]], st.buyIn);
    buyRow.opts.appendChild(moneyChip("buyIn", st.buyIn, [500, 1000, 2000, 5000, 10000], S.buyInCustom, false));
    wrap.appendChild(buyRow);

    // the chip ladder: one token per denomination, value editable in place,
    // DRAG to reorder (host only, no affordance — the order is the host's
    // to mean something by; the wire keeps it verbatim)
    var chipRow = TBL.setRow(S.chipsLabel);
    var ladder = el("span", "pk-chiprow");
    (st.chips || []).forEach(function (chip, i) {
      var tok = el("span", "pk-chip");
      if (host) {
        tok.draggable = true;
        tok.addEventListener("dragstart", function (e) {
          ui.chipDrag = i;
          if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }
        });
        tok.addEventListener("dragover", function (e) { e.preventDefault(); });
        tok.addEventListener("drop", function (e) {
          e.preventDefault();
          var from = ui.chipDrag;
          ui.chipDrag = null;
          if (from == null || from === i) return;
          var next = st.chips.slice();
          var moved = next.splice(from, 1)[0];
          next.splice(i, 0, moved);
          send({ type: "setSettings", chips: next });
        });
      }
      var dot = el("span", "pk-chip__dot");
      dot.style.background = chip.hex;
      tok.appendChild(dot);
      var box = el("input", "pk-chip__val");
      box.type = "text";
      box.disabled = !host;
      box.value = (ui.chipDrafts && ui.chipDrafts[i] != null) ? ui.chipDrafts[i] : fmtMoney(chip.v);
      box.setAttribute("aria-label", S.chipsLabel);
      box.addEventListener("input", function () {
        ui.chipDrafts = ui.chipDrafts || {};
        ui.chipDrafts[i] = box.value;
      });
      function commit() {
        ui.chipDrafts = null;
        var v = parseMoney(box.value, true);   // bare numbers are cents here
        if (v == null || v <= 0) { render(); return; }
        var next = st.chips.map(function (ch, k) { return { v: k === i ? v : ch.v, hex: ch.hex }; });
        send({ type: "setSettings", chips: next });
      }
      box.addEventListener("change", commit);
      box.addEventListener("keydown", function (e) { if (e.key === "Enter") box.blur(); });
      tok.appendChild(box);
      ladder.appendChild(tok);
    });
    chipRow.opts.appendChild(ladder);
    wrap.appendChild(chipRow);
    wrap.appendChild(el("p", "pk-sethint", S.chipsHint));

    // big blind: cent presets + a free box; the one rule is dictated below
    var blindRow = TBL.choiceRow(S.blindLabel, "bigBlind",
      [[10, "10¢"], [20, "20¢"], [50, "50¢"], [100, "$1"]], st.bigBlind);
    // bare numbers in the blind box mean CENTS ("30" → 30¢, "$1" still works)
    blindRow.opts.appendChild(moneyChip("bigBlind", st.bigBlind, [10, 20, 50, 100], "¢", true));
    wrap.appendChild(blindRow);
    wrap.appendChild(el("p", "pk-sethint", S.blindHalfHint));

    var timerRow = TBL.choiceRow(S.timerLabel, "timerSec",
      [[0, S.timerOff], [15, fmt(S.timerSecs, { n: 15 })], [30, fmt(S.timerSecs, { n: 30 })],
       [60, fmt(S.timerSecs, { n: 60 })], [120, fmt(S.timerSecs, { n: 120 })]], st.timerSec);
    timerRow.opts.appendChild(TBL.numChip("timerSec", st.timerSec, [0, 15, 30, 60, 120], S.timerCustom, 5, 600));
    wrap.appendChild(timerRow);

    wrap.appendChild(TBL.choiceRow(S.minRaiseLabel, "minRaise",
      [["prev", S.minRaisePrev], ["double", S.minRaiseDouble], ["none", S.minRaiseNone]], st.minRaise));

    wrap.appendChild(TBL.choiceRow(S.seatingLabel, "seating",
      [["open", S.seatingOpen], ["lobby", S.seatingLobby]], st.seating));
  }
  /* a money input wearing the chip's clothes (the numChip idiom, with
     cents): blank until used, Enter/blur commits, active when the live
     value isn't a preset */
  function moneyChip(key, current, presets, placeholder, defaultCents) {
    var box = el("input", "gt-chip gt-chip--num");
    box.type = "text";
    box.placeholder = placeholder;
    box.disabled = !model.host;
    var isCustom = presets.indexOf(current) < 0;
    if (isCustom) { box.value = fmtMoney(current); box.classList.add("is-active"); }
    box.addEventListener("keydown", function (e) { if (e.key === "Enter") box.blur(); });
    box.addEventListener("change", function () {
      var v = parseMoney(box.value, defaultCents);
      if (v == null) { render(); return; }
      var m = { type: "setSettings" };
      m[key] = v;
      send(m);
    });
    return box;
  }
  // "$35", "35", "0.25", "25¢" → cents. A bare number is dollars unless the
  // caller says the field thinks in cents (the blind box), or a ¢/c suffix
  // or $ prefix says so itself. Null when unreadable.
  function parseMoney(raw, defaultCents) {
    var s = String(raw || "").trim().toLowerCase();
    if (!s) return null;
    var dollars = s.indexOf("$") >= 0;
    s = s.replace(/\$/g, "");
    var cents = false;
    if (/[¢c]$/.test(s)) { cents = true; s = s.replace(/[¢c]$/, ""); }
    else if (defaultCents && !dollars) cents = true;
    var n = Number(s);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(cents ? n : n * 100);
  }

  /* ── events → toasts ──────────────────────────────────────────── */
  function handleEvent(e) {
    var mine = mySeat();
    if (e.t === "voteEnd") {
      toast(fmt(e.on ? S.voteToast : S.unvoteToast,
                { name: seatName(e.seat), n: e.n, need: e.need }), "info");
    }
    if (e.t === "bust" && e.seat === mine) toast(S.bustToast, "warn");
    if (e.t === "cashout") toast(fmt(S.concededToast, { name: seatName(e.seat) }), "info");
  }

  /* ── the mechanical log (Claude-authored; names come from seats) ── */
  function logLine(e) {
    var n = function (s) { return seatName(s) || ("#" + s); };
    switch (e.t) {
      case "hand": return "— hand " + e.n + " —";
      case "blind": return n(e.seat) + " posts " + fmtMoney(e.amt);
      case "fold": return n(e.seat) + " folds";
      case "check": return n(e.seat) + " checks";
      case "call": return n(e.seat) + " calls " + fmtMoney(e.amt) + (e.allIn ? " (all-in)" : "");
      case "raise": return n(e.seat) + " raises to " + fmtMoney(e.to) + (e.allIn ? " (all-in)" : "");
      case "street": return e.name + ": " + e.cards.join(" ");
      case "win": return n(e.seat) + " wins " + fmtMoney(e.amt) + (e.name ? " (" + handName(e.name) + ")" : "");
      case "timeout": return n(e.seat) + " timed out — " + (e.did === "check" ? "checks" : "folds");
      case "bust": return n(e.seat) + " is bust";
      case "rebuy": return n(e.seat) + " buys back in";
      case "sitIn": return n(e.seat) + " sits in";
      case "cashout": return n(e.seat) + " cashes out (" + net(e.net) + ")";
      case "voteEnd": return n(e.seat) + (e.on ? " votes to end " : " withdraws ") + e.n + "/" + e.need;
      case "gameOver": return "game over";
    }
    return null;
  }
  function net(v) { return (v >= 0 ? "+" : "−") + fmtMoney(Math.abs(v)); }
  function handName(key) {
    var k = "hand" + key.charAt(0).toUpperCase() + key.slice(1);
    return S[k] || key;
  }

  /* ═══ RENDER ═══════════════════════════════════════════════════ */
  function paint() {
    if (model.phase === "lobby") {
      BIG.textContent = "";
      PLAYERS.textContent = "";
      ROLE.textContent = "";
      renderLog();
      return TBL.renderLobby(BIG);
    }
    if (model.phase === "over") {
      BIG.textContent = "";
      BIG.appendChild(cashoutLobby());
      renderRoster();
      renderLog();
      renderRole();
      return;
    }
    BIG.textContent = "";
    BIG.appendChild(felt());
    renderRoster();
    renderLog();
    renderRole();
  }

  /* ── the felt (big tile) ──────────────────────────────────────── */
  function felt() {
    var f = el("div", "pk-felt");
    var ps = model.players || [];
    var seats = model.seats || [];
    var mine = mySeat();
    // live seats around the rim, the DEALER at 12 o'clock
    var ring = [];
    ps.forEach(function (p, i) { if (p && !p.left) ring.push(i); });
    var start = model.dealer != null && ring.indexOf(model.dealer) >= 0
      ? ring.indexOf(model.dealer) : 0;
    ring.forEach(function (seat, k) {
      var idx = (k - start + ring.length) % ring.length;
      var theta = -Math.PI / 2 + (idx * 2 * Math.PI) / ring.length;
      var x = 50 + 44 * Math.cos(theta);
      var y = 50 + 42 * Math.sin(theta);
      f.appendChild(feltSeat(seat, x, y));
    });
    // board + pot in the middle
    var board = el("div", "pk-board");
    for (var b = 0; b < 5; b++) board.appendChild(cardEl(model.board && model.board[b]));
    f.appendChild(board);
    if (model.waiting) {
      f.appendChild(el("div", "pk-feltline", S.waitingLine));
    } else {
      var pot = el("div", "pk-pot");
      pot.appendChild(el("span", null, fmt(S.potLine, { amt: "" })));
      pot.appendChild(el("strong", null, fmtMoney(model.pot || 0)));
      f.appendChild(pot);
    }
    if (model.handOver) f.appendChild(handOverCard());
    return f;
  }
  function feltSeat(i, x, y) {
    var p = model.players[i];
    var sv = (model.seats || [])[i] || {};
    var mine = mySeat();
    var actor = model.turn && model.turn.seat === i && !model.handOver;
    var away = !sv.empty && sv.connected === false;
    var node = el("div", "pk-seat" +
      (actor ? " is-actor" : "") +
      (p.folded ? " is-folded" : "") +
      (away ? " is-away" : "") +
      (i === mine ? " is-me" : ""));
    node.style.left = x + "%";
    node.style.top = y + "%";
    var head = el("span", "pk-seat__head");
    var timed = model.settings.timerSec > 0;
    head.appendChild(actor && timed ? TBL.timerRing(i) : seatDot(i));
    var nm = el("span", "pk-seat__name", seatName(i) || S.seatOpen);
    head.appendChild(nm);
    if (model.dealer === i) head.appendChild(badge(S.dealerTag, S.dealerTip, false));
    if (model.blinds && model.blinds.sb === i) head.appendChild(badge(S.smallBlindTag, S.smallBlindTip, true));
    if (model.blinds && model.blinds.bb === i) head.appendChild(badge(S.bigBlindTag, S.bigBlindTip, true));
    node.appendChild(head);
    var tag = seatTag(p, away);
    if (tag) node.appendChild(el("span", "pk-seat__tag", tag));
    if (p.betStreet > 0) node.appendChild(el("span", "pk-seat__bet", fmtMoney(p.betStreet)));
    return node;
  }
  function badge(text, tip, blind) {
    var b = el("span", "pk-seat__badge" + (blind ? " pk-seat__badge--blind" : ""), text);
    b.title = tip;
    return b;
  }
  function seatTag(p, away) {
    if (p.left) return S.leftTag;
    if (p.out) return S.outTag;
    if (p.waiting) return S.waitingTag;
    if (p.allIn) return S.allInTag;
    if (p.folded) return S.foldedTag;
    if (away) return S.awayTag;
    return null;
  }

  /* the settlement interstitial, floating over the felt */
  function handOverCard() {
    var ho = model.handOver;
    var card = el("div", "pk-over");
    if (ho.reason === "folds") {
      var w = ho.awards[0];
      card.appendChild(line(fmt(S.foldWinLine, { name: seatName(w.seat) })));
      card.appendChild(line(fmt(S.winLine, { name: seatName(w.seat), amt: fmtMoney(w.amt) })));
    } else {
      // one line per distinct winner; reveal rides the felt via the board
      var seen = {};
      ho.awards.forEach(function (a) {
        if (seen[a.seat]) { seen[a.seat].amt += a.amt; return; }
        seen[a.seat] = { amt: a.amt, name: a.name };
      });
      Object.keys(seen).forEach(function (seat) {
        var a = seen[seat];
        card.appendChild(line(a.name
          ? fmt(S.winLineHand, { name: seatName(+seat), amt: fmtMoney(a.amt), hand: handName(a.name) })
          : fmt(S.winLine, { name: seatName(+seat), amt: fmtMoney(a.amt) })));
      });
      ho.reveal.forEach(function (r) {
        var row = el("div", "pk-over__sub");
        row.appendChild(el("span", null, seatName(r.seat) + ": "));
        r.hole.forEach(function (c) { row.appendChild(cardEl(c)); });
        row.appendChild(el("span", null, " — " + handName(r.name)));
        card.appendChild(row);
      });
    }
    // countdown to the auto-deal + a manual Next hand
    var autoLine = el("div", "pk-over__sub");
    card.appendChild(autoLine);
    tickInterstitial(autoLine);
    var next = el("button", "tb-pill gt-lobby__start");
    next.type = "button";
    next.appendChild(el("span", "tb-pill__label", S.nextHandButton));
    next.addEventListener("click", function () { send({ type: "nextHand" }); });
    card.appendChild(next);
    function line(text) { return el("div", "pk-over__line", text); }
    return card;
  }
  function tickInterstitial(node) {
    if (overTick) { clearTimeout(overTick); overTick = null; }
    function step() {
      if (!node.isConnected || !model || !model.handOverAt) return;
      var secs = Math.max(0, Math.ceil((model.handOverAt - (Date.now() - TBL.skew())) / 1000));
      node.textContent = fmt(S.nextHandAuto, { n: secs });
      overTick = setTimeout(step, 250);
    }
    step();
  }

  /* ── the roster (players tile) — full player cards, the cities-pstrip
     anatomy: seat dot (the clock, when acting) + name + badges up top,
     the seat's state pinned bottom-left, the money column on the right ── */
  function renderRoster() {
    PLAYERS.textContent = "";
    PLAYERS.appendChild(el("div", "pk-ptitle", S.playersTitle));
    var list = el("div", "pk-plist");
    var ps = model.players || [];
    var seats = model.seats || [];
    var mine = mySeat();
    ps.forEach(function (p, i) {
      if (!p) return;
      var sv = seats[i] || {};
      var away = !sv.empty && sv.connected === false;
      var actor = model.turn && model.turn.seat === i && !model.handOver;
      var strip = el("div", "pk-pstrip" +
        (actor ? " is-active" : "") +
        (p.left ? " is-gone" : away ? " is-away" : "") +
        (p.folded ? " is-folded" : ""));
      seatAccent(strip, i);
      var body = el("div", "pk-pstrip__body");
      var head = el("div", "pk-pstrip__head");
      var timed = model.settings.timerSec > 0;
      head.appendChild(actor && timed ? TBL.timerRing(i) : seatDot(i));
      var nm = el("span", "pk-pstrip__name");
      if (i === mine) nm.appendChild(el("strong", null, seatName(i)));
      else nm.appendChild(el("span", null, seatName(i) || ""));
      head.appendChild(nm);
      var badges = el("span", "pk-pstrip__badges");
      if (model.dealer === i) badges.appendChild(stripBadge(S.dealerTag, S.dealerTip));
      if (model.blinds && model.blinds.sb === i) badges.appendChild(stripBadge(S.smallBlindTag, S.smallBlindTip));
      if (model.blinds && model.blinds.bb === i) badges.appendChild(stripBadge(S.bigBlindTag, S.bigBlindTip));
      if (badges.childNodes.length) head.appendChild(badges);
      body.appendChild(head);
      var tag = seatTag(p, away);
      var tags = el("div", "pk-pstrip__tags");
      if (tag) tags.appendChild(el("span", "pk-pstrip__state", tag));
      body.appendChild(tags);                 // present even empty — no resize
      strip.appendChild(body);
      var stat = el("div", "pk-pstrip__stat");
      stat.appendChild(el("span", "pk-pstrip__stack", fmtMoney(p.stack)));
      stat.appendChild(el("span", "pk-pstrip__bet",
        p.betStreet > 0 && !model.handOver ? fmtMoney(p.betStreet) : " "));
      strip.appendChild(stat);
      list.appendChild(strip);
    });
    PLAYERS.appendChild(list);
  }
  function stripBadge(text, tip) {
    var b = el("span", "pk-pstrip__badge", text);
    b.title = tip;
    return b;
  }
  function renderLog() {
    LOG_LIST.textContent = "";
    logLines.slice(-60).forEach(function (entry) {
      LOG_LIST.appendChild(el("div", "pk-log__line", typeof entry === "string" ? entry : entry.text || ""));
    });
  }

  /* ── the hand panel (role tile) — cities' play grid, verbatim geometry:
     the hand column left ("Your Hand" title, cards under), the controls
     column right (the four pills top-right, the raise tray beneath). The
     tray is ALWAYS in the layout and only turns visible when armed, so
     nothing in the panel ever jitters (cities' universal layout rule). ── */
  function renderRole() {
    ROLE.textContent = "";
    var mine = mySeat();
    if (model.phase === "over") return;
    if (mine == null) {
      ROLE.appendChild(el("p", "pk-roleline", S.spectatingNote));
      return;
    }
    var p = model.players && model.players[mine];
    if (!p || p.left) return;
    var play = el("div", "pk-play");

    // hand column: the title, then your two cards (or the buy-in button
    // where they'd be, when bust; empty slots otherwise, so the column
    // never changes size)
    var handCol = el("div", "pk-play__hand");
    handCol.appendChild(el("h3", "pk-role__title", S.handTitle));
    if (model.you && model.you.hole) {
      var hole = el("div", "pk-hole");
      model.you.hole.forEach(function (c) { hole.appendChild(cardEl(c, true)); });
      handCol.appendChild(hole);
    } else if (model.you && model.you.canBuyIn) {
      var buyWrap = el("div", "pk-hole pk-hole--buyin");
      var buy = el("button", "tb-pill gt-lobby__start");
      buy.type = "button";
      buy.appendChild(el("span", "tb-pill__label", fmt(S.buyInButton, { amt: fmtMoney(model.settings.buyIn) })));
      buy.addEventListener("click", function () { send({ type: "buyIn" }); });
      buyWrap.appendChild(buy);
      buyWrap.appendChild(el("span", "pk-roleline", S.buyInNote));
      handCol.appendChild(buyWrap);
    } else {
      var slots = el("div", "pk-hole");
      slots.appendChild(cardEl(null, true));
      slots.appendChild(cardEl(null, true));
      if (p.waiting) slots.appendChild(el("span", "pk-roleline", S.waitingNote));
      handCol.appendChild(slots);
    }
    play.appendChild(handCol);

    // controls column: the pills right-aligned (cities-actions), tray under
    var ctrl = el("div", "pk-play__ctrl");
    var o = model.you && model.you.options;
    var acting = !!o && !model.handOver;
    var acts = el("div", "pk-actions");
    acts.appendChild(actionBtn(S.actionFold, "hoverFold", acting, function () {
      send({ type: "fold" }); ui.raiseOpen = false;
    }));
    acts.appendChild(actionBtn(S.actionCheck, "hoverCheck", acting && o.canCheck, function () {
      send({ type: "check" }); ui.raiseOpen = false;
    }));
    acts.appendChild(actionBtn(fmt(S.actionCall, { amt: acting && o.toCall ? fmtMoney(o.toCall) : "" }),
      "hoverCall", acting && o.toCall > 0, function () {
        send({ type: "call" }); ui.raiseOpen = false;
      }));
    acts.appendChild(actionBtn(S.actionRaise, "hoverRaise", acting && o.canRaise, function () {
      ui.raiseOpen = !ui.raiseOpen;
      ui.raiseDraft = null;
      render();
    }));
    ctrl.appendChild(acts);
    var armed = !!(ui.raiseOpen && acting && o.canRaise);
    if (!armed) ui.raiseOpen = false;
    ctrl.appendChild(raiseTray(acting && o.canRaise ? o : null, armed));
    play.appendChild(ctrl);
    ROLE.appendChild(play);
  }
  function actionBtn(label, hintKey, enabled, onClick) {
    var b = el("button", "tb-pill");
    b.type = "button";
    b.disabled = !enabled;
    b.appendChild(el("span", "tb-pill__label", label));
    b.title = S[hintKey];                    // native tooltip only (his call)
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  /* the raise tray: "Raise by" — the slider and box speak in the amount
     OVER the current bet; the wire still says raise-to (the engine's
     shape). Rendered ghosted whenever it isn't armed, so the panel never
     changes height. The engine is the judge; the client only snaps to the
     smallest chip and pre-checks the split. */
  function raiseTray(o, armed) {
    var tray = el("div", "pk-raise" + (armed ? "" : " pk-raise--ghost"));
    tray.appendChild(el("span", "pk-raise__label", S.raiseBy));
    var step = Engine.minChip(chipValsNow());
    var cur = 0, minBy = step, maxBy = step;
    if (o) {
      // the table's current bet, seen from my side of it
      cur = (model.players[mySeat()].betStreet || 0) + o.toCall;
      minBy = Math.max(1, o.minTo - cur);
      maxBy = Math.max(minBy, o.maxTo - cur);
    }
    var val = ui.raiseDraft != null ? ui.raiseDraft : minBy;
    val = Math.max(minBy, Math.min(maxBy, val));
    var slider = el("input", "pk-raise__slider");
    slider.type = "range";
    slider.min = minBy; slider.max = maxBy; slider.step = step;
    slider.value = val;
    slider.disabled = !armed;
    var out = el("span", "pk-raise__out", fmtMoney(val));
    slider.addEventListener("input", function () {
      ui.raiseDraft = +slider.value;
      out.textContent = fmtMoney(+slider.value);
      box.value = "";
    });
    tray.appendChild(slider);
    tray.appendChild(out);
    var box = el("input", "pk-raise__box");
    box.type = "text";
    box.placeholder = fmtMoney(minBy);
    box.disabled = !armed;
    box.setAttribute("aria-label", S.raiseCustomAria);
    box.addEventListener("input", function () {
      var v = parseMoney(box.value, true);   // bare numbers are cents here
      if (v != null) { ui.raiseDraft = v; out.textContent = fmtMoney(v); }
    });
    box.addEventListener("keydown", function (e) { if (e.key === "Enter") go.click(); });
    tray.appendChild(box);
    var go = el("button", "tb-pill");
    go.type = "button";
    go.disabled = !armed;
    go.appendChild(el("span", "tb-pill__label", S.raiseGo));
    go.addEventListener("click", function () {
      if (!o) return;
      var by = ui.raiseDraft != null ? ui.raiseDraft : minBy;
      by = Math.max(minBy, Math.min(maxBy, by));
      var to = cur + by;
      if (to !== o.maxTo && !Engine.representable(to, chipValsNow())) {
        toast(S.raiseBad, "error");
        return;
      }
      send({ type: "raise", to: to });
      ui.raiseOpen = false; ui.raiseDraft = null;
    });
    tray.appendChild(go);
    return tray;
  }

  /* ── the cash-out lobby (big tile at `over`) ──────────────────── */
  function cashoutLobby() {
    var over = model.over || {};
    var wrap = el("div", "pk-cashout");
    wrap.appendChild(el("h2", "pk-cashout__title", S.gameOver));
    var why = over.endedBy === "vote" ? S.endedByVote
      : over.endedBy === "host" ? S.endedByHost : S.endedByAttrition;
    wrap.appendChild(el("p", "pk-cashout__sub", why + " · " + fmt(S.handCount, { n: over.hands || 0 })));
    var table = el("table");
    var head = el("tr");
    head.appendChild(el("th", null, ""));
    head.appendChild(el("th", null, S.colBought));
    head.appendChild(el("th", null, S.colStack));
    head.appendChild(el("th", null, S.colNet));
    table.appendChild(head);
    var mine = mySeat();
    (over.standings || []).forEach(function (r) {
      var tr = el("tr", "pk-cashout__row" + (r.seat === mine ? " pk-cashout__row--me" : ""));
      var nameCell = el("td");
      var place = r.tied ? fmt(S.placeTied, { place: r.rank }) : (S.ordinals[r.rank - 1] || String(r.rank));
      nameCell.appendChild(el("span", "pk-cashout__place", place));
      nameCell.appendChild(el("span", null, seatName(r.seat) || ("#" + r.seat)));
      tr.appendChild(nameCell);
      tr.appendChild(el("td", null, fmtMoney(r.bought)));
      tr.appendChild(el("td", null, fmtMoney(r.stack)));
      var netCell = el("td", r.net > 0 ? "is-plus" : r.net < 0 ? "is-minus" : null, net(r.net));
      tr.appendChild(netCell);
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    if (model.host) {
      var again = el("button", "tb-pill gt-lobby__start");
      again.type = "button";
      again.appendChild(el("span", "tb-pill__label", S.rematchButton));
      again.addEventListener("click", function () { send({ type: "rematch" }); });
      wrap.appendChild(again);
    }
    return wrap;
  }

  /* ── boot ─────────────────────────────────────────────────────── */
  BAR_INPUT.setAttribute("aria-label", S.tableCodePlaceholder);
  BAR_INPUT.placeholder = S.tableCodePlaceholder;
  TBL.boot();
})();
