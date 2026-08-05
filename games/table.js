/* Deets games — the table shell (docs/games.md, "The table shell").

   Every game tab on the site is the same table wearing a different game:
   a code combobox in the bar, a peek gate, a lobby with seats / bots / seat
   colors, a socket that reconnects and resyncs, disconnect-grace countdowns,
   a toolbar, and a log. Only the board and the rules change.

   DeetsCities and DeetsMahjong each carried their own copy of all of that —
   ~800 identical lines apiece, and every bug had to be fixed twice. This file
   is that shell, once. A game supplies its rules (engine.js), its copy
   (strings.js), its art, and a handful of hooks; the shell owns everything
   above.

   USE
     var TBL = DeetsTable.create({ ...config, ...hooks });

   The shell keeps the authoritative `model` and hands it to the game through
   onModel(), so a game file keeps its own `model` var and its own `send()`
   alias — nothing else in it has to change. Ordering per broadcast:

     beforeMerge(isSnapshot)   game snapshots any "previous value" state
     <merge>                   shell merges (state) or replaces (snapshot)
     onModel(model)            game rebinds its model var
     onEvent(e) per event      game reacts; the shell appends the log line
     postEvents()              game sweeps event-driven UI
     <grace toasts, auto-sit>
     preRender()               game fixes up interaction modes
     <seat colors, gate hidden>
     render()                  game draws
     postRender()              game runs anything that needs the new DOM

   Shell-rendered nodes carry the `gt-` class prefix and are styled by
   styles/table.css — a game's own stylesheet never restyles them. Game-owned
   nodes keep the game's own prefix.

   Browser only (the workers share table-do.js instead). window.DeetsTable. */
(function () {
  "use strict";

  function create(cfg) {
    var S = cfg.strings || {};
    var Colors = cfg.colors || window.DeetsColors;
    var els = cfg.els || {};
    var hook = function (name) { return typeof cfg[name] === "function" ? cfg[name] : null; };

    var BAR_INPUT = els.bar, CODE_POP = els.codePop, TOOLBAR = els.toolbar;
    var GATE = els.gate, TABLE = els.table, BIG = els.big, LOG = els.log, DESKTOP = els.desktop;

    /* ── transport: the shared client, or the game's mock under ?mock ── */
    var useMock = false;
    try { useMock = new URLSearchParams(location.search).has("mock"); } catch (e) {}
    // cfg.mockDefault: a game whose worker hasn't shipped yet runs the mock
    // WITHOUT ?mock (poker, pre-phase-2) — drop the flag when the worker lands
    var T = ((useMock || cfg.mockDefault) && cfg.mock) ? cfg.mock : window.DeetsTransport.create({ api: cfg.api });

    /* ── tiny utilities (every game page wants these) ────────────── */
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

    /* ── identity + recents (per game: a seat token is a game's own) ── */
    var TOKEN_KEY = "deets-" + cfg.ns + "-token";
    var NAME_KEY = "deets-" + cfg.ns + "-name";
    var RECENTS_KEY = "deets-" + cfg.ns + "-recents";
    var CUSTOM_COLOR_KEY = "deets-" + cfg.ns + "-customhex";
    // deliberately UN-namespaced: your table policy follows you to every game
    var REJOIN_PREF_KEY = "deets-games-rejoin";
    /* A signed-in profile supplies the gate's defaults (docs/accounts.md).
       It is a FALLBACK, never an override: a name typed at this game's
       gate is this game's name and wins — and NAME_KEY is only written
       when the field was actually typed into, so a profile rename keeps
       reaching this game instead of being shadowed by a stamped copy.
       Signed out — or signed in with nothing set — every path below is
       exactly what it was before accounts existed, because guests stay
       first class. */
    function account() {
      try { return (window.DeetsAccount && window.DeetsAccount.get()) || null; }
      catch (e) { return null; }
    }
    function storedName() {
      var mine = String(load(NAME_KEY, "")).trim();
      if (mine) return mine;
      var a = account();
      return a && a.name ? String(a.name).trim().slice(0, 24) : "";
    }
    /* Seat colours are server-assigned at `sit`, so a profile preference
       can only be applied as a follow-up `recolor` — an existing lobby
       verb, so no worker changes. ONE attempt per page load, and it
       stays silent unless the wish is both set and free: an occupied
       colour is left alone rather than fought over, and the existing
       clash UI keeps doing its job. */
    var seededColor = false;
    function seedSeatColor() {
      if (seededColor || !model || model.phase !== "lobby") return;
      var seat = mySeat();
      if (seat == null) return;        // not seated yet — retry next broadcast
      seededColor = true;              // seated: this is the one attempt

      var a = account();
      if (!a || a.color == null) return;
      /* The profile colour is a hex (colors.js contract). Integers are
         pre-hex caches from phase 1 — map them through the presets
         rather than strand a stale localStorage copy. */
      var want = typeof a.color === "number"
        ? (Colors.PRESETS[a.color] || null)
        : Colors.norm(a.color);
      if (!want) return;

      var seats = model.seats || [];
      var mine = seats[seat];
      if (!mine || String(mine.color || "").toLowerCase() === want) return;  // already have it
      for (var i = 0; i < seats.length; i++) {
        if (i !== seat && seats[i] && String(seats[i].color || "").toLowerCase() === want) return;
      }
      send({ type: "recolor", seat: seat, color: want });
    }

    function deviceToken() {
      var t = load(TOKEN_KEY, null);
      if (!t) {
        t = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
        save(TOKEN_KEY, t);
      }
      return t;
    }
    function recents() { return load(RECENTS_KEY, []); }
    function remember(c) {
      var r = recents().filter(function (x) { return x !== c; });
      r.unshift(c);
      save(RECENTS_KEY, r.slice(0, 8));
    }

    function toast(text, kind, opts) {
      if (!window.DeetsToast) return { dismiss: function () {}, update: function () {} };
      var o = { kind: kind || "info", text: text };
      if (opts) for (var k in opts) o[k] = opts[k];
      return window.DeetsToast.push(o);
    }

    /* ── popover kit (the site's shared toolbar idiom) ────────────── */
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
    var joined = false, joining = false, peekSeq = 0, createdTable = false;
    var logLines = [], connToast = null;
    var clockSkew = 0;                       // Date.now() - server clock
    var graceToasts = {};                    // seat -> red countdown toast
    var wantSit = false;
    var ui = { colorOpen: null, colorDraft: null, botEdit: null, botDraft: null, botFocus: false, settingsPinned: false, sitPinned: false };

    function send(msg) { if (conn) conn.send(msg); }
    function mySeat() { return model && model.you ? model.you.seat : null; }
    function seatName(i) { return (model && model.seats && model.seats[i] && model.seats[i].name) || ("Seat " + (i + 1)); }
    function seatedCount() { return ((model && model.seats) || []).filter(function (s) { return s && !s.empty; }).length; }

    /* ── "your turn" title flash ───────────────────────────────────
       A hidden tab is the one place a turn can pass unnoticed, and with
       the timer armed an unnoticed turn is a folded hand and a lost
       blind. The tab strip is the only surface we own when the page
       isn't being looked at, so the title alternates with the game's
       own `yourTurnToast` — his words, already approved for exactly
       this meaning, which is why this needs no new copy and why a game
       opts in merely by HAVING that string.

       Only while the tab is HIDDEN: flashing a title someone is already
       reading is noise, and the toast covers that case. `model.turn.seat`
       is the shared convention the DO's own deadline already runs on
       (dlSig/armAlarm), so this needs nothing per-game.

       Two things are load-bearing. The base title is captured only when
       NOT already flashing, or a second start would capture our own
       alert text and "restore" the page to it permanently. And under
       reduced motion the alert is set ONCE and left there — the
       information survives, the blinking doesn't. */
    var flash = { base: null, timer: null, on: false };
    var FLASH_MS = 1200;

    function turnIsMine() {
      var mine = mySeat();
      return !!(model && model.turn && mine != null && model.turn.seat === mine);
    }
    function stopTitleFlash() {
      if (flash.timer) { clearInterval(flash.timer); flash.timer = null; }
      if (flash.base != null) { document.title = flash.base; flash.base = null; }
      flash.on = false;
    }
    function syncTitleFlash() {
      var want = !!S.yourTurnToast && document.hidden && joined && turnIsMine();
      if (!want) { stopTitleFlash(); return; }
      if (flash.on) return;                       // already running — never re-capture
      flash.on = true;
      flash.base = document.title;                // captured UNFLASHED
      document.title = S.yourTurnToast;
      if (reduceMotion()) return;                 // said once, left up
      var lit = true;
      flash.timer = setInterval(function () {
        lit = !lit;
        document.title = lit ? S.yourTurnToast : flash.base;
      }, FLASH_MS);
    }
    document.addEventListener("visibilitychange", syncTitleFlash);

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
    var codeEntry = { ctrl: els.codeCtrl, pill: null, pop: CODE_POP };
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
      GATE.appendChild(el("p", "gt-gate__line", line));

      var form = el("div", "gt-gate__form");
      var stored = storedName();
      var nameInput = null;
      if (!stored || refuseName) {
        var wrap = el("label", "gt-gate__name");
        wrap.appendChild(el("span", "gt-gate__name-label", S.nameLabel));
        nameInput = el("input", "gt-gate__name-input"); nameInput.type = "text"; nameInput.maxLength = 24; nameInput.value = stored;
        wrap.appendChild(nameInput); form.appendChild(wrap);
      }
      var btns = [];
      function goBtn(label, asWatch, enabled) {
        var b = el("button", "tb-pill gt-gate__go");
        b.type = "button"; b.disabled = !enabled;
        b.appendChild(el("span", "tb-pill__label", label));
        b.addEventListener("click", function () {
          var who = nameInput ? nameInput.value.trim() : stored;
          if (!who) { toast(S.nameNeeded, "error"); if (nameInput) nameInput.focus(); return; }
          if (nameInput) save(NAME_KEY, who);
          btns.forEach(function (x) { x.el.disabled = true; });
          joinTable(c, who, !p.exists, asWatch).then(function () {
            if (!joined) btns.forEach(function (x) { x.el.disabled = !x.enabled; });
          });
        });
        btns.push({ el: b, enabled: enabled });
        form.appendChild(b);
        return b;
      }
      /* An open seat gets the Sit/Spectate pair. With no seat to take (running
         game, or a full lobby) a grayed "Sit down" was the only lit path being
         "Spectate" — misleading, because a returning player's token silently
         repossesses their seat whichever pill they press. So offer the one
         action that's actually available, enabled, and let the worker decide
         whether it's a rejoin or a spectate. */
      var first;
      if (!p.exists) first = goBtn(S.createButton, false, true);
      else if (canSit) {
        first = goBtn(S.sitButton, false, true);
        goBtn(S.watchButton, true, true);
      } else first = goBtn(S.rejoinButton, true, true);
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
        joining = false; conn = cn; code = c; joined = true; logLines.length = 0;
        cn.onMessage(onMessage);
        if (cn.onStatus) cn.onStatus(function (s) {
          if (!joined) return;
          if (s === "down") { if (!connToast) connToast = toast(S.connDown, "error"); }
          else { if (connToast) { connToast.dismiss(); connToast = null; } toast(S.connUp, "success"); }
        });
        // opening or joining a lobby means "I want to play"; only Watch stays a spectator
        wantSit = !asSpectator;
        createdTable = !!create;   // the sticky rejoin pref applies once, to tables I mint
        remember(c);
        if (hook("onJoin")) cfg.onJoin(c);
        try { history.replaceState(null, "", "#" + c); } catch (e) {}
      }).catch(function (err) {
        joining = false;
        var ec = err && err.code;
        if (ec === "name-taken") { renderGate(c, { exists: true, phase: "lobby", seated: 0, capacity: cfg.capacity, spectators: 0 }, true); return; }
        if (ec === "replaced") { toast(S.replacedToast, "error", { sticky: true }); return; }
        toast(ec === "no-table" ? S.noTable : ec === "full" ? S.tableFull : S.peekFailed, "error");
      });
    }
    function leaveTable() {
      if (conn) conn.close();
      conn = null; model = null; joined = false; code = null; logLines.length = 0;
      if (connToast) { connToast.dismiss(); connToast = null; }
      clearGraceToasts();
      stopTitleFlash();     // the tab is nobody's turn now — give the title back
      wantSit = false; createdTable = false;
      ui.colorOpen = ui.colorDraft = ui.botEdit = ui.botDraft = null;
      ui.botFocus = false; ui.settingsPinned = false;
      if (hook("onLeave")) cfg.onLeave();
      if (hook("onModel")) cfg.onModel(null);
      GATE.hidden = true; TABLE.hidden = true; DESKTOP.hidden = true;
      buildToolbar();
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    }

    /* ═══ MESSAGE HANDLING ═════════════════════════════════════════ */
    function onMessage(msg) {
      if (msg.type === "kicked") { toast(S.kickedMeta, "error"); leaveTable(); return; }
      if (msg.type === "closed") { toast(S.tableClosed, "info"); leaveTable(); return; }
      // another tab on this device took the table — sticky, because the user has
      // to act (close a tab); a timed toast would vanish before they read it
      if (msg.type === "replaced") { leaveTable(); toast(S.replacedToast, "error", { sticky: true }); return; }
      if (msg.type === "error") { toast(errText(msg.code), "error"); return; }
      // the phase this socket was at before the merge — a rematch is the
      // over → lobby step, and the game's per-game UI has to let go of the
      // finished game (see onRematch in afterModel)
      var wasPhase = model ? model.phase : null;
      if (msg.type === "snapshot") {
        if (hook("beforeMerge")) cfg.beforeMerge(true);
        model = stripMeta(msg);
        afterModel(msg, wasPhase);
        return;
      }
      if (msg.type === "state") {
        if (!model) model = {};
        if (hook("beforeMerge")) cfg.beforeMerge(false);
        for (var k in msg) if (k !== "type" && k !== "v" && k !== "serverNow" && k !== "ev") model[k] = msg[k];
        // fields a broadcast omits when absent must clear, not linger
        (cfg.clearFields || []).forEach(function (f) { if (!(f in msg)) delete model[f]; });
        if (model.you) {
          (cfg.clearYouFields || []).forEach(function (f) { if (!(f in msg.you)) delete model.you[f]; });
        }
        afterModel(msg, wasPhase);
        return;
      }
    }
    function stripMeta(msg) { var m = {}; for (var k in msg) if (k !== "type" && k !== "v" && k !== "serverNow" && k !== "ev") m[k] = msg[k]; return m; }
    function afterModel(msg, wasPhase) {
      if (typeof msg.serverNow === "number") clockSkew = Date.now() - msg.serverNow;
      if (hook("onModel")) cfg.onModel(model);
      // the host rematched: the table is back in its lobby with the same
      // players, so the game drops what belonged to the finished game (sticky
      // toasts, per-game caches, open modes) before anything renders
      if (wasPhase === "over" && model.phase === "lobby" && hook("onRematch")) cfg.onRematch();
      (msg.ev || []).forEach(handleEvent);
      if (hook("postEvents")) cfg.postEvents();
      syncGraceToasts();
      // auto-sit: a "Sit down" / "Open table" gate join lands as a spectator in
      // the lobby; take a seat once (the toolbar's Sit/Stand governs after)
      if (wantSit && model.phase === "lobby" && mySeat() == null) { wantSit = false; send({ type: "sit" }); }
      // sticky rejoin pref: a table I just created adopts my remembered
      // policy once — the host can still flip it in the lobby afterwards
      if (createdTable && model.phase === "lobby" && model.host) {
        createdTable = false;
        var wantRj = String(load(REJOIN_PREF_KEY, "") || "");
        var okRj = (cfg.rejoinModes || ["anyone", "rejoin"]).indexOf(wantRj) >= 0;
        if (okRj && wantRj !== ((model.settings && model.settings.rejoin) || "rejoin")) {
          send({ type: "setSettings", rejoin: wantRj });
        }
      }
      seedSeatColor();
      if (hook("preRender")) cfg.preRender();
      applySeatColors();
      GATE.hidden = true;
      render();
      if (hook("postRender")) cfg.postRender();
      syncTitleFlash();     // the turn may have just become (or stopped being) mine
    }
    /* Shared reactions to the presence events every table emits, then the
       game's own handler, then the log line it asks for. */
    function handleEvent(e) {
      if (e.t === "returned") toast(fmt(S.returnedToast, { name: seatName(e.seat) }), "success");
      if (e.t === "takeover") toast(fmt(S.takeoverToast, { name: seatName(e.seat) }), "warn");
      if (e.t === "conceded") toast(fmt(S.concededToast, { name: seatName(e.seat) }), "warn");
      if (e.t === "adopted") toast(fmt(S.adoptedToast, { name: seatName(e.seat) }), "success");
      if (hook("onEvent")) cfg.onEvent(e);
      var line = hook("logLine") ? cfg.logLine(e) : null;
      if (line) { logLines.push(line); while (logLines.length > (cfg.logCap || 140)) logLines.shift(); }
    }
    /* Wire error codes → copy. The shell knows the table-level codes every
       game shares; a game adds its own through cfg.errExtra. */
    function errText(codeStr) {
      var map = {
        turn: S.errTurn, phase: S.errPhase, perm: S.errPerm, full: S.errFull,
        flood: S.errFlood, color: S.errColor, "color-taken": S.errColorTaken,
        "no-table": S.noTable, "name-taken": S.nameTaken
      };
      var extra = cfg.errExtra || {};
      for (var k in extra) map[k] = extra[k];
      return map[codeStr] || S.errPhase;
    }

    /* ── disconnect-grace countdown (the red toast) ─────────────────
       Authoritative state is the seat's graceUntil in every broadcast
       (docs/games.md, "Disconnects → grace → bot takeover"), so the sticky
       toast is reconciled from the model — a spectator joining mid-grace
       sees it from their first snapshot, no `leaving` event needed. Ticks
       locally off serverNow's clockSkew, like a turn box. */
    function graceSecs(until) { return Math.max(0, Math.ceil((until - (Date.now() - clockSkew)) / 1000)); }
    function syncGraceToasts() {
      var live = {};
      ((model && model.seats) || []).forEach(function (s, i) { if (s && !s.empty && s.graceUntil && !s.bot) live[i] = s.graceUntil; });
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

    /* ═══ RENDER FRAME ═════════════════════════════════════════════ */
    function render() {
      if (!model) return;
      if (hook("blockRender") && cfg.blockRender()) return;   // e.g. a drag owns the DOM
      /* A broadcast repaints the whole page — every game rebuilds its tiles
         wholesale (`textContent = ""`), which is what makes the render loop
         simple enough to trust. The cost is that anything the BROWSER was
         holding rather than the model dies with the old nodes: where a
         scroller was scrolled to, and which field had the caret. At a
         twelve-seat poker table someone acts every second or two, so that
         cost reads as the page fighting you — scroll the roster and it
         snaps back, start typing a chip value and the caret is gone.

         So: photograph both before the rebuild, put them back after. This
         is deliberately DUMB — it matches nodes by class + ordinal rather
         than by identity, because nothing here has a stable id and giving
         everything one would be a bigger change than the bug is worth. A
         node that moved or was renamed simply doesn't restore. */
      var top = snapScroll(TABLE);
      var caret = snapFocus(TABLE);
      buildToolbar();
      // desktop-only guard
      var narrow = window.matchMedia("(max-width: 56rem)").matches;
      if (narrow) { TABLE.hidden = true; DESKTOP.hidden = false; DESKTOP.textContent = S.desktopOnly; return; }
      DESKTOP.hidden = true; TABLE.hidden = false; GATE.hidden = true;
      cfg.render();
      restoreScroll(TABLE, top);
      restoreFocus(TABLE, caret);
    }
    /* the class list as a selector — every node these games build is
       classed, and a scroller's classes don't change between renders (state
       classes ride items, not the box that scrolls) */
    function nodeSel(n) {
      var cls = typeof n.className === "string" ? n.className.trim() : "";
      return cls ? "." + cls.split(/\s+/).join(".") : null;
    }
    function nodeAt(root, sel, i) {
      var peers = root.querySelectorAll(sel);
      return peers[i] || null;
    }
    function snapScroll(root) {
      var snap = [];
      if (!root) return snap;
      Array.prototype.forEach.call(root.querySelectorAll("*"), function (n) {
        if (!n.scrollTop && !n.scrollLeft) return;
        var sel = nodeSel(n);
        if (!sel) return;
        var peers = root.querySelectorAll(sel);
        snap.push({ sel: sel, i: Array.prototype.indexOf.call(peers, n),
                    top: n.scrollTop, left: n.scrollLeft });
      });
      return snap;
    }
    function restoreScroll(root, snap) {
      snap.forEach(function (s) {
        var n = nodeAt(root, s.sel, s.i);
        if (!n) return;
        n.scrollTop = s.top; n.scrollLeft = s.left;
      });
    }
    function snapFocus(root) {
      var a = document.activeElement;
      if (!a || !root || !root.contains(a)) return null;
      var sel = nodeSel(a);
      if (!sel) return null;
      var peers = root.querySelectorAll(sel);
      var o = { sel: sel, i: Array.prototype.indexOf.call(peers, a) };
      try { o.start = a.selectionStart; o.end = a.selectionEnd; } catch (e) {}
      return o;
    }
    function restoreFocus(root, snap) {
      if (!snap) return;
      var n = nodeAt(root, snap.sel, snap.i);
      if (!n || n === document.activeElement) return;
      try {
        n.focus();
        if (snap.start != null && n.setSelectionRange) n.setSelectionRange(snap.start, snap.end);
      } catch (e) {}
    }
    // Lock the log's height to the space left under the board, so the right
    // column bottom-aligns with the board tile instead of overflowing past it
    // (CSS grid 1fr can't do this on its own — an indefinite-height grid sizes
    // a 1fr track to max-content).
    function fitLog(listSel) {
      if (!BIG || !LOG || TABLE.hidden) return;
      var avail = BIG.getBoundingClientRect().bottom - LOG.getBoundingClientRect().top;
      if (avail > 60) LOG.style.height = Math.floor(avail) + "px";
      var list = LOG.querySelector(listSel);
      if (list) list.scrollTop = list.scrollHeight;
    }

    /* ── toolbar (Invite · Settings · [game pills] · Sit/Stand · Leave · Close) ── */
    function buildToolbar() {
      TOOLBAR.textContent = "";
      if (!joined || !model) return;
      var mine = mySeat();
      TOOLBAR.appendChild(pill(S.invitePill, function () {
        var url = location.origin + location.pathname + (T.kind === "mock" ? "?mock" : "") + "#" + code;
        try { navigator.clipboard.writeText(url); toast(S.shareToast, "success"); } catch (e) { toast(url, "info"); }
      }));
      if (model.settings) TOOLBAR.appendChild(viewSettingsPill());
      (hook("extraPills") ? cfg.extraPills() : []).forEach(function (n) { if (n) TOOLBAR.appendChild(n); });
      if (model.phase === "lobby") {
        if (mine == null) TOOLBAR.appendChild(pill(S.sitPill, function () { send({ type: "sit" }); }));
        else TOOLBAR.appendChild(pill(S.standButton, function () { send({ type: "stand" }); }));
      } else if (model.phase !== "over") {
        // mid-game hop-out / hop-in (docs/games.md). Standing releases the
        // seat for good, so it two-steps like Close; sitting in exists only
        // at an "anyone" table, and collapses every adoptable (bot-held)
        // seat into one pill's popover.
        if (mine != null) {
          // What standing MEANS can change with the re-join policy, so a
          // game may re-word the pill per render (poker: "Cash out" at a
          // "none" table, "Sit out" where the stack survives). Returning
          // FALSE (not null — null is "your wording is fine") withdraws
          // the pill entirely, for the state where standing is a no-op:
          // poker's already-sitting-out seat, whose way back is its own
          // pill two slots to the left.
          var sc = hook("standCopy") ? cfg.standCopy() : null;
          if (sc !== false) {
            sc = sc || {};
            var sp = confirmPill("stand", sc.label || S.standButton,
              sc.confirm || S.standConfirm, function () { send({ type: "stand" }); });
            var sHover = sc.hover || S.standHover;
            if (sHover) sp.title = sHover;
            TOOLBAR.appendChild(sp);
          }
        } else if (((model.settings && model.settings.rejoin) || "rejoin") === "anyone") {
          // adoptable = the drive is holding it (cities/mahjong) or nobody
          // is (an `away` seat at a game with no live bots — poker)
          var open = (model.seats || []).filter(function (s) {
            return s && !s.empty && (s.phantom || s.away) && !s.conceded;
          });
          // no pill at all when nothing is adoptable — a permanently dead
          // "Sit down" at a full human table is noise, not an affordance
          if (open.length) TOOLBAR.appendChild(sitDownPill(open));
          else ui.sitPinned = false;
        }
      }
      TOOLBAR.appendChild(pill(S.leavePill, function () { leaveTable(); }));
      if (model.host) {
        TOOLBAR.appendChild(confirmPill("close", S.closePill, S.closeConfirm,
          function () { send({ type: "closeTable" }); }));
      }
    }
    function pill(label, onClick) {
      var b = el("button", "tb-pill"); b.type = "button";
      b.appendChild(el("span", "tb-pill__label", label));
      b.addEventListener("click", onClick);
      return b;
    }
    /* A two-step pill (click → "Confirm?" → click). The armed flag used to
       live ON THE BUTTON (`b._armed`), which meant any broadcast — anyone
       else acting — rebuilt the toolbar and silently disarmed it: you
       clicked Confirm and nothing happened, because the button you were
       looking at was two renders younger than the one you armed. The flag
       lives here now, keyed by name, and the pill reads it on every build.
       The stored value is the disarm TIMER, so it doubles as the flag. */
    var ARMED = {};
    function disarm(key) {
      if (!ARMED[key]) return;
      clearTimeout(ARMED[key]);
      delete ARMED[key];
    }
    function confirmPill(key, label, confirmLabel, onGo) {
      var armed = !!ARMED[key];
      var b = pill(armed ? confirmLabel : label, function () {
        if (ARMED[key]) { disarm(key); onGo(); return; }
        ARMED[key] = setTimeout(function () { disarm(key); render(); }, 2600);
        render();
      });
      if (armed) b.classList.add("is-active");
      return b;
    }
    // Hover = transient peek; click = pin open through the popover kit (so
    // Esc / outside-click dismiss it like every other popover). The pinned
    // state survives toolbar rebuilds via ui.settingsPinned + entry.kind.
    function viewSettingsPill() {
      var wrap = el("span", "gt-setth");
      var b = el("button", "tb-pill"); b.type = "button"; b.setAttribute("aria-haspopup", "true");
      b.appendChild(el("span", "tb-pill__label", S.settingsPill));
      wrap.appendChild(b);
      var pop = el("div", "tb-pop gt-setth__pop"); pop.hidden = true;
      pop.appendChild(el("div", "tb-pop__head", S.lobbyTitle));
      (hook("settingsRows") ? cfg.settingsRows() : []).forEach(function (r) {
        pop.appendChild(settingRow(r[0], r[1]));
      });
      if ((cfg.rejoinModes || ["anyone", "rejoin"]).length > 1) {
        var rjV = { anyone: S.rejoinAnyone, rejoin: S.rejoinRejoin, none: S.rejoinNone };
        var rjNow = (model.settings && model.settings.rejoin) || "rejoin";
        pop.appendChild(settingRow(S.rejoinLabel, rjV[rjNow] || rjNow));
      }
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
      if (ui.settingsPinned && openEntry && openEntry.kind === "setth") {
        openPop(entry);          // re-pin across the rebuild
        ui.settingsPinned = true;
      } else ui.settingsPinned = false;
      return wrap;
    }
    // Mid-game sit-in: ONE pill, every adoptable seat inside its popover.
    // A pill per seat blew the toolbar out at 5-6 open seats and shoved
    // Leave off the row, so the row width now stands still no matter how
    // many seats are up for adoption. Click-only (no hover peek — the
    // settings pill peeks because reading it IS the point; this one acts).
    function sitDownPill(seats) {
      var wrap = el("span", "tb-ctrl");
      var b = el("button", "tb-pill"); b.type = "button";
      b.setAttribute("aria-haspopup", "true"); b.setAttribute("aria-expanded", "false");
      b.appendChild(el("span", "tb-pill__label", S.sitDownPill));
      b.appendChild(el("span", "tb-pill__caret", "▾"));
      wrap.appendChild(b);
      // no tb-pop__head: the pill's own label ("Take over for:") reads
      // straight into the seat list, so a heading would say it twice
      var pop = el("div", "tb-pop gt-sitpop"); pop.hidden = true;
      seats.forEach(function (s) {
        var o = el("button", "tb-pop__opt"); o.type = "button";
        o.appendChild(seatDot(s.seat));
        o.appendChild(el("span", null, s.name));
        o.addEventListener("click", function () { closePop(); ui.sitPinned = false; send({ type: "sit", seat: s.seat }); });
        pop.appendChild(o);
      });
      wrap.appendChild(pop);
      var entry = { ctrl: wrap, pill: b, pop: pop, kind: "sit" };
      b.addEventListener("click", function () {
        togglePop(entry);
        ui.sitPinned = openEntry === entry;
      });
      // survive the toolbar rebuild an incoming frame triggers — otherwise
      // any table update while you're choosing snaps the popover shut
      if (ui.sitPinned && openEntry && openEntry.kind === "sit") { openPop(entry); ui.sitPinned = true; }
      else ui.sitPinned = false;
      return wrap;
    }
    function settingRow(label, value) {
      var r = el("div", "gt-setth__row");
      r.appendChild(el("span", "gt-setth__k", label));
      r.appendChild(el("span", "gt-setth__v", value));
      return r;
    }

    /* ═══ LOBBY ════════════════════════════════════════════════════
       Title, the game's own setting rows, the seat roster (shared: bots,
       kick, host badge, seat-color picker), then Start + Shuffle. */
    function renderLobby(into) {
      var wrap = el("div", "gt-lobby");
      wrap.appendChild(el("h2", "gt-lobby__title", S.lobbyTitle));
      var host = model.host;

      if (hook("lobbySettings")) cfg.lobbySettings(wrap);

      // the shared re-join policy row — the base's own setting, one row on
      // every game's lobby (docs/games.md). Changing it also remembers the
      // choice for future tables this browser hosts, across all games.
      // one mode is no choice — a game that locks its policy (poker: "none")
      // gets no row rather than a single dead chip
      var rjModes = cfg.rejoinModes || ["anyone", "rejoin"];
      if (rjModes.length > 1) {
        var rjRow = setRow(S.rejoinLabel);
        var rjCur = (model.settings && model.settings.rejoin) || "rejoin";
        var rjLabels = { anyone: S.rejoinAnyone, rejoin: S.rejoinRejoin, none: S.rejoinNone };
        rjModes.forEach(function (m) {
          rjRow.opts.appendChild(chip(rjLabels[m] || m, rjCur === m, !model.host, function () {
            save(REJOIN_PREF_KEY, m);
            send({ type: "setSettings", rejoin: m });
          }));
        });
        wrap.appendChild(rjRow);
      }

      // seats — your own dot (and, for the host, a bot's) is a button that
      // slides open the color picker below the row; colors lock at Start
      // because `recolor` is a lobby command (the worker enforces it too).
      // A real-teams game (cfg.teams) renders the roster as one COLUMN PER
      // SIDE: sitting in a column is joining that team, so "switch team"
      // is just sitting in the other column (docs/games.md, "Teams").
      var seatList = el("div", "gt-lobby__seats");
      var teamCols = null;
      if (cfg.teams) {
        seatList = el("div", "gt-lobby__teams");
        teamCols = [];
        for (var tc = 0; tc < cfg.teams; tc++) {
          var col = el("div", "gt-lobby__team");
          col.appendChild(el("div", "gt-lobby__teamhead", hook("teamName") ? cfg.teamName(tc) : ""));
          var colSeats = el("div", "gt-lobby__seats");
          col.appendChild(colSeats);
          teamCols.push(colSeats);
          seatList.appendChild(col);
        }
      }
      function seatInto(node, s) {
        if (!teamCols) return seatList.appendChild(node);
        teamCols[Math.max(0, Math.min(s.team || 0, teamCols.length - 1))].appendChild(node);
      }
      (model.seats || []).forEach(function (s, i) {
        var isBot = !s.empty && s.phantom;
        var isMe = !s.empty && s.seat === mySeat();
        // with real teams the color is the TEAM's, so only its captain
        // (or the host, standing in for a bot captain) gets the picker
        var isCaptain = !cfg.teams || (model.captains && model.captains[s.team] === i);
        // inline editor takes over the row (same height) — the host's bot
        // editor, or your own rename; a seat that stopped qualifying mid-edit
        // (claimed, kicked, stood up) drops it, like the color picker
        if (ui.botEdit === i && !(host && (s.empty || isBot)) && !isMe) { ui.botEdit = null; ui.botDraft = null; ui.botTier = null; }
        if (ui.botEdit === i) { seatInto(botEditorRow(i), s); return; }
        var row = el("div", "gt-seat" + (s.empty ? " gt-seat--empty" : ""));
        var editable = !s.empty && isCaptain && (isMe || (host && s.phantom));
        row.appendChild(editable ? dotButton(s, i) : seatDot(i));
        var label = s.empty ? S.seatOpen : isMe ? fmt(S.seatYou, { name: s.name }) : isBot ? fmt(S.botSeatTag, { name: s.name }) : s.name;
        if ((host && isBot) || isMe) {
          // the name is the rename affordance (lobby-only — names lock at
          // Start like colors): a bot's name for the host, yours for you
          var nameBtn = el("button", "gt-seat__name gt-seat__namebtn", label); nameBtn.type = "button";
          nameBtn.setAttribute("aria-label", isMe ? S.renameYouAria : fmt(S.renameBotAria, { name: s.name }));
          nameBtn.addEventListener("click", function () { ui.botEdit = i; ui.botDraft = s.name; ui.botFocus = true; render(); });
          row.appendChild(nameBtn);
        } else row.appendChild(el("span", "gt-seat__name", label));
        if (model.hostSeat === i) row.appendChild(el("span", "gt-seat__badge", S.hostBadge));
        // a bot's difficulty is public — you should know what you're facing.
        // It stays a LIVE control after the add: everyone sees E/M/H, but
        // only the host's clicks land (re-adding at the seat re-tiers it)
        if (isBot && botTiers().length > 1) row.appendChild(tierPicker(i, true));
        if (cfg.teams && !s.empty && isCaptain) row.appendChild(el("span", "gt-seat__badge", S.captainBadge));
        if (s.empty && cfg.teams && mySeat() !== i) {
          // sitting here IS joining this side; moving sides is stand + sit
          var sit = el("button", "gt-seat__addbot", S.sitHereButton); sit.type = "button";
          sit.addEventListener("click", function () {
            if (mySeat() != null) send({ type: "stand" });
            send({ type: "sit", seat: i });
          });
          row.appendChild(sit);
        }
        if (host && s.empty) {
          var add = el("button", "gt-seat__addbot", S.addBotButton); add.type = "button";
          add.addEventListener("click", function () { ui.botEdit = i; ui.botDraft = null; ui.botFocus = true; render(); });
          row.appendChild(add);
        }
        if (host && !s.empty && s.seat !== mySeat()) {
          var kick = el("button", "gt-seat__kick", "✕"); kick.type = "button";
          kick.setAttribute("aria-label", fmt(S.kickSeatAria, { name: s.name || "" }));
          kick.addEventListener("click", function () { send({ type: "kickSeat", seat: i }); });
          row.appendChild(kick);
        }
        seatInto(row, s);
        if (editable) seatInto(colorPicker(s, i), s);
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
        var startRow = el("div", "gt-lobby__startrow");
        var start = el("button", "tb-pill gt-lobby__start");
        start.type = "button";
        start.appendChild(el("span", "tb-pill__label", S.startButton));
        var ready = seatedCount() >= cfg.minSeats;
        // real teams: even sides or no deal (the worker refuses too — this
        // gate exists so the refusal never actually reaches a player)
        var uneven = false;
        if (cfg.teams) {
          var counts = [];
          (model.seats || []).forEach(function (s) { if (s && !s.empty) counts[s.team] = (counts[s.team] || 0) + 1; });
          for (var ti = 0; ti < cfg.teams; ti++) if (!counts[ti] || counts[ti] !== counts[0]) uneven = true;
        }
        start.disabled = !ready || uneven;
        start.addEventListener("click", function () { send({ type: "start" }); });
        startRow.appendChild(start);
        var shuf = el("button", "tb-pill gt-lobby__start");
        shuf.type = "button";
        shuf.appendChild(el("span", "tb-pill__label", S.shufflePill));
        shuf.disabled = seatedCount() < 2;
        shuf.addEventListener("click", function () { send({ type: "shuffle" }); });
        startRow.appendChild(shuf);
        wrap.appendChild(startRow);
        // a game whose lobby has to fit a fixed tile can opt out of the hint
        // line entirely (poker) — the Start button's disabled state already
        // says "not yet", so the sentence is a nicety, not load-bearing
        if (!cfg.noStartHint) {
          wrap.appendChild(el("p", "gt-lobby__hint",
            !ready ? cfg.startNeedsHint : uneven ? (S.teamsUnevenHint || cfg.startNeedsHint) : S.startHint));
          // a seat that went dark in the lobby is dealt in as a bot (the worker
          // does the conversion at Start). Say so before the press, never after —
          // this counts only humans, since a seat view marks bots connected.
          var dark = (model.seats || []).filter(function (s) { return s && !s.empty && !s.connected; }).length;
          if (ready && dark) wrap.appendChild(el("p", "gt-lobby__hint", fmt(S.startBotWarn, { n: dark })));
        }
      }
      (into || BIG).appendChild(wrap);
    }
    function seatDot(i) { var d = el("span", "gt-dot"); d.style.background = "var(--gseat-" + i + ")"; return d; }

    /* Paint a game-owned node in a seat's colour. The node then reads
       `--gseat` in its own CSS (`border-left: 3px solid var(--gseat)`),
       so a game never hardcodes a slot name and the shell can change how
       seat colour is resolved without touching a game. This is the same
       --gseat-N contract the dots use, one step down: --gseat-N are the
       six slots, --gseat is "whichever seat THIS element belongs to". */
    function seatAccent(node, i) {
      if (node) node.style.setProperty("--gseat", "var(--gseat-" + i + ")");
      return node;
    }

    /* ── Turn timer (shell-owned) ─────────────────────────────────
       The Durable Object base owns the clock: it arms `turnEndsAt` for
       whatever obligation is outstanding and fires `timerExpire` itself
       (games/table-do.js). A game decides only WHETHER the clock runs
       (its own `settings.timerSec`) and where to hang the readouts — the
       readouts themselves live here so every game, present and future,
       counts down identically.

       Two readouts, both self-ticking at 250ms and both stopping on their
       own when their node leaves the DOM:
         timerRing(seat) → a seat dot wearing a radial countdown
         timerText(node) → a text node showing M:SS

       The handle lives ON each node, not in a module global, so any
       number of rings can run at once — mahjong's claim window waits on
       several seats simultaneously.

       Both read only public broadcast fields, so spectators see exactly
       what players see. */
    var TICK_MS = 250, URGENT_MS = 10000;
    var RING_R = 8.5, RING_C = 2 * Math.PI * RING_R;
    function svgEl(name, attrs) {
      var n = document.createElementNS("http://www.w3.org/2000/svg", name);
      for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
      return n;
    }
    /* The current clock budget in seconds. Default: the one shared
       `settings.timerSec`. A game whose budget varies by phase (ships has
       a clock per phase) supplies cfg.timerBudget() instead — the readouts
       below are the only consumers, so nothing else has to know. */
    function timerBudgetSec() {
      if (hook("timerBudget")) return cfg.timerBudget() || 0;
      return (model && model.settings && model.settings.timerSec) || 0;
    }
    /* ms left on the table clock, or null when it isn't counting — either
       the game never armed it, or nothing is currently owed (a bot is
       thinking, the hand is being scored). */
    function timerLeftMs() {
      if (!model || !timerBudgetSec() || model.turnEndsAt == null) return null;
      return Math.max(0, model.turnEndsAt - (Date.now() - clockSkew));
    }
    function fmtClock(ms) { var s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
    function timerRing(i) {
      var wrap = el("span", "gt-ring");
      var svg = svgEl("svg", { class: "gt-ring__svg", viewBox: "0 0 22 22", "aria-hidden": "true" });
      svg.appendChild(svgEl("circle", { cx: 11, cy: 11, r: RING_R, class: "gt-ring__track" }));
      var arc = svgEl("circle", {
        cx: 11, cy: 11, r: RING_R, class: "gt-ring__arc", "stroke-dasharray": RING_C.toFixed(2)
      });
      svg.appendChild(arc);
      wrap.appendChild(svg);
      wrap.appendChild(seatDot(i));
      seatAccent(wrap, i);
      tickRing(arc);
      return wrap;
    }
    function tickRing(arc) {
      var ms = timerLeftMs();
      if (ms == null) {
        arc.style.strokeDashoffset = "0";
        arc.classList.remove("is-urgent");
      } else {
        arc.style.strokeDashoffset = (RING_C * (1 - ms / (timerBudgetSec() * 1000))).toFixed(2);
        arc.classList.toggle("is-urgent", ms <= URGENT_MS);
      }
      clearTimeout(arc.gtTick);
      arc.gtTick = setTimeout(function () { if (arc.isConnected) tickRing(arc); }, TICK_MS);
    }
    function timerText(node) {
      var ms = timerLeftMs();
      if (ms == null) {                     // armed but not counting — show the full budget, at rest
        node.textContent = fmtClock(timerBudgetSec() * 1000);
        node.classList.remove("is-live", "is-urgent");
        return node;
      }
      node.textContent = fmtClock(ms);
      node.classList.add("is-live");
      node.classList.toggle("is-urgent", ms <= URGENT_MS);
      clearTimeout(node.gtTick);
      node.gtTick = setTimeout(function () { if (node.isConnected) timerText(node); }, TICK_MS);
      return node;
    }

    /* ── lobby setting rows (the chip-row primitive both games use) ──
       cfg.lobbySettings builds its rows out of these, so a new game
       declares its settings instead of re-implementing the widget. */
    function setRow(label) {
      var row = el("div", "gt-set");
      row.appendChild(el("span", "gt-set__label", label));
      var opts = el("div", "gt-set__opts");
      row.appendChild(opts);
      row.opts = opts;
      return row;
    }
    function chip(label, active, disabled, onClick) {
      var b = el("button", "gt-chip" + (active ? " is-active" : ""), label);
      b.type = "button"; b.disabled = !!disabled;
      if (onClick) b.addEventListener("click", onClick);
      return b;
    }
    /* One setting = one row of chips that send `setSettings {key: value}`.
       options is [[value, label], ...]; disabled for everyone but the host. */
    function choiceRow(label, key, options, current) {
      var row = setRow(label);
      options.forEach(function (o) {
        row.opts.appendChild(chip(o[1], current === o[0], !model.host, function () {
          var m = { type: "setSettings" };
          m[key] = o[0];
          send(m);
        }));
      });
      return row;
    }
    /* A free-number chip on the end of a choice row (the custom turn
       timer): blank until used, Enter or leaving the box commits
       setSettings {key: n} clamped to [min, max]. When the live value
       isn't one of the row's presets it shows here, active. The draft
       rides ui.numDraft so broadcasts don't wipe it mid-typing (the
       name editor's idiom). */
    function numChip(key, current, presets, placeholder, min, max) {
      var isCustom = current > 0 && presets.indexOf(current) < 0;
      var inp = el("input", "gt-chip gt-chip--num" + (isCustom ? " is-active" : ""));
      inp.type = "text"; inp.inputMode = "numeric"; inp.maxLength = 3;
      inp.placeholder = placeholder || "";
      inp.disabled = !model.host;
      var draft = ui.numDraft && ui.numDraft.key === key ? ui.numDraft.val : null;
      inp.value = draft != null ? draft : isCustom ? String(current) : "";
      inp.addEventListener("input", function () { ui.numDraft = { key: key, val: inp.value }; });
      var commit = function () {
        ui.numDraft = null;
        var n = parseInt(inp.value, 10);
        if (!isFinite(n) || n === current) { render(); return; }
        var m = { type: "setSettings" };
        m[key] = Math.max(min, Math.min(max, n));
        send(m);
      };
      inp.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") commit();
        else if (ev.key === "Escape") { ui.numDraft = null; render(); }
      });
      // leaving the box commits a typed draft (clicking a preset still wins:
      // its setSettings lands after this one)
      inp.addEventListener("blur", function () { if (ui.numDraft && ui.numDraft.key === key) commit(); });
      return inp;
    }

    /* ── lobby: the seat-name editor ────────────────────────────────
       One row, two owners. "+ Bot" on an open seat (or the bot's own
       name, to rename) opens it for the host: name input prefilled from
       the suggestion pool, confirm sends addBot (re-adding at a bot's
       seat = rename). YOUR own name opens the same row for you: confirm
       sends the rename verb, and a Reset button (signed in only) puts
       the profile name back on the seat AND clears the local override,
       so profile renames flow here again (docs/accounts.md). ✕ cancels.
       The draft rides ui.botDraft so broadcasts don't wipe it mid-typing
       (the color picker's idiom). */
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
      var mine = i === mySeat();       // your own rename, vs the host's bot editor
      var myName = mine && model.seats[i] ? model.seats[i].name : null;
      var row = el("div", "gt-seat gt-seat--edit");
      row.appendChild(seatDot(i));
      var input = el("input", "gt-seat__nameinput");
      input.type = "text"; input.maxLength = 24;
      input.value = ui.botDraft != null ? ui.botDraft : mine ? (myName || "") : nextBotName();
      input.setAttribute("aria-label", mine ? S.renameNameAria : S.addBotNameAria);
      input.addEventListener("input", function () { ui.botDraft = input.value; });
      var go = function () {
        var name = input.value.trim();
        if (!name) { input.focus(); return; }
        if (mine) {
          // typed here = this game's name from now on (the gate contract):
          // the local save wins over the profile fallback
          if (name !== myName) send({ type: "rename", name: name });
          save(NAME_KEY, name);
        } else send({ type: "addBot", seat: i, name: name, tier: botTierDraft(i) });
        ui.botEdit = null; ui.botDraft = null; ui.botTier = null; render();
      };
      var cancel = function () { ui.botEdit = null; ui.botDraft = null; ui.botTier = null; render(); };
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") go();
        else if (ev.key === "Escape") cancel();
      });
      row.appendChild(input);
      // difficulty picker sits left of the confirm — the host's editor only;
      // renaming yourself has no tier to set. No-tier games get no control.
      if (!mine && botTiers().length > 1) row.appendChild(tierPicker(i));
      var ok = el("button", "gt-seat__addgo", mine ? S.renameGo : S.addBotGo); ok.type = "button";
      ok.addEventListener("click", go);
      row.appendChild(ok);
      var acct = mine ? account() : null;
      var acctName = acct && acct.name ? String(acct.name).trim().slice(0, 24) : "";
      if (acctName) {
        // Reset re-opens the profile pipe: the account name goes back on the
        // seat and the local override is cleared, so future profile renames
        // reach this game again instead of being shadowed
        var rst = el("button", "gt-seat__addgo", S.renameReset); rst.type = "button";
        rst.setAttribute("aria-label", S.renameResetAria);
        rst.addEventListener("click", function () {
          save(NAME_KEY, "");
          if (acctName !== myName) send({ type: "rename", name: acctName });
          ui.botEdit = null; ui.botDraft = null; render();
        });
        row.appendChild(rst);
      }
      var x = el("button", "gt-seat__kick", "✕"); x.type = "button";
      x.setAttribute("aria-label", mine ? S.renameCancelAria : S.addBotCancelAria);
      x.addEventListener("click", cancel);
      row.appendChild(x);
      // focus only when the editor OPENS — broadcast re-renders must not steal it
      if (ui.botFocus) { ui.botFocus = false; setTimeout(function () { if (input.isConnected) { input.focus(); input.select(); } }, 0); }
      return row;
    }

    /* ── bot difficulty (docs/games.md, "Bots") ────────────────────
       The tier vocabulary is the ENGINE's, published to the shell as
       cfg.botTiers; a game that declares none simply has no picker and
       nothing else about the lobby changes. Labels are the game's copy,
       looked up as S.botTier_<name>, falling back to the raw name. */
    function botTiers() { return cfg.botTiers || []; }
    function tierLabel(name) { return S["botTier_" + name] || name; }
    function tierShort(name) { return S["botTierShort_" + name] || name.charAt(0).toUpperCase(); }
    // the middle of the list — the same default the worker falls back to
    function tierDefault() { var list = botTiers(); return list[Math.floor(list.length / 2)]; }
    // what the editor will send: the explicit pick, else the tier already on
    // the seat (re-adding a bot keeps its difficulty), else the middle one
    function botTierDraft(i) {
      if (ui.botTier) return ui.botTier;
      var s = (model.seats || [])[i];
      return (s && s.tier) || tierDefault();
    }
    /* Two homes for the same control, single-letter labels in both (the
       full label rides aria — "E" alone reads as nothing). In the host's
       editor (live=false) it stages the pick into ui.botTier until Add
       sends it. On a bot's seat row (live=true) it shows to EVERYONE —
       a bot's difficulty is public — but only the host's clicks land:
       a click re-adds the bot at its seat with the new tier, which is
       the contract's way to re-tier (docs/games.md, "Bots"). */
    function tierPicker(i, live) {
      var s = (model.seats || [])[i];
      var wrap = el("div", "gt-tierpick");
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", S.botTierAria || "");
      var cur = live ? (s && s.tier) || tierDefault() : botTierDraft(i);
      botTiers().forEach(function (name) {
        var b = el("button", "gt-tierpick__opt" + (name === cur ? " is-on" : ""), tierShort(name));
        b.type = "button";
        b.setAttribute("aria-pressed", name === cur ? "true" : "false");
        b.setAttribute("aria-label", tierLabel(name));
        if (live && !model.host) b.disabled = true;
        b.addEventListener("click", function () {
          if (!live) { ui.botTier = name; render(); }
          else if (name !== cur) send({ type: "addBot", seat: i, name: s.name, tier: name });
        });
        wrap.appendChild(b);
      });
      return wrap;
    }

    // seat colors drive the --gseat-N slots (the game-palette carve-out holds
    // the preset fallbacks; a custom pick simply overrides its slot, so every
    // index-keyed render site — board, strips, log, over — follows along)
    function applySeatColors() {
      var root = document.querySelector(cfg.rootSel);
      if (!root || !model) return;
      (model.seats || []).forEach(function (s, i) {
        if (s && s.color) root.style.setProperty("--gseat-" + i, s.color);
      });
    }

    /* ── lobby seat-color picker (dot → slide-open expand) ──────────
       The expand animates with a grid-template-rows 0fr→1fr transition,
       which is why open/close flips a class on the LIVE node — a re-render
       would insert the panel already open and skip the motion. Open state
       and a mid-typing hex draft ride ui.colorOpen / ui.colorDraft so
       broadcasts don't wipe them. */
    function dotButton(s, i) {
      var b = el("button", "gt-seat__dotbtn"); b.type = "button";
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
      var wrap = el("div", "gt-colorpick" + (ui.colorOpen === i ? " is-open" : ""));
      wrap.setAttribute("data-colorpick", i);
      var slide = el("div", "gt-colorpick__inner");   // the 0fr→1fr track
      var inner = el("div", "gt-colorpick__body");
      inner.appendChild(el("span", "gt-colorpick__label",
        s.seat === mySeat() ? S.colorYours : fmt(S.colorTheirs, { name: s.name })));
      // clash targets = every OTHER seat's color, positions preserved so a
      // clash index maps straight back to a seat for the "{name} has it" line.
      // Real teams: teammates share the pick by definition, so the targets
      // are the OTHER sides' colors only — one representative seat per team.
      var seenTeam = {};
      var others = (model.seats || []).map(function (o) {
        if (cfg.teams) {
          if (o.team === s.team || seenTeam[o.team]) return null;
          seenTeam[o.team] = 1;
          return o.color;
        }
        return o.empty || o.seat === i ? null : o.color;
      });
      var sw = el("div", "gt-colorpick__swatches");
      Colors.PRESETS.forEach(function (hex) {
        var b = el("button", "gt-colorpick__swatch"); b.type = "button";
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
      var cb = el("button", "gt-colorpick__swatch gt-colorpick__swatch--custom");
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
      // (colors.js — the same check the worker re-runs), submit = Become...
      var row = el("div", "gt-colorpick__custom");
      row.appendChild(el("span", "gt-colorpick__hexlabel", S.colorHexLabel));
      var input = el("input", "gt-colorpick__hexinput");
      input.type = "text"; input.spellcheck = false; input.maxLength = 8;
      input.value = ui.colorDraft != null ? ui.colorDraft : s.color;
      var become = el("button", "gt-chip gt-colorpick__go", S.colorBecome);
      become.type = "button";
      var note = el("span", "gt-colorpick__msg");
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

    /* ═══ BOOT ═════════════════════════════════════════════════════ */
    function boot() {
      window.addEventListener("resize", function () {
        if (!joined || !model) return;
        if (hook("onResize")) cfg.onResize();   // wrap points moved — drop any measured locks
        render();
      });
      window.addEventListener("hashchange", function () {
        var h = slugify((location.hash || "").replace(/^#/, ""));
        if (h && h !== code) commitCode(h);
      });
      // deep link: #table-code opens the gate for it
      var hash = slugify((location.hash || "").replace(/^#/, ""));
      if (hash) { BAR_INPUT.value = hash; commitCode(hash); }
    }

    var TBL = {
      // state
      transport: T,
      get model() { return model; },
      code: function () { return code; },
      joined: function () { return joined; },
      logLines: logLines,
      ui: ui,
      skew: function () { return clockSkew; },
      // wire
      send: send,
      leave: leaveTable,
      // seats
      mySeat: mySeat,
      seatName: seatName,
      seatedCount: seatedCount,
      seatDot: seatDot,
      seatAccent: seatAccent,
      // turn timer — the DO owns the clock, the shell owns the readouts
      timerLeftMs: timerLeftMs,
      fmtClock: fmtClock,
      timerRing: timerRing,
      timerText: timerText,
      // chrome
      render: render,
      renderLobby: renderLobby,
      buildToolbar: buildToolbar,
      fitLog: fitLog,
      pill: pill,
      confirmPill: confirmPill,
      chip: chip,
      setRow: setRow,
      choiceRow: choiceRow,
      numChip: numChip,
      toast: toast,
      pop: { open: openPop, close: closePop, toggle: togglePop, current: function () { return openEntry; } },
      // utilities
      el: el, load: load, save: save, fmt: fmt, slugify: slugify, reduceMotion: reduceMotion,
      graceSecs: graceSecs,
      boot: boot
    };
    instances.push(TBL);
    return TBL;
  }

  /* Every shell this page created — one, in practice. `joined()` is the
     site-chrome question "is a live table socket at stake right now?":
     account.js asks it before navigating to the profile, so clicking
     your name never tears down a lobby or a game in progress
     (docs/accounts.md, "The new-tab flow"). */
  var instances = [];
  function anyJoined() {
    for (var i = 0; i < instances.length; i++) {
      try { if (instances[i].joined()) return true; } catch (e) {}
    }
    return false;
  }

  window.DeetsTable = { create: create, joined: anyJoined };
})();
