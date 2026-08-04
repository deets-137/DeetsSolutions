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
  var BENTO = document.querySelector(".pk-bento");
  var DESKTOP = document.querySelector("[data-pk-desktop]");

  var model = null;
  var TBL = window.DeetsTable.create({
    ns: "poker",
    api: "https://poker-api.deets.solutions",
    mock: window.PokerTransport,        // transport-mock.js (?mock)
    strings: S,
    rootSel: ".pk",
    capacity: 12,
    minSeats: 2,
    // No bots mid-game, ever. The three modes decide what leaving COSTS
    // (docs/poker.md, "Stepping away"): "anyone"/"rejoin" send the seat
    // away with its stack intact (engine `sitOut`), "none" cashes it out
    // (engine `concede`) and you come back as a spectator only.
    rejoinModes: ["anyone", "rejoin", "none"],
    // the difficulty vocabulary is the ENGINE's; the shell only renders it
    botTiers: window.PokerEngine.BOT_TIER_LIST,
    // no hint line under Start (his call, chat 2026-08-03): the lobby has
    // to fit the bento's big tile, and the disabled button already says it
    noStartHint: true,
    logCap: 150,
    errExtra: { raise: S.errRaise, chips: S.errChips, midjoin: S.errMidJoin,
                blind: S.blindBad, buyin: S.buyInBad },
    /* fields the worker omits when absent must clear, not linger — every
       broadcast is a full view, so an omission means genuinely gone. A
       rematch omits the lot: the lobby must not paint a discarded game. */
    clearFields: ["handNo", "dealer", "street", "board", "waiting", "blinds",
                  "players", "pot", "potTray", "turn", "handOver", "handOverAt",
                  "votes", "over", "turnEndsAt"],
    clearYouFields: ["hole", "options", "myVote", "canBuyIn", "away"],
    els: {
      bar: BAR_INPUT, codePop: CODE_POP, codeCtrl: document.querySelector(".gt-code"),
      toolbar: TOOLBAR, gate: GATE, table: TABLE, big: BIG, log: null, desktop: DESKTOP
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
    /* the world this broadcast is about to replace — the flights below
       read it, because events are handled after the merge */
    beforeMerge: function () {
      var ps = (model && model.players) || [];
      prevBets = ps.map(function (p) { return (p && p.betStreet) || 0; });
      prevStacks = ps.map(function (p) { return (p && p.stack) || 0; });
    },
    onEvent: handleEvent,
    logLine: logLine,
    render: paint,
    postRender: function () {
      seedDistinctColor();
      autoRevealNow();  // the "show every hand" standing order, once per hand
      FLY.flush();      // chips launch AFTER render: their targets exist now
    },
    onLeave: resetGameUi,
    onRematch: resetGameUi,
    extraPills: extraPills,
    standCopy: standCopy,
    lobbySettings: lobbySettings,
    settingsRows: function () {
      var st = model.settings;
      return [
        [S.capacityLabel, String(st.capacity)],
        [S.buyInLabel, fmtMoney(st.buyIn)],
        [S.blindLabel, fmtMoney(st.bigBlind / 2) + " / " + fmtMoney(st.bigBlind)],
        [S.timerLabel, st.timerSec ? fmt(S.timerSecs, { n: st.timerSec }) : S.timerOff],
        [S.handOverLabel, fmt(S.timerSecs, { n: st.handOverSec || 30 })],
        [S.minRaiseLabel, minRaiseLabel(st.minRaise)],
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

  /* ── page state (this game's own; broadcasts must not wipe drafts) ── */
  ui.raiseOpen = false;       // the tray under the action buttons
  ui.raiseDraft = null;       // cents OVER the current bet ("Raise by")
  ui.chipDrafts = null;       // the lobby chip-ladder inputs mid-typing
  ui.chipDrag = null;         // index of the ladder token being dragged
  ui.boardPop = null;         // pinned felt popover ("win" | "log" | null)
  ui.guideOpen = false;       // the Hand Rankings overlay
  ui.rotateOpen = false;      // the Rotation pill's popover
  ui.showToOpen = false;      // the Show To picker's popover
  var colorSeeded = false;    // one auto-recolor attempt per clash
  var overTick = null;        // the interstitial's countdown handle
  var autoRevealSent = null;  // handOverAt of the last auto-show — one per hand
  /* ── what the last paint saw (mahjong's `seen` idiom) ──────────
     paint() clears the felt and rebuilds it, so a CSS animation on a
     felt node fires on EVERY render — including renders the street
     didn't cause (someone else's chat, a popover, a reconnect). These
     two marks are what make the one-shots one-shot: a card pops only
     when the board grew past what the last paint drew, and the
     settlement card eases in only the first time a given hand-over is
     painted. A new hand shrinks the board back, which resets the mark
     on its own. */
  var seenBoard = 0;          // board cards the last paint had already dealt
  var seenOverAt = null;      // handOverAt of the interstitial already shown
  /* ── the pre-merge snapshot (cities' prevHandCounts idiom) ─────
     Events are handled AFTER the broadcast has merged, so by the time
     one is read the model already holds the world it produced. Two
     flights need the world it produced it FROM: a raise carries the
     total owed this street rather than what the action cost, and the
     street sweep has to know what each seat had on the line after the
     model has already cleared it. */
  var prevBets = [];          // betStreet per seat, before this broadcast
  var prevStacks = [];        // stack per seat, before this broadcast

  function resetGameUi() {
    ui.raiseOpen = false; ui.raiseDraft = null;
    ui.chipDrafts = null; ui.chipDrag = null; ui.boardPop = null;
    ui.rotateOpen = false; ui.showToOpen = false; ui.showToPick = null;
    ui.guideOpen = false;
    popHover = null;
    seenBoard = 0; seenOverAt = null; autoRevealSent = null;
    prevBets = []; prevStacks = [];
    FLY.clear();
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

  /* ── chip art ─────────────────────────────────────────────────
     One renderer, two placements. A tray is drawn one COLUMN per
     denomination, columns capped so a stack can't grow without bound:
     on the felt a column holds 10 and spills into a neighbour (up to
     FELT_COLS of them) so a rich seat is visible from across the
     table; in the hand panel a column holds 6 and stops, because the
     rail is a readout, not a comparison. Either way the `×N` label
     carries the true count, so nothing the cap hides is ever lost.
     Colour comes from the ladder's own hex (rank-assigned, see
     transport-mock.js) — chips are the ONE place a game may paint its
     own art (docs/games.md, the `--pk*` carve-out). */
  var FELT_STACK = 10, FELT_COLS = 3, RAIL_STACK = 6;
  // the deck's drawn depth: a look, not a count. Tracking 52 minus what
  // has been dealt would be a second source of truth for something the
  // engine doesn't publish and nobody reads off the felt.
  var DECK_DEPTH = 5;
  /* the one stagger the whole game uses — board cards off the deck here,
     and chips off a tray in the flights below, so everything that leaves
     in a handful leaves at the same rhythm (cities' FLY_STEP) */
  var DEAL_STEP = 90;
  /* Sprite swap point (assets/sprites/poker/README.md), mahjong's
     probe-once idiom: chip-side-N is the chip's RANK in the ladder,
     never its value — values are derived from the buy-in but rank 1 is
     always the smallest chip, so the filenames stay stable across every
     table. A missing file costs one quiet 404 and the CSS bars stand in.
     There is no top-of-stack sprite: a stack is side views the whole way
     up (his call, chat 2026-08-03 — a face on top read as odd). */
  var SPRITE_DIR = "../assets/sprites/poker/";
  var CHIP_SPRITE_RANKS = 5;
  var chipSprites = {};
  (function probeChips() {
    for (var r = 1; r <= CHIP_SPRITE_RANKS; r++) {
      (function (name) {
        var probe = new Image();
        probe.onload = function () { chipSprites[name] = true; if (model) render(); };
        probe.src = SPRITE_DIR + name + ".png";
      })("chip-side-" + r);
    }
  })();
  /* The card back is ONE sprite for every face-down card on the page —
     the deck in front of the button, the burn pile, a hand being pitched,
     a hand being mucked. There is no face sprite: a face is rank + suit
     in the page's own type, so it follows the theme and the skin (and 52
     hand-drawn faces is not a reasonable ask). Same probe-once idiom as
     the chips — a missing file costs one quiet 404 and the CSS weave
     stands in. */
  var cardBackArt = false;
  (function probeCardBack() {
    var probe = new Image();
    probe.onload = function () { cardBackArt = true; if (model) render(); };
    probe.src = SPRITE_DIR + "card-back.png";
  })();
  function backArt(node) {
    if (cardBackArt) {
      node.style.backgroundImage = "url(" + SPRITE_DIR + "card-back.png)";
      node.classList.add("is-art");
    }
    return node;
  }
  /* A column is ONE node, not one per chip: a single layer that tiles the
     band once per chip. That is what stops the stack shimmering — N
     adjacent boxes each round to a whole device pixel independently, so
     at fractional zoom they disagree about their own width and the stack
     appears to taper. One tiled background can't disagree with itself.
     (Mahjong learned the same lesson about identical tiles —
     assets/sprites/mahjong/README.md.) */
  function chipColumn(rank, hex, n, unit) {
    var col = el("div", "pk-tray__col");
    col.style.height = (n * unit) + "px";
    col.style.setProperty("--pkchip-color", hex);
    chipArt(col, rank);
    return col;
  }
  // the ONE place a chip node takes its rung's art, so a flying chip and a
  // chip standing in a tray can never disagree about what rank 3 looks like
  function chipArt(node, rank) {
    if (chipSprites["chip-side-" + rank]) {
      node.style.backgroundImage = "url(" + SPRITE_DIR + "chip-side-" + rank + ".png)";
      node.classList.add("is-art");
    }
    return node;
  }
  function chipStacks(tray, opts) {
    var wrap = el("div", "pk-tray" + (opts.rail ? " pk-tray--rail" : ""));
    if (!tray || !tray.chips) return wrap;
    var per = opts.rail ? RAIL_STACK : FELT_STACK;
    var unit = opts.rail ? 6 : 4;          // one band, in CSS px
    /* EVERY denomination renders, even at zero. An empty column is
       invisible but still holds its width, so a tray doesn't shuffle
       sideways the moment a rung runs out — and on the rail the key
       keeps saying what a chip is worth even when you hold none of it.
       The reserved height lives in CSS; the stacks grow up from it. */
    (model.settings.chips || []).forEach(function (chip, rank) {
      var n = tray.chips[chip.v] || 0;
      var group = el("div", "pk-tray__group");
      var stack = el("div", "pk-tray__stack");
      var cols = Math.max(1, Math.min(Math.ceil(n / per), opts.rail ? 1 : FELT_COLS));
      var left = n;
      for (var c = 0; c < cols; c++) {
        var high = Math.min(left, per);
        stack.appendChild(chipColumn(rank + 1, chip.hex, high, unit));
        left -= high;
      }
      /* The count rides OVER its stack, felt and rail alike (his call,
         chat 2026-08-03 — it used to sit where the next column would
         have started, which made a capped group wider than an uncapped
         one and knocked the ladder off an even pitch).
         The line is always ALLOCATED — blanked, never omitted. A group
         that dropped it would lift its own chips off the tray's shared
         baseline, and on the felt it would change the SEAT's height:
         a seat is centered on its anchor, so it would re-center and
         slide every time a rung crossed the cap. That is the same
         jitter .pk-seat__tag is blanked to prevent. */
      group.appendChild(el("span", "pk-tray__count" + (n > per ? "" : " is-blank"),
        n > per ? fmt(S.chipCount, { n: n }) : " "));
      group.appendChild(stack);
      /* the rail doubles as the table's KEY — what a white chip is worth
         is otherwise nowhere on the page. The felt stays bare: twelve
         seats' worth of denominations is noise, and the rail has already
         said it (his call, chat 2026-08-03). */
      if (opts.rail) group.appendChild(el("span", "pk-tray__val", fmtMoney(chip.v)));
      group.title = fmt(S.chipTip, { n: n, amt: fmtMoney(chip.v) });
      wrap.appendChild(group);
    });
    return wrap;
  }

  /* ── cards ────────────────────────────────────────────────────── */
  var SUIT_GLYPH = { s: "♠", h: "♥", d: "♦", c: "♣" };
  function backEl(big) {
    return backArt(el("span", "pk-card pk-card--back" + (big ? " pk-card--big" : "")));
  }
  /* A pile of face-down cards — the deck and the burn are the same object
     at two spots on the felt. Cards are absolutely stacked with a small
     offset each, so the pile has depth without changing size: the felt
     positions both piles by their box, and a box that grew with its
     contents would drift off the spot it is meant to mark.
     No ghost slot under them (his call): a dashed outline behind the
     offset stack made the pile's silhouette taller than one card, which
     read as the pile being drawn at a different SIZE than the board.
     The empty box still measures, which is all a flight aimed at it
     needs — it just doesn't draw. */
  var PILE_CAP = 6;
  /* `dx` fans a pile sideways as it grows. BOTH piles pass 0 now — squared
     up, straight up, like a deck someone has tapped level. The burn was
     fanned at first (a heap of dead cards nobody tidies), but next to the
     deck it read as a different-shaped OBJECT rather than as a second
     pile, so he squared it (chat 2026-08-04). The parameter stays: it is
     the pile's one degree of freedom. */
  function cardPile(cls, n, dx) {
    var pile = el("div", "pk-pile " + cls);
    for (var i = 0; i < Math.min(n, PILE_CAP); i++) {
      var c = backEl(false);
      c.style.transform = "translate(" + (i * (dx || 0)) + "px," + (i * -2) + "px)";
      pile.appendChild(c);
    }
    return pile;
  }
  function cardEl(card, big) {
    var cls = "pk-card" + (big ? " pk-card--big" : "");
    if (!card) return el("span", cls + " pk-card--slot");
    var red = card.charAt(1) === "h" || card.charAt(1) === "d";
    var n = el("span", cls + (red ? " pk-card--red" : " pk-card--black"));
    n.appendChild(el("span", null, card.charAt(0) === "T" ? "10" : card.charAt(0)));
    n.appendChild(el("span", "pk-card__suit", SUIT_GLYPH[card.charAt(1)]));
    return n;
  }

  /* ── auto-recolor past the presets (docs/games.md, "Seat colors") ──
     The table assigns a clash-free color on arrival (`freeColor`), so this
     is now only for the case the table can't see: a PROFILE color, claimed
     by the shell's own seeding after the fact, that happens to land on
     someone. Claim a fresh one from the same generator the table uses.
     One attempt per clash so a refusal can't loop. */
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
    send({ type: "recolor", seat: mine, color: Colors.freeColor(others) });
  }

  /* The majority "vote to end" pill is OFF. Everything behind it is intact
     and untouched — the engine's `voteEnd` verb and majority check, the
     `votes` / `you.myVote` wire fields, the vote toasts and the log line —
     so flipping this back to true is the whole restore. */
  var SHOW_END_VOTE = false;

  /* Stand up is two different exits wearing one pill. Only at a "none"
     table does it cash you out; everywhere else the stack stays on the
     felt and you can walk back in (docs/poker.md, "Stepping away"). */
  function joinMode() {
    return (model && model.settings && model.settings.rejoin) || "rejoin";
  }
  function cashesOut() { return joinMode() === "none"; }
  function standCopy() {
    /* Already sitting out? Then there is nothing to stand up FROM — the
       pill would send a verb the engine ignores, next to a "Sit down"
       that undoes it. False withdraws it (games/table.js). Note this is
       the sit-out reading only: at a "none" table Stand up still CASHES
       OUT, which is a real thing to do from a sat-out seat. */
    if (cashesOut()) return null;              // the shell's own wording is right
    if (model && model.you && model.you.away) return false;
    return { label: S.sitOutButton, hover: S.sitOutHover };
  }

  /* ── toolbar: poker's own pills (docs/poker.md, "Ending a game") ── */
  function extraPills() {
    if (!model || model.phase === "lobby") return [];
    var pills = [];
    var mine = mySeat();
    var seatedMe = mine != null;
    var live = model.players && mine != null && model.players[mine] && !model.players[mine].left;
    if (model.phase !== "over") {
      if (SHOW_END_VOTE && live) {
        var v = model.votes || { n: 0, need: 1 };
        var vp = TBL.pill(S.voteEndPill, function () { send({ type: "voteEnd" }); });
        vp.appendChild(el("span", "tb-pill__label", " " + fmt(S.voteEndCount, { n: v.n, need: v.need })));
        if (model.you && model.you.myVote) vp.classList.add("is-active");
        pills.push(vp);
      }
      if (model.host) {
        // the armed state lives in the shell, not on the button — a
        // broadcast rebuilds this pill and used to disarm it mid-confirm
        pills.push(TBL.confirmPill("endGame", S.endGamePill, S.endGameConfirm,
          function () { send({ type: "endGame" }); }));
      }
      pills.push(rotationPill());
      // sitting out keeps the seat, so the way back is your own pill — the
      // shell's adoption popover is for seats OTHER people can take
      if (model.you && model.you.away) {
        var bp = TBL.pill(S.sitBackPill, function () { send({ type: "sitBack" }); });
        bp.title = S.sitBackHover;
        pills.push(bp);
      }
      // a NEW seat mid-game is the "anyone" half of Mid-game Join; the
      // other half (taking over an away seat) is the shell's own pill
      if (!seatedMe && joinMode() === "anyone" &&
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
    /* Drag-to-reorder marks the GAP it would drop into, rather than the
       token it is over — "before this one" and "after that one" are the
       same place, and a divider says which without the user guessing. */
    function clearDrop() {
      var marked = ladder.querySelectorAll(".is-dropbefore, .is-dropafter");
      for (var k = 0; k < marked.length; k++) {
        marked[k].classList.remove("is-dropbefore", "is-dropafter");
      }
    }
    function dropIndex() {                 // insertion point in the ORIGINAL list
      var b = ladder.querySelector(".is-dropbefore");
      if (b) return Number(b.getAttribute("data-i"));
      var a = ladder.querySelector(".is-dropafter");
      if (a) return Number(a.getAttribute("data-i")) + 1;
      return null;
    }
    (st.chips || []).forEach(function (chip, i) {
      var tok = el("span", "pk-chip");
      tok.setAttribute("data-i", String(i));
      if (host) {
        tok.draggable = true;
        tok.addEventListener("dragstart", function (e) {
          ui.chipDrag = i;
          tok.classList.add("is-dragging");
          if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }
        });
        tok.addEventListener("dragend", function () {
          ui.chipDrag = null;
          tok.classList.remove("is-dragging");
          clearDrop();
        });
        tok.addEventListener("dragover", function (e) {
          e.preventDefault();
          if (ui.chipDrag == null) return;
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          var r = tok.getBoundingClientRect();
          var after = e.clientX > r.left + r.width / 2;
          clearDrop();
          tok.classList.add(after ? "is-dropafter" : "is-dropbefore");
        });
        tok.addEventListener("drop", function (e) {
          e.preventDefault();
          var from = ui.chipDrag;
          var to = dropIndex();
          ui.chipDrag = null;
          clearDrop();
          if (from == null || to == null) return;
          if (to > from) to--;             // the list closes up behind the lift
          if (to === from) return;
          var next = st.chips.slice();
          next.splice(to, 0, next.splice(from, 1)[0]);
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
    // drag the pointer clean out of the row and the divider goes with it
    ladder.addEventListener("dragleave", function (e) {
      if (!ladder.contains(e.relatedTarget)) clearDrop();
    });
    chipRow.opts.appendChild(ladder);
    /* the 4|5 pill: how many rungs the derived ladder takes. It is a
       PARAMETER of the cascade, not an override — flipping it re-derives
       (a hand-typed value is what freezes the ladder). */
    var count = el("span", "pk-chipcount");
    [4, 5].forEach(function (n) {
      var b = el("button", "tb-pill pk-chipcount__pill" +
        ((st.chips || []).length === n && !st.chipsManual ? " is-on" : ""));
      b.type = "button";
      b.disabled = !host;
      b.appendChild(el("span", "tb-pill__label", String(n)));
      b.title = fmt(S.chipCountTip, { n: n });
      b.addEventListener("click", function () { send({ type: "setSettings", chipCount: n }); });
      count.appendChild(b);
    });
    chipRow.opts.appendChild(count);
    var chipReset = autoMark(st.chipsManual, host, "autoChips");
    if (chipReset) chipRow.opts.appendChild(chipReset);
    wrap.appendChild(chipRow);

    // big blind: cent presets + a free box; the one rule is dictated below
    var blindRow = TBL.choiceRow(S.blindLabel, "bigBlind",
      [[10, "10¢"], [20, "20¢"], [50, "50¢"], [100, "$1"]], st.bigBlind);
    // bare numbers in the blind box mean CENTS ("30" → 30¢, "$1" still works)
    blindRow.opts.appendChild(moneyChip("bigBlind", st.bigBlind, [10, 20, 50, 100], "¢", true));
    var blindReset = autoMark(st.blindManual, host, "autoBlind");
    if (blindReset) blindRow.opts.appendChild(blindReset);
    wrap.appendChild(blindRow);

    var timerRow = TBL.choiceRow(S.timerLabel, "timerSec",
      [[0, S.timerOff], [15, fmt(S.timerSecs, { n: 15 })], [30, fmt(S.timerSecs, { n: 30 })],
       [60, fmt(S.timerSecs, { n: 60 })], [120, fmt(S.timerSecs, { n: 120 })]], st.timerSec);
    timerRow.opts.appendChild(TBL.numChip("timerSec", st.timerSec, [0, 15, 30, 60, 120], S.timerCustom, 5, 600));
    wrap.appendChild(timerRow);

    /* How long the settlement card stays up. Its own row rather than a
       constant, because the card now carries the reveals: a full table
       wants time to read nine hands and decide whether to show, heads-up
       wants to get on with it. The host can always cut it short with
       Next hand. */
    var overRow = TBL.choiceRow(S.handOverLabel, "handOverSec",
      [[5, fmt(S.timerSecs, { n: 5 })], [15, fmt(S.timerSecs, { n: 15 })],
       [30, fmt(S.timerSecs, { n: 30 })], [60, fmt(S.timerSecs, { n: 60 })]],
      st.handOverSec);
    overRow.opts.appendChild(TBL.numChip("handOverSec", st.handOverSec, [5, 15, 30, 60], S.timerCustom, 3, 120));
    wrap.appendChild(overRow);

    wrap.appendChild(TBL.choiceRow(S.minRaiseLabel, "minRaise",
      [["prev", S.minRaisePrev], ["double", S.minRaiseDouble], ["none", S.minRaiseNone]], st.minRaise));
    // no Seating row: the shell's own "Mid-game Join" row below is that
    // axis (docs/poker.md, "Stepping away") — one control, not two.
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
    if (e.t === "away") toast(fmt(S.awayToast, { name: seatName(e.seat) }), "info");
    if (e.t === "back") toast(fmt(S.backToast, { name: seatName(e.seat) }), "info");
    // your own ante is money leaving the stack — say so
    if (e.t === "blind" && e.kind === "ante" && e.seat === mine) toast(S.anteToast, "warn");
    /* Someone showed you their hand. The event is public (the table sees
       THAT it happened), so the toast has to be gated on being one of the
       named seats — otherwise every spectator gets told they were shown
       cards they can't see. The cards themselves are on the felt, over
       that seat's chips. */
    if (e.t === "showTo" && mine != null && (e.to || []).indexOf(mine) >= 0) {
      toast(fmt(S.shownToast, { name: seatName(e.seat) }), "info");
    }
    collectFlight(e);
  }

  /* ── chip flights (games/flights.js drives them) ───────────────
     Client-only theater: every flight is derived from the same typed
     events the log consumes, so nothing here needs a protocol change —
     the tray already rides the public view. What poker adds to the
     shared engine is only WHERE the money is on screen and WHICH
     events move it.

     The money is cents and the felt is chips, so an amount has to be
     broken down before it can fly. `chipBreak` is the same canonical
     breakdown the tray uses, walked high → low so a big bet shows its
     big chips first, and capped like every other game's flight — the
     log carries the true number, the felt carries the gesture. */
  var FLY = GameFlights.create({
    section: "section.pk",
    layerClass: "pk-flylayer",
    alive: function () { return !!model; },
    catchClass: "pk-catch"
  });
  /* The rungs an amount is actually made of, high → low, capped. A flight
     carries the RANK as well as the hex so the chip in the air is the same
     object as the chip in the tray — same rung, same sprite, same
     placeholder if the sprite hasn't landed. Money moving as anonymous
     discs was the thing that made the felt read as a progress bar. */
  function chipRungs(cents) {
    var ladder = (model.settings && model.settings.chips) || [];
    var br = (cents > 0 && Engine.chipBreak(cents, chipValsNow())) || {};
    var out = [];
    for (var i = ladder.length - 1; i >= 0 && out.length < FLY.CAP; i--) {
      var n = br[ladder[i].v] || 0;
      for (var k = 0; k < n && out.length < FLY.CAP; k++) {
        out.push({ hex: ladder[i].hex, rank: i + 1 });
      }
    }
    // an amount no ladder can draw (odd cents from a split pot) still moves —
    // one chip of the smallest rung stands in for it
    if (!out.length && ladder.length) out.push({ hex: ladder[0].hex, rank: 1 });
    return out;
  }
  function flyChip(rung) {
    var c = el("span", "pk-flychip");
    c.style.setProperty("--pkchip-color", rung.hex);
    return chipArt(c, rung.rank);
  }
  /* Points. Every one is a FUNCTION the loop re-queries per frame, and
     every one falls back rather than returning null, because a seat can
     leave the felt mid-flight (a bust, a cash-out, the hand-over card
     covering the middle) and a chip with nowhere to go should still land
     somewhere sane.

     A fallback point is deliberately BARE — coordinates with no `el` —
     so the catch bump can't reach it. The bump is a scale, and two of
     the coarse fallbacks would be ruined by one: .pk-seat carries the
     `translate(-50%, -50%)` that centers it on its rim anchor (a scale
     would replace that transform and fling the seat to the corner), and
     the felt and the roster tile are whole panels that have no business
     twitching because one chip arrived. Only the small, transform-free
     nodes a chip is actually aimed at are catchers. */
  function bare(p) { return p ? { x: p.x, y: p.y } : null; }
  function seatNode(seat) { return BIG.querySelector('.pk-seat[data-seat="' + seat + '"]'); }
  function chipPoint(seat) {
    // MY chips fly through MY rail — the thing I actually watch — and
    // everyone else's through their seat on the felt (cities' seatPoint)
    if (seat === mySeat()) {
      var r = FLY.point(ROLE.querySelector("[data-pk-rail]"));
      if (r) return r;
    }
    var s = seatNode(seat);
    return (s && (FLY.point(s.querySelector(".pk-tray")) || bare(FLY.point(s)))) || potPoint();
  }
  function betPoint(seat) {
    var s = seatNode(seat);
    return (s && (FLY.point(s.querySelector(".pk-seat__bet")) || bare(FLY.point(s)))) || potPoint();
  }
  function potPoint() {
    return FLY.point(BIG.querySelector("[data-pk-pot]")) ||
      bare(FLY.point(BIG.querySelector(".pk-felt"))) || bare(FLY.point(BIG));
  }
  function stripPoint(seat) {
    return FLY.point(PLAYERS.querySelector('.pk-pstrip[data-seat="' + seat + '"]')) ||
      bare(FLY.point(PLAYERS));
  }
  /* where a seat's HOLE cards are for this viewer: mine are the two big
     cards in the hand panel; nobody else's are drawn on the felt, so
     theirs is simply their seat. Bare — a card is not a chip, and the
     catch bump belongs to money landing on money. */
  function seatSpot(seat) { return bare(FLY.point(seatNode(seat))) || potPoint(); }
  function holePoint(seat) {
    if (seat === mySeat()) {
      var h = FLY.point(ROLE.querySelector(".pk-hole"));
      if (h) return bare(h);
    }
    return seatSpot(seat);
  }
  /* the two piles cards come from and go to. Both are real nodes on the
     felt, so a flight is aimed at the thing the eye is already looking at
     rather than at a coordinate that happens to be near it. */
  function deckPoint() { return bare(FLY.point(BIG.querySelector(".pk-deck"))) || potPoint(); }
  function burnPoint() { return bare(FLY.point(BIG.querySelector(".pk-burn"))) || potPoint(); }
  function flyCard() { return backArt(el("span", "pk-flycard")); }
  /* The deal: two rounds of the table from the DECK, one card per seat
     per round — the way a hand is actually pitched, and the reason it is
     two passes rather than two cards at once. Backs only: the whole
     point of a hole card is that the felt doesn't know it. Half the
     usual stagger, because a deal is brisk and 24 cards at 90ms would
     still be arriving when the blinds are posted. */
  function dealCards(dealer) {
    var ps = model.players || [];
    if (!ps.length || dealer == null) return;
    var order = [];
    for (var k = 1; k <= ps.length; k++) {
      var i = (dealer + k) % ps.length;
      if (ps[i] && ps[i].inHand) order.push(i);
    }
    var n = 0;
    for (var round = 0; round < 2; round++) {
      order.forEach(function (seat) {
        var delay = (n++) * (DEAL_STEP / 2);
        FLY.push(function () {
          FLY.launch(flyCard(), deckPoint, function () { return holePoint(seat); }, delay);
        });
      });
    }
  }
  /* one payout = up to CAP chips leaving in a handful, on the shared
     stagger, each aimed at a function rather than a point */
  function flyChips(cents, fromFn, toFn, delay) {
    chipRungs(cents).forEach(function (rung, i) {
      FLY.push(function () { FLY.launch(flyChip(rung), fromFn, toFn, (delay || 0) + i * FLY.STEP); });
    });
  }
  function collectFlight(e) {
    if (TBL.reduceMotion()) return;
    var seat = e.seat;
    switch (e.t) {
      // a new hand is pitched from the button, two rounds of the table
      case "hand":
        dealCards(e.dealer);
        break;
      /* the muck: the two cards you're giving up go face-down onto the
         burn pile, which is where dead cards live. The seat is already
         .is-folded by the time these fly, which is the point — the cards
         leaving is what the fade means. */
      case "fold":
        [0, 1].forEach(function (k) {
          FLY.push(function () {
            FLY.launch(flyCard(), function () { return holePoint(seat); },
              burnPoint, k * (DEAL_STEP / 2));
          });
        });
        break;
      /* money OUT of a stack and onto the betting line. A raise's event
         carries the total this street, not what this action cost, so the
         delta comes off the pre-merge snapshot — by the time an event is
         handled the model has already moved on. */
      case "blind":
      case "call":
        flyChips(e.amt, function () { return chipPoint(seat); }, function () { return betPoint(seat); });
        break;
      case "raise":
        flyChips(Math.max(0, e.to - (prevBets[seat] || 0)),
          function () { return chipPoint(seat); }, function () { return betPoint(seat); });
        break;
      /* the street closing sweeps EVERY live bet into the middle at once —
         the one beat that says the money is now common. The bet pills are
         already blanked by the time this flushes, but a blanked pill is
         hidden, not gone, so it still measures. */
      case "street":
        prevBets.forEach(function (amt, i) {
          if (amt > 0) flyChips(amt, function () { return betPoint(i); }, potPoint);
        });
        /* one burn per street, deck → burn pile, ahead of the cards it
           precedes: the board's own pop is delayed by nothing, so the
           burn leaving first is what makes the order read right */
        FLY.push(function () { FLY.launch(flyCard(), deckPoint, burnPoint, 0); });
        break;
      /* the pot going home. A split pot fires one flight per award, so
         two winners visibly halve the middle. */
      case "win":
        flyChips(e.amt, potPoint, function () { return chipPoint(seat); });
        break;
      /* Leaving the table WITH your money: the stack flies off the felt
         and into your line on the roster, which is where you still are.
         Only a cash-out — a bust has no flight, because those chips went
         to the winner and the `win` above already flew them. Showing
         them leave a second time would double-count the same money. */
      case "cashout":
        flyChips(prevStacks[seat] || 0, function () { return chipPoint(seat); },
          function () { return stripPoint(seat); });
        break;
    }
  }

  /* ── the mechanical log (Claude-authored; names come from seats) ── */
  function logLine(e) {
    var n = function (s) { return seatName(s) || ("#" + s); };
    switch (e.t) {
      case "hand": return "— hand " + e.n + " —";
      case "blind": return n(e.seat) + " posts " + fmtMoney(e.amt) + (e.kind === "ante" ? " (ante)" : "");
      case "fold": return n(e.seat) + " folds";
      case "check": return n(e.seat) + " checks";
      case "call": return n(e.seat) + " calls " + fmtMoney(e.amt) + (e.allIn ? " (all-in)" : "");
      case "raise": return n(e.seat) + " raises to " + fmtMoney(e.to) + (e.allIn ? " (all-in)" : "");
      case "street": return e.name + ": " + e.cards.join(" ");
      case "win": return n(e.seat) + " wins " + fmtMoney(e.amt) + (e.name ? " (" + handName(e.name) + ")" : "");
      case "show": return n(e.seat) + " shows " + e.hole.join(" ") + (e.name ? " (" + handName(e.name) + ")" : "");
      // the fact, never the cards — the log is public
      case "showTo": return n(e.seat) + " shows their hand to " + (e.to || []).map(n).join(", ");
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
    /* The bento is the ONE node paint() doesn't rebuild — it holds the
       three tiles — so the guide overlay has to be taken down by hand or
       every broadcast would stack another copy on top of the last. */
    if (BENTO) {
      var oldGuide = BENTO.querySelector(".pk-guide");
      if (oldGuide) oldGuide.remove();
    }
    /* the big tile's three boxes — see .pk-tile--big in poker.css: the
       felt never scrolls, the cash-out table scrolls as a flex (it
       centers itself), the lobby scrolls as a block (so its bottom
       padding survives). */
    BIG.classList.toggle("is-scroll", model.phase === "lobby" || model.phase === "over");
    BIG.classList.toggle("is-lobby", model.phase === "lobby");
    if (model.phase === "lobby") {
      BIG.textContent = "";
      ROLE.textContent = "";          // reserved at full height by CSS
      renderLobbyRoster();
      return TBL.renderLobby(BIG);
    }
    if (model.phase === "over") {
      BIG.textContent = "";
      var panel = cashoutLobby();
      BIG.appendChild(panel);
      buildBoardPops(panel);     // the ledger and the log outlive the felt
      renderRoster();
      renderRole();
      return;
    }
    BIG.textContent = "";
    BIG.appendChild(felt());
    buildBoardPops();
    renderRoster();
    renderRole();
    if (ui.guideOpen && BENTO) BENTO.appendChild(handGuide());
  }

  /* ── felt popovers, bottom-left: Winnings + Log ─────────────────
     Cities' board-popover kit, verbatim idiom (second copy — noted in
     docs/games.md "Known duplication"): each popover is an absolute
     overlay paired with a pill in the button row. Hover previews,
     click pins (ui.boardPop), a 150ms grace timer lets the cursor
     cross the gap. Rebuilt every render; panels are fixed-size so
     nothing ever resizes. */
  var popHover = null, popTimer = null;
  function popOpenName() { return popHover || ui.boardPop || null; }
  function popSync() {
    var open = popOpenName();
    ["win", "pay", "log"].forEach(function (name) {
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
    var p = el("div", "pk-bpop" + (popOpenName() === name ? " is-open" : ""));
    p.setAttribute("data-pop", name);
    p.addEventListener("mouseenter", popHoverIn(name));
    p.addEventListener("mouseleave", popDelayClose);
    return p;
  }
  /* `panel` is the cash-out panel at `over`, absent in play — and that
     difference is the whole layout. Over the FELT the row is an overlay
     pinned to the tile's bottom-left corner, which is right, because the
     felt never scrolls and the row must never move the board. In the
     CASH-OUT the tile scrolls, and an absolutely positioned child of a
     scroll container is pinned to the scrollPORT, not to the content: it
     sat at the bottom of the first screenful and then rode up THROUGH the
     standings as you scrolled. So there the row goes in FLOW, at the end
     of the panel, and the popovers anchor to the row instead of to the
     tile (his report, chat 2026-08-04). */
  function buildBoardPops(panel) {
    var flow = !!panel;
    var row = el("div", "pk-boardbtns" + (flow ? " pk-boardbtns--flow" : ""));
    var host = panel || BIG;
    // in flow the panels must hang off the ROW (position: relative), not
    // off the tile, or they'd anchor to a box the row no longer sits in
    var popHost = flow ? row : BIG;
    /* In play the pill opens the Winnings grid. At `over` the grid is
       already laid out inline in the cash-out panel, so the same slot
       carries Repayment instead — who hands what to whom to settle. */
    if (model.phase === "over") {
      var payPop = popPanel("pay");
      payPop.classList.add("pk-bpop--win");   // hugs its list instead of 24rem
      payPop.appendChild(repayList());
      popHost.appendChild(payPop);
      row.appendChild(popButton("pay", S.repayButton));
    } else {
      var winPop = popPanel("win");
      winPop.classList.add("pk-bpop--win");   // hugs the grid instead of 24rem
      winPop.appendChild(winningsGrid());
      popHost.appendChild(winPop);
      row.appendChild(popButton("win", S.winningsButton));
    }
    var logPop = popPanel("log");
    var list = el("div", "pk-log__list");
    logLines.slice(-40).forEach(function (entry) {
      list.appendChild(el("div", "pk-log__line", typeof entry === "string" ? entry : entry.text || ""));
    });
    logPop.appendChild(list);
    popHost.appendChild(logPop);
    row.appendChild(popButton("log", S.logButton));
    host.appendChild(row);
    list.scrollTop = list.scrollHeight;
    requestAnimationFrame(function () { list.scrollTop = list.scrollHeight; });
  }
  /* the Winnings grid: rows win FROM columns — cell (i, j) is the net
     cents seat i has taken off seat j so far, from the engine's transfer
     ledger. The first column is each player's overall net. */
  function winningsGrid() {
    var wrap = el("div", "pk-win");
    var tr = model.transfers;
    var ps = model.players || [];
    var idx = [];
    ps.forEach(function (p, i) { if (p) idx.push(i); });
    if (!tr || !idx.length) return wrap;
    var table = el("table", "pk-win__table");
    var head = el("tr");
    head.appendChild(el("th", "pk-win__corner", ""));
    head.appendChild(el("th", "pk-win__nethead", S.winningsNet));
    idx.forEach(function (j) {
      var th = el("th", "pk-win__colhead");
      th.appendChild(seatDot(j));
      th.title = seatName(j) || "";
      head.appendChild(th);
    });
    table.appendChild(head);
    idx.forEach(function (i) {
      var row = el("tr");
      // a table cell must stay a table cell — the dot + name pair flexes
      // INSIDE it, or every column walks out of line
      var nameCell = el("th", "pk-win__name");
      var who = el("span", "pk-win__who");
      who.appendChild(seatDot(i));
      who.appendChild(el("span", "pk-win__whoname", seatName(i) || ""));
      nameCell.appendChild(who);
      nameCell.title = seatName(i) || "";
      row.appendChild(nameCell);
      var netTotal = 0;
      idx.forEach(function (j) { netTotal += tr[j][i] - tr[i][j]; });
      row.appendChild(winCell(netTotal, "pk-win__net"));
      idx.forEach(function (j) {
        if (i === j) { row.appendChild(el("td", "pk-win__self", "")); return; }
        row.appendChild(winCell(tr[j][i] - tr[i][j]));
      });
      table.appendChild(row);
    });
    wrap.appendChild(table);
    wrap.appendChild(el("div", "pk-win__hint", S.winningsHint));
    return wrap;
  }
  function winCell(v, extra) {
    var td = el("td", (extra ? extra + " " : "") + (v > 0 ? "is-plus" : v < 0 ? "is-minus" : "is-zero"));
    td.textContent = v === 0 ? "—" : (v > 0 ? "+" : "−") + fmtMoney(Math.abs(v));
    return td;
  }

  /* ── settling up: the fewest hand-offs that clear every net ──────
     The Winnings grid says who took money off whom; nobody wants to
     pay it back that way (six players is up to fifteen hand-offs).
     Only the NETS have to be honored, so pair the biggest debtor with
     the biggest creditor and repeat: each pass zeroes at least one
     person, so N players settle in at most N-1 transfers. (The true
     minimum — spotting subsets that cancel exactly — is NP-hard; this
     greedy pairing is the standard answer and is optimal whenever no
     such subset exists.) Cents in, cents out: no rounding anywhere.
     Nets sum to zero because every chip on the table was bought. */
  function repayments(rows) {
    var owe = [], due = [];
    (rows || []).forEach(function (r) {
      if (r.net < 0) owe.push({ seat: r.seat, amt: -r.net });
      else if (r.net > 0) due.push({ seat: r.seat, amt: r.net });
    });
    var big = function (a, b) { return b.amt - a.amt || a.seat - b.seat; };
    owe.sort(big); due.sort(big);
    var out = [], i = 0, j = 0;
    while (i < owe.length && j < due.length) {
      var amt = Math.min(owe[i].amt, due[j].amt);
      if (amt > 0) out.push({ from: owe[i].seat, to: due[j].seat, amt: amt });
      owe[i].amt -= amt; due[j].amt -= amt;
      if (owe[i].amt === 0) i++;
      if (due[j].amt === 0) j++;
    }
    return out;
  }
  function repayList() {
    var wrap = el("div", "pk-pay");
    var pays = repayments((model.over || {}).standings);
    if (!pays.length) {
      wrap.appendChild(el("div", "pk-pay__even", S.repayEven));
      return wrap;
    }
    pays.forEach(function (p) {
      var line = el("div", "pk-pay__line");
      line.appendChild(payWho(p.from));
      line.appendChild(el("span", "pk-pay__verb", S.repayPays));
      line.appendChild(payWho(p.to));
      line.appendChild(el("span", "pk-pay__amt", fmtMoney(p.amt)));
      wrap.appendChild(line);
    });
    wrap.appendChild(el("div", "pk-win__hint", fmt(S.repayHint, { n: pays.length })));
    return wrap;
  }
  function payWho(seat) {
    var who = el("span", "pk-pay__who");
    who.appendChild(seatDot(seat));
    who.appendChild(el("span", "pk-pay__name", seatName(seat) || ("#" + seat)));
    who.title = seatName(seat) || "";
    return who;
  }

  /* ── the felt (big tile) ──────────────────────────────────────── */
  function felt() {
    var f = el("div", "pk-felt");
    var ps = model.players || [];
    var seats = model.seats || [];
    var mine = mySeat();
    /* Live seats around the rim. WHAT SITS AT 12 O'CLOCK is the viewer's
       choice (the Rotation pill), because the two readings of a moving
       button are both defensible and only one can be drawn:

         Rotate Dealer (default) — the ring is anchored at seat order, so
           a player keeps their chair all game and the D badge walks. The
           table behaves like a table.
         Rotate Seats — the ring is anchored on the DEALER, who is always
           at the top. The button never moves; everyone else shuffles a
           seat clockwise every hand.

       It is display only: a per-viewer localStorage preference, nothing
       on the wire, and two people at one table may read it differently. */
    var ring = [];
    ps.forEach(function (p, i) { if (p && !p.left) ring.push(i); });
    var start = 0;
    if (rotateMode() === "seats" && model.dealer != null && ring.indexOf(model.dealer) >= 0) {
      start = ring.indexOf(model.dealer);
    }
    ring.forEach(function (seat, k) {
      var idx = (k - start + ring.length) % ring.length;
      var theta = -Math.PI / 2 + (idx * 2 * Math.PI) / ring.length;
      var x = 50 + 44 * Math.cos(theta);
      var y = 50 + 42 * Math.sin(theta);
      f.appendChild(feltSeat(seat, x, y));
    });
    /* board + pot in the middle. Cards dealt SINCE the last paint pop in,
       staggered left to right, so a flop arrives as three cards rather
       than as a row that was suddenly there. The stagger is an
       animation-delay; the CSS fills backwards so a waiting card is held
       at scale 0 instead of standing full-size through its own delay. */
    var board = el("div", "pk-board");
    var dealt = (model.board || []).length;
    if (dealt < seenBoard) seenBoard = 0;      // a new hand cleared the felt
    for (var b = 0; b < 5; b++) {
      var bc = cardEl(model.board && model.board[b]);
      if (b >= seenBoard && b < dealt && !TBL.reduceMotion()) {
        bc.classList.add("is-dealt");
        bc.style.animationDelay = ((b - seenBoard) * DEAL_STEP) + "ms";
      }
      board.appendChild(bc);
    }
    seenBoard = dealt;
    f.appendChild(board);
    /* The two piles flank the dealt cards (his call): the DECK on the
       left, where a hand comes from, the BURN on the right, where dead
       cards go — so the felt reads left to right in the order the cards
       actually move. The burn takes both kinds of dead card, one per
       street plus every mucked hand, and its depth is DERIVED rather than
       counted up: a reconnect mid-hand has to land on the same pile as
       everyone else, and an accumulator would start from zero. */
    if (!model.waiting) {
      f.appendChild(cardPile("pk-deck", DECK_DEPTH, 0));
      // squared up, same as the deck (his call): the sideways fan read as
      // a different-shaped object rather than as a second pile
      f.appendChild(cardPile("pk-burn", burnDepth(), 0));
    }
    if (model.waiting) {
      f.appendChild(el("div", "pk-feltline", S.waitingLine));
    } else {
      /* The pot is its own chips with the amount under them — the word
         "pot" was doing no work that a pile of chips in the middle of a
         felt doesn't already do (his call, chat 2026-08-03). The pile is
         the chips people actually PUSHED IN: the engine accumulates them
         off each tray as it pays (engine `syncTrays`), so three quarters
         bet are three quarters in the middle, not the 50¢-and-a-25¢ that
         racking the total would have produced. `dealTray` is only the
         fallback for an old broadcast that predates `potTray`. */
      var pot = el("div", "pk-pot");
      var cents = model.pot || 0;
      // the pile renders even at zero, so the amount under it never moves
      var potTray = chipStacks(model.potTray || Engine.dealTray(cents, chipValsNow()), { rail: false });
      potTray.setAttribute("data-pk-pot", "");   // where a street sweeps to, and a win flies from
      pot.appendChild(potTray);
      pot.appendChild(el("strong", null, fmtMoney(cents)));
      f.appendChild(pot);
    }
    if (model.handOver) f.appendChild(handOverCard());
    return f;
  }
  /* One burn per street dealt — flop, turn, river — plus the two cards of
     every hand that has folded. Both are read straight off the model, so
     the pile is the same for every viewer and survives a reconnect. */
  function burnDepth() {
    var b = (model.board || []).length;
    var n = b >= 3 ? b - 2 : 0;
    (model.players || []).forEach(function (p) { if (p && p.folded) n += 2; });
    return n;
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
    node.setAttribute("data-seat", i);   // flights find a seat's tray and bet spot through this
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
    /* The tag and the bet pill are ALWAYS in the seat, blanked rather
       than omitted. A seat is centered on its anchor (`translate(-50%,
       -50%)`), so its height decides where it sits: drop the bet pill
       when the street clears and the whole seat re-centers, sliding the
       name and badges down half a pill. That was the flop's "jitter". */
    var tag = seatTag(p, away);
    node.appendChild(el("span", "pk-seat__tag" + (tag ? "" : " is-blank"), tag || " "));
    if (p.tray && !p.left) node.appendChild(chipStacks(p.tray, { rail: false }));
    var bet = p.betStreet > 0;
    node.appendChild(el("span", "pk-seat__bet" + (bet ? "" : " is-blank"),
      bet ? fmtMoney(p.betStreet) : " "));
    /* A hand shown privately to YOU rides the seat that showed it — that
       is whose cards they are, and the felt is where you already look to
       ask who holds what. It is an ABSOLUTE box over that seat's chips,
       not a row inside the seat: a seat is centered on its own anchor, so
       anything that adds height slides it, and every seat would have to
       reserve the space forever against the one hand in fifty that uses
       it. The settlement card takes over once the hand ends (his call),
       so the two never draw the same cards at the same moment. */
    var priv = shownToMe(i);
    if (priv && !model.handOver) {
      var peek = el("div", "pk-peek");
      var pcards = el("div", "pk-peek__cards");
      priv.forEach(function (c) { pcards.appendChild(cardEl(c)); });
      peek.appendChild(pcards);
      peek.appendChild(el("span", "pk-peek__tag", S.shownToYou));
      node.appendChild(peek);
    }
    return node;
  }
  /* the hands other people have shown you this hand. Only ever populated
     for the connection they were shown to (transport-mock `shownToMe`) —
     the page cannot show what the table did not send it. */
  function shownToMe(i) {
    var list = (model.you && model.you.shownToMe) || [];
    for (var k = 0; k < list.length; k++) if (list[k].seat === i) return list[k].hole;
    return null;
  }
  function badge(text, tip, blind) {
    var b = el("span", "pk-seat__badge" + (blind ? " pk-seat__badge--blind" : ""), text);
    b.title = tip;
    return b;
  }
  // `dropped` is the socket dying; `p.away` is a deliberate sit-out. The
  // sit-out outranks it — a disconnect while sitting out changes nothing.
  function seatTag(p, dropped) {
    if (p.left) return S.leftTag;
    if (p.out) return S.outTag;
    if (p.away) return S.sittingOutTag;
    if (p.waiting) return p.owesAnte ? S.owesAnteTag : S.waitingTag;
    if (p.allIn) return S.allInTag;
    if (p.folded) return S.foldedTag;
    if (dropped) return S.awayTag;
    return null;
  }

  /* the settlement interstitial, floating over the felt */
  function handOverCard() {
    var ho = model.handOver;
    var card = el("div", "pk-over");
    /* the entrance fires ONCE per hand-over, not once per paint — a
       broadcast while the card is up (someone cashing out, a vote) would
       otherwise re-play it. handOverAt is the hand's own stamp. */
    var fresh = model.handOverAt != null && model.handOverAt !== seenOverAt;
    if (fresh && !TBL.reduceMotion()) card.classList.add("is-in");
    seenOverAt = model.handOverAt;
    /* the board the hands were made from, across the top: the felt's own
       board sits BEHIND this card, so without it you'd be reading five
       showdowns against cards you can't see */
    if ((ho.board || []).length) {
      var bd = el("div", "pk-over__board");
      ho.board.forEach(function (c) { bd.appendChild(cardEl(c)); });
      card.appendChild(bd);
    }
    if (ho.reason === "folds") {
      var w = ho.awards[0];
      card.appendChild(line(fmt(S.foldWinLine, { name: seatName(w.seat) })));
      card.appendChild(line(fmt(S.winLine, { name: seatName(w.seat), amt: fmtMoney(w.amt) }), "is-win"));
    } else {
      // one line per distinct winner; the hands themselves are the grid below
      var seen = {};
      ho.awards.forEach(function (a) {
        if (seen[a.seat]) { seen[a.seat].amt += a.amt; return; }
        seen[a.seat] = { amt: a.amt, name: a.name };
      });
      Object.keys(seen).forEach(function (seat) {
        var a = seen[seat];
        card.appendChild(line(a.name
          ? fmt(S.winLineHand, { name: seatName(+seat), amt: fmtMoney(a.amt), hand: handName(a.name) })
          : fmt(S.winLine, { name: seatName(+seat), amt: fmtMoney(a.amt) }), "is-win"));
      });
    }
    /* Everyone who got to the end is on the card, tabled or not: a mucked
       hand keeps its seat and its two cards, face DOWN. Showing the row
       and hiding the cards is the whole point — you can see that four
       people took it to the river without seeing what they had.

       The layout is a GRID, not a stack: twelve seats one per line ran
       the card off the bottom of the felt. The column count is JS's
       because CSS can't do it here — the card is shrink-to-fit, and
       `auto-fit` against an indefinite width collapses to a single
       column. Roughly square, capped at four across. */
    var hands = ho.hands || [];
    if (hands.length) {
      var grid = el("div", "pk-over__reveals");
      grid.style.setProperty("--pkcols",
        String(Math.min(4, Math.ceil(Math.sqrt(hands.length)))));
      hands.forEach(function (h) {
        var row = el("div", "pk-over__sub pk-over__hand" + (h.shown ? "" : " is-muck"));
        row.appendChild(el("span", "pk-over__who", seatName(h.seat)));
        var cards = el("span", "pk-over__cards");
        if (h.shown) h.hole.forEach(function (c) { cards.appendChild(cardEl(c)); });
        else { cards.appendChild(backEl()); cards.appendChild(backEl()); }
        row.appendChild(cards);
        row.appendChild(el("span", "pk-over__rank", h.shown && h.name ? handName(h.name) : " "));
        grid.appendChild(row);
      });
      card.appendChild(grid);
    }
    // countdown to the auto-deal, then the footer: Reveal left, Next right
    var autoLine = el("div", "pk-over__sub");
    card.appendChild(autoLine);
    tickInterstitial(autoLine);
    card.appendChild(overFoot());
    function line(text, cls) { return el("div", "pk-over__line" + (cls ? " " + cls : ""), text); }
    return card;
  }
  /* The card's footer. Reveal on the left, Next hand on the right — the
     two ends of what you can do with a settled hand: put more information
     on the table, or move on.

     "Reveal | X" is one control with two halves (his shape, chat
     2026-08-03): the BUTTON shows this hand, the CHECKBOX is a standing
     order to show every hand from here on. The standing order is a local
     preference, not a table setting — it's how YOU want to play, it
     shouldn't survive into someone else's session, and it defaults OFF
     because the whole point of the auto-muck is that nobody is forced to
     expose. Ticking it shows the current hand too, which is what "reveal
     every hand" plainly means while a hand is sitting there unrevealed. */
  function overFoot() {
    var foot = el("div", "pk-over__foot");
    var mine = mySeat();
    var ho = model.handOver;
    var row = null;
    (ho.hands || []).forEach(function (h) { if (h.seat === mine) row = h; });
    /* ONE pill with a hairline down it, not a button and a stray checkbox:
       the shell's own "Queue | Arena ▾" anatomy (`tb-pill__value`, a value
       fenced off by its left border). The two halves do different things —
       show THIS hand, show EVERY hand — which is exactly the relationship
       that idiom is for. */
    var left = el("div", "tb-pill pk-over__reveal");
    var btn = el("button", "pk-over__reveal-do");
    btn.type = "button";
    btn.appendChild(el("span", "tb-pill__label", S.revealButton));
    // no hand in this pot (spectator, folded, just sat down) → the control
    // is present but dead, so the footer never changes shape
    btn.disabled = !row || row.shown;
    btn.title = !row ? S.revealNoneTip : row.shown ? S.revealDoneTip : S.revealTip;
    if (btn.disabled) left.classList.add("is-off");
    btn.addEventListener("click", function () { send({ type: "reveal" }); });
    left.appendChild(btn);
    var wrap = el("label", "tb-pill__value pk-over__always-wrap");
    wrap.title = S.revealAlwaysTip;
    var box = el("input", "pk-over__always");
    box.type = "checkbox";
    box.checked = autoReveal();
    box.setAttribute("aria-label", S.revealAlwaysTip);
    box.addEventListener("change", function () {
      save(AUTO_REVEAL_KEY, !!box.checked);
      if (box.checked) autoRevealNow();
      render();
    });
    wrap.appendChild(box);
    left.appendChild(wrap);
    foot.appendChild(left);
    var next = el("button", "tb-pill gt-lobby__start");
    next.type = "button";
    next.appendChild(el("span", "tb-pill__label", S.nextHandButton));
    next.addEventListener("click", function () { send({ type: "nextHand" }); });
    foot.appendChild(next);
    return foot;
  }
  /* Which way the felt reads (see `felt()`). Per-VIEWER, like mahjong's
     tile art and the auto-show below: never on the wire, never a table
     setting — nobody else's felt is any of your business. */
  var ROTATE_KEY = "deets-poker-rotate";
  function rotateMode() { return load(ROTATE_KEY, "dealer") === "seats" ? "seats" : "dealer"; }
  function rotationPill() {
    var wrap = el("span", "pk-rotate");
    var b = el("button", "tb-pill");
    b.type = "button";
    b.setAttribute("aria-haspopup", "true");
    b.appendChild(el("span", "tb-pill__label", S.rotationPill));
    b.appendChild(el("span", "tb-pill__caret", "▾"));
    b.title = S.rotationTip;
    wrap.appendChild(b);
    var pop = el("div", "tb-pop pk-rotate__pop");
    pop.hidden = true;
    var now = rotateMode();
    [["dealer", S.rotateDealer, S.rotateDealerTip],
     ["seats", S.rotateSeats, S.rotateSeatsTip]].forEach(function (o) {
      var opt = el("button", "tb-pop__opt" + (now === o[0] ? " is-active" : ""));
      opt.type = "button";
      opt.textContent = o[1];
      opt.title = o[2];
      opt.setAttribute("aria-pressed", now === o[0] ? "true" : "false");
      opt.addEventListener("click", function () {
        save(ROTATE_KEY, o[0]);
        ui.rotateOpen = false;
        TBL.pop.close();
        render();
      });
      pop.appendChild(opt);
    });
    wrap.appendChild(pop);
    var entry = { ctrl: wrap, pill: b, pop: pop };
    b.addEventListener("click", function () {
      ui.rotateOpen = !ui.rotateOpen;
      if (ui.rotateOpen) TBL.pop.open(entry); else TBL.pop.close();
    });
    // the toolbar is rebuilt on every broadcast, so a popover left open
    // has to be handed the NEW nodes or the kit measures a dead panel
    if (ui.rotateOpen) TBL.pop.open(entry);
    return wrap;
  }
  // per-VIEWER, like mahjong's tile art: never on the wire, never a table
  // setting — it is how you play, not how the table plays
  var AUTO_REVEAL_KEY = "deets-poker-auto-reveal";
  function autoReveal() { return load(AUTO_REVEAL_KEY, false) === true; }
  /* The standing order, applied. Fires from the render pass (postRender)
     rather than from the broadcast handler so it can't run ahead of the
     model it reads, and it is guarded on `shown` — the engine treats a
     second reveal as a no-op, but a paint loop that re-sent every frame
     would still flood the socket. */
  function autoRevealNow() {
    if (!autoReveal() || !model || !model.handOver) return;
    var mine = mySeat();
    if (mine == null) return;
    var row = null;
    (model.handOver.hands || []).forEach(function (h) { if (h.seat === mine) row = h; });
    if (!row || row.shown) return;
    if (autoRevealSent === model.handOverAt) return;
    autoRevealSent = model.handOverAt;
    send({ type: "reveal" });
  }
  /* The countdown under the settlement card. `isConnected` is the loop's
     STOP condition, and it may only be asked from the second tick on: the
     felt is built whole and appended afterwards (`BIG.appendChild(felt())`),
     so on the first call this node is still detached and the old guard
     bailed before it ever wrote a digit — the line was permanently blank. */
  function tickInterstitial(node) {
    if (overTick) { clearTimeout(overTick); overTick = null; }
    function step(first) {
      if (!model || !model.handOverAt) return;
      if (!first && !node.isConnected) return;
      var secs = Math.max(0, Math.ceil((model.handOverAt - (Date.now() - TBL.skew())) / 1000));
      node.textContent = fmt(S.nextHandAuto, { n: secs });
      overTick = setTimeout(function () { step(false); }, 250);
    }
    step(true);
  }

  /* ── the roster (players tile) — full player cards, the cities-pstrip
     anatomy: seat dot (the clock, when acting) + name + badges up top,
     the seat's state pinned bottom-left, the money column on the right ── */
  /* The lobby's own roster: the same pstrip anatomy the game uses, filled
     from the SEAT list alone (there is no engine state yet). It fills in
     as people sit down, so the tile that would otherwise sit empty until
     Start previews exactly what it becomes. */
  function renderLobbyRoster() {
    PLAYERS.textContent = "";
    PLAYERS.appendChild(el("div", "pk-ptitle", S.playersTitle));
    var list = el("div", "pk-plist");
    var mine = mySeat();
    var buyIn = model.settings ? model.settings.buyIn : 0;
    (model.seats || []).forEach(function (s, i) {
      if (!s || s.empty) return;
      var strip = el("div", "pk-pstrip");
      seatAccent(strip, i);
      var body = el("div", "pk-pstrip__body");
      var head = el("div", "pk-pstrip__head");
      head.appendChild(seatDot(i));
      var nm = el("span", "pk-pstrip__name");
      if (i === mine) nm.appendChild(el("strong", null, seatName(i)));
      else nm.appendChild(el("span", null, seatName(i) || ""));
      head.appendChild(nm);
      if (model.hostSeat === i) {
        var badges = el("span", "pk-pstrip__badges");
        badges.appendChild(stripBadge(S.hostBadge, S.hostBadge));
        head.appendChild(badges);
      }
      body.appendChild(head);
      // the tags row stays present-but-empty, exactly as in game, so the
      // strip is the same height before and after Start
      body.appendChild(el("div", "pk-pstrip__tags"));
      strip.appendChild(body);
      var stat = el("div", "pk-pstrip__stat");
      stat.appendChild(el("span", "pk-pstrip__stack", fmtMoney(buyIn)));
      stat.appendChild(el("span", "pk-pstrip__bet", " "));
      strip.appendChild(stat);
      list.appendChild(strip);
    });
    PLAYERS.appendChild(list);
  }
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
      strip.setAttribute("data-seat", i);   // where a cashed-out stack flies to
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
  /* The cascade rewrites rows the host isn't looking at — pick a $50
     buy-in and the blind and all five chips change underneath. Only the
     OVERRIDDEN state gets a mark: a derived row needs no "auto" label,
     because it was already derived before anyone touched it and the
     values speak for themselves (his call, chat 2026-08-03). The reset
     link is the dirty flag's only UI, and it appears exactly when
     there's something to undo. */
  function autoMark(manual, host, verb) {
    if (!manual) return null;
    var b = el("button", "pk-auto pk-auto--reset");
    b.type = "button";
    b.disabled = !host;
    b.textContent = S.autoReset;
    b.title = S.autoResetTip;
    b.addEventListener("click", function () {
      var msg = { type: "setSettings" };
      msg[verb] = true;
      send(msg);
    });
    return b;
  }
  function stripBadge(text, tip) {
    var b = el("span", "pk-pstrip__badge", text);
    b.title = tip;
    return b;
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
      /* What you actually HAVE, under the cards. Read client-side from
         your own two plus the public board — the engine already exports
         `bestOf`, and asking the table would put a hand on the wire that
         only you may see. ALWAYS present, blanked rather than omitted, so
         the flop doesn't jog the panel (the universal layout rule). */
      var made = myHandName();
      handCol.appendChild(el("div", "pk-made" + (made ? "" : " is-blank"), made || " "));
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
    // the rankings reference, pinned to the bottom of the hand column
    handCol.appendChild(handGuideButton());
    play.appendChild(handCol);

    /* the chip rail: your own stack, drawn. The cash total IS the
       heading — a label over your own chips only said what the chips
       already say (his call, chat 2026-08-03). The rail is ALWAYS in the
       layout (empty when you're bust) so the panel keeps cities'
       no-jitter rule. */
    var rail = el("div", "pk-play__chips");
    var railHead = el("div", "pk-chips__head");
    railHead.appendChild(el("span", "pk-chips__total", fmtMoney(p.stack)));
    rail.appendChild(railHead);
    var railTray = chipStacks(p.tray, { rail: true });
    railTray.setAttribute("data-pk-rail", "");   // my chips fly through MY rail, not my felt seat
    rail.appendChild(railTray);
    play.appendChild(rail);

    // controls column: the pills right-aligned (cities-actions), tray under
    var ctrl = el("div", "pk-play__ctrl");
    var o = model.you && model.you.options;
    var acting = !!o && !model.handOver;
    var acts = el("div", "pk-actions");
    /* Show to leads the row (his call, chat 2026-08-04) and is the only
       pill in it NOT gated on the action being yours: the moment you want
       to show someone is almost never your turn — they just folded, you
       just took it down. It gates on HOLDING CARDS and on there being
       anyone out of the hand to show them to (`you.showTargets`, which
       the rules compute rather than the page guessing). Leading also
       keeps it away from Fold/Check/Call/Raise, which is where the eye
       goes under a clock; nobody should hit it by muscle memory. */
    acts.appendChild(showToPill());
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
  /* "Show to" — a pill whose popover is a checklist of the seats that are
     out of the hand, plus one Show. Multi-select behind a confirm rather
     than fire-on-click: showing can't be taken back, and a stray click
     shouldn't table your hand to the wrong person.

     Both the open state and the ticks live in `ui`, not on the nodes: a
     broadcast rebuilds this panel, and a picker that closed itself every
     time someone else acted would be unusable at a twelve-seat table. */
  function showToPill() {
    var targets = (model.you && model.you.showTargets) || [];
    var done = (model.you && model.you.showedTo) || [];
    var wrap = el("span", "pk-showto");
    var b = el("button", "tb-pill");
    b.type = "button";
    b.disabled = !targets.length;
    b.appendChild(el("span", "tb-pill__label", S.showToButton));
    b.appendChild(el("span", "tb-pill__caret", "▾"));
    b.title = targets.length ? S.showToTip : S.showToNoneTip;
    wrap.appendChild(b);
    var pop = el("div", "tb-pop pk-showto__pop");
    pop.hidden = true;
    pop.appendChild(el("div", "tb-pop__head", S.showToHead));
    if (!ui.showToPick) ui.showToPick = {};
    var picked = ui.showToPick;
    targets.forEach(function (j) {
      var had = done.indexOf(j) >= 0;
      var row = el("label", "pk-showto__row" + (had ? " is-done" : ""));
      var box = el("input", "pk-showto__box");
      box.type = "checkbox";
      box.checked = !had && !!picked[j];
      box.disabled = had;
      box.addEventListener("change", function () {
        if (box.checked) picked[j] = true; else delete picked[j];
        render();
      });
      row.appendChild(box);
      row.appendChild(seatDot(j));
      row.appendChild(el("span", "pk-showto__name", seatName(j)));
      row.appendChild(el("span", "pk-showto__state",
        had ? S.showToDone : seatOut(j) ? S.showToSittingOut : S.showToFolded));
      pop.appendChild(row);
    });
    var foot = el("div", "pk-showto__foot");
    var n = targets.filter(function (j) { return picked[j] && done.indexOf(j) < 0; }).length;
    foot.appendChild(el("span", "pk-showto__count", fmt(S.showToCount, { n: n })));
    var go = el("button", "tb-pill");
    go.type = "button";
    go.disabled = !n;
    go.appendChild(el("span", "tb-pill__label", S.showToConfirm));
    go.addEventListener("click", function () {
      var seats = targets.filter(function (j) { return picked[j] && done.indexOf(j) < 0; });
      if (!seats.length) return;
      send({ type: "showTo", seats: seats });
      ui.showToPick = {};
      ui.showToOpen = false;
      TBL.pop.close();
      render();
    });
    foot.appendChild(go);
    pop.appendChild(foot);
    wrap.appendChild(pop);
    var entry = { ctrl: wrap, pill: b, pop: pop };
    b.addEventListener("click", function () {
      ui.showToOpen = !ui.showToOpen;
      if (ui.showToOpen) TBL.pop.open(entry); else TBL.pop.close();
    });
    // a re-render while it's open has to hand the kit the NEW nodes, or
    // outside-click would be measuring a panel that left the document
    if (ui.showToOpen && targets.length) TBL.pop.open(entry);
    else ui.showToOpen = false;
    return wrap;
  }
  // sitting out vs merely folded — the two ways to be out of a hand
  function seatOut(i) {
    var p = model.players && model.players[i];
    return !!(p && (p.away || p.out || p.waiting));
  }
  /* ── the made hand + the rankings guide ───────────────────────────
     What you hold, named. Five cards is the minimum a real evaluation
     needs, so preflop it reads the two in your hand directly — you do
     hold a pair or a high card before the flop, and saying nothing there
     would blank the line for a whole street. */
  function myHandName() {
    var hole = model.you && model.you.hole;
    if (!hole || hole.length < 2) return null;
    var cards = hole.concat(model.board || []);
    if (cards.length >= 5) return handName(Engine.bestOf(cards).name);
    return handName(hole[0].charAt(0) === hole[1].charAt(0) ? "pair" : "high");
  }

  /* The rankings, best first, each with a hand that IS it — the fastest
     way to answer "does a flush beat a full house" is to look at one of
     each. `key` matches the engine's HAND_NAMES, so the names come from
     his strings and the row you currently hold can light up. */
  var HAND_GUIDE = [
    ["straightFlush", ["As", "Ks", "Qs", "Js", "Ts"]],
    ["quads",         ["9c", "9d", "9h", "9s", "4d"]],
    ["fullHouse",     ["Kc", "Kd", "Kh", "7s", "7d"]],
    ["flush",         ["Ah", "Jh", "8h", "5h", "3h"]],
    ["straight",      ["9c", "8d", "7h", "6s", "5d"]],
    ["trips",         ["Qc", "Qd", "Qh", "8s", "3d"]],
    ["twoPair",       ["Jc", "Jd", "6h", "6s", "Ad"]],
    ["pair",          ["Tc", "Td", "Kh", "7s", "2d"]],
    ["high",          ["Ac", "Jd", "9h", "6s", "3d"]]
  ];
  function handGuideButton() {
    var b = el("button", "tb-pill pk-guidebtn");
    b.type = "button";
    b.appendChild(el("span", "tb-pill__label", S.guideButton));
    b.title = S.guideTip;
    b.addEventListener("click", function () { ui.guideOpen = true; render(); });
    return b;
  }
  function closeGuide() {
    if (!ui.guideOpen) return;
    ui.guideOpen = false;
    render();
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeGuide(); });
  /* Mahjong's scoring-guide idiom, in poker's clothing: an absolute
     overlay on the bento, a fixed-width panel that scrolls inside itself,
     and deliberately NO entrance animation — the page rebuilds on every
     broadcast while this is open, and anything that replayed would
     flicker once a second at a twelve-seat table. */
  function handGuide() {
    var mine = myHandName();
    var wrap = el("div", "pk-guide");
    wrap.addEventListener("click", function (e) { if (e.target === wrap) closeGuide(); });
    var panel = el("div", "pk-guide__panel");
    var head = el("div", "pk-guide__head");
    head.appendChild(el("h2", "pk-guide__title", S.guideTitle));
    var x = el("button", "pk-guide__close", S.guideClose);
    x.type = "button";
    x.addEventListener("click", closeGuide);
    head.appendChild(x);
    panel.appendChild(head);
    panel.appendChild(el("p", "pk-guide__intro", S.guideIntro));
    var body = el("div", "pk-guide__body");
    HAND_GUIDE.forEach(function (g) {
      var nm = handName(g[0]);
      var row = el("div", "pk-guide__row" + (mine && nm === mine ? " is-held" : ""));
      var top = el("div", "pk-guide__top");
      top.appendChild(el("span", "pk-guide__name", nm));
      top.appendChild(el("span", "pk-guide__desc", S["guide" + g[0].charAt(0).toUpperCase() + g[0].slice(1)] || ""));
      row.appendChild(top);
      var ex = el("div", "pk-guide__cards");
      g[1].forEach(function (c) { ex.appendChild(cardEl(c)); });
      row.appendChild(ex);
      body.appendChild(row);
    });
    panel.appendChild(body);
    panel.appendChild(el("p", "pk-guide__foot", S.guideFoot));
    wrap.appendChild(panel);
    return wrap;
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
      /* o.minTo isn't always representable (a short all-in can leave
         bet.current off the ladder), and every slider stop inherits the
         base's remainder — so climb to the first amount the chips make,
         exactly as the bot does. If nothing between minTo and the stack
         fits, the full all-in (always legal) is the only raise left. */
      var fitTo = Engine.botFit(o.minTo, chipValsNow(), o.minTo, o.maxTo) || o.maxTo;
      minBy = Math.max(1, fitTo - cur);
      maxBy = Math.max(minBy, o.maxTo - cur);
    }
    var val = ui.raiseDraft != null ? ui.raiseDraft : minBy;
    val = Math.max(minBy, Math.min(maxBy, val));
    var slider = el("input", "pk-raise__slider");
    slider.type = "range";
    slider.min = minBy; slider.max = maxBy; slider.step = step;
    slider.value = val;
    slider.disabled = !armed;
    /* The amount READS as text and IS the type-in — one element, styled
       bare until you focus it, rather than a bold readout sitting beside
       a box that says the same thing (his call, chat 2026-08-03). It
       stays an <input> the whole time, so clicking it just puts a caret
       where you clicked; swapping nodes on click would eat that click. */
    var box = el("input", "pk-raise__amt");
    box.type = "text";
    box.value = fmtMoney(val);
    box.disabled = !armed;
    box.setAttribute("aria-label", S.raiseCustomAria);
    slider.addEventListener("input", function () {
      ui.raiseDraft = +slider.value;
      box.value = fmtMoney(+slider.value);
    });
    box.addEventListener("focus", function () { box.select(); });
    box.addEventListener("input", function () {
      var v = parseMoney(box.value, true);   // bare numbers are cents here
      if (v != null) { ui.raiseDraft = v; slider.value = v; }
    });
    // leaving the field re-prints whatever the engine will actually see
    box.addEventListener("change", function () {
      var v = parseMoney(box.value, true);
      box.value = fmtMoney(v == null ? (ui.raiseDraft != null ? ui.raiseDraft : minBy) : v);
    });
    box.addEventListener("keydown", function (e) { if (e.key === "Enter") go.click(); });
    tray.appendChild(slider);
    tray.appendChild(box);
    var go = el("button", "tb-pill pk-raise__go");
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

  /* ── the cash-out lobby (big tile at `over`) ──────────────────────
     Cities' and mahjong's over screen, beat for beat: a head line with
     the title left and the count right, a ranked reveal whose winning
     row glows, then the panel's own Rematch pill. Where those two show
     superlative cards, poker shows the money — bought in, walked with,
     net — and then the Winnings grid, which at `over` comes out of its
     popover and lies flat (the felt's pill turns into Repayment). */
  function cashoutLobby() {
    var over = model.over || {};
    var wrap = el("div", "pk-cashout");
    var head = el("div", "pk-cashout__head");
    head.appendChild(el("h2", "pk-cashout__title", S.gameOver));
    head.appendChild(el("span", "pk-cashout__hands", fmt(S.handCount, { n: over.hands || 0 })));
    wrap.appendChild(head);
    /* the host closing his own table explains itself, so `host` gets no
       line at all — only the two endings nobody chose alone get one. */
    var why = over.endedBy === "vote" ? S.endedByVote
      : over.endedBy === "attrition" ? S.endedByAttrition : "";
    if (why) wrap.appendChild(el("p", "pk-cashout__sub", why));

    var reveal = el("div", "pk-cashout__reveal");
    var hrow = el("div", "pk-cashout__row pk-cashout__row--head");
    hrow.appendChild(el("span", "pk-cashout__nodot"));   // holds the seat-dot column open
    hrow.appendChild(el("span", "pk-cashout__name", ""));
    hrow.appendChild(el("span", "pk-cashout__place", ""));
    hrow.appendChild(el("span", "pk-cashout__fig", S.colBought));
    hrow.appendChild(el("span", "pk-cashout__fig", S.colStack));
    hrow.appendChild(el("span", "pk-cashout__fig", S.colNet));
    reveal.appendChild(hrow);
    var mine = mySeat();
    (over.standings || []).forEach(function (r) {
      var row = el("div", "pk-cashout__row"
        + (r.rank === 1 ? " is-winner" : "")
        + (r.seat === mine ? " is-me" : ""));
      row.appendChild(seatDot(r.seat));
      row.appendChild(el("span", "pk-cashout__name", seatName(r.seat) || ("#" + r.seat)));
      row.appendChild(el("span", "pk-cashout__place",
        r.tied ? fmt(S.placeTied, { place: r.rank }) : (S.ordinals[r.rank - 1] || String(r.rank))));
      row.appendChild(el("span", "pk-cashout__fig", fmtMoney(r.bought)));
      row.appendChild(el("span", "pk-cashout__fig", fmtMoney(r.stack)));
      row.appendChild(el("span", "pk-cashout__fig pk-cashout__net "
        + (r.net > 0 ? "is-plus" : r.net < 0 ? "is-minus" : "is-zero"), net(r.net)));
      reveal.appendChild(row);
    });
    wrap.appendChild(reveal);

    var grid = el("div", "pk-cashout__matrix");
    grid.appendChild(el("h3", "pk-cashout__subhead", S.winningsButton));
    grid.appendChild(winningsGrid());
    wrap.appendChild(grid);

    if (model.host) {
      var again = el("button", "tb-pill pk-cashout__rematch");
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
