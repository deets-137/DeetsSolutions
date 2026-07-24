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
   - a 25 s "ping" keepalive the Worker answers without waking the table */
(function () {
  "use strict";

  var PING_MS = 25000;
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

      function open(create) {
        awaitingJoin = true;
        ws = new WebSocket(wsBase + "/table/" + code + "/ws");
        ws.onopen = function () {
          ws.send(JSON.stringify({
            type: "join", name: opts.name, create: !!create, token: opts.token
          }));
        };
        ws.onmessage = function (ev) {
          if (ev.data === "pong") return;
          var msg;
          try { msg = JSON.parse(ev.data); } catch (e) { return; }
          if (msg.type === "error" && FINAL[msg.code] && awaitingJoin) {
            closed = true;                       // a refusal is final, not a drop
            clearInterval(pinger);
            try { ws.close(); } catch (e) {}
            if (!settle("reject", { code: msg.code })) deliver(msg);
            return;
          }
          if (msg.type === "kicked" || msg.type === "closed") {
            closed = true;                       // the table ended it — stay gone
            clearInterval(pinger);
            deliver(msg);
            return;
          }
          if (msg.type === "snapshot") {
            lastV = msg.v;
            retry = 0;
            awaitingJoin = false;
            if (!settle("resolve", conn)) status("up");   // a rejoin, not the join
            deliver(msg);
            return;
          }
          if (msg.type === "state") {
            if (msg.v > lastV + 1) { resync(); return; }  // missed a broadcast
            lastV = msg.v;
          }
          deliver(msg);
        };
        ws.onclose = function (ev) {
          if (closed) return;
          /* 4408 = the table replaced this socket: another tab on this device
             joined with the same token. Reconnecting would evict that tab,
             which would reconnect and evict us — an endless ping-pong. Stay
             down and let the page say which tab won. */
          if (ev && ev.code === 4408) {
            closed = true;
            clearInterval(pinger);
            if (!settle("reject", { code: "replaced" })) deliver({ type: "replaced" });
            return;
          }
          if (settle("reject", { code: "socket" })) {       // died before joining
            closed = true;
            clearInterval(pinger);
            return;
          }
          status("down");
          scheduleReopen();
        };
      }

      function resync() {
        try { ws.onclose = null; ws.close(); } catch (e) {}
        status("down");
        scheduleReopen();
      }
      function scheduleReopen() {
        var delay = Math.min(BACKOFF_CAP_MS, 1000 * Math.pow(2, retry++));
        delay = delay * (0.75 + Math.random() * 0.5);       // jitter
        setTimeout(function () { if (!closed) open(false); }, delay);
      }

      var pinger = setInterval(function () {
        if (ws && ws.readyState === 1) ws.send("ping");
      }, PING_MS);

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
          clearInterval(pinger);
          try { ws.close(); } catch (e) {}
        }
      };
      open(!!opts.create);
      return conn;
    }

    return {
      kind: "real",

      /* GET /table/{code}/peek → {exists, phase, seated, capacity, spectators} */
      peek: function (code) {
        return fetch(api + "/table/" + encodeURIComponent(code) + "/peek")
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
