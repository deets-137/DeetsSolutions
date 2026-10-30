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
  // A local DeetsSupport run (deetsmusic.js has the same lines; support.md, "Local testing").
  var LOCAL_SUPPORT = window.DEETS_SUPPORT_LOCAL && window.DEETS_SUPPORT_LOCAL.base;
  if (LOCAL_SUPPORT && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) &&
      /^http:\/\/localhost:\d+$/.test(LOCAL_SUPPORT)) HOSTS.support = LOCAL_SUPPORT;
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
  function ownerApi(method, path, body) {
    if (MOCK) return MOCK.request("support", method, path, body);
    var init = { method: method, credentials: "include" };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    return fetch(HOSTS.support + path, init).then(function (r) {
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
      if (!u) { asked = null; gate("adminSignedOut"); showUsage(false); showInbox(false); return; }
      if (asked === u.id) return;
      asked = u.id;
      gate("adminChecking");
      ownerApi("GET", "/admin/me").then(function (res) {
        var yes = !!(res.ok && res.data && res.data.owner);
        gate(yes ? null : "adminNotOwner");
        showInbox(yes);
        showUsage(yes);
        showHistory(yes);
      });
    });
  }
  // ── Inbox (support.md, "The admin page" › The Inbox) ─────────────
  // Every post of both kinds, hidden ones too, newest activity first, each with its
  // whole text, its thread, a reply box and its status. No route of its own (his ask,
  // 2026-10-26: no worker change while the app is live): GET /admin/posts gives the
  // list, then one GET /t/<code> per post gives the thread, with the hidden rows
  // because the request carries his cookie. The writes are the boards' owner routes.
  var INBOX_BOX = $("[data-dm-inbox]");
  var LS_INBOX = "deets-dm-inbox";   // { show, kind } — this browser's last choice
  var DONE = { fixed: 1, wontfix: 1, closed: 1 };
  var STATES = ["new", "open", "planned", "fixed", "wontfix", "closed"];
  var THREAD_REQS = 4;               // threads read at once
  var inbox = { show: "waiting", kind: "", posts: null, threads: {}, seq: 0, pills: null };
  try {
    var savedInbox = JSON.parse(localStorage.getItem(LS_INBOX)) || {};
    if (["waiting", "open", "all"].indexOf(savedInbox.show) >= 0) inbox.show = savedInbox.show;
    if (["", "suggestion", "issue"].indexOf(savedInbox.kind) >= 0) inbox.kind = savedInbox.kind;
  } catch (e) {}

  function toast(kind, text) { if (window.DeetsToast) window.DeetsToast.push({ kind: kind, text: text }); }
  function errText(res) {
    var code = res && res.data && res.data.error;
    return S["err_" + code] ? s("err_" + code) : s("err_generic");
  }
  function fmtUnix(t) {
    return new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function chip(text, tone) {
    var c = el("span", "dm-chip", text);
    if (tone) c.setAttribute("data-tone", tone);
    return c;
  }

  /* Waiting on him: an open post with no reply from him yet, or one where the poster
     wrote after his last reply. A member's comment is talk among visitors, not a
     question to him, so it neither opens nor closes the wait. A hidden row counts for
     nothing. A thread not read yet is not called waiting. */
  function isWaiting(p) {
    var t = inbox.threads[p.code];
    if (DONE[p.state] || !t) return false;
    var lastOwner = -1, lastPoster = -1;
    t.forEach(function (r, i) {
      if (r.hidden) return;
      if (r.author === "owner") lastOwner = i;
      else if (r.author === "reporter") lastPoster = i;
    });
    return lastOwner < 0 || lastPoster > lastOwner;
  }
  // meta is whatever string the sender wrote: JSON from the app and the form, but read leniently.
  function parseMeta(meta) {
    if (!meta) return null;
    try {
      var m = typeof meta === "string" ? JSON.parse(meta) : meta;
      return m && typeof m === "object" ? m : null;
    } catch (e) { return null; }
  }
  function lastActivity(p) {
    var t = inbox.threads[p.code] || [];
    return t.reduce(function (m, r) { return Math.max(m, r.created_at); }, p.created_at);
  }

  // The box is a dashboard tab now: the tabs show and hide it, the gate shows the dashboard.
  function showInbox(yes) {
    if (!INBOX_BOX || !yes) return;
    wireInboxTools();
    loadInbox();
  }
  function saveInbox() {
    try { localStorage.setItem(LS_INBOX, JSON.stringify({ show: inbox.show, kind: inbox.kind })); } catch (e) {}
  }
  function wireInboxTools() {
    if (inbox.pills) return;
    var host = $("[data-dm-inbox-tools]");
    inbox.pills = [
      usagePill(host, s("inboxShowPill"), function () { return inbox.show; },
        function () { return ["waiting", "open", "all"].map(function (k) { return [k, s("inboxShow_" + k)]; }); },
        function (k) { inbox.show = k; saveInbox(); renderInbox(); }),
      usagePill(host, s("inboxKindPill"), function () { return inbox.kind; },
        function () { return [["", s("inboxKind_all")], ["suggestion", s("inboxKind_suggestion")], ["issue", s("inboxKind_issue")]]; },
        function (k) { inbox.kind = k; saveInbox(); renderInbox(); }),
    ];
    inbox.pills.forEach(function (p) { p.paint(); });
  }

  function inboxState(text) {
    var p = $("[data-dm-inbox-state]");
    p.hidden = !text;
    p.textContent = text || "";
  }

  function loadInbox() {
    var seq = ++inbox.seq;
    if (!inbox.posts) inboxState(s("inboxLoading"));
    ownerApi("GET", "/admin/posts?app=deetsmusic").then(function (res) {
      if (seq !== inbox.seq) return;
      var posts = res.ok && res.data && res.data.posts;
      if (!Array.isArray(posts)) { inbox.posts = null; inboxState(s("inboxFailed")); $("[data-dm-inbox-list]").textContent = ""; return; }
      inbox.posts = posts;
      renderInbox();
      // The threads, a few at a time; the list repaints as each one lands.
      var queue = posts.slice();
      var next = function () {
        var p = queue.shift();
        if (!p || seq !== inbox.seq) return;
        return loadThread(p).then(next);
      };
      for (var i = 0; i < THREAD_REQS; i++) next();
    });
  }
  function loadThread(p) {
    return ownerApi("GET", "/t/" + p.code).then(function (res) {
      if (!res.ok || !res.data) return;
      inbox.threads[p.code] = Array.isArray(res.data.replies) ? res.data.replies : [];
      if (res.data.post && res.data.post.state) p.state = res.data.post.state;
      if (res.data.post && typeof res.data.post.public === "boolean") p.public = res.data.post.public;
      // Only the thread read carries these (the list does not): where the post came from,
      // and what it sent with it — the version, and an app bug's log tail.
      if (res.data.post) {
        p.source = res.data.post.source;
        p.meta = parseMeta(res.data.post.meta);
        p.read_at = res.data.post.read_at || null;   // the filer's last read ("Read marks")
      }
      renderInbox();
    });
  }

  /* A repaint keeps what he was typing: the reply boxes are kept by code and put back. */
  function renderInbox() {
    if (!inbox.posts) return;
    var list = $("[data-dm-inbox-list]");
    var drafts = {};
    $all("[data-inbox-reply]", list).forEach(function (t) { if (t.value) drafts[t.getAttribute("data-inbox-reply")] = t.value; });
    var focused = document.activeElement && document.activeElement.getAttribute("data-inbox-reply");
    closePop();

    var waiting = inbox.posts.filter(isWaiting).length;
    var pending = inbox.posts.filter(function (p) { return !inbox.threads[p.code]; }).length;
    inboxState(pending ? s("inboxReading", { n: pending }) : s(waiting === 1 ? "inboxWaitingOne" : "inboxWaitingMany", { n: waiting }));
    paintInboxSummary();
    paintDash();

    var shown = inbox.posts.filter(function (p) {
      if (inbox.kind && p.kind !== inbox.kind) return false;
      if (inbox.show === "waiting") return isWaiting(p);
      if (inbox.show === "open") return !DONE[p.state];
      return true;
    }).sort(function (a, b) { return lastActivity(b) - lastActivity(a); });

    list.textContent = "";
    if (!shown.length) {
      list.appendChild(el("p", "dm-empty", s(inbox.show === "waiting" && !pending ? "inboxEmptyWaiting" : "inboxEmpty")));
      return;
    }
    shown.forEach(function (p) { list.appendChild(renderInboxPost(p, drafts[p.code] || "")); });
    if (focused) {
      var back = $('[data-inbox-reply="' + focused + '"]', list);
      if (back) back.focus({ preventScroll: true });
    }
  }

  function renderInboxPost(p, draft) {
    var item = el("article", "dm-post dm-inbox__post");
    if (p.public === false) item.classList.add("is-hidden-post");
    var main = el("div", "dm-post__main");

    var head = el("div", "dm-post__head");
    var h = el("h3", "dm-post__title");
    var link = el("a", "dm-post__link", p.title);
    link.href = "../#t=" + p.code;                 // the thread page, as the owner sees it
    link.target = "_blank";
    link.rel = "noopener";
    h.appendChild(link);
    head.appendChild(h);
    head.appendChild(chip(s("ticketKind_" + p.kind)));
    if (p.source === "app" || p.source === "web") head.appendChild(chip(s("inboxFrom_" + p.source)));
    head.appendChild(chip(s("state_" + p.state), p.state));
    if (isWaiting(p)) head.appendChild(chip(s("inboxWaiting"), "waiting"));
    if (p.public === false) head.appendChild(chip(s("tagHidden"), "hidden"));
    main.appendChild(head);

    main.appendChild(el("p", "dm-inbox__body", p.body));

    var foot = el("div", "dm-post__foot");
    foot.appendChild(el("span", null, fmtUnix(p.created_at)));
    var version = (p.meta && p.meta.version) || p.version;
    if (version) foot.appendChild(el("span", null, version === "all" ? s("ticketVersionAll") : "v" + version));
    foot.appendChild(el("span", null, s("inboxInterest", { n: p.interest || 0 })));
    if (p.read_at) foot.appendChild(el("span", null, s("inboxReadAt", { date: fmtUnix(p.read_at) })));
    main.appendChild(foot);

    // An app bug's log tail (report.rs: the area the user picked, scrubbed). Folded: it is long.
    if (p.meta && typeof p.meta.log === "string" && p.meta.log) {
      var lines = p.meta.log.split("\n").length;
      var det = el("details", "dm-inbox__log");
      det.appendChild(el("summary", null, s(lines === 1 ? "inboxLogOne" : "inboxLogMany", { n: lines })));
      det.appendChild(el("pre", "dm-inbox__logtext", p.meta.log));
      main.appendChild(det);
    }

    var t = inbox.threads[p.code];
    if (t && t.length) {
      var ol = el("ol", "dm-replies dm-inbox__thread");
      t.forEach(function (r) {
        var li = el("li", "dm-reply" + (r.author === "owner" ? " is-owner" : ""));
        if (r.hidden) li.classList.add("is-hidden-reply");
        var who = el("div", "dm-reply__who");
        var label = r.author === "owner" ? s("authorOwner") : r.author === "member" ? (r.name || s("authorPoster")) : s("authorPoster");
        var nameEl = el("span", "dm-reply__name", label);
        if (r.author === "member" && r.color) nameEl.style.setProperty("--dm-who", r.color);
        who.appendChild(nameEl);
        who.appendChild(el("span", null, fmtUnix(r.created_at)));
        if (r.hidden) who.appendChild(chip(s("tagHidden"), "hidden"));
        // Did it reach the filer (support.md, "Read marks")? A hidden reply never shows to them.
        if (r.author === "owner" && !r.hidden) {
          who.appendChild(el("span", "dm-reply__mark", r.seen_at
            ? s(r.seen_via === "app" ? "inboxSeen_app" : "inboxSeen_web", { date: fmtUnix(r.seen_at) })
            : s("inboxNotSeen")));
          if (r.opened_at) who.appendChild(el("span", "dm-reply__mark", s("inboxOpened", { date: fmtUnix(r.opened_at) })));
        }
        li.appendChild(who);
        li.appendChild(el("p", "dm-reply__body", r.body));
        ol.appendChild(li);
      });
      main.appendChild(ol);
    }

    // Reply as Aditya, and the status, side by side under the thread.
    var form = el("form", "dm-inbox__reply");
    form.noValidate = true;
    var area = el("textarea", "dm-field__input dm-field__area");
    area.name = "body";
    area.rows = 3;
    area.maxLength = 4000;
    area.value = draft;
    area.setAttribute("data-inbox-reply", p.code);
    area.setAttribute("aria-label", s("inboxReplyAria", { title: p.title }));
    area.placeholder = s("inboxReplyLabel");
    form.appendChild(area);
    var actions = el("div", "dm-form__actions");
    var send = el("button", "home__cta", s("replySend"));
    send.type = "submit";
    actions.appendChild(send);
    var statusHost = el("div", "dm-board__tools dm-inbox__status");
    actions.appendChild(statusHost);
    form.appendChild(actions);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var b = area.value.trim();
      if (!b) { toast("error", s("err_body")); return; }
      send.disabled = true;
      ownerApi("POST", "/admin/posts/" + p.code + "/replies", { body: b }).then(function (res) {
        send.disabled = false;
        if (!res.ok) { toast("error", errText(res)); return; }
        area.value = "";
        toast("success", s("replySent"));
        loadThread(p);
      });
    });
    main.appendChild(form);
    var status = usagePill(statusHost, s("inboxStatusPill"), function () { return p.state; },
      function () { return STATES.map(function (st) { return [st, s("state_" + st)]; }); },
      function (st) {
        ownerApi("PATCH", "/admin/posts/" + p.code, { state: st }).then(function (res) {
          if (!res.ok) { toast("error", errText(res)); return; }
          p.state = st;
          renderInbox();
        });
      });
    status.paint();

    item.appendChild(main);
    return item;
  }

  // ── Usage (DeetsMusic docs/features/USAGE-COUNTS.md §6) ──────────
  // GET /admin/usage?channel=&week= answers the active-install counters (day,
  // ISO week and month rows, per version), the weeks that hold settings rows,
  // and one week's setting shares and health counters. The cross-check is its
  // own call (&a=&b=&from=&to=). Counts only: the worker never sends a raw
  // settings row. Real numbers, no small-group limit (his call, 2026-10-13).
  var USAGE_BOX = $("[data-dm-usage]");
  /* `hw` the health reports of the chosen week and the HEALTH_WEEKS - 1 before it, newest
     first ([{ week, rows }]); `hweek` the week the Health tab shows (the newest with a report
     unless picked). The worker stores a week's report under the week it covers, and it
     arrives during the week after, so the chosen week alone is nearly always empty. */
  var usage = { channel: "live", week: null, data: null, setting: "skin", a: "skin", b: "surface", v: "", seq: 0, crossSeq: 0, pills: null, hw: null, hweek: null, hpicked: false };
  var HEALTH_WEEKS = 8;
  var USAGE_CHANNELS = ["live", "beta", "owner", "dev"];
  /* The first version whose counts move on an update (USAGE-COUNTS.md §12.2): a week that
     holds an older one may show an updated install under its old version. */
  var USAGE_MOVES_FROM = "1.2.0";
  var USAGE_INSTALL_DAYS = 14;
  var USAGE_BUCKETS = ["0", "1-9", "10-99", "100-999", "1000+"];
  /* The health metrics every report can carry (usage.rs): shown even when no
     install counted one this week, so "all zero" reads as a row, not a gap. */
  var USAGE_PLAIN = ["panics", "freezes", "dbWriteFails", "backoffArms"];
  var USAGE_GROUPS = ["library", "me", "catalog", "search", "write", "probe"];
  var USAGE_CLASSES = ["2xx", "401", "403", "404", "429", "4xx", "5xx", "net"];
  var USAGE_DAYS = 90;

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

  // ── History (support.md, "The archive" › History) ───────────────
  // Posts filed per month, the deleted ones included (GET /admin/history), and every deleted
  // post (GET /admin/archive), each read whole on open (GET /admin/archive/<code>). A first
  // draft for his design; the strings are [ph].
  var hist = { loaded: false, posts: {} };
  function showHistory(yes) {
    if (!yes || hist.loaded || !$("[data-dm-history]")) return;
    hist.loaded = true;
    ownerApi("GET", "/admin/history?app=deetsmusic").then(renderHistoryTable);
    ownerApi("GET", "/admin/archive?app=deetsmusic").then(renderArchive);
  }
  function monthLabel(m) {
    return new Date(m + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  // The last `n` months as "YYYY-MM", oldest first, ending with this one (UTC).
  function lastMonths(n) {
    var d = new Date(), out = [];
    for (var k = n - 1; k >= 0; k--) {
      out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1)).toISOString().slice(0, 7));
    }
    return out;
  }
  /* The tiles (all time, deleted, this month), the 12-month chart (bugs and suggestions
     stacked, the Inbox's weekly chart) and, under Table, every month with its split. */
  function renderHistoryTable(res) {
    var host = $("[data-dm-history-months]");
    var tiles = $("[data-dm-history-tiles]");
    var chart = $("[data-dm-history-chart]");
    host.textContent = ""; tiles.textContent = "";
    if (!res.ok || !res.data) { chart.textContent = ""; chart.appendChild(el("p", "dm-empty", s("historyFailed"))); return; }
    var by = {}, all = { filed: 0, issue: 0, suggestion: 0, app: 0, web: 0, deleted: 0 };
    function month(m) {
      return by[m] = by[m] || { filed: 0, issue: 0, suggestion: 0, app: 0, web: 0, deleted: 0 };
    }
    (res.data.filed || []).forEach(function (r) {
      var x = month(r.month), n = r.live + r.archived;
      [x, all].forEach(function (t) {
        t.filed += n;
        if (r.kind === "issue" || r.kind === "suggestion") t[r.kind] += n;
        if (r.source === "app" || r.source === "web") t[r.source] += n;
      });
    });
    (res.data.deleted || []).forEach(function (r) { month(r.month).deleted += r.n; all.deleted += r.n; });
    var now = lastMonths(1)[0], cur = by[now] || month(now);

    tile(tiles, s("historyTileFiled"), fmtCount(all.filed), { sub: s("historyKinds", { bugs: all.issue, ideas: all.suggestion }) });
    tile(tiles, s("historyTileDeleted"), fmtCount(all.deleted), { sub: all.filed ? pct(all.deleted / all.filed) : "" });
    tile(tiles, s("historyTileMonth"), fmtCount(cur.filed), { sub: s("historySources", { app: cur.app, web: cur.web }) });

    var span = lastMonths(12);
    columns(chart, span.map(monthLabel), [
      { label: s("inboxKind_issue"), cls: "dm-ser-0", values: span.map(function (m) { return (by[m] || {}).issue || 0; }) },
      { label: s("inboxKind_suggestion"), cls: "dm-ser-2", values: span.map(function (m) { return (by[m] || {}).suggestion || 0; }) },
    ], null, s("historyMonthsTitle"));

    var months = Object.keys(by).filter(function (m) { return by[m].filed || by[m].deleted; }).sort().reverse();
    if (!months.length) { host.appendChild(el("p", "dm-empty", s("historyNone"))); return; }
    host.appendChild(usageTable(
      [s("historyMonth"), s("historyFiled"), s("historyBugs"), s("historySuggestions"), s("historyApp"), s("historyWeb"), s("historyDeleted")],
      months.map(function (m) {
        var x = by[m];
        return [monthLabel(m), x.filed, x.issue, x.suggestion, x.app, x.web, x.deleted];
      })));
  }
  function renderArchive(res) {
    var host = $("[data-dm-history-archive]");
    host.textContent = "";
    var posts = res.ok && res.data && res.data.posts;
    if (!Array.isArray(posts)) { host.appendChild(el("p", "dm-empty", s("historyFailed"))); return; }
    if (!posts.length) { host.appendChild(el("p", "dm-empty", s("historyNone"))); return; }
    posts.forEach(function (p) { host.appendChild(renderArchived(p)); });
  }
  /* One deleted post, in DeetsLeague's match row (his ask, 2026-10-30: "the same style we use
     for DeetsLeague matches"; league.js renderMatches, the .lol-match classes in main.css, used
     as they are): a card whose whole top row is the button, the title and its facts on the
     left, the state and the delete date on the right. A click opens the post's text and its
     thread under a hairline, read once from /admin/archive/<code>. */
  function renderArchived(p) {
    var row = el("article", "lol-match dm-archive");
    var btn = el("button", "lol-match__row");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    var mid = el("span", "lol-match__mid");
    var head = el("span", "lol-match__head");
    head.appendChild(el("span", "lol-match__champ", p.title));
    var from = p.source === "app" || p.source === "web" ? " · " + s("inboxFrom_" + p.source) : "";
    head.appendChild(el("span", "lol-match__queue", s("ticketKind_" + p.kind) + from));
    mid.appendChild(head);
    var nums = [s("historyFiledOn", { date: fmtUnix(p.created_at) })];
    if (p.version) nums.push("v" + p.version);
    nums.push(s(p.replies === 1 ? "historyThreadOne" : "historyThreadMany", { n: p.replies }));
    nums.push(s("inboxInterest", { n: p.interest || 0 }));
    mid.appendChild(el("span", "lol-match__nums", nums.join(" · ")));
    btn.appendChild(mid);
    var side = el("span", "lol-match__side");
    side.appendChild(chip(s("state_" + p.state), p.state));
    side.appendChild(el("span", "lol-match__when", s("historyDeletedOn", { date: fmtUnix(p.deleted_at) })));
    btn.appendChild(side);
    row.appendChild(btn);
    var body = el("div", "dm-archive__body");
    body.hidden = true;
    row.appendChild(body);
    btn.addEventListener("click", function () {
      var open = body.hidden;
      body.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      if (!open || body.getAttribute("data-read")) return;
      body.setAttribute("data-read", "1");
      body.appendChild(el("p", "dm-lead", s("inboxLoading")));
      ownerApi("GET", "/admin/archive/" + p.code).then(function (r) {
        body.textContent = "";
        if (!r.ok || !r.data || !r.data.post) {
          body.removeAttribute("data-read");
          body.appendChild(el("p", "dm-empty", s("historyFailed")));
          return;
        }
        body.appendChild(el("p", "dm-inbox__body", r.data.post.body));
        var rows = (r.data.thread && r.data.thread.replies) || [];
        if (!rows.length) { body.appendChild(el("p", "dm-hint", s("historyThreadNone"))); return; }
        var ol = el("ol", "dm-replies dm-inbox__thread");
        rows.forEach(function (x) {
          var li = el("li", "dm-reply" + (x.author === "owner" ? " is-owner" : ""));
          if (x.hidden) li.classList.add("is-hidden-reply");
          var who = el("div", "dm-reply__who");
          var label = x.author === "owner" ? s("authorOwner") : x.author === "member" ? (x.name || s("authorPoster")) : s("authorPoster");
          var nameEl = el("span", "dm-reply__name", label);
          if (x.author === "member" && x.color) nameEl.style.setProperty("--dm-who", x.color);
          who.appendChild(nameEl);
          who.appendChild(el("span", null, fmtUnix(x.created_at)));
          if (x.hidden) who.appendChild(chip(s("tagHidden"), "hidden"));
          li.appendChild(who);
          li.appendChild(el("p", "dm-reply__body", x.body));
          ol.appendChild(li);
        });
        body.appendChild(ol);
      });
    });
    return row;
  }

  // The whole dashboard: the overview, the tabs and their panels (the Inbox among them).
  function showUsage(yes) {
    if (!USAGE_BOX) return;
    USAGE_BOX.hidden = !yes;
    if (!yes) return;
    wireTabs();
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
        function () { return usageWeeks().map(function (w) { return [w, weekName(w)]; }); },
        function (w) { usage.week = w; loadUsage(); }),
      usagePill($("[data-dm-usage-healthtool]"), s("hWeekPill"), function () { return usage.hweek || ""; },
        function () { return reportWeeks().map(function (w) { return [w, weekName(w)]; }); },
        function (w) { usage.hweek = w; usage.hpicked = true; renderHealthTab(); paintDash(); }),
      usagePill($("[data-dm-usage-crosstools]"), s("usageCrossA"), function () { return usage.a; }, keys,
        function (k) { usage.a = k; loadCross(); paintUsagePills(); }),
      usagePill($("[data-dm-usage-crosstools]"), s("usageCrossB"), function () { return usage.b; }, keys,
        function (k) { usage.b = k; loadCross(); paintUsagePills(); }),
      usagePill($("[data-dm-usage-healthtool]"), s("usageVersionPill"), function () { return usage.v; },
        function () { return [["", s("usageAllVersions")]].concat(usageVersions().map(function (v) { return [v, v]; })); },
        function (v) { usage.v = v; renderHealthTab(); }),
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
        return;
      }
      usage.data = res.data;
      usage.week = res.data.week;
      usage.hw = null;
      usage.hpicked = false;
      state.hidden = true;
      renderUsage();
      loadCross();
      loadPrev();
      loadHealth();
    });
  }

  /* The health reports of the chosen week (already in hand) and the weeks before it. Each is
     the same read with &week=: the worker answers one week's health per call. */
  function loadHealth() {
    var seq = usage.seq, weeks = [];
    for (var k = 0; k < HEALTH_WEEKS; k++) weeks.push(weekShift(usage.week, -k));
    Promise.all(weeks.map(function (w, k) {
      if (!k) return Promise.resolve(usage.data.health);
      return ownerApi("GET", "/admin/usage?channel=" + encodeURIComponent(usage.channel) + "&week=" + encodeURIComponent(w))
        .then(function (res) { return res.ok && res.data && res.data.week === w ? res.data.health || [] : null; });
    })).then(function (all) {
      if (seq !== usage.seq) return;
      usage.hw = weeks.map(function (w, k) { return { week: w, rows: all[k], failed: all[k] == null }; });
      if (!usage.hpicked || reportWeeks().indexOf(usage.hweek) < 0) usage.hweek = reportWeeks()[0] || null;
      renderHealthTab();
      paintDash();
    });
  }
  // The weeks in hand that hold at least one report, newest first.
  function reportWeeks() {
    return (usage.hw || []).filter(function (x) { return summarize(x.rows || []).reports; }).map(function (x) { return x.week; });
  }
  function reportRows() {
    var x = (usage.hw || []).filter(function (w) { return w.week === usage.hweek; })[0];
    return x && x.rows ? x.rows : [];
  }

  // ── ISO weeks: "2026-W43" ⇄ its Monday (UTC), and a name a person reads ──
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function weekMonday(w) {
    var m = /^(\d{4})-W(\d{2})$/.exec(w || "");
    if (!m) return null;
    var jan4 = Date.UTC(+m[1], 0, 4), dow = (new Date(jan4).getUTCDay() + 6) % 7;
    return new Date(jan4 - dow * 864e5 + (+m[2] - 1) * 7 * 864e5);
  }
  function isoWeekOf(d) {
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() - (t.getUTCDay() + 6) % 7 + 3);   // the week's Thursday names its year
    var y = t.getUTCFullYear();
    return y + "-W" + pad2(1 + Math.floor((t - Date.UTC(y, 0, 4)) / 864e5 / 7 + ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7) / 7));
  }
  function weekShift(w, k) {
    var m = weekMonday(w);
    return m ? isoWeekOf(new Date(m.getTime() + k * 7 * 864e5)) : w;
  }
  // "Oct 19 – 25", "Oct 26 – Nov 1"; the year only when it is not this year.
  function weekSpan(w) {
    var a = weekMonday(w);
    if (!a) return w || "";
    var b = new Date(a.getTime() + 6 * 864e5), yr = new Date().getUTCFullYear();
    var o = { month: "short", day: "numeric", timeZone: "UTC" };
    var from = a.toLocaleDateString("en-US", o);
    var to = b.getUTCMonth() === a.getUTCMonth() ? String(b.getUTCDate()) : b.toLocaleDateString("en-US", o);
    return from + " – " + to + (b.getUTCFullYear() !== yr ? ", " + b.getUTCFullYear() : "");
  }
  function weekName(w) {
    return w === isoWeekOf(new Date()) ? s("weekNow", { span: weekSpan(w) }) : weekSpan(w);
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
    reportRows().forEach(function (r) { seen[r.v] = 1; });
    if (usage.v) seen[usage.v] = 1;
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
    paintDash();
    renderDaily();
    var byV = weekByVersion();
    renderBars($("[data-dm-usage-versions]"), Object.keys(byV).sort(cmpVersionDesc).map(function (v) { return [v, byV[v]]; }), sumActive(usage.week));
    $("[data-dm-usage-lag]").hidden = !Object.keys(byV).some(function (v) { return cmpVersionDesc(v, USAGE_MOVES_FROM) > 0; });
    renderInstalls(new Date());
    renderFunnel();
    renderInstallsChart();
    renderUpdates();
    renderReleases();
    renderHealthTab();
    renderShares();
  }
  function weekByVersion() {
    var byV = {};
    usage.data.active.forEach(function (r) { if (r.period === usage.week) byV[r.v] = (byV[r.v] || 0) + r.n; });
    return byV;
  }

  /* Active installs per UTC day as a stacked area by version: the newest on top, the
     SERIES newest named, the rest summed as Older. A missing day is 0; the empty days
     before the first count are trimmed. Hovering reads one day out. */
  function renderDaily() {
    var host = $("[data-dm-usage-daily]");
    host.textContent = "";
    var days = [], cell = {}, seen = {};
    for (var i = USAGE_DAYS - 1; i >= 0; i--) days.push(dayAgo(i));
    usage.data.active.forEach(function (r) {
      if (r.period.length !== 10 || r.period < days[0]) return;     // a day row, in the window
      var c = cell[r.period] = cell[r.period] || {};
      c[r.v] = (c[r.v] || 0) + r.n;
      seen[r.v] = 1;
    });
    while (days.length > 2 && !cell[days[0]]) days.shift();
    var vs = Object.keys(seen).sort(cmpVersionDesc);
    var series = vs.slice(0, SERIES).map(function (v, k) {
      return { label: "v" + v, cls: "dm-ser-" + k, get: function (d) { return (cell[d] || {})[v] || 0; } };
    });
    if (vs.length > SERIES) {
      var rest = vs.slice(SERIES);
      series.push({ label: s("dashOlder"), cls: "dm-ser-" + SERIES, get: function (d) {
        return rest.reduce(function (n, v) { return n + ((cell[d] || {})[v] || 0); }, 0);
      } });
    }
    var totals = days.map(function (d) { return series.reduce(function (n, se) { return n + se.get(d); }, 0); });
    var max = Math.max.apply(null, totals);
    if (!max) { host.appendChild(el("p", "dm-empty", s("usageNone"))); return; }

    var W = 600, H = 160, step = W / (days.length - 1);
    var x = function (k) { return (k * step).toFixed(1); };
    var y = function (n) { return (H - (n / max) * (H - 4)).toFixed(1); };
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", "class": "dm-usage__svg dm-dash__area", role: "img", "aria-label": s("usageDaily") });
    var base = days.map(function () { return 0; });
    series.slice().reverse().forEach(function (se) {             // Older at the bottom
      var top = days.map(function (d, k) { return base[k] + se.get(d); });
      var up = top.map(function (n, k) { return x(k) + "," + y(n); });
      var down = base.map(function (n, k) { return x(k) + "," + y(n); }).reverse();
      svgEl("polygon", { points: up.concat(down).join(" "), "class": "dm-dash__band " + se.cls }, svg);
      base = top;
    });
    svgEl("polyline", { points: totals.map(function (n, k) { return x(k) + "," + y(n); }).join(" "), "class": "dm-usage__line", "vector-effect": "non-scaling-stroke" }, svg);
    var cross = svgEl("line", { x1: 0, x2: 0, y1: 0, y2: H, "class": "dm-dash__cross", "vector-effect": "non-scaling-stroke" }, svg);
    cross.style.display = "none";

    var plot = el("div", "dm-dash__plot");
    plot.appendChild(svg);
    var tip = el("div", "dm-dash__tip");
    tip.hidden = true;
    plot.appendChild(tip);
    svg.addEventListener("pointermove", function (e) {
      var r = svg.getBoundingClientRect();
      var k = Math.max(0, Math.min(days.length - 1, Math.round((e.clientX - r.left) / r.width * (days.length - 1))));
      cross.setAttribute("x1", x(k));
      cross.setAttribute("x2", x(k));
      cross.style.display = "";
      tip.textContent = "";
      tip.appendChild(el("strong", null, fmtDay(days[k])));
      series.forEach(function (se) { tip.appendChild(tipRow(se.label, se.cls, se.get(days[k]))); });
      tip.appendChild(tipRow(s("dashTotal"), null, totals[k]));
      tip.hidden = false;
      tip.style.insetInlineStart = (k / (days.length - 1) * r.width).toFixed(0) + "px";
      tip.classList.toggle("is-flip", k > (days.length - 1) / 2);
    });
    svg.addEventListener("pointerleave", function () { tip.hidden = true; cross.style.display = "none"; });
    host.appendChild(plot);
    host.appendChild(legend(series));
    host.appendChild(el("p", "dm-hint", s("usageDailyAxis", { from: fmtDay(days[0]), to: fmtDay(days[days.length - 1]), max: fmtCount(max) })));
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
    reportRows().forEach(function (r) {
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
    var host = $("[data-dm-usage-health]");
    host.textContent = "";
    host.appendChild(usageTable([s("usageMetric")].concat(USAGE_BUCKETS), metrics.map(function (m) {
      var c = cells[m] || {};
      var above = USAGE_BUCKETS.slice(1).map(function (b) { return c[b] || 0; });
      var zero = Math.max(0, reports - above.reduce(function (a, b) { return a + b; }, 0));
      return [m, zero].concat(above);
    })));
  }

  /* Updates (USAGE-COUNTS.md §12.4): per version, every day summed. Waiting = downloaded but
     not restarted onto it yet (an update applies at the next start). Newest version first. */
  function updatesByVersion() {
    var by = {};
    (usage.data.events || []).forEach(function (r) {
      if (r.metric !== "update.downloaded" && r.metric !== "update.applied") return;
      var x = by[r.v] = by[r.v] || { downloaded: 0, applied: 0, rollback: 0, since: r.period, days: {} };
      if (r.metric === "update.downloaded") x.downloaded += r.n;
      else { x.applied += r.n; x.days[r.period] = (x.days[r.period] || 0) + r.n; }
      if (r.bucket === "rollback" && r.metric === "update.applied") x.rollback += r.n;
      if (r.period < x.since) x.since = r.period;
    });
    return by;
  }
  function renderUpdates() {
    var by = updatesByVersion();
    var host = $("[data-dm-usage-updates]");
    host.textContent = "";
    var vs = Object.keys(by).sort(cmpVersionDesc);
    if (!vs.length) { host.appendChild(el("p", "dm-empty", s("usageNone"))); return; }
    host.appendChild(usageTable(
      [s("usageUpVersion"), s("usageUpDownloaded"), s("usageUpApplied"), s("usageUpWaiting"), s("usageUpRollback"), s("usageUpSince")],
      vs.map(function (v) {
        var x = by[v];
        return [v, x.downloaded, x.applied, x.downloaded < x.applied ? "–" : x.downloaded - x.applied, x.rollback, fmtDay(x.since)];
      })));
  }

  /* Downloads and first starts (§12.3, §12.7): the last 14 UTC days, newest first. A Setup.exe
     download counts in its source's column when every byte went out; "Not finished" is the
     starts that never finished, every source but the Store check and bots. */
  function renderInstalls(now) {
    var cell = {};
    (usage.data.events || []).forEach(function (r) {
      var key = r.metric === "install.first" ? "first" : r.metric.indexOf("setup.") === 0 ? r.metric.slice(6) + "." + r.bucket : null;
      if (!key) return;
      var d = cell[r.period] = cell[r.period] || {};
      d[key] = (d[key] || 0) + r.n;
    });
    var rows = [];
    for (var i = 0; i < USAGE_INSTALL_DAYS; i++) {
      var day = usageDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)));
      var c = cell[day] || {};
      var get = function (k) { return c[k] || 0; };
      var people = ["site", "store", "direct"];
      var broken = people.reduce(function (n, src) { return n + Math.max(0, get("start." + src) - get("done." + src)); }, 0);
      rows.push([fmtDay(day), get("done.site"), get("done.store"), get("done.direct"), broken, get("start.check"), get("start.bot"), get("first")]);
    }
    $("[data-dm-usage-installslead]").textContent = s("usageInstallsLead", { n: USAGE_INSTALL_DAYS });
    var host = $("[data-dm-usage-installs]");
    host.textContent = "";
    host.appendChild(usageTable(
      [s("usageInDay"), s("usageInSite"), s("usageInStore"), s("usageInDirect"), s("usageInBroken"), s("usageInCheck"), s("usageInBot"), s("usageInFirst")],
      rows));
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
      var max = rows.reduce(function (m, r) { return Math.max(m, r.n); }, 0);
      var table = usageTable([usage.a + " \\ " + usage.b].concat(bs), as.map(function (a) {
        return [a].concat(bs.map(function (b) { return at[a + "\u0000" + b] || 0; }));
      }));
      table.classList.add("dm-dash__heat");
      var flat = [].concat.apply([], as.map(function (a) { return bs.map(function (b) { return at[a + "\u0000" + b] || 0; }); }));
      $all("tbody td", table).forEach(function (td, k) { heat(td, flat[k], max); });
      host.appendChild(table);
    });
  }

  // ── The dashboard (support.md, "The dashboard") ──────────────────
  // An overview (the flags and the headline tiles) above four tabs, all drawn from the
  // responses the page already reads: no worker change (his call, 2026-10-27). The flag
  // thresholds are drafts for his edit.
  var FLAG = {
    rollback: 0.01, rollbackMin: 50,              // rollbacks per restart onto the newest version
    healthRatio: 1.5, healthGap: 0.01, healthMin: 50,   // a trouble metric against the version before
    freezes: 0.02,                                // panics flag at any count
    finish: 0.8, finishMin: 20,                   // site + Store downloads finished, 7 days
    drop: 0.15,                                   // mean daily active, last 7 whole days vs the 7 before
    waitDays: 3,                                  // a post waiting on him
    newErrMin: 1,                                 // installs with a new error kind on the newest version
  };
  var TABS = ["growth", "inbox", "health", "releases", "settings", "history"];
  var SERIES = 4;               // versions a chart names; the rest are Older
  var NS = "http://www.w3.org/2000/svg";
  var tabsWired = false;

  function svgEl(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function pct(x) {
    if (!isFinite(x)) return "–";
    var p = x * 100;
    // A decimal where rounding would hide the difference: 0.4 % is not 0, 99.6 % is not 100.
    if (p > 90 && p < 100) return (Math.floor(p * 10) / 10).toFixed(1) + "%";
    return (p > 0 && p < 10 ? p.toFixed(1) : String(Math.round(p))) + "%";
  }
  function arrow(d) { return d >= 0 ? "▲ " : "▼ "; }
  function dayAgo(i) {
    var now = new Date();
    return usageDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)));
  }
  function daysSince(unix) { return Math.floor((Date.now() / 1000 - unix) / 86400); }
  function prevWeek() {
    var ws = usageWeeks(), k = ws.indexOf(usage.week);
    return k >= 0 ? ws[k + 1] || null : null;
  }
  // The day counters in `events`, from `from` to `to` days ago (0 = today), where test(row) holds.
  function eventSum(test, from, to) {
    var lo = dayAgo(to), hi = dayAgo(from);
    return ((usage.data && usage.data.events) || []).reduce(function (n, r) {
      return r.period >= lo && r.period <= hi && test(r) ? n + r.n : n;
    }, 0);
  }
  function isEv(metric, bucket) {
    return function (r) { return r.metric === metric && (bucket == null || r.bucket === bucket); };
  }
  /* The week's health per version: its reports, and per metric the reports that counted it
     above 0 (a metric is stored only above 0, so every row but `reports` is one). */
  function healthStats(rows) {
    var rep = {}, above = {};
    (rows || reportRows()).forEach(function (r) {
      if (r.metric === "reports") { rep[r.v] = (rep[r.v] || 0) + r.n; return; }
      var m = above[r.metric] = above[r.metric] || {};
      m[r.v] = (m[r.v] || 0) + r.n;
    });
    return { versions: Object.keys(rep).sort(cmpVersionDesc), reports: rep, above: above };
  }
  function isTrouble(metric) { return !/\.2xx$/.test(metric); }
  /* One week's reports added up across versions (or for `v` alone): the reports, and per
     metric the installs that counted it above 0 and the least count those installs add up
     to (each range's low end: a report stores a count only as its range). */
  var BUCKET_LOW = { "1-9": 1, "10-99": 10, "100-999": 100, "1000+": 1000 };
  function summarize(rows, v) {
    var out = { reports: 0, installs: {}, least: {} };
    rows.forEach(function (r) {
      if (v && r.v !== v) return;
      if (r.metric === "reports") { out.reports += r.n; return; }
      out.installs[r.metric] = (out.installs[r.metric] || 0) + r.n;
      out.least[r.metric] = (out.least[r.metric] || 0) + r.n * (BUCKET_LOW[r.bucket] || 0);
    });
    return out;
  }
  // The error class most installs hit, Apple's or the log's: { metric, n } or null.
  function topMetric(sum, test) {
    return Object.keys(sum.installs).filter(test).reduce(function (best, m) {
      return !best || sum.installs[m] > best.n ? { metric: m, n: sum.installs[m] } : best;
    }, null);
  }
  function isAppleErr(m) { return m.indexOf("apple.") === 0 && isTrouble(m); }
  function isLogErr(m) { return m.indexOf("log.error.") === 0; }
  function appleName(m) {
    var p = m.split(".");
    return s("hGroup_" + p[1]) + " " + (p[2] === "net" ? s("hClass_net") : p[2]);
  }
  function okCalls(sum) {
    return USAGE_GROUPS.reduce(function (n, g) { return n + (sum.least["apple." + g + ".2xx"] || 0); }, 0);
  }
  // When the poster last spoke: their last shown reply, else the post itself.
  function waitSince(p) {
    return (inbox.threads[p.code] || []).reduce(function (m, r) {
      return !r.hidden && r.author === "reporter" ? Math.max(m, r.created_at) : m;
    }, p.created_at);
  }

  // ── Tabs: Growth · Inbox · Releases · Settings · History, kept in the hash ──
  function tabFromHash() {
    var h = location.hash.slice(1);
    if (h === "usage") return "growth";             // the old anchor
    return TABS.indexOf(h) >= 0 ? h : "growth";
  }
  function selectTab(t, write) {
    $all("[data-tab]").forEach(function (b) {
      var on = b.getAttribute("data-tab") === t;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    $all("[data-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== t; });
    if (write && location.hash.slice(1) !== t) history.replaceState(null, "", "#" + t);
  }
  function wireTabs() {
    if (tabsWired) return;
    tabsWired = true;
    var btns = $all("[data-tab]");
    btns.forEach(function (b, i) {
      b.addEventListener("click", function () { selectTab(b.getAttribute("data-tab"), true); });
      b.addEventListener("keydown", function (e) {
        var to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: btns.length - 1 }[e.key];
        if (to == null) return;
        e.preventDefault();
        var nb = btns[(to + btns.length) % btns.length];
        selectTab(nb.getAttribute("data-tab"), true);
        nb.focus();
      });
    });
    window.addEventListener("hashchange", function () { selectTab(tabFromHash(), false); });
    selectTab(tabFromHash(), false);
  }

  // ── Chart pieces: a sparkline, a legend, a hover row, a heat cell, stacked columns ──
  function spark(values, cls) {
    var W = 120, H = 28, max = Math.max.apply(null, values) || 1, step = W / Math.max(1, values.length - 1);
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", "class": cls || "dm-dash__spark", "aria-hidden": "true" });
    svgEl("polyline", {
      points: values.map(function (v, k) { return (k * step).toFixed(1) + "," + (H - 2 - (v / max) * (H - 4)).toFixed(1); }).join(" "),
      "class": "dm-usage__line", "vector-effect": "non-scaling-stroke",
    }, svg);
    return svg;
  }
  function legend(series) {
    var box = el("div", "dm-dash__legend");
    series.forEach(function (se) {
      var item = el("span", "dm-dash__key");
      item.appendChild(el("span", "dm-dash__swatch " + se.cls));
      item.appendChild(el("span", null, se.label));
      box.appendChild(item);
    });
    return box;
  }
  function tipRow(label, cls, n) {
    var row = el("span", "dm-dash__tiprow");
    row.appendChild(el("span", "dm-dash__swatch " + (cls || "is-none")));
    row.appendChild(el("span", null, label));
    row.appendChild(el("span", "dm-dash__tipnum", fmtCount(n)));
    return row;
  }
  // A cell's shade grows with its value (square root, so the small ones still show).
  function heat(td, value, max) {
    td.style.setProperty("--heat", (max ? Math.round(Math.sqrt(value / max) * 45) : 0) + "%");
  }
  /* Stacked columns, one per label: `series` [{ label, cls, values }] stack bottom-up and
     `dots` { label, values } sit on the same scale. Each column's hover title reads it out. */
  function columns(host, labels, series, dots, aria) {
    host.textContent = "";
    var totals = labels.map(function (l, k) { return series.reduce(function (t, se) { return t + se.values[k]; }, 0); });
    var max = Math.max.apply(null, totals.concat(dots ? dots.values : []));
    if (!max) { host.appendChild(el("p", "dm-empty", s("usageNone"))); return; }
    var W = 600, H = 140, slot = W / labels.length, bw = slot * 0.7;
    var h = function (v) { return (v / max) * (H - 8); };
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, "class": "dm-dash__svg", role: "img", "aria-label": aria });
    svgEl("line", { x1: 0, x2: W, y1: H - 0.5, y2: H - 0.5, "class": "dm-dash__baseline", "vector-effect": "non-scaling-stroke" }, svg);
    labels.forEach(function (lab, k) {
      var x0 = k * slot + (slot - bw) / 2, acc = 0, lines = [lab];
      series.forEach(function (se) {
        var v = se.values[k];
        lines.push(se.label + ": " + fmtCount(v));
        if (!v) return;
        var hh = h(v);
        svgEl("rect", { x: x0.toFixed(1), y: (H - h(acc) - hh).toFixed(1), width: bw.toFixed(1), height: Math.max(1, hh - 1.5).toFixed(1), "class": "dm-dash__col " + se.cls }, svg);
        acc += v;
      });
      if (dots) {
        lines.push(dots.label + ": " + fmtCount(dots.values[k]));
        if (dots.values[k]) svgEl("circle", { cx: (x0 + bw / 2).toFixed(1), cy: (H - h(dots.values[k])).toFixed(1), r: 4, "class": "dm-dash__dot" }, svg);
      }
      var hit = svgEl("rect", { x: (k * slot).toFixed(1), y: 0, width: slot.toFixed(1), height: H, "class": "dm-usage__hit" }, svg);
      svgEl("title", null, hit).textContent = lines.join("\n");
    });
    host.appendChild(svg);
    // The span under the baseline, first column to last, as the day line has.
    var span = el("div", "dm-dash__span");
    span.appendChild(el("span", null, labels[0]));
    span.appendChild(el("span", null, labels[labels.length - 1]));
    host.appendChild(span);
    var keys = series.slice();
    if (dots) keys.push({ label: dots.label, cls: "is-dot" });
    host.appendChild(legend(keys));
  }

  // ── The overview: flags, then the headline tiles ────────────────
  function paintDash() {
    usage.flags = computeFlags();
    paintFlags(usage.flags);
    paintTiles();
  }
  /* Each flag: { tone, text }. `cells` and `releases` mark what the Releases tab outlines. */
  function computeFlags() {
    var out = [], cells = {}, rel = {};
    var d = usage.data;
    if (d) {
      var ups = updatesByVersion(), uv = Object.keys(ups).sort(cmpVersionDesc)[0];
      if (uv && ups[uv].applied >= FLAG.rollbackMin && ups[uv].rollback / ups[uv].applied > FLAG.rollback) {
        var u = ups[uv];
        out.push({ tone: "stop", text: s("flagRollback", { v: "v" + uv, pct: pct(u.rollback / u.applied), n: fmtCount(u.rollback), of: fmtCount(u.applied) }) });
        rel[uv] = 1;
      }
      // Health reads the Health tab's week: the newest with reports, not the chosen one.
      var h = healthStats(), hv = h.versions[0], pv = h.versions[1], span = weekSpan(usage.hweek);
      var share = function (m, v) { return h.reports[v] ? ((h.above[m] || {})[v] || 0) / h.reports[v] : 0; };
      if (hv) {
        var panics = (h.above.panics || {})[hv] || 0;
        if (panics) {
          out.push({ tone: "stop", text: s("flagPanicsW", { v: "v" + hv, n: fmtCount(panics), span: span }) });
          cells["panics|" + hv] = 1;
        }
        if (share("freezes", hv) > FLAG.freezes) {
          out.push({ tone: "pause", text: s("flagFreezesW", { v: "v" + hv, pct: pct(share("freezes", hv)), span: span }) });
          cells["freezes|" + hv] = 1;
        }
        // An error kind on the newest version that no other version and no earlier week has.
        Object.keys(h.above).sort().forEach(function (m) {
          var n = (h.above[m] || {})[hv] || 0, p = m.indexOf("err.") === 0 && parseFp(m);
          if (!p || n < FLAG.newErrMin || seenBefore(m, usage.hweek, hv)) return;
          out.push({ tone: "pause", text: s("flagNewErr", { v: "v" + hv, what: p.type, where: p.place, n: fmtCount(n), span: span }) });
          cells[m + "|" + hv] = 1;
        });
        if (pv && h.reports[hv] >= FLAG.healthMin && h.reports[pv] >= FLAG.healthMin) {
          Object.keys(h.above).sort().forEach(function (m) {
            if (!isTrouble(m) || m === "panics" || m === "freezes" || cells[m + "|" + hv]) return;
            var a = share(m, hv), b = share(m, pv);
            if (a > b * FLAG.healthRatio && a - b >= FLAG.healthGap) {
              out.push({ tone: "pause", text: s("flagHealth", { v: "v" + hv, metric: m, pct: pct(a), prev: pct(b), pv: "v" + pv }) });
              cells[m + "|" + hv] = 1;
            }
          });
        }
      }
      var people = function (metric) {
        return function (r) { return r.metric === metric && (r.bucket === "site" || r.bucket === "store"); };
      };
      var st = eventSum(people("setup.start"), 0, 6), dn = eventSum(people("setup.done"), 0, 6);
      if (st >= FLAG.finishMin && dn / st < FLAG.finish) {
        out.push({ tone: "pause", text: s("flagFinish", { pct: pct(dn / st), n: fmtCount(dn), of: fmtCount(st) }) });
      }
      // Whole days only: today is never whole, and neither is this week.
      var mean = function (a, b) { var t = 0; for (var k = a; k <= b; k++) t += sumActive(dayAgo(k)); return t / (b - a + 1); };
      var now7 = mean(1, 7), prev7 = mean(8, 14);
      if (prev7 && (prev7 - now7) / prev7 > FLAG.drop) {
        out.push({ tone: "pause", text: s("flagDrop", { pct: pct((prev7 - now7) / prev7), now: fmtCount(now7), prev: fmtCount(prev7) }) });
      }
    }
    (inbox.posts || []).forEach(function (p) {
      if (!isWaiting(p)) return;
      var days = daysSince(waitSince(p));
      if (days > FLAG.waitDays) out.push({ tone: "pause", text: s("flagWaiting", { title: p.title, d: days }) });
    });
    out.sort(function (a, b) { return (a.tone === "stop" ? 0 : 1) - (b.tone === "stop" ? 0 : 1); });
    return { list: out, cells: cells, releases: rel };
  }
  function paintFlags(f) {
    var host = $("[data-dm-flags]");
    host.textContent = "";
    host.appendChild(el("h3", "dm-usage__sub", s("dashFlagsTitle")));
    var list = el("ul", "dm-dash__flaglist");
    (f.list.length ? f.list : [{ tone: "go", text: s("dashFlagsNone") }]).forEach(function (x) {
      var li = el("li", "dm-dash__flag");
      li.setAttribute("data-tone", x.tone);
      li.appendChild(el("span", "dm-dash__glyph", x.tone === "go" ? "✓" : x.tone === "stop" ? "!!" : "!"));
      li.appendChild(el("span", null, x.text));
      list.appendChild(li);
    });
    host.appendChild(list);
  }
  /* One headline tile, always four parts so a row of tiles lines up on one subgrid: what it
     counts, the number (or `o.figs`, several labelled numbers), what the number means (with
     `o.delta` on its own line), and a foot: a sparkline with its span, a meter, or nothing.
     `o.wide` spans two columns. */
  function tile(host, label, value, o) {
    o = o || {};
    var t = el("div", "dm-usage__kpi dm-dash__tile" + (o.wide ? " is-wide" : ""));
    t.appendChild(el("span", "dm-dash__label", label));
    if (o.figs) {
      var figs = el("span", "dm-dash__figs");
      o.figs.forEach(function (f) {
        var fig = el("span", "dm-dash__fig");
        fig.appendChild(el("span", "dm-usage__num", f[0]));
        fig.appendChild(el("span", "dm-dash__cap", f[1]));
        figs.appendChild(fig);
      });
      t.appendChild(figs);
    } else {
      t.appendChild(el("span", "dm-usage__num", value));
    }
    var sub = el("span", "dm-dash__sub");
    if (o.sub) sub.appendChild(el("span", null, o.sub));
    if (o.delta) sub.appendChild(el("span", null, o.delta));
    t.appendChild(sub);
    var foot = el("span", "dm-dash__foot");
    if (o.spark && o.spark.length > 1) {
      foot.appendChild(spark(o.spark));
      if (o.sparkCap) foot.appendChild(el("span", "dm-dash__cap", o.sparkCap));
    } else if (o.meter != null) {
      var m = el("span", "dm-usage__track dm-dash__meter");
      var f = el("span", "dm-usage__fill");
      f.style.inlineSize = (Math.max(0, Math.min(1, o.meter)) * 100).toFixed(1) + "%";
      m.appendChild(f);
      foot.appendChild(m);
    }
    t.appendChild(foot);
    host.appendChild(t);
  }
  function paintTiles() {
    var host = $("[data-dm-tiles]");
    host.textContent = "";
    var k;
    if (usage.data) {
      var days30 = [];
      for (k = 29; k >= 0; k--) days30.push(sumActive(dayAgo(k)));
      // Today, the week and the month together: one measure, three spans.
      var pw = prevWeek(), week = sumActive(usage.week), mon = dayAgo(0).slice(0, 7);
      tile(host, s("tileActive"), null, {
        wide: true,
        figs: [
          [fmtCount(sumActive(dayAgo(0))), s("tileToday")],
          [fmtCount(week), s("tileWeek")],
          [fmtCount(sumActive(mon)), s("tileMonth")],
        ],
        sub: s("tileActiveSub"),
        delta: pw ? s("tileLastWeek", { n: fmtCount(sumActive(pw)) }) : null,
        spark: days30, sparkCap: s("tileCapDays", { n: 30 }),
      });
      var first = isEv("install.first"), n7 = eventSum(first, 0, 6), p7 = eventSum(first, 7, 13), d14 = [];
      for (k = 13; k >= 0; k--) d14.push(eventSum(first, k, k));
      tile(host, s("tileNewInstalls"), fmtCount(n7), {
        sub: s("tileNewInstallsSub"),
        delta: p7 ? arrow(n7 / p7 - 1) + s("tileVsBefore", { pct: pct(Math.abs(n7 / p7 - 1)) }) : null,
        spark: d14, sparkCap: s("tileCapDays", { n: 14 }),
      });
      var byV = weekByVersion(), newest = Object.keys(byV).sort(cmpVersionDesc)[0];
      if (newest && week) {
        tile(host, s("tileNewest"), pct(byV[newest] / week), {
          sub: s("tileNewestSub", { n: fmtCount(byV[newest]), of: fmtCount(week), v: "v" + newest }), meter: byV[newest] / week,
        });
      }
      // The health tiles read the newest week with reports (the Health tab's week).
      var hs = summarize(reportRows()), span = weekSpan(usage.hweek);
      if (!usage.hw) {
        tile(host, s("tilePanicFreeTitle"), "–", { sub: s("hLoading") });
        tile(host, s("tileApple"), "–", { sub: s("hLoading") });
      } else if (hs.reports) {
        var free = 1 - (hs.installs.panics || 0) / hs.reports;
        tile(host, s("tilePanicFreeTitle"), pct(free), {
          sub: s("tileHealthSub", { n: fmtCount(hs.reports), span: span, pct: pct((hs.installs.freezes || 0) / hs.reports) }), meter: free,
        });
        var top = topMetric(hs, isAppleErr);
        tile(host, s("tileApple"), fmtCount(okCalls(hs)) + "+", {
          sub: s("tileAppleSub", { span: span }),
          delta: top ? s("tileAppleErr", { what: appleName(top.metric), n: fmtCount(top.n), of: fmtCount(hs.reports) }) : s("tileAppleNoErr"),
        });
      } else {
        tile(host, s("tilePanicFreeTitle"), "–", { sub: s("tileHealthNone") });
        tile(host, s("tileApple"), "–", { sub: s("tileHealthNone") });
      }
    }
    // Always drawn, so the row keeps its shape while the posts are still being read.
    var waiting = (inbox.posts || []).filter(isWaiting);
    var oldest = waiting.reduce(function (m, p) { return Math.max(m, daysSince(waitSince(p))); }, 0);
    tile(host, s("tileWaitingTitle"), inbox.posts ? fmtCount(waiting.length) : "–", {
      sub: !inbox.posts ? s("inboxLoading") : waiting.length ? s("tileOldest", { d: oldest }) : s("tileAllAnswered"),
    });
  }

  // ── Growth: the download funnel and the days it came in ────────
  var SOURCES = [["site", "usageInSite"], ["store", "usageInStore"], ["direct", "usageInDirect"]];
  function renderFunnel() {
    var host = $("[data-dm-funnel]");
    host.textContent = "";
    var last = USAGE_INSTALL_DAYS - 1;
    var rows = SOURCES.map(function (src) {
      return { label: s(src[1]), start: eventSum(isEv("setup.start", src[0]), 0, last), done: eventSum(isEv("setup.done", src[0]), 0, last) };
    });
    var max = Math.max.apply(null, rows.map(function (r) { return r.start; })) || 1;
    rows.forEach(function (r) {
      var row = el("div", "dm-usage__bar");
      row.appendChild(el("span", "dm-usage__label", r.label));
      var track = el("span", "dm-usage__track");
      var started = el("span", "dm-dash__started");
      started.style.inlineSize = (r.start / max * 100).toFixed(1) + "%";
      var fill = el("span", "dm-usage__fill");
      fill.style.inlineSize = (r.start ? Math.min(1, r.done / r.start) * 100 : 0).toFixed(1) + "%";
      started.appendChild(fill);
      track.appendChild(started);
      row.appendChild(track);
      row.appendChild(el("span", "dm-usage__count", r.start
        ? s("dashFunnelRow", { done: fmtCount(r.done), start: fmtCount(r.start), pct: pct(r.done / r.start) }) : "0"));
      host.appendChild(row);
    });
  }
  function renderInstallsChart() {
    var days = [];
    for (var k = USAGE_INSTALL_DAYS - 1; k >= 0; k--) days.push(dayAgo(k));
    var per = function (test) { return days.map(function (d, i) { return eventSum(test, USAGE_INSTALL_DAYS - 1 - i, USAGE_INSTALL_DAYS - 1 - i); }); };
    columns($("[data-dm-installs-chart]"), days.map(fmtDay),
      SOURCES.map(function (src, i) { return { label: s(src[1]), cls: "dm-ser-" + i, values: per(isEv("setup.done", src[0])) }; }),
      { label: s("usageInFirst"), values: per(isEv("install.first")) },
      s("dashFinishedDaily"));
  }

  // ── Releases: a card per version, the health heatmap, the Apple grid ──
  function renderReleases() {
    var host = $("[data-dm-releases]");
    host.textContent = "";
    var by = updatesByVersion(), vs = Object.keys(by).sort(cmpVersionDesc);
    // Downloads are counted from 1.2.0 on, so an update from an older version is only a restart.
    $("[data-dm-dl-note]").hidden = !vs.some(function (v) { return by[v].downloaded < by[v].applied; });
    if (!vs.length) { host.appendChild(el("p", "dm-empty", s("usageNone"))); return; }
    var byV = weekByVersion(), week = sumActive(usage.week);
    vs.forEach(function (v) {
      var x = by[v], card = el("article", "dm-dash__release");
      var head = el("div", "dm-dash__relhead");
      head.appendChild(el("h4", "dm-dash__reltitle", "v" + v));
      if (x.applied) head.appendChild(chip(s("dashRollbackRate", { pct: pct(x.rollback / x.applied) }), usage.flags && usage.flags.releases[v] ? "flag" : null));
      card.appendChild(head);
      var dl = el("dl", "dm-dash__stats");
      var runs = byV[v] || 0;
      [["relRuns", fmtCount(runs) + (week ? " · " + pct(runs / week) : "")],
       ["usageUpDownloaded", fmtCount(x.downloaded)], ["usageUpApplied", fmtCount(x.applied)],
       ["usageUpWaiting", x.downloaded < x.applied ? "–" : fmtCount(x.downloaded - x.applied)], ["usageUpRollback", fmtCount(x.rollback)],
       ["usageUpSince", fmtDay(x.since)]].forEach(function (p) {
        var row = el("div");
        row.appendChild(el("dt", null, s(p[0])));
        row.appendChild(el("dd", null, p[1]));
        dl.appendChild(row);
      });
      card.appendChild(dl);
      var acc = 0, vals = [];
      for (var k = USAGE_INSTALL_DAYS - 1; k >= 0; k--) {
        var d = dayAgo(k);
        if (d < x.since) continue;
        acc += x.days[d] || 0;
        vals.push(acc);
      }
      if (vals.length > 1) {
        card.appendChild(el("p", "dm-hint", s("dashAdoption")));
        card.appendChild(spark(vals, "dm-dash__spark dm-dash__spark--wide"));
      }
      host.appendChild(card);
    });
  }
  // ── Health: the newest week with reports, then the weeks before it ──
  function renderHealthTab() {
    if (!usage.data) return;
    paintUsagePills();
    var title = $("[data-dm-health-title]"), lead = $("[data-dm-usage-healthlead]");
    var parts = ["[data-dm-checks]", "[data-dm-errkinds]", "[data-dm-apple-sum]", "[data-dm-logs]", "[data-dm-hweeks]", "[data-dm-heat]", "[data-dm-apple]", "[data-dm-usage-health]"];
    var clear = function () { parts.forEach(function (p) { $(p).textContent = ""; }); };
    if (!usage.hw) { clear(); title.textContent = s("hLoading"); lead.textContent = ""; return; }
    if (!usage.hweek) {
      clear();
      title.textContent = s("hNone", { n: HEALTH_WEEKS });
      lead.textContent = "";
      return;
    }
    var span = weekSpan(usage.hweek), all = summarize(reportRows()), sum = summarize(reportRows(), usage.v);
    var active = sumActive(usage.hweek);
    title.textContent = s("hTitle", { span: span });
    lead.textContent = active && !usage.v
      ? s("hLead", { n: fmtCount(all.reports), active: fmtCount(active) })
      : s("hLeadNoActive", { n: fmtCount(sum.reports) });
    renderChecks(sum);
    renderErrKinds(sum);
    renderAppleSum(sum);
    renderLogs(sum);
    renderWeeks();
    renderHeat();
    renderApple();
    renderHealth();
  }
  /* The four plain metrics: one row per metric some install counted, then one ✓ row for the
     rest (all four when the week is clean). */
  function renderChecks(sum) {
    var host = $("[data-dm-checks]");
    host.textContent = "";
    var row = function (tone, glyph, name, num) {
      var r = el("div", "dm-dash__check");
      r.setAttribute("data-tone", tone);
      r.appendChild(el("span", "dm-dash__glyph", glyph));
      r.appendChild(el("span", "dm-dash__checkname", name));
      if (num) r.appendChild(el("span", "dm-dash__checknum", num));
      host.appendChild(r);
    };
    var of = fmtCount(sum.reports), clean = [];
    USAGE_PLAIN.forEach(function (m) {
      var n = sum.installs[m] || 0;
      if (!n) { clean.push(s("hCheck_" + m)); return; }
      row(m === "panics" ? "stop" : "pause", "!", s("hCheck_" + m), s("hCheckOn", { n: fmtCount(n), of: of, pct: pct(n / sum.reports) }));
    });
    if (clean.length === USAGE_PLAIN.length) row("go", "✓", s("hAllClear", { of: of }));
    else if (clean.length) row("go", "✓", s("hChecksRest", { of: of, names: clean.join(" · ") }));
  }
  /* Error kinds (DeetsMusic USAGE-COUNTS.md §16): one row per fingerprint, `err.<how>.<type>@
     <place>`, most installs first. "new" when no earlier week in hand has it. */
  function parseFp(metric) {
    var fp = metric.slice(4), at = fp.indexOf("@");
    if (at < 0) return null;
    var head = fp.slice(0, at), dot = head.indexOf(".");
    return { how: head.slice(0, dot), type: head.slice(dot + 1), place: fp.slice(at + 1).replace("<", " ← ") };
  }
  // Is `metric` in any week on the tab before `week`, or (with `notV`) on another version?
  function seenBefore(metric, week, notV) {
    return (usage.hw || []).some(function (x) {
      return (x.rows || []).some(function (r) {
        return r.metric === metric && (x.week < week || (notV && x.week === week && r.v !== notV));
      });
    });
  }
  function renderErrKinds(sum) {
    var host = $("[data-dm-errkinds]");
    host.textContent = "";
    var ms = Object.keys(sum.installs).filter(function (m) { return m.indexOf("err.") === 0; })
      .sort(function (a, b) {
        var oa = a === "err.other", ob = b === "err.other";        // past the cap: always last
        return oa !== ob ? (oa ? 1 : -1) : sum.installs[b] - sum.installs[a] || (a < b ? -1 : 1);
      });
    if (!ms.length) { host.appendChild(el("p", "dm-empty", s("hErrNone"))); return; }
    var rows = ms.map(function (m) {
      var p = parseFp(m), vs = {};
      reportRows().forEach(function (r) { if (r.metric === m) vs[r.v] = 1; });
      var n = sum.installs[m];
      return [
        p ? p.place : s("hErrOther"), p ? p.type : "", p ? (S["hHow_" + p.how] ? s("hHow_" + p.how) : p.how) : "",
        fmtCount(n) + " · " + pct(n / sum.reports),
        Object.keys(vs).sort(cmpVersionDesc).map(function (v) { return "v" + v; }).join(" "),
      ];
    });
    var t = usageTable([s("hErrWhere"), s("hErrType"), s("hErrHow"), s("hErrInstalls"), s("hErrVersions")], rows);
    t.classList.add("dm-dash__errs");
    $all("tbody tr", t).forEach(function (tr, i) {
      if (!parseFp(ms[i]) || seenBefore(ms[i], usage.hweek)) return;
      var tag = chip(s("hErrNew"), "flag");
      tag.title = s("hErrNewHint");
      tr.querySelector("th").appendChild(tag);
    });
    host.appendChild(t);
  }

  /* One row per call group: installs with a successful call, the least number of successful
     calls, and each error result with the installs that hit it, most first. */
  function renderAppleSum(sum) {
    var host = $("[data-dm-apple-sum]");
    host.textContent = "";
    var errsOf = function (g) {
      return USAGE_CLASSES.filter(function (c) { return c !== "2xx" && sum.installs["apple." + g + "." + c]; })
        .sort(function (a, b) { return sum.installs["apple." + g + "." + b] - sum.installs["apple." + g + "." + a]; });
    };
    var rows = USAGE_GROUPS.map(function (g) {
      var ok = "apple." + g + ".2xx";
      return [s("hGroup_" + g), sum.installs[ok] || 0, sum.least[ok] ? fmtCount(sum.least[ok]) + "+" : 0, ""];
    });
    rows.push([s("hAppleAll"), "", fmtCount(okCalls(sum)) + "+", ""]);
    var t = usageTable([s("hAppleCalls"), s("hAppleInstalls"), s("hAppleOk"), s("hAppleErr")], rows);
    t.classList.add("dm-dash__sum");
    $all("tbody tr", t).forEach(function (tr, i) {
      if (i === USAGE_GROUPS.length) { tr.classList.add("is-total"); return; }
      // Each error result a chip: the result, then the installs that hit it.
      var cell = $all("td", tr)[2], errs = errsOf(USAGE_GROUPS[i]);
      if (!errs.length) { cell.className = "is-zero"; cell.textContent = s("hAppleNoErr"); return; }
      errs.forEach(function (c) {
        var n = sum.installs["apple." + USAGE_GROUPS[i] + "." + c];
        var c1 = el("span", "dm-dash__err");
        c1.appendChild(el("span", null, c === "net" ? s("hClass_net") : c));
        c1.appendChild(el("b", null, fmtCount(n)));
        c1.title = s("hCheckOn", { n: fmtCount(n), of: fmtCount(sum.reports), pct: pct(n / sum.reports) });
        cell.appendChild(c1);
      });
    });
    host.appendChild(t);
  }
  /* Log lines by area: installs with an ERROR line and with a WARN line, errors first. */
  function renderLogs(sum) {
    var host = $("[data-dm-logs]");
    host.textContent = "";
    var areas = {};
    Object.keys(sum.installs).forEach(function (m) {
      var p = /^log\.(error|warn)\.(.+)$/.exec(m);
      if (!p) return;
      var a = areas[p[2]] = areas[p[2]] || { error: 0, warn: 0 };
      a[p[1]] = sum.installs[m];
    });
    if (!Object.keys(areas).length) { host.appendChild(el("p", "dm-empty", s("hLogNone"))); return; }
    // Two bar lists side by side, each bar the share of the week's reports; areas at 0 left out.
    ["error", "warn"].forEach(function (lv) {
      var col = el("div");
      col.appendChild(el("h4", "dm-dash__minihead", s(lv === "error" ? "hLogErrs" : "hLogWarns")));
      var bars = el("div", "dm-usage__bars");
      var names = Object.keys(areas).filter(function (a) { return areas[a][lv]; })
        .sort(function (a, b) { return areas[b][lv] - areas[a][lv] || (a < b ? -1 : 1); });
      if (!names.length) bars.appendChild(el("p", "dm-empty", s("hNoErrs")));
      else renderBars(bars, names.map(function (a) { return [a, areas[a][lv]]; }), sum.reports);
      col.appendChild(bars);
      host.appendChild(col);
    });
  }
  /* One row per week in hand, newest first: how many reported and the headline of each. */
  function renderWeeks() {
    var host = $("[data-dm-hweeks]");
    host.textContent = "";
    // Weeks older than the first with any count are before counting began: left out.
    var weeks = usage.hw.slice();
    while (weeks.length > 1) {
      var x0 = weeks[weeks.length - 1];
      if (x0.failed || summarize(x0.rows || []).reports || sumActive(x0.week)) break;
      weeks.pop();
    }
    var rows = weeks.map(function (x) {
      var sm = summarize(x.rows || []), act = sumActive(x.week), r = sm.reports;
      if (x.failed) return [weekName(x.week), "–", act, "", "", "", "", ""];
      var tA = topMetric(sm, isAppleErr), tL = topMetric(sm, isLogErr);
      return [
        weekName(x.week), r, act,
        r ? pct(1 - (sm.installs.panics || 0) / r) : "–",
        r ? fmtCount(sm.installs.freezes || 0) : "–",
        tA ? appleName(tA.metric) + " · " + tA.n : "–",
        tL ? tL.metric.slice(10) + " · " + tL.n : "–",
        r ? fmtCount(okCalls(sm)) + "+" : "–",
      ];
    });
    var t = usageTable([s("hWk"), s("hWkReports"), s("hWkActive"), s("hWkPanicFree"), s("hWkFreezes"), s("hWkTopApple"), s("hWkTopLog"), s("hWkOk")], rows);
    $all("tbody tr", t).forEach(function (tr, i) {
      var w = weeks[i].week;
      if (w === usage.hweek) tr.classList.add("is-on");
      if (w === usage.hweek || !summarize(weeks[i].rows || []).reports) return;
      // A week with reports: a click shows it above, as the Week pill does.
      tr.classList.add("is-pick");
      tr.tabIndex = 0;
      var go = function () { usage.hweek = w; usage.hpicked = true; renderHealthTab(); paintDash(); };
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    host.appendChild(t);
  }

  /* Rows are the trouble metrics some version counted above 0 (2xx is not trouble), columns
     the versions, newest first; a cell is the share of that version's reports. */
  function renderHeat() {
    var h = healthStats(), host = $("[data-dm-heat]");
    host.textContent = "";
    var reports = h.versions.reduce(function (n, v) { return n + h.reports[v]; }, 0);
    $("[data-dm-heat-lead]").textContent = s("hHeatLead", { n: fmtCount(reports), span: weekSpan(usage.hweek) });
    var rank = function (m) { return USAGE_PLAIN.indexOf(m) >= 0 ? "0" + USAGE_PLAIN.indexOf(m) : m.indexOf("log.") === 0 ? "1" + m : "2" + m; };
    var metrics = Object.keys(h.above).filter(function (m) {
      return isTrouble(m) && h.versions.some(function (v) { return (h.above[m][v] || 0) > 0; });
    }).sort(function (a, b) { return rank(a) < rank(b) ? -1 : 1; });
    if (!metrics.length) { host.appendChild(el("p", "dm-empty", s("dashHeatNone"))); return; }
    var share = function (m, v) { return h.reports[v] ? (h.above[m][v] || 0) / h.reports[v] : 0; };
    var max = 0;
    metrics.forEach(function (m) { h.versions.forEach(function (v) { max = Math.max(max, share(m, v)); }); });
    var cells = (usage.flags && usage.flags.cells) || {};
    host.appendChild(heatTable([s("usageMetric")].concat(h.versions.map(function (v) { return "v" + v; })), metrics.map(function (m) {
      return [m].concat(h.versions.map(function (v) {
        return { share: share(m, v), max: max, flag: !!cells[m + "|" + v], title: fmtCount(h.above[m][v] || 0) + " / " + fmtCount(h.reports[v]) };
      }));
    })));
  }
  // The 48 Apple cells (group × class) for the Version pill's choice: share of its reports.
  function renderApple() {
    var h = healthStats(), host = $("[data-dm-apple]");
    host.textContent = "";
    var vs = usage.v ? [usage.v] : h.versions;
    var reports = vs.reduce(function (n, v) { return n + (h.reports[v] || 0); }, 0);
    var count = function (m) { return vs.reduce(function (n, v) { return n + ((h.above[m] || {})[v] || 0); }, 0); };
    var max = 0;
    USAGE_GROUPS.forEach(function (g) { USAGE_CLASSES.forEach(function (c) { max = Math.max(max, reports ? count("apple." + g + "." + c) / reports : 0); }); });
    host.appendChild(heatTable([""].concat(USAGE_CLASSES), USAGE_GROUPS.map(function (g) {
      return [g].concat(USAGE_CLASSES.map(function (c) {
        var n = count("apple." + g + "." + c);
        return { share: reports ? n / reports : 0, max: max, title: fmtCount(n) + " / " + fmtCount(reports) };
      }));
    })));
  }
  function heatTable(head, rows) {
    var t = usageTable(head, rows.map(function (r) { return [r[0]].concat(r.slice(1).map(function () { return ""; })); }));
    t.classList.add("dm-dash__heat");
    $all("tbody tr", t).forEach(function (tr, i) {
      $all("td", tr).forEach(function (td, j) {
        var c = rows[i][j + 1];
        td.className = c.share ? "" : "is-zero";
        td.textContent = (c.flag ? "! " : "") + pct(c.share);
        td.title = c.title;
        if (c.flag) td.classList.add("is-flag");
        heat(td, c.share, c.max);
      });
    });
    return t;
  }

  // ── Settings: every setting at once, each value against the week before ──
  function loadPrev() {
    var pw = prevWeek(), seq = usage.seq;
    usage.prev = null;
    if (!pw) { renderShares(); return; }
    ownerApi("GET", "/admin/usage?channel=" + encodeURIComponent(usage.channel) + "&week=" + encodeURIComponent(pw)).then(function (res) {
      if (seq !== usage.seq || !res.ok || !res.data) return;
      var w = (res.data.weeks || []).filter(function (x) { return x.week === pw; })[0];
      usage.prev = { week: pw, reports: w ? w.n : 0, shares: res.data.shares || [] };
      renderShares();
    });
  }
  /* Grouped by the app's own Settings sections and named as the app names them, from
     usage-settings.js (generated from DeetsMusic: scripts/build-usage-settings.mjs). Each
     setting is one row: a bar split by value, the default's part plain and the rest in the
     title color, with how many installs moved off the default. A section's settings that
     everyone left at the default fold into one line. A key the map lacks shows under Other,
     by its key, with no default marked. */
  var SETTINGS_MAP = window.DM_USAGE_SETTINGS || { sections: [], keys: {} };
  var SETTINGS_ORDER = Object.keys(SETTINGS_MAP.keys);
  function settingRows() {
    var by = {}, prevBy = {};
    usage.data.shares.forEach(function (r) { (by[r.key] = by[r.key] || []).push(r); });
    if (usage.prev) usage.prev.shares.forEach(function (r) { (prevBy[r.key] = prevBy[r.key] || []).push(r); });
    var total = function (list) { return list.reduce(function (n, r) { return n + r.n; }, 0); };
    return Object.keys(by).map(function (k) {
      var meta = SETTINGS_MAP.keys[k] || null, def = meta ? meta.def : [];
      var vals = by[k].slice().sort(function (a, b) { return b.n - a.n; });
      var was = {}, pt = total(prevBy[k] || []);
      (prevBy[k] || []).forEach(function (r) { was[String(r.value)] = r.n / pt; });
      var isDef = function (v) { return def.indexOf(String(v)) >= 0; };
      return {
        key: k, meta: meta, vals: vals, total: total(vals), isDef: isDef, was: pt ? was : null,
        changed: def.length ? total(vals.filter(function (r) { return !isDef(r.value); })) : null,
        section: meta ? meta.section : s("dashSettingsOther"),
      };
    });
  }
  function valueName(r, v) {
    if (v == null) return "–";
    if (v === "other") return s("dashValOther");
    if (v === "user") return s("dashValUser");
    return (r.meta && r.meta.options[v]) || String(v);
  }
  function settingRow(r) {
    var row = el("div", "dm-dash__set");
    var head = el("div", "dm-dash__sethead");
    var name = el("span", "dm-dash__setname", r.meta ? r.meta.label : r.key);
    name.title = r.key;
    head.appendChild(name);
    if (r.changed != null) {
      var ch = el("span", "dm-dash__setchanged", s("dashChanged", { pct: pct(r.changed / r.total) }));
      if (r.changed) ch.classList.add("is-moved");
      head.appendChild(ch);
    }
    row.appendChild(head);
    var bar = el("div", "dm-dash__setbar"), vals = el("div", "dm-dash__setvals"), shade = 0;
    r.vals.forEach(function (v) {
      var def = r.isDef(v.value), cls = def ? "is-def" : "dm-ser-" + Math.min(shade++, SERIES - 1);
      var share = r.total ? v.n / r.total : 0;
      var seg = el("span", "dm-dash__seg " + cls);
      seg.style.flexGrow = String(v.n);
      seg.title = valueName(r, v.value) + ": " + fmtCount(v.n) + " (" + pct(share) + ")";
      bar.appendChild(seg);
      var item = el("span", "dm-dash__setval" + (def ? " is-def" : ""));
      item.appendChild(el("span", "dm-dash__swatch " + cls));
      item.appendChild(el("span", "dm-dash__valname", valueName(r, v.value)));
      if (def) item.appendChild(el("span", "dm-dash__deftag", s("dashDefault")));
      var text = pct(share) + " · " + fmtCount(v.n);
      if (r.was) {
        var pts = (share - (r.was[String(v.value)] || 0)) * 100;
        if (Math.abs(pts) >= 1) text += " · " + arrow(pts) + Math.abs(pts).toFixed(0);
      }
      item.appendChild(el("span", "dm-dash__valpct", text));
      vals.appendChild(item);
    });
    row.appendChild(bar);
    row.appendChild(vals);
    return row;
  }
  function renderShares() {
    var host = $("[data-dm-usage-shares]");
    host.textContent = "";
    var rep = weekReports(), prev = usage.prev && usage.prev.reports ? usage.prev : null;
    $("[data-dm-shares-lead]").textContent = prev
      ? s("dashSetLead", { n: fmtCount(rep), week: prev.week })
      : s("dashSetLeadNoPrev", { n: fmtCount(rep) });
    var rows = settingRows();
    if (!rows.length) { host.appendChild(el("p", "dm-empty", s("usageNone"))); return; }
    var rank = function (r) { var i = SETTINGS_ORDER.indexOf(r.key); return i < 0 ? 1e6 : i; };

    // First, the settings people moved off the default most.
    var top = rows.filter(function (r) { return r.changed; })
      .sort(function (a, b) { return b.changed / b.total - a.changed / a.total || rank(a) - rank(b); }).slice(0, 6);
    if (top.length) {
      var lead = el("section", "dm-dash__setsec dm-dash__setsec--top");
      lead.appendChild(el("h4", "dm-dash__sechead", s("dashMostChanged")));
      var grid = el("div", "dm-dash__setgrid dm-dash__setgrid--top");
      top.forEach(function (r) { grid.appendChild(settingRow(r)); });
      lead.appendChild(grid);
      host.appendChild(lead);
    }

    // The sections flow down balanced columns, so a short one leaves no hole beside it.
    var cols = el("div", "dm-dash__setcols");
    host.appendChild(cols);
    SETTINGS_MAP.sections.concat([s("dashSettingsOther")]).forEach(function (sec) {
      var inSec = rows.filter(function (r) { return r.section === sec; }).sort(function (a, b) { return rank(a) - rank(b) || (a.key < b.key ? -1 : 1); });
      if (!inSec.length) return;
      var moved = inSec.filter(function (r) { return r.changed !== 0; });
      var still = inSec.filter(function (r) { return r.changed === 0; });
      var box = el("section", "dm-dash__setsec");
      var head = el("div", "dm-dash__sechead");
      head.appendChild(el("h4", null, sec));
      head.appendChild(el("span", "dm-dash__seccount", s("dashSecCount", { n: inSec.length - still.length, of: inSec.length })));
      box.appendChild(head);
      if (moved.length) {
        var grid = el("div", "dm-dash__setgrid");
        moved.forEach(function (r) { grid.appendChild(settingRow(r)); });
        box.appendChild(grid);
      }
      if (still.length) {
        box.appendChild(el("p", "dm-dash__still", s("dashAllDefault", {
          names: still.map(function (r) { return r.meta ? r.meta.label : r.key; }).join(" · "),
        })));
      }
      cols.appendChild(box);
    });
  }

  // ── Inbox summary: tiles, posts per week, open bugs per version ──
  function paintInboxSummary() {
    if (!inbox.posts) return;
    var open = inbox.posts.filter(function (p) { return !DONE[p.state]; });
    var tiles = $("[data-dm-inbox-tiles]");
    tiles.textContent = "";
    tile(tiles, s("tileWaitingTitle"), fmtCount(inbox.posts.filter(isWaiting).length));
    tile(tiles, s("tileOpenBugs"), fmtCount(open.filter(function (p) { return p.kind === "issue"; }).length));
    tile(tiles, s("tileOpenIdeas"), fmtCount(open.filter(function (p) { return p.kind === "suggestion"; }).length));

    var WEEKS = 12, now = Date.now() / 1000, labels = [], bugs = [], ideas = [];
    for (var k = WEEKS - 1; k >= 0; k--) {
      var hi = now - k * 7 * 86400, lo = hi - 7 * 86400;
      var inWeek = inbox.posts.filter(function (p) { return p.created_at >= lo && p.created_at < hi; });
      labels.push(s("dashWeekOf", { date: fmtUnix(lo) }));
      bugs.push(inWeek.filter(function (p) { return p.kind === "issue"; }).length);
      ideas.push(inWeek.filter(function (p) { return p.kind === "suggestion"; }).length);
    }
    columns($("[data-dm-inbox-weekly]"), labels, [
      { label: s("inboxKind_issue"), cls: "dm-ser-0", values: bugs },
      { label: s("inboxKind_suggestion"), cls: "dm-ser-2", values: ideas },
    ], null, s("dashPostsWeekly"));

    var byV = {};
    open.forEach(function (p) {
      if (p.kind !== "issue") return;
      var v = (p.meta && p.meta.version) || p.version || "–";
      byV[v] = (byV[v] || 0) + 1;
    });
    var bugsOpen = Object.keys(byV).reduce(function (n, v) { return n + byV[v]; }, 0);
    renderBars($("[data-dm-inbox-versions]"), Object.keys(byV).sort(cmpVersionDesc).map(function (v) {
      return [v === "all" ? s("ticketVersionAll") : v, byV[v]];
    }), bugsOpen);
  }

  // ── Boot ───────────────────────────────────────────────────────
  $all("[data-s]").forEach(function (n) { n.textContent = s(n.getAttribute("data-s")); });
  $all("[data-hint]").forEach(function (n) { n.title = s(n.getAttribute("data-hint")); });
  var badge = $("[data-dm-mock]");
  if (badge) badge.hidden = !MOCK;
  watchOwner();
})();
