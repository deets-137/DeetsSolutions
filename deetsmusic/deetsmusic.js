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
  var LS_INTEREST = "deets-dm-interest";  // [code] — posts (suggestions or issues) this browser +1'd
  var JWT_SHAPE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;   // mirrors the worker's second net
  var TITLE_MAX = 120, BODY_MAX = 4000;
  var TITLE_WORDS = 10;   // "Bug / Request in 10 words" — the worker enforces it too
  var STRIP_CELLS = 72;   // the worker's status window: 6 h of 5-minute checks
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
  function api(host, method, path, body, opts) {
    if (MOCK) return MOCK.request(host, method, path, body);
    var init = { method: method };
    if (opts && opts.owner) init.credentials = "include";   // the owner routes read ds_sess
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
  function fmtNumericDay(iso) {   // 9/14/2026 — the install box's version line
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  function fmtUnix(t) {
    return new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtUnixNumeric(t) {   // 9/14/2026 — the ticket's Submitted / Updated line
    return new Date(t * 1000).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
  }
  function fmtClock(t) {
    return new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function mb(bytes) { return (bytes / 1048576).toFixed(1); }

  function fillStatic() {
    $all("[data-s]").forEach(function (n) { n.textContent = s(n.getAttribute("data-s")); });
    $all("[data-s-ph]").forEach(function (n) { n.setAttribute("placeholder", s(n.getAttribute("data-s-ph"))); });
    // icon-only buttons: the string is their accessible name and hover tip
    $all("[data-s-label]").forEach(function (n) {
      var text = s(n.getAttribute("data-s-label"));
      n.setAttribute("aria-label", text);
      n.title = text;
    });
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
        $("[data-dm-status-line]").hidden = false;
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
    // The strip is the whole reading; the line only speaks when there is
    // no strip to show.
    if (!a.monitored || !checks.length) {
      line.textContent = s(a.monitored ? "statusEmpty" : "statusUnmonitored");
      line.hidden = false;
      strip.hidden = legend.hidden = true;
      return;
    }
    line.hidden = true;
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
    layoutStrip(strip);
    if (!strip._observed && window.ResizeObserver) {
      new ResizeObserver(function () { layoutStrip(strip); }).observe(strip);
      strip._observed = true;
    }
  }

  // Equal cells AND equal gaps, at whole DEVICE pixels. 72 cells rarely
  // divide the width exactly, and any leftover pixel put into a cell or a
  // gap reads as unevenness. So the leftover is split into an even inset at
  // both ends, and the legend takes the same inset so its labels still sit
  // over the first and last cell.
  function layoutStrip(strip) {
    var cells = strip.children, n = cells.length;
    if (!n || !strip.clientWidth) return;
    var dpr = window.devicePixelRatio || 1;
    var total = Math.floor(strip.clientWidth * dpr);
    var gap = Math.max(1, Math.round((parseFloat(getComputedStyle(strip).columnGap) || 0) * dpr));
    var w = Math.max(1, Math.floor((total - gap * (n - 1)) / n));
    var pad = Math.max(0, Math.floor((total - (w * n + gap * (n - 1))) / 2));
    for (var i = 0; i < n; i++) {
      cells[i].style.left = (pad + i * (w + gap)) / dpr + "px";
      cells[i].style.width = w / dpr + "px";
    }
    var legend = $("[data-dm-strip-legend]");
    if (legend) legend.style.paddingInline = pad / dpr + "px";
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
      if (versionPick) {
        versionPick.setVersions(d.releases
          .filter(function (r) { return r.url && !r.withdrawn; })
          .map(function (r) { return r.version; }));
      }
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
    ver.textContent = s("installVersion", { v: latest.version, date: fmtNumericDay(latest.pub_date) });
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

      // The card: version line on top, the release's headliners under it.
      // A <button> may only hold phrasing content, so the lists are spans.
      var head = el("button", "dm-rel__head");
      head.type = "button";
      head.setAttribute("aria-controls", "dm-rel-" + i);
      var top = el("span", "dm-rel__top");
      top.appendChild(el("span", "dm-rel__v", r.version));
      if (latest && r.version === latest.version) top.appendChild(chip(s("tagLatest"), "latest"));
      if (r.withdrawn) top.appendChild(chip(s("tagWithdrawn"), "withdrawn"));
      else if (!r.url) top.appendChild(chip(s("tagNotesOnly")));
      top.appendChild(el("span", "dm-rel__date", r.pub_date ? fmtDay(r.pub_date) : ""));
      head.appendChild(top);
      var lines = headliners(r.notes || "");
      if (lines.length || r.url) {   // a download square needs the headliner row to sit in
        var heads = el("span", "dm-rel__heads");
        lines.forEach(function (line) { heads.appendChild(el("span", "dm-rel__headline", line)); });
        head.appendChild(heads);
      }

      var body = el("div", "dm-collapse dm-rel__body");
      body.id = "dm-rel-" + i;
      var inner = el("div", "dm-collapse__inner");
      var content = el("div", "dm-rel__content");
      inner.appendChild(content);
      body.appendChild(inner);
      if (r.withdrawn && r.withdrawn_reason) {
        content.appendChild(el("p", "dm-rel__reason", s("relWithdrawnReason", { reason: r.withdrawn_reason })));
      }
      if (r.notes) content.appendChild(renderNotes(r.notes));
      else content.appendChild(el("p", "dm-empty", s("relNoNotes")));
      // A downloadable version gets a square ↓ under the date, beside the
      // headliners. It can't live inside the head <button> (no links inside
      // buttons), so it rides the card and the headliner row leaves room.
      var dl = null;
      if (r.url) {
        var label = s("relDownload", { v: r.version, mb: r.size ? mb(r.size) : "?" });
        dl = el("a", "dm-add dm-rel__dl");
        dl.href = r.url;
        dl.setAttribute("aria-label", label);
        dl.title = label;
        dl.appendChild(downloadIcon());
        item.classList.add("has-dl");
      } else {
        content.appendChild(el("p", "dm-hint", s(r.withdrawn ? "relWithdrawn" : "relHistory")));
      }

      function setOpen(open) {
        item.classList.toggle("is-open", open);
        body.classList.toggle("is-open", open);
        body.inert = !open;   // a shut row's download link must not take Tab focus
        head.setAttribute("aria-expanded", open ? "true" : "false");
      }
      setOpen(false);   // the headliners are the surface; notes open on demand
      head.addEventListener("click", function () { setOpen(!item.classList.contains("is-open")); });

      item.appendChild(head);
      if (dl) item.appendChild(dl);
      item.appendChild(body);
      list.appendChild(item);
    });

  }

  // A down arrow drawn in currentColor, so it wears the theme's --title.
  function downloadIcon() {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M8 2.5v9M4 7.5l4 4 4-4");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.75");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  // A release's headliners: the bold lead-in of each paragraph ("**Favorites.**
  // Right-click…" → "Favorites"). A catch-all lead-in ending in a colon
  // ("**Also new:**") names nothing, so it is skipped. Notes with no bold
  // lead-in (a one-paragraph fix) fall back to their first sentence.
  function headliners(notes) {
    var paras = notes.split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
    var out = [];
    paras.forEach(function (p) {
      var m = /^\*\*([^*]+)\*\*/.exec(p);
      if (!m || /:\s*$/.test(m[1])) return;
      out.push(m[1].trim().replace(/[.!]\s*$/, ""));
    });
    if (out.length || !paras.length) return out;
    var plain = paras[0].replace(/\s*\n\s*/g, " ").replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    var first = /^(.+?[.!?])(\s|$)/.exec(plain);
    return [(first ? first[1] : plain).replace(/[.!]\s*$/, "")];
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

  // ── Owner mode ─────────────────────────────────────────────────
  // Signed in to deets.solutions as Aditya (the worker's OWNER_UID), the
  // boards list hidden posts too and every post takes a right-click menu:
  // status, hide/show, reply, delete. The worker decides who the owner is;
  // this page only asks (GET /admin/me) and never trusts itself.
  var OWNER = false;
  var POSTS = {};   // code → the post as last rendered, for the menu
  var STATE_LIST = ["new", "open", "planned", "fixed", "wontfix", "closed"];

  function ownerApi(method, path, body) { return api("support", method, path, body, { owner: true }); }

  function detectOwner() {
    if (!window.DeetsAccount) return;
    var asked = false;
    window.DeetsAccount.onChange(function (u) {
      if (u === null) return;                       // not known yet
      if (!u) { asked = false; setOwner(false); return; }
      if (asked) return;
      asked = true;
      ownerApi("GET", "/admin/me").then(function (res) {
        setOwner(!!(res.ok && res.data && res.data.owner));
      });
    });
  }
  function setOwner(yes) {
    if (yes === OWNER) return;
    OWNER = yes;
    ROOT.classList.toggle("is-owner", yes);
    closeMenu();
    loadBoards();
  }

  var menuEl = null;
  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
  }
  function menuOpt(label, onPick) {
    var b = el("button", "tb-pop__opt", label);
    b.type = "button";
    b.setAttribute("role", "menuitem");
    if (onPick) b.addEventListener("click", onPick);
    return b;
  }
  function openMenu(p, x, y) {
    closeMenu();
    var menu = el("div", "tb-pop dm-menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", s("menuAria", { title: p.title }));

    menu.appendChild(el("div", "tb-pop__head", s("menuStatus")));
    STATE_LIST.forEach(function (st) {
      var b = menuOpt(s("state_" + st), function () { ownerAct(p, "PATCH", { state: st }); });
      if (st === p.state) b.classList.add("is-active");
      menu.appendChild(b);
    });
    menu.appendChild(el("div", "dm-menu__sep"));
    menu.appendChild(menuOpt(s(p.public === false ? "menuShow" : "menuHide"), function () {
      ownerAct(p, "PATCH", { public: p.public === false });
    }));
    menu.appendChild(menuOpt(s("menuReply"), function () { closeMenu(); location.hash = "t=" + p.code; }));
    // Delete is two clicks: the first arms it and says so.
    var del = menuOpt(s("menuDelete"));
    del.classList.add("dm-menu__danger");
    del.addEventListener("click", function () {
      if (!del.hasAttribute("data-armed")) {
        del.setAttribute("data-armed", "");
        del.textContent = s("menuDeleteConfirm");
        return;
      }
      ownerAct(p, "DELETE");
    });
    menu.appendChild(del);

    document.body.appendChild(menu);
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + "px";
    menuEl = menu;
    var first = $(".tb-pop__opt", menu);
    if (first) first.focus({ preventScroll: true });
  }
  function ownerAct(p, method, body) {
    closeMenu();
    ownerApi(method, "/admin/posts/" + p.code, body).then(function (res) {
      if (!res.ok) { toast("error", errText(res)); return; }
      loadBoards();
    });
  }
  function wireOwnerMenu() {
    $all("[data-dm-list]").forEach(function (list) {
      list.addEventListener("contextmenu", function (e) {
        if (!OWNER) return;
        var item = e.target.closest(".dm-post");
        var p = item && POSTS[item.getAttribute("data-code")];
        if (!p) return;
        e.preventDefault();
        openMenu(p, e.clientX, e.clientY);
      });
    });
    document.addEventListener("pointerdown", function (e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });
    window.addEventListener("scroll", closeMenu, true);   // capture: a board list scrolling counts
    window.addEventListener("resize", closeMenu);
  }

  // ── Boards ─────────────────────────────────────────────────────
  var EMPTY = { suggestion: "suggestEmpty", issue: "issuesEmpty" };
  var KINDS = ["suggestion", "issue"];

  // One request fills both boards (2026-09-14 — it was one per board). A
  // board shows "Loading…" only before its first answer; a reload after an
  // edit swaps the list in place. A newer load supersedes an older one.
  var boardSeq = 0;
  function loadBoards() {
    var seq = ++boardSeq;
    KINDS.forEach(function (kind) {
      if (BOARD_DATA[kind]) return;
      var list = $('[data-dm-list="' + kind + '"]');
      list.textContent = "";
      list.appendChild(el("p", "dm-empty", s("boardLoading")));
    });
    var req = OWNER
      ? ownerApi("GET", "/admin/posts?app=" + APP)
      : api("support", "GET", "/posts?app=" + APP);
    req.then(function (res) {
      if (seq !== boardSeq) return;
      var posts = res.ok && res.data && res.data.posts;
      KINDS.forEach(function (kind) {
        if (!Array.isArray(posts)) {
          BOARD_DATA[kind] = null;
          var list = $('[data-dm-list="' + kind + '"]');
          list.textContent = "";
          list.appendChild(el("p", "dm-empty", s("boardFailed")));
          return;
        }
        BOARD_DATA[kind] = posts.filter(function (p) { return p.kind === kind; });
        renderBoard(kind);
      });
    });
  }

  // ── Board toolbars: Filter + Sort, for everyone ────────────────
  // The journals' pill + popover kit (sotd.js / league.js; docs/architecture.md,
  // "Toolbar / popover kit"), copied here the way they copy it — a fix to the
  // open/close machinery must be mirrored there. One difference: a pill's
  // popover is rebuilt each time it opens, since a board's options follow
  // its data. Filtering and sorting run on the list already loaded; each
  // board's choices persist in localStorage.
  var LS_BOARDS = "deets-dm-boards";   // { suggestion|issue: { states, versions, sort, dir } }
  var BOARD_DATA = { suggestion: null, issue: null };
  var TOOL_PILLS = { suggestion: null, issue: null };
  var boardState = (function () {
    var saved = readJSON(LS_BOARDS, {}) || {};
    function one(kind) {
      var v = saved[kind] || {};
      return {
        states: Array.isArray(v.states) ? v.states.filter(function (x) { return STATE_LIST.indexOf(x) >= 0; }) : [],
        versions: Array.isArray(v.versions) ? v.versions.filter(function (x) { return typeof x === "string"; }) : [],
        sort: v.sort === "date" ? "date" : "votes",
        dir: v.dir === "asc" ? "asc" : "desc"
      };
    }
    return { suggestion: one("suggestion"), issue: one("issue") };
  })();
  function saveBoards() { writeJSON(LS_BOARDS, boardState); }

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

  // A post's version: the bug form's pick ("all" or a release), "" when none.
  function versionKey(p) { return p.version == null ? "" : String(p.version); }
  function versionName(v) {
    if (v === "all") return s("ticketVersionAll");
    if (v === "") return s("versionUnknown");
    return s("ticketVersion", { v: v });
  }
  function cmpVersionDesc(a, b) {   // All first, newest release next, none last
    if (a === "all" || b === "") return -1;
    if (b === "all" || a === "") return 1;
    var pa = a.split("."), pb = b.split(".");
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var d = (parseInt(pb[i], 10) || 0) - (parseInt(pa[i], 10) || 0);
      if (d) return d;
    }
    return a < b ? 1 : a > b ? -1 : 0;
  }
  function filterCount(kind) {
    var st = boardState[kind];
    return st.states.length + (kind === "issue" ? st.versions.length : 0);
  }

  function facetGroup(kind, title, key, options, labelFn) {
    var st = boardState[kind];
    var group = el("div", "filter-group");
    group.appendChild(el("div", "filter-group__title", title));
    var list = el("div", "filter-group__list");
    options.forEach(function (opt) {
      var label = el("label", "filter-check");
      var input = el("input");
      input.type = "checkbox";
      input.checked = st[key].indexOf(opt) >= 0;
      input.addEventListener("change", function () {
        var i = st[key].indexOf(opt);
        if (input.checked && i < 0) st[key].push(opt);
        else if (!input.checked && i >= 0) st[key].splice(i, 1);
        saveBoards();
        renderBoard(kind);
      });
      label.appendChild(input);
      label.appendChild(el("span", "filter-check__name", labelFn(opt)));
      list.appendChild(label);
    });
    group.appendChild(list);
    return group;
  }

  function fillFilterPop(kind, pop) {
    var st = boardState[kind];
    pop.classList.add("tb-pop--filter");
    pop.textContent = "";
    pop.appendChild(facetGroup(kind, s("filterStatus"), "states", STATE_LIST, function (x) { return s("state_" + x); }));
    if (kind === "issue") {
      // The versions the loaded bugs carry, plus any still ticked from before.
      var seen = {};
      (BOARD_DATA.issue || []).forEach(function (p) { seen[versionKey(p)] = true; });
      st.versions.forEach(function (v) { seen[v] = true; });
      var versions = Object.keys(seen).sort(cmpVersionDesc);
      if (versions.length) pop.appendChild(facetGroup(kind, s("filterVersion"), "versions", versions, versionName));
    }
    var foot = el("div", "filter-foot");
    var clear = el("button", "filter-clear", s("filterClear"));
    clear.type = "button";
    clear.addEventListener("click", function () {
      st.states = [];
      st.versions = [];
      saveBoards();
      fillFilterPop(kind, pop);
      renderBoard(kind);
    });
    foot.appendChild(clear);
    pop.appendChild(foot);
  }

  function fillSortPop(kind, pop) {
    var st = boardState[kind];
    pop.textContent = "";
    // Options stack | vertical hairline | direction rail (↑ / ↓), as SOTD's.
    pop.classList.add("tb-pop--cols");
    var main = el("div", "tb-pop__main");
    [["votes", "sortVotes"], ["date", "sortDate"]].forEach(function (o) {
      main.appendChild(optButton(s(o[1]), o[0], st.sort === o[0], function () {
        if (st.sort !== o[0]) { st.sort = o[0]; st.dir = "desc"; }
        saveBoards();
        fillSortPop(kind, pop);
        renderBoard(kind);
      }));
    });
    pop.appendChild(main);
    var rail = el("div", "tb-pop__rail");
    [["asc", "↑", "sortAsc"], ["desc", "↓", "sortDesc"]].forEach(function (d) {
      var b = el("button", "tb-pop__icon" + (st.dir === d[0] ? " is-active" : ""), d[1]);
      b.type = "button";
      b.title = s(d[2]);
      b.setAttribute("aria-label", s(d[2]));
      b.addEventListener("click", function () {
        st.dir = d[0];
        saveBoards();
        fillSortPop(kind, pop);
        renderBoard(kind);
      });
      rail.appendChild(b);
    });
    pop.appendChild(rail);
  }

  function wireBoardTools(kind) {
    var host = $('[data-dm-tools="' + kind + '"]');
    if (!host) return;
    var filter = makePill(host, s("filterPill"), function (pop) { fillFilterPop(kind, pop); });
    var sort = makePill(host, s("sortPill"), function (pop) { fillSortPop(kind, pop); });
    // Both pills wear their pick: "Filter | Open, V0.4.3", "Sort | Votes ↓".
    function wear(entry) {
      var v = el("span", "tb-pill__value");
      entry.pill.insertBefore(v, entry.pill.querySelector(".tb-pill__caret"));
      return v;
    }
    TOOL_PILLS[kind] = { filter: filter, filterValue: wear(filter), sortValue: wear(sort) };
    paintTools(kind);
  }
  function paintTools(kind) {
    var t = TOOL_PILLS[kind], st = boardState[kind];
    if (!t) return;
    var picks = st.states.map(function (x) { return s("state_" + x); });
    if (kind === "issue") picks = picks.concat(st.versions.slice().sort(cmpVersionDesc).map(versionName));
    t.filter.pill.classList.toggle("is-active", picks.length > 0);
    t.filterValue.textContent = picks.length ? picks.join(", ") : s("filterNone");
    t.filter.pill.title = picks.length ? picks.join(", ") : "";   // the full list when it ellipsizes
    t.sortValue.textContent = s(st.sort === "date" ? "sortDate" : "sortVotes") + " " + (st.dir === "asc" ? "↑" : "↓");
  }

  function renderBoard(kind) {
    var list = $('[data-dm-list="' + kind + '"]');
    var posts = BOARD_DATA[kind];
    paintTools(kind);
    if (!posts) return;
    var st = boardState[kind];
    var shown = posts.filter(function (p) {
      if (st.states.length && st.states.indexOf(p.state) < 0) return false;
      if (kind === "issue" && st.versions.length && st.versions.indexOf(versionKey(p)) < 0) return false;
      return true;
    });
    var sign = st.dir === "asc" ? 1 : -1;
    shown.sort(function (a, b) {
      var d = st.sort === "date"
        ? a.created_at - b.created_at
        : (a.interest - b.interest) || (a.created_at - b.created_at);
      return d * sign;
    });
    list.textContent = "";
    if (!posts.length) list.appendChild(el("p", "dm-empty", s(EMPTY[kind])));
    else if (!shown.length) list.appendChild(el("p", "dm-empty", s("boardNoMatch")));
    else shown.forEach(function (p) { list.appendChild(renderPost(p)); });
  }

  function renderPost(p) {
    var item = el("article", "dm-post");
    item.setAttribute("data-code", p.code);
    POSTS[p.code] = p;
    item.appendChild(interestButton(p));

    var main = el("div", "dm-post__main");
    var head = el("div", "dm-post__head");
    head.appendChild(el("h3", "dm-post__title", p.title));
    head.appendChild(chip(s("state_" + p.state), p.state));
    if (p.public === false) {                     // only the owner's list carries hidden posts
      item.classList.add("is-hidden-post");
      head.appendChild(chip(s("tagHidden"), "hidden"));
    }
    main.appendChild(head);
    var text = el("p", "dm-post__body", p.body);
    main.appendChild(text);

    var foot = el("div", "dm-post__foot");
    foot.appendChild(el("span", null, fmtUnix(p.created_at)));
    if (p.body.length > 180 || p.body.indexOf("\n") >= 0) {
      var more = el("button", "dm-textbtn", s("postMore"));
      more.type = "button";
      more.setAttribute("aria-expanded", "false");
      more.addEventListener("click", function () {
        var open = !item.classList.contains("is-expanded") || item.hasAttribute("data-closing");
        animateClamp(item, text, open);
        more.textContent = s(open ? "postLess" : "postMore");
        more.setAttribute("aria-expanded", open ? "true" : "false");
      });
      foot.appendChild(more);
    }
    main.appendChild(foot);
    item.appendChild(main);
    return item;
  }

  // "More" grows a post's three-line clamp to its full height and back.
  // line-clamp itself can't animate, so max-height carries the motion and
  // the clamp returns only once a collapse has finished.
  function animateClamp(item, text, open) {
    if (REDUCED) {
      item.classList.toggle("is-expanded", open);
      return;
    }
    var from = text.getBoundingClientRect().height;
    item.classList.add("is-expanded");            // unclamped, so scrollHeight is the full text
    var to = open ? text.scrollHeight : parseFloat(getComputedStyle(text).lineHeight) * 3;
    if (open) item.removeAttribute("data-closing"); else item.setAttribute("data-closing", "");
    text.style.maxHeight = from + "px";
    text.getBoundingClientRect();                 // commit the start height before the change
    text.style.maxHeight = to + "px";
    afterTransition(text, function () {
      text.style.maxHeight = "";
      if (!open && item.hasAttribute("data-closing")) {
        item.classList.remove("is-expanded");
        item.removeAttribute("data-closing");
      }
    });
  }
  function afterTransition(node, fn) {
    var done = false;
    function finish(e) {
      if (done || (e && e.target !== node)) return;
      done = true;
      node.removeEventListener("transitionend", finish);
      fn();
    }
    node.addEventListener("transitionend", finish);
    setTimeout(finish, 700);                      // a skipped transition must still settle
  }

  // Interest is a signal, not a vote (support.md): the worker counts every
  // +1, so this browser's list of codes is what stops a double-click. On a
  // suggestion it reads as "I want this"; on an issue, "this affects me too".
  // Clicking it again takes the +1 back (undo: true).
  function interestButton(p) {
    var sfx = p.kind === "issue" ? "_issue" : "";
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
      b.title = s((done ? "interestDone" : "interestLabel") + sfx);
      b.setAttribute("aria-label", s("interestAria" + sfx, { n: n.textContent }));
    }
    paint();

    b.addEventListener("click", function () {
      if (b.disabled) return;
      b.disabled = true;
      var undo = done;
      api("support", "POST", "/interest", undo ? { code: p.code, undo: true } : { code: p.code }).then(function (res) {
        b.disabled = false;
        if (!res.ok) { toast("error", errText(res)); return; }
        done = !undo;
        var list = readJSON(LS_INTEREST, []).filter(function (c) { return c !== p.code; });
        if (done) list.push(p.code);
        writeJSON(LS_INTEREST, list.slice(-500));
        if (res.data && res.data.interest != null) {
          n.textContent = String(res.data.interest);
          p.interest = res.data.interest;   // so the next Sort by votes uses the new count
        }
        paint();
      });
    });
    return b;
  }

  // ── Post forms ─────────────────────────────────────────────────
  function field(form, name) { return form.elements.namedItem(name); }
  function wordCount(v) { return (v.match(/\S+/g) || []).length; }
  // Cut v just before its (n+1)th word, so typing or pasting past the cap
  // stops at the cap instead of erroring on Send.
  function capWords(v, n) {
    var re = /\S+/g, m, k = 0;
    while ((m = re.exec(v))) {
      if (++k > n) return v.slice(0, m.index).replace(/\s+$/, "");
    }
    return v;
  }

  function formIsOpen(kind) {
    return $('[data-dm-collapse="' + kind + '"]').classList.contains("is-open");
  }
  function openForm(kind, open) {
    var wrap = $('[data-dm-collapse="' + kind + '"]');
    var form = $('[data-dm-form="' + kind + '"]');
    var toggle = $('[data-dm-open="' + kind + '"]');
    wrap.classList.toggle("is-open", open);
    wrap.classList.remove("is-settled");
    wrap.inert = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (kind === "issue" && versionPick) versionPick.close();
    // The collapse clips while it animates; once fully open it stops
    // clipping, so the version popover can hang past the form's edge.
    if (open) {
      afterTransition(wrap, function () { if (wrap.classList.contains("is-open")) wrap.classList.add("is-settled"); });
      field(form, "title").focus({ preventScroll: true });
    }
  }

  // ── Version picker (bug form) ──────────────────────────────────
  // A tb- pill + popover. The choices are "All" plus every version the
  // updater still serves (has a download, not withdrawn), newest first;
  // it defaults to the newest, since the updater keeps most people there.
  var versionPick = null;
  function wireVersionPick() {
    var ctrl = $("[data-dm-version]");
    if (!ctrl) return;
    var pill = $(".tb-pill", ctrl), value = $(".tb-pill__value", ctrl), pop = $(".tb-pop", ctrl);
    var versions = [], current = "all";

    function label(v) { return v === "all" ? s("versionAll") : v; }
    function close() { pop.hidden = true; pill.setAttribute("aria-expanded", "false"); }
    function paint() {
      value.textContent = label(current);
      pop.textContent = "";
      ["all"].concat(versions).forEach(function (v) {
        var b = el("button", "tb-pop__opt" + (v === current ? " is-active" : ""), label(v));
        b.type = "button";
        b.setAttribute("role", "menuitemradio");
        b.setAttribute("aria-checked", v === current ? "true" : "false");
        b.addEventListener("click", function () { current = v; paint(); close(); pill.focus(); });
        pop.appendChild(b);
      });
    }

    pill.addEventListener("click", function () {
      var opening = pop.hidden;
      pop.hidden = !opening;
      pill.setAttribute("aria-expanded", opening ? "true" : "false");
    });
    document.addEventListener("click", function (e) { if (!ctrl.contains(e.target)) close(); });
    ctrl.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !pop.hidden) { e.stopPropagation(); close(); pill.focus(); }
    });
    paint();

    versionPick = {
      value: function () { return current; },
      close: close,
      reset: function () { current = versions[0] || "all"; paint(); },
      setVersions: function (list) { versions = list; current = list[0] || "all"; paint(); }
    };
  }

  function wireForm(form) {
    var kind = form.getAttribute("data-dm-form");
    var toggle = $('[data-dm-open="' + kind + '"]');
    var title = field(form, "title");
    var body = field(form, "body");
    var count = $("[data-dm-count]", form);
    var err = $("[data-dm-err]", form);
    var send = $("[data-dm-send]", form);

    function updateCount() { count.textContent = s("formCount", { n: body.value.length, max: BODY_MAX }); }
    function showErr(text) { err.textContent = text; err.hidden = !text; }
    updateCount();

    toggle.addEventListener("click", function () { openForm(kind, !formIsOpen(kind)); });
    $("[data-dm-cancel]", form).addEventListener("click", function () { showErr(""); openForm(kind, false); });
    body.addEventListener("input", updateCount);
    title.addEventListener("input", function () {
      var capped = capWords(title.value, TITLE_WORDS);
      if (capped !== title.value) title.value = capped;
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var t = title.value.trim(), b = body.value.trim(), v = kind === "issue" && versionPick ? versionPick.value() : "";
      if (!t || t.length > TITLE_MAX) return showErr(s("err_title"));
      if (wordCount(t) > TITLE_WORDS) return showErr(s("err_title_words"));
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
        if (kind === "issue" && versionPick) versionPick.reset();
        updateCount();
        openForm(kind, false);
        toast("success", s("sentToast"));
        loadBoards();   // the write already dropped this colo's cached list
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
      // Close is two clicks: the first arms it and says so. Closing sets the
      // post's state to closed on the worker (the code is the credential),
      // then drops it from this list. A post already deleted just drops.
      var close = el("button", "dm-textbtn", s("mineClose"));
      close.type = "button";
      close.setAttribute("aria-label", s("mineCloseAria", { title: m.title }));
      close.addEventListener("click", function () {
        if (close.disabled) return;
        if (!close.hasAttribute("data-armed")) {
          close.setAttribute("data-armed", "");
          close.textContent = s("mineCloseConfirm");
          return;
        }
        close.disabled = true;
        api("support", "POST", "/t/" + m.code + "/close").then(function (res) {
          close.disabled = false;
          if (!res.ok && res.status !== 404) { toast("error", errText(res)); return; }
          writeJSON(LS_MINE, readMine().filter(function (x) { return x.code !== m.code; }));
          renderMine();
          toast("success", s("closedToast"));
          loadBoards();
        });
      });
      li.appendChild(close);
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
    if (!OWNER) remember({ code: post.code, kind: post.kind, title: post.title });   // the owner's visits aren't "your posts"

    var chips = el("div", "dm-ticket__chips");
    chips.appendChild(chip(s("ticketKind_" + post.kind)));
    chips.appendChild(chip(s("state_" + post.state), post.state));
    chips.appendChild(chip(s(post.public ? "ticketPublic" : "ticketPrivate")));
    body.appendChild(chips);

    body.appendChild(el("h2", "dm-ticket__title", post.title));
    var meta = [s("ticketSent", { date: fmtUnixNumeric(post.created_at) })];
    if (post.updated_at && post.updated_at !== post.created_at) meta.push(s("ticketUpdated", { date: fmtUnixNumeric(post.updated_at) }));
    var version = parseVersion(post.meta);
    if (version) meta.push(version === "all" ? s("ticketVersionAll") : s("ticketVersion", { v: version }));
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
      var sent = OWNER
        ? ownerApi("POST", "/admin/posts/" + code + "/replies", { body: b })   // replies as Aditya
        : api("support", "POST", "/t/" + code + "/replies", { body: b });
      sent.then(function (res) {
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
    if (h === "report" || h === "suggest") openBoard(h);
  }
  function openBoard(h) {
    var kind = h === "report" ? "issue" : "suggestion";
    openForm(kind, true);
    $('[data-dm-board="' + kind + '"]').scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
  }
  // The page bar's Suggestions / Bug! buttons open their form on EVERY click.
  // Left to the hash alone, a second click on the same #report fires no
  // hashchange and does nothing. From a ticket they still change the hash,
  // so route() leaves the ticket first.
  function wireBoardLinks() {
    $all('a[href="#report"], a[href="#suggest"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        if (ticketCode) return;
        e.preventDefault();
        openBoard(a.getAttribute("href").slice(1));
      });
    });
  }

  // ── Boot ───────────────────────────────────────────────────────
  fillStatic();
  wireVersionPick();
  wireOwnerMenu();
  $all("[data-dm-form]").forEach(wireForm);
  wireReply();
  renderMine();
  loadStatus();
  loadReleases();
  wireBoardTools("suggestion");
  wireBoardTools("issue");
  loadBoards();
  detectOwner();
  wireBoardLinks();
  window.addEventListener("hashchange", route);
  route();
})();
