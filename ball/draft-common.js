/* DeetsBall draft — what the host page and the GM page share.

   The draft lives in the DeetsBall repo's draft worker (worker/src/index.js):
   one Durable Object per room, spoken to over a WebSocket. The worker's
   rules are worker/src/draft.js. Quick demo code (the owner, 2026-11-25).

   API host: https://ball-api.deets.solutions. On localhost, ?api=<url>
   points the pages at a local `npm run worker:dev` worker, and the page
   remembers it in localStorage for the next load. */
(function () {
  "use strict";

  var S = window.BALL_STRINGS || {};
  var API = "https://ball-api.deets.solutions";
  try {
    if (/^localhost$|^127\./.test(location.hostname)) {
      var q = new URLSearchParams(location.search).get("api");
      if (q) localStorage.setItem("deets-ball-api", q.replace(/\/+$/, ""));
      API = localStorage.getItem("deets-ball-api") || API;
    }
  } catch (e) {}

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmt(s, vars) {
    return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function fold(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

  // The players: the same snapshot the worker's pool comes from.
  var players = null;
  function loadPlayers() {
    if (players) return Promise.resolve(players);
    return fetch("/ball/snapshot.json").then(function (r) { return r.json(); }).then(function (d) {
      var byId = {};
      d.players.rows.forEach(function (p) { byId[p.id] = p; });
      var teams = {};
      d.teams.rows.forEach(function (t) { teams[t.abbreviation] = t; });
      players = {
        byId: byId,
        teams: teams,
        pool: d.players.rows.filter(function (p) { return p.team; }),
      };
      return players;
    });
  }
  function pos(p) { return String(p && p.positions || "").split(",").join(", "); }

  // One room's socket. Reconnects after a drop and says hello again,
  // until the worker says the room has closed (an hour after it was made).
  function connect(code, hello, onMsg, onStatus) {
    var ws = null, closed = false, retry = 0, ping = null;
    function open() {
      ws = new WebSocket(API.replace(/^http/, "ws") + "/draft/rooms/" + code + "/ws");
      ws.onopen = function () {
        retry = 0;
        if (onStatus) onStatus("up");
        ws.send(JSON.stringify(Object.assign({ type: "hello" }, hello())));
        clearInterval(ping);
        ping = setInterval(function () { try { ws.send("ping"); } catch (e) {} }, 25000);
      };
      ws.onmessage = function (e) {
        if (e.data === "pong") return;
        var m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.type === "closed") closed = true;   // the room's hour is up: stop reconnecting
        onMsg(m);
      };
      ws.onclose = function () {
        clearInterval(ping);
        if (closed) return;
        if (onStatus) onStatus("down");
        retry++;
        setTimeout(open, Math.min(15000, 600 * retry));
      };
    }
    open();
    return {
      send: function (m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); },
      close: function () { closed = true; if (ws) ws.close(); },
    };
  }

  // A result word for one vote (worker's resolveRound outcomes).
  function outcomeText(o, seats) {
    if (o.result === "taken") return fmt(S.outTaken, { team: seats[o.by] ? seats[o.by].name : "" });
    return S["out_" + o.result] || o.result;
  }

  window.DeetsDraft = {
    API: API, S: S, el: el, fmt: fmt, store: store, read: read, fold: fold,
    loadPlayers: loadPlayers, pos: pos, connect: connect, outcomeText: outcomeText,
    ROSTER: 15, BALLOT: 5,
  };
})();
