/* Deets games — the REAL transport (docs/games.md, "Wire protocol").

   ONE WebSocket client for every game table on the site. Each game's Worker
   (../DeetsCities → cities-api.deets.solutions, ../DeetsMahjong →
   mahjong-api.deets.solutions, ...) is a Durable Object per table speaking
   the same envelope, so the only thing that varies per game is the API host.
   Cities and mahjong each carried a copy of this file until the fundamentals
   pass; six lines differed.

   Surface (identical to the mocks, so a game page can't tell them apart
   beyond `kind`):

     DeetsTransport.create({ api }) → { kind, peek(code), connect(code, opts) }
     connect() → Promise<conn>, conn = { send, onMessage, onStatus, close }

   ?api=<url> points at a local `wrangler dev` worker; honored on localhost
   only, so a shared link can't reroute anyone's table traffic.

   What the adapter owns (invisible to the game page), mirroring radio's rules:
   - reconnect with backoff after an unexpected close, rejoining with the same
     name + token (create:false — a rejoin can never mint a table); surfaced
     through conn.onStatus("down" | "up")
   - state-version gap detection: a skipped `v` means a missed broadcast, so
     force a reconnect and let the fresh snapshot repair the model
   - a 25 s "ping" keepalive the Worker answers without waking the table,
     and a dead-socket check on it: no answer in 10 s counts as a drop
   - a rejoin that never gets its snapshot retries; returning to the tab or
     coming back online checks the socket at once (2026-11-19: players had
     to reload to see a game that had moved on) */
(function () {
  "use strict";

  var PING_MS = 25000;
  var PONG_WAIT_MS = 10000;
  var JOIN_WAIT_MS = 15000;
  var BACKOFF_CAP_MS = 15000;

  // ?api=<url> — localhost only, applies to whichever game asked
  var override = null;
  try {
    var q = new URLSearchParams(location.search).get("api");
    if (q && /^localhost$|^127\./.test(location.hostname)) override = q.replace(/\/+$/, "");
  } catch (e) {}

  function create(cfg) {
    var api = override || String(cfg.api || "").replace(/\/+$/, "");
    var wsBase = api.replace(/^http/, "ws");

    function makeConn(code, opts, resolveFirst, rejectFirst) {
      var handler = null;
      var statusCb = null;
      var buffer = [];         // messages that arrive before the page attaches
      var ws = null;
      var closed = false;      // intentional close — no reconnect
      var lastV = 0;
      var retry = 0;

      function deliver(msg) { if (handler) handler(msg); else buffer.push(msg); }
      function status(s) { if (statusCb) statusCb(s); }

      function settle(fn, arg) {
        if (!resolveFirst) return false;
        var r = fn === "resolve" ? resolveFirst : rejectFirst;
        resolveFirst = rejectFirst = null;
        r(arg);
        return true;
      }

      /* join refusals that end the connection for good — reconnecting would
         just be refused again (no-table), collide again (name-taken), or pile
         on (full). Only refusals of a JOIN are final; the same code answering
         a mid-session action is a plain no (the socket lives), so finality is
         gated on still awaiting the join's snapshot. kicked/closed are final
         the same way. */
      var FINAL = { "no-table": 1, "name-taken": 1, "full": 1 };
      var awaitingJoin = false;

      /* Liveness. A socket can die without closing: a laptop sleeps, the
         wifi changes, a phone locks. Its readyState stays OPEN and onclose
         may not fire for minutes, so the table just looks paused until a
         reload. So every ping must hear SOMETHING back (the pong, or any
         message) within PONG_WAIT_MS, and a reopen must reach its snapshot
         within JOIN_WAIT_MS. Either miss counts as a drop. Coming back to
         the tab or back online checks at once instead of waiting out the
         backoff. */
      var lastHeard = 0, reopenTimer = null, joinTimer = null;
      /* Why the connection last dropped: printed to the console (so a freeze
         can be read in DevTools on the spot) and sent with the rejoin, so
         the worker's log line says it too. The first cause sticks until a
         rejoin lands. */
      var dropWhy = null, droppedAt = 0;
      function noteDrop(why) {
        if (dropWhy) return;
        dropWhy = why; droppedAt = Date.now();
        try { console.warn("[deets-table] " + code + " connection dropped: " + why + " (v" + lastV + ")"); } catch (e) {}
      }

      function open(create) {
        clearTimeout(reopenTimer); reopenTimer = null;
        clearTimeout(joinTimer);
        awaitingJoin = true;
        lastHeard = Date.now();
        var sock = ws = new WebSocket(wsBase + "/table/" + code + "/ws");
        // a reopen that connects but never gets its snapshot retries (the
        // first join keeps its own failure path: the gate's error toast)
        if (!resolveFirst) joinTimer = setTimeout(function () {
          if (sock === ws && awaitingJoin && !closed) resync("join-timeout");
        }, JOIN_WAIT_MS);
        ws.onopen = function () {
          if (sock !== ws) return;
          var join = { type: "join", name: opts.name, create: !!create, token: opts.token };
          if (!resolveFirst) join.why = dropWhy || "reopen";     // a rejoin says why
          ws.send(JSON.stringify(join));
        };
        ws.onmessage = function (ev) {
          if (sock !== ws) return;               // a socket we already gave up on
          lastHeard = Date.now();
          if (ev.data === "pong") return;
          var msg;
          try { msg = JSON.parse(ev.data); } catch (e) { return; }
          if (msg.type === "error" && FINAL[msg.code] && awaitingJoin) {
            if (!resolveFirst) try { console.warn("[deets-table] " + code + " rejoin refused: " + msg.code); } catch (e) {}
            closed = true;                       // a refusal is final, not a drop
            stopWaking();
            try { ws.close(); } catch (e) {}
            if (!settle("reject", { code: msg.code })) deliver(msg);
            return;
          }
          if (msg.type === "kicked" || msg.type === "closed") {
            closed = true;                       // the table ended it — stay gone
            stopWaking();
            deliver(msg);
            return;
          }
          if (msg.type === "snapshot") {
            lastV = msg.v;
            retry = 0;
            awaitingJoin = false;
            clearTimeout(joinTimer);
            if (dropWhy) {
              try { console.info("[deets-table] " + code + " back after " + Math.round((Date.now() - droppedAt) / 1000) + " s (" + dropWhy + "), v" + msg.v); } catch (e) {}
              dropWhy = null;
            }
            if (!settle("resolve", conn)) status("up");   // a rejoin, not the join
            deliver(msg);
            return;
          }
          if (msg.type === "state") {
            if (msg.v > lastV + 1) { resync("v-gap " + lastV + ">" + msg.v); return; }  // missed a broadcast
            lastV = msg.v;
          }
          deliver(msg);
        };
        ws.onclose = function (ev) {
          if (closed || sock !== ws) return;
          /* 4408 = the table replaced this socket: another tab on this device
             joined with the same token. Reconnecting would evict that tab,
             which would reconnect and evict us — an endless ping-pong. Stay
             down and let the page say which tab won. */
          if (ev && ev.code === 4408) {
            closed = true;
            stopWaking();
            if (!settle("reject", { code: "replaced" })) deliver({ type: "replaced" });
            return;
          }
          if (settle("reject", { code: "socket" })) {       // died before joining
            closed = true;
            stopWaking();
            return;
          }
          noteDrop("close:" + (ev && ev.code));
          status("down");
          scheduleReopen();
        };
      }

      // drop this socket and reopen. Its handlers go quiet first (they check
      // `sock === ws`), so a late close code from it — 4408 above all — can't
      // end the fresh connection.
      function resync(why) {
        noteDrop(why || "resync");
        var old = ws;
        ws = null;
        clearTimeout(joinTimer);
        try { old.close(); } catch (e) {}
        status("down");
        scheduleReopen();
      }
      function scheduleReopen() {
        if (reopenTimer || closed) return;              // one reopen at a time
        var delay = Math.min(BACKOFF_CAP_MS, 1000 * Math.pow(2, retry++));
        delay = delay * (0.75 + Math.random() * 0.5);       // jitter
        reopenTimer = setTimeout(function () { reopenTimer = null; if (!closed) open(false); }, delay);
      }
      // ping, and give up on the socket if nothing comes back in time
      function probe() {
        if (!ws || ws.readyState !== 1) return;
        var sock = ws, sentAt = Date.now();
        try { ws.send("ping"); } catch (e) {}
        setTimeout(function () {
          if (!closed && sock === ws && lastHeard < sentAt) resync("pong");
        }, PONG_WAIT_MS);
      }
      var pinger = setInterval(probe, PING_MS);

      // back on the tab, or back online: check now, not at the next ping.
      // A socket already down skips the rest of its backoff.
      function wake() {
        if (closed || (document.visibilityState && document.visibilityState !== "visible")) return;
        if (ws && ws.readyState === 1) { probe(); return; }
        if (ws && ws.readyState === 0) return;          // connecting: the join timer covers it
        if (!resolveFirst) { noteDrop("closed-on-wake"); status("down"); retry = 0; clearTimeout(reopenTimer); reopenTimer = null; open(false); }
      }
      document.addEventListener("visibilitychange", wake);
      window.addEventListener("online", wake);
      window.addEventListener("pageshow", wake);
      function stopWaking() {
        clearInterval(pinger);
        clearTimeout(reopenTimer); clearTimeout(joinTimer);
        document.removeEventListener("visibilitychange", wake);
        window.removeEventListener("online", wake);
        window.removeEventListener("pageshow", wake);
      }

      var conn = {
        send: function (msg) {
          if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
        },
        onMessage: function (cb) {
          handler = cb;
          while (buffer.length) cb(buffer.shift());
        },
        onStatus: function (cb) { statusCb = cb; },
        close: function () {
          closed = true;
          stopWaking();
          try { ws.close(); } catch (e) {}
        }
      };
      open(!!opts.create);
      return conn;
    }

    return {
      kind: "real",

      /* GET /table/{code}/peek → {exists, phase, seated, capacity, spectators,
         mine, adoptable}. The token rides a header (never the URL) and the
         session cookie rides along, so the table can say whether a seat is
         already this device's or this account's. */
      peek: function (code, token) {
        return fetch(api + "/table/" + encodeURIComponent(code) + "/peek", {
          credentials: "include",
          headers: token ? { "X-Table-Token": token } : {}
        })
          .then(function (res) {
            if (!res.ok) throw new Error("peek " + res.status);
            return res.json();
          });
      },

      /* wss connect + join in one call (the contract the mock set) */
      connect: function (code, opts) {
        return new Promise(function (resolve, reject) {
          makeConn(code, opts, resolve, reject);
        });
      }
    };
  }

  window.DeetsTransport = { create: create };
})();
