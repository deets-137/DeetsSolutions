/* DeetsTanks — page wiring (docs/tanks.md).

   The shell (games/table.js) owns the code box, gate, lobby, seats,
   colors and toolbar; this file owns the bento's contents, the render
   loop, and the two real-time channels:

   - versioned broadcasts repaint the HUD (paint(), low-rate);
   - `tick` messages bypass the shell entirely (cfg.onRaw) and feed
     net.js's interpolation buffer — the canvas is drawn by rAF, never
     by paint(), and paint() must never rebuild the canvas node.

   Bento (his mapping, 2026-08-05): arena in the big tile; lives and
   kills ride the PARTICIPANTS tile; the campaign counter takes
   mahjong's tile-count slot; the controls strip sits where poker's
   hand panel is. No log. */
(function () {
  "use strict";

  var S = window.TANKS_STRINGS;
  var E = window.TanksEngine;

  var ROOT = document.querySelector(".tk");
  var BAR_INPUT = document.querySelector("[data-tk-code]");
  var CODE_POP = document.querySelector("[data-tk-code-pop]");
  var TOOLBAR = document.querySelector("[data-tk-toolbar]");
  var GATE = document.querySelector("[data-tk-gate]");
  var TABLE = document.querySelector("[data-tk-table]");
  var BIG = document.querySelector("[data-tk-big]");
  var CANVAS = document.querySelector("[data-tk-canvas]");
  var LOBBY = document.querySelector("[data-tk-lobby]");
  var OVERLAY = document.querySelector("[data-tk-overlay]");
  var PLAYERS = document.querySelector("[data-tk-players]");
  var CAMPAIGN = document.querySelector("[data-tk-campaign]");
  var ROLE = document.querySelector("[data-tk-role]");
  var DESKTOP = document.querySelector("[data-tk-desktop]");

  var model = null;
  var NET = window.TanksNet.create();
  var RENDER = window.TanksRender.create(CANVAS);
  var INPUT = window.TanksInput.create(CANVAS);
  var lastAim = 0;
  var rafOn = false;
  var hudRefs = null;          // live pip nodes, refreshed per paint
  var lagIdx = 0;
  var LAG_STEPS = [0, 50, 150, 300];

  var TBL = window.DeetsTable.create({
    ns: "tanks",
    api: "https://tanks-api.deets.solutions",
    mock: window.TanksTransport,
    mockDefault: true,          // no worker yet (phase 4) — drop when it lands
    strings: S,
    rootSel: ".tk",
    capacity: 2,
    minSeats: 1,
    rejoinModes: ["rejoin"],    // one mode: the lobby renders no row
    botTiers: [],
    noStartHint: true,
    logCap: 1,                  // no log tile — nothing accumulates
    errExtra: {},
    clearFields: ["game", "sim", "turnEndsAt"],
    els: {
      bar: BAR_INPUT, codePop: CODE_POP,
      codeCtrl: document.querySelector(".gt-code"),
      toolbar: TOOLBAR, gate: GATE, table: TABLE, big: BIG,
      log: null, desktop: DESKTOP
    },
    onModel: function (m) { model = m; if (!m) stopRaf(); },
    /* the sim channel: claimed here, painted never */
    onRaw: function (msg) {
      if (msg.type !== "tick") return false;
      NET.onTick(msg);
      return true;
    },
    onEvent: function () {},
    logLine: function () { return null; },
    render: paint,
    postRender: function () { syncLoop(); },
    onLeave: resetUi,
    onRematch: resetUi,
    onResize: function () { RENDER.resize(); },
    extraPills: extraPills,
    lobbySettings: lobbySettings,
    settingsRows: function () {
      var st = model.settings;
      return [
        [S.livesLabel, String(st.lives)],
        [S.aimLineLabel, st.aimLine ? S.settingOn : S.settingOff],
        [S.ffLabel, st.friendlyFire ? S.settingOn : S.settingOff]
      ];
    }
  });

  var el = TBL.el, fmt = TBL.fmt, seatDot = TBL.seatDot, seatAccent = TBL.seatAccent;
  var mySeat = TBL.mySeat;
  function send(msg) { TBL.send(msg); }

  function seatColors() {
    return ((model && model.seats) || []).map(function (s) { return s && s.color; });
  }
  function resetUi() {
    stopRaf();
    INPUT.setEnabled(false);
    OVERLAY.hidden = true;
    NET.sync(null, null);
  }

  /* ── lobby settings (the shared chip-row primitive) ──────────── */
  function lobbySettings(wrap) {
    var st = model.settings;
    wrap.appendChild(TBL.choiceRow(S.livesLabel, "lives",
      [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"]], st.lives));
    wrap.appendChild(TBL.choiceRow(S.aimLineLabel, "aimLine",
      [[true, S.settingOn], [false, S.settingOff]], st.aimLine));
    wrap.appendChild(TBL.choiceRow(S.ffLabel, "friendlyFire",
      [[true, S.settingOn], [false, S.settingOff]], st.friendlyFire));
  }

  /* dev: the mock's latency injector, a view knob (docs/realtime.md) */
  function extraPills() {
    if (TBL.transport.kind !== "mock") return [];
    var p = TBL.pill(fmt(S.lagPill, { ms: LAG_STEPS[lagIdx] }), function () {
      lagIdx = (lagIdx + 1) % LAG_STEPS.length;
      window.TanksTransport.setLag(LAG_STEPS[lagIdx], LAG_STEPS[lagIdx] ? 25 : 0);
      TBL.render();
    });
    p.title = S.lagPillTip;
    return [p];
  }

  /* ═══ PAINT — versioned broadcasts only, never the sim channel ══ */
  function paint() {
    if (!model) return;
    var lobby = model.phase === "lobby";
    CANVAS.classList.toggle("is-hidden", lobby);
    LOBBY.hidden = !lobby;
    LOBBY.textContent = "";
    if (lobby) {
      TBL.renderLobby(LOBBY);
      paintPreview();
    } else {
      NET.sync(model, mySeat());
      var lv = NET.level();
      if (lv) RENDER.setLevel(lv, NET.blocks());
    }
    paintOverlay();
    paintPlayers();
    paintCampaign();
    paintRole();
    INPUT.setEnabled(model.phase === "playing" && mySeat() != null);
  }

  /* the lobby preview: the static renderer on the real level file */
  function paintPreview() {
    var wrap = el("div", "tk-preview");
    var cv = el("canvas", "tk-preview__cv");
    wrap.appendChild(cv);
    wrap.appendChild(el("p", "tk-preview__cap", fmt(S.previewCaption, { n: 0 })));
    LOBBY.appendChild(wrap);
    // measured after insertion so the canvas has a size to letterbox in
    window.TanksRender.preview(cv, window.TANKS_LEVELS[0], seatColors());
  }

  /* ── the participants tile: dot · name · hearts · kills ──────── */
  function paintPlayers() {
    PLAYERS.textContent = "";
    var g = model.game;
    var seats = model.seats || [];
    seats.forEach(function (s, i) {
      var row = el("div", "tk-pstrip" + (s.empty ? " is-empty" : ""));
      seatAccent(row, i);
      row.appendChild(seatDot(i));
      row.appendChild(el("span", "tk-pstrip__name",
        s.empty ? S.seatOpen : (s.seat === mySeat() ? fmt(S.seatYou, { name: s.name }) : s.name)));
      var right = el("span", "tk-pstrip__nums");
      var lives = g ? g.lives[i] : (model.settings ? model.settings.lives : 3);
      var hearts = el("span", "tk-hearts");
      hearts.setAttribute("aria-label", fmt(S.livesAria, { name: s.name || "", n: lives }));
      var max = model.settings ? model.settings.lives : 3;
      for (var h = 0; h < max; h++) {
        hearts.appendChild(el("span", "tk-heart" + (h < lives ? "" : " is-spent"), "♥"));
      }
      right.appendChild(hearts);
      var kills = g ? g.kills[i] : 0;
      var k = el("span", "tk-kills", "⌖ " + kills);
      k.setAttribute("aria-label", fmt(S.killsAria, { name: s.name || "", n: kills }));
      right.appendChild(k);
      if (s.empty) { right.textContent = ""; }
      row.appendChild(right);
      PLAYERS.appendChild(row);
    });
  }

  /* ── the campaign tile: level numeral + enemy pips ───────────── */
  function paintCampaign() {
    CAMPAIGN.textContent = "";
    var g = model.game;
    var n = g ? g.levelIdx : 0;
    var left = g ? g.enemiesLeft : 0;
    CAMPAIGN.setAttribute("aria-label", fmt(S.campaignAria, { n: n, left: left }));
    CAMPAIGN.appendChild(el("span", "tk-campaign__num", String(n)));
    var pips = el("span", "tk-campaign__pips");
    for (var i = 0; i < left; i++) {
      var pip = el("span", "tk-campaign__pip");
      pip.title = S.enemyPipAria;
      pips.appendChild(pip);
    }
    CAMPAIGN.appendChild(pips);
  }

  /* ── the role strip: controls legend + shells/mines pips ─────── */
  function paintRole() {
    ROLE.textContent = "";
    hudRefs = null;
    if (mySeat() == null && model.phase !== "lobby") {
      ROLE.appendChild(el("span", "tk-role__note", S.spectatingNote));
      return;
    }
    var keys = el("span", "tk-role__keys");
    var wasd = el("span", "tk-key", "WASD");
    wasd.title = S.controlsDrive;
    keys.appendChild(wasd);
    var aim = el("span", "tk-key tk-key--mouse", "⌖");
    aim.title = S.controlsAim;
    keys.appendChild(aim);
    var fire = el("span", "tk-key", "click");
    fire.title = S.controlsFire;
    keys.appendChild(fire);
    var mine = el("span", "tk-key", "space");
    mine.title = S.controlsMine;
    keys.appendChild(mine);
    ROLE.appendChild(keys);

    var ammo = el("span", "tk-role__ammo");
    var shells = el("span", "tk-pips tk-pips--shells");
    var sPips = [];
    for (var i = 0; i < E.MAX_SHELLS; i++) {
      var sp = el("span", "tk-pip");
      sPips.push(sp); shells.appendChild(sp);
    }
    ammo.appendChild(shells);
    var mines = el("span", "tk-pips tk-pips--mines");
    var mPips = [];
    for (var j = 0; j < E.MINES_MAX; j++) {
      var mp = el("span", "tk-pip tk-pip--mine");
      mPips.push(mp); mines.appendChild(mp);
    }
    ammo.appendChild(mines);
    ROLE.appendChild(ammo);
    hudRefs = { shells: sPips, mines: mPips, box: ammo };
    hudTick();
  }
  /* pips update from tick data at ≤10 Hz — direct node writes, never a
     repaint (docs/realtime.md: HUD panels never update per frame) */
  var lastHud = 0;
  function hudTick(now) {
    if (!hudRefs) return;
    if (now && now - lastHud < 150) return;
    lastHud = now || 0;
    var h = NET.hud();
    hudRefs.shells.forEach(function (p, i) { p.classList.toggle("is-spent", i >= h.sh); });
    hudRefs.mines.forEach(function (p, i) { p.classList.toggle("is-spent", i >= h.mn); });
    hudRefs.box.setAttribute("aria-label",
      fmt(S.shellsAria, { n: h.sh, max: E.MAX_SHELLS }) + " " + fmt(S.minesAria, { n: h.mn }));
  }

  /* ── the interstitial / game-over overlay (over the arena) ───── */
  var overlayTimer = null;
  function paintOverlay() {
    clearInterval(overlayTimer); overlayTimer = null;
    var g = model.game;
    if (!g || model.phase === "playing" || model.phase === "lobby") {
      OVERLAY.hidden = true; OVERLAY.textContent = "";
      return;
    }
    OVERLAY.hidden = false; OVERLAY.textContent = "";
    var card = el("div", "tk-over");
    if (model.phase === "interlevel") {
      var cleared = g.result === "cleared";
      card.appendChild(el("p", "tk-over__line",
        cleared ? fmt(S.clearedLine, { n: g.levelIdx }) : S.failedLine));
      var sub = el("p", "tk-over__sub");
      card.appendChild(sub);
      var tickLine = function () {
        var ms = model.turnEndsAt ? Math.max(0, model.turnEndsAt - (Date.now() - TBL.skew())) : 0;
        var s = Math.ceil(ms / 1000);
        sub.textContent = fmt(cleared ? S.nextIn : S.retryIn, { s: s });
      };
      tickLine();
      overlayTimer = setInterval(tickLine, 250);
    } else if (model.phase === "over") {
      var win = g.over && g.over.win;
      card.appendChild(el("p", "tk-over__line", win ? S.wonLine : S.lostLine));
      if (model.host) {
        var re = el("button", "tb-pill");
        re.type = "button";
        re.appendChild(el("span", "tb-pill__label", S.rematchButton));
        re.addEventListener("click", function () { send({ type: "rematch" }); });
        card.appendChild(re);
      }
    }
    OVERLAY.appendChild(card);
  }

  /* ═══ THE FRAME LOOP — rAF, decoupled from paint() entirely ═════ */
  function syncLoop() {
    var want = !!(model && model.phase !== "lobby" && model.game);
    if (want && !rafOn) { rafOn = true; requestAnimationFrame(loop); }
    if (!want) stopRaf();
  }
  function stopRaf() { rafOn = false; }
  function loop(now) {
    if (!rafOn) return;
    var inp = null;
    if (mySeat() != null) {
      var me = NET.myPos();
      if (INPUT.mouse.in && me) {
        var w = RENDER.toWorld(INPUT.mouse.x, INPUT.mouse.y);
        lastAim = Math.atan2(w.y - me.y, w.x - me.x);
      }
      inp = { d: INPUT.drive(), a: lastAim };
    }
    var scene = NET.frame(now, inp);
    if (scene) {
      if (!(model && model.game && model.game.aimLine)) scene.aim = null;
      RENDER.draw(scene, seatColors());
    }
    sendInput(now, inp);
    hudTick(now);
    requestAnimationFrame(loop);
  }

  /* input → table: a 20 Hz heartbeat, but EVERY press and release goes
     out on the frame it happened. Waiting out the interval meant the
     server drove you for up to 50 ms after you let go, and that stale
     motion came back as the hull coasting past the stop (docs/tanks.md,
     "Feel"). `q` is the local sim step the input belongs to — net.js's
     seq-replay reconciliation is what reads it back. */
  var lastSend = 0, lastDrive = -1;
  function sendInput(now, inp) {
    if (!model || model.phase !== "playing" || mySeat() == null || !inp) return;
    var d = inp.d | 0;
    if (!(d !== lastDrive || INPUT.pending() || now - lastSend >= 50)) return;
    lastSend = now; lastDrive = d;
    var lm = INPUT.consume();
    send({ type: "input", d: d, a: lastAim, f: lm.f, m: lm.m, q: NET.seq() });
  }

  TBL.boot();
})();
