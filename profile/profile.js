/* Deets profile — the account's home page (docs/accounts.md, "The
   profile page").

   Everything on the page is painted from DeetsAccount state: signed out
   it's one invitation box, signed in it's the bento grid — Appearance
   (display name + color), then the phase-2 stats boxes fed by
   GET /me/stats (docs/stats.md): Record, one box per game, match history,
   and export. Edits go through DeetsAccount.update() → PATCH /me, so the
   nav button and any other tab pick the change up through the same
   listener plumbing.

   Superlatives ("most knights") are deliberately NOT here yet and are
   deliberately not server-side either — they're a curatorial choice about
   which counter is fun this month, so when they land they're computed
   from the counters at render time, in this file.

   The color picker deliberately mirrors the lobby seat picker in
   games/table.js (six presets + a custom hex "Become..." row) — same
   anatomy, same colors.js validation — minus the clash checks, because a
   profile has no other seats to clash with. Copy here is inline, the
   accounts-chrome precedent (account.js, auth/done.html), not the games'
   strings.js convention. */

(function () {
  "use strict";

  var title = document.querySelector("[data-profile-title]");
  var toolbar = document.querySelector("[data-profile-toolbar]");
  var meta = document.querySelector("[data-profile-meta]");
  var grid = document.querySelector("[data-profile-grid]");
  if (!title || !toolbar || !meta || !grid) return;

  /* Drafts survive re-renders: a broadcast-driven repaint (the initial
     /me revalidate, a save landing) must not eat what's mid-typing —
     same reason the lobby picker keeps ui.colorDraft. Expanded match rows
     live here for the same reason: a repaint must not fold them shut. */
  var ui = { nameDraft: null, hexDraft: null, open: {} };

  /* ── stats (docs/stats.md, "The profile page") ───────────────────
     Fetched HERE rather than in the shared account.js, because that file
     loads on every page and /me/stats is rendered on exactly one. /me
     stays {id, name, color} for the same reason. */
  var API = "https://id.deets.solutions";
  var MOCK = /(\?|&)mock(&|=|$)/.test(location.search);
  var stats = null;                 // the payload, once it lands
  var statsPhase = "idle";          // idle | loading | ready | error

  /* Real sign-in cannot work on localhost — the ds_sess cookie is scoped
     to .deets.solutions — so ?mock carries a canned payload, the same
     dev opt-out account.js and the game transports use. It is the only
     way to iterate on these boxes without deploying. */
  function mockStats() {
    var now = Date.now(), day = 86400000;
    var field = function (k, ranks) {
      return ranks.map(function (r, i) {
        return { seat: i, uid: i === 0 ? "mock-user" : null,
                 name: ["Deets", "Sam", "Rook", "Pip"][i],
                 color: ["#d94141", "#1e6f9f", "#3f9b4f", "#b07ad9"][i],
                 kind: i === 0 ? "user" : (i === 2 ? "bot" : "guest"),
                 rank: r.rank, tied: !!r.tied, score: r.score, stats: null };
      });
    };
    return {
      summary: { games: 14, wins: 5, podium: 10, left: 2,
                 leftBy: { stand: 1, grace: 1 },
                 firstAt: now - 40 * day, lastAt: now - 2 * 3600000 },
      games: {
        cities: { games: 9, wins: 4, podium: 7, avgRank: 1.9, avgScore: 8.6, bestScore: 12,
                  placements: { 1: 4, 2: 3, 3: 1, 4: 1 },
                  bests: ["biggest_haul"],
                  counters: { vp: 77, roads: 41, settlements: 27, cities: 14,
                              dev_bought: 22, dev_played: 18, knights: 12,
                              gained_rolls: 312, gained_steals: 14, gained_trades: 46, gained_dev: 9,
                              ptp_trades: 31, ptp_given: 64, ptp_received: 59,
                              biggest_haul: 7, steals: 14, victimized: 11, robber_moved: 29,
                              rolls: 188, discards: 22, spent: 240,
                              longest_road: 3, largest_army: 2 } },
        mahjong: { games: 5, wins: 1, podium: 3, avgRank: 2.4, avgScore: 3.2, bestScore: 44,
                   placements: { 1: 1, 2: 2, 3: 1, 4: 1 },
                   bests: ["best_faan"],
                   counters: { score: 16, wins: 9, self_draws: 3, deal_ins: 7,
                               kongs: 4, pungs: 21, chows: 34, best_faan: 8 } }
      },
      matches: [
        { key: "cities:demo:0", game: "cities", endedAt: now - 2 * 3600000,
          seatCount: 4, humans: 3, bots: 1, settings: { capacity: 4, timerSec: 60 },
          seats: field("c", [{ rank: 1, score: 10 }, { rank: 2, score: 9 },
                             { rank: 3, score: 7 }, { rank: 4, score: 5 }]),
          spans: [
            { seat: 0, span: 0, name: "Deets", kind: "user", via: "lobby", exit: null, joinedTurn: 0, leftTurn: 44 },
            { seat: 1, span: 0, name: "Sam", kind: "guest", via: "lobby", exit: "stand", joinedTurn: 0, leftTurn: 31 },
            { seat: 1, span: 1, name: "Rook", kind: "bot", via: "takeover", exit: null, joinedTurn: 31, leftTurn: 44 },
            { seat: 2, span: 0, name: "Rook", kind: "bot", via: "lobby", exit: null, joinedTurn: 0, leftTurn: 44 },
            { seat: 3, span: 0, name: "Pip", kind: "guest", via: "join", exit: null, joinedTurn: 2, leftTurn: 44 }
          ] },
        { key: "mahjong:demo:0", game: "mahjong", endedAt: now - 3 * day,
          seatCount: 4, humans: 2, bots: 2, settings: { winds: 1, minFaan: 3, capFaan: 13 },
          seats: field("m", [{ rank: 2, tied: true, score: 12 }, { rank: 2, tied: true, score: 12 },
                             { rank: 1, score: 20 }, { rank: 4, score: -44 }]),
          spans: [
            { seat: 0, span: 0, name: "Deets", kind: "user", via: "lobby", exit: null, joinedTurn: 0, leftTurn: 8 },
            { seat: 1, span: 0, name: "Sam", kind: "guest", via: "lobby", exit: null, joinedTurn: 0, leftTurn: 8 },
            { seat: 2, span: 0, name: "Rook", kind: "bot", via: "lobby", exit: null, joinedTurn: 0, leftTurn: 8 },
            { seat: 3, span: 0, name: "Pip", kind: "bot", via: "lobby", exit: null, joinedTurn: 0, leftTurn: 8 }
          ] }
      ]
    };
  }

  function loadStats() {
    if (statsPhase === "loading" || statsPhase === "ready") return;
    statsPhase = "loading";
    if (MOCK) {
      stats = mockStats(); statsPhase = "ready";
      setTimeout(function () { render(); }, 0);
      return;
    }
    fetch(API + "/me/stats", { credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        stats = d; statsPhase = d ? "ready" : "error";
        render();
      })
      .catch(function () { statsPhase = "error"; render(); });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(msg, kind) {
    if (window.DeetsToast && window.DeetsToast.show) window.DeetsToast.show(msg, kind);
  }
  function saveFailed() { toast("That didn't save. Try again in a moment.", "error"); }

  /* ── the boxes ──────────────────────────────────────────────────── */

  function signedOutBox() {
    var box = el("section", "profile-box profile-box--invite");
    box.appendChild(el("h2", "profile-box__title", "Not signed in"));
    box.appendChild(el("p", "profile-box__text",
      "Sign in and your display name and color follow you to every game table on the site."));
    var btn = el("button", "tb-pill", "Sign in with Google");
    btn.type = "button";
    btn.addEventListener("click", function () {
      window.DeetsAccount.signIn();
      toast("Finish signing in over in the new tab.", "info");
    });
    box.appendChild(btn);
    return box;
  }

  function appearanceBox(user) {
    var box = el("section", "profile-box");
    box.appendChild(el("h2", "profile-box__title", "Appearance"));

    /* Display name — the one thing the lobby picker doesn't let you
       edit, and the whole reason this box exists beyond the swatches. */
    var nameField = el("div", "profile-field");
    var nameId = "profile-name";
    var nameLabel = el("label", "profile-field__label", "Display name");
    nameLabel.setAttribute("for", nameId);
    nameField.appendChild(nameLabel);
    var nameRow = el("div", "profile-field__row");
    var input = el("input", "profile-field__input");
    input.id = nameId;
    input.type = "text";
    input.maxLength = 24;
    input.spellcheck = false;
    input.autocomplete = "nickname";
    input.value = ui.nameDraft != null ? ui.nameDraft : (user.name || "");
    var saveBtn = el("button", "tb-pill", "Save");
    saveBtn.type = "button";
    function nameChanged() {
      var v = input.value.trim().slice(0, 24);
      return v && v !== (user.name || "") ? v : null;
    }
    function paintSave() { saveBtn.disabled = !nameChanged(); }
    function commitName() {
      var v = nameChanged();
      if (!v) return;
      saveBtn.disabled = true;
      window.DeetsAccount.update({ name: v }).then(function (u) {
        if (!u) { saveFailed(); paintSave(); return; }
        ui.nameDraft = null;           // the account is the draft now
        toast("You're " + u.name + " now.", "info");
      });
    }
    input.addEventListener("input", function () { ui.nameDraft = input.value; paintSave(); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") commitName(); });
    saveBtn.addEventListener("click", commitName);
    paintSave();
    nameRow.appendChild(input);
    nameRow.appendChild(saveBtn);
    nameField.appendChild(nameRow);
    box.appendChild(nameField);

    /* Color — the lobby picker's anatomy, solo edition. */
    var Colors = window.DeetsColors;
    var current = Colors ? Colors.norm(user.color) : null;
    var colorField = el("div", "profile-field");
    colorField.appendChild(el("span", "profile-field__label", "Color"));

    var sw = el("div", "profile-swatches");
    (Colors ? Colors.PRESETS : []).forEach(function (hex) {
      var b = el("button", "profile-swatch");
      b.type = "button";
      b.style.background = hex;
      if (hex === current) b.classList.add("is-current");
      b.setAttribute("aria-label", "Become " + hex);
      b.addEventListener("click", function () { commitColor(hex); });
      sw.appendChild(b);
    });
    /* 7th slot: your custom color, when the account is wearing one.
       Otherwise the dashed empty ring that just focuses the hex field. */
    var custom = current && Colors.PRESETS.indexOf(current) < 0 ? current : null;
    var cb = el("button", "profile-swatch profile-swatch--custom");
    cb.type = "button";
    if (custom) {
      cb.style.background = custom;
      cb.classList.add("is-current");
      cb.setAttribute("aria-label", "Your custom color, " + custom);
    } else {
      cb.classList.add("is-empty");
      cb.setAttribute("aria-label", "Pick a custom color");
    }
    cb.addEventListener("click", function () { hexInput.focus(); });
    sw.appendChild(cb);
    colorField.appendChild(sw);

    var row = el("div", "profile-field__row");
    row.appendChild(el("span", "profile-field__hexlabel", "Hex"));
    var hexInput = el("input", "profile-field__input profile-field__input--hex");
    hexInput.type = "text";
    hexInput.spellcheck = false;
    hexInput.maxLength = 8;
    hexInput.value = ui.hexDraft != null ? ui.hexDraft : (current || "");
    var become = el("button", "tb-pill", "Become...");
    become.type = "button";
    var note = el("span", "profile-field__msg");
    function validateHex() {
      var hex = Colors ? Colors.norm(hexInput.value) : null;
      note.textContent = !hex && hexInput.value.trim() ? "Hex colors look like #a1b2c3." : "";
      become.disabled = !hex || hex === current;
      return become.disabled ? null : hex;
    }
    function becomeCustom() {
      var hex = validateHex();
      if (hex) commitColor(hex);
    }
    hexInput.addEventListener("input", function () { ui.hexDraft = hexInput.value; validateHex(); });
    hexInput.addEventListener("keydown", function (e) { if (e.key === "Enter") becomeCustom(); });
    become.addEventListener("click", becomeCustom);
    validateHex();
    row.appendChild(hexInput);
    row.appendChild(become);
    row.appendChild(note);
    colorField.appendChild(row);
    box.appendChild(colorField);

    box.appendChild(el("p", "profile-box__text",
      "Tables offer your color first when it's free; a color already claimed at a table stays claimed."));
    return box;
  }

  /* ── the stats boxes ────────────────────────────────────────────── */

  var GAMES = {
    cities: { label: "DeetsCities", href: "/cities/" },
    mahjong: { label: "DeetsMahjong", href: "/mahjong/" },
    poker: { label: "DeetsPoker", href: "/poker/" }
  };
  /* Counter labels. Order is the reading order, not the schema's — the
     things you'd actually want to know first. Anything the server sends
     that isn't listed simply isn't shown, so a new column added worker-
     side doesn't break this page; it just waits for a label. */
  var LABELS = {
    cities: [
      ["vp", "Victory points"], ["settlements", "Settlements"], ["cities", "Cities"],
      ["roads", "Roads"], ["knights", "Knights"],
      ["dev_bought", "Dev cards bought"], ["dev_played", "Dev cards played"],
      ["longest_road", "Longest Road held"], ["largest_army", "Largest Army held"],
      ["rolls", "Dice rolled"], ["gained_rolls", "Resources from rolls"],
      ["gained_trades", "From bank trades"], ["gained_dev", "From dev cards"],
      ["ptp_trades", "Player trades"], ["ptp_given", "Cards traded away"],
      ["ptp_received", "Cards traded for"],
      ["biggest_haul", "Biggest haul"], ["steals", "Cards stolen"],
      ["victimized", "Times robbed"], ["robber_moved", "Robber moves"],
      ["discards", "Discarded to 7s"], ["spent", "Resources spent"]
    ],
    mahjong: [
      ["score", "Net score"], ["wins", "Hands won"], ["self_draws", "Self-draws"],
      ["deal_ins", "Deal-ins"], ["best_faan", "Best hand"],
      ["pungs", "Pungs"], ["chows", "Chows"], ["kongs", "Kongs"]
    ],
    /* Poker's money counters (net, bought, biggest_pot) are deliberately
       NOT here yet: they are integer CENTS, and this box prints a counter
       verbatim, so "Net 1234" would be a wrong number rather than $12.34.
       They land in the database either way — a label is all they're
       waiting on, once this page grows a money formatter. */
    poker: [
      ["hands", "Hands played"], ["wins", "Pots won"]
    ]
  };

  function pct(n, d) { return d ? Math.round((n / d) * 100) + "%" : "—"; }
  function ord(n) {
    if (n == null) return "—";
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function placeLabel(rank, tied) { return (tied ? "T-" : "") + ord(rank); }
  function ago(ts) {
    if (!ts) return "";
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return "just now";
    var m = s / 60; if (m < 60) return Math.round(m) + "m ago";
    var h = m / 60; if (h < 24) return Math.round(h) + "h ago";
    var d = h / 24; if (d < 30) return Math.round(d) + "d ago";
    return new Date(ts).toLocaleDateString();
  }

  function stat(label, value, hint) {
    var s = el("div", "profile-stat");
    s.appendChild(el("span", "profile-stat__value", value));
    s.appendChild(el("span", "profile-stat__label", label));
    if (hint) s.appendChild(el("span", "profile-stat__hint", hint));
    return s;
  }

  /* The record. Games played, how they went, and — deliberately beside the
     wins rather than buried — how often you left one early. */
  function recordBox(s) {
    var box = el("section", "profile-box profile-box--wide");
    box.appendChild(el("h2", "profile-box__title", "Record"));
    var row = el("div", "profile-stats");
    row.appendChild(stat("Games", String(s.games)));
    row.appendChild(stat("Won", String(s.wins), pct(s.wins, s.games)));
    row.appendChild(stat("Podium", String(s.podium), pct(s.podium, s.games)));
    row.appendChild(stat("Left early", String(s.left || 0),
      s.left ? Object.keys(s.leftBy || {}).map(function (k) {
        return s.leftBy[k] + " " + k;
      }).join(" · ") : null));
    box.appendChild(row);
    if (s.lastAt) {
      box.appendChild(el("p", "profile-box__text",
        "Last game " + ago(s.lastAt) + (s.firstAt ? " · first " + ago(s.firstAt) : "")));
    }
    return box;
  }

  /* One box per game: the placement distribution, then the counters.
     A tie makes the distribution sum to more than games played. That is
     correct, and nobody will notice. */
  function gameBox(name, g) {
    var meta = GAMES[name] || { label: name };
    var box = el("section", "profile-box");
    var head = el("div", "profile-box__head");
    head.appendChild(el("h2", "profile-box__title", meta.label));
    head.appendChild(el("span", "profile-chip", g.games + (g.games === 1 ? " game" : " games")));
    box.appendChild(head);

    var row = el("div", "profile-stats");
    row.appendChild(stat("Won", String(g.wins), pct(g.wins, g.games)));
    row.appendChild(stat("Podium", String(g.podium), pct(g.podium, g.games)));
    if (g.avgRank != null) row.appendChild(stat("Avg place", (Math.round(g.avgRank * 10) / 10).toFixed(1)));
    if (g.bestScore != null) row.appendChild(stat("Best score", String(g.bestScore)));
    box.appendChild(row);

    /* Raw placement, not normalised — 3rd of 6 and 3rd of 3 are stored the
       same and shown the same until there's a reason to decide otherwise. */
    var ranks = Object.keys(g.placements || {}).map(Number).sort(function (a, b) { return a - b; });
    if (ranks.length) {
      var most = 0;
      ranks.forEach(function (r) { most = Math.max(most, g.placements[r]); });
      var dist = el("div", "profile-dist");
      dist.setAttribute("role", "img");
      dist.setAttribute("aria-label", "Placements: " + ranks.map(function (r) {
        return g.placements[r] + " × " + ord(r);
      }).join(", "));
      ranks.forEach(function (r) {
        var n = g.placements[r];
        var bar = el("div", "profile-dist__bar");
        var fill = el("span", "profile-dist__fill");
        fill.style.height = Math.max(6, Math.round((n / most) * 100)) + "%";
        if (r === 1) fill.classList.add("is-first");
        bar.appendChild(el("span", "profile-dist__n", String(n)));
        bar.appendChild(fill);
        bar.appendChild(el("span", "profile-dist__k", ord(r)));
        dist.appendChild(bar);
      });
      box.appendChild(dist);
    }

    var bests = g.bests || [];
    var grid = el("dl", "profile-counters");
    (LABELS[name] || []).forEach(function (pair) {
      var v = (g.counters || {})[pair[0]];
      if (v == null) return;
      var isBest = bests.indexOf(pair[0]) >= 0;
      var dt = el("dt", "profile-counters__k", pair[1] + (isBest ? " (best)" : ""));
      grid.appendChild(dt);
      grid.appendChild(el("dd", "profile-counters__v", String(v)));
    });
    if (grid.childNodes.length) box.appendChild(grid);
    return box;
  }

  /* Match history — League's anatomy. The row is you; expanding it shows
     the WHOLE field, because "did I lead the table" is a comparison and
     you cannot make it without the table. */
  function matchRow(m) {
    var mine = null;
    (m.seats || []).forEach(function (s) { if (s.uid && s.uid === myId()) mine = s; });
    var wrap = el("div", "profile-match" + (mine && mine.rank === 1 ? " is-win" : ""));

    var head = el("button", "profile-match__head");
    head.type = "button";
    head.setAttribute("aria-expanded", ui.open[m.key] ? "true" : "false");
    head.appendChild(el("span", "profile-match__game", (GAMES[m.game] || {}).label || m.game));
    head.appendChild(el("span", "profile-match__place",
      mine ? placeLabel(mine.rank, mine.tied) : "—"));
    head.appendChild(el("span", "profile-match__score", mine ? String(mine.score) : ""));

    /* The field as its seat colours, in seat order — the same colours the
       table wore, so a game is recognisable at a glance. */
    var dots = el("span", "profile-match__field");
    (m.seats || []).forEach(function (s) {
      var d = el("span", "profile-match__dot");
      if (s.color) d.style.background = s.color;
      else d.classList.add("is-anon");
      if (s.uid && s.uid === myId()) d.classList.add("is-me");
      d.title = s.name || "—";
      dots.appendChild(d);
    });
    head.appendChild(dots);
    head.appendChild(el("span", "profile-match__when", ago(m.endedAt)));
    head.addEventListener("click", function () {
      ui.open[m.key] = !ui.open[m.key];
      render();
    });
    wrap.appendChild(head);

    if (ui.open[m.key]) wrap.appendChild(matchDetail(m));
    return wrap;
  }

  function myId() {
    var u = window.DeetsAccount.get();
    return u ? u.id : null;
  }

  function matchDetail(m) {
    var body = el("div", "profile-match__body");

    var tbl = el("table", "profile-field");
    var thead = el("thead");
    var hr = el("tr");
    ["", "Player", "Place", "Score"].forEach(function (h) {
      hr.appendChild(el("th", null, h));
    });
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = el("tbody");
    (m.seats || []).slice().sort(function (a, b) { return a.rank - b.rank; }).forEach(function (s) {
      var tr = el("tr", s.uid && s.uid === myId() ? "is-me" : null);
      var swatch = el("td", "profile-field__seat");
      var dot = el("span", "profile-match__dot");
      if (s.color) dot.style.background = s.color; else dot.classList.add("is-anon");
      swatch.appendChild(dot);
      tr.appendChild(swatch);
      var who = el("td");
      who.appendChild(el("span", null, s.name || "—"));
      if (s.kind === "bot") who.appendChild(el("span", "profile-tag", "bot"));
      else if (s.kind === "guest") who.appendChild(el("span", "profile-tag", "guest"));
      tr.appendChild(who);
      tr.appendChild(el("td", null, placeLabel(s.rank, s.tied)));
      tr.appendChild(el("td", null, String(s.score)));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    body.appendChild(tbl);

    /* The occupancy timeline, rendered straight from result_seat_spans.
       This is the view that could not exist if the ledger lived in a blob:
       a seat with two spans changed hands, and both occupants are named. */
    var moves = (m.spans || []).filter(function (sp) { return sp.exit || sp.span > 0; });
    if (moves.length) {
      var ul = el("ul", "profile-spans");
      moves.forEach(function (sp) {
        var li = el("li");
        var turn = sp.exit ? sp.leftTurn : sp.joinedTurn;
        li.appendChild(el("strong", null, sp.name || "—"));
        li.appendChild(el("span", null, " " + (sp.exit ? spanExit(sp.exit) : spanVia(sp.via)) +
          (turn != null ? " · turn " + turn : "")));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }

    var facts = [];
    facts.push(m.humans + (m.humans === 1 ? " human" : " humans"));
    if (m.bots) facts.push(m.bots + (m.bots === 1 ? " bot" : " bots"));
    var st = m.settings || {};
    if (st.winds != null) facts.push(st.winds === 0 ? "no winds" : st.winds + "-wind");
    if (st.minFaan != null) facts.push("min " + st.minFaan + " faan");
    if (st.capacity != null) facts.push(st.capacity + " seats");
    if (st.timerSec) facts.push(st.timerSec + "s timer");
    body.appendChild(el("p", "profile-box__text", facts.join(" · ")));
    return body;
  }
  function spanExit(e) {
    return { concede: "conceded", stand: "stood up", kick: "was removed",
             grace: "dropped out", adopted: "handed over",
             reclaimed: "was reclaimed" }[e] || e;
  }
  function spanVia(v) {
    return { takeover: "took the seat over", adopt: "sat down mid-game",
             reclaim: "came back", join: "joined", lobby: "started" }[v] || v;
  }

  function historyBox(list) {
    var box = el("section", "profile-box profile-box--wide");
    box.appendChild(el("h2", "profile-box__title", "Match history"));
    if (!list.length) {
      box.appendChild(el("p", "profile-box__text", "Nothing here yet — finish a game and it lands."));
      return box;
    }
    var wrap = el("div", "profile-matches");
    list.forEach(function (m) { wrap.appendChild(matchRow(m)); });
    box.appendChild(wrap);
    box.appendChild(el("p", "profile-box__text", "Tap a game to see the whole table."));
    return box;
  }

  /* Export, not a SQL console — the reasoning is in docs/stats.md. A plain
     link works because the session cookie is SameSite=Lax and this is a
     top-level GET, so the download carries it. */
  function dataBox() {
    var box = el("section", "profile-box");
    box.appendChild(el("h2", "profile-box__title", "Your data"));
    box.appendChild(el("p", "profile-box__text",
      "Every seat of every game you played, yours and everyone else's. CSV opens in a spreadsheet; JSON keeps the nesting."));
    var row = el("div", "profile-field__row");
    [["seats", "Results"], ["spans", "Who sat where"], ["games", "Games"]].forEach(function (p) {
      var a = el("a", "tb-pill", p[1] + " · CSV");
      a.href = API + "/me/export?what=" + p[0] + "&format=csv";
      if (MOCK) { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); }
      row.appendChild(a);
    });
    box.appendChild(row);
    if (MOCK) box.appendChild(el("p", "profile-box__text", "Export needs a real session — signed-in on the live site only."));
    return box;
  }

  function statsBoxes() {
    var out = [];
    if (statsPhase === "loading" || statsPhase === "idle") {
      var l = el("section", "profile-box");
      l.appendChild(el("h2", "profile-box__title", "Games"));
      l.appendChild(el("p", "profile-box__text", "Counting…"));
      return [l];
    }
    if (statsPhase === "error" || !stats) {
      var e = el("section", "profile-box");
      e.appendChild(el("h2", "profile-box__title", "Games"));
      e.appendChild(el("p", "profile-box__text", "Couldn't reach your stats just now."));
      var again = el("button", "tb-pill", "Try again");
      again.type = "button";
      again.addEventListener("click", function () { statsPhase = "idle"; loadStats(); render(); });
      e.appendChild(again);
      return [e];
    }
    var s = stats.summary || { games: 0 };
    if (!s.games) {
      var z = el("section", "profile-box profile-box--wide");
      z.appendChild(el("h2", "profile-box__title", "No games yet"));
      z.appendChild(el("p", "profile-box__text",
        "Finish a game at a table while you're signed in and it shows up here — your placement, the field you played, and who came and went."));
      var go = el("a", "tb-pill", "Play DeetsCities");
      go.href = "/cities/";
      z.appendChild(go);
      return [z];
    }
    out.push(recordBox(s));
    Object.keys(stats.games || {}).sort().forEach(function (k) {
      out.push(gameBox(k, stats.games[k]));
    });
    out.push(historyBox(stats.matches || []));
    out.push(dataBox());
    return out;
  }

  function commitColor(hex) {
    window.DeetsAccount.update({ color: hex }).then(function (u) {
      if (!u) { saveFailed(); return; }
      ui.hexDraft = null;
      toast("Color saved.", "info");
    });
  }

  /* ── the frame ──────────────────────────────────────────────────── */

  function render(user) {
    toolbar.textContent = "";
    grid.textContent = "";

    if (user == null && window.DeetsAccount.get() == null) {
      title.textContent = "Profile";
      meta.textContent = "Checking who you are…";
      return;
    }
    user = user || window.DeetsAccount.get();

    if (!user) {
      title.textContent = "Profile";
      meta.textContent = "A name and a color that follow you around the site.";
      // drop any loaded stats with the session — signing in as someone else
      // must not paint the previous account's record for a frame
      stats = null; statsPhase = "idle";
      grid.appendChild(signedOutBox());
      return;
    }

    title.textContent = user.name || "Profile";
    meta.textContent = "Signed in with Google so your name, color, and stats sync.";

    var out = el("button", "tb-pill", "Sign out");
    out.type = "button";
    out.addEventListener("click", function () {
      out.disabled = true;
      window.DeetsAccount.signOut().then(function () { toast("Signed out.", "info"); });
    });
    toolbar.appendChild(out);

    grid.appendChild(appearanceBox(user));
    statsBoxes().forEach(function (b) { grid.appendChild(b); });
    loadStats();   // no-op once it's loading or landed
  }

  window.DeetsAccount.onChange(render);
})();
