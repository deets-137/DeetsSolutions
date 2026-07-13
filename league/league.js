/* League — player stats rendered from the DeetsLeague worker.

   Data source: the DeetsLeague Cloudflare Worker (sibling repo), which
   proxies the Riot API behind our own key, stores trimmed match rows in
   D1, and backfills each looked-up player's history in the background.
   This page never sees the API key and most views cost the worker zero
   Riot calls. Champion/profile art comes straight from Data Dragon;
   Arena augment art from Community Dragon. Design: docs/league.md.

   NOTE: the toolbar/popover kit (makePill, popover open/close) is
   deliberately duplicated from sotd.js / movies.js to keep each page
   self-contained — fix a bug there, mirror it here. */
(function () {
  "use strict";

  var STATS = document.querySelector("[data-lol-stats]");
  if (!STATS) return;
  var META = document.querySelector("[data-lol-meta]");
  var PROFILE = document.querySelector("[data-lol-profile]");
  var MASTERY = document.querySelector("[data-lol-mastery]");
  var MATCHES = document.querySelector("[data-lol-matches]");
  var MATCHES_TITLE = document.querySelector("[data-lol-matches-title]");
  var STATS_PANE = document.querySelector("[data-lol-stats-pane]");
  var STATS_TITLE = document.querySelector("[data-lol-stats-title]");
  var MATCHES_PANE = document.querySelector("[data-lol-matches-pane]");
  var WHO = document.querySelector("[data-lol-who]");
  var WHO_POP = document.querySelector("[data-lol-who-pop]");
  var TOOLBAR = document.querySelector("[data-lol-toolbar]");

  // The deployed worker allows localhost:8787 in CORS, so local UI work
  // runs against production data with no local worker. To test worker
  // changes instead, run `npx wrangler dev` in DeetsLeague and flip this
  // to http://localhost:8788.
  var API = "https://api.deets.solutions";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function getJSON(path) {
    return fetch(API + path).then(function (r) {
      if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }

  // ── Static art + name sources (key-free CDNs) ─────────────────
  // Data Dragon pins a patch version; champion.json maps Riot's numeric
  // champion ids to display names and icon slugs. Arena augments aren't
  // in Data Dragon at all — Community Dragon's arena export has them —
  // and that file is only fetched once, lazily, when augments render.
  var DD = { v: "", champs: null };
  var ddReady = fetch("https://ddragon.leagueoflegends.com/api/versions.json")
    .then(function (r) { return r.json(); })
    .then(function (vs) {
      DD.v = vs[0];
      return fetch("https://ddragon.leagueoflegends.com/cdn/" + DD.v + "/data/en_US/champion.json");
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      DD.champs = {};
      Object.keys(data.data).forEach(function (slug) {
        var c = data.data[slug];
        DD.champs[c.key] = { slug: c.id, name: c.name };
      });
    })
    .catch(function () { DD.champs = {}; });  // page still works, art degrades

  function champ(id) { return (DD.champs && DD.champs[id]) || { slug: null, name: "#" + id }; }
  function champImg(id, size) {
    var c = champ(id);
    var cover = el("span", "lol-icon");
    cover.style.width = cover.style.height = size + "px";
    cover.appendChild(el("span", "lol-icon__mono", (c.name || "?").charAt(0)));
    if (c.slug && DD.v) {
      var img = el("img", "lol-icon__img");
      img.loading = "lazy"; img.alt = c.name; img.title = c.name;
      img.addEventListener("error", function () { img.remove(); });
      img.src = "https://ddragon.leagueoflegends.com/cdn/" + DD.v + "/img/champion/" + c.slug + ".png";
      cover.appendChild(img);
    }
    return cover;
  }

  var AUG = null, augLoading = null;
  function augReady() {
    if (AUG) return Promise.resolve();
    if (!augLoading) {
      augLoading = fetch("https://raw.communitydragon.org/latest/cdragon/arena/en_us.json")
        .then(function (r) { return r.json(); })
        .then(function (data) {
          AUG = {};
          (data.augments || []).forEach(function (a) {
            AUG[a.id] = { name: a.name, icon: a.iconSmall ? "https://raw.communitydragon.org/latest/game/" + a.iconSmall.toLowerCase() : null };
          });
        })
        .catch(function () { AUG = {}; });
    }
    return augLoading;
  }

  var QUEUES = {
    400: "Normal Draft", 420: "Ranked Solo", 430: "Normal Blind",
    440: "Ranked Flex", 450: "ARAM", 480: "Swiftplay", 490: "Quickplay",
    700: "Clash", 900: "URF", 1700: "Arena", 1750: "Arena", 1900: "URF"
  };
  function queueLabel(id) { return QUEUES[id] || "Queue " + id; }

  // ── Persisted control state ───────────────────────────────────
  var STATE_KEY = "deets-lol-state";
  var state = loadState();
  function loadState() {
    var s = {
      mode: "all", view: "champs", player: "D33TS#NA1", recents: [],
      layout: "single",           // "split" = the two tail panes side by side
      champFilter: null,          // championId — narrows the whole page
      champSort: { key: "games", dir: "desc" },
      augSort: { key: "games", dir: "desc" }
    };
    try {
      var saved = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
      if (saved.mode) s.mode = saved.mode;
      if (saved.view) s.view = saved.view;
      if (saved.layout === "split") s.layout = "split";
      if (saved.player) s.player = saved.player;
      if (saved.recents) s.recents = saved.recents.slice(0, 6);
      if (saved.champFilter) s.champFilter = saved.champFilter;
      if (saved.champSort && saved.champSort.key) s.champSort = saved.champSort;
      if (saved.augSort && saved.augSort.key) s.augSort = saved.augSort;
    } catch (e) {}
    return s;
  }
  function saveState() { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) {} }

  var MODES = [   // `short` is what the pill's value readout wears
    { key: "all", label: "All queues", short: "All" }, { key: "CHERRY", label: "Arena" },
    { key: "ARAM", label: "ARAM" }, { key: "CLASSIC", label: "Rift" }
  ];
  var VIEWS = [
    { key: "champs", label: "Champions" }, { key: "augments", label: "Augments" },
    { key: "matches", label: "Matches" }   // match list leads, stats board below
  ];

  // ── Formatting ────────────────────────────────────────────────
  function kFmt(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n); }
  function pct(x) { return Math.round(x * 100) + "%"; }
  function kdaOf(k, d, a) { return d ? ((k + a) / d).toFixed(1) : "∞"; }
  function timeAgo(ms) {
    var s = (Date.now() - ms) / 1000;
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 86400 * 30) return Math.floor(s / 86400) + "d ago";
    var d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function durFmt(sec) { return Math.round(sec / 60) + "m"; }

  // ── Toolbar: pills that each open one popover ─────────────────
  var openEntry = null;
  function closePop() {
    if (!openEntry) return;
    openEntry.pop.hidden = true;
    if (openEntry.pill) openEntry.pill.setAttribute("aria-expanded", "false");
    openEntry = null;
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onDocKey);
  }
  function onDocClick(e) { if (openEntry && !openEntry.ctrl.contains(e.target)) closePop(); }
  function onDocKey(e) { if (e.key === "Escape") { var p = openEntry; closePop(); if (p && p.pill) p.pill.focus(); } }
  function openPop(entry) {
    closePop();
    entry.pop.hidden = false;
    if (entry.pill) entry.pill.setAttribute("aria-expanded", "true");
    openEntry = entry;
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onDocKey);
  }
  function togglePop(entry) { if (openEntry === entry) closePop(); else openPop(entry); }
  function makePill(label, fillPop) {
    var ctrl = el("div", "tb-ctrl");
    var pill = el("button", "tb-pill");
    pill.type = "button";
    pill.setAttribute("aria-haspopup", "true");
    pill.setAttribute("aria-expanded", "false");
    pill.appendChild(el("span", "tb-pill__label", label));
    pill.appendChild(el("span", "tb-pill__caret", "▾"));
    var pop = el("div", "tb-pop");
    pop.hidden = true;
    pop.setAttribute("role", "menu");
    var entry = { ctrl: ctrl, pill: pill, pop: pop };
    pill.addEventListener("click", function () { togglePop(entry); });
    ctrl.appendChild(pill);
    ctrl.appendChild(pop);
    fillPop(pop);
    TOOLBAR.appendChild(ctrl);
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
  function radioPill(label, options, getKey, onPick, showValue, buildRail) {
    var pop, val;
    function mark() {
      pop.querySelectorAll(".tb-pop__opt").forEach(function (b) {
        var on = b.dataset.key === getKey();
        b.classList.toggle("is-active", on); b.setAttribute("aria-checked", String(on));
      });
      if (val) {
        var cur = null;
        options.forEach(function (o) { if (o.key === getKey()) cur = o; });
        val.textContent = cur ? (cur.short || cur.label) : "";
      }
    }
    var entry = makePill(label, function (p) {
      // With a rail, the pop splits into option stack | vertical hairline
      // | icon rail; the opts live in the main stack either way.
      var host = p;
      if (buildRail) {
        p.classList.add("tb-pop--cols");
        host = el("div", "tb-pop__main");
        p.appendChild(host);
      }
      pop = host;
      options.forEach(function (o) {
        host.appendChild(optButton(o.label, o.key, o.key === getKey(), function () {
          onPick(o.key); mark();
        }));
      });
      if (buildRail) p.appendChild(buildRail());
    });
    if (showValue) {   // "Queue | Arena ▾" — the pill wears its pick
      val = el("span", "tb-pill__value");
      entry.pill.insertBefore(val, entry.pill.querySelector(".tb-pill__caret"));
      mark();
    }
    return { mark: mark };   // so state set outside a click can re-sync the pill
  }

  // ── Current player + fetch pipeline ───────────────────────────
  var CUR = null;   // { puuid, player, stats, augments, matches }

  function setMeta(text) { if (META) META.textContent = text || ""; }

  function loadPlayer(riotId) {
    var hash = riotId.lastIndexOf("#");
    var name = hash > 0 ? riotId.slice(0, hash) : riotId;
    var tag = hash > 0 ? riotId.slice(hash + 1) : "NA1";
    if (!name.trim()) return;
    closePop();
    WHO.value = name + "#" + tag;
    setMeta("Looking up " + name + "#" + tag + "…");
    getJSON("/player/" + encodeURIComponent(name.trim()) + "/" + encodeURIComponent(tag.trim()))
      .then(function (player) {
        CUR = { puuid: player.puuid, player: player, stats: [], augments: [], matches: [] };
        state.player = player.gameName + "#" + player.tagLine;
        WHO.value = state.player;
        var i = state.recents.indexOf(state.player);
        if (i >= 0) state.recents.splice(i, 1);
        state.recents.unshift(state.player);
        state.recents = state.recents.slice(0, 6);
        saveState();
        renderProfile();
        // Matches land first so autoQueue can steer the mode the stats
        // are fetched for; ddReady rides along with the stats leg.
        return refreshMatches().then(autoQueue).then(function () {
          return Promise.all([ddReady, refreshStats()]);
        });
      })
      .then(function () { renderAll(); pollBudget(); })
      .catch(function (e) {
        if (e.status === 404) setMeta("No Riot account called " + name + "#" + tag + " — check the spelling?");
        else if (e.status === 429) setMeta("Riot's rate limit is breathing hard — try again in a minute.");
        else setMeta("Couldn't reach the stats service. Try again in a moment.");
      });
  }

  // Auto-pick the Queue filter from what the player actually plays:
  // whatever mode dominates their last 3 games (ties go to the newest).
  // Modes the pill doesn't list (URF, Nexus Blitz…) fall back to All
  // queues. Runs on every player load; a manual pick still sticks for
  // the rest of the visit.
  function autoQueue() {
    var tally = {}, best = null;
    CUR.matches.slice(0, 3).forEach(function (m) {
      tally[m.gameMode] = (tally[m.gameMode] || 0) + 1;
      if (best === null || tally[m.gameMode] > tally[best]) best = m.gameMode;
    });
    if (best === null) return;   // nothing on record yet — leave the pill be
    state.mode = MODES.some(function (o) { return o.key === best; }) ? best : "all";
    saveState();
    queuePill.mark();
  }

  function modeQuery() { return state.mode === "all" ? "" : "?mode=" + state.mode; }
  function refreshStats() {
    return Promise.all([
      getJSON("/stats/" + CUR.puuid + modeQuery()),
      getJSON("/augments/" + CUR.puuid +
        (state.champFilter ? "?champion=" + state.champFilter : ""))
    ]).then(function (res) { CUR.stats = res[0]; CUR.augments = res[1]; });
  }
  function refreshMatches() {
    return getJSON("/matches/" + CUR.puuid + "?count=20" +
      (state.champFilter ? "&champion=" + state.champFilter : ""))
      .then(function (rows) { CUR.matches = rows; });
  }

  function renderAll() {
    renderProfile();
    renderMastery();
    renderStats();
    renderMatches();
  }

  // One rule for both layouts: the selected view's pane leads. Single
  // (block flow) that means it sits on top; split (the grid below 41rem
  // never applies) it takes the left half, its partner the right —
  // matches pair with the stats board, champs/augments pair with the
  // match list. renderStats keeps painting whichever table View names.
  function applyViewOrder() {
    var sec = STATS_PANE.parentNode;
    sec.classList.toggle("lol--split", state.layout === "split");
    STATS_TITLE.textContent = state.view === "augments" ? "Augments" : "Champions";
    if (state.view === "matches") sec.insertBefore(MATCHES_PANE, STATS_PANE);
    else sec.insertBefore(STATS_PANE, MATCHES_PANE);
  }

  // ── Profile line: icon, level, rank, crawl progress ───────────
  function rankLine(entries) {
    var by = {};
    (entries || []).forEach(function (e) { by[e.queueType] = e; });
    var parts = [];
    [["RANKED_SOLO_5x5", "Solo"], ["RANKED_FLEX_SR", "Flex"]].forEach(function (q) {
      var e = by[q[0]];
      if (e) parts.push(q[1] + " " + e.tier.charAt(0) + e.tier.slice(1).toLowerCase() + " " +
        e.rank + " · " + e.leaguePoints + " LP (" + e.wins + "W–" + e.losses + "L)");
    });
    return parts.length ? parts.join("  ·  ") : "Unranked";
  }
  function renderProfile() {
    var p = CUR.player;
    PROFILE.hidden = false;
    PROFILE.textContent = "";
    if (p.summoner.profileIconId != null && DD.v) {
      var img = el("img", "lol-profile__icon");
      img.alt = ""; img.width = 56; img.height = 56;
      img.src = "https://ddragon.leagueoflegends.com/cdn/" + DD.v + "/img/profileicon/" + p.summoner.profileIconId + ".png";
      img.addEventListener("error", function () { img.remove(); });
      PROFILE.appendChild(img);
    }
    var body = el("div", "lol-profile__body");
    var head = el("div", "lol-profile__head");
    head.appendChild(el("span", "lol-profile__name", p.gameName));
    head.appendChild(el("span", "lol-profile__tag", "#" + p.tagLine));
    head.appendChild(el("span", "song__chip song__chip--soft", "level " + p.summoner.summonerLevel));
    body.appendChild(head);
    body.appendChild(el("p", "lol-profile__rank", rankLine(p.league)));
    var crawl = p.crawl || {};
    var line = crawl.complete
      ? crawl.matchesCrawled + " matches on record"
      : crawl.status === "lookup_only"
        ? "history not tracked (roster is full)"
        : "history backfilling — " + (crawl.matchesCrawled || 0) + " matches so far, filling in every few minutes";
    body.appendChild(el("p", "lol-profile__crawl", line));
    PROFILE.appendChild(body);
    setMeta("");
  }

  // ── Mastery grid: lifetime "who do I play", 2×4, right of the profile.
  // Each chip is a toggle: click narrows the whole page (stats, augments,
  // matches) to that champion; click again to widen back out. ────────────
  function setChampFilter(id) {
    state.champFilter = state.champFilter === id ? null : id;
    saveState();
    Promise.all([refreshStats(), refreshMatches()]).then(renderAll);
  }
  function renderMastery() {
    var list = (CUR.player.mastery || []).slice(0, 8);
    MASTERY.hidden = !list.length;
    MASTERY.textContent = "";
    list.forEach(function (m) {
      var chip = el("button", "lol-mchip");
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(state.champFilter === m.championId));
      if (state.champFilter === m.championId) chip.classList.add("is-active");
      chip.title = "Show only " + champ(m.championId).name;
      chip.appendChild(champImg(m.championId, 34));
      var txt = el("span", "lol-mchip__txt");
      txt.appendChild(el("span", "lol-mchip__name", champ(m.championId).name));
      txt.appendChild(el("span", "lol-mchip__pts", kFmt(m.championPoints) + " pts · M" + m.championLevel));
      chip.appendChild(txt);
      chip.addEventListener("click", function () { setChampFilter(m.championId); });
      MASTERY.appendChild(chip);
    });
  }

  // ── Stats: champion table / augment table ─────────────────────
  // Column specs mirror sotd.js's SORTS: one comparable value per row plus
  // the sensible default direction applied when a header is first clicked.
  // Missing values (avg place on SR rows, per-minute on old games) always
  // sink to the bottom, whichever direction.
  function td(row, text, cls) { var c = el("td", cls, text); row.appendChild(c); return c; }

  var CHAMP_COLS = [
    { key: "name",  label: "Champion",  type: "str", dir: "asc",  get: function (s) { return champ(s.championId).name; } },
    { key: "games", label: "Games",     type: "num", dir: "desc", get: function (s) { return s.games; } },
    { key: "win",   label: "Win",       type: "num", dir: "desc", get: function (s) { return s.wins / s.games; } },
    { key: "place", label: "Avg place (Arena)", type: "num", dir: "asc", get: function (s) { return s.avgPlacement; } },
    { key: "kda",   label: "KDA",       type: "num", dir: "desc", get: function (s) { return s.deaths ? (s.kills + s.assists) / s.deaths : 1e9; } },
    { key: "gpm",   label: "Gold/m",    type: "num", dir: "desc", get: function (s) { return s.goldPerMin; } },
    { key: "dpm",   label: "Dmg/m",     type: "num", dir: "desc", get: function (s) { return s.damagePerMin; } }
  ];
  var AUG_COLS = [
    { key: "name",  label: "Augment",   type: "str", dir: "asc",  get: function (a) { return (AUG[a.augmentId] || {}).name || "Augment " + a.augmentId; } },
    { key: "games", label: "Games",     type: "num", dir: "desc", get: function (a) { return a.games; } },
    { key: "win",   label: "Win",       type: "num", dir: "desc", get: function (a) { return a.wins / a.games; } },
    { key: "place", label: "Avg place", type: "num", dir: "asc",  get: function (a) { return a.avgPlacement; } }
  ];
  function colByKey(cols, key) {
    for (var i = 0; i < cols.length; i++) if (cols[i].key === key) return cols[i];
    return cols[1];  // Games — every spec's safe default
  }
  function sortRows(rows, spec, dir) {
    var sign = dir === "asc" ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var va = spec.get(a), vb = spec.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      var c = spec.type === "str"
        ? String(va).localeCompare(String(vb), undefined, { sensitivity: "base" })
        : va - vb;
      return sign * c;
    });
  }
  function headerRow(cols, sortState, rerender) {
    var hr = el("tr");
    cols.forEach(function (c) {
      var cell = el("th", c.type === "num" ? "is-num" : null);
      var btn = el("button", "lol-table__sort", c.label);
      btn.type = "button";
      if (sortState.key === c.key) {
        btn.classList.add("is-sorted");
        btn.appendChild(el("span", "lol-table__dir", sortState.dir === "asc" ? " ▲" : " ▼"));
        cell.setAttribute("aria-sort", sortState.dir === "asc" ? "ascending" : "descending");
      }
      btn.addEventListener("click", function () {
        if (sortState.key === c.key) sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
        else { sortState.key = c.key; sortState.dir = c.dir; }
        saveState(); rerender();
      });
      cell.appendChild(btn);
      hr.appendChild(cell);
    });
    return hr;
  }
  function buildTable(cols, sortState, rows, fillRow, rerender) {
    var wrap = el("div", "lol-scroll");
    var table = el("table", "lol-table");
    var thead = el("thead");
    thead.appendChild(headerRow(cols, sortState, rerender));
    table.appendChild(thead);
    var tbody = el("tbody");
    sortRows(rows, colByKey(cols, sortState.key), sortState.dir).forEach(function (r) {
      tbody.appendChild(fillRow(r));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function renderStats() {
    if (state.view === "augments") { renderAugments(); return; }
    STATS.textContent = "";
    var rows = state.champFilter
      ? CUR.stats.filter(function (s) { return s.championId === state.champFilter; })
      : CUR.stats;
    if (!rows.length) {
      STATS.appendChild(el("p", "sotd__empty",
        "No games on record for this queue yet — the backfill is still digging."));
      return;
    }
    STATS.appendChild(buildTable(CHAMP_COLS, state.champSort, rows, function (s) {
      // Rows toggle the same champion filter as the mastery chips.
      var on = state.champFilter === s.championId;
      var tr = el("tr", "is-champ" + (on ? " is-active" : ""));
      tr.title = on ? "Show all champions" : "Show only " + champ(s.championId).name;
      tr.addEventListener("click", function () { setChampFilter(s.championId); });
      var name = td(tr, null, "lol-table__champ");
      name.appendChild(champImg(s.championId, 28));
      name.appendChild(el("span", null, champ(s.championId).name));
      td(tr, String(s.games), "is-num");
      td(tr, pct(s.wins / s.games), "is-num");
      td(tr, s.avgPlacement != null ? "#" + s.avgPlacement.toFixed(1) : "—", "is-num");
      td(tr, kdaOf(s.kills, s.deaths, s.assists), "is-num");
      td(tr, s.goldPerMin != null ? String(Math.round(s.goldPerMin)) : "—", "is-num");
      td(tr, s.damagePerMin != null ? String(Math.round(s.damagePerMin)) : "—", "is-num");
      return tr;
    }, renderStats));
  }

  function renderAugments() {
    STATS.textContent = "";
    if (!CUR.augments.length) {
      STATS.appendChild(el("p", "sotd__empty", "No Arena games on record yet — augments live there."));
      return;
    }
    STATS.appendChild(el("p", "sotd__empty", "Fetching augment names…"));
    augReady().then(function () {
      if (state.view !== "augments") return;   // user moved on meanwhile
      STATS.textContent = "";
      STATS.appendChild(buildTable(AUG_COLS, state.augSort, CUR.augments, function (a) {
        var meta = AUG[a.augmentId] || { name: "Augment " + a.augmentId, icon: null };
        var tr = el("tr");
        var name = td(tr, null, "lol-table__champ");
        if (meta.icon) {
          var img = el("img", "lol-aug__icon");
          img.loading = "lazy"; img.alt = ""; img.width = 24; img.height = 24;
          img.addEventListener("error", function () { img.remove(); });
          img.src = meta.icon;
          name.appendChild(img);
        }
        name.appendChild(el("span", null, meta.name));
        td(tr, String(a.games), "is-num");
        td(tr, pct(a.wins / a.games), "is-num");
        td(tr, a.avgPlacement != null ? "#" + a.avgPlacement.toFixed(1) : "—", "is-num");
        return tr;
      }, renderAugments));
    });
  }

  // ── Recent matches: rows that expand to a scoreboard ──────────
  // Arena shows the placement number but colors by Riot's own win flag —
  // Riot knows the top-half cutoff for each Arena format (8 duos, 6 trios…).
  function resultBadge(m) {
    var b = el("span", "lol-match__result",
      m.placement != null ? "#" + m.placement : (m.win ? "W" : "L"));
    b.classList.add(m.win ? "is-win" : "is-loss");
    return b;
  }

  function visibleMatches() {
    return CUR.matches.filter(function (m) {
      if (state.mode !== "all" && m.gameMode !== state.mode) return false;
      // Redundant with the worker's ?champion= filter, kept as a fallback
      // so the narrow view is honest even against an older worker.
      if (state.champFilter && m.championId !== state.champFilter) return false;
      return true;
    });
  }

  function renderMatches() {
    var list = visibleMatches();
    MATCHES_TITLE.hidden = !list.length;
    MATCHES_TITLE.textContent = state.champFilter
      ? "Matches — " + champ(state.champFilter).name
      : "Matches";
    MATCHES.textContent = "";
    list.forEach(function (m) {
      var row = el("article", "lol-match");
      var btn = el("button", "lol-match__row");
      btn.type = "button";
      btn.setAttribute("aria-expanded", "false");
      btn.appendChild(champImg(m.championId, 34));
      var mid = el("span", "lol-match__mid");
      var head = el("span", "lol-match__head");
      head.appendChild(el("span", "lol-match__champ", champ(m.championId).name));
      head.appendChild(el("span", "lol-match__queue", queueLabel(m.queueId)));
      if (m.isRemake) head.appendChild(el("span", "song__chip song__chip--soft", "remake"));
      mid.appendChild(head);
      mid.appendChild(el("span", "lol-match__nums",
        m.kills + " / " + m.deaths + " / " + m.assists +
        (m.cs ? " · " + m.cs + " cs" : "") + " · " + kFmt(m.damageToChamps) + " dmg"));
      btn.appendChild(mid);
      var side = el("span", "lol-match__side");
      side.appendChild(resultBadge(m));
      side.appendChild(el("span", "lol-match__when", durFmt(m.gameDuration) + " · " + timeAgo(m.gameCreation)));
      btn.appendChild(side);
      row.appendChild(btn);
      var board = el("div", "lol-board");
      board.hidden = true;
      row.appendChild(board);
      btn.addEventListener("click", function () {
        var open = board.hidden;
        board.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
        if (open && !board.childNodes.length) fillBoard(board, m.matchId);
      });
      MATCHES.appendChild(row);
    });
  }

  // Full scoreboard from the raw match blob (KV-cached on the worker).
  // Arena groups duos by placement; SR shows the two teams.
  function fillBoard(board, matchId) {
    board.appendChild(el("p", "sotd__empty", "Loading scoreboard…"));
    getJSON("/match/" + matchId).then(function (match) {
      board.textContent = "";
      var info = match.info;
      var groups = {};
      info.participants.forEach(function (p) {
        var key = info.gameMode === "CHERRY" ? "sub" + p.playerSubteamId : "team" + p.teamId;
        (groups[key] = groups[key] || []).push(p);
      });
      var keys = Object.keys(groups).sort(function (a, b) {
        var pa = groups[a][0], pb = groups[b][0];
        return info.gameMode === "CHERRY" ? pa.placement - pb.placement : pa.teamId - pb.teamId;
      });
      // Arena reads as a bracket: top half of the lobby on row one, bottom
      // half on row two (#1–3 / #4–6 for trios, #1–4 / #5–8 for duos).
      if (info.gameMode === "CHERRY") {
        board.classList.add("lol-board--arena");   // CSS drops the dmg column
        board.style.gridTemplateColumns =
          "repeat(" + Math.ceil(keys.length / 2) + ", minmax(0, 1fr))";
      }
      keys.forEach(function (key) {
        var g = groups[key];
        var section = el("div", "lol-board__team");
        var title = info.gameMode === "CHERRY"
          ? "#" + g[0].placement
          : (g[0].win ? "Victory" : "Defeat");
        var t = el("div", "lol-board__title", title);
        t.classList.add(g[0].win ? "is-win" : "is-loss");
        section.appendChild(t);
        g.forEach(function (p) {
          var line = el("div", "lol-board__player");
          line.appendChild(champImg(p.championId, 22));
          line.appendChild(el("span", "lol-board__name", p.riotIdGameName || p.summonerName || "—"));
          line.appendChild(el("span", "lol-board__dmg", kFmt(p.totalDamageDealtToChampions) + " dmg"));
          line.appendChild(el("span", "lol-board__kda", p.kills + "/" + p.deaths + "/" + p.assists));
          section.appendChild(line);
        });
        board.appendChild(section);
      });
    }).catch(function () {
      board.textContent = "";
      board.appendChild(el("p", "sotd__empty", "Couldn't load the scoreboard."));
    });
  }

  // ── Combo box: the title IS the search ────────────────────────
  var whoEntry = { ctrl: WHO.parentElement, pill: null, pop: WHO_POP };
  function fillWhoPop() {
    WHO_POP.textContent = "";
    if (state.recents.length) {
      WHO_POP.appendChild(el("div", "lol-who__group", "Recent"));
      state.recents.forEach(function (r) {
        WHO_POP.appendChild(optButton(r, r, r === state.player, function () { loadPlayer(r); }));
      });
    }
    getJSON("/players").then(function (players) {
      if (WHO_POP.hidden || !players.length) return;
      WHO_POP.appendChild(el("div", "lol-who__group", "On record"));
      players.forEach(function (p) {
        var id = p.gameName + "#" + p.tagLine;
        if (state.recents.indexOf(id) >= 0) return;
        WHO_POP.appendChild(optButton(id, id, false, function () { loadPlayer(id); }));
      });
    }).catch(function () {});
  }
  WHO.addEventListener("focus", function () { fillWhoPop(); openPop(whoEntry); WHO.select(); });
  WHO.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); loadPlayer(WHO.value); WHO.blur(); }
  });

  // ── Refresh + shared-budget readout ───────────────────────────
  // The counter shows Riot calls used in the rolling 2-minute window —
  // shared by every visitor AND the background crawler — so friends know
  // when to let the key breathe. Tinted with the traffic tokens. The
  // worker also hard-stops live calls near the top, so this is advisory.
  var BUDGET_EL = null, refreshBtn = null;
  function renderBudget(b) {
    if (!BUDGET_EL) return;
    BUDGET_EL.textContent = b.used + "/" + b.limit +
      (b.backfilling ? " · " + b.backfilling + " in queue" : "");
    BUDGET_EL.title = "Riot API calls in the last 2 minutes (shared by everyone)" +
      (b.backfilling ? " — " + b.backfilling + " player(s) backfilling in the background" : "");
    BUDGET_EL.classList.toggle("is-ok", b.used < 50);
    BUDGET_EL.classList.toggle("is-warm", b.used >= 50 && b.used < 80);
    BUDGET_EL.classList.toggle("is-hot", b.used >= 80);
  }
  function pollBudget() {
    getJSON("/budget").then(renderBudget).catch(function () {
      if (BUDGET_EL) BUDGET_EL.textContent = "";
    });
  }
  function buildRefresh() {
    refreshBtn = el("button", "tb-pill lol-refresh");
    refreshBtn.type = "button";
    refreshBtn.appendChild(el("span", "tb-pill__label", "Refresh"));
    refreshBtn.addEventListener("click", function () {
      if (!CUR || refreshBtn.disabled) return;
      refreshBtn.disabled = true;
      setTimeout(function () { refreshBtn.disabled = false; }, 30000);
      setMeta("Refreshing…");
      Promise.all([refreshStats(), refreshMatches()])
        .then(function () { renderStats(); renderMatches(); setMeta(""); })
        .catch(function (e) {
          setMeta(e.status === 429
            ? "The shared budget is tapped — give it a minute."
            : "Refresh failed. Try again in a moment.");
        })
        .then(pollBudget);
    });
    TOOLBAR.appendChild(refreshBtn);
    BUDGET_EL = el("span", "lol-budget");
    TOOLBAR.appendChild(BUDGET_EL);
  }

  // ── Layout rail: the View popover's second column ─────────────
  // Two icons behind a vertical hairline — a square (one panel, as
  // ever) and a divided square (split panes). Hidden on mobile by CSS
  // (.lol-layout-rail), where the split grid never applies either.
  function layoutIcon(kind) {
    var NS = "http://www.w3.org/2000/svg";
    function shape(tag, attrs) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      return n;
    }
    var svg = shape("svg", { viewBox: "0 0 14 14", width: "14", height: "14", "aria-hidden": "true" });
    svg.appendChild(shape("rect", {
      x: "1.5", y: "1.5", width: "11", height: "11", rx: "1.5",
      fill: "none", stroke: "currentColor", "stroke-width": "1.5"
    }));
    if (kind === "split") svg.appendChild(shape("line", {
      x1: "7", y1: "1.5", x2: "7", y2: "12.5",
      stroke: "currentColor", "stroke-width": "1.5"
    }));
    return svg;
  }
  function layoutRail() {
    var rail = el("div", "tb-pop__rail lol-layout-rail");
    var icons = [];
    function markIcons() {
      icons.forEach(function (b) {
        var on = b.dataset.layout === state.layout;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }
    [["single", "One panel"], ["split", "Split panels"]].forEach(function (d) {
      var b = el("button", "tb-pop__icon");
      b.type = "button";
      b.dataset.layout = d[0];
      b.title = d[1];
      b.setAttribute("aria-label", d[1]);
      b.appendChild(layoutIcon(d[0]));
      b.addEventListener("click", function () {
        state.layout = d[0]; saveState();
        markIcons(); applyViewOrder();
      });
      icons.push(b);
      rail.appendChild(b);
    });
    markIcons();
    return rail;
  }

  // ── Boot ──────────────────────────────────────────────────────
  var queuePill = radioPill("Queue", MODES, function () { return state.mode; }, function (key) {
    state.mode = key; saveState();
    if (!CUR) return;
    refreshStats().then(function () { renderStats(); renderMatches(); });
    renderMatches();
  }, true);
  radioPill("View", VIEWS, function () { return state.view; }, function (key) {
    state.view = key; saveState();
    applyViewOrder();
    if (CUR) renderStats();
  }, true, layoutRail);
  buildRefresh();
  applyViewOrder();   // honor a persisted view/layout before data lands

  setMeta("Loading…");
  ddReady.then(function () { loadPlayer(state.player); });
})();
