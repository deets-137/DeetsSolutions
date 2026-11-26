/* DeetsBall draft — the GM's phone (/ball/draft/<code>).

   _redirects serves /ball/draft/<code> from /ball/draft/room/, so the code
   is the URL's last part. A GM picks a team name to take a seat; the seat's
   token stays in this browser (localStorage), so a reload keeps the team.

   Top: this round's ballot, 5 ranks, filled from the search below it.
   Bottom: the GM's roster. The ballot in progress is kept in localStorage
   per room and round, so a reload or a dropped socket loses nothing. */
(function () {
  "use strict";
  var D = window.DeetsDraft, S = D.S, el = D.el, fmt = D.fmt;
  var TITLE = document.querySelector("[data-gm-title]");
  var VIEW = document.querySelector("[data-gm-view]");
  if (!VIEW) return;

  var code = (location.pathname.replace(/\/+$/, "").split("/").pop() || "").toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { TITLE.textContent = S.draftTitle; VIEW.appendChild(el("p", "draft-note", S.noRoom)); return; }
  TITLE.textContent = fmt(S.gmTitle, { code: code });

  var seatKey = "deets-ball-gm-" + code;
  var conn = null, state = null, P = null, picks = [], picksRound = 0, query = "";

  // ── The page's parts, built once so the search box keeps its focus ──
  var joinSec = el("section", "draft-gm__panel");
  var noteSec = el("p", "draft-note");
  var ballotSec = el("section", "draft-gm__panel draft-gm__ballot");
  var ballotHead = el("h2", "draft-gm__head");
  var ballotStatus = el("p", "draft-gm__status");
  var slots = el("ol", "draft-slots");
  var sendBtn = el("button", "home__cta draft-gm__send");
  sendBtn.type = "button";
  var searchInput = el("input", "draft-search");
  searchInput.type = "search";
  searchInput.placeholder = S.search;
  searchInput.setAttribute("aria-label", S.search);
  searchInput.autocomplete = "off";
  var results = el("ul", "draft-results");
  ballotSec.append(ballotHead, ballotStatus, slots, sendBtn, searchInput, results);
  var lastSec = el("section", "draft-gm__panel draft-gm__side");
  var rosterSec = el("section", "draft-gm__panel draft-gm__side");
  VIEW.append(joinSec, noteSec, ballotSec, lastSec, rosterSec);

  function picksKey() { return "deets-ball-picks-" + code + "-" + picksRound; }
  function savePicks() { D.store(picksKey(), JSON.stringify(picks)); }
  function taken() {
    var t = {};
    (state ? state.seats : []).forEach(function (x) { if (x) x.roster.forEach(function (id) { t[id] = 1; }); });
    return t;
  }

  // ── Join ───────────────────────────────────────────────────────
  function renderJoin() {
    joinSec.textContent = "";
    var form = el("form", "draft-join-form");
    var input = el("input", "draft-search");
    input.placeholder = S.teamName;
    input.setAttribute("aria-label", S.teamName);
    input.maxLength = 24;
    var b = el("button", "home__cta", S.join);
    b.type = "submit";
    form.append(input, b);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (input.value.trim()) conn.send({ type: "join", name: input.value.trim() });
    });
    joinSec.appendChild(form);
  }

  // ── The ballot ─────────────────────────────────────────────────
  function sameAsSent() {
    var sent = state.you && state.you.ballot;
    return !!sent && sent.length === picks.length && sent.every(function (id, i) { return picks[i] === id; });
  }
  function renderBallot() {
    var s = state;
    ballotHead.textContent = fmt(S.ballotHead, { n: s.round });
    var missing = D.BALLOT - picks.length;
    ballotStatus.textContent = sameAsSent() ? S.ballotSent : missing ? fmt(S.needFive, { n: missing }) : "";
    var before = slotTops();
    slots.textContent = "";
    for (var r = 0; r < D.BALLOT; r++) slots.appendChild(slotRow(r));
    slide(before);
    sendBtn.textContent = s.you && s.you.ballot ? S.resendBallot : S.sendBallot;
    sendBtn.disabled = missing > 0 || sameAsSent();
    renderResults();
  }
  function slotRow(r) {
    // An empty slot carries the same parts as a filled one (a blank meta
    // line, hidden buttons), so a slot never changes size when it fills.
    var id = picks[r];
    var p = id == null ? null : P.byId[id];
    var li = el("li", "draft-slot" + (p ? "" : " draft-slot--empty"));
    if (p) li.setAttribute("data-id", String(p.id));
    li.appendChild(el("span", "draft-slot__rank", String(r + 1)));
    var who = el("span", "draft-slot__who");
    who.appendChild(el("span", "draft-slot__name", p ? p.name : fmt(S.rankEmpty, { n: r + 1 })));
    who.appendChild(el("span", "draft-slot__meta", p ? p.team + " · " + D.pos(p) : " "));
    li.appendChild(who);
    li.appendChild(iconBtn("↑", S.moveUp, !p || r === 0, function () { swap(r, r - 1); }));
    li.appendChild(iconBtn("↓", S.moveDown, !p || r === picks.length - 1, function () { swap(r, r + 1); }));
    li.appendChild(iconBtn("✕", S.removePick, !p, function () { picks.splice(r, 1); savePicks(); renderBallot(); }));
    return li;
  }
  function iconBtn(glyph, label, disabled, onClick) {
    var b = el("button", "draft-slot__btn", glyph);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.disabled = disabled;
    b.addEventListener("click", onClick);
    return b;
  }
  // The slots slide: each player's slot glides from where it was to its
  // new rank (moved up or down, or closing a gap left by a removal), and a
  // newly added player fades in. The motion is the site's pill slide
  // (skin.css --dur-pill / --ease-pill); none with reduced motion.
  function slotTops() {
    var tops = {};
    slots.querySelectorAll("[data-id]").forEach(function (li) { tops[li.getAttribute("data-id")] = li.getBoundingClientRect().top; });
    return tops;
  }
  function slide(before) {
    if (!slots.animate || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    var cs = getComputedStyle(slots);
    var dur = (parseFloat(cs.getPropertyValue("--dur-pill")) || 0.28) * 1000;
    var ease = cs.getPropertyValue("--ease-pill").trim() || "ease-out";
    slots.querySelectorAll("[data-id]").forEach(function (li) {
      var was = before[li.getAttribute("data-id")];
      if (was == null) {
        li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: ease });
        return;
      }
      var dy = was - li.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      li.animate([{ transform: "translateY(" + dy + "px)" }, { transform: "none" }], { duration: dur, easing: ease });
    });
  }
  function swap(a, b) { var t = picks[a]; picks[a] = picks[b]; picks[b] = t; savePicks(); renderBallot(); }

  function renderResults() {
    results.textContent = "";
    var q = D.fold(query).trim();
    if (!q || picks.length >= D.BALLOT) return;
    var words = q.split(/\s+/);
    var t = taken();
    var n = 0;
    for (var i = 0; i < P.pool.length && n < 30; i++) {
      var p = P.pool[i];
      if (t[p.id] || picks.indexOf(p.id) >= 0) continue;
      var hay = p.name_search + " " + D.fold(p.team);
      if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) continue;
      results.appendChild(resultRow(p));
      n++;
    }
  }
  function resultRow(p) {
    var li = el("li");
    var b = el("button", "draft-result");
    b.type = "button";
    b.appendChild(el("span", "draft-result__name", p.name));
    b.appendChild(el("span", "draft-result__meta", p.team + " · " + D.pos(p)));
    b.addEventListener("click", function () {
      if (picks.length >= D.BALLOT) return;
      picks.push(p.id);
      savePicks();
      query = "";
      searchInput.value = "";
      renderBallot();
      if (picks.length < D.BALLOT) searchInput.focus();
    });
    li.appendChild(b);
    return li;
  }
  searchInput.addEventListener("input", function () { query = searchInput.value; renderResults(); });
  sendBtn.addEventListener("click", function () { if (picks.length === D.BALLOT) conn.send({ type: "ballot", picks: picks.slice() }); });

  // ── Last round, roster ─────────────────────────────────────────
  function renderLast() {
    var s = state, me = s.you.seat;
    var last = s.rounds[s.rounds.length - 1];
    lastSec.textContent = "";
    lastSec.hidden = !(last && last.outcomes[me] && last.outcomes[me].length);
    if (lastSec.hidden) return;
    lastSec.appendChild(el("h2", "draft-gm__head", S.lastRound + " · " + fmt(S.roundHead, { n: last.n })));
    var ol = el("ol", "draft-ballot");
    last.outcomes[me].forEach(function (o) {
      var li = el("li", "draft-ballot__row draft-ballot__row--" + o.result);
      li.appendChild(el("span", "draft-ballot__name", P.byId[o.id] ? P.byId[o.id].name : "#" + o.id));
      li.appendChild(el("span", "draft-ballot__result", D.outcomeText(o, s.seats)));
      ol.appendChild(li);
    });
    lastSec.appendChild(ol);
  }
  function renderRoster() {
    var seat = state.seats[state.you.seat];
    rosterSec.textContent = "";
    rosterSec.appendChild(el("h2", "draft-gm__head", seat.name + " · " + fmt(S.yourRoster, { n: seat.roster.length })));
    if (!seat.roster.length) { rosterSec.appendChild(el("p", "draft-note", S.rosterEmpty)); return; }
    var ol = el("ol", "draft-roster");
    seat.roster.forEach(function (id) {
      var p = P.byId[id];
      var li = el("li", "draft-roster__row");
      li.appendChild(el("span", "draft-roster__name", p ? p.name : "#" + id));
      li.appendChild(el("span", "draft-roster__meta", p ? p.team + " · " + D.pos(p) : ""));
      ol.appendChild(li);
    });
    rosterSec.appendChild(ol);
  }

  function render() {
    var s = state;
    var me = s.you ? s.seats[s.you.seat] : null;
    joinSec.hidden = !(!me && s.phase === "lobby");
    if (!joinSec.hidden && !joinSec.firstChild) renderJoin();
    ballotSec.hidden = !(me && s.phase === "drafting" && !me.full);
    lastSec.hidden = true;
    rosterSec.hidden = !me;

    noteSec.textContent = !me ? (s.phase === "lobby" ? "" : S.gmStarted)
      : s.phase === "lobby" ? S.waitStart
      : s.phase === "done" ? S.draftOver
      : me.full ? S.youFull : "";
    noteSec.hidden = !noteSec.textContent;
    if (!me) return;

    if (s.phase === "drafting" && picksRound !== s.round) {
      picksRound = s.round;
      try { picks = JSON.parse(D.read(picksKey()) || "null") || (s.you.ballot ? s.you.ballot.slice() : []); } catch (e) { picks = []; }
      var t = taken();
      picks = picks.filter(function (id) { return !t[id]; });
    }
    if (!ballotSec.hidden) renderBallot();
    renderLast();
    renderRoster();
  }

  D.loadPlayers().then(function (p) {
    P = p;
    conn = D.connect(code, function () { return { token: D.read(seatKey) }; }, function (m) {
      if (m.type === "joined") D.store(seatKey, m.token);
      else if (m.type === "state") { state = m; render(); }
      else if (m.type === "error") alert(m.text);
      else if (m.type === "closed") { VIEW.textContent = ""; VIEW.appendChild(el("p", "draft-note", S.roomClosed)); }
    }, function (st) { if (st === "down") { noteSec.hidden = false; noteSec.textContent = S.reconnecting; } });
  });
  fetch(D.API + "/draft/rooms").then(function (r) { return r.json(); }).then(function (d) {
    if (!d.rooms.some(function (r) { return r.code === code; })) { VIEW.textContent = ""; VIEW.appendChild(el("p", "draft-note", S.noRoom)); if (conn) conn.close(); }
  }).catch(function () {});
})();
