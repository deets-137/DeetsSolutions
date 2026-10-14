/* DeetsMusic admin page (deets.solutions/deetsmusic/admin/) — the owner's own page (his call,
   2026-10-14: the usage numbers moved here from the DeetsMusic page; moderation stays inline on
   the boards). DeetsSolutions docs/support.md, "The admin page".

   - Who the owner is stays the worker's call: the page asks GET /admin/me with the ds_sess
     cookie and shows nothing until the answer is yes. Every /admin/* route checks again.
   - Strings come from ../strings.js (DM_STRINGS); ?mock answers from ../mock.js (DM_MOCK),
     where a signed-in mock account is the owner.
   - A self-contained copy of the few helpers and the pill kit deetsmusic.js uses, so neither
     page loads the other's code. A fix to the pill kit there is mirrored here. */
(function () {
  "use strict";

  var ROOT = document.querySelector("[data-dm-admin]");
  var S = window.DM_STRINGS;
  if (!ROOT || !S) return;

  var HOSTS = { support: "https://support.deets.solutions" };
  var MOCK = window.DM_MOCK || null;

  // ── Helpers (deetsmusic.js's, the parts this page needs) ────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function s(key, vars) {
    var v = S[key];
    if (v == null) return key;
    if (!vars) return v;
    return v.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; });
  }
  function fmtDay(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  function cmpVersionDesc(a, b) {
    var pa = a.split("."), pb = b.split(".");
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var d = (parseInt(pb[i], 10) || 0) - (parseInt(pa[i], 10) || 0);
      if (d) return d;
    }
    return a < b ? 1 : a > b ? -1 : 0;
  }
  // Resolves (never rejects) to { ok, status, data }; a network failure is status 0.
  function ownerApi(method, path) {
    if (MOCK) return MOCK.request("support", method, path);
    return fetch(HOSTS.support + path, { method: method, credentials: "include" }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        return { ok: r.ok, status: r.status, data: data };
      });
    }, function () {
      return { ok: false, status: 0, data: { error: "network" } };
    });
  }

  // ── The pill kit (deetsmusic.js's makePill / optButton / togglePop) ──
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
    entry.fill(entry.pop);
    entry.pop.hidden = false;
    entry.pill.setAttribute("aria-expanded", "true");
    openEntry = entry;
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onDocKey);
  }
  function makePill(host, label, fill) {
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
    var entry = { ctrl: ctrl, pill: pill, pop: pop, fill: fill };
    pill.addEventListener("click", function () { togglePop(entry); });
    ctrl.appendChild(pill);
    ctrl.appendChild(pop);
    host.appendChild(ctrl);
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

  // ── The gate: the worker says who the owner is ─────────────────
  function gate(key) {
    var g = $("[data-dm-admin-gate]");
    g.hidden = !key;
    if (key) g.textContent = s(key);
  }
  function watchOwner() {
    if (!window.DeetsAccount) { gate("adminSignedOut"); return; }
    var asked = null;
    window.DeetsAccount.onChange(function (u) {
      if (u === null) return;                       // not known yet
      if (!u) { asked = null; gate("adminSignedOut"); showUsage(false); return; }
      if (asked === u.id) return;
      asked = u.id;
      gate("adminChecking");
      ownerApi("GET", "/admin/me").then(function (res) {
        var yes = !!(res.ok && res.data && res.data.owner);
        gate(yes ? null : "adminNotOwner");
        showUsage(yes);
      });
    });
  }
  // ── Usage (DeetsMusic docs/features/USAGE-COUNTS.md §6) ──────────
  // GET /admin/usage?channel=&week= answers the active-install counters (day,
  // ISO week and month rows, per version), the weeks that hold settings rows,
  // and one week's setting shares and health counters. The cross-check is its
  // own call (&a=&b=&from=&to=). Counts only: the worker never sends a raw
  // settings row. Real numbers, no small-group limit (his call, 2026-10-13).
  var USAGE_BOX = $("[data-dm-usage]");
  var usage = { channel: "live", week: null, data: null, setting: "skin", a: "skin", b: "surface", v: "", seq: 0, crossSeq: 0, pills: null };
  var USAGE_CHANNELS = ["live", "beta", "dev"];
  var USAGE_BUCKETS = ["0", "1-9", "10-99", "100-999", "1000+"];
  /* The health metrics every report can carry (usage.rs): shown even when no
     install counted one this week, so "all zero" reads as a row, not a gap. */
  var USAGE_PLAIN = ["panics", "freezes", "dbWriteFails", "backoffArms"];
  var USAGE_GROUPS = ["library", "me", "catalog", "search", "write", "probe"];
  var USAGE_CLASSES = ["2xx", "401", "403", "404", "429", "4xx", "5xx", "net"];
  var USAGE_DAYS = 60;

  function usageDay(d) { return d.toISOString().slice(0, 10); }
  function fmtCount(n) { return Math.round(n).toLocaleString("en-US"); }
  function usageWear(entry) {
    var v = el("span", "tb-pill__value");
    entry.pill.insertBefore(v, entry.pill.querySelector(".tb-pill__caret"));
    return v;
  }
  /* One single-choice pill: `get` the current value, `list` the choices
     ([value, label]), `pick` a new value. The pop closes on a pick. */
  function usagePill(host, label, get, list, pick) {
    var entry = makePill(host, label, function (pop) {
      pop.textContent = "";
      list().forEach(function (o) {
        pop.appendChild(optButton(o[1], o[0], get() === o[0], function () {
          closePop();
          if (get() !== o[0]) pick(o[0]);
        }));
      });
    });
    entry.value = usageWear(entry);
    entry.paint = function () {
      var hit = list().filter(function (o) { return o[0] === get(); })[0];
      entry.value.textContent = hit ? hit[1] : get();
    };
    return entry;
  }

  function showUsage(yes) {
    if (!USAGE_BOX) return;
    USAGE_BOX.hidden = !yes;
    if (!yes) return;
    wireUsageTools();
    loadUsage();
  }
  function wireUsageTools() {
    if (usage.pills) return;
    var keys = function () { return usageKeys().map(function (k) { return [k, k]; }); };
    usage.pills = [
      usagePill($("[data-dm-usage-tools]"), s("usageChannelPill"), function () { return usage.channel; },
        function () { return USAGE_CHANNELS.map(function (c) { return [c, s("usageCh_" + c)]; }); },
        function (c) { usage.channel = c; usage.week = null; loadUsage(); }),
      usagePill($("[data-dm-usage-tools]"), s("usageWeekPill"), function () { return usage.week || ""; },
        function () { return usageWeeks().map(function (w) { return [w, w]; }); },
        function (w) { usage.week = w; loadUsage(); }),
      usagePill($("[data-dm-usage-settool]"), s("usageSettingPill"), function () { return usage.setting; }, keys,
        function (k) { usage.setting = k; renderUsage(); }),
      usagePill($("[data-dm-usage-crosstools]"), s("usageCrossA"), function () { return usage.a; }, keys,
        function (k) { usage.a = k; loadCross(); paintUsagePills(); }),
      usagePill($("[data-dm-usage-crosstools]"), s("usageCrossB"), function () { return usage.b; }, keys,
        function (k) { usage.b = k; loadCross(); paintUsagePills(); }),
      usagePill($("[data-dm-usage-healthtool]"), s("usageVersionPill"), function () { return usage.v; },
        function () { return [["", s("usageAllVersions")]].concat(usageVersions().map(function (v) { return [v, v]; })); },
        function (v) { usage.v = v; renderUsage(); }),
    ];
    paintUsagePills();
  }
  function paintUsagePills() { (usage.pills || []).forEach(function (p) { p.paint(); }); }

  function loadUsage() {
    var seq = ++usage.seq;
    var state = $("[data-dm-usage-state]");
    state.hidden = false;
    state.textContent = s("usageLoading");
    var q = "/admin/usage?channel=" + encodeURIComponent(usage.channel) + (usage.week ? "&week=" + encodeURIComponent(usage.week) : "");
    ownerApi("GET", q).then(function (res) {
      if (seq !== usage.seq) return;
      if (!res.ok || !res.data) {
        state.textContent = s("usageFailed");
        $("[data-dm-usage-body]").hidden = true;
        return;
      }
      usage.data = res.data;
      usage.week = res.data.week;
      state.hidden = true;
      $("[data-dm-usage-body]").hidden = false;
      renderUsage();
      loadCross();
    });
  }

  function usageWeeks() {
    var d = usage.data, seen = {};
    if (!d) return [];
    d.weeks.forEach(function (w) { seen[w.week] = 1; });
    d.active.forEach(function (r) { if (r.period.indexOf("-W") > 0) seen[r.period] = 1; });
    if (usage.week) seen[usage.week] = 1;
    return Object.keys(seen).sort().reverse();
  }
  function usageKeys() {
    var seen = {};
    ((usage.data && usage.data.shares) || []).forEach(function (r) { seen[r.key] = 1; });
    [usage.setting, usage.a, usage.b].forEach(function (k) { seen[k] = 1; });
    return Object.keys(seen).sort();
  }
  function usageVersions() {
    var seen = {};
    ((usage.data && usage.data.health) || []).forEach(function (r) { seen[r.v] = 1; });
    return Object.keys(seen).sort(cmpVersionDesc);
  }
  function sumActive(period) {
    return usage.data.active.reduce(function (n, r) { return r.period === period ? n + r.n : n; }, 0);
  }
  function weekReports() {
    var w = usage.data.weeks.filter(function (x) { return x.week === usage.week; })[0];
    return w ? w.n : 0;
  }

  function renderUsage() {
    if (!usage.data) return;
    paintUsagePills();
    var now = new Date();
    var kpis = $("[data-dm-usage-kpis]");
    kpis.textContent = "";
    [["usageToday", sumActive(usageDay(now))], ["usageThisWeek", sumActive(usage.week)],
     ["usageThisMonth", sumActive(usageDay(now).slice(0, 7))], ["usageReports", weekReports()]].forEach(function (k) {
      var box = el("div", "dm-usage__kpi");
      box.appendChild(el("span", "dm-usage__num", fmtCount(k[1])));
      box.appendChild(el("span", "dm-hint", s(k[0])));
      kpis.appendChild(box);
    });
    renderDaily(now);
    var byV = {};
    usage.data.active.forEach(function (r) { if (r.period === usage.week) byV[r.v] = (byV[r.v] || 0) + r.n; });
    renderBars($("[data-dm-usage-versions]"), Object.keys(byV).sort(cmpVersionDesc).map(function (v) { return [v, byV[v]]; }), sumActive(usage.week));
    var shares = usage.data.shares.filter(function (r) { return r.key === usage.setting; })
      .sort(function (a, b) { return b.n - a.n; }).map(function (r) { return [r.value, r.n]; });
    renderBars($("[data-dm-usage-shares]"), shares, weekReports());
    renderHealth();
  }

  /* The day line: the last 60 UTC days, every version summed, a missing day
     as 0. Drawn in SVG in the page's own title color (no chart library). */
  function renderDaily(now) {
    var host = $("[data-dm-usage-daily]");
    host.textContent = "";
    var days = [];
    for (var i = USAGE_DAYS - 1; i >= 0; i--) {
      var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      days.push({ day: usageDay(d), n: sumActive(usageDay(d)) });
    }
    var max = Math.max.apply(null, days.map(function (x) { return x.n; }));
    if (!max) { host.appendChild(el("p", "dm-empty", s("usageNone"))); return; }
    var W = 600, H = 120, step = W / (days.length - 1);
    var pts = days.map(function (x, i) { return (i * step).toFixed(1) + "," + (H - (x.n / max) * (H - 4) - 2).toFixed(1); });
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "dm-usage__svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", s("usageDaily"));
    var area = document.createElementNS(NS, "polygon");
    area.setAttribute("points", "0," + H + " " + pts.join(" ") + " " + W + "," + H);
    area.setAttribute("class", "dm-usage__area");
    var line = document.createElementNS(NS, "polyline");
    line.setAttribute("points", pts.join(" "));
    line.setAttribute("class", "dm-usage__line");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(area);
    svg.appendChild(line);
    days.forEach(function (x, i) {                  // a hover title per day
      var hit = document.createElementNS(NS, "rect");
      hit.setAttribute("x", (i * step - step / 2).toFixed(1));
      hit.setAttribute("y", "0");
      hit.setAttribute("width", step.toFixed(1));
      hit.setAttribute("height", String(H));
      hit.setAttribute("class", "dm-usage__hit");
      var t = document.createElementNS(NS, "title");
      t.textContent = fmtDay(x.day) + ": " + fmtCount(x.n);
      hit.appendChild(t);
      svg.appendChild(hit);
    });
    host.appendChild(svg);
    host.appendChild(el("p", "dm-hint", s("usageDailyAxis", { from: fmtDay(days[0].day), to: fmtDay(days[days.length - 1].day), max: fmtCount(max) })));
  }

  /* Bars on the Status strip's track: one row per value, its count and share. */
  function renderBars(host, rows, total) {
    host.textContent = "";
    if (!rows.length) { host.appendChild(el("p", "dm-empty", s("usageNone"))); return; }
    rows.forEach(function (r) {
      var row = el("div", "dm-usage__bar");
      row.appendChild(el("span", "dm-usage__label", r[0] == null ? "–" : String(r[0])));
      var track = el("span", "dm-usage__track");
      var fill = el("span", "dm-usage__fill");
      fill.style.inlineSize = (total ? Math.max(0.5, (r[1] / total) * 100) : 0).toFixed(1) + "%";
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("span", "dm-usage__count", fmtCount(r[1]) + (total ? " · " + Math.round((r[1] / total) * 100) + "%" : "")));
      host.appendChild(row);
    });
  }

  function usageTable(head, rows) {
    var t = el("table", "dm-usage__grid");
    var tr = el("tr");
    head.forEach(function (h) { tr.appendChild(el("th", null, h)); });
    var thead = el("thead");
    thead.appendChild(tr);
    t.appendChild(thead);
    var tb = el("tbody");
    rows.forEach(function (r) {
      var row = el("tr");
      r.forEach(function (c, i) {
        var cell = el(i ? "td" : "th", null, typeof c === "number" ? fmtCount(c) : c);
        if (!i) cell.setAttribute("scope", "row");
        if (typeof c === "number" && !c) cell.className = "is-zero";
        row.appendChild(cell);
      });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    return t;
  }

  /* Every health metric: the four plain ones, the whole Apple table, and every
     log area some install counted. A metric is stored only above 0, so the "0"
     column is the reports minus the other ranges. */
  function renderHealth() {
    var cells = {}, reports = 0, logs = {};
    usage.data.health.forEach(function (r) {
      if (usage.v && r.v !== usage.v) return;
      if (r.metric === "reports") { reports += r.n; return; }
      if (r.metric.indexOf("log.") === 0) logs[r.metric] = 1;
      cells[r.metric] = cells[r.metric] || {};
      cells[r.metric][r.bucket] = (cells[r.metric][r.bucket] || 0) + r.n;
    });
    var metrics = USAGE_PLAIN.slice()
      .concat(Object.keys(logs).sort())
      .concat([].concat.apply([], USAGE_GROUPS.map(function (g) { return USAGE_CLASSES.map(function (c) { return "apple." + g + "." + c; }); })));
    Object.keys(cells).forEach(function (m) { if (metrics.indexOf(m) < 0) metrics.push(m); });
    $("[data-dm-usage-healthlead]").textContent = s("usageHealthLead", { n: fmtCount(reports) });
    var host = $("[data-dm-usage-health]");
    host.textContent = "";
    host.appendChild(usageTable([s("usageMetric")].concat(USAGE_BUCKETS), metrics.map(function (m) {
      var c = cells[m] || {};
      var above = USAGE_BUCKETS.slice(1).map(function (b) { return c[b] || 0; });
      var zero = Math.max(0, reports - above.reduce(function (a, b) { return a + b; }, 0));
      return [m, zero].concat(above);
    })));
  }

  function loadCross() {
    var seq = ++usage.crossSeq;
    var host = $("[data-dm-usage-cross]");
    var q = "/admin/usage?channel=" + encodeURIComponent(usage.channel) + "&a=" + encodeURIComponent(usage.a) +
      "&b=" + encodeURIComponent(usage.b) + "&from=" + encodeURIComponent(usage.week) + "&to=" + encodeURIComponent(usage.week);
    ownerApi("GET", q).then(function (res) {
      if (seq !== usage.crossSeq) return;
      host.textContent = "";
      var rows = res.ok && res.data && res.data.rows;
      if (!rows) { host.appendChild(el("p", "dm-empty", s("usageFailed"))); return; }
      if (!rows.length) { host.appendChild(el("p", "dm-empty", s("usageNone"))); return; }
      var name = function (v) { return v == null ? "–" : String(v); };
      var as = [], bs = [], at = {};
      rows.forEach(function (r) {
        var a = name(r.a), b = name(r.b);
        if (as.indexOf(a) < 0) as.push(a);
        if (bs.indexOf(b) < 0) bs.push(b);
        at[a + "\u0000" + b] = r.n;
      });
      host.appendChild(usageTable([usage.a + " \\ " + usage.b].concat(bs), as.map(function (a) {
        return [a].concat(bs.map(function (b) { return at[a + "\u0000" + b] || 0; }));
      })));
    });
  }

  // ── Boot ───────────────────────────────────────────────────────
  $all("[data-s]").forEach(function (n) { n.textContent = s(n.getAttribute("data-s")); });
  var badge = $("[data-dm-mock]");
  if (badge) badge.hidden = !MOCK;
  watchOwner();
})();
