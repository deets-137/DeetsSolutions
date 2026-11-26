/* DeetsBall — the demo skeleton (/ball/).

   Data: snapshot.json, a byte-for-byte copy of the DeetsBall repo's
   snapshots/deetsball-dev-<date>.json, an export of the deetsball-dev D1
   tables Core_Teams and Core_Player_Bios. Never hand-edit it: export a
   new snapshot there and copy it over. The page never talks to D1.

   One panel: a Team pill (the site's tb- toolbar kit, as the journals use
   it) picks a team, and that team's players list below it, name and
   positions. The snapshot already orders players by last name.

   NOTE: the pill/popover machinery (togglePop, makePill, optButton) is a
   copy of the journals' kit (movies/movies.js) to keep the page
   self-contained, as each journal carries its own. A fix there is
   mirrored here. */
(function () {
  "use strict";

  // The HTML's own words (the Draft button, the draft page's title) come
  // from strings.js too. Both /ball/ pages load this file.
  document.querySelectorAll("[data-s]").forEach(function (n) {
    var s = (window.BALL_STRINGS || {})[n.getAttribute("data-s")];
    if (s != null) n.textContent = s;
  });

  var ROOT = document.querySelector("[data-ball]");
  if (!ROOT) return;   // the draft page: no team panel yet
  var TOOLBAR = ROOT.querySelector("[data-ball-toolbar]");
  var ROSTER = ROOT.querySelector("[data-ball-roster]");
  var S = window.BALL_STRINGS || {};
  var STORE = "deets-ball-team";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function readTeam() { try { return localStorage.getItem(STORE); } catch (e) { return null; } }
  function saveTeam(code) { try { localStorage.setItem(STORE, code); } catch (e) {} }

  // "F,C" -> "F, C"
  function prettyPositions(p) { return String(p || "").split(",").join(", "); }

  var teams = [];        // Core_Teams rows, A–Z by name
  var byTeam = {};       // abbreviation -> Core_Player_Bios rows
  var current = null;    // the shown team's abbreviation

  // ── Toolbar: one pill that opens one popover ─────────────────
  var openEntry = null;
  function closePop() {
    if (!openEntry) return;
    openEntry.pop.hidden = true;
    openEntry.pill.setAttribute("aria-expanded", "false");
    openEntry = null;
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onDocKey);
  }
  function onDocClick(e) { if (openEntry && !openEntry.ctrl.contains(e.target)) closePop(); }
  function onDocKey(e) { if (e.key === "Escape") { var p = openEntry; closePop(); if (p) p.pill.focus(); } }
  function togglePop(entry) {
    if (openEntry === entry) { closePop(); return; }
    closePop();
    entry.pop.hidden = false;
    entry.pill.setAttribute("aria-expanded", "true");
    openEntry = entry;
    var focusable = entry.pop.querySelector("[data-autofocus]");
    if (focusable) focusable.focus();
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onDocKey);
  }
  // The Team control: one rounded box holding a fixed "Team" label and,
  // beside it, the pill that opens the team list. Only the pill hovers
  // and opens; the label is plain text.
  function makePill(label, fillPop) {
    var box = el("div", "ball-team");
    var name = el("span", "ball-team__label", label);
    name.id = "ball-team-label";
    box.appendChild(name);
    var ctrl = el("div", "tb-ctrl");
    var pill = el("button", "tb-pill");
    pill.type = "button";
    pill.setAttribute("aria-haspopup", "true");
    pill.setAttribute("aria-expanded", "false");
    pill.setAttribute("aria-labelledby", "ball-team-label ball-team-value");
    var value = el("span", "tb-pill__value");
    value.id = "ball-team-value";
    pill.appendChild(value);
    pill.appendChild(el("span", "tb-pill__caret", "▾"));
    var pop = el("div", "tb-pop");
    pop.hidden = true;
    pop.setAttribute("role", "menu");
    var entry = { ctrl: ctrl, pill: pill, pop: pop, value: value };
    pill.addEventListener("click", function () { togglePop(entry); });
    ctrl.appendChild(pill);
    ctrl.appendChild(pop);
    fillPop(pop);
    box.appendChild(ctrl);
    TOOLBAR.appendChild(box);
    return entry;
  }
  function optButton(label, key, isActive, onPick) {
    var b = el("button", "tb-pop__opt", label);
    b.type = "button";
    b.setAttribute("role", "menuitemradio");
    b.dataset.key = key;
    b.setAttribute("aria-checked", String(isActive));
    if (isActive) b.classList.add("is-active");
    b.addEventListener("click", onPick);
    return b;
  }

  var teamPill = null;
  function buildTeamPill() {
    teamPill = makePill(S.teamPill, function (pop) {
      pop.classList.add("ball-teams");
      teams.forEach(function (t) {
        pop.appendChild(optButton(t.name, t.abbreviation, t.abbreviation === current, function () {
          pick(t.abbreviation);
          closePop();
          teamPill.pill.focus();
        }));
      });
    });
    markTeam();
  }
  function markTeam() {
    if (!teamPill) return;
    var t = teams.filter(function (x) { return x.abbreviation === current; })[0];
    teamPill.value.textContent = t ? t.name : "";
    teamPill.pop.querySelectorAll(".tb-pop__opt").forEach(function (b) {
      var on = b.dataset.key === current;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", String(on));
      if (on) b.setAttribute("data-autofocus", ""); else b.removeAttribute("data-autofocus");
    });
  }

  // ── The roster ───────────────────────────────────────────────
  function render() {
    var list = byTeam[current] || [];
    ROSTER.textContent = "";
    if (!list.length) {
      var empty = el("li", "ball-roster__empty", S.emptyTeam);
      ROSTER.appendChild(empty);
    }
    list.forEach(function (p) {
      var row = el("li", "ball-roster__row");
      row.appendChild(el("span", "ball-roster__name", p.name));
      row.appendChild(el("span", "ball-roster__pos", prettyPositions(p.positions)));
      ROSTER.appendChild(row);
    });
  }
  function pick(code) {
    current = code;
    saveTeam(code);
    markTeam();
    render();
  }

  // ── Load ─────────────────────────────────────────────────────
  fetch("./snapshot.json")
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (data) {
      teams = (data.teams && data.teams.rows || []).slice().sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
      (data.players && data.players.rows || []).forEach(function (p) {
        if (!p.team) return;          // no team, no games: left out (DeetsBall shotgun-draft.md §2)
        (byTeam[p.team] = byTeam[p.team] || []).push(p);
      });
      var saved = readTeam();
      var known = teams.some(function (t) { return t.abbreviation === saved; });
      current = known ? saved : (teams[0] && teams[0].abbreviation);
      buildTeamPill();
      render();
    })
    .catch(function () {
      ROSTER.textContent = "";
      ROSTER.appendChild(el("li", "ball-roster__empty", S.loadFailed));
    });
})();
