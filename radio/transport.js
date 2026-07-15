/* DeetsRadio — REAL transport (docs/radio.md, "Architecture" + "Protocol").

   The WebSocket client for the room Worker (../DeetsRadio →
   radio-api.deets.solutions, a Durable Object per room). Same surface as
   transport-mock.js — peek / connect(code, opts) → conn — so radio.js can't
   tell them apart beyond `kind`. Loaded after the mock and takes over
   window.RadioTransport unless the page runs with ?mock (the mock stays in
   the repo as a dev tool, query-flag selected — decided in docs/radio.md).

   ?api=<url> points at a local `wrangler dev` worker; honored on localhost
   only, so a shared link can't reroute anyone's room traffic.

   What the adapter owns (invisible to radio.js):
   - reconnect with backoff after an unexpected close, rejoining with the
     same name (`create:false` — a rejoin can never mint a room); surfaced
     through conn.onStatus("down" | "up")
   - state-version gap detection: a skipped `v` means a missed broadcast, so
     force a reconnect and let the fresh snapshot repair the model
   - a 25 s "ping" keepalive the Worker answers without waking the room */
(function () {
  "use strict";

  var DEFAULT_API = "https://radio-api.deets.solutions";
  var PING_MS = 25000;
  var BACKOFF_CAP_MS = 15000;

  var api = DEFAULT_API;
  try {
    var override = new URLSearchParams(location.search).get("api");
    if (override && /^localhost$|^127\./.test(location.hostname)) {
      api = override.replace(/\/+$/, "");
    }
  } catch (e) {}
  var wsBase = api.replace(/^http/, "ws");

  function makeConn(code, opts, resolveFirst, rejectFirst) {
    var handler = null;
    var statusCb = null;
    var buffer = [];       // messages that arrive before radio.js attaches
    var ws = null;
    var closed = false;    // intentional close — no reconnect
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
       just be refused again (no-room), collide again (name-taken), or pile
       on (full). Only refusals of a JOIN are final: the same name-taken
       code answering a mid-session rename is a plain no (the socket lives),
       so finality is gated on still awaiting the join's snapshot.
       kicked/closed below are final the same way. */
    var FINAL = { "no-room": 1, "name-taken": 1, "full": 1 };
    var awaitingJoin = false;

    function open(create) {
      awaitingJoin = true;
      ws = new WebSocket(wsBase + "/room/" + code + "/ws");
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
          /* joining: reject the connect promise. Already in (a rejoin was
             refused — e.g. our name got taken while we were down): pass the
             error through so the page can land back at the gate. */
          if (!settle("reject", { code: msg.code })) deliver(msg);
          return;
        }
        if (msg.type === "kicked" || msg.type === "closed") {
          closed = true;                       // the room ended it — stay gone
          clearInterval(pinger);
          deliver(msg);
          return;
        }
        if (msg.type === "snapshot") {
          lastV = msg.v;
          retry = 0;
          awaitingJoin = false;
          if (!settle("resolve", conn)) status("up");  // a rejoin, not the join
          deliver(msg);
          return;
        }
        if (msg.type === "state") {
          if (msg.v > lastV + 1) { resync(); return; } // missed a broadcast
          lastV = msg.v;
        }
        deliver(msg);
      };
      ws.onclose = function () {
        if (closed) return;
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
      delay = delay * (0.75 + Math.random() * 0.5);   // jitter
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

  var REAL = {
    kind: "real",

    /* GET /room/{code}/peek */
    peek: function (code) {
      return fetch(api + "/room/" + encodeURIComponent(code) + "/peek")
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
    },

    /* Catalog search belongs to apple.js on this transport; radio.js only
       falls back here while the dev token is the null stub. */
    search: function () { return Promise.resolve([]); },

    /* POST /gaps — best-effort catalog-gap report (docs/radio.md, graduated
       from console-only). The body rides the default text/plain so the
       request stays CORS-simple (no preflight); failures are swallowed —
       a gap report must never bother a listener. */
    reportGap: function (info) {
      try {
        fetch(api + "/gaps", { method: "POST", body: JSON.stringify(info) })
          .catch(function () {});
      } catch (e) {}
    }
  };

  var useMock = false;
  try { useMock = new URLSearchParams(location.search).has("mock"); } catch (e) {}
  if (!useMock) window.RadioTransport = REAL;
})();
