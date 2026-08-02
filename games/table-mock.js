/* Deets games — the MOCK table (docs/games.md, "The pieces").

   An in-page fake of a game's table Worker that speaks the wire protocol
   VERBATIM (peek / connect → conn with send / onMessage / onStatus / close)
   and runs the REAL rules engine locally, so a full hot-seat game is playable
   with no worker at all. A game page must not be able to tell this apart from
   the WebSocket client beyond `kind`.

   It is a DEV TOOL, selected with ?mock — both games default to prod. What it
   deliberately does NOT model (the worker's job, and why rejoin behavior can
   only be tested live):
     - disconnects: no grace window, no bot takeover, no reconnect
     - tables live in localStorage rather than a Durable Object
     - randomness is Math.random; the worker uses crypto in the DO

   What it DOES model exactly, because these are contract:
     - the message envelope and every refusal code
     - HIDDEN INFO: each connection gets its own view, and maskEvent scrubs
       events per seat before delivery
     - the lobby verbs, host fallback, seat colors, and bot drive

   Cities and mahjong each carried a full copy of this; ~380 lines were
   identical. This is that half, once — the same subclass contract the worker
   base uses (games/table-do.js), so the two read as one design.

   USE
     window.<Game>Transport = DeetsTableMock.create({ ns, Engine, Colors, ...hooks });

   window.DeetsTableMock. */
(function () {
  "use strict";

  var LATENCY = 110;        // fake round-trip
  var BOT_STEP = 650;       // ms between bot actions (watchable)
  var LOG_MAX = 200;
  var MAX_CONNS = 30;
  var EXPIRE_MS = 3600000;  // idle + empty this long → the table is dropped on boot

  function now() { return Date.now(); }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function create(spec) {
    var Engine = spec.Engine, Colors = spec.Colors || window.DeetsColors;
    var STORE_KEY = "deets-" + spec.ns + "-mock-v1";
    var EXTRA = spec.extraState || {};
    var EXTRA_KEYS = Object.keys(EXTRA);
    var GAME_CMDS = spec.gameVerbs || {};
    var LOBBY_CMDS = { sit: 1, stand: 1, rename: 1, addBot: 1, shuffle: 1, recolor: 1, setSettings: 1, start: 1 };

    var TABLES = {};   // code -> table
    function ctx() { return { rand: Math.random, now: now() }; }
    function capacity(t) { return spec.capacity ? spec.capacity(t) : t.settings.capacity; }

    /* ── persistence ────────────────────────────────────────────── */
    function persistable() {
      var out = {};
      Object.keys(TABLES).forEach(function (code) {
        var t = TABLES[code];
        var rec = {
          code: t.code, createdAt: t.createdAt, creatorToken: t.creatorToken,
          settings: t.settings, seats: t.seats, game: t.game,
          teamColors: t.teamColors || null,
          log: t.log.slice(-LOG_MAX), v: t.v, touched: t.touched
        };
        EXTRA_KEYS.forEach(function (k) { rec[k] = t[k]; });
        out[code] = rec;
      });
      return out;
    }
    function save() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ tables: persistable() })); } catch (e) {}
    }
    function boot() {
      var saved;
      try { saved = (JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}).tables || {}; }
      catch (e) { saved = {}; }
      Object.keys(saved).forEach(function (code) {
        var s = saved[code];
        var running = s.game && s.game.phase !== "over";
        // the 1 h idle+empty expiry, mock edition (the worker's alarm for real)
        if (!running && now() - (s.touched || 0) > EXPIRE_MS) return;
        var t = {
          code: s.code, createdAt: s.createdAt, creatorToken: s.creatorToken,
          settings: s.settings, seats: s.seats || [], game: s.game || null,
          teamColors: s.teamColors || null,
          log: s.log || [], v: s.v || 1, touched: s.touched || 0,
          conns: [], timer: null, timerFor: null, turnEndsAt: null, driving: false
        };
        EXTRA_KEYS.forEach(function (k) { t[k] = s[k] == null ? EXTRA[k]() : s[k]; });
        // legacy saves carried color NAMES ("red"); seats are hex now
        t.seats.forEach(function (st) {
          if (st && st.color && Colors.LEGACY[st.color]) st.color = Colors.LEGACY[st.color];
        });
        TABLES[code] = t;
      });
    }
    boot();

    /* ── seats / host / identity ────────────────────────────────── */
    function seatOfToken(t, token) {
      for (var i = 0; i < t.seats.length; i++) if (t.seats[i] && t.seats[i].token === token) return i;
      return null;
    }
    function tokenConnected(t, token) {
      return t.conns.some(function (c) { return c.token === token && !c.closed; });
    }
    function hostToken(t) {
      if (t.creatorToken && tokenConnected(t, t.creatorToken)) return t.creatorToken;
      // fallback: longest-seated connected human
      for (var i = 0; i < t.seats.length; i++) {
        var s = t.seats[i];
        if (s && !s.phantom && tokenConnected(t, s.token)) return s.token;
      }
      return t.conns.length ? t.conns[0].token : t.creatorToken;
    }
    function isHost(t, token) { return token && token === hostToken(t); }
    function openSeatIndex(t) {
      for (var i = 0; i < t.seats.length; i++) if (!t.seats[i]) return i;
      return -1;
    }
    function seatedCount(t) { return t.seats.filter(function (s) { return !!s; }).length; }
    // grow/shrink the lobby seat array to capacity with nulls, trimming only
    // trailing empties — the worker's resize, verbatim
    function resizeSeats(t) {
      if (t.game) return;
      var cap = capacity(t);
      while (t.seats.length < cap) t.seats.push(null);
      while (t.seats.length > cap && !t.seats[t.seats.length - 1]) t.seats.pop();
    }
    // every other seat's color (null holes for empties + the excluded seat)
    function otherColors(t, except) {
      return t.seats.map(function (s) { return s && s !== except ? s.color : null; });
    }

    /* ── bot difficulty (the DO base's rules, byte-parallel) ────────
       A tier is a NAME; the engine owns what it means and
       BOT_TIER_LIST is its vocabulary. An engine that declares none
       has one difficulty. Unknown or missing falls back to the middle
       of the list — which is what a seat converted mid-game gets,
       since nobody chose a difficulty for it. */
    function BOT_TIERS() { return (Engine && Engine.BOT_TIER_LIST) || []; }
    function botTier(name) {
      var list = BOT_TIERS();
      if (!list.length) return null;
      return list.indexOf(name) >= 0 ? name : list[Math.floor(list.length / 2)];
    }
    // the two lookups every game's bot drive passes to its engine: who is
    // a bot, and how hard each one plays. The table owns both; the engine
    // owns what a bot does with them.
    function botAt(t) {
      return function (seat) {
        var s = t.seats[seat];
        return !!(s && (s.phantom || s.bot));
      };
    }
    function tierAt(t) {
      return function (seat) { return botTier(t.seats[seat] && t.seats[seat].tier); };
    }

    /* ── teams (the DO base's rules, byte-parallel — docs/games.md) ──
       spec.teams is the real team count (ships: 2) or absent — teams of
       one, teamOf(t, i) === i, nothing changes. */
    function teamOf(t, i) {
      if (!spec.teams) return i;
      var s = t.seats[i];
      if (s && s.team != null) return s.team;   // stamped at Start
      var per = Math.max(1, Math.ceil(capacity(t) / spec.teams));
      return Math.min(spec.teams - 1, Math.floor(i / per));
    }
    function captainSeat(t, team) {
      var fb = null;
      for (var i = 0; i < t.seats.length; i++) {
        var s = t.seats[i];
        if (!s || s.conceded || teamOf(t, i) !== team) continue;
        if (fb == null) fb = i;
        if (!(s.bot || s.phantom) && tokenConnected(t, s.token)) return i;
      }
      return fb;
    }
    function teamColor(t, team) {
      return (t.teamColors && t.teamColors[team]) || Colors.PRESETS[team % Colors.PRESETS.length];
    }
    function teamSeatedCounts(t) {
      var n = [];
      for (var k = 0; k < (spec.teams || 0); k++) n[k] = 0;
      t.seats.forEach(function (s, i) { if (s) n[teamOf(t, i)]++; });
      return n;
    }
    function spectatorCount(t) {
      return t.conns.filter(function (c) { return !c.closed && seatOfToken(t, c.token) == null; }).length;
    }

    /* ── views (hidden-info enforced, exactly as the worker must) ── */
    function baseView(t, conn) {
      var token = conn.token, seat = seatOfToken(t, token);
      var hostTok = hostToken(t);
      var real = !!spec.teams;
      var view = {
        code: t.code,
        phase: t.game ? t.game.phase : "lobby",
        settings: t.settings,
        host: token === hostTok,
        hostSeat: seatOfToken(t, hostTok),
        seats: t.seats.map(function (s, i) {
          var team = teamOf(t, i);
          // team color replaces seat color when teams are real — including
          // empty seats, so 8-seat tables never index past the six presets
          var color = real ? teamColor(t, team) : (s ? s.color : Colors.PRESETS[i]);
          if (!s) return { seat: i, team: team, name: null, color: color, connected: false, empty: true };
          var o = {
            seat: i, team: team, name: s.name, color: color,
            connected: s.phantom ? true : tokenConnected(t, s.token),
            phantom: !!s.phantom, bot: !!s.bot
          };
          // difficulty is public — you should know what you're sitting across
          if ((s.phantom || s.bot) && BOT_TIERS().length) o.tier = botTier(s.tier);
          if (s.conceded) o.conceded = true;
          return o;
        }),
        spectators: spectatorCount(t),
        you: { seat: seat, host: token === hostTok }
      };
      if (real) {
        view.captains = [];
        for (var k = 0; k < spec.teams; k++) view.captains.push(captainSeat(t, k));
      }
      return view;
    }
    function buildView(t, conn) {
      var seat = seatOfToken(t, conn.token);
      return spec.buildView(baseView(t, conn), t, conn, seat);
    }
    function maskEvent(e, seat) { return spec.maskEvent ? spec.maskEvent(e, seat) : e; }

    /* ── delivery ───────────────────────────────────────────────── */
    function deliver(conn, msg) {
      setTimeout(function () {
        if (conn.closed || !conn.handler) return;
        conn.handler(clone(msg));
      }, LATENCY);
    }
    function broadcast(t, events) {
      t.v++; t.touched = now();
      t.conns.forEach(function (c) {
        if (c.closed) return;
        var view = buildView(t, c);
        var ev = (events || []).map(function (e) { return maskEvent(e, view.you.seat); });
        deliver(c, Object.assign({ type: "state", v: t.v, serverNow: now(), ev: ev }, view));
      });
      save();
    }
    function sendSnapshot(t, conn) {
      var view = buildView(t, conn);
      deliver(conn, Object.assign({ type: "snapshot", v: t.v, serverNow: now() }, view));
    }
    function errTo(conn, code) { deliver(conn, { type: "error", code: code }); }
    function rejoinMode(t) { return (t.settings && t.settings.rejoin) || "rejoin"; }
    // the "none" exit — the DO's concedeSeat, byte-parallel: the engine rules
    // first (a refusal leaves the roster untouched), then the seat is severed
    // and keeps only name + color for the grayed-out display. Dropping the
    // token is what makes the conceder a spectator: leave it and seatOfToken
    // still resolves, so they'd keep acting as a seat the drive also plays.
    function concedeSeat(t, i) {
      var s = t.seats[i];
      if (!s || !t.game) return [];
      var r = applyEngine(t, { type: "concede", seat: i });
      if (r.error) return [];
      s.conceded = true; s.bot = false; s.phantom = false; delete s.token;
      return r.events || [];
    }

    /* ── engine bridge ──────────────────────────────────────────── */
    function applyEngine(t, action) {
      var res = Engine.applyAction(t.game, action, ctx());
      if (res.error) return res;
      t.game = res.game;
      (res.events || []).forEach(function (e) { t.log.push(e); });
      if (t.log.length > LOG_MAX) t.log.splice(0, t.log.length - LOG_MAX);
      if (t.game.phase === "over") {
        if (spec.onGameOver) spec.onGameOver(t);
        disarmTimer(t);
      }
      return res;
    }

    /* ── the table deadline (the DO's alarm, setTimeout edition) ─── */
    function disarmTimer(t) {
      if (t.timer) { clearTimeout(t.timer); t.timer = null; }
      t.turnEndsAt = null; t.timerFor = null;
    }
    function armTimer(t) {
      var g = t.game;
      var ms = (g && g.phase !== "over" && spec.deadlineFor) ? spec.deadlineFor(t) : null;
      if (ms == null) { disarmTimer(t); return; }
      // re-arm only when the obligation itself changed, so unrelated
      // broadcasts don't reset a running countdown (the worker's dlSig rule)
      var sig = spec.dlSig ? spec.dlSig(t) : null;
      if (t.timer && t.timerFor === sig) return;
      if (t.timer) clearTimeout(t.timer);
      t.timerFor = sig;
      t.turnEndsAt = now() + ms;
      t.timer = setTimeout(function () {
        t.timer = null; t.turnEndsAt = null; t.timerFor = null;
        var r = applyEngine(t, { type: "timerExpire" });
        if (!r.error) { broadcast(t, r.events); postApply(t); }
      }, ms);
    }

    /* ── bot drive (engine validates every attempt) ─────────────── */
    function postApply(t) { armTimer(t); scheduleDrive(t); }
    function scheduleDrive(t) {
      if (t.driving) return;
      var g = t.game;
      if (!g || g.phase === "over") return;
      // HELPERS rides both drive hooks, not just phantomOne — a game that
      // asks the engine "does any bot owe a move?" needs the same botAt
      // lookup here that it uses to take the move
      if (!spec.needsPhantom(t, HELPERS)) return;
      t.driving = true;
      setTimeout(function () { t.driving = false; driveStep(t); }, API.phantomStep);
    }
    function tryAct(t, action) {
      var res = Engine.applyAction(t.game, action, ctx());
      if (res.error) return false;
      var applied = applyEngine(t, action);
      // stash so driveStep can broadcast them — clients need bot events too
      // (log lines, toasts), exactly as the worker broadcasts every action's
      t._ev = applied.events || [];
      return true;
    }
    function driveStep(t) {
      var g = t.game;
      if (!g || g.phase === "over") return;
      if (spec.phantomOne(t, HELPERS)) { broadcast(t, t._ev || []); t._ev = null; }
      postApply(t);
    }

    // what a game's spec gets handed for its own branches
    var HELPERS = {
      tryAct: tryAct, broadcast: broadcast, errTo: errTo, postApply: postApply,
      seatOfToken: seatOfToken, isHost: isHost, seatedCount: seatedCount,
      resizeSeats: resizeSeats, ctx: ctx, uid: uid, now: now, save: save,
      teamOf: teamOf, captainSeat: captainSeat, teamColor: teamColor,
      botAt: botAt, tierAt: tierAt
    };

    /* ── command dispatch (client → table) ──────────────────────── */
    function handle(t, conn, msg) {
      var token = conn.token, type = msg.type;

      if (type === "closeTable") {
        if (!isHost(t, token)) return errTo(conn, "perm");
        t.conns.slice().forEach(function (c) { deliver(c, { type: "closed", serverNow: now() }); });
        disarmTimer(t); delete TABLES[t.code]; save();
        return;
      }
      if (type === "kickSeat") {
        if (!isHost(t, token)) return errTo(conn, "perm");
        var s = msg.seat;
        if (s == null || !t.seats[s]) return;
        if (!t.game || t.game.phase === "over") {        // lobby: just open the seat
          var kickedTok = t.seats[s].token;
          t.seats[s] = null; resizeSeats(t);
          var kc = t.conns.filter(function (c) { return c.token === kickedTok; })[0];
          if (kc) deliver(kc, { type: "kicked", serverNow: now() });
          return broadcast(t, []);
        }
        // running game: a kick is a forced leave — the seat converts to a bot
        // (the worker's takeover rule), or concedes at a "none" table.
        // phantom:true is what the drive keys on; bot:true is the client's tag.
        // A seat the drive already plays is not kickable: mid-game a bot only
        // leaves by being taken over (the DO's rule).
        if (t.seats[s].bot || t.seats[s].phantom) return errTo(conn, "perm");
        var kcg = t.conns.filter(function (c) { return c.token === t.seats[s].token; })[0];
        if (rejoinMode(t) === "none") {
          var kev = concedeSeat(t, s);
          if (kcg) deliver(kcg, { type: "kicked", serverNow: now() });
          broadcast(t, kev);
          return postApply(t);
        }
        t.seats[s].bot = true; t.seats[s].phantom = true; delete t.seats[s].token;
        if (kcg) deliver(kcg, { type: "kicked", serverNow: now() });
        broadcast(t, [{ t: "takeover", seat: s }]);
        return postApply(t);                             // the drive picks the seat up
      }

      // host rematch from the game-over screen: the finished game is discarded
      // and the table drops back to its own lobby (seats, tokens, colors, bots
      // and settings live on `t`, not `t.game`, so the same players stay put
      // and Start deals a fresh one) — the worker's rule, byte for byte
      if (type === "rematch") {
        if (!isHost(t, token)) return errTo(conn, "perm");
        if (!t.game || t.game.phase !== "over") return errTo(conn, "phase");
        disarmTimer(t);        // clears the pending timeout + turnEndsAt/timerFor
        t.game = null;
        // conceded seats left for good — the rematch lobby opens them
        t.seats = t.seats.map(function (s) { return s && s.conceded ? null : s; });
        resizeSeats(t);
        if (spec.onRematch) spec.onRematch(t, HELPERS);
        broadcast(t, []);
        return postApply(t);
      }

      // Mid-game stand / sit — the hop-out / hop-in pair, the DO's rules
      // byte-parallel (mock edition: no reconnect, so "released" simply
      // means the drive plays the seat and you spectate).
      if (type === "stand" && t.game && t.game.phase !== "over") {
        var ssi = seatOfToken(t, token);
        if (ssi == null) return errTo(conn, "perm");
        if (rejoinMode(t) === "none") {
          var sev = concedeSeat(t, ssi);
          broadcast(t, sev);
          return postApply(t);
        }
        t.seats[ssi].bot = true; t.seats[ssi].phantom = true; delete t.seats[ssi].token;
        broadcast(t, [{ t: "takeover", seat: ssi }]);
        return postApply(t);
      }
      if (type === "sit" && t.game && t.game.phase !== "over") {
        if (rejoinMode(t) !== "anyone") return errTo(conn, "phase");
        if (seatOfToken(t, token) != null) return errTo(conn, "perm");
        var asi = msg.seat;
        var aseat = asi != null ? t.seats[asi] : null;
        if (!aseat || !(aseat.bot || aseat.phantom)) return errTo(conn, "full");   // only a bot-held seat
        var alower = String(conn.name || "").toLowerCase();
        var ataken = t.seats.some(function (x, xi) { return x && xi !== asi && x.name.toLowerCase() === alower; });
        if (ataken) return errTo(conn, "name-taken");
        aseat.name = conn.name; aseat.token = token;
        aseat.bot = false; aseat.phantom = false;
        broadcast(t, [{ t: "adopted", seat: asi }]);
        return postApply(t);
      }

      if (spec.extraCommand && spec.extraCommand(t, conn, msg, HELPERS)) return;

      if (LOBBY_CMDS[type]) {
        if (t.game) return errTo(conn, "phase");
        if (type === "sit") {
          if (seatOfToken(t, token) != null) return;         // already seated
          var idx = -1;
          if (msg.seat != null && !t.seats[msg.seat]) idx = msg.seat;
          else idx = openSeatIndex(t);
          if (idx < 0) return errTo(conn, "full");
          var occupied = t.seats.map(function (s, si) { return s && si !== idx ? s.color : null; });
          t.seats[idx] = { token: token, name: conn.name, color: Colors.freePreset(occupied), connected: true, phantom: false };
          resizeSeats(t);
          return broadcast(t, []);
        }
        if (type === "stand") {
          var mi = seatOfToken(t, token);
          if (mi != null) { t.seats[mi] = null; resizeSeats(t); broadcast(t, []); }
          return;
        }
        // rename your own seat (lobby-only — names lock at Start like
        // colors). Display only, same clash rule as join and addBot; the DO
        // runs this branch byte-parallel.
        if (type === "rename") {
          var ri = seatOfToken(t, token);
          if (ri == null) return errTo(conn, "perm");
          var rname = String(msg.name || "").trim().slice(0, 24);
          if (!rname) return errTo(conn, "perm");
          var rlower = rname.toLowerCase();
          var rtaken = t.seats.some(function (s, si) { return s && si !== ri && s.name.toLowerCase() === rlower; }) ||
                       t.conns.some(function (c) { return !c.closed && c.token !== token && c.name.toLowerCase() === rlower; });
          if (rtaken) return errTo(conn, "name-taken");
          t.seats[ri].name = rname;
          t.conns.forEach(function (c) { if (c.token === token) c.name = rname; });
          return broadcast(t, []);
        }
        // host adds (or renames — re-adding at a bot's seat) a named bot in
        // the lobby; the drive plays it from Start. Removal is kickSeat.
        if (type === "addBot") {
          if (!isHost(t, token)) return errTo(conn, "perm");
          var bi = msg.seat | 0;
          var bname = String(msg.name || "").trim().slice(0, 24);
          if (!bname) return errTo(conn, "perm");
          if (bi < 0 || bi >= capacity(t)) return errTo(conn, "full");
          var bs = t.seats[bi];
          if (bs && !bs.phantom) return errTo(conn, "full");   // a human holds it
          var blower = bname.toLowerCase();
          var taken = t.seats.some(function (s, si) { return s && si !== bi && s.name.toLowerCase() === blower; }) ||
                      t.conns.some(function (c) { return !c.closed && c.name.toLowerCase() === blower; });
          if (taken) return errTo(conn, "name-taken");
          var btier = botTier(msg.tier);
          if (bs) { bs.name = bname; bs.tier = btier; }   // re-adding also re-tiers
          else {
            var bocc = t.seats.map(function (s, si) { return s && si !== bi ? s.color : null; });
            t.seats[bi] = { token: "phantom:" + uid(), name: bname, color: Colors.freePreset(bocc),
                            connected: true, phantom: true, tier: btier };
          }
          resizeSeats(t);
          return broadcast(t, []);
        }
        // host shuffles the seated players' order — Fisher-Yates over the
        // occupied entries, reassigned into the same slots
        if (type === "shuffle") {
          if (!isHost(t, token)) return errTo(conn, "perm");
          var occ = [];
          t.seats.forEach(function (s, si) { if (s) occ.push(si); });
          if (occ.length >= 2) {
            var pool = occ.map(function (si) { return t.seats[si]; });
            for (var fi = pool.length - 1; fi > 0; fi--) {
              var fj = Math.floor(Math.random() * (fi + 1));
              var ftmp = pool[fi]; pool[fi] = pool[fj]; pool[fj] = ftmp;
            }
            occ.forEach(function (slot, k) { t.seats[slot] = pool[k]; });
          }
          return broadcast(t, []);
        }
        // lobby-only by registration (colors LOCK at Start, by decision):
        // your own seat, or the host recoloring a bot. Validation is the
        // colors.js contract — the DO runs this branch byte-identically.
        if (type === "recolor") {
          if (spec.teams) {
            // one color per SIDE, the captain's to set (the host covers a
            // bot-captained team) — the DO base's branch, byte-parallel
            var ttarget = msg.seat != null ? msg.seat : seatOfToken(t, token);
            if (ttarget == null || !t.seats[ttarget]) return errTo(conn, "perm");
            var team = teamOf(t, ttarget);
            var capSeat = captainSeat(t, team);
            var capBot = capSeat != null && !!(t.seats[capSeat].bot || t.seats[capSeat].phantom);
            if (!(seatOfToken(t, token) === capSeat || (capBot && isHost(t, token)))) return errTo(conn, "perm");
            var thex = Colors.norm(msg.color);
            if (!thex) return errTo(conn, "color");
            var tothers = [];
            for (var tk = 0; tk < spec.teams; tk++) tothers.push(tk === team ? null : teamColor(t, tk));
            if (Colors.clash(thex, tothers) >= 0) return errTo(conn, "color-taken");
            if (!t.teamColors) {
              t.teamColors = [];
              for (var tk2 = 0; tk2 < spec.teams; tk2++) t.teamColors.push(teamColor(t, tk2));
            }
            t.teamColors[team] = thex;
            return broadcast(t, []);
          }
          var target = msg.seat != null ? msg.seat : seatOfToken(t, token);
          var ts = target != null ? t.seats[target] : null;
          if (!ts) return errTo(conn, "perm");
          var own = seatOfToken(t, token) === target;
          if (!own && !(ts.phantom && isHost(t, token))) return errTo(conn, "perm");
          var hex = Colors.norm(msg.color);
          if (!hex) return errTo(conn, "color");
          if (Colors.clash(hex, otherColors(t, ts)) >= 0) return errTo(conn, "color-taken");
          ts.color = hex;
          return broadcast(t, []);
        }
        if (type === "setSettings") {
          if (!isHost(t, token)) return errTo(conn, "perm");
          // rejoin is the table core's own key; the rest belongs to the game
          if (msg.rejoin !== undefined) {
            var modes = spec.rejoinModes || ["anyone", "rejoin"];
            if (modes.indexOf(msg.rejoin) < 0) return errTo(conn, "phase");
            t.settings.rejoin = msg.rejoin;
            return broadcast(t, []);
          }
          var bad = spec.applySettings(t, msg, HELPERS);
          if (bad) return errTo(conn, bad);
          resizeSeats(t);
          return broadcast(t, []);
        }
        if (type === "start") {
          if (!isHost(t, token)) return errTo(conn, "perm");
          resizeSeats(t);
          var seated = t.seats.filter(function (s) { return !!s; });
          if (seated.length < spec.minSeats()) return errTo(conn, "phase");
          if (spec.teams) {
            // even sides or no deal, and the structural column mapping is
            // stamped onto the seats before compaction (the DO base's rule)
            var counts = teamSeatedCounts(t);
            for (var ck = 0; ck < counts.length; ck++) {
              if (!counts[ck] || counts[ck] !== counts[0]) return errTo(conn, "teams");
            }
            t.seats.forEach(function (s, si) { if (s) s.team = teamOf(t, si); });
          }
          t.seats = seated;   // COMPACT: seat index now === engine player index
          t.game = spec.createGame(t, seated, ctx());
          var extra = (spec.onStart ? spec.onStart(t) : []) || [];
          broadcast(t, extra);
          return postApply(t);
        }
        return;
      }

      if (GAME_CMDS[type]) {
        if (!t.game || t.game.phase === "over") return errTo(conn, "phase");
        var seat = seatOfToken(t, token);
        if (seat == null) return errTo(conn, "perm");        // spectators can't act
        var action = clone(msg); action.seat = seat;         // server injects the actor
        var res = applyEngine(t, action);
        if (res.error) return errTo(conn, res.error.code);
        broadcast(t, res.events);
        return postApply(t);
      }
    }

    /* ── public API (the shape games/transport.js mirrors) ───────── */
    var API = {
      kind: "mock",
      phantomStep: BOT_STEP,

      peek: function (code) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            var t = TABLES[code];
            if (!t) return resolve({ exists: false });
            resolve({
              exists: true,
              phase: t.game ? t.game.phase : "lobby",
              seated: seatedCount(t),
              capacity: capacity(t),
              spectators: spectatorCount(t)
            });
          }, LATENCY);
        });
      },

      connect: function (code, opts) {
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            var t = TABLES[code];
            if (!t && !opts.create) return reject({ code: "no-table" });
            var token = typeof opts.token === "string" ? opts.token.slice(0, 64) : "";
            var name = String(opts.name || "?").slice(0, 24);
            if (!t) {
              t = TABLES[code] = {
                code: code, createdAt: now(), creatorToken: token,
                settings: Object.assign({ rejoin: "rejoin" }, spec.defaultSettings()),
                seats: [], game: null, log: [],
                teamColors: spec.teams ? Colors.PRESETS.slice(0, spec.teams) : null,
                v: 1, touched: now(), conns: [], timer: null, timerFor: null,
                turnEndsAt: null, driving: false
              };
              EXTRA_KEYS.forEach(function (k) { t[k] = EXTRA[k](); });
              resizeSeats(t);
              save();
            }
            // reap our own lingering connection (reconnect supersedes)
            t.conns.slice().forEach(function (c) {
              if (token && c.token === token) { c.closed = true; t.conns.splice(t.conns.indexOf(c), 1); }
            });
            // unique display names among live connections AND host-added bot
            // seats (a returning token's own seat doesn't block its reclaim)
            var clash = t.conns.some(function (c) { return !c.closed && c.name.toLowerCase() === name.toLowerCase() && c.token !== token; }) ||
                        t.seats.some(function (s) { return s && s.token !== token && s.name.toLowerCase() === name.toLowerCase(); });
            if (clash) return reject({ code: "name-taken" });
            if (t.conns.filter(function (c) { return !c.closed; }).length >= MAX_CONNS) return reject({ code: "full" });

            var conn = {
              token: token, name: name, h: uid(), handler: null, closed: false,
              get seat() { return seatOfToken(t, token); },
              onMessage: function (cb) { conn.handler = cb; },
              onStatus: function () {},                        // the mock never drops
              send: function (msg) {
                setTimeout(function () { if (!conn.closed) handle(t, conn, msg); }, LATENCY);
              },
              close: function () {
                conn.closed = true;
                var i = t.conns.indexOf(conn);
                if (i >= 0) t.conns.splice(i, 1);
                broadcast(t, []);                              // presence update
              }
            };
            t.conns.push(conn);
            t.touched = now();
            if (spec.onJoined) spec.onJoined(t, token);
            sendSnapshot(t, conn);
            broadcast(t, []);                                  // let others see the join
            postApply(t);                                      // resume the drive on reconnect
            resolve(conn);
          }, LATENCY);
        });
      },

      /* dev knobs (console): <Game>Transport.wipe(), .phantomStep */
      wipe: function () {
        Object.keys(TABLES).forEach(function (c) { disarmTimer(TABLES[c]); });
        TABLES = {};
        try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      },
      tables: function () { return TABLES; }
    };
    return API;
  }

  window.DeetsTableMock = { create: create };
})();
