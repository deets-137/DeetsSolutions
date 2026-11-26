/* DeetsBall draft — the host screen (/ball/draft/), for a laptop or a TV.

   No hash: the rooms from the last 24 h, and a New draft button.
   #CODE: that room's board. Anyone can watch it; the browser that made the
   room holds its host token (localStorage) and gets the controls: add a
   bot, remove a team, start. During the draft: one column per team (its
   status, its last-round ballot with each vote's result, its roster), then
   every round's ballots, newest first. Ballots are shown in full once a
   round closes (shotgun-draft.md §1). */
(function () {
  "use strict";
  var D = window.DeetsDraft, S = D.S, el = D.el, fmt = D.fmt;
  var TITLE = document.querySelector("[data-draft-title]");
  var ACTIONS = document.querySelector("[data-draft-actions]");
  var VIEW = document.querySelector("[data-draft-view]");
  if (!VIEW) return;

  var conn = null, state = null, P = null, code = null, down = false;

  function button(text, cls, onClick) {
    var b = el("button", cls || "home__cta", text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }
  function hostKey(c) { return "deets-ball-host-" + c; }

  // ── The room list ──────────────────────────────────────────────
  function showList() {
    TITLE.textContent = S.draftTitle;
    ACTIONS.textContent = "";
    ACTIONS.appendChild(button(S.newDraft, "home__cta", createRoom));
    VIEW.textContent = "";
    var list = el("div", "draft-rooms");
    VIEW.appendChild(list);
    fetch(D.API + "/draft/rooms").then(function (r) { return r.json(); }).then(function (d) {
      if (!d.rooms.length) { list.appendChild(el("p", "draft-note", S.roomsEmpty)); return; }
      d.rooms.forEach(function (r) {
        var a = el("a", "draft-room");
        a.href = "#" + r.code;
        a.appendChild(el("span", "draft-room__code", r.code));
        var status = r.phase === "lobby" ? S.roomLobby : r.phase === "done" ? S.roomDone : fmt(S.roomRound, { n: r.round });
        a.appendChild(el("span", "draft-room__status", status));
        a.appendChild(el("span", "draft-room__teams", r.teams.map(function (t) { return t || S.openSeat; }).join(" · ")));
        list.appendChild(a);
      });
    }).catch(function () { list.appendChild(el("p", "draft-note", S.roomsFailed)); });
  }
  function createRoom() {
    fetch(D.API + "/draft/rooms", { method: "POST" }).then(function (r) { return r.json(); }).then(function (d) {
      D.store(hostKey(d.code), d.hostToken);
      location.hash = d.code;
    }).catch(function () { alert(S.roomsFailed); });
  }

  // ── One room ───────────────────────────────────────────────────
  function showRoom(c) {
    code = c;
    state = null;
    TITLE.textContent = fmt(S.roomTitle, { code: c });
    VIEW.textContent = "";
    fetch(D.API + "/draft/rooms").then(function (r) { return r.json(); }).then(function (d) {
      if (code === c && !d.rooms.some(function (r) { return r.code === c; })) showClosed();
    }).catch(function () {});
    D.loadPlayers().then(function (p) {
      P = p;
      seenRound = null;
      stopReveal();
      conn = D.connect(c, function () { return { hostToken: D.read(hostKey(c)) }; }, function (m) {
        if (m.type === "state") { state = m; noteRound(); render(); }
        else if (m.type === "closed") showClosed();
        else if (m.type === "error") alert(m.text);
      }, function (s) { down = s === "down"; render(); });
    });
  }

  // ── The round reveal ───────────────────────────────────────────
  // When a round closes while the board is open, its 4 ballots show with
  // no results, then one rank at a time (the order the worker resolves
  // them) each vote turns: green won, red tie, gray when it no longer
  // mattered (the player went at a higher rank, or the roster was full).
  // A player joins his roster when his rank turns. A board opened
  // mid-draft shows the last round as it ended, with no reveal.
  var seenRound = null, reveal = null, revealTimer = null;
  var STEP_MS = 900, FIRST_MS = 700;
  function stopReveal() { clearTimeout(revealTimer); revealTimer = null; reveal = null; }
  function noteRound() {
    var last = state.rounds[state.rounds.length - 1];
    var n = last ? last.n : 0;
    if (seenRound === null) { seenRound = n; return; }
    if (n <= seenRound) return;
    seenRound = n;
    stopReveal();
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    reveal = { n: n, rank: 0 };
    revealTimer = setTimeout(step, FIRST_MS);
  }
  function step() {
    if (!reveal) return;
    reveal.rank++;
    VIEW.querySelectorAll('.draft-results [data-rank="' + (reveal.rank - 1) + '"]').forEach(function (li) {
      li.classList.remove("is-pending");
    });
    var cols = VIEW.querySelector(".draft-teams");
    if (cols) cols.replaceWith(teamsGrid());
    if (reveal.rank >= D.BALLOT) { reveal = null; return; }
    revealTimer = setTimeout(step, STEP_MS);
  }
  // Is this vote's result still hidden by the reveal?
  function pending(n, rank) { return !!reveal && reveal.n === n && rank >= reveal.rank; }

  function resultsStrip(last) {
    var wrap = el("section", "draft-results");
    wrap.appendChild(el("h2", "draft-history__head", fmt(S.roundHead, { n: last.n })));
    var grid = el("div", "draft-round__grid");
    state.seats.forEach(function (seat, i) {
      var cell = el("div", "draft-round__cell");
      cell.appendChild(el("p", "draft-round__team", seat ? seat.name : ""));
      if (last.outcomes[i] && last.outcomes[i].length) cell.appendChild(ballotList(last.outcomes[i], last.n));
      else cell.appendChild(el("p", "draft-note", S.statusFull));
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);
    return wrap;
  }
  function teamsGrid() {
    var cols = el("div", "draft-teams");
    state.seats.forEach(function (seat, i) { cols.appendChild(teamPanel(seat, i)); });
    return cols;
  }

  // The room's hour is up, or it was gone before the board opened.
  function showClosed() {
    stopReveal();
    if (conn) { conn.close(); conn = null; }
    state = null;
    ACTIONS.textContent = "";
    var all = el("a", "home__cta home__cta--soft", S.allDrafts);
    all.href = "#";
    ACTIONS.appendChild(all);
    VIEW.textContent = "";
    VIEW.appendChild(el("p", "draft-note", S.roomClosed));
  }

  function render() {
    if (!state) return;
    var s = state;
    ACTIONS.textContent = "";
    var all = el("a", "home__cta home__cta--soft", S.allDrafts);
    all.href = "#";
    ACTIONS.appendChild(all);
    if (s.host && s.phase === "lobby") {
      var missing = s.seats.filter(function (x) { return !x; }).length;
      var start = button(missing ? fmt(S.needTeams, { n: missing }) : S.startDraft, "home__cta", function () { conn.send({ type: "start" }); });
      start.disabled = !!missing;
      ACTIONS.appendChild(start);
    }

    VIEW.textContent = "";
    var head = el("div", "draft-head");
    var url = location.origin + "/ball/draft/" + s.code;
    head.appendChild(el("p", "draft-join", fmt(S.joinAt, { url: url.replace(/^https?:\/\//, "") })));
    var phase = s.phase === "lobby" ? S.roomLobby : s.phase === "done" ? S.draftDone : fmt(S.roomRound, { n: s.round });
    head.appendChild(el("p", "draft-phase", down ? S.reconnecting : phase));
    VIEW.appendChild(head);

    var last = s.rounds[s.rounds.length - 1];
    if (last) VIEW.appendChild(resultsStrip(last));
    VIEW.appendChild(teamsGrid());

    if (s.phase !== "lobby") VIEW.appendChild(history());
  }

  function teamPanel(seat, i) {
    var s = state;
    var box = el("section", "draft-team");
    var head = el("div", "draft-team__head");
    if (!seat) {
      head.appendChild(el("h2", "draft-team__name draft-team__name--open", S.openSeat));
      box.appendChild(head);
      if (s.host && s.phase === "lobby") box.appendChild(button(S.addBot, "home__cta home__cta--soft", function () { conn.send({ type: "addBot" }); }));
      return box;
    }
    head.appendChild(el("h2", "draft-team__name", seat.name));
    if (seat.bot) head.appendChild(el("span", "draft-chip", S.botTag));
    if (s.phase === "drafting") {
      var st = seat.full ? S.statusFull : seat.submitted ? S.statusIn : S.statusWaiting;
      var chip = el("span", "draft-chip" + (seat.submitted || seat.full ? " draft-chip--in" : ""), st);
      head.appendChild(chip);
    }
    box.appendChild(head);
    if (s.host && s.phase === "lobby") {
      box.appendChild(button(S.removeSeat, "home__cta home__cta--soft", function () { conn.send({ type: "removeSeat", seat: i }); }));
    }
    if (s.phase === "lobby") return box;

    // A player won in the round being revealed waits for his rank to turn.
    var roster = seat.roster;
    var last = s.rounds[s.rounds.length - 1];
    if (reveal && last && last.n === reveal.n && last.outcomes[i]) {
      var hide = {};
      last.outcomes[i].forEach(function (o, rank) { if (o.result === "won" && pending(last.n, rank)) hide[o.id] = 1; });
      roster = roster.filter(function (id) { return !hide[id]; });
    }
    box.appendChild(el("h3", "draft-team__sub", fmt(S.rosterHead, { n: roster.length })));
    var ol = el("ol", "draft-roster");
    for (var k = 0; k < D.ROSTER; k++) {
      var id = roster[k];
      var li = el("li", "draft-roster__row" + (id == null ? " draft-roster__row--empty" : ""));
      if (id != null) {
        var p = P.byId[id];
        li.appendChild(el("span", "draft-roster__name", p ? p.name : "#" + id));
        li.appendChild(el("span", "draft-roster__meta", p ? p.team + " · " + D.pos(p) : ""));
      }
      ol.appendChild(li);
    }
    box.appendChild(ol);
    return box;
  }

  function ballotList(outs, n) {
    var ol = el("ol", "draft-ballot");
    outs.forEach(function (o, rank) {
      var li = el("li", "draft-ballot__row draft-ballot__row--" + o.result + (pending(n, rank) ? " is-pending" : ""));
      li.setAttribute("data-rank", String(rank));
      var p = P.byId[o.id];
      li.appendChild(el("span", "draft-ballot__name", p ? p.name : "#" + o.id));
      li.appendChild(el("span", "draft-ballot__result", D.outcomeText(o, state.seats)));
      ol.appendChild(li);
    });
    return ol;
  }

  function history() {
    var s = state;
    var wrap = el("section", "draft-history");
    wrap.appendChild(el("h2", "draft-history__head", S.roundsHead));
    if (!s.rounds.length) { wrap.appendChild(el("p", "draft-note", S.noRoundsYet)); return wrap; }
    s.rounds.slice().reverse().forEach(function (r) {
      var block = el("div", "draft-round");
      block.appendChild(el("h3", "draft-team__sub", fmt(S.roundHead, { n: r.n })));
      var grid = el("div", "draft-round__grid");
      s.seats.forEach(function (seat, i) {
        var cell = el("div", "draft-round__cell");
        cell.appendChild(el("p", "draft-round__team", seat ? seat.name : ""));
        if (r.outcomes[i] && r.outcomes[i].length) cell.appendChild(ballotList(r.outcomes[i]));
        else cell.appendChild(el("p", "draft-note", S.statusFull));
        grid.appendChild(cell);
      });
      block.appendChild(grid);
      wrap.appendChild(block);
    });
    return wrap;
  }

  function route() {
    if (conn) { conn.close(); conn = null; }
    var c = location.hash.replace(/^#/, "").toUpperCase();
    if (/^[A-Z]{4}$/.test(c)) showRoom(c); else showList();
  }
  window.addEventListener("hashchange", route);
  route();
})();
