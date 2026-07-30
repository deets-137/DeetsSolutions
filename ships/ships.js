/* DeetsShips — the table UI (docs/ships.md, "The table layout — the bento").

   The shell (games/table.js) owns the socket, the gate, the lobby (with
   the TEAMS columns), the toolbar and the render frame. This file is the
   game half: the 20×20 ocean, the planning surface (select ship → select
   action → the board lights every valid tile), the phase banner, the
   readiness board, the calendar of turns, and the Guide.

   The client's affordances are COSMETIC — the engine validates at stage
   time and the server re-validates every commit from scratch. Planning
   state lives here (uncommitted plans exist only on this client until
   Ready stages them); teammates coordinate on voice, not through the UI.

   All user-facing copy comes from strings.js ([ph] convention). The log
   lines of other games have no equivalent here: the log tile IS the
   calendar, and moment-to-moment narration rides toasts. */
(function () {
  "use strict";

  var S = window.SHIPS_STRINGS || {};
  var Engine = window.ShipsEngine;
  var ShipsColors = Engine.makeColors(window.DeetsColors);
  var CLASSES = Engine.CLASSES, BOARD = Engine.BOARD, DIRS = Engine.DIRS;

  var CS = 32;                      // px per tile in the SVG's coordinate space
  var CLS_NAME = {
    carrier: S.clsCarrier, battleship: S.clsBattleship, destroyer: S.clsDestroyer,
    submarine: S.clsSubmarine, cruiser: S.clsCruiser,
  };
  // engine dirs are E,S,W,N (y grows south); present them N,E,S,W
  var DIR_ORDER = [3, 0, 1, 2];
  var DIR_NAME = {};
  DIR_NAME[0] = S.dirE; DIR_NAME[1] = S.dirS; DIR_NAME[2] = S.dirW; DIR_NAME[3] = S.dirN;
  var DIR8_ANGLE = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };

  /* ── DOM handles ─────────────────────────────────────────────── */
  var BAR_INPUT = document.querySelector("[data-ships-code]");
  var CODE_POP = document.querySelector("[data-ships-code-pop]");
  var TOOLBAR = document.querySelector("[data-ships-toolbar]");
  var GATE = document.querySelector("[data-ships-gate]");
  var TABLE = document.querySelector("[data-ships-table]");
  var BIG = document.querySelector("[data-ships-big]");
  var PHASE = document.querySelector("[data-ships-phase]");
  var PLAYERS = document.querySelector("[data-ships-players]");
  var LOG = document.querySelector("[data-ships-log]");
  var ROLE = document.querySelector("[data-ships-role]");
  var DESKTOP = document.querySelector("[data-ships-desktop]");

  function svgEl(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* ═══ THE TABLE SHELL ══════════════════════════════════════════ */
  var model = null;
  var TBL = window.DeetsTable.create({
    ns: "ships",
    api: "https://ships-api.deets.solutions",
    mock: window.ShipsTransport,
    strings: S,
    colors: ShipsColors,               // red band reserved for enemy intel
    rootSel: ".ships",
    capacity: 8,
    minSeats: 2,
    teams: 2,                          // the real-teams flag (docs/games.md, "Teams")
    teamName: teamName,
    rejoinModes: ["anyone", "rejoin"],
    startNeedsHint: S.startNeedsTwo,
    errExtra: {
      teams: S.errTeams, plan: S.errPlan, dupe: S.errDupe, band: S.errBand,
      move: S.errMove, aim: S.errAim, disarmed: S.errDisarmed, locked: S.errLocked,
    },
    // per-phase clocks: the readouts ask the game for the current budget
    timerBudget: function () {
      if (!model || !model.settings) return 0;
      if (model.phase === "draft") return model.settings.timerDraft || 0;
      if (model.phase === "move") return model.settings.timerMove || 0;
      if (model.phase === "action") return model.settings.timerAction || 0;
      return 0;
    },
    clearFields: ["round", "committed", "ready", "alive", "fleetSize", "wrecks",
                  "winner", "fleets", "turnEndsAt", "over"],
    clearYouFields: ["team", "ships", "marks", "history", "plans", "spectator"],
    els: {
      bar: BAR_INPUT, codePop: CODE_POP, codeCtrl: document.querySelector(".gt-code"),
      toolbar: TOOLBAR, gate: GATE, table: TABLE, big: BIG, log: LOG, desktop: DESKTOP,
    },
    onModel: function (m) { model = m; },
    onEvent: handleEvent,
    preRender: syncPlan,
    render: paint,
    onLeave: resetGameUi,
    onRematch: resetGameUi,
    lobbySettings: lobbySettings,
    settingsRows: function () {
      var st = model.settings;
      function tval(v) { return v ? fmt(S.timerSecs, { n: v }) : S.timerOff; }
      return [
        [S.sizeLabel, fmt(S.sizeOption, { n: st.size })],
        [S.timerDraftLabel, tval(st.timerDraft)],
        [S.timerMoveLabel, tval(st.timerMove)],
        [S.timerActionLabel, tval(st.timerAction)],
        [S.lockLabel, st.lockCommit ? S.lockOn : S.lockOff],
        [S.fleetsLabel, st.fleetPublic ? S.fleetsPublic : S.fleetsSecret],
      ];
    },
  });
  var el = TBL.el, load = TBL.load, save = TBL.save, fmt = TBL.fmt;
  var toast = TBL.toast, seatDot = TBL.seatDot;
  var mySeat = TBL.mySeat, seatName = TBL.seatName;
  function send(msg) { TBL.send(msg); }
  function render() { TBL.render(); }

  function teamName(k) { return k === 0 ? S.teamWest : S.teamEast; }

  /* ── game-view accessors ─────────────────────────────────────── */
  function you() { return (model && model.you) || {}; }
  function isSpectator() { return !!you().spectator; }
  function myTeam() { return isSpectator() ? null : you().team; }
  function myShips() { return you().ships || []; }
  function inGame() { return model && model.phase !== "lobby" && model.phase !== "over"; }
  function committedMine() { return !isSpectator() && model.committed && model.committed[myTeam()]; }
  function isCaptain() {
    return !isSpectator() && model.captains && model.captains[myTeam()] === mySeat();
  }
  function perSeat() {
    var n = (model.seats || []).length / 2;
    return n ? (model.fleetSize || 3) / n : 0;
  }
  function seatColor(seat) {
    var s = model.seats && model.seats[seat];
    return (s && s.color) || "#888888";
  }
  function teamColorOf(team) {
    var seats = model.seats || [];
    for (var i = 0; i < seats.length; i++) if (seats[i].team === team) return seats[i].color;
    return "#888888";
  }
  function amReady() { return !isSpectator() && model.ready && model.ready[mySeat()]; }
  function shipOwnerVisible() { return (model.seats || []).length > 2; }   // names only matter with teammates

  /* ── local planning state ────────────────────────────────────────
     Uncommitted plans never leave this client until Ready stages them.
     Reset when the phase turns over; seeded back from you.plans (the
     staged set) after a reconnect. */
  var plan = { key: null, moves: {}, acts: {}, slots: [], cur: null,
               sel: null, act: null, aimDir: null, heading: null };
  var histView = null;               // null = live; else index into the calendar
  var guide = { open: false, tab: "phases" };

  function phaseKey() { return model ? model.phase + ":" + model.round : "-"; }
  function resetPlan() {
    plan.key = phaseKey();
    plan.moves = {}; plan.acts = {}; plan.slots = []; plan.cur = null;
    plan.sel = null; plan.act = null; plan.aimDir = null; plan.heading = null;
    if (model && model.phase === "draft" && !isSpectator()) {
      for (var i = 0; i < perSeat(); i++) plan.slots.push({ step: "class" });
      plan.cur = 0;
    }
    seedFromStaged();
  }
  function seedFromStaged() {
    var p = you().plans;
    if (!p) return;
    if (p.moves) plan.moves = JSON.parse(JSON.stringify(p.moves));
    if (p.acts) plan.acts = JSON.parse(JSON.stringify(p.acts));
    if (p.ships) {
      plan.slots = p.ships.map(function (sh) {
        return { step: "done", cls: sh.cls, x: sh.x, y: sh.y, dir: sh.dir, weapon: sh.weapon };
      });
      plan.cur = null;
    }
  }
  function syncPlan() {
    if (!model) return;
    if (plan.key !== phaseKey()) { resetPlan(); histView = null; }
    if (plan.sel && !myShips().some(function (s) { return s.id === plan.sel && !s.sunk; })) {
      plan.sel = null; plan.act = null;
    }
    if (histView != null && histView >= calendar().length) histView = null;
  }
  function resetGameUi() {
    plan.key = null; histView = null; guide.open = false;
    resetPlan();
  }

  /* ── events → toasts (the calendar is the record; toasts are the
     narration). news envelopes are per-team and pre-masked. ───────── */
  function shipCls(id) {
    var all = isSpectator() ? (you().ships[0] || []).concat(you().ships[1] || []) : myShips();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return CLS_NAME[all[i].cls] || all[i].cls;
    return "";
  }
  function handleEvent(e) {
    if (e.t === "news" && e.items) {
      e.items.forEach(function (it) {
        if (it.k === "held") toast(S.heldToast, "warn");
        else if (it.k === "corked") toast(S.corkedToast, "warn");
        else if (it.k === "disarmed") toast(fmt(S.disarmedToast, { cls: shipCls(it.ship) }), "error");
        else if (it.k === "swept") toast(S.sweptToast, "warn");
        else if (it.k === "struck") toast(fmt(S.struckToast, { cls: shipCls(it.ship) }), "warn");
      });
      return;
    }
    if (e.t === "sunk") {
      var mine = !isSpectator() && e.team === myTeam();
      toast(fmt(mine ? S.sunkToastOwn : S.sunkToastEnemy, { cls: CLS_NAME[e.cls] || e.cls }), mine ? "error" : "success");
    }
  }

  /* ═══ RENDER ═══════════════════════════════════════════════════ */
  function paint() {
    renderBig();
    renderPhase();
    renderPlayers();
    renderCalendar();
    renderRole();
  }

  /* ── the calendar's data (players get their team's; spectators get
     both merged) ─────────────────────────────────────────────────── */
  function calendar() {
    if (!model || model.phase === "lobby") return [];
    var h = you().history;
    if (!h) return [];
    if (!isSpectator()) return h;
    var out = [];
    var n = Math.max((h[0] || []).length, (h[1] || []).length);
    for (var i = 0; i < n; i++) {
      var a = (h[0] || [])[i], b = (h[1] || [])[i];
      out.push({
        round: (a || b).round,
        ships: ((a && a.ships) || []).concat((b && b.ships) || []),
        marks: ((a && a.marks) || []).concat((b && b.marks) || []),
      });
    }
    return out;
  }
  function liveBoardData() {
    if (isSpectator()) {
      return {
        ships: (you().ships ? you().ships[0].concat(you().ships[1]) : []),
        marks: (you().marks ? you().marks[0].concat(you().marks[1]) : []),
      };
    }
    return { ships: myShips(), marks: you().marks || [] };
  }

  /* ── the big tile ────────────────────────────────────────────── */
  function renderBig() {
    BIG.textContent = "";
    BIG.classList.toggle("is-history", histView != null);
    if (model.phase === "lobby") { TBL.renderLobby(BIG); return; }
    if (model.phase === "over" && histView == null) { renderOver(); buildGuide(); return; }
    var data = histView != null ? calendar()[histView] : liveBoardData();
    if (!data) { histView = null; data = liveBoardData(); }
    BIG.appendChild(buildBoard(data, histView == null));
    if (histView != null) {
      BIG.appendChild(el("div", "ships-histnote",
        fmt(S.calendarNote, { n: calendar()[histView].round })));
    }
    buildGuide();
  }

  /* ── the ocean ───────────────────────────────────────────────── */
  function px(t) { return t * CS; }
  function center(t) { return t * CS + CS / 2; }
  function tileRect(x, y, cls, attrs) {
    var r = svgEl("rect", Object.assign({
      x: px(x) + 1, y: px(y) + 1, width: CS - 2, height: CS - 2, rx: 4, class: cls,
    }, attrs || {}));
    return r;
  }
  function hullRect(sh, cls, fill) {
    var tiles = Engine.tilesOf(sh);
    var xs = tiles.map(function (t) { return t.x; }), ys = tiles.map(function (t) { return t.y; });
    var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
    var x1 = Math.max.apply(null, xs), y1 = Math.max.apply(null, ys);
    var r = svgEl("rect", {
      x: px(x0) + 3, y: px(y0) + 3,
      width: px(x1 - x0 + 1) - 6, height: px(y1 - y0 + 1) - 6,
      rx: CS * 0.4, class: cls,
    });
    if (fill) r.setAttribute("fill", fill);
    return r;
  }

  function buildBoard(data, live) {
    var svg = svgEl("svg", { class: "ships-board", viewBox: "0 0 " + (BOARD * CS) + " " + (BOARD * CS) });
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: BOARD * CS, height: BOARD * CS, class: "ships-board__sea" }));
    // home-band tint while drafting (yours only — the enemy's is their business)
    if (live && model.phase === "draft" && !isSpectator()) {
      var bx = myTeam() === 0 ? 0 : BOARD - Engine.BAND;
      svg.appendChild(svgEl("rect", { x: px(bx), y: 0, width: px(Engine.BAND), height: BOARD * CS, class: "ships-board__band" }));
    }
    for (var i = 0; i <= BOARD; i++) {
      svg.appendChild(svgEl("line", { x1: px(i), y1: 0, x2: px(i), y2: BOARD * CS, class: "ships-board__line" }));
      svg.appendChild(svgEl("line", { x1: 0, y1: px(i), x2: BOARD * CS, y2: px(i), class: "ships-board__line" }));
    }

    drawMarks(svg, data.marks || []);

    // public wrecks (live view; historical entries carry their own sunk hulls)
    if (live) {
      (model.wrecks || []).forEach(function (w) {
        svg.appendChild(hullRect({ x: w.tiles[0].x, y: w.tiles[0].y, dir: wreckDir(w.tiles), cls: w.cls }, "ships-wreck"));
      });
    }

    (data.ships || []).forEach(function (sh) { drawShip(svg, sh, live); });

    if (live) drawPlanOverlay(svg);
    if (live) drawTargets(svg);
    return svg;
  }
  function wreckDir(tiles) {
    if (tiles.length < 2) return 0;
    return tiles[1].x !== tiles[0].x ? (tiles[1].x > tiles[0].x ? 0 : 2) : (tiles[1].y > tiles[0].y ? 1 : 3);
  }

  function drawShip(svg, sh, live) {
    if (sh.sunk) { svg.appendChild(hullRect(sh, "ships-wreck")); return; }
    var g = svgEl("g", {});
    var isSub = sh.cls === "submarine";
    g.appendChild(hullRect(sh, "ships-hull" + (isSub ? " ships-hull--sub" : ""), seatColor(sh.seat)));
    var tiles = Engine.tilesOf(sh);
    tiles.forEach(function (t, ti) {
      if (sh.dmg[ti]) g.appendChild(tileRect(t.x, t.y, "ships-hull__dmg"));
    });
    // the weapon section: a colored circle, teammate view only (the data
    // only exists in your own team's `you`, so drawing it never leaks)
    var m = tiles[sh.weapon];
    if (m) g.appendChild(svgEl("circle", { cx: center(m.x), cy: center(m.y), r: CS * 0.22, class: "ships-hull__mount" }));
    if (shipOwnerVisible()) {
      var xs = tiles.map(function (t) { return t.x; }), ys = tiles.map(function (t) { return t.y; });
      var tx = (Math.min.apply(null, xs) + Math.max.apply(null, xs) + 1) / 2 * CS;
      var ty = (Math.max.apply(null, ys) + 1) * CS + 10;
      if (ty > BOARD * CS - 2) ty = Math.min.apply(null, ys) * CS - 4;
      var name = svgEl("text", { x: tx, y: ty, "text-anchor": "middle", class: "ships-hull__name" });
      name.textContent = seatName(sh.seat);
      g.appendChild(name);
    }
    if (live && plan.sel === sh.id) {
      g.appendChild(hullRect(sh, "ships-selring"));
    }
    // selecting your ship on the board = selecting it in the list
    if (live && !isSpectator() && sh.seat === mySeat() && !committedMine() && inGame() && model.phase !== "draft") {
      g.style.cursor = "pointer";
      g.addEventListener("click", function () { plan.sel = sh.id; plan.act = null; plan.heading = null; render(); });
    }
    svg.appendChild(g);
  }

  function drawMarks(svg, marks) {
    marks.forEach(function (m) {
      if (m.k === "phantom") {
        (m.tiles || []).forEach(function (t) { svg.appendChild(tileRect(t.x, t.y, "ships-mark--phantom")); });
      } else if (m.k === "sweep") {
        var xs = m.tiles.map(function (t) { return t.x; }), ys = m.tiles.map(function (t) { return t.y; });
        svg.appendChild(svgEl("rect", {
          x: px(Math.min.apply(null, xs)) + 2, y: px(Math.min.apply(null, ys)) + 2,
          width: px(Math.max.apply(null, xs) - Math.min.apply(null, xs) + 1) - 4,
          height: px(Math.max.apply(null, ys) - Math.min.apply(null, ys) + 1) - 4,
          class: "ships-mark--sweepbox",
        }));
      } else if (m.k === "lane") {
        if (!m.tiles || !m.tiles.length) return;
        var a = m.tiles[0], b = m.tiles[m.tiles.length - 1];
        svg.appendChild(svgEl("line", { x1: center(a.x), y1: center(a.y), x2: center(b.x), y2: center(b.y), class: "ships-mark--lane" }));
      } else if (m.k === "hit") {
        var c = CS * 0.28;
        svg.appendChild(svgEl("line", { x1: center(m.x) - c, y1: center(m.y) - c, x2: center(m.x) + c, y2: center(m.y) + c, class: "ships-mark--hit" }));
        svg.appendChild(svgEl("line", { x1: center(m.x) - c, y1: center(m.y) + c, x2: center(m.x) + c, y2: center(m.y) - c, class: "ships-mark--hit" }));
      } else if (m.k === "reveal") {
        svg.appendChild(svgEl("circle", { cx: center(m.x), cy: center(m.y), r: CS * 0.34, class: "ships-mark--reveal" }));
      } else if (m.k === "bearing") {
        // the 8-direction compass glyph: an arrow at the anchor, aimed at the fog
        var ang = DIR8_ANGLE[m.dir] || 0;
        var cx = center(m.x), cy = center(m.y), r2 = CS * 0.4;
        var p = svgEl("polygon", {
          points: [cx + "," + (cy - r2), (cx - r2 * 0.5) + "," + (cy + r2 * 0.55), cx + "," + (cy + r2 * 0.2), (cx + r2 * 0.5) + "," + (cy + r2 * 0.55)].join(" "),
          class: "ships-mark--bearing",
          transform: "rotate(" + ang + " " + cx + " " + cy + ")",
        });
        svg.appendChild(p);
      } else if (m.k === "plane" || m.k === "zone") {
        (m.zone || []).forEach(function (t) { svg.appendChild(tileRect(t.x, t.y, "ships-mark--zone")); });
      }
    });
  }

  /* staged-plan previews: ghosts of what Ready will send */
  function drawPlanOverlay(svg) {
    if (isSpectator() || !inGame()) return;
    if (model.phase === "draft") {
      plan.slots.forEach(function (sl) {
        if (sl.step === "mount" || sl.step === "done") {
          svg.appendChild(hullRect({ x: sl.x, y: sl.y, dir: sl.dir, cls: sl.cls }, "ships-ghost"));
          if (sl.step === "done" && sl.weapon != null) {
            var t = Engine.tilesOf({ x: sl.x, y: sl.y, dir: sl.dir, cls: sl.cls })[sl.weapon];
            svg.appendChild(svgEl("circle", { cx: center(t.x), cy: center(t.y), r: CS * 0.22, class: "ships-hull__mount" }));
          }
        }
      });
      return;
    }
    myShips().forEach(function (sh) {
      if (sh.sunk) return;
      var mv = model.phase === "move" ? plan.moves[sh.id] : null;
      var act = model.phase === "action" ? plan.acts[sh.id] : null;
      if (mv) svg.appendChild(hullRect({ x: mv.x, y: mv.y, dir: mv.dir, cls: sh.cls }, "ships-ghost"));
      if (act) {
        var from = Engine.mountTile(sh);
        if (act.type === "move") svg.appendChild(hullRect({ x: act.to.x, y: act.to.y, dir: act.to.dir, cls: sh.cls }, "ships-ghost"));
        else if (act.type === "sonar") {
          var area = Engine.sweepTiles(from);
          var xs = area.map(function (t) { return t.x; }), ys = area.map(function (t) { return t.y; });
          svg.appendChild(svgEl("rect", {
            x: px(Math.min.apply(null, xs)) + 2, y: px(Math.min.apply(null, ys)) + 2,
            width: px(Math.max.apply(null, xs) - Math.min.apply(null, xs) + 1) - 4,
            height: px(Math.max.apply(null, ys) - Math.min.apply(null, ys) + 1) - 4,
            class: "ships-mark--sweepbox", stroke: "var(--sh-ghost)",
          }));
        } else if (act.type === "fire" || act.type === "surface") {
          if (CLASSES[sh.cls].attack === "plane" && act.dist != null) {
            Engine.planeZone(from, act.dir, act.dist).forEach(function (t) {
              var r = tileRect(t.x, t.y, "ships-ghost");
              svg.appendChild(r);
            });
          } else {
            var lane = Engine.laneTiles(from, act.dir, CLASSES[sh.cls].range || 1);
            if (lane.length) {
              svg.appendChild(svgEl("line", {
                x1: center(from.x), y1: center(from.y),
                x2: center(lane[lane.length - 1].x), y2: center(lane[lane.length - 1].y),
                class: "ships-mark--lane", stroke: "var(--sh-ghost)",
              }));
            }
          }
        }
      }
    });
  }

  /* the lit tiles: every valid target for the current selection */
  function litTile(svg, x, y, onPick) {
    var r = tileRect(x, y, "ships-lit");
    r.addEventListener("click", onPick);
    svg.appendChild(r);
  }
  function avoidForMine(ship) {
    // my own staged endpoints + teammates' current hulls (their plans are
    // theirs — coordination is on voice); the server re-checks anyway
    var out = [];
    myShips().forEach(function (o) {
      if (o.sunk || o.id === ship.id) return;
      if ((o.cls === "submarine") !== (ship.cls === "submarine")) return;
      var mv = o.seat === mySeat() ? plan.moves[o.id] : null;
      out.push(Engine.tilesOf({ x: mv ? mv.x : o.x, y: mv ? mv.y : o.y, dir: mv ? mv.dir : o.dir, cls: o.cls }));
    });
    return out;
  }
  function draftAvoid(slotIdx, sub) {
    var out = [];
    plan.slots.forEach(function (sl, i) {
      if (i === slotIdx || sl.x == null) return;
      if ((sl.cls === "submarine") !== sub) return;
      out.push(Engine.tilesOf({ x: sl.x, y: sl.y, dir: sl.dir, cls: sl.cls }));
    });
    return out;
  }
  function drawTargets(svg) {
    if (isSpectator() || committedMine() || !inGame() || amReady()) return;
    if (model.phase === "draft") {
      var sl = plan.cur != null ? plan.slots[plan.cur] : null;
      if (!sl) return;
      if (sl.step === "place") {
        var len = CLASSES[sl.cls].len, sub = sl.cls === "submarine";
        var avoid = draftAvoid(plan.cur, sub);
        for (var x = 0; x < BOARD; x++) {
          for (var y = 0; y < BOARD; y++) {
            var p = { x: x, y: y, dir: sl.dir, cls: sl.cls };
            var tl = Engine.tilesOf(p, len);
            if (!Engine.inHomeBand(myTeam(), tl)) continue;
            if (!tl.every(function (t) { return Engine.inBounds(t.x, t.y); })) continue;
            var clash = avoid.some(function (o) {
              var set = {};
              o.forEach(function (t) { set[t.x + "," + t.y] = 1; });
              return tl.some(function (t) { return set[t.x + "," + t.y]; });
            });
            if (clash) continue;
            (function (xx, yy) {
              litTile(svg, xx, yy, function () { sl.x = xx; sl.y = yy; sl.step = "mount"; render(); });
            })(x, y);
          }
        }
      } else if (sl.step === "mount") {
        Engine.tilesOf({ x: sl.x, y: sl.y, dir: sl.dir, cls: sl.cls }).forEach(function (t, ti) {
          litTile(svg, t.x, t.y, function () {
            sl.weapon = ti; sl.step = "done";
            plan.cur = nextOpenSlot();
            render();
          });
        });
      }
      return;
    }
    var ship = selShip();
    if (!ship) return;
    if ((model.phase === "move" && plan.act !== "pass") ||
        (model.phase === "action" && plan.act === "secondmove")) {
      var heading = plan.heading != null ? plan.heading : ship.dir;
      Engine.legalEndpoints(ship, avoidForMine(ship)).forEach(function (p) {
        if (p.dir !== heading) return;
        litTile(svg, p.x, p.y, function () {
          if (model.phase === "move") plan.moves[ship.id] = { x: p.x, y: p.y, dir: p.dir };
          else plan.acts[ship.id] = { type: "move", to: { x: p.x, y: p.y, dir: p.dir } };
          render();
        });
      });
      return;
    }
    if (model.phase === "action" && plan.act === "fire" &&
        CLASSES[ship.cls].attack === "plane" && plan.aimDir != null) {
      var from = Engine.mountTile(ship);
      for (var dist = 1; dist < BOARD * 2; dist++) {
        var zone = Engine.planeZone(from, plan.aimDir, dist);
        if (!zone.length) break;
        var d = DIRS[plan.aimDir];
        var sx = from.x + d.x * dist, sy = from.y + d.y * dist;
        if (!Engine.inBounds(sx, sy)) break;
        (function (dd) {
          litTile(svg, sx, sy, function () {
            plan.acts[ship.id] = { type: "fire", dir: plan.aimDir, dist: dd };
            plan.act = null; plan.aimDir = null;
            render();
          });
        })(dist);
      }
    }
  }
  function selShip() {
    var list = myShips();
    for (var i = 0; i < list.length; i++) if (list[i].id === plan.sel) return list[i];
    return null;
  }
  function nextOpenSlot() {
    for (var i = 0; i < plan.slots.length; i++) if (plan.slots[i].step !== "done") return i;
    return null;
  }

  /* ── the Guide: bottom-left of the board, cities' odds geometry ── */
  function buildGuide() {
    var row = el("div", "ships-boardbtns");
    var pop = el("div", "ships-bpop" + (guide.open ? " is-open" : ""));
    pop.appendChild(el("h3", "ships-guide__title", S.guideTitle));
    var tabs = el("div", "ships-guide__tabs");
    [["phases", S.guideTabPhases], ["ships", S.guideTabShips],
     ["actions", S.guideTabActions], ["intel", S.guideTabIntel]].forEach(function (t) {
      tabs.appendChild(TBL.chip(t[1], guide.tab === t[0], false, function () {
        guide.tab = t[0]; render();
      }));
    });
    pop.appendChild(tabs);
    var body = el("div", "ships-guide__body");
    if (guide.tab === "phases") {
      body.appendChild(el("p", null, S.guidePhases));
      body.appendChild(el("p", null, S.guidePhasesDraft));
    } else if (guide.tab === "ships") {
      body.appendChild(el("p", null, S.guideShips));
      body.appendChild(classTable());
    } else if (guide.tab === "actions") {
      body.appendChild(el("p", null, S.guideActions));
    } else {
      body.appendChild(el("p", null, S.guideIntel));
    }
    pop.appendChild(body);
    BIG.appendChild(pop);
    var b = el("button", "tb-pill");
    b.type = "button";
    b.setAttribute("aria-expanded", guide.open ? "true" : "false");
    b.appendChild(el("span", "tb-pill__label", S.guideButton));
    b.addEventListener("click", function () { guide.open = !guide.open; render(); });
    row.appendChild(b);
    BIG.appendChild(row);
  }
  function classTable() {
    var t = el("table", "ships-guide__table");
    var hr = el("tr");
    [S.guideColClass, S.guideColLen, S.guideColMove, S.guideColRange].forEach(function (h) {
      hr.appendChild(el("th", null, h));
    });
    t.appendChild(hr);
    Engine.CLASS_LIST.forEach(function (c) {
      var cl = CLASSES[c], r = el("tr");
      r.appendChild(el("td", null, CLS_NAME[c] || c));
      r.appendChild(el("td", null, String(cl.len)));
      r.appendChild(el("td", null, String(cl.move)));
      r.appendChild(el("td", null, cl.attack === "plane" ? S.guideRangeBoard : String(cl.range)));
      t.appendChild(r);
    });
    return t;
  }

  /* ── phase tile (the dice slot) ──────────────────────────────── */
  function renderPhase() {
    PHASE.textContent = "";
    if (model.phase === "lobby") {
      PHASE.appendChild(el("div", "ships-phase__round", S.lobbyTitle));
      PHASE.appendChild(el("div", "ships-phase__name", fmt(S.sizeOption, { n: (model.settings && model.settings.size) || 1 })));
      return;
    }
    if (model.phase === "over") {
      PHASE.appendChild(el("div", "ships-phase__name", S.gameOver));
      return;
    }
    PHASE.appendChild(el("div", "ships-phase__round",
      model.round === 0 ? S.phaseTurnZero : fmt(S.phaseRound, { n: model.round })));
    var pname = { draft: S.phaseDraft, move: S.phaseMove, action: S.phaseAction }[model.phase] || model.phase;
    PHASE.appendChild(el("div", "ships-phase__name", pname));
    if (model.settings && (model.settings.timerDraft || model.settings.timerMove || model.settings.timerAction)) {
      PHASE.appendChild(TBL.timerText(el("div", "ships-phase__clock")));
    }
    var sides = el("div", "ships-phase__sides");
    [0, 1].forEach(function (team) {
      var row = el("div", "ships-phase__side" + (model.committed && model.committed[team] ? " is-in" : ""));
      var dot = el("span", "gt-dot");
      dot.style.background = teamColorOf(team);
      row.appendChild(dot);
      row.appendChild(el("span", null,
        model.committed && model.committed[team]
          ? fmt(S.sideReady, { side: teamName(team) })
          : fmt(S.sideWaiting, { side: teamName(team) })));
      sides.appendChild(row);
    });
    PHASE.appendChild(sides);
  }

  /* ── players tile: the readiness board ───────────────────────── */
  function renderPlayers() {
    PLAYERS.textContent = "";
    var seats = model.seats || [];
    [0, 1].forEach(function (team) {
      var box = el("div", "ships-pteam");
      var head = el("div", "ships-pteam__head");
      var dot = el("span", "gt-dot");
      dot.style.background = teamColorOf(team);
      head.appendChild(dot);
      head.appendChild(el("span", null, teamName(team)));
      if (inGame() && model.alive) head.appendChild(el("span", null, "· " + model.alive[team] + "/" + (model.fleetSize || "")));
      box.appendChild(head);
      seats.forEach(function (s, i) {
        if (s.team !== team || s.empty) return;
        var strip = el("div", "ships-pstrip");
        TBL.seatAccent(strip, i);
        var nm = s.phantom ? fmt(S.botSeatTag, { name: s.name }) : s.name;
        if (i === mySeat()) nm = fmt(S.seatYou, { name: s.name });
        strip.appendChild(el("span", "ships-pstrip__name", nm));
        if (model.captains && model.captains[team] === i) strip.appendChild(el("span", "ships-pstrip__cap", S.captainBadge));
        if (!s.connected && !s.phantom) strip.appendChild(el("span", "ships-pstrip__away", S.disconnected));
        if (inGame() && model.ready && model.ready[i]) {
          var rd = el("span", "ships-pstrip__ready", "✓");
          rd.title = S.readyMark;
          strip.appendChild(rd);
        }
        box.appendChild(strip);
      });
      PLAYERS.appendChild(box);
    });
  }

  /* ── the calendar (log tile) ─────────────────────────────────── */
  function renderCalendar() {
    LOG.textContent = "";
    LOG.appendChild(el("div", "ships-cal__head", S.calendarTitle));
    var entries = calendar();
    if (!entries.length) {
      LOG.appendChild(el("div", "ships-cal__empty", S.calendarEmpty));
      return;
    }
    var grid = el("div", "ships-cal__grid");
    var live = el("button", "ships-cal__cell" + (histView == null ? " is-current" : ""), S.calendarLive);
    live.type = "button";
    live.addEventListener("click", function () { histView = null; render(); });
    grid.appendChild(live);
    entries.forEach(function (entry, i) {
      var c = el("button", "ships-cal__cell" + (histView === i ? " is-current" : ""),
        fmt(S.calendarTurn, { n: entry.round }));
      c.type = "button";
      c.addEventListener("click", function () { histView = i; render(); });
      grid.appendChild(c);
    });
    LOG.appendChild(grid);
  }

  /* ── the planning surface (role tile) ────────────────────────── */
  function renderRole() {
    ROLE.textContent = "";
    if (model.phase === "lobby") return;
    if (isSpectator()) { ROLE.appendChild(el("p", "ships-plan__note", S.spectatingNote)); return; }
    if (model.phase === "over") return;

    var wrap = el("div", "ships-plan");
    var left = el("div");
    left.appendChild(el("div", "ships-plan__head", S.yourShips));
    var fleet = el("div", "ships-fleet");
    left.appendChild(fleet);
    var right = el("div", "ships-plan__ctrl");
    wrap.appendChild(left);
    wrap.appendChild(right);
    ROLE.appendChild(wrap);

    if (model.phase === "draft") { renderDraft(fleet, right); }
    else { renderPlanning(fleet, right); }

    ROLE.appendChild(commitRow());
  }

  function shipButton(label, meta, seat, selected, disabled, onClick) {
    var b = el("button", "ships-shipbtn" + (selected ? " is-sel" : ""));
    b.type = "button"; b.disabled = !!disabled;
    if (seat != null) TBL.seatAccent(b, seat);
    b.appendChild(el("span", "ships-shipbtn__cls", label));
    if (meta) b.appendChild(el("span", "ships-shipbtn__meta", meta));
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function chipRow(into, items) {
    var row = el("div", "ships-plan__row");
    items.forEach(function (it) { row.appendChild(TBL.chip(it[0], !!it[2], !!it[3], it[1])); });
    into.appendChild(row);
    return row;
  }

  /* draft: slots → class → placement → mount */
  function renderDraft(fleet, right) {
    var frozen = amReady() || committedMine();
    plan.slots.forEach(function (sl, i) {
      var label = sl.cls ? (CLS_NAME[sl.cls] || sl.cls) : fmt(S.draftSlot, { n: i + 1 });
      var meta = sl.step === "done" ? S.draftDone
        : sl.step === "class" ? S.draftPickClass
        : sl.step === "place" ? S.draftPlace : S.draftMount;
      fleet.appendChild(shipButton(label, meta, mySeat(), plan.cur === i, frozen, function () {
        plan.cur = i; render();
      }));
    });
    if (frozen) { right.appendChild(el("p", "ships-plan__note", amReady() ? S.committedNote : "")); return; }
    var sl = plan.cur != null ? plan.slots[plan.cur] : null;
    if (!sl) { right.appendChild(el("p", "ships-plan__hint", S.noShipsYet)); return; }
    if (sl.step === "class") {
      right.appendChild(el("p", "ships-plan__hint", S.draftPickClass));
      var mine = {};
      plan.slots.forEach(function (o) { if (o.cls) mine[o.cls] = 1; });
      chipRow(right, Engine.CLASS_LIST.filter(function (c) { return !mine[c]; }).map(function (c) {
        return [CLS_NAME[c] || c, function () { sl.cls = c; sl.dir = 1; sl.step = "place"; render(); }];
      }));
      return;
    }
    right.appendChild(el("p", "ships-plan__hint", sl.step === "place" ? S.draftPlace : S.draftMount));
    var rowItems = [];
    if (sl.step === "place") {
      rowItems.push([S.draftRotate, function () { sl.dir = (sl.dir + 1) % 4; render(); }]);
    }
    rowItems.push([S.draftRedo, function () {
      plan.slots[plan.cur] = { step: "class" };
      render();
    }]);
    chipRow(right, rowItems);
  }

  /* move + action planning */
  function actLabel(ship) {
    if (model.phase === "move") {
      return plan.moves[ship.id] ? S.actStagedMove : S.actStagedHold;
    }
    var a = plan.acts[ship.id];
    if (!a) return S.actStagedPass;
    if (a.type === "move") return S.actStagedMove;
    if (a.type === "sonar") return S.actStagedSonar;
    if (a.type === "pass") return S.actStagedPass;
    if (a.type === "surface") return fmt(S.actStagedSurface, { dir: DIR_NAME[a.dir] });
    if (a.dist != null) return fmt(S.actStagedZone, { n: a.dist });
    return fmt(S.actStagedFire, { dir: DIR_NAME[a.dir] });
  }
  function dmgPips(ship) {
    var span = el("span", "ships-shipbtn__pips");
    ship.dmg.forEach(function (d) { span.appendChild(el("span", "ships-pip" + (d ? " is-dmg" : ""))); });
    return span;
  }
  function renderPlanning(fleet, right) {
    var frozen = amReady() || committedMine();
    myShips().forEach(function (sh) {
      if (sh.seat !== mySeat()) {
        // a teammate's ship: visible, never orderable from this seat
        var b = shipButton(CLS_NAME[sh.cls] || sh.cls, seatName(sh.seat), sh.seat, false, true, null);
        b.insertBefore(dmgPips(sh), b.firstChild.nextSibling);
        fleet.appendChild(b);
        return;
      }
      var meta = sh.sunk ? S.sunkTag : (Engine.disarmed(sh) ? S.disarmedTag + " " : "") + actLabel(sh);
      var btn = shipButton(CLS_NAME[sh.cls] || sh.cls, meta, sh.seat, plan.sel === sh.id, sh.sunk || frozen, function () {
        plan.sel = sh.id; plan.act = null; plan.aimDir = null; plan.heading = null; render();
      });
      btn.insertBefore(dmgPips(sh), btn.firstChild.nextSibling);
      fleet.appendChild(btn);
    });
    if (frozen) { right.appendChild(el("p", "ships-plan__note", S.committedNote)); return; }
    var ship = selShip();
    if (!ship) { right.appendChild(el("p", "ships-plan__hint", model.phase === "move" ? S.actMoveHint : S.actAimHint)); return; }

    if (model.phase === "move") { moveControls(right, ship, false); return; }

    /* action phase: the ship's menu */
    var cls = CLASSES[ship.cls];
    var items = [];
    if (!Engine.disarmed(ship)) {
      items.push([S.actFire, function () { plan.act = "fire"; plan.aimDir = null; render(); }, plan.act === "fire"]);
      if (cls.special === "sonar") items.push([S.actSonar, function () { plan.acts[ship.id] = { type: "sonar" }; plan.act = null; render(); }]);
      if (ship.cls === "submarine") items.push([S.actSurface, function () { plan.act = "surface"; render(); }, plan.act === "surface"]);
    }
    if (cls.special === "move") items.push([S.actSecondMove, function () { plan.act = "secondmove"; plan.heading = null; render(); }, plan.act === "secondmove"]);
    items.push([S.actPass, function () { plan.acts[ship.id] = { type: "pass" }; plan.act = null; render(); }]);
    chipRow(right, items);

    if (plan.act === "fire" || plan.act === "surface") {
      right.appendChild(el("p", "ships-plan__hint", S.actAimHint));
      chipRow(right, DIR_ORDER.filter(function (d) { return Engine.fireDirs(ship).indexOf(d) >= 0; }).map(function (d) {
        return [DIR_NAME[d], function () {
          if (plan.act === "surface") { plan.acts[ship.id] = { type: "surface", dir: d }; plan.act = null; }
          else if (cls.attack === "plane") { plan.aimDir = d; }
          else { plan.acts[ship.id] = { type: "fire", dir: d }; plan.act = null; }
          render();
        }, plan.aimDir === d];
      }));
      if (cls.attack === "plane" && plan.aimDir != null) {
        right.appendChild(el("p", "ships-plan__hint", S.actZoneHint));
      }
    }
    if (plan.act === "secondmove") moveControls(right, ship, true);
  }
  function moveControls(right, ship, second) {
    var eps = Engine.legalEndpoints(ship, avoidForMine(ship));
    var dirs = [];
    DIR_ORDER.forEach(function (d) {
      if (eps.some(function (p) { return p.dir === d; })) dirs.push(d);
    });
    right.appendChild(el("p", "ships-plan__hint", S.actMoveHint));
    var heading = plan.heading != null ? plan.heading : ship.dir;
    var items = dirs.map(function (d) {
      return [DIR_NAME[d], function () { plan.heading = d; render(); }, heading === d];
    });
    items.push([S.actHold, function () {
      if (second) { plan.acts[ship.id] = { type: "pass" }; plan.act = null; }
      else delete plan.moves[ship.id];
      render();
    }]);
    chipRow(right, items);
  }

  /* Ready / Commit — pass eleven's staging model */
  function commitRow() {
    var row = el("div", "ships-plan__commitrow");
    var ready = amReady();
    var committed = committedMine();
    if (!committed) {
      var rp = TBL.pill(ready ? S.unreadyPill : S.readyPill, function () {
        if (ready) { send({ type: "unstage" }); return; }
        var plans = buildPlans();
        if (!plans) return;
        send({ type: "stage", plans: plans });
      });
      if (!ready && model.phase === "draft" && nextOpenSlot() != null) rp.disabled = true;
      row.appendChild(rp);
    }
    if (isCaptain()) {
      if (!committed) {
        row.appendChild(TBL.pill(S.commitPill, function () { send({ type: "commit" }); }));
      } else if (!(model.settings && model.settings.lockCommit)) {
        row.appendChild(TBL.pill(S.uncommitPill, function () { send({ type: "uncommit" }); }));
      }
    }
    if (committed) row.appendChild(el("span", "ships-plan__hint", S.committedNote));
    else if (ready && !isCaptain()) row.appendChild(el("span", "ships-plan__hint", S.waitingCaptain));
    return row;
  }
  function buildPlans() {
    if (model.phase === "draft") {
      return { ships: plan.slots.map(function (sl) {
        return { cls: sl.cls, x: sl.x, y: sl.y, dir: sl.dir, weapon: sl.weapon };
      }) };
    }
    if (model.phase === "move") return { moves: plan.moves };
    return { acts: plan.acts };
  }

  /* ── game over ───────────────────────────────────────────────── */
  function renderOver() {
    var over = model.over || {};
    var wrap = el("div", "ships-over");
    var title = el("h2", "ships-over__title");
    title.appendChild(el("span", null, S.gameOver));
    title.appendChild(el("span", "ships-over__turns", fmt(S.turnCount, { n: over.turns || model.round || 0 })));
    wrap.appendChild(title);
    var line = el("p", "ships-over__winner");
    if (over.winner == null) line.appendChild(el("span", null, S.drawLine));
    else {
      var dot = el("span", "gt-dot");
      dot.style.background = teamColorOf(over.winner);
      line.appendChild(dot);
      line.appendChild(el("span", null, fmt(S.winnerLine, { side: teamName(over.winner) })));
    }
    wrap.appendChild(line);
    var t = el("table", "ships-over__table");
    var hr = el("tr");
    [""].concat([S.statShots, S.statHits, S.statSunk]).forEach(function (h) { hr.appendChild(el("th", null, h)); });
    t.appendChild(hr);
    (model.seats || []).forEach(function (s, i) {
      if (s.empty) return;
      var st = (over.seatStats || [])[i] || {};
      var r = el("tr");
      var nameCell = el("td");
      nameCell.appendChild(seatDot(i));
      nameCell.appendChild(el("span", null, " " + s.name));
      r.appendChild(nameCell);
      [st.shots, st.hits, st.sunk].forEach(function (v) { r.appendChild(el("td", null, String(v == null ? 0 : v))); });
      t.appendChild(r);
    });
    wrap.appendChild(t);
    if (model.host) {
      var rm = TBL.pill(S.rematchButton, function () { send({ type: "rematch" }); });
      rm.classList.add("gt-lobby__start");
      wrap.appendChild(rm);
    }
    BIG.appendChild(wrap);
  }

  /* ── lobby settings (host chips; the shell adds the rejoin row) ── */
  function lobbySettings(wrap) {
    var st = model.settings || {};
    wrap.appendChild(TBL.choiceRow(S.sizeLabel, "size",
      [1, 2, 3, 4].map(function (n) { return [n, fmt(S.sizeOption, { n: n })]; }), st.size));
    var tOpts = [[0, S.timerOff], [60, fmt(S.timerSecs, { n: 60 })], [90, fmt(S.timerSecs, { n: 90 })],
                 [120, fmt(S.timerSecs, { n: 120 })], [180, fmt(S.timerSecs, { n: 180 })]];
    wrap.appendChild(TBL.choiceRow(S.timerDraftLabel, "timerDraft", tOpts, st.timerDraft));
    wrap.appendChild(TBL.choiceRow(S.timerMoveLabel, "timerMove", tOpts, st.timerMove));
    wrap.appendChild(TBL.choiceRow(S.timerActionLabel, "timerAction", tOpts, st.timerAction));
    wrap.appendChild(TBL.choiceRow(S.lockLabel, "lockCommit",
      [[false, S.lockOff], [true, S.lockOn]], !!st.lockCommit));
    wrap.appendChild(TBL.choiceRow(S.fleetsLabel, "fleetPublic",
      [[true, S.fleetsPublic], [false, S.fleetsSecret]], st.fleetPublic !== false));
  }

  /* ═══ BOOT ═════════════════════════════════════════════════════ */
  BAR_INPUT.setAttribute("aria-label", S.tableCodePlaceholder);
  TBL.boot();
})();
