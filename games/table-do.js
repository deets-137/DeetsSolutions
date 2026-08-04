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
export const ARC_CHUNK = 100;       // events per append-only archive chunk
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
    this._over = null;     // scratch: a promise an onGameOver() override returned
    this._exiting = null;  // scratch: {seat, exit} while a concede is in the engine
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
  onRematch() {}                           // drop any per-game state the rematch discards
  onJoined() {}                            // per-token work on a completed join
  // re-join policy modes this game's tables may offer (settings.rejoin —
  // "anyone" opens dark seats to adoption, "rejoin" holds them with bots,
  // "none" makes leaving a concede). "none" needs the game's engine to
  // speak a `concede` action, so a game opts in by overriding (cities).
  get REJOIN_MODES() { return ["anyone", "rejoin"]; }
  // real team count (DeetsShips: 2), or null — teams of one (see "Teams")
  get TEAMS() { return null; }
  /* ── away seats (docs/poker.md, "Stepping away") ────────────────────
     A game with NO bots in live play can't hand a released seat to the
     drive. It parks the seat instead: the engine verb named here folds the
     occupant out and stops dealing them in, while the roster keeps the seat
     whole — name, color, stake, token AND uid — so the same person walks
     back in later, from any device they're signed in on. ADOPT_ACTION is
     the return. A game that defines these must also speak `concede`: a kick
     still severs (see kickSeat), and so does a "none" table.
     The site's mock spells the same pair `awayAction` / `adoptAction`. */
  get AWAY_ACTION() { return null; }
  get ADOPT_ACTION() { return null; }
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
                  "turnEndsAt", "emptyAt", "timerFor", "teamColors",
                  "spans", "rematchIndex", "arcN", "arcBuf", "startedAt"].concat(extra);
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
      teamColors: v.get("teamColors") || null, // real-teams games: one color per SIDE
      // stats plumbing (docs/stats.md) — all of it resets with the game
      spans: v.get("spans") || [],            // occupancy ledger: who sat where, when, how they left
      rematchIndex: v.get("rematchIndex") || 0,   // monotonic; half the results idempotency key
      arcN: v.get("arcN") || 0,               // archive chunks written so far
      arcBuf: v.get("arcBuf") || [],          // events not yet flushed to a chunk
      startedAt: v.get("startedAt") || null,  // when Start dealt the current game
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
      teamColors: t.teamColors,
      spans: t.spans, rematchIndex: t.rematchIndex, arcN: t.arcN, arcBuf: t.arcBuf,
      startedAt: t.startedAt,
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

  /* ── the spans ledger (docs/stats.md) ────────────────────────────────
     Who occupied which seat, when they arrived, and how they left.

     This exists because the uid is DELETED from a seat on every departure
     path (concede, stand, kick — see those sites), so reading seat.uid at
     game over misses exactly the players most worth crediting: the one who
     conceded at 8 VP, the one who stood up. And it misses them SILENTLY, as
     a plausible-looking null that reads like a guest. Attribution has to be
     recorded when it happens, not reconstructed at the end.

     Append-only. Opened at Start and on every takeover / adoption /
     reclaim; closed on departure, and closed with exit:null for everyone
     still seated when the game ends. One span per occupancy, so a seat with
     two spans changed hands — which makes "this table is unrated" a derived
     fact rather than a flag somebody had to remember to set. */
  seatKind(s) { return this.isBot(s) ? "bot" : (s && s.uid ? "user" : "guest"); }
  // Roughly "when in the game did this happen". Games count different things
  // and neither counter is on a shared contract, so read whichever the engine
  // keeps rather than inventing a third. A subclass may override.
  clock() {
    const st = this.t.game && this.t.game.stats;
    if (!st) return null;
    return st.turns != null ? st.turns : (st.hands != null ? st.hands : null);
  }
  openSpan(i, via) {
    const s = this.t.seats[i];
    if (!s || !this.t.game) return;
    const n = this.t.spans.filter((x) => x.seat === i).length;
    this.t.spans.push({
      seat: i, span: n, uid: s.uid || null, name: s.name, kind: this.seatKind(s),
      via, exit: null,
      joinedAt: Date.now(), leftAt: null, joinedTurn: this.clock(), leftTurn: null,
    });
  }
  closeSpan(i, exit) {
    if (!this.t.game) return;
    for (let k = this.t.spans.length - 1; k >= 0; k--) {
      const sp = this.t.spans[k];
      if (sp.seat === i && sp.leftAt == null) {
        sp.exit = exit; sp.leftAt = Date.now(); sp.leftTurn = this.clock();
        return;
      }
    }
  }
  // the seat changed hands mid-game: the leaver is closed, the arrival opens
  handOver(i, exit, via) { this.closeSpan(i, exit); this.openSpan(i, via); }
  closeAllSpans() {
    // game over: anyone still seated played it to the end, so exit stays null
    // — except a seat whose concede is what ended it (_exiting), which must
    // keep its reason. Conceding the second-to-last seat ends the game inside
    // the same applyEngine call, so this runs BEFORE concedeSeat can name it.
    const now = Date.now(), turn = this.clock(), ex = this._exiting;
    for (const sp of this.t.spans) {
      if (sp.leftAt == null) {
        sp.leftAt = now; sp.leftTurn = turn;
        if (ex && sp.seat === ex.seat) sp.exit = ex.exit;
      }
    }
  }

  /* ── the event archive (docs/stats.md) ───────────────────────────────
     t.log is the live client's scrollback, capped at LOG_MAX and trimmed
     FIFO — it is the TAIL of a game, not the game. The archive is the whole
     stream, kept for the questions the counters can't answer.

     It is stored OUTSIDE the table record on purpose: persist() serialises
     the whole record and broadcast() calls it on every state change, so an
     uncapped log inside it would rewrite a growing blob hundreds of times a
     game. These chunks are written once and never rewritten.

     The un-flushed tail rides in t.arcBuf, which IS in the record — so a
     hibernation or crash between flushes loses nothing, and flushing is a
     write-volume optimisation rather than a correctness mechanism. */
  arcKey(n) { return "arc:" + String(n).padStart(6, "0"); }   // padded: list() sorts as STRINGS
  async flushArc(force) {
    const t = this.t;
    if (!t.arcBuf.length || (!force && t.arcBuf.length < ARC_CHUNK)) return;
    await this.ctx.storage.put(this.arcKey(t.arcN), t.arcBuf);
    t.arcN++; t.arcBuf = [];
  }
  async readArchive() {
    const m = await this.ctx.storage.list({ prefix: "arc:" });
    const out = [];
    for (const chunk of m.values()) for (const e of chunk) out.push(e);
    return out.concat(this.t.arcBuf);
  }
  // a new game reuses chunk numbers, so the old ones must go with it or
  // arc:000000 would collide with the previous game's
  async resetArchive() {
    const m = await this.ctx.storage.list({ prefix: "arc:" });
    const keys = [...m.keys()];
    if (keys.length) await this.ctx.storage.delete(keys);
    this.t.arcN = 0; this.t.arcBuf = [];
  }

  /* ── results delivery (docs/stats.md, "The pipeline") ────────────────
     A finished game is POSTed to DeetsAccounts over a SERVICE BINDING —
     worker to worker, never public HTTP — where it becomes rows the
     profile page reads back. The base owns all of this because both games
     want the identical thing and the load-bearing halves (the spans
     ledger, the archive, the rematch counter) already live here; a game
     supplies only what is game-shaped, through the four hooks below.

     Nothing here may throw. It runs inside the game-over broadcast, and a
     stats POST that failed is a stats POST that failed — it must never
     cost the table its final state delivery. */
  gameName() { throw new Error("subclass must provide gameName"); }
  seatStats() { return null; }      // that game's per-seat blob, verbatim (the archive)
  seatCounters() { return {}; }     // { column: number } for the game's counter table
  resultDetail() { return null; }   // per-hand summaries, if the game keeps any
  resultKey() { return this.gameName() + ":" + this.t.code + ":" + this.t.rematchIndex; }

  /* The whole result EXCEPT the event stream. Split that way on purpose:
     this is what goes to the outbox, and a DO storage value caps at 128 KiB
     while a game's stream runs to hundreds. The stream is already durable in
     its own arc: chunks, so the outbox stores the small half and a retry
     re-reads the archive rather than keeping a second copy of it. */
  buildResult() {
    const t = this.t, g = t.game;
    const rank = {};
    for (const r of (this.Engine.standings(g) || [])) rank[r.seat] = r;
    // spans are append-only, so the last one written for a seat is whoever
    // was sitting in it at the end — the occupant the result hangs on
    const final = [];
    for (const sp of t.spans) final[sp.seat] = sp;
    let humans = 0, bots = 0;
    const seats = [];
    for (let i = 0; i < t.seats.length; i++) {
      const r = rank[i] || {}, fs = final[i];
      if (fs) { if (fs.kind === "bot") bots++; else humans++; }
      const row = {
        seat: i,
        // NULL for a bot or a guest, which is why an orphan reads the same
        // as a bot rather than as a hole in the field
        uid: fs ? (fs.uid || null) : null,
        rank: r.rank == null ? null : r.rank,
        tied: !!r.tied,
        score: r.score == null ? null : r.score,
        stats: this.seatStats(i),
        counters: this.seatCounters(i),
      };
      if (this.teamsReal()) row.team = this.teamOf(i);   // the team outcome hangs on this
      seats.push(row);
    }
    return {
      key: this.resultKey(),
      game: this.gameName(),
      tableId: t.code,
      rematchIndex: t.rematchIndex,
      started: t.startedAt, ended: Date.now(),
      settings: t.settings,
      humans, bots,
      seats, spans: t.spans,
      detail: this.resultDetail(),
    };
  }

  /* Outbox first, POST second (docs/stats.md, "Delivery"). waitUntil-style
     fire-and-forget would mean a game silently never happened whenever the
     accounts worker was mid-deploy, so the result is written to storage
     BEFORE the attempt and deleted only on a 2xx. Nothing reads pending:
     back yet — the alarm sweep that drains it is the last step of the
     feature, and it can only be written once there are leftovers to look at.
     The key that survives is the whole point. */
  async reportResults() {
    let meta;
    try { meta = this.buildResult(); } catch (e) { return; }
    const pk = "pending:" + meta.key;
    try { await this.ctx.storage.put(pk, meta); } catch (e) { /* still worth the POST */ }
    const acc = this.env.ACCOUNTS;
    if (!acc) return;   // unbound (or a local dev run): the result waits in the outbox
    try {
      const body = Object.assign({}, meta, { log: await this.readArchive() });
      // The hostname is ignored on a service binding — the request is handed
      // straight to the accounts worker's fetch. The key authenticates it
      // anyway, because /ingest is also reachable on the public custom domain.
      const res = await acc.fetch("https://deets-accounts/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ingest-Key": this.env.INGEST_SECRET || "",
        },
        body: JSON.stringify(body),
      });
      if (res.ok) await this.ctx.storage.delete(pk);
    } catch (e) { /* stays pending */ }
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
  /* ── bot difficulty (docs/games.md, "Bots") ────────────────────────
     A tier is a NAME, not a number: the engine owns what it means, and
     BOT_TIER_LIST is its vocabulary. An engine that declares no tiers
     has one difficulty and every seat reads the same, so a game gets
     tiers by adding them to its engine and nothing else. Unknown or
     missing names fall back to the middle of the list, which is what a
     seat converted mid-game (grace expiry, a kick) gets — nobody chose
     a difficulty for it, so it plays the default one. */
  get BOT_TIERS() { return (this.Engine && this.Engine.BOT_TIER_LIST) || []; }
  botTier(name) {
    const list = this.BOT_TIERS;
    if (!list.length) return null;
    return list.indexOf(name) >= 0 ? name : list[Math.floor(list.length / 2)];
  }
  // The FUNCTION forms, which is what an engine's botAct/botPending take.
  // `botAt(i)` below is the plain predicate and long predates these — do
  // not merge the two names: a class body silently keeps only the last.
  tierFn() { return (seat) => this.botTier(this.t.seats[seat] && this.t.seats[seat].tier); }
  botFn() { return (seat) => this.isBot(this.t.seats[seat]); }
  botAt(i) { return this.isBot(this.t.seats[i]); }
  rejoinMode() { return (this.t.settings && this.t.settings.rejoin) || "rejoin"; }
  // the "none" exit: the engine concedes the seat, the roster severs it.
  // Name and color stay for the grayed-out display; `conceded` is public.
  // The engine rules first: if it refuses (no game, or already "over"), the
  // roster must NOT be touched — severing a seat the engine still counts
  // would strike a live player out of the final standings.
  concedeSeat(i, exit) {
    const s = this.t.seats[i];
    if (!s || !this.t.game) return [];
    // name the exit before the engine runs — see closeAllSpans()
    this._exiting = { seat: i, exit: exit || "concede" };
    const r = this.applyEngine({ type: "concede", seat: i });
    this._exiting = null;
    if (r.error) return [];
    s.conceded = true;
    // the span closes BEFORE the uid is dropped — that delete is why the
    // ledger exists. `exit` names how they went; nobody takes the seat over,
    // so no new span opens. Their standing survives: concede() leaves their
    // buildings, roads and awards on the board.
    this.closeSpan(i, exit || "concede");
    delete s.bot; delete s.phantom; delete s.graceUntil; delete s.token; delete s.uid;
    delete s.away;
    return r.events || [];
  }
  /* The other mid-game exit: the seat is PARKED, not severed (AWAY_ACTION).
     Everything identifying stays on it — that is the whole feature, because
     join's reclaim matches on token or uid and a deleted key can match
     neither. Returns the engine's events, or null when this game (or this
     moment) can't park a seat, which is the caller's signal to fall back to
     the bot takeover it always did. */
  awaySeat(i) {
    const s = this.t.seats[i], g = this.t.game;
    if (!s || !this.AWAY_ACTION || !g || g.phase === "over") return null;
    delete s.graceUntil;
    if (s.away) return [];
    const r = this.applyEngine({ type: this.AWAY_ACTION, seat: i });
    if (r.error) return null;
    s.away = true;
    // An away stretch is an ABSENCE, not a hand-over: the span stays OPEN, or
    // a player who takes a break loses attribution for their own session
    // (docs/stats.md — one span per occupancy, and this is still theirs).
    return r.events || [];
  }

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

  /* ── teams (docs/games.md, "Teams") ─────────────────────────────────
     Every seat always has a team. For most games teams are OF ONE —
     teamOf(i) === i — and nothing about their model, wire or UX changes
     beyond the additive `team` field on seat views. A game with REAL
     teams (DeetsShips) overrides TEAMS with a count; then:
       - the lobby maps seats to sides structurally (columns: the first
         capacity/TEAMS seat indices are team 0, the next team 1, ...),
         and sitting in a column IS joining that side;
       - Start refuses uneven sides (error "teams") and stamps the
         surviving mapping onto each seat before compaction;
       - one color per SIDE (t.teamColors, the captain's to set via the
         ordinary recolor verb) replaces per-seat colors — every seat
         view's `color` resolves through its team, so the client's
         --gseat contract needs no change and empty seats never read
         past PRESETS at 8-seat tables;
       - `captains` rides the public view: per team, the host idiom —
         lowest-indexed connected human, else lowest-indexed live seat
         (a bot captain is a real state, not an error). */
  teamsReal() { return !!this.TEAMS; }
  teamOf(i) {
    if (!this.teamsReal()) return i;
    const s = this.t.seats[i];
    if (s && s.team != null) return s.team;   // stamped at Start
    const per = Math.max(1, Math.ceil(this.capacity() / this.TEAMS));
    return Math.min(this.TEAMS - 1, Math.floor(i / per));
  }
  captainSeat(team) {
    let fb = null;
    const seats = this.t.seats;
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      if (!s || s.conceded || this.teamOf(i) !== team) continue;
      if (fb == null) fb = i;
      if (!this.isBot(s) && this.tokenConnected(s.token)) return i;
    }
    return fb;
  }
  teamColor(team) {
    return (this.t.teamColors && this.t.teamColors[team]) ||
           this.Colors.PRESETS[team % this.Colors.PRESETS.length];
  }
  teamSeatedCounts() {
    const n = new Array(this.TEAMS || 0).fill(0);
    this.t.seats.forEach((s, i) => { if (s) n[this.teamOf(i)]++; });
    return n;
  }

  // ---- views (hidden-info enforced) ----------------------------------------
  // The table-level half of every view; the game appends its own through
  // viewGame(). `you` is the only place per-seat secrets may ride.
  baseView(token) {
    const t = this.t, seat = this.seatOfToken(token);
    const hostTok = this.hostToken();
    const Colors = this.Colors;
    const real = this.teamsReal();
    const view = {
      code: t.code,
      phase: t.game ? t.game.phase : "lobby",
      settings: t.settings,
      host: token === hostTok,
      hostSeat: this.seatOfToken(hostTok),
      seats: t.seats.map((s, i) => {
        const team = this.teamOf(i);
        // team color replaces seat color when teams are real — including
        // empty seats, so 8-seat tables never index past the six presets
        const color = real ? this.teamColor(team) : (s ? s.color : Colors.PRESETS[i]);
        if (!s) return { seat: i, team, name: null, color, connected: false, empty: true };
        const o = {
          seat: i, team, name: s.name, color,
          connected: this.isBot(s) ? true : this.tokenConnected(s.token),
          phantom: this.isBot(s), bot: !!s.bot,
        };
        // difficulty is public — you should know what you're sitting across
        if (this.isBot(s) && this.BOT_TIERS.length) o.tier = this.botTier(s.tier);
        if (s.conceded) o.conceded = true;
        if (s.away) o.away = true;   // public, exactly like conceded is
        if (s.graceUntil) o.graceUntil = s.graceUntil;
        return o;
      }),
      spectators: this.spectatorCount(),
      you: { seat, host: token === hostTok },
    };
    if (real) view.captains = Array.from({ length: this.TEAMS }, (_, k) => this.captainSeat(k));
    return view;
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
    // the async seams applyEngine (synchronous, always) cannot reach itself
    await this.flushArc(!!(t.game && t.game.phase === "over"));
    if (this._over) { const p = this._over; this._over = null; await p; }
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
    (res.events || []).forEach((e) => { this.t.log.push(e); this.t.arcBuf.push(e); });
    if (this.t.log.length > LOG_MAX) this.t.log.splice(0, this.t.log.length - LOG_MAX);
    if (this.t.game.phase === "over") {
      // spans close BEFORE the hook, so an override reads a finished ledger.
      // applyEngine is synchronous and always is — the async tail rides a
      // promise that broadcast() awaits at its own seam.
      this.closeAllSpans();
      const settled = this.onGameOver();
      // The game's settle-up first (cities pays out its book), then the
      // results POST, which reports what the hook left behind. reportResults
      // is unconditional: no game should be able to forget to record itself.
      this._over = (async () => {
        try { await settled; }
        catch (e) { /* a settle-up that failed must not cost the table its final broadcast */ }
        await this.reportResults();
      })();
      this.t.turnEndsAt = null; this.t.timerFor = null;
    }
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
    // 1. grace expiries → bot takeover, or a concede at a "none" table.
    //    Only a running game has anything to take over: if the game ended (or
    //    a rematch discarded it) while someone sat inside their window, the
    //    window is moot — drop it and leave the seat whole, so they can still
    //    reclaim their chair at the game-over screen and into the next deal.
    for (let i = 0; i < t.seats.length; i++) {
      const s = t.seats[i];
      if (s && s.graceUntil && now >= s.graceUntil && !this.tokenConnected(s.token)) {
        if (!g || g.phase === "over") {
          delete s.graceUntil; changed = true;
        } else if (this.rejoinMode() === "none") {
          events = events.concat(this.concedeSeat(i, "grace")); changed = true;
        } else if (this.AWAY_ACTION) {
          // a game with no bots to hand the seat to: the window closing
          // sends it AWAY rather than conceding it, so the stake stays on
          // the table and the token still opens the door (docs/poker.md)
          const aev = this.awaySeat(i);
          if (aev) { events = events.concat(aev); changed = true; }
          else { delete s.graceUntil; changed = true; }
        } else {
          // a grace expiry keeps the token and uid on the seat (that is what
          // lets them reclaim it), so the span closes but the identity stays
          this.closeSpan(i, "grace");
          s.bot = true; delete s.graceUntil; changed = true;
          this.openSpan(i, "takeover");
          events.push({ t: "takeover", seat: i });
        }
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
    const LOBBY = { sit: 1, stand: 1, rename: 1, addBot: 1, shuffle: 1, recolor: 1, setSettings: 1, start: 1 };

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
      // running game: a kick is a forced leave — the seat converts to a bot
      // (or concedes, at a "none" table). A seat the AI already drives is NOT
      // kickable: mid-game, a bot only leaves by being taken over — adopted at
      // an "anyone" table, or reclaimed by the player it stands in for. There
      // is no host button that deletes a hand mid-game.
      if (this.isBot(t.seats[s])) return this.errTo(ws, "perm");
      // Drop the token AND the uid with it: the seat record is what join's
      // reclaim matches on (either key), so leaving one in place would hand
      // the seat straight back the moment the kicked player re-entered the
      // code. kickedTok is already captured above, so their sockets still
      // get the close.
      let kevents;
      // A kick must SEVER, which is why an away-seat game concedes here too
      // rather than parking the seat: parking keeps the kicked player's token
      // on it, so they would walk straight back in and the host's only remedy
      // for a staller would be no remedy at all. Their stack cashes out into
      // the standings, same as a "none" table.
      if (this.rejoinMode() === "none" || this.AWAY_ACTION) {
        kevents = this.concedeSeat(s, "kick");
      } else {
        this.closeSpan(s, "kick");   // before the uid goes with the token
        t.seats[s].bot = true; delete t.seats[s].graceUntil; delete t.seats[s].token; delete t.seats[s].uid;
        this.openSpan(s, "takeover");
        kevents = [{ t: "takeover", seat: s }];
      }
      for (const c of this.socketsForToken(kickedTok)) { try { c.ws.send(JSON.stringify({ type: "kicked", serverNow: Date.now() })); } catch (e) {} try { c.ws.close(4403, "kicked"); } catch (e) {} }
      await this.broadcast(kevents);
      this.armAlarm();
      return;
    }

    // Host rematch from the game-over screen: the finished game is discarded
    // and the table drops back to its own lobby, so `phase` turns "lobby" and
    // every lobby verb opens up again. Seats, tokens, colors, bots, settings
    // and the host all live on `t`, not `t.game` — the same players stay put
    // and Start deals a fresh one. Anything a game keeps beside the game is
    // its own to drop in onRematch().
    if (type === "rematch") {
      if (!this.isHost(token)) return this.errTo(ws, "perm");
      if (!t.game || t.game.phase !== "over") return this.errTo(ws, "phase");
      t.game = null;
      t.turnEndsAt = null; t.timerFor = null;
      // a rematch is a NEW result, so it gets the next idempotency key and a
      // clean ledger and archive. The chunks must actually go: the next game
      // numbers from zero again and would otherwise read the old game's.
      t.rematchIndex++;
      t.spans = [];
      await this.resetArchive();
      // conceded seats left for good — the rematch lobby opens them. Any
      // grace window still ticking belongs to the game just discarded: clear
      // it, or the alarm would wake to a takeover with no game to take over.
      for (let ci = 0; ci < t.seats.length; ci++) {
        if (!t.seats[ci]) continue;
        if (t.seats[ci].conceded) { t.seats[ci] = null; continue; }
        delete t.seats[ci].graceUntil;
        delete t.seats[ci].away;      // the next game deals everybody in
      }
      this.resizeSeats();
      this.onRematch();
      await this.broadcast([]);
      this.armAlarm();
      return;
    }

    // Mid-game stand and sit — the hop-out / hop-in pair (docs/games.md,
    // "Identity and rejoin"). Standing is a voluntary exit: the seat is
    // released like a kick (bot holds it, or it concedes at a "none"
    // table) and the stander stays connected as a spectator. Sitting
    // mid-game exists only at an "anyone" table: a spectator adopts a
    // bot-held seat — the seat's color and pieces, their own name.
    if (type === "stand" && t.game && t.game.phase !== "over") {
      const si = this.seatOfToken(token);
      if (si == null) return this.errTo(ws, "perm");
      let sevents;
      if (this.rejoinMode() === "none") {
        sevents = this.concedeSeat(si, "stand");
      } else if ((sevents = this.awaySeat(si))) {
        // parked, not released: the stake stays on the felt and the pill the
        // stander sees reads "Sit out", not "Cash out" (docs/poker.md)
      } else {
        this.closeSpan(si, "stand");
        t.seats[si].bot = true; delete t.seats[si].graceUntil; delete t.seats[si].token; delete t.seats[si].uid;
        this.openSpan(si, "takeover");
        sevents = [{ t: "takeover", seat: si }];
      }
      await this.broadcast(sevents);
      this.armAlarm();
      return;
    }
    if (type === "sit" && t.game && t.game.phase !== "over") {
      if (this.rejoinMode() !== "anyone") return this.errTo(ws, "phase");
      if (this.seatOfToken(token) != null) return this.errTo(ws, "perm");
      const ai = msg.seat;
      const as = ai != null ? t.seats[ai] : null;
      // a bot-held seat, or an away seat nobody is sitting in
      if (!as || !(this.isBot(as) || as.away)) return this.errTo(ws, "full");
      const alower = String(att.name || "").toLowerCase();
      const ataken = t.seats.some((x, xi) => x && xi !== ai && x.name.toLowerCase() === alower);
      if (ataken) return this.errTo(ws, "name-taken");   // connections were checked at join
      // an away seat comes back to life with its stake intact (poker) — the
      // engine deals it in again, the roster hands it to its new occupant
      let aev = [];
      if (as.away && this.ADOPT_ACTION) {
        const ar = this.applyEngine({ type: this.ADOPT_ACTION, seat: ai });
        if (ar.error) return this.errTo(ws, ar.error.code);
        aev = ar.events || [];
      }
      this.closeSpan(ai, "adopted");   // the bot's (or the leaver's) span ends here
      as.name = att.name; as.token = token;
      if (att.uid) as.uid = att.uid; else delete as.uid;
      delete as.bot; delete as.graceUntil; delete as.phantom; delete as.away;
      this.openSpan(ai, "adopt");
      await this.broadcast(aev.concat([{ t: "adopted", seat: ai }]));
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
        if (att.uid) t.seats[idx].uid = att.uid;   // account seat: uid-reclaim from any device
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
      // rename your own seat (lobby-only — names lock at Start like colors).
      // Display only, same clash rule as join and addBot.
      if (type === "rename") {
        const ri = this.seatOfToken(token);
        if (ri == null) return this.errTo(ws, "perm");
        const rname = String(msg.name || "").trim().slice(0, NAME_CAP);
        if (!rname) return this.errTo(ws, "perm");
        const rlower = rname.toLowerCase();
        const rtaken = t.seats.some((s, si) => s && si !== ri && s.name.toLowerCase() === rlower) ||
                       this.joinedSockets().some((s) => s.att.token !== token && s.att.name.toLowerCase() === rlower);
        if (rtaken) return this.errTo(ws, "name-taken");
        t.seats[ri].name = rname;
        // join's clash check reads live att.name too — every socket of this
        // token follows, or the old name stays "taken" and the new one
        // goes unguarded
        for (const c of this.socketsForToken(token)) { c.att.name = rname; c.ws.serializeAttachment(c.att); }
        att.name = rname;
        await this.broadcast([]);
        this.armAlarm();
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
        const btier = this.botTier(msg.tier);
        if (bs) { bs.name = bname; bs.tier = btier; }   // re-adding also re-tiers
        else {
          const bocc = t.seats.map((s, si) => (s && si !== bi) ? s.color : null);
          t.seats[bi] = { token: "phantom:" + crypto.randomUUID().slice(0, 8), name: bname,
                          color: this.Colors.freePreset(bocc), phantom: true, tier: btier };
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
        if (this.teamsReal()) {
          // one color per SIDE, the captain's to set (the host covers a
          // bot-captained team). The clash check runs against the OTHER
          // sides' colors only — teammates share the pick by definition.
          const target = msg.seat != null ? msg.seat : this.seatOfToken(token);
          if (target == null || !t.seats[target]) return this.errTo(ws, "perm");
          const team = this.teamOf(target);
          const capSeat = this.captainSeat(team);
          const capBot = capSeat != null && this.isBot(t.seats[capSeat]);
          if (!(this.seatOfToken(token) === capSeat || (capBot && this.isHost(token)))) return this.errTo(ws, "perm");
          const thex = this.Colors.norm(msg.color);
          if (!thex) return this.errTo(ws, "color");
          const others = Array.from({ length: this.TEAMS }, (_, k) => k === team ? null : this.teamColor(k));
          if (this.Colors.clash(thex, others) >= 0) return this.errTo(ws, "color-taken");
          if (!t.teamColors) t.teamColors = Array.from({ length: this.TEAMS }, (_, k) => this.teamColor(k));
          t.teamColors[team] = thex;
          await this.broadcast([]);
          return;
        }
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
        // rejoin is the base's own key; the rest belongs to the game
        if (msg.rejoin !== undefined) {
          if (this.REJOIN_MODES.indexOf(msg.rejoin) < 0) return this.errTo(ws, "phase");
          t.settings.rejoin = msg.rejoin;
          await this.broadcast([]);
          this.armAlarm();
          return;
        }
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
        if (this.teamsReal()) {
          // even sides or no deal — the shell disables Start for the same
          // reason, so a "teams" refusal should never reach a player
          const counts = this.teamSeatedCounts();
          if (counts.some((c) => c !== counts[0] || !c)) return this.errTo(ws, "teams");
          // stamp the lobby's structural mapping onto the seats BEFORE
          // compaction — seat order is column order, so compacting keeps
          // team 0's players first and teamOf reads the stamp from here on
          t.seats.forEach((s, i) => { if (s) s.team = this.teamOf(i); });
        }
        if (this.compactSeatsAtStart()) t.seats = seated;   // seat index === engine player index
        /* A lobby seat is held indefinitely by design, and onGone opens no
           grace window without a game — so a seat that went dark in the lobby
           would deal in as neither bot nor connected human: no turn clock, no
           bot to drive it, armAlarm falls through to deleteAlarm() and the
           table hangs forever. Convert those seats here instead — to a bot,
           or to an away seat at a game that has no bots to convert them to.
           The host is warned before the press (strings.startBotWarn); the
           takeover (or away) events tell everyone after it. */
        const dark = [];
        for (let i = 0; i < t.seats.length; i++) {
          const s = t.seats[i];
          if (s && !this.isBot(s) && !this.tokenConnected(s.token)) dark.push(i);
        }
        const autoBots = [];
        // a game that parks seats has no bot to convert them to — it deals
        // them in and sends them away below, once there is a game to do it to
        if (!this.AWAY_ACTION) {
          for (const i of dark) { t.seats[i].bot = true; autoBots.push({ t: "takeover", seat: i }); }
        }
        t.game = this.createGame(seated);
        t.startedAt = Date.now();   // the result's `started`; a rematch re-stamps it
        // the ledger opens with the field as dealt — auto-bots above already
        // flipped, so a seat that went dark in the lobby opens as a bot
        t.spans = [];
        for (let i = 0; i < t.seats.length; i++) if (t.seats[i]) this.openSpan(i, "lobby");
        const extra = this.onStart(seated) || [];
        // …and now the parking half: a dark seat at a no-bots game sits out
        // the deal it never showed up for, and walks back in when it does
        if (this.AWAY_ACTION) for (const i of dark) autoBots.push(...(this.awaySeat(i) || []));
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

  /* ---- account identity (docs/accounts.md) ---------------------------------
     The ds_sess cookie is scoped to .deets.solutions, so the browser sends it
     on the WebSocket upgrade to this worker by itself — no client plumbing,
     nothing on the wire. Verify its HMAC against the SHARED session secret
     (`npx wrangler secret put SESSION_SECRET`, same value as DeetsAccounts)
     and a seat can carry an account id no client message could forge. Missing
     secret, missing cookie, bad signature, expired — all degrade to null,
     which is exactly the guest path. token_epoch is deliberately NOT checked
     (that would take the accounts D1): a signed-out-everywhere session keeps
     seat-reclaim rights until its 30-day iat expiry, and it stakes nothing
     but a chair. The uid NEVER rides a view or broadcast — identity is
     hidden info even though it isn't game info. */
  async sessionUid(req) {
    try {
      const secret = this.env.SESSION_SECRET;
      if (!secret) return null;
      const m = /(?:^|;\s*)ds_sess=([^;]+)/.exec(req.headers.get("Cookie") || "");
      if (!m) return null;
      const tok = decodeURIComponent(m[1]);
      const dot = tok.lastIndexOf(".");
      if (dot < 1) return null;
      const payload = tok.slice(0, dot);
      const b64 = (s) => {
        const pad = s.replace(/-/g, "+").replace(/_/g, "/");
        const raw = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
      };
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      if (!(await crypto.subtle.verify("HMAC", key, b64(tok.slice(dot + 1)), enc.encode(payload)))) return null;
      const data = JSON.parse(new TextDecoder().decode(b64(payload)));
      if (!data || typeof data.u !== "string" || !data.u) return null;
      if ((Date.now() / 1000) - (data.iat || 0) > 30 * 86400) return null;   // DeetsAccounts' SESSION_DAYS
      return data.u;
    } catch (e) { return null; }
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
    const uid = await this.sessionUid(req);   // verified BEFORE accept — no attachment gap
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ joined: false, code, uid });   // joined once name is set
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
      const uid = att.uid || null;   // verified at upgrade — never client-supplied
      // reconnect supersedes: reap this device's own lingering sockets
      const mine = this.joinedSockets().filter((s) => s.ws !== ws && token && s.att.token === token);
      const others = this.joinedSockets().filter((s) => s.ws !== ws && !mine.includes(s));
      // Reclaim target: this device's token, or — signed in — the account's
      // seat from ANOTHER device, but only a DARK one: a seat whose token
      // still has a live socket is never pulled out from under its session
      // (hop out first, then in).
      let reclaim = this.seatOfToken(token);
      if (reclaim == null && uid) {
        for (let i = 0; i < t.seats.length; i++) {
          const s = t.seats[i];
          if (s && s.uid === uid && !this.tokenConnected(s.token)) { reclaim = i; break; }
        }
      }
      // clash vs live connections AND seats — the seat being reclaimed doesn't
      // block its own return (same name + same verified identity is you
      // coming back, not an imposter)
      if (others.some((s) => s.att.name.toLowerCase() === name.toLowerCase()) ||
          t.seats.some((s, si) => s && si !== reclaim && s.token !== token && s.name.toLowerCase() === name.toLowerCase())) {
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
        // rejoin is the base's own setting; the game's keys ride alongside
        t.settings = Object.assign({ rejoin: "rejoin" }, this.defaultSettings());
        if (this.teamsReal()) t.teamColors = this.Colors.PRESETS.slice(0, this.TEAMS);
        t.seats = []; this.resizeSeats();
        t.game = null; t.log = []; t.v = 1;
        t.spans = []; t.rematchIndex = 0; t.startedAt = null;
        await this.resetArchive();
        for (const k of Object.keys(this.EXTRA_STATE)) t[k] = this.EXTRA_STATE[k]();
      }
      for (const s of mine) { try { s.ws.close(4408, "replaced"); } catch (e) {} }
      att.joined = true; att.token = token; att.name = name; att.at = Date.now(); att.tie = this.tie++;
      ws.serializeAttachment(att);
      // reconnect reclaim: a returning token — or a verified account uid on a
      // new device — repossesses its seat from the bot
      const seat = reclaim;
      const revents = [];
      if (seat != null) {
        const rs = t.seats[seat];
        // a bot actually held it → the seat changed hands and the ledger says
        // so. A bare graceUntil is the same person reconnecting inside their
        // window: no takeover happened, so no span closed and none opens.
        const wasBot = !!(t.game && t.game.phase !== "over" && rs.bot);
        if (wasBot) this.closeSpan(seat, "reclaimed");
        rs.token = token;        // uid reclaim: the seat follows the account to this device
        if (uid) rs.uid = uid;   // signing in tags the seat on any reclaim
        if (t.game && t.game.phase !== "over" && (rs.bot || rs.graceUntil)) {
          delete rs.bot; delete rs.graceUntil;
          revents.push({ t: "returned", seat });
        }
        if (wasBot) this.openSpan(seat, "reclaim");
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
    // (an away seat has already stepped out: nothing is waiting on it, so a
    // red countdown over it would be a warning about nothing)
    if (seat != null && g && g.phase !== "over" && !this.isBot(t.seats[seat]) &&
        !t.seats[seat].away && !this.tokenConnected(token, ws)) {
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
