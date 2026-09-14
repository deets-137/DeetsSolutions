/* DeetsMusic — the Windows app's front door (docs/support.md, "The page").

   DRAFT 2026-09-14. Layout and every string are Claude's first pass;
   Aditya leads this page's design. Copy lives in strings.js ([ph] only).

   Data sources (all anonymous, no sign-in):
     music-api.deets.solutions  GET /update/deetsmusic/releases  install box + release notes
     support.deets.solutions    GET /status, GET/POST /posts, GET /t/<code>,
                                POST /t/<code>/replies, POST /interest

   ?mock swaps both for deetsmusic/mock.js (same response shapes), because
   the releases route is not deployed yet and the boards are empty.

   Two rules from support.md this file keeps:
   - A ticket code is a credential. It rides the URL FRAGMENT (#t=<code>),
     never the query, so it never reaches a server log or a Referer.
   - Everything a person typed is rendered as text, never as HTML. Release
     notes are a markdown subset (paragraphs, **bold**, absolute links),
     built node by node. */
(function () {
  "use strict";

  var ROOT = document.querySelector("[data-dm]");
  var S = window.DM_STRINGS;
  if (!ROOT || !S) return;

  var APP = "deetsmusic";
  var CHANNEL = "deetsmusic";
  // The deployed worker allows localhost:8787 and :8788 in CORS, so local UI
  // work runs against production data with no local worker. Any other dev
  // port needs ?mock (or an ALLOWED_ORIGINS entry in DeetsSupport).
  var HOSTS = {
    support: "https://support.deets.solutions",
    music: "https://music-api.deets.solutions"
  };
  var MOCK = window.DM_MOCK || null;

  var LS_MINE = "deets-dm-mine";          // [{ code, kind, title, at }] — this browser's posts
  var LS_INTEREST = "deets-dm-interest";  // [code] — suggestions this browser showed interest in
  var JWT_SHAPE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;   // mirrors the worker's second net
  var TITLE_MAX = 120, BODY_MAX = 4000;
  var WINDOW_HOURS = 6, STRIP_CELLS = 72;   // the worker's status window: 6 h of 5-minute checks
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── Helpers ────────────────────────────────────────────────────
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
  function readJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function toast(kind, text) {
    if (window.DeetsToast) window.DeetsToast.push({ kind: kind, text: text });
  }

  // Every call resolves (never rejects) to { ok, status, data }; the worker's
  // errors are { error: "<code>" }, and a network failure is status 0.
  function api(host, method, path, body) {
    if (MOCK) return MOCK.request(host, method, path, body);
    var init = { method: method };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    return fetch(HOSTS[host] + path, init).then(function (r) {
      if (r.status === 204) return { ok: true, status: 204, data: null };
      return r.json().catch(function () { return null; }).then(function (data) {
        return { ok: r.ok, status: r.status, data: data };
      });
    }, function () {
      return { ok: false, status: 0, data: { error: "network" } };
    });
  }
  function errText(res) {
    var code = res && res.data && res.data.error;
    return S["err_" + code] ? s("err_" + code) : s("err_generic");
  }

  // Dates: release pub_dates are ISO at UTC midnight for history rows, so
  // format those in UTC or they slide a day back in the Americas. Post
  // timestamps are unix seconds, shown local.
  function fmtDay(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  function fmtUnix(t) {
    return new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtClock(t) {
    return new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function ago(t) {
    var min = Math.round((Date.now() / 1000 - t) / 60);
    if (min < 1) return s("agoNow");
    if (min < 60) return s("agoMin", { n: min });
    return s("agoHour", { n: Math.round(min / 60) });
  }
  function mb(bytes) { return (bytes / 1048576).toFixed(1); }

  function fillStatic() {
    $all("[data-s]").forEach(function (n) { n.textContent = s(n.getAttribute("data-s")); });
    $all("[data-s-ph]").forEach(function (n) { n.setAttribute("placeholder", s(n.getAttribute("data-s-ph"))); });
    var badge = $("[data-dm-mock]");
    if (badge) badge.hidden = !MOCK;
  }

  // ── Status ─────────────────────────────────────────────────────
  function loadStatus() {
    api("support", "GET", "/status?app=" + APP).then(function (res) {
      var a = res.ok && res.data && res.data.apps && res.data.apps[0];
      if (!a) {
        paintStatusWord("unknown");
        $("[data-dm-status-line]").textContent = s("statusFailed");
        return;
      }
      renderStatus(a);
    });
  }
  function paintStatusWord(state) {
    $("[data-dm-status-dot]").setAttribute("data-state", state);
    $("[data-dm-status-word]").textContent = s("status_" + state);
  }
  function renderStatus(a) {
    var checks = Array.isArray(a.checks) ? a.checks : [];
    var line = $("[data-dm-status-line]");
    var strip = $("[data-dm-strip]");
    var legend = $("[data-dm-strip-legend]");
    paintStatusWord(a.status);
    showNotice(a.notice);

    strip.textContent = "";
    if (!a.monitored || !checks.length) {
      line.textContent = s(a.monitored ? "statusEmpty" : "statusUnmonitored");
      strip.hidden = legend.hidden = true;
      return;
    }
    var passed = checks.filter(function (c) { return c.ok; }).length;
    line.textContent = s("statusLine", {
      pct: Math.round((passed * 1000) / checks.length) / 10,
      hours: WINDOW_HOURS,
      ago: ago(checks[0].checked_at)
    });
    // checks arrive newest first; the strip reads left (oldest) to right (now)
    for (var i = STRIP_CELLS - 1; i >= 0; i--) {
      var c = checks[i];
      var cell = el("span", "dm-strip__cell");
      if (!c) {
        cell.setAttribute("data-ok", "none");
      } else {
        cell.setAttribute("data-ok", c.ok ? "yes" : "no");
        cell.title = c.ok
          ? s("statusCellOk", { time: fmtClock(c.checked_at), ms: c.ms })
          : s("statusCellBad", { time: fmtClock(c.checked_at), note: c.note || "" });
      }
      strip.appendChild(cell);
    }
    strip.hidden = legend.hidden = false;
  }
  function showNotice(text) {
    var box = $("[data-dm-notice]");
    if (!text) { box.hidden = true; return; }
    $("[data-dm-notice-text]").textContent = text;
    box.hidden = false;
  }

  // ── Install + release notes ────────────────────────────────────
  function loadReleases() {
    var list = $("[data-dm-releases]");
    list.textContent = "";
    list.appendChild(el("p", "dm-empty", s("releasesLoading")));
    $("[data-dm-install-ver]").textContent = s("installLoading");

    api("music", "GET", "/update/" + CHANNEL + "/releases").then(function (res) {
      var d = res.ok && res.data;
      if (!d || !Array.isArray(d.releases)) {
        $("[data-dm-install-ver]").textContent = s("installFailed");
        list.textContent = "";
        list.appendChild(el("p", "dm-empty", s("releasesFailed")));
        return;
      }
      renderInstall(d.latest);
      renderReleases(d.releases, d.latest);
    });
  }

  function renderInstall(latest) {
    var ver = $("[data-dm-install-ver]");
    var btn = $("[data-dm-install-btn]");
    var size = $("[data-dm-install-size]");
    var cta = $("[data-dm-cta-download]");
    if (!latest || !latest.url) {
      ver.textContent = s("installNone");
      btn.hidden = cta.hidden = true;
      size.textContent = "";
      return;
    }
    ver.textContent = s("installVersion", { v: latest.version, date: fmtDay(latest.pub_date) });
    btn.href = cta.href = latest.url;
    btn.textContent = s("installButton");
    cta.textContent = s("ctaDownload", { v: latest.version });
    size.textContent = latest.size ? s("installSize", { mb: mb(latest.size) }) : "";
    btn.hidden = cta.hidden = false;
  }

  function renderReleases(rows, latest) {
    var list = $("[data-dm-releases]");
    list.textContent = "";
    if (!rows.length) {
      list.appendChild(el("p", "dm-empty", s("releasesEmpty")));
      return;
    }
    rows.forEach(function (r, i) {
      var item = el("article", "dm-rel");
      if (r.withdrawn) item.classList.add("is-withdrawn");

      var head = el("button", "dm-rel__head");
      head.type = "button";
      head.setAttribute("aria-controls", "dm-rel-" + i);
      head.appendChild(el("span", "dm-rel__v", r.version));
      if (latest && r.version === latest.version) head.appendChild(chip(s("tagLatest"), "latest"));
      if (r.withdrawn) head.appendChild(chip(s("tagWithdrawn"), "withdrawn"));
      else if (!r.url) head.appendChild(chip(s("tagNotesOnly")));
      head.appendChild(el("span", "dm-rel__date", r.pub_date ? fmtDay(r.pub_date) : ""));
      var caret = el("span", "dm-rel__caret", "▾");
      caret.setAttribute("aria-hidden", "true");
      head.appendChild(caret);

      var body = el("div", "dm-rel__body");
      body.id = "dm-rel-" + i;
      if (r.withdrawn && r.withdrawn_reason) {
        body.appendChild(el("p", "dm-rel__reason", s("relWithdrawnReason", { reason: r.withdrawn_reason })));
      }
      if (r.notes) body.appendChild(renderNotes(r.notes));
      else body.appendChild(el("p", "dm-empty", s("relNoNotes")));
      if (r.url) {
        var dl = el("a", "home__cta", s("relDownload", { v: r.version, mb: r.size ? mb(r.size) : "?" }));
        dl.href = r.url;
        body.appendChild(dl);
      } else {
        body.appendChild(el("p", "dm-hint", s(r.withdrawn ? "relWithdrawn" : "relHistory")));
      }

      function setOpen(open) {
        item.classList.toggle("is-open", open);
        head.setAttribute("aria-expanded", open ? "true" : "false");
      }
      setOpen(i === 0);
      head.addEventListener("click", function () { setOpen(!item.classList.contains("is-open")); });

      item.appendChild(head);
      item.appendChild(body);
      list.appendChild(item);
    });
  }

  // The notes subset: blank-line paragraphs, **bold**, [text](https://…).
  // A relative link (it works on GitHub, not here) degrades to its text.
  function renderNotes(text) {
    var wrap = el("div", "dm-notes");
    text.split(/\n\s*\n/).forEach(function (para) {
      para = para.trim();
      if (!para) return;
      var p = el("p");
      inline(para.replace(/\s*\n\s*/g, " "), p);
      wrap.appendChild(p);
    });
    return wrap;
  }
  function inline(str, parent) {
    var re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
    var last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) parent.appendChild(document.createTextNode(str.slice(last, m.index)));
      if (m[1] != null) {
        parent.appendChild(el("strong", null, m[1]));
      } else if (m[4] != null) {
        parent.appendChild(el("code", "dm-code", m[4]));
      } else if (/^https:\/\//.test(m[3])) {
        var a = el("a", "dm-link", m[2]);
        a.href = m[3];
        a.rel = "noopener";
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(m[2]));
      }
      last = re.lastIndex;
    }
    if (last < str.length) parent.appendChild(document.createTextNode(str.slice(last)));
  }

  function chip(text, tone) {
    var c = el("span", "dm-chip", text);
    if (tone) c.setAttribute("data-tone", tone);
    return c;
  }

  // ── Boards ─────────────────────────────────────────────────────
  var EMPTY = { suggestion: "suggestEmpty", issue: "issuesEmpty" };

  function loadBoard(kind) {
    var list = $('[data-dm-list="' + kind + '"]');
    list.textContent = "";
    list.appendChild(el("p", "dm-empty", s("boardLoading")));
    api("support", "GET", "/posts?app=" + APP + "&kind=" + kind).then(function (res) {
      list.textContent = "";
      var posts = res.ok && res.data && res.data.posts;
      if (!Array.isArray(posts)) {
        list.appendChild(el("p", "dm-empty", s("boardFailed")));
        return;
      }
      if (!posts.length) {
        list.appendChild(el("p", "dm-empty", s(EMPTY[kind])));
        return;
      }
      posts.forEach(function (p) { list.appendChild(renderPost(p)); });
    });
  }

  function renderPost(p) {
    var item = el("article", "dm-post");
    if (p.kind === "suggestion") item.appendChild(interestButton(p));

    var main = el("div", "dm-post__main");
    var head = el("div", "dm-post__head");
    head.appendChild(el("h3", "dm-post__title", p.title));
    head.appendChild(chip(s("state_" + p.state), p.state));
    main.appendChild(head);
    main.appendChild(el("p", "dm-post__body", p.body));

    var foot = el("div", "dm-post__foot");
    foot.appendChild(el("span", null, fmtUnix(p.created_at)));
    if (p.body.length > 180 || p.body.indexOf("\n") >= 0) {
      var more = el("button", "dm-textbtn", s("postMore"));
      more.type = "button";
      more.setAttribute("aria-expanded", "false");
      more.addEventListener("click", function () {
        var open = item.classList.toggle("is-expanded");
        more.textContent = s(open ? "postLess" : "postMore");
        more.setAttribute("aria-expanded", open ? "true" : "false");
      });
      foot.appendChild(more);
    }
    main.appendChild(foot);
    item.appendChild(main);
    return item;
  }

  // Interest is a signal, not a vote (support.md): the worker counts every
  // +1, so this browser's list of codes is what stops a double-click.
  function interestButton(p) {
    var b = el("button", "dm-interest");
    b.type = "button";
    var arrow = el("span", "dm-interest__arrow", "▲");
    arrow.setAttribute("aria-hidden", "true");
    var n = el("span", "dm-interest__n", String(p.interest));
    b.appendChild(arrow);
    b.appendChild(n);
    var done = readJSON(LS_INTEREST, []).indexOf(p.code) >= 0;

    function paint() {
      b.classList.toggle("is-done", done);
      b.setAttribute("aria-pressed", done ? "true" : "false");
      b.title = s(done ? "interestDone" : "interestLabel");
      b.setAttribute("aria-label", s("interestAria", { n: n.textContent }));
    }
    paint();

    b.addEventListener("click", function () {
      if (done || b.disabled) return;
      b.disabled = true;
      api("support", "POST", "/interest", { code: p.code }).then(function (res) {
        b.disabled = false;
        if (!res.ok) { toast("error", errText(res)); return; }
        done = true;
        var list = readJSON(LS_INTEREST, []);
        if (list.indexOf(p.code) < 0) list.push(p.code);
        writeJSON(LS_INTEREST, list.slice(-500));
        if (res.data && res.data.interest != null) n.textContent = String(res.data.interest);
        paint();
      });
    });
    return b;
  }

  // ── Post forms ─────────────────────────────────────────────────
  function field(form, name) { return form.elements.namedItem(name); }

  function openForm(kind, open) {
    var form = $('[data-dm-form="' + kind + '"]');
    var toggle = $('[data-dm-open="' + kind + '"]');
    form.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) field(form, "title").focus({ preventScroll: true });
  }

  function wireForm(form) {
    var kind = form.getAttribute("data-dm-form");
    var toggle = $('[data-dm-open="' + kind + '"]');
    var title = field(form, "title");
    var body = field(form, "body");
    var version = field(form, "version");
    var count = $("[data-dm-count]", form);
    var err = $("[data-dm-err]", form);
    var send = $("[data-dm-send]", form);

    function updateCount() { count.textContent = s("formCount", { n: body.value.length, max: BODY_MAX }); }
    function showErr(text) { err.textContent = text; err.hidden = !text; }
    updateCount();

    toggle.addEventListener("click", function () { openForm(kind, form.hidden); });
    $("[data-dm-cancel]", form).addEventListener("click", function () { showErr(""); openForm(kind, false); });
    body.addEventListener("input", updateCount);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var t = title.value.trim(), b = body.value.trim(), v = version ? version.value.trim() : "";
      if (!t || t.length > TITLE_MAX) return showErr(s("err_title"));
      if (!b || b.length > BODY_MAX) return showErr(s("err_body"));
      if (JWT_SHAPE.test(t + " " + b + " " + v)) return showErr(s("err_credential_shaped"));
      showErr("");

      var payload = { app: APP, kind: kind, title: t, body: b, source: "web" };
      if (v) payload.meta = { version: v };
      send.disabled = true;
      send.textContent = s("formSending");
      api("support", "POST", "/posts", payload).then(function (res) {
        send.disabled = false;
        send.textContent = s("formSend");
        if (res.status !== 201 || !res.data || !res.data.code) return showErr(errText(res));
        remember({ code: res.data.code, kind: kind, title: t });
        form.reset();
        updateCount();
        openForm(kind, false);
        toast("success", s("sentToast"));
        location.hash = "t=" + res.data.code;
      });
    });
  }

  // ── Your posts ─────────────────────────────────────────────────
  // No contact details, so a lost code is a lost thread. This browser keeps
  // the codes it sent or opened (support.md, "Intake").
  function readMine() {
    return readJSON(LS_MINE, []).filter(function (x) { return x && typeof x.code === "string"; });
  }
  function remember(entry) {
    var list = readMine().filter(function (x) { return x.code !== entry.code; });
    list.unshift({ code: entry.code, kind: entry.kind, title: entry.title, at: Math.floor(Date.now() / 1000) });
    writeJSON(LS_MINE, list.slice(0, 50));
    renderMine();
  }
  function renderMine() {
    var box = $("[data-dm-mine]");
    var list = $("[data-dm-mine-list]");
    var items = readMine();
    list.textContent = "";
    box.hidden = !items.length;
    items.forEach(function (m) {
      var li = el("li", "dm-mine__item");
      li.appendChild(chip(s("ticketKind_" + m.kind)));
      var a = el("a", "dm-link", m.title);
      a.href = "#t=" + m.code;
      li.appendChild(a);
      var forget = el("button", "dm-textbtn", s("mineForget"));
      forget.type = "button";
      forget.setAttribute("aria-label", s("mineForgetAria", { title: m.title }));
      forget.addEventListener("click", function () {
        writeJSON(LS_MINE, readMine().filter(function (x) { return x.code !== m.code; }));
        renderMine();
      });
      li.appendChild(forget);
      list.appendChild(li);
    });
  }

  // ── A ticket (#t=<code>) ───────────────────────────────────────
  var ticketCode = null;

  function showTicket(code) {
    ticketCode = code;
    $("[data-dm-home]").hidden = true;
    $("[data-dm-ticket]").hidden = false;
    window.scrollTo(0, 0);
    loadTicket(code);
  }
  function hideTicket() {
    ticketCode = null;
    $("[data-dm-ticket]").hidden = true;
    $("[data-dm-home]").hidden = false;
  }

  function loadTicket(code) {
    var body = $("[data-dm-ticket-body]");
    var thread = $("[data-dm-thread]");
    body.textContent = "";
    body.appendChild(el("p", "dm-empty", s("ticketLoading")));
    thread.hidden = true;

    api("support", "GET", "/t/" + code).then(function (res) {
      if (ticketCode !== code) return;
      body.textContent = "";
      if (res.status === 404) { body.appendChild(el("p", "dm-empty", s("ticketMissing"))); return; }
      if (!res.ok || !res.data || !res.data.post) { body.appendChild(el("p", "dm-empty", s("ticketFailed"))); return; }
      renderTicket(res.data.post, Array.isArray(res.data.replies) ? res.data.replies : []);
    });
  }

  function renderTicket(post, replies) {
    var body = $("[data-dm-ticket-body]");
    remember({ code: post.code, kind: post.kind, title: post.title });

    var chips = el("div", "dm-ticket__chips");
    chips.appendChild(chip(s("ticketKind_" + post.kind)));
    chips.appendChild(chip(s("state_" + post.state), post.state));
    chips.appendChild(chip(s(post.public ? "ticketPublic" : "ticketPrivate")));
    body.appendChild(chips);

    body.appendChild(el("h2", "dm-ticket__title", post.title));
    var meta = [s("ticketSent", { date: fmtUnix(post.created_at) })];
    if (post.updated_at && post.updated_at !== post.created_at) meta.push(s("ticketUpdated", { date: fmtUnix(post.updated_at) }));
    var version = parseVersion(post.meta);
    if (version) meta.push(s("ticketVersion", { v: version }));
    body.appendChild(el("p", "dm-ticket__meta", meta.join(" · ")));
    body.appendChild(el("p", "dm-ticket__body", post.body));

    var keep = el("div", "dm-keep");
    keep.appendChild(el("p", "dm-hint", s("ticketKeep")));
    var copy = el("button", "home__cta home__cta--soft", s("ticketCopy"));
    copy.type = "button";
    copy.addEventListener("click", function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(location.href).then(function () { toast("success", s("ticketCopied")); });
    });
    keep.appendChild(copy);
    body.appendChild(keep);

    var list = $("[data-dm-replies]");
    list.textContent = "";
    if (!replies.length) list.appendChild(el("li", "dm-empty", s("repliesEmpty")));
    replies.forEach(function (r) {
      var li = el("li", "dm-reply" + (r.author === "owner" ? " is-owner" : ""));
      var who = el("div", "dm-reply__who");
      who.appendChild(el("span", "dm-reply__name", s(r.author === "owner" ? "authorOwner" : "authorReporter")));
      who.appendChild(el("span", null, fmtUnix(r.created_at)));
      li.appendChild(who);
      li.appendChild(el("p", "dm-reply__body", r.body));
      list.appendChild(li);
    });
    $("[data-dm-thread]").hidden = false;
  }

  function parseVersion(meta) {
    if (!meta) return "";
    try {
      var m = typeof meta === "string" ? JSON.parse(meta) : meta;
      return m && typeof m.version === "string" ? m.version : "";
    } catch (e) { return ""; }
  }

  function wireReply() {
    var form = $("[data-dm-reply]");
    var body = field(form, "body");
    var err = $("[data-dm-err]", form);
    var send = $("[data-dm-send]", form);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var code = ticketCode;
      var b = body.value.trim();
      if (!code) return;
      if (!b || b.length > BODY_MAX) { err.textContent = s("err_body"); err.hidden = false; return; }
      if (JWT_SHAPE.test(b)) { err.textContent = s("err_credential_shaped"); err.hidden = false; return; }
      err.hidden = true;
      send.disabled = true;
      api("support", "POST", "/t/" + code + "/replies", { body: b }).then(function (res) {
        send.disabled = false;
        if (res.status !== 201) { err.textContent = errText(res); err.hidden = false; return; }
        form.reset();
        toast("success", s("replySent"));
        if (ticketCode === code) loadTicket(code);
      });
    });
  }

  // ── Routing (fragment only) ────────────────────────────────────
  function route() {
    var h = location.hash.replace(/^#/, "");
    var m = /^t=([A-Za-z0-9_-]{8,32})$/.exec(h);
    if (m) { showTicket(m[1]); return; }
    hideTicket();
    if (h === "report" || h === "suggest") {
      var kind = h === "report" ? "issue" : "suggestion";
      openForm(kind, true);
      $('[data-dm-board="' + kind + '"]').scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
    }
  }

  // ── Boot ───────────────────────────────────────────────────────
  fillStatic();
  $all("[data-dm-form]").forEach(wireForm);
  wireReply();
  renderMine();
  loadStatus();
  loadReleases();
  loadBoard("suggestion");
  loadBoard("issue");
  window.addEventListener("hashchange", route);
  route();
})();
