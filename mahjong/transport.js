/* DeetsMahjong — REAL transport (docs/mahjong.md, "Architecture" + "State &
   wire protocol").

   The WebSocket client for the table Worker (../DeetsMahjong →
   mahjong-api.deets.solutions, a Durable Object per table). Same surface as
   transport-mock.js — peek / connect(code, opts) → conn (send / onMessage /
   onStatus / close) — so mahjong.js can't tell them apart beyond `kind`.
   Loaded after the mock and takes over window.MahjongTransport unless the
   page runs with ?mock (the mock stays in the repo as a dev tool).

   Phase 1 ships this file so mahjong.js is transport-agnostic; the worker
   itself lands in Phase 2 (../DeetsMahjong). Until then, ?mock is the way in
   and the default (no worker) simply fails to connect — expected.

   ?api=<url> points at a local `wrangler dev` worker; honored on localhost
   only, so a shared link can't reroute anyone's table traffic.

   What the adapter owns (invisible to mahjong.js), mirroring cities/radio:
   - reconnect with backoff after an unexpected close, rejoining with the same
     name + token (create:false — a rejoin can never mint a table); surfaced
     through conn.onStatus("down" | "up")
   - state-version gap detection: a skipped `v` means a missed broadcast, so
     force a reconnect and let the fresh snapshot repair the model
   - a 25 s "ping" keepalive the Worker answers without waking the table */
(function () {
  "use strict";

  var DEFAULT_API = "https://mahjong-api.deets.solutions";
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
    var buffer = [];
    var ws = null;
    var closed = false;
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
          closed = true;
          clearInterval(pinger);
          try { ws.close(); } catch (e) {}
          if (!settle("reject", { code: msg.code })) deliver(msg);
          return;
        }
        if (msg.type === "kicked" || msg.type === "closed") {
          closed = true;
          clearInterval(pinger);
          deliver(msg);
          return;
        }
        if (msg.type === "snapshot") {
          lastV = msg.v;
          retry = 0;
          awaitingJoin = false;
          if (!settle("resolve", conn)) status("up");
          deliver(msg);
          return;
        }
        if (msg.type === "state") {
          if (msg.v > lastV + 1) { resync(); return; }
          lastV = msg.v;
        }
        deliver(msg);
      };
      ws.onclose = function () {
        if (closed) return;
        if (settle("reject", { code: "socket" })) {
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
      delay = delay * (0.75 + Math.random() * 0.5);
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

    /* GET /table/{code}/peek → {exists, phase, seated, capacity, spectators} */
    peek: function (code) {
      return fetch(api + "/table/" + encodeURIComponent(code) + "/peek")
        .then(function (res) {
          if (!res.ok) throw new Error("peek " + res.status);
          return res.json();
        });
    },

    connect: function (code, opts) {
      return new Promise(function (resolve, reject) {
        makeConn(code, opts, resolve, reject);
      });
    }
  };

  var useMock = false;
  try { useMock = new URLSearchParams(location.search).has("mock"); } catch (e) {}
  if (!useMock) window.MahjongTransport = REAL;
})();
