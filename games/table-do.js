// Deets games — the table Durable Object base (docs/games.md, "The worker").
//
// Every game's worker is a Durable Object per table doing the same job:
// accept hibernatable WebSockets, run a join handshake, keep a seat roster
// with host fallback, broadcast personalized views, multiplex one storage
// alarm across the turn deadline / disconnect grace / bot cadence / idle
// fuse, and evaporate when it's been empty long enough. Only the rules and
// the view fields differ.
//
// DeetsCities and DeetsMahjong each carried their own copy of all of that —
// ~600 identical lines apiece. This is that base, once. Like engine.js and
// colors.js it is CONTRACT CODE: each worker repo vendors this file VERBATIM
// as src/table-do.js. Never edit a vendored copy — edit games/table-do.js in
// DeetsSolutions and re-vendor.
//
// A game subclasses it:
//
//   import { GameTable, cryptoRand, clone } from "./table-do.js";
//   export class CitiesTable extends GameTable {
//     get Engine() { return Engine; }
//     defaultSettings() { ... }
//     viewGame(view, token, seat) { ... }
//     applySettings(msg) { ... }
//     minSeats() { return 3; }
//     createGame(seated) { ... }
//     get GAME_VERBS() { return { roll: 1, ... }; }
//     deadlineFor() { ... }  dlSig() { ... }
//     needsPhantom() { ... } phantomOne() { ... }
//   }
//
// Everything else — sockets, identity, lobby verbs, alarm, delivery — is
// inherited. The wire protocol the base speaks is the one the site's shared
// transport (games/transport.js) and each game's mock speak VERBATIM.

export const GRACE_MS = 30_000;     // mid-game disconnect grace before a bot takes over
export const BOT_STEP = 700;        // ms between a bot's actions (watchable, not a flood)
export const EXPIRE_MS = 3_600_000; // idle + empty this long → the table evaporates
export const LOG_MAX = 240;
export const MSG_CAP = 16_384;      // inbound message size cap
export const NAME_CAP = 24;
export const TOKEN_CAP = 64;
export const RL_WINDOW = 10_000;    // per-socket flood guard window
export const RL_MAX = 30;           // messages per window (ping is auto-answered, uncounted)
export const MAX_SOCKETS = 30;      // seats + spectators
export const CODE_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export function cryptoRand() {
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return u[0] / 4294967296;
}
export function clone(x) { return JSON.parse(JSON.stringify(x)); }

export class GameTable {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.t = null;   // in-memory mirror of the persisted table (see load())
    this.tie = 0;    // join-order tiebreak within one wake
    this._ev = null; // scratch: events from the last bot action (driveStep)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /* ══ subclass contract ══════════════════════════════════════════════
     Required: Engine, defaultSettings, viewGame, applySettings, minSeats,
     createGame, GAME_VERBS, deadlineFor, dlSig, needsPhantom, phantomOne.
     The rest have working defaults. */
  get Engine() { throw new Error("subclass must provide Engine"); }
  get Colors() { throw new Error("subclass must provide Colors"); }
  get GAME_VERBS() { return {}; }
  // extra persisted state this game needs, as { key: () => initialValue }
  get EXTRA_STATE() { return {}; }
  defaultSettings() { throw new Error("subclass must provide defaultSettings"); }
  viewGame(view) { return view; }          // append this game's fields
  maskEvent(e) { return e; }               // scrub per-seat hidden info
  applySettings() { return null; }         // → error code, or null on success
  minSeats() { return 2; }
  // how many seats the lobby holds. Default: the host-chosen capacity setting.
  // A game with a fixed table (mahjong's four) overrides with a constant and
  // carries no capacity setting at all.
  capacity() { return this.t.settings.capacity; }
  createGame() { throw new Error("subclass must provide createGame"); }
  compactSeatsAtStart() { return true; }   // seat index === engine player index
  onStart() { return []; }                 // extra events at Start
  onGameOver() {}                          // settle-up when phase turns "over"
  onJoined() {}                            // per-token work on a completed join
  extraCommand() { return false; }         // game-specific verb; true = handled
  deadlineFor() { return null; }           // ms window for the table's one deadline
  dlSig() { return null; }                 // stable signature of that obligation
  needsPhantom() { return false; }
  phantomOne() { return false; }

  // ---- state ---------------------------------------------------------------
  async load() {
    if (this.t) return this.t;
    const extra = Object.keys(this.EXTRA_STATE);
    const keys = ["settings", "seats", "game", "log", "v", "meta",
                  "turnEndsAt", "emptyAt", "timerFor"].concat(extra);
    const v = await this.ctx.storage.get(keys);
    const meta = v.get("meta") || {};
    this.t = {
      createdAt: meta.createdAt || null,      // null until the table is created
      creatorToken: meta.creatorToken || null,
      settings: v.get("settings") || null,
      seats: v.get("seats") || [],
      game: v.get("game") || null,
      log: v.get("log") || [],
      v: v.get("v") || 1,
      turnEndsAt: v.get("turnEndsAt") || null,
      emptyAt: v.get("emptyAt") || null,      // when sockets last hit zero (fuse)
      timerFor: v.get("timerFor") || null,    // signature of the obligation the timer is for
    };
    for (const k of extra) { const got = v.get(k); this.t[k] = got === undefined ? this.EXTRA_STATE[k]() : got; }
    return this.t;
  }
  exists() { return !!this.t.createdAt; }

  async persist() {
    const t = this.t;
    const rec = {
      settings: t.settings, seats: t.seats, game: t.game, log: t.log,
      v: t.v, turnEndsAt: t.turnEndsAt, emptyAt: t.emptyAt, timerFor: t.timerFor,
      meta: { createdAt: t.createdAt, creatorToken: t.creatorToken },
    };
    for (const k of Object.keys(this.EXTRA_STATE)) rec[k] = t[k];
    await this.ctx.storage.put(rec);
  }
  async wipe() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.t = null;
  }

  // ---- sockets & identity --------------------------------------------------
  // Connections live in getWebSockets() (they survive hibernation); a socket
  // counts as "joined" once its attachment carries joined:true. Join order
  // (att.at, att.tie) decides host fallback, exactly like the mock's conn list.
  joinedSockets(except) {
    return this.ctx.getWebSockets()
      .map((ws) => ({ ws, att: ws.deserializeAttachment() || {} }))
      .filter((s) => s.att.joined && s.ws !== except)
      .sort((a, b) => (a.att.at - b.att.at) || (a.att.tie - b.att.tie));
  }
  tokenConnected(token, except) {
    return !!token && this.joinedSockets(except).some((s) => s.att.token === token);
  }
  spectatorCount(except) {
    return this.joinedSockets(except).filter((s) => this.seatOfToken(s.att.token) == null).length;
  }
  socketsForToken(token, except) {
    return this.joinedSockets(except).filter((s) => token && s.att.token === token);
  }

  seatOfToken(token) {
    const seats = this.t.seats;
    for (let i = 0; i < seats.length; i++) if (seats[i] && seats[i].token === token) return i;
    return null;
  }
  // a seat currently driven by the AI: a mid-game takeover (bot), or a
  // host-added lobby bot (phantom — the mock's name, kept so the ported drive
  // code reads the same in both worlds).
  isBot(s) { return !!(s && (s.bot || s.phantom)); }
  botAt(i) { return this.isBot(this.t.seats[i]); }

  hostToken() {
    const t = this.t;
    if (t.creatorToken && this.tokenConnected(t.creatorToken)) return t.creatorToken;
    for (const s of t.seats) if (s && !this.isBot(s) && this.tokenConnected(s.token)) return s.token;
    const js = this.joinedSockets();
    return js.length ? js[0].att.token : t.creatorToken;
  }
  isHost(token) { return !!token && token === this.hostToken(); }
  openSeatIndex() {
    for (let i = 0; i < this.t.seats.length; i++) if (!this.t.seats[i]) return i;
    return -1;
  }
  seatedCount() { return this.t.seats.filter(Boolean).length; }
  // grow/shrink the lobby seat array to capacity with nulls
  resizeSeats() {
    const t = this.t, cap = this.capacity();
    while (t.seats.length < cap) t.seats.push(null);
    while (t.seats.length > cap && !t.seats[t.seats.length - 1]) t.seats.pop();
  }
  otherColors(exceptSeat) {
    return this.t.seats.map((s) => (s && s !== exceptSeat) ? s.color : null);
  }

  // ---- views (hidden-info enforced) ----------------------------------------
  // The table-level half of every view; the game appends its own through
  // viewGame(). `you` is the only place per-seat secrets may ride.
  baseView(token) {
    const t = this.t, seat = this.seatOfToken(token);
    const hostTok = this.hostToken();
    const Colors = this.Colors;
    return {
      code: t.code,
      phase: t.game ? t.game.phase : "lobby",
      settings: t.settings,
      host: token === hostTok,
      hostSeat: this.seatOfToken(hostTok),
      seats: t.seats.map((s, i) => {
        if (!s) return { seat: i, name: null, color: Colors.PRESETS[i], connected: false, empty: true };
        const o = {
          seat: i, name: s.name, color: s.color,
          connected: this.isBot(s) ? true : this.tokenConnected(s.token),
          phantom: this.isBot(s), bot: !!s.bot,
        };
        if (s.graceUntil) o.graceUntil = s.graceUntil;
        return o;
      }),
      spectators: this.spectatorCount(),
      you: { seat, host: token === hostTok },
    };
  }
  viewFor(token) {
    return this.viewGame(this.baseView(token), token, this.seatOfToken(token));
  }

  // ---- delivery ------------------------------------------------------------
  // Every state is a FULL personalized view labelled type:"state" (the client
  // treats a v gap as a missed broadcast and resyncs).
  async broadcast(events, except) {
    const t = this.t;
    t.v++;
    t.touched = Date.now();
    await this.persist();
    for (const s of this.joinedSockets(except)) {
      const view = this.viewFor(s.att.token);
      const ev = (events || []).map((e) => this.maskEvent(e, view.you.seat));
      try { s.ws.send(JSON.stringify(Object.assign({ type: "state", v: t.v, serverNow: Date.now(), ev }, view))); } catch (e) {}
    }
  }
  sendSnapshot(ws, token) {
    const view = this.viewFor(token);
    try { ws.send(JSON.stringify(Object.assign({ type: "snapshot", v: this.t.v, serverNow: Date.now() }, view))); } catch (e) {}
  }
  errTo(ws, code) { try { ws.send(JSON.stringify({ type: "error", code })); } catch (e) {} }

  // ---- engine bridge -------------------------------------------------------
  ctx2() { return { rand: cryptoRand, now: Date.now() }; }
  applyEngine(action) {
    const res = this.Engine.applyAction(this.t.game, action, this.ctx2());
    if (res.error) return res;
    this.t.game = res.game;
    (res.events || []).forEach((e) => this.t.log.push(e));
    if (this.t.log.length > LOG_MAX) this.t.log.splice(0, this.t.log.length - LOG_MAX);
    if (this.t.game.phase === "over") { this.onGameOver(); this.t.turnEndsAt = null; this.t.timerFor = null; }
    return res;
  }

  // ---- the one alarm (nearest-deadline wins) -------------------------------
  // Multiplexes: disconnect-grace expiries (→ bot takeover), the table
  // deadline (a connected human's clock, or an auto-advancing interstitial),
  // the bot-step cadence, and the idle+empty fuse. With nobody connected,
  // drives freeze and only the fuse runs — a reconnect re-arms everything.
  armAlarm() {
    const t = this.t, g = t.game, now = Date.now();
    if (!this.joinedSockets().length) {   // nobody here: freeze drives, light the fuse
      this.ctx.storage.setAlarm((t.emptyAt || now) + EXPIRE_MS);
      return;
    }
    const deadlines = [];
    for (const s of t.seats) if (s && s.graceUntil) deadlines.push(s.graceUntil);
    if (g && g.phase !== "over") {
      const ms = this.deadlineFor();
      if (ms != null) {
        const sig = this.dlSig();
        if (t.timerFor !== sig) { t.timerFor = sig; t.turnEndsAt = now + ms; }
        deadlines.push(t.turnEndsAt);
      } else { t.turnEndsAt = null; t.timerFor = null; }
      if (this.needsPhantom()) deadlines.push(now + BOT_STEP);
    } else { t.turnEndsAt = null; t.timerFor = null; }
    if (deadlines.length) this.ctx.storage.setAlarm(Math.min(...deadlines));
    else this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    await this.load();
    if (!this.exists()) return;
    const t = this.t, g = t.game, now = Date.now();
    if (!this.joinedSockets().length) {   // the fuse: empty long enough → evaporate
      if (t.emptyAt && now - t.emptyAt >= EXPIRE_MS - 500) { await this.wipe(); return; }
      this.ctx.storage.setAlarm((t.emptyAt || now) + EXPIRE_MS);
      return;
    }
    let changed = false;
    let events = [];
    // 1. grace expiries → bot takeover
    for (let i = 0; i < t.seats.length; i++) {
      const s = t.seats[i];
      if (s && s.graceUntil && now >= s.graceUntil && !this.tokenConnected(s.token)) {
        s.bot = true; delete s.graceUntil; changed = true;
        events.push({ t: "takeover", seat: i });
      }
    }
    // 2. table-deadline expiry (a connected human, or an auto-advancing
    //    interstitial) — never while a bot still owes the action: it's driven
    if (g && g.phase !== "over" && t.turnEndsAt && now >= t.turnEndsAt && !this.needsPhantom()) {
      const r = this.applyEngine({ type: "timerExpire" });
      if (!r.error) { events = events.concat(r.events || []); changed = true; t.turnEndsAt = null; t.timerFor = null; }
    }
    if (changed) await this.broadcast(events);
    // 3. one bot step, if a bot must act
    if (this.t.game && this.t.game.phase !== "over" && this.needsPhantom()) await this.driveStep();
    this.armAlarm();
  }

  // ---- bot drive -----------------------------------------------------------
  tryAct(action) {
    const applied = this.applyEngine(action);   // guards on error, commits on success
    if (applied.error) return false;
    this._ev = applied.events || [];
    return true;
  }
  async driveStep() {
    if (this.phantomOne()) { await this.broadcast(this._ev || []); this._ev = null; }
  }

  // ---- command dispatch (client → table) -----------------------------------
  // Table verbs live here; the game's own verbs go through GAME_VERBS (the
  // engine validates them) or extraCommand() for anything off-engine.
  async handle(ws, att, msg) {
    const t = this.t, token = att.token, type = msg.type;
    const LOBBY = { sit: 1, stand: 1, addBot: 1, shuffle: 1, recolor: 1, setSettings: 1, start: 1 };

    if (type === "closeTable") {
      if (!this.isHost(token)) return this.errTo(ws, "perm");
      const bye = JSON.stringify({ type: "closed", serverNow: Date.now() });
      for (const s of this.ctx.getWebSockets()) { try { s.send(bye); } catch (e) {} }
      for (const s of this.ctx.getWebSockets()) { try { s.close(4200, "closed"); } catch (e) {} }
      await this.wipe();
      return;
    }
    if (type === "kickSeat") {
      if (!this.isHost(token)) return this.errTo(ws, "perm");
      const s = msg.seat;
      if (s == null || !t.seats[s]) return;
      const kickedTok = t.seats[s].token;
      if (!t.game || t.game.phase === "over") {   // lobby: open the seat
        t.seats[s] = null; this.resizeSeats();
        for (const c of this.socketsForToken(kickedTok)) { try { c.ws.send(JSON.stringify({ type: "kicked", serverNow: Date.now() })); } catch (e) {} try { c.ws.close(4403, "kicked"); } catch (e) {} }
        await this.broadcast([]);
        this.armAlarm();
        return;
      }
      // running game: a kick is a forced leave — the seat converts to a bot.
      // Drop the token with it: the seat record is what join's reclaim matches
      // on, so leaving it in place would hand the seat straight back the
      // moment the kicked player re-entered the code. kickedTok is already
      // captured above, so their sockets still get the close.
      t.seats[s].bot = true; delete t.seats[s].graceUntil; delete t.seats[s].token;
      for (const c of this.socketsForToken(kickedTok)) { try { c.ws.send(JSON.stringify({ type: "kicked", serverNow: Date.now() })); } catch (e) {} try { c.ws.close(4403, "kicked"); } catch (e) {} }
      await this.broadcast([{ t: "takeover", seat: s }]);
      this.armAlarm();
      return;
    }

    if (await this.extraCommand(ws, att, msg)) return;

    if (LOBBY[type]) {
      if (t.game) return this.errTo(ws, "phase");
      if (type === "sit") {
        if (this.seatOfToken(token) != null) return;
        let idx = -1;
        if (msg.seat != null && !t.seats[msg.seat]) idx = msg.seat;
        else idx = this.openSeatIndex();
        if (idx < 0) return this.errTo(ws, "full");
        const occupied = t.seats.map((s, si) => (s && si !== idx) ? s.color : null);
        t.seats[idx] = { token, name: att.name, color: this.Colors.freePreset(occupied) };
        this.resizeSeats();
        await this.broadcast([]);
        this.armAlarm();
        return;
      }
      if (type === "stand") {
        const mi = this.seatOfToken(token);
        if (mi != null) { t.seats[mi] = null; this.resizeSeats(); await this.broadcast([]); this.armAlarm(); }
        return;
      }
      // host adds (or renames — re-adding at a bot's seat) a named bot in the
      // lobby; the bot driver plays it from Start. Removal is kickSeat.
      if (type === "addBot") {
        if (!this.isHost(token)) return this.errTo(ws, "perm");
        const bi = msg.seat | 0;
        const bname = String(msg.name || "").trim().slice(0, NAME_CAP);
        if (!bname) return this.errTo(ws, "perm");
        if (bi < 0 || bi >= this.capacity()) return this.errTo(ws, "full");
        const bs = t.seats[bi];
        if (bs && !bs.phantom) return this.errTo(ws, "full");   // a human holds it
        const blower = bname.toLowerCase();
        const taken = t.seats.some((s, si) => s && si !== bi && s.name.toLowerCase() === blower) ||
                      this.joinedSockets().some((s) => s.att.name.toLowerCase() === blower);
        if (taken) return this.errTo(ws, "name-taken");
        if (bs) bs.name = bname;
        else {
          const bocc = t.seats.map((s, si) => (s && si !== bi) ? s.color : null);
          t.seats[bi] = { token: "phantom:" + crypto.randomUUID().slice(0, 8), name: bname, color: this.Colors.freePreset(bocc), phantom: true };
        }
        this.resizeSeats();
        await this.broadcast([]);
        this.armAlarm();
        return;
      }
      // host shuffles the seated players' order — Fisher-Yates over the
      // occupied entries, reassigned into the same slots (empty seats stay
      // put; colors and names travel with their players).
      if (type === "shuffle") {
        if (!this.isHost(token)) return this.errTo(ws, "perm");
        const occ = [];
        t.seats.forEach((s, si) => { if (s) occ.push(si); });
        if (occ.length >= 2) {
          const pool = occ.map((si) => t.seats[si]);
          for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(cryptoRand() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          occ.forEach((slot, k) => { t.seats[slot] = pool[k]; });
        }
        await this.broadcast([]);
        this.armAlarm();
        return;
      }
      if (type === "recolor") {
        const target = msg.seat != null ? msg.seat : this.seatOfToken(token);
        const ts = target != null ? t.seats[target] : null;
        if (!ts) return this.errTo(ws, "perm");
        const own = this.seatOfToken(token) === target;
        if (!own && !(ts.phantom && this.isHost(token))) return this.errTo(ws, "perm");
        const hex = this.Colors.norm(msg.color);
        if (!hex) return this.errTo(ws, "color");
        if (this.Colors.clash(hex, this.otherColors(ts)) >= 0) return this.errTo(ws, "color-taken");
        ts.color = hex;
        await this.broadcast([]);
        return;
      }
      if (type === "setSettings") {
        if (!this.isHost(token)) return this.errTo(ws, "perm");
        const bad = this.applySettings(msg);
        if (bad) return this.errTo(ws, bad);
        this.resizeSeats();
        await this.broadcast([]);
        this.armAlarm();
        return;
      }
      if (type === "start") {
        if (!this.isHost(token)) return this.errTo(ws, "perm");
        this.resizeSeats();
        const seated = t.seats.filter(Boolean);
        if (seated.length < this.minSeats()) return this.errTo(ws, "phase");
        if (this.compactSeatsAtStart()) t.seats = seated;   // seat index === engine player index
        /* A lobby seat is held indefinitely by design, and onGone opens no
           grace window without a game — so a seat that went dark in the lobby
           would deal in as neither bot nor connected human: no turn clock, no
           bot to drive it, armAlarm falls through to deleteAlarm() and the
           table hangs forever. Convert those seats here instead. The host is
           warned before the press (strings.startBotWarn); the takeover events
           tell everyone after it. */
        const autoBots = [];
        for (let i = 0; i < t.seats.length; i++) {
          const s = t.seats[i];
          if (s && !this.isBot(s) && !this.tokenConnected(s.token)) { s.bot = true; autoBots.push({ t: "takeover", seat: i }); }
        }
        t.game = this.createGame(seated);
        const extra = this.onStart(seated) || [];
        await this.broadcast(extra.concat(autoBots));
        this.armAlarm();
        return;
      }
      return;
    }

    if (this.GAME_VERBS[type]) {
      if (!t.game || t.game.phase === "over") return this.errTo(ws, "phase");
      const seat = this.seatOfToken(token);
      if (seat == null) return this.errTo(ws, "perm");   // spectators can't act
      const action = clone(msg); action.seat = seat;      // server injects the actor
      const res = this.applyEngine(action);
      if (res.error) return this.errTo(ws, res.error.code);
      await this.broadcast(res.events);
      this.armAlarm();
      return;
    }
  }

  // ---- wire in -------------------------------------------------------------
  async fetch(req) {
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);   // [table, code, leaf]
    const code = parts[1], leaf = parts[2];
    await this.load();
    this.t.code = code;

    if (leaf === "peek") {
      if (!this.exists()) return Response.json({ exists: false });
      return Response.json({
        exists: true,
        phase: this.t.game ? this.t.game.phase : "lobby",
        seated: this.seatedCount(),
        capacity: this.capacity(),
        spectators: this.spectatorCount(),
      });
    }

    if ((req.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ joined: false, code });   // joined once name is set
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MSG_CAP) return;
    let msg;
    try { msg = JSON.parse(message); } catch (e) { return; }
    if (!msg || typeof msg.type !== "string") return;
    await this.load();
    const att = ws.deserializeAttachment() || {};
    this.t.code = att.code;

    // Per-socket flood guard: at most RL_MAX per RL_WINDOW. The counter rides
    // the attachment (survives hibernation, no storage write). A burst past the
    // limit is a SOFT DROP — one error:"flood" as it first trips, then silence
    // till the window rolls; never a socket close (a false positive costs a
    // retry, not a disconnect). ping/pong is auto-answered and never counted.
    const now = Date.now();
    if (!att.rlStart || now - att.rlStart >= RL_WINDOW) { att.rlStart = now; att.rlCount = 0; }
    att.rlCount++;
    ws.serializeAttachment(att);
    if (att.rlCount > RL_MAX) {
      if (att.rlCount === RL_MAX + 1) this.errTo(ws, "flood");
      return;
    }

    if (msg.type === "join") {
      const token = typeof msg.token === "string" ? msg.token.slice(0, TOKEN_CAP) : "";
      const name = String(msg.name || "?").slice(0, NAME_CAP);
      const t = this.t;
      // reconnect supersedes: reap this device's own lingering sockets
      const mine = this.joinedSockets().filter((s) => s.ws !== ws && token && s.att.token === token);
      const others = this.joinedSockets().filter((s) => s.ws !== ws && !mine.includes(s));
      // clash vs live connections AND host-added bot seats (a returning
      // token's own seat doesn't block its reclaim)
      if (others.some((s) => s.att.name.toLowerCase() === name.toLowerCase()) ||
          t.seats.some((s) => s && s.token !== token && s.name.toLowerCase() === name.toLowerCase())) {
        this.errTo(ws, "name-taken");
        try { ws.close(4409, "name-taken"); } catch (e) {}
        return;
      }
      if (others.length + 1 > MAX_SOCKETS) {
        this.errTo(ws, "full");
        try { ws.close(4429, "full"); } catch (e) {}
        return;
      }
      if (!this.exists()) {
        if (!msg.create) {
          this.errTo(ws, "no-table");
          try { ws.close(4404, "no-table"); } catch (e) {}
          return;
        }
        t.createdAt = Date.now();
        t.creatorToken = token;
        t.settings = this.defaultSettings();
        t.seats = []; this.resizeSeats();
        t.game = null; t.log = []; t.v = 1;
        for (const k of Object.keys(this.EXTRA_STATE)) t[k] = this.EXTRA_STATE[k]();
      }
      for (const s of mine) { try { s.ws.close(4408, "replaced"); } catch (e) {} }
      att.joined = true; att.token = token; att.name = name; att.at = Date.now(); att.tie = this.tie++;
      ws.serializeAttachment(att);
      // reconnect reclaim: a returning token repossesses its seat from the bot
      const seat = this.seatOfToken(token);
      const revents = [];
      if (seat != null && t.game && t.game.phase !== "over" && (t.seats[seat].bot || t.seats[seat].graceUntil)) {
        delete t.seats[seat].bot; delete t.seats[seat].graceUntil;
        revents.push({ t: "returned", seat });
      }
      t.emptyAt = null;
      this.onJoined(token);
      this.sendSnapshot(ws, token);       // the joiner's personalized snapshot (v = N)
      await this.broadcast(revents);      // everyone else sees the join (v = N+1)
      this.armAlarm();
      return;
    }

    if (!att.joined) return;   // commands require a completed join
    await this.handle(ws, att, msg);
  }

  async onGone(ws) {
    const att = ws.deserializeAttachment() || {};
    if (!att.joined) return;
    await this.load();
    if (!this.exists()) return;   // closeTable wiped mid-close — nothing to grace or broadcast (and persist() must not resurrect storage)
    const t = this.t, g = t.game, token = att.token;
    const seat = this.seatOfToken(token);
    const events = [];
    // a seated human's LAST socket dropped mid-game → open the grace window
    if (seat != null && g && g.phase !== "over" && !this.isBot(t.seats[seat]) && !this.tokenConnected(token, ws)) {
      if (!t.seats[seat].graceUntil) {
        t.seats[seat].graceUntil = Date.now() + GRACE_MS;
        events.push({ t: "leaving", seat, until: t.seats[seat].graceUntil });
      }
    }
    if (this.joinedSockets(ws).length === 0) t.emptyAt = Date.now();
    // broadcast either way so connected flags / spectator count refresh (the
    // departing socket is excluded from the roster via joinedSockets(except))
    await this.broadcast(events, ws);
    this.armAlarm();
  }
  async webSocketClose(ws) { await this.onGone(ws); }
  async webSocketError(ws) { await this.onGone(ws); }
}

// ------------------------------------------------------------------ http --
// The same edge in front of every game: CORS against ALLOWED_ORIGINS, the
// /table/:code/{peek,ws} routes, an origin check on the upgrade, and an IP
// rate limit on the enumerable peek. A worker's entry is:
//
//   export default { fetch: (req, env) => tableFetch(req, env) };

export function corsHeaders(env, req) {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Vary": "Origin",
  };
}

export async function tableFetch(req, env) {
  const headers = corsHeaders(env, req);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "GET") return new Response(null, { status: 405, headers });

  const [route, code, leaf] = new URL(req.url).pathname.split("/").filter(Boolean);
  if (route !== "table" || !CODE_RE.test(code ?? "") || (leaf !== "peek" && leaf !== "ws")) {
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers });
  }

  const stub = env.TABLE.get(env.TABLE.idFromName(code));

  if (leaf === "ws") {
    // Browsers always send Origin on WS upgrades; hold the same line as peek.
    const origin = req.headers.get("Origin") ?? "";
    const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
    if (!allowed.includes(origin)) return new Response(JSON.stringify({ error: "origin" }), { status: 403, headers });
    return stub.fetch(req);
  }

  // peek: unauthenticated + enumerable → IP rate-limit at the edge so a
  // limited call never reaches the DO. cf-connecting-ip is Cloudflare-set
  // (not spoofable); "anon" only bites in local dev. Fail OPEN — a missing
  // binding or limiter error must never break the join gate.
  if (env.PEEK_RL) {
    try {
      const ip = req.headers.get("cf-connecting-ip") || "anon";
      const { success } = await env.PEEK_RL.limit({ key: ip });
      if (!success) return new Response(JSON.stringify({ error: "rate" }), { status: 429, headers });
    } catch (e) { /* limiter unavailable — serve peek unthrottled */ }
  }

  const res = await stub.fetch(req);
  return new Response(res.body, { status: res.status, headers });
}
