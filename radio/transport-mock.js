/* DeetsRadio — MOCK transport (docs/radio.md, "Build order (UI first)").

   An in-page fake of the room Worker that speaks the wire protocol
   VERBATIM — snapshot, versioned `state` broadcasts, `presence` — and runs
   the real transport rules (scheduled starts with a countdown lead,
   alarm-driven seamless track-end advancement, pause-mid-countdown, back).
   radio.js must not be able to tell it apart from the WebSocket client,
   apart from `RadioTransport.kind === "mock"`.

   DEV-ONLY details, all clearly fake and all replaced in later phases:
   - a tiny built-in catalog (search is a substring match with fake latency)
   - generated SVG "album art" data URIs (hue hashed from the album name)
   - short track durations (40–80 s) so track-end advancement is watchable
   - a phantom listener who joins and queues a song, so multi-user states
     render without a second browser (kill via RadioTransport.phantom=false)
   - rooms persist in localStorage, so durable-room behavior (rejoin a
     "playing" empty room mid-song) is demoable across reloads

   No audio plays in this phase — the clock runs, the UI follows. */
(function () {
  "use strict";

  var LEAD = 3500;      // ms between a human start command and the music
  var LATENCY = 150;    // fake command→broadcast round trip; keeps us honest
  var STORE_KEY = "deets-radio-mock-v1";

  /* ── fake catalog ─────────────────────────────────────────────── */
  function art(album) {
    var h = 0;
    for (var i = 0; i < album.length; i++) h = (h * 31 + album.charCodeAt(i)) % 360;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
      '<rect width="96" height="96" fill="hsl(' + h + ',38%,42%)"/>' +
      '<circle cx="48" cy="48" r="26" fill="hsl(' + ((h + 40) % 360) + ',44%,58%)"/>' +
      '<circle cx="48" cy="48" r="7" fill="hsl(' + h + ',30%,24%)"/></svg>';
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }
  function song(id, title, artist, album, sec) {
    return {
      isrc: "MOCK" + String(id).padStart(8, "0"),
      title: title, artist: artist, album: album,
      artworkUrl: art(album),
      apple: { id: "mock." + id, durationMs: sec * 1000 },
      spotify: null,
      previewUrl: null,
      durationMs: sec * 1000,
      match: "single"
    };
  }
  var CATALOG = [
    song(1,  "Glass Pavilion",     "Nightjar Council",   "Atrium Sessions",   62),
    song(2,  "Sodium Lights",      "Nightjar Council",   "Atrium Sessions",   55),
    song(3,  "Left at the Harbor", "Peach Static",       "Postcard Weather",  48),
    song(4,  "Long Way Down",      "Peach Static",       "Postcard Weather",  71),
    song(5,  "Ferrofluid",         "MODEM DREAMS",       "Signal / Noise",    44),
    song(6,  "Dial Tone Serenade", "MODEM DREAMS",       "Signal / Noise",    59),
    song(7,  "Juniper & Smoke",    "The Hollow Orchard", "Wintering",         66),
    song(8,  "Wintering",          "The Hollow Orchard", "Wintering",         77),
    song(9,  "Six Lane Sunset",    "Overpass Choir",     "Merge Lanes",       52),
    song(10, "Brake Lights",       "Overpass Choir",     "Merge Lanes",       47),
    song(11, "Coriander",          "Mint Condition Yeti","Cryptid Cookbook",  41),
    song(12, "Basilisk Brunch",    "Mint Condition Yeti","Cryptid Cookbook",  58),
    song(13, "Penumbra Waltz",     "Ada & the Umbra",    "Eclipse Etiquette", 64),
    song(14, "Corona",             "Ada & the Umbra",    "Eclipse Etiquette", 73),
    song(15, "Chalk Outlines",     "Detective Season",   "Cold Cases, Warm Coffee", 50),
    song(16, "Warm Coffee",        "Detective Season",   "Cold Cases, Warm Coffee", 68),
    song(17, "Tidepool FM",        "Brine & Byrne",      "Littoral Drift",    46),
    song(18, "Undertow",           "Brine & Byrne",      "Littoral Drift",    61),
    song(19, "Peregrine",          "Skyware",            "Thermals",          54),
    song(20, "Updraft",            "Skyware",            "Thermals",          49),
    song(21, "Neon Herbarium",     "Botany Dept.",       "Grow Lights",       57),
    song(22, "Chlorophyll",        "Botany Dept.",       "Grow Lights",       63),
    song(23, "Last Train Confetti","Platform Nine",      "Departures Board",  45),
    song(24, "Departures Board",   "Platform Nine",      "Departures Board",  70)
  ];

  /* ── persisted room store ─────────────────────────────────────── */
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ rooms: persistable() })); }
    catch (e) {}
  }
  function persistable() {
    var out = {};
    Object.keys(ROOMS).forEach(function (id) {
      var r = ROOMS[id];
      out[id] = { room: r.room, transport: r.transport, current: r.current,
                  queue: r.queue, history: r.history, v: r.v,
                  caps: r.caps || {}, touched: r.touched || 0 };
    });
    return out;
  }

  var ROOMS = {};   // id → { room, transport, current, queue, history, v, conns[], timer, phantomDone }
  (function boot() {
    var saved = loadStore().rooms || {};
    Object.keys(saved).forEach(function (id) {
      var s = saved[id];
      /* the 1 h idle+empty expiry, mock edition: a stale idle room doesn't
         survive the reload (the worker's alarm fuse does this for real) */
      if (!(s.transport && s.transport.playing) &&
          Date.now() - (s.touched || 0) > 3600000) return;
      ROOMS[id] = { room: s.room, transport: s.transport, current: s.current,
                    queue: s.queue || [], history: s.history || [], v: s.v || 1,
                    caps: s.caps || {}, conns: [], timer: null,
                    phantomDone: false, touched: s.touched || 0 };
      armAlarm(ROOMS[id]);   // a reloaded "playing" room picks its clock back up
    });
  })();

  /* function declarations, not var-assigned expressions: boot() above runs
     at load and re-arms the alarm of a restored PLAYING room, which calls
     now() — a var here would still be undefined at that moment (the crash
     only ever showed with a playing room persisted in localStorage) */
  function now() { return Date.now(); }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  /* ── identity + capabilities (mirror the worker verbatim) ─────── */
  function normName(s) {
    return String(s).trim().replace(/\s+/g, " ").toLowerCase();
  }
  function modeDefault(r) {
    return r.room && r.room.settings && r.room.settings.mode === "restricted"
      ? { queue: "r", player: "r" }
      : { queue: "e", player: "e" };
  }
  /* owner = the creator whenever their token is connected; join-order
     fallback (index 0) when the creator is away */
  function ownerIndex(r) {
    if (!r.conns.length) return -1;
    var t = r.room && r.room.ownerToken;
    if (t) for (var i = 0; i < r.conns.length; i++) {
      if (r.conns[i].token === t) return i;
    }
    return 0;
  }
  function capsOf(r, conn) {
    var own = ownerIndex(r);
    if (own >= 0 && r.conns[own] === conn) return { queue: "e", player: "e" };
    var c = conn.token && r.caps[conn.token];
    return c ? { queue: c.queue, player: c.player } : modeDefault(r);
  }
  var QUEUE_VERBS = { add: 1, remove: 1, reorder: 1 };
  var PLAYER_VERBS = { play: 1, pause: 1, skip: 1, back: 1 };

  /* ── transport rules (mirror docs/radio.md exactly) ───────────── */
  function position(r) {
    var t = r.transport;
    if (!r.current) return 0;
    if (!t.playing) return t.pausedPosition || 0;
    return Math.max(0, now() - t.startedAt);
  }
  function armAlarm(r) {
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    var t = r.transport;
    if (!r.current || !t.playing) return;
    var endAt = t.startedAt + r.current.durationMs;
    r.timer = setTimeout(function () { trackEnd(r); }, Math.max(0, endAt - now()));
  }
  function advance(r, startedAt) {
    if (r.current) {
      r.history.push(r.current);
      if (r.history.length > 500) r.history.splice(0, r.history.length - 500);
    }
    r.current = r.queue.shift() || null;
    if (r.current) {
      r.transport.playing = true;
      r.transport.startedAt = startedAt;
      r.transport.pausedPosition = null;
    } else {
      r.transport.playing = false;
      r.transport.startedAt = null;
      r.transport.pausedPosition = null;
    }
  }
  function trackEnd(r) {
    var prevEnd = r.transport.startedAt + (r.current ? r.current.durationMs : 0);
    advance(r, prevEnd);          // seamless: next starts at the exact boundary
    armAlarm(r);
    broadcast(r, delta(r, ["transport", "current", "queue", "history"]));
  }
  var COMMANDS = {
    play: function (r) {
      var t = r.transport;
      if (t.playing) return null;
      if (r.current) {                       // resume from pause — countdown
        /* pausedPosition stays: clients read the countdown lead off
           startedAt + pausedPosition and hold position frozen through it */
        t.startedAt = now() + LEAD - (t.pausedPosition || 0);
        t.playing = true;
      } else if (r.queue.length) {           // play from idle — countdown
        advance(r, now() + LEAD);
      } else return null;
      return ["transport", "current", "queue", "history"];
    },
    pause: function (r) {
      var t = r.transport;
      if (!t.playing || !r.current) return null;
      /* pause mid-countdown cancels to where it counted from (a fresh
         start counted from zero, a resume from its pausedPosition) */
      t.pausedPosition = t.startedAt + (t.pausedPosition || 0) > now()
        ? (t.pausedPosition || 0)
        : Math.max(0, now() - t.startedAt);
      t.playing = false;
      t.startedAt = null;
      return ["transport"];
    },
    skip: function (r) {
      if (!r.current && !r.queue.length) return null;
      advance(r, now() + LEAD);
      return ["transport", "current", "queue", "history"];
    },
    back: function (r) {
      if (!r.history.length) return null;
      if (r.current) r.queue.unshift(r.current);   // current returns to the front
      r.current = r.history.pop();
      r.transport.playing = true;
      r.transport.startedAt = now() + LEAD;
      r.transport.pausedPosition = null;
      return ["transport", "current", "queue", "history"];
    },
    add: function (r, msg, conn) {
      var e = msg.entry;
      if (!e || !e.title) return null;
      var entry = JSON.parse(JSON.stringify(e));
      entry.entryId = uid();
      entry.addedBy = (conn && conn.name) || "?";
      entry.addedAt = now();
      if (typeof msg.at === "number") r.queue.splice(Math.max(0, msg.at), 0, entry);
      else r.queue.push(entry);
      var fields = ["queue"];
      if (!r.current) {                      // first add while idle starts play
        advance(r, now() + LEAD);
        fields = ["transport", "current", "queue", "history"];
      }
      return fields;
    },
    remove: function (r, msg) {
      var i = indexOf(r.queue, msg.entryId);
      if (i < 0) return null;
      r.queue.splice(i, 1);
      return ["queue"];
    },
    reorder: function (r, msg) {
      var i = indexOf(r.queue, msg.entryId);
      if (i < 0) return null;
      var e = r.queue.splice(i, 1)[0];
      var to = Math.max(0, Math.min(r.queue.length, msg.to | 0));
      r.queue.splice(to, 0, e);
      return ["queue"];
    },
    rename: function (r, msg, conn) {
      if (!conn || !msg.name) return null;
      var name = String(msg.name).slice(0, 40);
      /* per-room unique names, same line the join holds */
      var clash = r.conns.some(function (c) {
        return c !== conn && normName(c.name) === normName(name);
      });
      if (clash) { deliver(conn, { type: "error", code: "name-taken" }); return null; }
      conn.name = name;
      presence(r);
      return null;
    }
  };
  function indexOf(list, entryId) {
    for (var i = 0; i < list.length; i++) if (list[i].entryId === entryId) return i;
    return -1;
  }

  /* ── wire messages ────────────────────────────────────────────── */
  /* join-ordered roster: name + opaque handle (what setCap/kick target;
     tokens are secrets and never ride the wire) + current caps */
  function roster(r) {
    var own = ownerIndex(r);
    return {
      owner: own,
      listeners: r.conns.map(function (c, i) {
        return {
          name: c.name, h: c.h,
          caps: i === own ? { queue: "e", player: "e" } : capsOf(r, c)
        };
      })
    };
  }
  function snapshot(r) {
    var ro = roster(r);
    return {
      type: "snapshot", v: r.v, serverNow: now(),
      room: r.room,
      transport: r.transport,
      current: r.current,
      queue: r.queue,
      history: r.history.slice(-50),
      listeners: ro.listeners,
      owner: ro.owner
    };
  }
  function delta(r, fields) {
    var msg = { type: "state", v: 0, serverNow: 0 };   // v/serverNow stamped at send
    fields.forEach(function (f) {
      msg[f] = f === "history" ? r.history.slice(-50) : r[f === "transport" ? "transport" : f];
    });
    if (fields.indexOf("transport") >= 0) msg.transport = r.transport;
    return msg;
  }
  function deliver(conn, msg) {
    setTimeout(function () {
      if (conn.closed || !conn.handler) return;
      conn.handler(JSON.parse(JSON.stringify(msg)));
    }, LATENCY);
  }
  function broadcast(r, msg) {
    r.v++;
    r.touched = now();
    msg.v = r.v;
    msg.serverNow = now();
    r.conns.forEach(function (c) { deliver(c, msg); });
    saveStore();
  }
  /* presence is personalized (mirrors the worker): the join-ordered roster,
     the owner (creator's token, join-order fallback), and `you` — yours */
  function presence(r) {
    var ro = roster(r);
    r.conns.forEach(function (c, i) {
      deliver(c, { type: "presence", serverNow: now(),
                   listeners: ro.listeners, owner: ro.owner, you: i });
    });
  }

  /* ── phantom listener (dev-only multi-user simulation) ────────── */
  function maybePhantom(r) {
    if (!API.phantom || r.phantomDone || r.conns.length !== 1) return;
    r.phantomDone = true;
    var ghost = { name: API.phantomName, token: "mock-phantom", h: uid(),
                  handler: null, closed: false };
    setTimeout(function () {
      if (!r.conns.length) return;         // everyone left; stay gone
      r.conns.push(ghost);
      presence(r);
      setTimeout(function () {
        if (r.conns.indexOf(ghost) < 0) return;
        var pick = CATALOG[Math.floor(Math.random() * CATALOG.length)];
        var fields = COMMANDS.add(r, { entry: pick }, ghost);
        if (fields) { armAlarm(r); broadcast(r, delta(r, fields)); }
      }, 8000);
    }, 8000);
  }

  /* ── public API (same shape the real transport will have) ─────── */
  var API = {
    kind: "mock",
    LEAD: LEAD,
    phantom: true,
    phantomName: "Mockingbird (mock)",

    /* GET /room/{id}/peek */
    peek: function (code) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          var r = ROOMS[code];
          if (!r) return resolve({ exists: false });
          resolve({
            exists: true,
            playing: !!(r.transport.playing && r.current),
            nowPlaying: r.current ? { title: r.current.title, artist: r.current.artist } : null,
            listeners: r.conns.length
          });
        }, LATENCY);
      });
    },

    /* wss connect + join in one call (the real client does the same) */
    connect: function (code, opts) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          var r = ROOMS[code];
          if (!r && !opts.create) return reject({ code: "no-room" });
          var token = typeof opts.token === "string" ? opts.token.slice(0, 64) : "";
          var name = String(opts.name || "?").slice(0, 40);
          if (r) {
            /* reap-or-replace: the same device token supersedes its own
               lingering connection instead of colliding with itself */
            r.conns.slice().forEach(function (c) {
              if (token && c.token === token) {
                c.closed = true;
                r.conns.splice(r.conns.indexOf(c), 1);
              }
            });
            /* per-room unique names (worker parity) */
            var clash = r.conns.some(function (c) {
              return normName(c.name) === normName(name);
            });
            if (clash) return reject({ code: "name-taken" });
            if (r.conns.length >= 32) return reject({ code: "full" });
          }
          if (!r) {
            r = ROOMS[code] = {
              room: { id: code, createdAt: now(),
                      settings: { requireBothCatalogs: false, mode: "open" },
                      ownerToken: token || null },
              transport: { playing: false, startedAt: null, pausedPosition: null },
              current: null, queue: [], history: [], v: 1,
              caps: {}, conns: [], timer: null, phantomDone: false
            };
            saveStore();
          }
          var conn = {
            name: name,
            token: token,
            h: uid(),
            handler: null,
            closed: false,
            onMessage: function (cb) { conn.handler = cb; },
            send: function (msg) {
              setTimeout(function () {
                if (conn.closed) return;
                if (msg.type === "close") {   // owner only — signs the station off
                  var own = ownerIndex(r);
                  if (own < 0 || r.conns[own] !== conn) return;
                  r.conns.slice().forEach(function (c) {
                    deliver(c, { type: "closed", serverNow: now() });
                  });
                  if (r.timer) { clearTimeout(r.timer); r.timer = null; }
                  delete ROOMS[code];
                  saveStore();
                  return;
                }
                /* owner-only moderation (worker parity): grants, kick, mode */
                if (msg.type === "setCap" || msg.type === "kick" || msg.type === "setMode") {
                  var ownM = ownerIndex(r);
                  if (ownM < 0 || r.conns[ownM] !== conn) {
                    deliver(conn, { type: "error", code: "perm" });
                    return;
                  }
                  if (msg.type === "setMode") {
                    var mode = msg.mode === "restricted" ? "restricted" : "open";
                    if (r.room.settings.mode === mode) return;
                    r.room.settings.mode = mode;
                    broadcast(r, delta(r, ["room"]));
                    presence(r);
                    return;
                  }
                  var target = null;
                  r.conns.forEach(function (c) { if (c.h === msg.t) target = c; });
                  if (!target || target === conn) return;  // no self-kick / self-demote
                  if (msg.type === "kick") {
                    /* a kick is just a kick — disconnect, no ban (2026-07-14).
                       Don't flag the conn closed here: deliver() checks the
                       flag at fire time, and the kicked message still has to
                       land (the client closes its side on receipt). */
                    deliver(target, { type: "kicked", serverNow: now() });
                    r.conns.splice(r.conns.indexOf(target), 1);
                    presence(r);
                    return;
                  }
                  var cap = msg.cap === "player" ? "player" : msg.cap === "queue" ? "queue" : null;
                  var level = msg.level === "r" || msg.level === "e" ? msg.level : null;
                  if (!cap || !level || !target.token) return;
                  var cur = Object.assign(modeDefault(r), r.caps[target.token]);
                  cur[cap] = level;
                  r.caps[target.token] = cur;
                  saveStore();
                  presence(r);
                  return;
                }
                var fn = COMMANDS[msg.type];
                if (!fn) return;
                /* capability enforcement — mirrors the worker's choke point */
                var need = QUEUE_VERBS[msg.type] ? "queue"
                         : PLAYER_VERBS[msg.type] ? "player" : null;
                if (need && capsOf(r, conn)[need] !== "e") {
                  deliver(conn, { type: "error", code: "perm" });
                  return;
                }
                var fields = fn(r, msg, conn);
                if (fields) { armAlarm(r); broadcast(r, delta(r, fields)); }
              }, LATENCY);
            },
            close: function () {
              conn.closed = true;
              var i = r.conns.indexOf(conn);
              if (i >= 0) { r.conns.splice(i, 1); presence(r); }
            }
          };
          r.conns.push(conn);
          r.touched = now();
          deliver(conn, Object.assign(snapshot(r), {
            you: r.conns.indexOf(conn)
          }));
          presence(r);
          maybePhantom(r);
          resolve(conn);
        }, LATENCY);
      });
    },

    /* catalog search (phase 2: browser → Apple, developer token) */
    search: function (term) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          var q = String(term || "").toLowerCase().trim();
          if (!q) return resolve([]);
          resolve(CATALOG.filter(function (t) {
            return (t.title + " " + t.artist + " " + t.album).toLowerCase().indexOf(q) >= 0;
          }).map(function (t) { return JSON.parse(JSON.stringify(t)); }));
        }, 250);
      });
    },

    /* catalog-gap report — the real transport POSTs /gaps; no server here */
    reportGap: function () {},

    /* dev reset: RadioTransport.wipe() in the console */
    wipe: function () {
      Object.keys(ROOMS).forEach(function (id) {
        if (ROOMS[id].timer) clearTimeout(ROOMS[id].timer);
      });
      ROOMS = {};
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    }
  };

  window.RadioTransport = API;
})();
