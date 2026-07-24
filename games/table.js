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
    var T = (useMock && cfg.mock) ? cfg.mock : window.DeetsTransport.create({ api: cfg.api });

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
    var joined = false, joining = false, peekSeq = 0;
    var logLines = [], connToast = null;
    var clockSkew = 0;                       // Date.now() - server clock
    var graceToasts = {};                    // seat -> red countdown toast
    var wantSit = false;
    var ui = { colorOpen: null, colorDraft: null, botEdit: null, botDraft: null, botFocus: false, settingsPinned: false };

    function send(msg) { if (conn) conn.send(msg); }
    function mySeat() { return model && model.you ? model.you.seat : null; }
    function seatName(i) { return (model && model.seats && model.seats[i] && model.seats[i].name) || ("Seat " + (i + 1)); }
    function seatedCount() { return ((model && model.seats) || []).filter(function (s) { return s && !s.empty; }).length; }

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
      var stored = String(load(NAME_KEY, "")).trim();
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
      wantSit = false;
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
      if (msg.type === "snapshot") {
        if (hook("beforeMerge")) cfg.beforeMerge(true);
        model = stripMeta(msg);
        afterModel(msg);
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
        afterModel(msg);
        return;
      }
    }
    function stripMeta(msg) { var m = {}; for (var k in msg) if (k !== "type" && k !== "v" && k !== "serverNow" && k !== "ev") m[k] = msg[k]; return m; }
    function afterModel(msg) {
      if (typeof msg.serverNow === "number") clockSkew = Date.now() - msg.serverNow;
      if (hook("onModel")) cfg.onModel(model);
      (msg.ev || []).forEach(handleEvent);
      if (hook("postEvents")) cfg.postEvents();
      syncGraceToasts();
      // auto-sit: a "Sit down" / "Open table" gate join lands as a spectator in
      // the lobby; take a seat once (the toolbar's Sit/Stand governs after)
      if (wantSit && model.phase === "lobby" && mySeat() == null) { wantSit = false; send({ type: "sit" }); }
      if (hook("preRender")) cfg.preRender();
      applySeatColors();
      GATE.hidden = true;
      render();
      if (hook("postRender")) cfg.postRender();
    }
    /* Shared reactions to the presence events every table emits, then the
       game's own handler, then the log line it asks for. */
    function handleEvent(e) {
      if (e.t === "returned") toast(fmt(S.returnedToast, { name: seatName(e.seat) }), "success");
      if (e.t === "takeover") toast(fmt(S.takeoverToast, { name: seatName(e.seat) }), "warn");
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
      buildToolbar();
      // desktop-only guard
      var narrow = window.matchMedia("(max-width: 56rem)").matches;
      if (narrow) { TABLE.hidden = true; DESKTOP.hidden = false; DESKTOP.textContent = S.desktopOnly; return; }
      DESKTOP.hidden = true; TABLE.hidden = false; GATE.hidden = true;
      cfg.render();
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

      // seats — your own dot (and, for the host, a bot's) is a button that
      // slides open the color picker below the row; colors lock at Start
      // because `recolor` is a lobby command (the worker enforces it too)
      var seatList = el("div", "gt-lobby__seats");
      (model.seats || []).forEach(function (s, i) {
        var isBot = !s.empty && s.phantom;
        // host-only inline bot editor takes over the row (same height); a seat
        // a human claimed mid-edit drops the editor, like the color picker
        if (ui.botEdit === i && !(host && (s.empty || isBot))) { ui.botEdit = null; ui.botDraft = null; }
        if (ui.botEdit === i) { seatList.appendChild(botEditorRow(i)); return; }
        var row = el("div", "gt-seat" + (s.empty ? " gt-seat--empty" : ""));
        var editable = !s.empty && (s.seat === mySeat() || (host && s.phantom));
        row.appendChild(editable ? dotButton(s, i) : seatDot(i));
        var label = s.empty ? S.seatOpen : s.seat === mySeat() ? fmt(S.seatYou, { name: s.name }) : isBot ? fmt(S.botSeatTag, { name: s.name }) : s.name;
        if (host && isBot) {
          // the bot's name is the rename affordance (lobby-only — names lock at Start like colors)
          var nameBtn = el("button", "gt-seat__name gt-seat__namebtn", label); nameBtn.type = "button";
          nameBtn.setAttribute("aria-label", fmt(S.renameBotAria, { name: s.name }));
          nameBtn.addEventListener("click", function () { ui.botEdit = i; ui.botDraft = s.name; ui.botFocus = true; render(); });
          row.appendChild(nameBtn);
        } else row.appendChild(el("span", "gt-seat__name", label));
        if (model.hostSeat === i) row.appendChild(el("span", "gt-seat__badge", S.hostBadge));
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
        var startRow = el("div", "gt-lobby__startrow");
        var start = el("button", "tb-pill gt-lobby__start");
        start.type = "button";
        start.appendChild(el("span", "tb-pill__label", S.startButton));
        var ready = seatedCount() >= cfg.minSeats;
        start.disabled = !ready;
        start.addEventListener("click", function () { send({ type: "start" }); });
        startRow.appendChild(start);
        var shuf = el("button", "tb-pill gt-lobby__start");
        shuf.type = "button";
        shuf.appendChild(el("span", "tb-pill__label", S.shufflePill));
        shuf.disabled = seatedCount() < 2;
        shuf.addEventListener("click", function () { send({ type: "shuffle" }); });
        startRow.appendChild(shuf);
        wrap.appendChild(startRow);
        wrap.appendChild(el("p", "gt-lobby__hint", ready ? S.startHint : cfg.startNeedsHint));
        // a seat that went dark in the lobby is dealt in as a bot (the worker
        // does the conversion at Start). Say so before the press, never after —
        // this counts only humans, since a seat view marks bots connected.
        var dark = (model.seats || []).filter(function (s) { return s && !s.empty && !s.connected; }).length;
        if (ready && dark) wrap.appendChild(el("p", "gt-lobby__hint", fmt(S.startBotWarn, { n: dark })));
      }
      (into || BIG).appendChild(wrap);
    }
    function seatDot(i) { var d = el("span", "gt-dot"); d.style.background = "var(--gseat-" + i + ")"; return d; }

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

    /* ── lobby: host-added bots (the addBot verb) ───────────────────
       "+ Bot" on an open seat (or the bot's own name, to rename) swaps the
       row for an inline editor at the same height: name input prefilled
       from the suggestion pool, Add sends addBot (re-adding at a bot's
       seat = rename), ✕ cancels. The draft rides ui.botDraft so
       broadcasts don't wipe it mid-typing (the color picker's idiom). */
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
      var row = el("div", "gt-seat gt-seat--edit");
      row.appendChild(seatDot(i));
      var input = el("input", "gt-seat__nameinput");
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
      var ok = el("button", "gt-seat__addgo", S.addBotGo); ok.type = "button";
      ok.addEventListener("click", go);
      row.appendChild(ok);
      var x = el("button", "gt-seat__kick", "✕"); x.type = "button";
      x.setAttribute("aria-label", S.addBotCancelAria);
      x.addEventListener("click", cancel);
      row.appendChild(x);
      // focus only when the editor OPENS — broadcast re-renders must not steal it
      if (ui.botFocus) { ui.botFocus = false; setTimeout(function () { if (input.isConnected) { input.focus(); input.select(); } }, 0); }
      return row;
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
      // clash index maps straight back to a seat for the "{name} has it" line
      var others = (model.seats || []).map(function (o) {
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
      // chrome
      render: render,
      renderLobby: renderLobby,
      buildToolbar: buildToolbar,
      fitLog: fitLog,
      pill: pill,
      chip: chip,
      setRow: setRow,
      choiceRow: choiceRow,
      toast: toast,
      pop: { open: openPop, close: closePop, toggle: togglePop, current: function () { return openEntry; } },
      // utilities
      el: el, load: load, save: save, fmt: fmt, slugify: slugify, reduceMotion: reduceMotion,
      graceSecs: graceSecs,
      boot: boot
    };
    return TBL;
  }

  window.DeetsTable = { create: create };
})();
