/* Movies — renders the Letterboxd journal.

   Data source: movies.json, a static file generated from a Letterboxd
   data export by scripts/letterboxd_web.py and committed alongside the
   site. Same spirit as sotd.js: no framework, no build step, and every
   visual value comes from a theme/skin token so the cards inherit all
   30 theme x skin combos. The card DOM reuses the .song__* classes so
   the three view layouts (full/small/line) come from main.css for free;
   movie-only bits (.movie__*) have their own small section there.

   NOTE: the toolbar/popover kit (makePill, facetGroup, sort/state
   machinery) is deliberately duplicated from sotd/sotd.js to keep each
   page self-contained — fix a bug there, mirror it here. */
(function () {
  "use strict";

  var GRID = document.querySelector("[data-movies-grid]");
  var META = document.querySelector("[data-movies-meta]");
  if (!GRID) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

  function ordinal(n) {
    var t = n % 100;
    if (t >= 11 && t <= 13) return n + "th";
    return n + (["th", "st", "nd", "rd"][n % 10] || "th");
  }

  // "2026-06-29" -> "June 29th, 2026". Parsed from the string parts (not
  // new Date) so a UTC date never shifts a day in the local timezone.
  function prettyDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    if (!m) return iso || "";
    var mo = +m[2];
    if (mo < 1 || mo > 12) return iso;
    return MONTHS[mo - 1] + " " + ordinal(+m[3]) + ", " + m[1];
  }

  // 4.5 -> "★★★★½" — Letterboxd ratings run 0.5..5 in half steps.
  function stars(r) {
    return "★".repeat(Math.floor(r)) + (r % 1 ? "½" : "");
  }

  // The film a movie was seen on vs. the day it entered the account:
  // diarised watches carry a watched_date, plain marks only a logged_date.
  function seenDate(m) { return m.watched_date || m.logged_date || null; }

  function buildCard(movie) {
    var card = el("article", "song movie");
    if (movie.status === "watchlist") card.classList.add("movie--watchlist");

    // Cover: TMDB poster when the exporter found one (the monogram sits
    // underneath until the image loads, and stays if it fails); films TMDB
    // doesn't know keep the themed monogram banner.
    var cover = el("div", "song__cover");
    var initial = (movie.name || "?").trim().charAt(0).toUpperCase() || "?";
    cover.appendChild(el("span", "song__mono", initial));
    if (movie.poster_url) {
      card.classList.add("movie--poster");
      var img = el("img", "song__art");
      img.loading = "lazy";
      img.alt = movie.name + " poster";
      img.addEventListener("load", function () { cover.classList.add("has-art"); });
      img.addEventListener("error", function () { img.remove(); card.classList.remove("movie--poster"); });
      img.src = movie.poster_url;
      cover.appendChild(img);
    }
    card.appendChild(cover);

    var body = el("div", "song__body");

    var head = el("div", "song__head");
    var nameEl = el("h2", "song__track", movie.name);
    nameEl.title = movie.name;
    head.appendChild(nameEl);
    if (movie.year) head.appendChild(el("p", "song__artist", String(movie.year)));
    body.appendChild(head);

    var tags = el("div", "song__tags");
    if (movie.rating != null)
      tags.appendChild(el("span", "song__genre song__chip movie__stars", stars(movie.rating)));
    if (movie.liked)
      tags.appendChild(el("span", "song__len song__chip movie__liked", "♥ Liked"));
    if (movie.watch_no)      // an every-watch card: which sitting this was
      tags.appendChild(el("span", "song__chip song__chip--soft",
        "↻ Watch " + movie.watch_no + " of " + movie.watch_total));
    else if (movie.rewatch)
      tags.appendChild(el("span", "song__chip song__chip--soft",
        movie.watch_count > 1 ? "↻ ×" + movie.watch_count : "↻ Rewatch"));
    if (movie.status === "watchlist")
      tags.appendChild(el("span", "song__chip song__chip--soft", "Watchlist"));
    if (tags.childNodes.length) body.appendChild(tags);

    if (movie.review) {
      var rev = el("p", "movie__review", movie.review);
      rev.title = movie.review;
      body.appendChild(rev);
    }

    var foot = el("div", "song__foot");
    foot.appendChild(el("span", "song__uploader",
      movie.status === "watchlist" ? "Want to see" : "Watched"));
    foot.appendChild(el("span", "song__date", prettyDate(seenDate(movie))));
    body.appendChild(foot);

    var links = el("div", "song__links");
    if (movie.uri) {
      var lb = el("a", "song__link", "Letterboxd");
      lb.href = movie.uri; lb.target = "_blank"; lb.rel = "noopener";
      links.appendChild(lb);
      body.appendChild(links);
    }

    card.appendChild(body);
    return card;
  }

  // ── Persisted control state ───────────────────────────────────
  var STATE_KEY = "deets-movies-state";
  var state = loadState();
  var query = "";
  function loadState() {
    var s = {
      view: "full", grouped: true, sortKey: "watched", sortDir: "desc", filterMode: "and",
      filters: { ratings: [], decades: [], flags: [], statuses: [] }
    };
    try {
      var saved = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
      if (saved.view) s.view = saved.view;
      if (saved.grouped === false) s.grouped = false;
      if (saved.sortKey) s.sortKey = saved.sortKey;
      if (saved.sortDir) s.sortDir = saved.sortDir;
      if (saved.filterMode) s.filterMode = saved.filterMode;
      if (saved.filters) {
        s.filters.ratings = saved.filters.ratings || [];
        s.filters.decades = saved.filters.decades || [];
        s.filters.flags = saved.filters.flags || [];
        s.filters.statuses = saved.filters.statuses || [];
      }
    } catch (e) {}
    return s;
  }
  function saveState() { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) {} }

  // ── Sort ──────────────────────────────────────────────────────
  var SORTS = [
    { key: "watched", label: "Watched date", type: "num", dir: "desc", get: function (m) { var d = seenDate(m); return d ? Date.parse(d) : null; } },
    { key: "rating",  label: "Rating",       type: "num", dir: "desc", get: function (m) { return m.rating; } },
    { key: "year",    label: "Release year", type: "num", dir: "desc", get: function (m) { return m.year; } },
    { key: "name",    label: "Name",         type: "str", dir: "asc",  get: function (m) { return m.name || null; } },
    { key: "watches", label: "Rewatch count", type: "num", dir: "desc", get: function (m) { return m.watch_count > 1 ? m.watch_count : null; } }
  ];
  function sortByKey(key) {
    for (var i = 0; i < SORTS.length; i++) if (SORTS[i].key === key) return SORTS[i];
    return SORTS[0];
  }
  function cmpStr(a, b) { return String(a).localeCompare(String(b), undefined, { sensitivity: "base" }); }
  function sortMovies(items, spec, dir) {
    var sign = dir === "asc" ? 1 : -1;
    return items.slice().sort(function (a, b) {
      var va = spec.get(a), vb = spec.get(b);
      if (va == null && vb == null) return cmpStr(a.name || "", b.name || "");
      if (va == null) return 1;
      if (vb == null) return -1;
      var c = spec.type === "num" ? (va - vb) : cmpStr(va, vb);
      return (sign * c) || cmpStr(a.name || "", b.name || "");
    });
  }

  var VIEWS = [{ key: "full", label: "Full" }, { key: "small", label: "Small" }, { key: "line", label: "Line" }];

  // Flags are derived facts a film either has or hasn't.
  var FLAGS = [
    { key: "liked",     label: "♥ Liked",    has: function (m) { return m.liked; } },
    { key: "rewatched", label: "↻ Rewatched", has: function (m) { return m.film_rewatch != null ? m.film_rewatch : m.rewatch; } },
    { key: "reviewed",  label: "✎ Reviewed", has: function (m) { return !!m.review; } }
  ];
  function flagByKey(key) {
    for (var i = 0; i < FLAGS.length; i++) if (FLAGS[i].key === key) return FLAGS[i];
    return null;
  }

  // ── Pipeline: filter -> search -> sort -> render ──────────────
  // ALL holds one entry per film (rewatches grouped); EXPANDED one entry
  // per diary sitting — a clone of the film wearing that watch's date,
  // rating, and review, so the whole pipeline works on either unchanged.
  var ALL = [], EXPANDED = [], UPDATED = "";
  function expandWatches(movies) {
    var out = [];
    movies.forEach(function (m) {
      var w = m.watches || [];
      if (w.length < 2) { out.push(m); return; }
      w.forEach(function (watch, i) {   // newest first, numbered oldest = 1
        var e = Object.assign({}, m, {
          watched_date: watch.date,
          rating: watch.rating != null ? watch.rating : m.rating,
          rewatch: watch.rewatch,
          film_rewatch: m.rewatch,   // film-level flag, so the Rewatched
                                     // filter keeps every sitting incl. the first
          review: watch.review,
          watch_no: w.length - i,
          watch_total: w.length
        });
        out.push(e);
      });
    });
    return out;
  }
  function pool() { return state.grouped ? ALL : EXPANDED; }
  function visible() {
    var f = state.filters;
    var q = query.trim().toLowerCase();
    return pool().filter(function (m) {
      // Facets: OR within a facet, AND or OR across facets per the toggle.
      // A facet with no selection adds no constraint.
      var facets = [];
      if (f.ratings.length) facets.push(f.ratings.indexOf(m.rating == null ? "none" : m.rating) >= 0);
      if (f.decades.length) facets.push(f.decades.indexOf(m.decade) >= 0);
      if (f.flags.length) facets.push(f.flags.some(function (k) {
        var fl = flagByKey(k); return fl && fl.has(m);
      }));
      if (f.statuses.length) facets.push(f.statuses.indexOf(m.status) >= 0);
      if (facets.length) {
        var ok = state.filterMode === "or" ? facets.some(Boolean) : facets.every(Boolean);
        if (!ok) return false;
      }
      if (q) {
        var hay = (m.name + " " + (m.year || "") + " " + (m.review || "")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function refresh() {
    var list = sortMovies(visible(), sortByKey(state.sortKey), state.sortDir);
    GRID.setAttribute("data-view", state.view);
    GRID.textContent = "";
    if (!list.length) {
      GRID.appendChild(el("p", "sotd__empty",
        pool().length ? "No films match — try clearing a filter." : "No films yet — check back soon."));
    } else {
      list.forEach(function (m) { GRID.appendChild(buildCard(m)); });
    }
    setMeta(list.length);
  }
  function setMeta(shown) {
    if (!META) return;
    var total = pool().length;
    var noun = state.grouped ? "film" : "watch", nouns = state.grouped ? "films" : "watches";
    var line = (shown === total)
      ? total + " " + (total === 1 ? noun : nouns)
      : shown + " of " + total + " " + nouns;
    if (UPDATED) line += " · updated " + UPDATED;
    META.textContent = line;
  }

  // ── Toolbar: pills that each open one popover ─────────────────
  var TOOLBAR = document.querySelector("[data-movies-toolbar]");
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

  function buildSortPill() {
    var pop;
    function mark() {
      pop.querySelectorAll(".tb-pop__opt").forEach(function (b) {
        var on = b.dataset.key === state.sortKey;
        b.classList.toggle("is-active", on); b.setAttribute("aria-checked", String(on));
      });
      pop.querySelectorAll(".tb-pop__dir").forEach(function (b) {
        b.classList.toggle("is-active", b.dataset.dir === state.sortDir);
      });
    }
    makePill("Sort", function (p) {
      pop = p;
      SORTS.forEach(function (spec) {
        p.appendChild(optButton(spec.label, spec.key, spec.key === state.sortKey, function () {
          if (state.sortKey !== spec.key) { state.sortKey = spec.key; state.sortDir = spec.dir; }
          saveState(); mark(); refresh();
        }));
      });
      var dirs = el("div", "tb-pop__dirs");
      [["asc", "Asc ↑"], ["desc", "Desc ↓"]].forEach(function (d) {
        var b = el("button", "tb-pop__dir", d[1]);
        b.type = "button"; b.dataset.dir = d[0];
        if (d[0] === state.sortDir) b.classList.add("is-active");
        b.addEventListener("click", function () { state.sortDir = d[0]; saveState(); mark(); refresh(); });
        dirs.appendChild(b);
      });
      p.appendChild(dirs);
    });
  }

  function buildViewPill() {
    var pop;
    function mark() {
      pop.querySelectorAll(".tb-pop__opt").forEach(function (b) {
        var on = b.dataset.key === state.view;
        b.classList.toggle("is-active", on); b.setAttribute("aria-checked", String(on));
      });
      pop.querySelectorAll(".tb-pop__dir").forEach(function (b) {
        b.classList.toggle("is-active", (b.dataset.group === "all") !== state.grouped);
      });
    }
    makePill("View", function (p) {
      pop = p;
      VIEWS.forEach(function (v) {
        p.appendChild(optButton(v.label, v.key, v.key === state.view, function () {
          state.view = v.key; saveState(); mark(); refresh();
        }));
      });
      // Rewatches: one card per film vs one per diary sitting. Divided off
      // at the foot, same shape as the Sort popover's direction toggle.
      var dirs = el("div", "tb-pop__dirs");
      [["grouped", "Grouped"], ["all", "Every watch"]].forEach(function (g) {
        var b = el("button", "tb-pop__dir", g[1]);
        b.type = "button"; b.dataset.group = g[0];
        if ((g[0] === "all") !== state.grouped) b.classList.add("is-active");
        b.addEventListener("click", function () {
          state.grouped = g[0] === "grouped"; saveState(); mark(); refresh();
        });
        dirs.appendChild(b);
      });
      p.appendChild(dirs);
    });
  }

  // ── Filter (rating / decade / flags / status facets) ──────────
  var filterEntry = null, searchEntry = null;
  var RATINGS = [], DECADES = [], STATUSES = [];

  function activeFacetCount() {
    var f = state.filters, n = 0;
    if (f.ratings.length) n++;
    if (f.decades.length) n++;
    if (f.flags.length) n++;
    if (f.statuses.length) n++;
    return n;
  }
  function filtersActive() { return activeFacetCount() > 0; }
  function updateFilterPill() {
    if (filterEntry) filterEntry.pill.classList.toggle("is-active", !!filtersActive());
  }
  function updateSearchPill() {
    if (searchEntry) searchEntry.pill.classList.toggle("is-active", !!query.trim());
  }
  function updateCombineDim(pop) {
    var combine = pop.querySelector(".filter-combine");
    if (!combine) return;
    var dim = activeFacetCount() < 2;
    combine.classList.toggle("is-dim", dim);
    combine.querySelectorAll(".filter-combine__btn").forEach(function (b) { b.disabled = dim; });
  }

  function facetGroup(pop, title, key, options, labelFn, searchable) {
    var group = el("div", "filter-group");
    group.appendChild(el("div", "filter-group__title", title));
    var list = el("div", "filter-group__list");
    options.forEach(function (opt) {
      var label = el("label", "filter-check");
      var input = el("input");
      input.type = "checkbox";
      input.checked = state.filters[key].indexOf(opt) >= 0;
      input.addEventListener("change", function () {
        var arr = state.filters[key], i = arr.indexOf(opt);
        if (input.checked && i < 0) arr.push(opt);
        else if (!input.checked && i >= 0) arr.splice(i, 1);
        saveState(); refresh(); updateFilterPill(); updateCombineDim(pop);
      });
      var name = labelFn ? labelFn(opt) : opt;
      label.appendChild(input);
      label.appendChild(el("span", "filter-check__name", name));
      label._match = String(name).toLowerCase();
      list.appendChild(label);
    });
    group.appendChild(list);
    if (searchable) {
      var find = el("input", "filter-search");
      find.type = "search";
      find.placeholder = "Search " + title.toLowerCase() + "s";
      find.addEventListener("input", function () {
        var q = find.value.trim().toLowerCase();
        list.querySelectorAll(".filter-check").forEach(function (row) {
          row.style.display = (!q || row._match.indexOf(q) >= 0) ? "" : "none";
        });
      });
      group.appendChild(find);
    }
    return group;
  }

  function ratingLabel(r) { return r === "none" ? "Unrated" : stars(r); }
  function flagLabel(k) { var f = flagByKey(k); return f ? f.label : k; }
  function statusLabel(s) { return s === "watchlist" ? "Watchlist" : "Watched"; }

  function buildFilterPop(pop) {
    pop.classList.add("tb-pop--filter");
    pop.textContent = "";

    pop.appendChild(facetGroup(pop, "Rating", "ratings", RATINGS, ratingLabel));
    pop.appendChild(facetGroup(pop, "Decade", "decades", DECADES, null, true));
    pop.appendChild(facetGroup(pop, "Extra", "flags",
      FLAGS.map(function (f) { return f.key; }), flagLabel));
    if (STATUSES.length > 1)
      pop.appendChild(facetGroup(pop, "Status", "statuses", STATUSES, statusLabel));

    var foot = el("div", "filter-foot");
    var combine = el("div", "filter-combine");
    [["and", "AND"], ["or", "OR"]].forEach(function (m) {
      var b = el("button", "filter-combine__btn", m[1]); b.type = "button"; b.dataset.mode = m[0];
      if (m[0] === state.filterMode) b.classList.add("is-active");
      b.addEventListener("click", function () {
        state.filterMode = m[0]; saveState();
        combine.querySelectorAll(".filter-combine__btn").forEach(function (x) {
          x.classList.toggle("is-active", x.dataset.mode === state.filterMode);
        });
        refresh();
      });
      combine.appendChild(b);
    });
    foot.appendChild(combine);
    var clear = el("button", "filter-clear", "Clear filters"); clear.type = "button";
    clear.addEventListener("click", function () {
      state.filters = { ratings: [], decades: [], flags: [], statuses: [] };
      saveState(); buildFilterPop(pop); refresh(); updateFilterPill();
    });
    foot.appendChild(clear);
    pop.appendChild(foot);

    updateCombineDim(pop);
  }

  function buildFilterPill() { filterEntry = makePill("Filter", buildFilterPop); updateFilterPill(); }

  // ── Search (live case-insensitive substring) ──────────────────
  function buildSearchPill() {
    searchEntry = makePill("Search", function (pop) {
      pop.classList.add("tb-pop--search");
      var input = el("input", "tb-search__input");
      input.type = "search"; input.placeholder = "Search film, year, review…";
      input.value = query;
      input.setAttribute("data-autofocus", "");
      input.addEventListener("input", function () { query = input.value; updateSearchPill(); refresh(); });
      pop.appendChild(input);
      var clr = el("button", "tb-search__clear", "Clear"); clr.type = "button";
      clr.addEventListener("click", function () { query = ""; input.value = ""; updateSearchPill(); refresh(); input.focus(); });
      pop.appendChild(clr);
    });
    updateSearchPill();
  }

  fetch("./movies.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      ALL = (data && data.movies) || [];
      EXPANDED = expandWatches(ALL);
      UPDATED = data.generated_at ? prettyDate(data.generated_at.slice(0, 10)) : "";
      // Rating facet: the half-star values actually present, best first,
      // with "Unrated" at the end when any film lacks a rating.
      RATINGS = Array.from(new Set(ALL.map(function (m) { return m.rating; })))
        .filter(function (r) { return r != null; })
        .sort(function (a, b) { return b - a; });
      if (ALL.some(function (m) { return m.rating == null; })) RATINGS.push("none");
      DECADES = Array.from(new Set(ALL.map(function (m) { return m.decade; })))
        .filter(Boolean)
        .sort(function (a, b) { return b.localeCompare(a); });
      STATUSES = Array.from(new Set(ALL.map(function (m) { return m.status; }))).sort();
      if (TOOLBAR) { buildSortPill(); buildViewPill(); buildFilterPill(); buildSearchPill(); }
      refresh();
    })
    .catch(function () {
      GRID.textContent = "";
      GRID.appendChild(el("p", "sotd__empty",
        "Couldn't load the film log. Try again in a moment."));
    });
})();
