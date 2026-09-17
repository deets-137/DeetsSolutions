/* DeetsMusic — the Windows app's front door (docs/support.md, "The page").

   DRAFT 2026-09-14. Layout and every string are Claude's first pass;
   Aditya leads this page's design. Copy lives in strings.js ([ph] only).

   Data sources (all anonymous, no sign-in):
     music-api.deets.solutions  GET /update/deetsmusic/releases  install box + release notes
     support.deets.solutions    GET /status, GET/POST /posts, GET /p/<pid>,
                                POST /p/<pid>/comments, GET /t/<code>,
                                POST /t/<code>/replies, POST /interest

   ?mock swaps both for deetsmusic/mock.js (same response shapes), because
   the releases route is not deployed yet and the boards are empty.

   Two rules from support.md this file keeps:
   - A ticket code is a credential. It rides the URL FRAGMENT (#t=<code>),
     never the query, so it never reaches a server log or a Referer. A board
     never carries one: a public post arrives with its `pid` instead, which
     reads and votes and nothing more (support.md, "Threads"). Only "Your
     posts", a #t= page and the owner's list hold codes.
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
  // [pid] — posts (suggestions or issues) this browser +1'd. Held codes before
  // the id split (2026-09-15); those entries just go stale, so the first ▲ after
  // it is free. A signal, not a ballot — see interestButton.
  var LS_INTEREST = "deets-dm-interest";
  // false once the visitor shuts the newest release on the release notes; open otherwise.
  var LS_LATEST_OPEN = "deets-dm-latest-open";
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
    // The routes that read ds_sess: the owner's, and a comment's account.
    if (opts && opts.creds) init.credentials = "include";
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
    renderBrowserSteps();
    wireWhy();
  }

  // The ⓘ beside the signed line opens and closes the "why the warning" note,
  // with the boards' collapse motion (.dm-collapse; reduced motion snaps).
  // A closed note is inert, so its text is out of the tab order.
  function wireWhy() {
    var btn = $("[data-dm-why]");
    var note = $("[data-dm-why-note]");
    if (!btn || !note) return;
    btn.addEventListener("click", function () {
      var open = !note.classList.contains("is-open");
      note.classList.toggle("is-open", open);
      note.inert = !open;
      btn.setAttribute("aria-expanded", String(open));
    });
  }

  // ── Install: the browser warning steps (support.md, "The page") ──
  // Only the visitor's own browser's line shows, with "Other browsers" at its
  // end; the button reveals the rest. Edge's user-agent also says Chrome, so
  // Edg/ is tested first. An unknown browser sees all three and no button.
  function browserId() {
    var ua = navigator.userAgent || "";
    if (/Edg\//.test(ua)) return "edge";
    if (/Firefox\//.test(ua)) return "firefox";
    if (/Chrome\//.test(ua)) return "chrome";
    return null;
  }
  function renderBrowserSteps() {
    var box = $("[data-dm-steps]");
    if (!box) return;
    var mine = browserId();
    var lines = $all("[data-dm-browser]", box);
    var more = $("[data-dm-other-browsers]", box);
    if (!mine) {
      lines.forEach(function (n) { n.hidden = false; });
      if (more) more.hidden = true;
      return;
    }
    lines.forEach(function (n) { n.hidden = n.getAttribute("data-dm-browser") !== mine; });
    if (!more) return;
    var own = lines.filter(function (n) { return n.getAttribute("data-dm-browser") === mine; })[0];
    if (own) {
      own.appendChild(document.createTextNode(" "));
      own.appendChild(more);   // inline, at the end of the visitor's own steps
    }
    more.hidden = false;
    more.addEventListener("click", function () {
      lines.forEach(function (n) { n.hidden = false; });
      more.hidden = true;
    });
  }

  // ── Status ─────────────────────────────────────────────────────
  // One row per checked service (support.md, "The page"). Each row's
  // data-dm-status-row is its app id in the worker's apps table: the
  // Gatekeeper (APP, music-api /health — the token mint) and the installer
  // (/update/deetsmusic/health). Every row has its own dot, word and strip;
  // the remote notice rides APP's row only.
  function loadStatus() {
    $all("[data-dm-status-row]").forEach(function (row) {
      var id = row.getAttribute("data-dm-status-row");
      api("support", "GET", "/status?app=" + encodeURIComponent(id)).then(function (res) {
        var a = res.ok && res.data && res.data.apps && res.data.apps[0];
        if (!a) {
          paintStatusWord(row, "unknown");
          var failed = $("[data-dm-status-line]", row);
          failed.textContent = s("statusFailed");
          failed.hidden = false;
          return;
        }
        if (id === APP) showNotice(a.notice);
        renderStatus(row, a);
      });
    });
  }
  function paintStatusWord(row, state) {
    $("[data-dm-status-dot]", row).setAttribute("data-state", state);
    $("[data-dm-status-word]", row).textContent = s("status_" + state);
  }
  function renderStatus(row, a) {
    var checks = Array.isArray(a.checks) ? a.checks : [];
    var line = $("[data-dm-status-line]", row);
    var strip = $("[data-dm-strip]", row);
    var legend = $("[data-dm-strip-legend]", row);
    paintStatusWord(row, a.status);

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
    layoutStrip(strip, legend);
    if (!strip._observed && window.ResizeObserver) {
      new ResizeObserver(function () { layoutStrip(strip, legend); }).observe(strip);
      strip._observed = true;
    }
  }

  // Equal cells AND equal gaps, at whole DEVICE pixels. 72 cells rarely
  // divide the width exactly, and any leftover pixel put into a cell or a
  // gap reads as unevenness. So the leftover is split into an even inset at
  // both ends, and the legend takes the same inset so its labels still sit
  // over the first and last cell.
  function layoutStrip(strip, legend) {
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

  // Release notes (reworked 2026-09-16). Every release reads the same way
  // once open: its changes' headliners down the left, the chosen change's
  // notes on the right (renderFeatures). The newest release leads, open by
  // default and collapsible, and the visitor's pick sticks (LS_LATEST_OPEN).
  // Earlier releases are a row of cards, side by side like a poll's options;
  // a card opens its release under the row, and a second click shuts it.
  function renderReleases(rows, latest) {
    var list = $("[data-dm-releases]");
    list.textContent = "";
    if (!rows.length) {
      list.appendChild(el("p", "dm-empty", s("releasesEmpty")));
      return;
    }
    list.appendChild(renderLatest(rows[0], latest));
    if (rows.length > 1) list.appendChild(renderEarlier(rows.slice(1), latest));
  }

  function relChips(parent, r, latest) {
    if (latest && r.version === latest.version) parent.appendChild(chip(s("tagLatest"), "latest"));
    if (r.withdrawn) parent.appendChild(chip(s("tagWithdrawn"), "withdrawn"));
    else if (!r.url) parent.appendChild(chip(s("tagNotesOnly")));
  }

  function relDownload(r, cls) {
    var label = s("relDownload", { v: r.version, mb: r.size ? mb(r.size) : "?" });
    var dl = el("a", "dm-add " + cls);
    dl.href = r.url;
    dl.setAttribute("aria-label", label);
    dl.title = label;
    dl.appendChild(downloadIcon());
    return dl;
  }

  // An open release: why it was withdrawn, its changes, and the line for a
  // version with no download.
  function relContent(content, r) {
    if (r.withdrawn && r.withdrawn_reason) {
      content.appendChild(el("p", "dm-rel__reason", s("relWithdrawnReason", { reason: r.withdrawn_reason })));
    }
    if (r.notes) content.appendChild(renderFeatures(r.notes));
    else content.appendChild(el("p", "dm-empty", s("relNoNotes")));
    if (!r.url) content.appendChild(el("p", "dm-hint", s(r.withdrawn ? "relWithdrawn" : "relHistory")));
  }

  function renderLatest(r, latest) {
    var box = el("article", "dm-spot");
    if (r.withdrawn) box.classList.add("is-withdrawn");

    var bar = el("div", "dm-spot__bar");
    var h = el("h3", "dm-spot__h");
    var head = el("button", "dm-spot__head");
    head.type = "button";
    head.setAttribute("aria-controls", "dm-spot-body");
    head.appendChild(el("span", "dm-rel__v dm-spot__v", r.version));
    relChips(head, r, latest);
    head.appendChild(el("span", "dm-rel__date", r.pub_date ? fmtDay(r.pub_date) : ""));
    h.appendChild(head);
    bar.appendChild(h);
    if (r.url) bar.appendChild(relDownload(r, "dm-spot__dl"));

    var body = el("div", "dm-collapse dm-spot__body");
    body.id = "dm-spot-body";
    var inner = el("div", "dm-collapse__inner");
    var content = el("div", "dm-spot__content");
    relContent(content, r);
    inner.appendChild(content);
    body.appendChild(inner);

    function setOpen(open) {
      box.classList.toggle("is-open", open);
      body.classList.toggle("is-open", open);
      body.inert = !open;
      head.setAttribute("aria-expanded", open ? "true" : "false");
    }
    setOpen(readJSON(LS_LATEST_OPEN, true) !== false);
    head.addEventListener("click", function () {
      var open = !box.classList.contains("is-open");
      setOpen(open);
      writeJSON(LS_LATEST_OPEN, open);
    });

    box.appendChild(bar);
    box.appendChild(body);
    return box;
  }

  var VER_TAGS = 3;   // a version card names this many changes, then "+N more"

  function renderEarlier(rows, latest) {
    var wrap = el("section", "dm-earlier");
    wrap.appendChild(el("h3", "dm-rels__earlier", s("relEarlier")));

    // Past four cards the row scrolls sideways, the poll options' rule.
    var strip = el("div", "dm-vers" + (rows.length > 4 ? " is-scroll" : ""));
    var detail = el("div", "dm-collapse dm-vers__detail");
    detail.id = "dm-vers-detail";
    var inner = el("div", "dm-collapse__inner");
    var content = el("div", "dm-vers__content");
    inner.appendChild(content);
    detail.appendChild(inner);
    detail.inert = true;

    var cards = [];
    var current = null;
    function show(card, r) {
      cards.forEach(function (c) {
        var on = c.card === card;
        c.card.classList.toggle("is-on", on);
        c.btn.setAttribute("aria-expanded", on ? "true" : "false");
      });
      current = card;
      if (!card) {
        detail.classList.remove("is-open");
        detail.inert = true;
        return;
      }
      content.textContent = "";
      var title = el("h4", "dm-vers__title");
      title.appendChild(el("span", "dm-rel__v", r.version));
      title.appendChild(el("span", "dm-rel__date", r.pub_date ? fmtDay(r.pub_date) : ""));
      content.appendChild(title);
      relContent(content, r);
      // Swapping from one open card to another: the new notes settle in.
      content.classList.remove("is-entering");
      void content.offsetWidth;
      content.classList.add("is-entering");
      detail.classList.add("is-open");
      detail.inert = false;
    }

    rows.forEach(function (r) {
      var card = el("article", "dm-ver");
      if (r.withdrawn) card.classList.add("is-withdrawn");
      var btn = el("button", "dm-ver__btn");
      btn.type = "button";
      btn.setAttribute("aria-controls", detail.id);
      btn.setAttribute("aria-expanded", "false");
      var top = el("span", "dm-ver__top");
      top.appendChild(el("span", "dm-rel__v", r.version));
      btn.appendChild(top);
      var sub = el("span", "dm-ver__sub");
      sub.appendChild(el("span", "dm-ver__date", r.pub_date ? fmtDay(r.pub_date) : ""));
      relChips(sub, r, latest);
      btn.appendChild(sub);
      var lines = headliners(r.notes || "");
      if (lines.length) {
        var heads = el("span", "dm-ver__heads");
        lines.slice(0, VER_TAGS).forEach(function (line) { heads.appendChild(el("span", "dm-rel__headline", line)); });
        if (lines.length > VER_TAGS) {
          heads.appendChild(el("span", "dm-rel__headline dm-ver__more", s("relMore", { n: lines.length - VER_TAGS })));
        }
        btn.appendChild(heads);
      }
      btn.addEventListener("click", function () { show(current === card ? null : card, r); });
      card.appendChild(btn);
      // The ↓ can't live inside the <button>; it rides the card's corner.
      if (r.url) {
        card.appendChild(relDownload(r, "dm-ver__dl"));
        card.classList.add("has-dl");
      }
      cards.push({ card: card, btn: btn });
      strip.appendChild(card);
    });

    wrap.appendChild(strip);
    wrap.appendChild(detail);
    return wrap;
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
  // Read as a list of changes, the same way headliners() reads them: a
  // paragraph with a bold lead-in is one change, titled by it; a catch-all
  // lead-in ("**Also:**") is a quieter last entry; a paragraph with no
  // lead-in (a one-paragraph fix) is titled by its first sentence.
  // Laid out as tabs: the titles down the left, the chosen change's notes on
  // the right. Every pane shares one grid cell, so the box keeps the tallest
  // pane's height and a switch cross-fades instead of jumping.
  var featSeq = 0;
  function renderFeatures(text) {
    var items = [];
    text.split(/\n\s*\n/).forEach(function (para) {
      para = para.trim().replace(/\s*\n\s*/g, " ");
      if (!para) return;
      var m = /^\*\*([^*]+)\*\*\s*/.exec(para);
      if (m && !/:\s*$/.test(m[1])) {
        items.push({ title: m[1].trim().replace(/[.!]\s*$/, ""), body: para.slice(m[0].length) });
      } else if (m) {
        items.push({ title: m[1].trim().replace(/:\s*$/, ""), body: para.slice(m[0].length), minor: true });
      } else {
        items.push({ title: headliners(para)[0] || para, body: para });
      }
    });
    if (!items.length) return el("p", "dm-empty", s("relNoNotes"));

    var id = "dm-feat-" + (featSeq++);
    var wrap = el("div", "dm-feats");
    var tabs = el("div", "dm-feats__list");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-orientation", "vertical");
    var panes = el("div", "dm-feats__panes");
    var btns = [], paneEls = [];

    items.forEach(function (it, i) {
      var b = el("button", "dm-feat" + (it.minor ? " is-minor" : ""), it.title);
      b.type = "button";
      b.id = id + "-t" + i;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-controls", id + "-p" + i);
      b.addEventListener("click", function () { select(i); });
      b.addEventListener("keydown", function (e) {
        var to = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[e.key];
        if (to == null) return;
        e.preventDefault();
        select((to + items.length) % items.length);
        btns[(to + items.length) % items.length].focus();
      });
      tabs.appendChild(b);
      btns.push(b);

      var p = el("div", "dm-feat__pane");
      p.id = id + "-p" + i;
      p.setAttribute("role", "tabpanel");
      p.setAttribute("aria-labelledby", b.id);
      p.appendChild(el("h4", "dm-feat__title", it.title));
      if (it.body) {
        var body = el("p");
        inline(it.body, body);
        p.appendChild(body);
      }
      panes.appendChild(p);
      paneEls.push(p);
    });

    function select(n) {
      btns.forEach(function (b, i) {
        var on = i === n;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
        paneEls[i].classList.toggle("is-on", on);
      });
    }
    select(0);

    wrap.appendChild(tabs);
    wrap.appendChild(panes);
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
  /* The signed-in account, or null. Comments need one; nothing else on this
     page does, and a guest sees the page a guest has always seen. The name
     and colour ride each comment (support.md, "Threads"): this worker has no
     reach into the accounts D1, so the page sends what /me gave it. */
  var ME = null;
  var POSTS = {};   // pid → the post as last rendered, for the menu
  var THREAD = {};  // reply id → the row as last rendered, for the comment menu
  var STATE_LIST = ["new", "open", "planned", "fixed", "wontfix", "closed"];

  function ownerApi(method, path, body) { return api("support", method, path, body, { creds: true }); }

  function detectOwner() {
    if (!window.DeetsAccount) return;
    var asked = false;
    var seen;                                       // the account an open post was rendered for
    window.DeetsAccount.onChange(function (u) {
      ME = u || null;
      paintCommentBox();
      if (u === null) return;                       // not known yet
      /* Signing in or out changes what a thread is SENT — the owner is the
         only one given hidden rows — so an open post must be re-read, not
         just repainted. First answer of the load renders nothing new. */
      var id = ME ? ME.id : null;
      if (seen !== undefined && seen !== id) reloadOpenPost();
      seen = id;
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
    // The owner's list is the one board response that still carries codes.
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

    placeMenu(menu, x, y);
  }
  function placeMenu(menu, x, y) {
    document.body.appendChild(menu);
    // offset*, not getBoundingClientRect: the pop-in scale would under-measure
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + "px";
    menuEl = menu;
    var first = $(".tb-pop__opt", menu);
    if (first) first.focus({ preventScroll: true });
  }
  /* The same right-click menu, one level down: a thread row instead of a
     card (support.md, "Threads" step 4). Hide/Show and Delete work on any
     row — the reporter's reply, Aditya's, a member's comment — because
     they are one table. Block needs an identity, so it appears only on a
     row that carries a uid, which is a member's comment and nothing else. */
  function openReplyMenu(r, x, y) {
    closeMenu();
    var menu = el("div", "tb-pop dm-menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", s("replyMenuAria", { who: r.name || s("authorPoster") }));

    menu.appendChild(menuOpt(s(r.hidden ? "menuShow" : "menuHide"), function () {
      replyAct(r, "PATCH", "/admin/replies/" + r.id, { hidden: !r.hidden });
    }));
    var del = menuOpt(s("menuDelete"));
    del.classList.add("dm-menu__danger");
    del.addEventListener("click", function () {
      if (!del.hasAttribute("data-armed")) {
        del.setAttribute("data-armed", "");
        del.textContent = s("menuDeleteConfirm");
        return;
      }
      replyAct(r, "DELETE", "/admin/replies/" + r.id);
    });
    menu.appendChild(del);

    if (r.uid) {
      menu.appendChild(el("div", "dm-menu__sep"));
      // Lifting a block does NOT unhide what it hid; Show is per-comment.
      var blk = menuOpt(s(r.blocked ? "menuUnblock" : "menuBlock"));
      if (!r.blocked) blk.classList.add("dm-menu__danger");
      blk.addEventListener("click", function () {
        if (!r.blocked && !blk.hasAttribute("data-armed")) {
          blk.setAttribute("data-armed", "");
          blk.textContent = s("menuBlockConfirm");
          return;
        }
        replyAct(r, "POST", "/admin/block", r.blocked ? { uid: r.uid, undo: true } : { uid: r.uid });
      });
      menu.appendChild(blk);
    }

    placeMenu(menu, x, y);
  }
  function replyAct(r, method, path, body) {
    closeMenu();
    ownerApi(method, path, body).then(function (res) {
      if (!res.ok) { toast("error", errText(res)); return; }
      reloadOpenPost();
    });
  }

  function wireReplyMenu() {
    var list = $("[data-dm-replies]");
    if (!list) return;
    list.addEventListener("contextmenu", function (e) {
      if (!OWNER) return;
      /* An option first: an open list is a moderation surface, and this menu
         is what pays for it (support.md, "Polls"). The comment's own menu is
         still one level out, on the row. */
      var opt = e.target.closest("[data-poll-opt]");
      if (opt) {
        e.preventDefault();
        openOptionMenu(Number(opt.getAttribute("data-poll-opt")), e.clientX, e.clientY);
        return;
      }
      var li = e.target.closest(".dm-reply");
      var r = li && THREAD[li.getAttribute("data-reply")];
      if (!r) return;
      e.preventDefault();
      openReplyMenu(r, e.clientX, e.clientY);
    });
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
        var p = item && POSTS[item.getAttribute("data-pid")];
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
    item.setAttribute("data-pid", p.pid);
    POSTS[p.pid] = p;
    item.appendChild(interestButton(p));

    var main = el("div", "dm-post__main");
    var head = el("div", "dm-post__head");
    // The title is the real link — keyboard and screen readers get there
    // through it. The card-wide click below is the mouse's shortcut.
    var h = el("h3", "dm-post__title");
    var link = el("a", "dm-post__link", p.title);
    link.href = "#" + postHash(p);
    link.title = s("threadOpen");
    h.appendChild(link);
    head.appendChild(h);
    head.appendChild(chip(s("state_" + p.state), p.state));
    // A flag, never a tally: what the vote is doing lives on the thread.
    if (p.polls) head.appendChild(chip(s("tagPoll"), "poll"));
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

    /* Anywhere on the card opens the thread — except the controls that do
       their own thing (▲, More, the title link itself), a right-click (the
       owner's menu), and a click that ended a text selection. */
    item.addEventListener("click", function (e) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.target.closest("a, button")) return;
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      location.hash = postHash(p);
    });
    return item;
  }

  /* A card opens the post's public thread. A HIDDEN post has no public page
     (the worker 404s it), and only the owner ever sees one on a board — so
     his click goes to the code view, which is the only one that exists. */
  function postHash(p) {
    return (p.public === false && p.code) ? "t=" + p.code : "p=" + p.pid;
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
  // +1, so this browser's list of pids is what stops a double-click. On a
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
    var done = readJSON(LS_INTEREST, []).indexOf(p.pid) >= 0;

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
      api("support", "POST", "/interest", undo ? { pid: p.pid, undo: true } : { pid: p.pid }).then(function (res) {
        b.disabled = false;
        if (!res.ok) { toast("error", errText(res)); return; }
        done = !undo;
        var list = readJSON(LS_INTEREST, []).filter(function (c) { return c !== p.pid; });
        if (done) list.push(p.pid);
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

  /* ── A post's page ────────────────────────────────────
     Two ways in, one renderer (support.md, "Threads"):
       #t=<code>  the reporter's own view. Private posts included, the meta
                  they sent, the reply box, and the link is theirs to keep.
       #p=<pid>   the public thread, from a click on a board card. Public
                  posts only, read-only, and nothing the code buys. */
  var ticketCode = null;   // the #t= view, or null
  var threadPid = null;    // the #p= view, or null

  function showPost(open) {
    $("[data-dm-home]").hidden = true;
    $("[data-dm-ticket]").hidden = false;
    window.scrollTo(0, 0);
    open();
  }
  function showTicket(code) {
    ticketCode = code; threadPid = null;
    showPost(function () { loadTicket(code); });
  }
  function showThread(pid) {
    threadPid = pid; ticketCode = null;
    showPost(function () { loadThread(pid); });
  }
  function reloadOpenPost() {
    if (threadPid) loadThread(threadPid);
    else if (ticketCode) loadTicket(ticketCode);
  }

  function hideTicket() {
    ticketCode = null;
    threadPid = null;
    paintCommentBox();
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
      renderTicket(res.data.post, Array.isArray(res.data.replies) ? res.data.replies : [], false);
    });
  }

  function loadThread(pid) {
    var body = $("[data-dm-ticket-body]");
    var thread = $("[data-dm-thread]");
    body.textContent = "";
    body.appendChild(el("p", "dm-empty", s("threadLoading")));
    thread.hidden = true;

    // A hidden post answers 404 here exactly as a pid that never existed
    // does, so "missing" is the only thing the page can honestly say.
    api("support", "GET", "/p/" + pid).then(function (res) {
      if (threadPid !== pid) return;
      body.textContent = "";
      if (res.status === 404) { body.appendChild(el("p", "dm-empty", s("ticketMissing"))); return; }
      if (!res.ok || !res.data || !res.data.post) { body.appendChild(el("p", "dm-empty", s("ticketFailed"))); return; }
      renderTicket(res.data.post, Array.isArray(res.data.replies) ? res.data.replies : [], true);
    });
  }

  // pub: the read-only #p= view. It has no code to remember, no privacy to
  // report (it is on the board by definition), and nothing to reply with.
  function renderTicket(post, replies, pub) {
    var body = $("[data-dm-ticket-body]");
    if (!pub && !OWNER) remember({ code: post.code, kind: post.kind, title: post.title });   // the owner's visits aren't "your posts"

    var chips = el("div", "dm-ticket__chips");
    chips.appendChild(chip(s("ticketKind_" + post.kind)));
    chips.appendChild(chip(s("state_" + post.state), post.state));
    if (!pub) chips.appendChild(chip(s(post.public ? "ticketPublic" : "ticketPrivate")));
    body.appendChild(chips);

    body.appendChild(el("h2", "dm-ticket__title", post.title));
    var meta = [s("ticketSent", { date: fmtUnixNumeric(post.created_at) })];
    if (post.updated_at && post.updated_at !== post.created_at) meta.push(s("ticketUpdated", { date: fmtUnixNumeric(post.updated_at) }));
    // #p= carries no meta; the worker extracts the version for it instead.
    var version = pub ? (post.version == null ? "" : String(post.version)) : parseVersion(post.meta);
    if (version) meta.push(version === "all" ? s("ticketVersionAll") : s("ticketVersion", { v: version }));
    body.appendChild(el("p", "dm-ticket__meta", meta.join(" · ")));
    body.appendChild(el("p", "dm-ticket__body", post.body));

    var keep = el("div", "dm-keep");
    keep.appendChild(el("p", "dm-hint", s(pub ? "threadShare" : "ticketKeep")));
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
    THREAD = {};
    if (!replies.length) list.appendChild(el("li", "dm-empty", s("repliesEmpty")));
    replies.forEach(function (r) {
      var li = el("li", "dm-reply" + (r.author === "owner" ? " is-owner" : ""));
      li.setAttribute("data-reply", r.id);
      THREAD[r.id] = r;
      var who = el("div", "dm-reply__who");
      /* Aditya is marked by `author`, which only the worker's OWNER_UID check
         can set — NEVER by the name, which anyone may change to his. A
         member's own name is their profile's, snapshotted when they posted;
         on a public thread the reporter is a stranger, not "You". */
      var label = r.author === "member"
        ? (r.name || s(pub ? "authorPoster" : "authorReporter"))
        : s(r.author === "owner" ? "authorOwner" : (pub ? "authorPoster" : "authorReporter"));
      var nameEl = el("span", "dm-reply__name", label);
      // A profile colour is data, not a rule: it rides an inline custom
      // property the stylesheet reads, so no hex is written into the CSS.
      if (r.author === "member" && r.color) nameEl.style.setProperty("--dm-who", r.color);
      who.appendChild(nameEl);
      who.appendChild(el("span", null, fmtUnix(r.created_at)));
      // Only the owner is sent hidden rows at all (the worker filters them).
      // Only the owner is sent hidden rows, or `blocked` at all.
      if (r.hidden) { li.classList.add("is-hidden-reply"); who.appendChild(chip(s("tagHidden"), "hidden")); }
      if (r.blocked) who.appendChild(chip(s("commentBlocked"), "hidden"));
      li.appendChild(who);
      li.appendChild(el("p", "dm-reply__body", r.body));
      /* The poll hangs off THIS comment, whose body is its question. Only a
         signed-in account's comment can carry one, so a row without a poll is
         simply a row. */
      if (r.poll && Array.isArray(r.poll.options)) {
        var pollNode = renderPoll(r.poll, r.body);
        pollNode.setAttribute("data-poll-id", r.poll.id);
        li.appendChild(pollNode);
      }
      list.appendChild(li);
    });
    /* No reply box on a public thread. The reporter's reply needs the code,
       and so does the owner's (/admin/posts/<code>/replies) — his way in is
       the menu's Reply, which sends him to #t=. Signed-in comments are
       step 3 of "Threads". */
    paintCommentBox();
    $("[data-dm-thread]").hidden = false;
  }

  function parseVersion(meta) {
    if (!meta) return "";
    try {
      var m = typeof meta === "string" ? JSON.parse(meta) : meta;
      return m && typeof m.version === "string" ? m.version : "";
    } catch (e) { return ""; }
  }

  /* One form serves both views. On #t= it is the reporter's reply, which
     needs no account. On #p= it is a comment, which needs one — signed out,
     the door to signing in stands where the box would be. */
  function paintCommentBox() {
    var form = $("[data-dm-reply]");
    var signin = $("[data-dm-signin]");
    if (!form || !signin) return;
    var onThread = !!threadPid;
    var open = !onThread || !!ME;                   // #t= never asks for an account
    form.hidden = !(ticketCode || threadPid) || !open;
    signin.hidden = !onThread || !!ME;
    $("[data-dm-reply-label]", form).textContent = s(onThread ? "commentLabel" : "replyLabel");
    $("[data-dm-send]", form).textContent = s(onThread ? "commentSend" : "replySend");
    paintPollForm();
  }

  function wireSignin() {
    var go = $("[data-dm-signin-go]");
    if (go) go.addEventListener("click", function () {
      if (window.DeetsAccount) window.DeetsAccount.signIn();
    });
  }

  function wireReply() {
    var form = $("[data-dm-reply]");
    var body = field(form, "body");
    var err = $("[data-dm-err]", form);
    var send = $("[data-dm-send]", form);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var code = ticketCode, pid = threadPid;
      var b = body.value.trim();
      if (!code && !pid) return;
      if (!b || b.length > BODY_MAX) { err.textContent = s("err_body"); err.hidden = false; return; }
      if (JWT_SHAPE.test(b)) { err.textContent = s("err_credential_shaped"); err.hidden = false; return; }
      if (pid && !(ME && ME.name)) { err.textContent = s(ME ? "err_name" : "commentSignin"); err.hidden = false; return; }
      /* One Send sends both: the comment is the poll's question, so a poll
         and its comment can never half-land (support.md, "Polls"). */
      var draft = pid ? pollPayload() : { poll: null };
      if (draft.err) { err.textContent = draft.err; err.hidden = false; return; }
      err.hidden = true;
      send.disabled = true;
      /* A comment carries the account cookie, so it goes out credentialed —
         the same fetch the owner routes use. The name and colour are a
         snapshot: renaming later does not rewrite what is already posted. */
      var comment = { body: b, name: ME && ME.name, color: (ME && ME.color) || null };
      if (draft.poll) comment.poll = draft.poll;
      var sent = pid
        ? api("support", "POST", "/p/" + pid + "/comments", comment, { creds: true })
        : OWNER
          ? ownerApi("POST", "/admin/posts/" + code + "/replies", { body: b })   // replies as Aditya
          : api("support", "POST", "/t/" + code + "/replies", { body: b });
      sent.then(function (res) {
        send.disabled = false;
        // A 401 here means the session died mid-visit; the prompt below the
        // box says the same thing, so it is the same string (his call).
        if (res.status !== 201) {
          err.textContent = res.status === 401 ? s("commentSignin") : errText(res);
          err.hidden = false;
          return;
        }
        form.reset();
        /* A new poll changes what the CARD says (it is the flag), and the
           worker has just dropped its board cache, so the board behind this
           thread is re-read. A vote never needs this: a card carries no
           counts (support.md, "What it costs"). */
        if (draft.poll) loadBoards();
        resetPollDraft();
        toast("success", s(pid ? "commentSent" : "replySent"));
        if (pid && threadPid === pid) loadThread(pid);
        else if (ticketCode === code) loadTicket(code);
      });
    });
  }

  // ── Polls (support.md, "Polls") ────────────────────────────────
  /* A poll hangs off one comment: the comment's body is the question, so a
     poll renders inside the reply row it belongs to and never as a row of
     its own. Voting needs an account — that is the whole reason a poll can
     be an honest ballot where ▲ cannot.

     Two rules this section keeps:
     - The share is DATA, not a rule. Each bar's width rides an inline
       --dm-share the stylesheet reads, the same trick a commenter's colour
       uses, so no geometry is written into main.css.
     - The counts show from the first look (his call, 2026-09-15). The
       animation is the vote landing: a pick moves the bars from their old
       widths, never from zero. CSS transitions --dm-share, so simply
       writing the new share animates it. */
  var POLL_MAX = 6, POLL_MIN = 2, OPTION_MAX = TITLE_MAX;
  var POLL_SHOWN = 4;     // cards in view before the row starts scrolling

  /* A refused poll write. `poll_closed` says the same thing the poll itself
     says, so it is the same string — the collapse his threads pass made with
     commentSignin. */
  function pollErrText(res) {
    var code = res && res.data && res.data.error;
    return code === "poll_closed" ? s("pollClosed") : errText(res);
  }
  function voteWord(n) {
    return n === 1 ? s("pollVotesOne") : s("pollVotes", { n: n });
  }
  function sharePct(votes, total) { return total ? Math.round((votes / total) * 100) : 0; }
  function pollTotal(poll) {
    return poll.options.reduce(function (n, o) { return n + (o.votes || 0); }, 0);
  }

  /* Picking is LOCAL. A click moves the draft and nothing else; the ballot
     goes out once, when Vote is pressed. That is a click's worth of thought
     for the person and one write for the worker, instead of a round trip per
     tick — which on a several-pick poll was the whole ballot, rewritten, per
     box (support.md, "What it costs"). */
  function pollDirty(poll) {
    if (poll.draft.length !== poll.mine.length) return true;
    return poll.draft.some(function (id) { return poll.mine.indexOf(id) < 0; });
  }
  function renderPoll(poll, question) {
    poll.draft = poll.mine.slice();      // the cast vote is where the draft starts
    var box = el("div", "dm-poll");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", s("pollAria", { question: question }));
    if (poll.closed) box.classList.add("is-closed");

    var head = el("p", "dm-poll__hint",
      poll.closed
        ? s(poll.closed_state ? "pollClosedState" : "pollClosed")
        : s(poll.multi ? "pollPickMany" : "pollPickOne"));
    box.appendChild(head);

    /* Most votes first, and only ever HERE: the order is settled when the
       thread loads and never again, so a card cannot slide out from under the
       cursor when a vote lands on it. Sort is stable, so a tie keeps the order
       the options were added in. Past four, the row scrolls sideways rather
       than shrinking every card to fit (his call, 2026-09-15). */
    var list = el("div", "dm-poll__options" + (poll.options.length > POLL_SHOWN ? " is-scroll" : ""));
    poll.options.slice()
      .sort(function (a, b) { return (b.votes || 0) - (a.votes || 0); })
      .forEach(function (o) { list.appendChild(pollOption(poll, o)); });
    box.appendChild(list);

    /* Three kinds of control, so three places rather than one row of five.
       What you do with the poll (Vote) leads, on the line under the cards.
       What only its author and the owner may do (Close) sits at the far end
       of that same line, where nobody reaches by accident. What you may ADD
       to the poll is a different act from voting on it, so it goes below a
       hairline of its own. */
    var foot = el("div", "dm-poll__foot");
    /* Signed out, the cards and counts still show — they always did — and the
       door to signing in stands where Vote would. A CLOSED poll has nothing
       to sign in for, so it says nothing. */
    if (!ME && !poll.closed) foot.appendChild(el("p", "dm-hint", s("pollSignin")));
    else if (!poll.closed) {
      var send = el("button", "home__cta dm-poll__send", s("pollVote"));
      send.type = "button";
      send.setAttribute("data-poll-send", "");
      send.disabled = true;                      // nothing to send until you pick
      send.addEventListener("click", function () { castVote(poll); });
      foot.appendChild(send);
    }
    /* Closing is the author's or the owner's. `multi` and the option list are
       fixed at creation, so there is nothing else to offer here. Nobody
       reopens a poll the THREAD closed: the post would have to be reopened
       first, which is the owner's menu, not this control. */
    if (ME && (poll.yours || OWNER) && !poll.closed_state) {
      var close = el("button", "dm-textbtn dm-poll__manage", s(poll.closed ? "pollReopen" : "pollClose"));
      close.type = "button";
      close.addEventListener("click", function () {
        close.disabled = true;
        api("support", "PATCH", "/poll/" + poll.id, { closed: !poll.closed }, { creds: true })
          .then(function (res) {
            close.disabled = false;
            if (!res.ok) { toast("error", errText(res)); return; }
            toast("success", s(poll.closed ? "pollReopenedToast" : "pollClosedToast"));
            reloadOpenPost();
          });
      });
      foot.appendChild(close);
    }
    if (foot.childNodes.length) box.appendChild(foot);
    if (ME && !poll.closed && poll.open_options) {
      box.appendChild(addOptionControl(poll, poll.options.length >= POLL_MAX));
    }
    return box;
  }

  /* One option: a card, and — while the poll is open and someone is signed
     in — the control that picks it. A closed poll keeps the cards and loses
     the controls. The share is still data: it tints the card rather than
     drawing a bar, so a busy option reads hotter without a second shape. */
  function pollOption(poll, o) {
    var total = pollTotal(poll);
    var mine = poll.draft.indexOf(o.id) >= 0;
    var pickable = !!ME && !poll.closed;
    var row = el(pickable ? "button" : "div", "dm-poll__opt" + (mine ? " is-mine" : ""));
    if (pickable) {
      row.type = "button";
      row.setAttribute("aria-pressed", mine ? "true" : "false");
    }
    if (o.hidden) row.classList.add("is-hidden-opt");     // the owner alone is sent one
    row.setAttribute("data-poll-opt", o.id);
    // Data, never a rule: the stylesheet turns this into the bar's width.
    row.style.setProperty("--dm-share", total ? (o.votes / total).toFixed(4) : "0");

    row.appendChild(el("span", "dm-poll__text", o.text));
    var meta = el("span", "dm-poll__meta");
    meta.appendChild(el("span", "dm-poll__count", voteWord(o.votes || 0)));
    meta.appendChild(el("span", "dm-poll__pct", s("pollShare", { n: sharePct(o.votes || 0, total) })));
    /* The mark is always in the card and only ever fades: appending it on a
       vote would grow the card, and a card that changes size under the cursor
       is the one thing a poll must not do. */
    var tick = el("span", "dm-poll__mine");
    tick.setAttribute("aria-label", s("pollMine"));
    tick.title = s("pollMine");
    meta.appendChild(tick);
    row.appendChild(meta);
    if (pickable) row.addEventListener("click", function () { pickOption(poll, o.id); });
    return row;
  }

  // A click on a card: the draft moves, nothing leaves the page.
  function pickOption(poll, id) {
    var at = poll.draft.indexOf(id);
    if (poll.multi) {
      if (at >= 0) poll.draft.splice(at, 1); else poll.draft.push(id);
    } else {
      poll.draft = at >= 0 ? [] : [id];   // clicking your own pick clears it
    }
    repaintPoll(poll);
  }

  /* Vote sends the WHOLE ballot once, replacing whatever that account had; an
     empty draft takes the vote back. A dropped request costs the press and
     never half a vote, and the answer carries the fresh counts, so it is one
     request rather than a thread reload. */
  function castVote(poll) {
    var node = document.querySelector('[data-poll-id="' + poll.id + '"]');
    if (node) node.classList.add("is-sending");
    api("support", "POST", "/poll/" + poll.id + "/vote", { options: poll.draft }, { creds: true })
      .then(function (res) {
        if (node) node.classList.remove("is-sending");
        if (!res.ok || !res.data) {
          toast("error", res.status === 401 ? s("pollSignin") : pollErrText(res));
          return;
        }
        poll.mine = Array.isArray(res.data.mine) ? res.data.mine : [];
        poll.draft = poll.mine.slice();
        (res.data.options || []).forEach(function (r) {
          poll.options.forEach(function (o) { if (o.id === r.id) o.votes = r.votes; });
        });
        repaintPoll(poll);
      });
  }

  /* Repaint in place rather than rebuild: the bars have to move FROM where
     they are, and a fresh node would start every one at zero. */
  function repaintPoll(poll) {
    var node = document.querySelector('[data-poll-id="' + poll.id + '"]');
    if (!node) return;
    var total = pollTotal(poll);
    poll.options.forEach(function (o) {
      var row = $('[data-poll-opt="' + o.id + '"]', node);
      if (!row) return;
      var mine = poll.draft.indexOf(o.id) >= 0;
      row.style.setProperty("--dm-share", total ? (o.votes / total).toFixed(4) : "0");
      row.classList.toggle("is-mine", mine);
      if (row.tagName === "BUTTON") row.setAttribute("aria-pressed", mine ? "true" : "false");
      var count = $(".dm-poll__count", row);
      if (count) count.textContent = voteWord(o.votes || 0);
      var pct = $(".dm-poll__pct", row);
      if (pct) pct.textContent = s("pollShare", { n: sharePct(o.votes || 0, total) });
      // the mark is already in the card; is-mine fades it in
    });
    /* The button is the only thing that says there is something unsent. It is
       always there and only ever enables, so arming it moves nothing. */
    var send = $("[data-poll-send]", node);
    if (send) {
      send.disabled = !pollDirty(poll);
      node.classList.toggle("is-unsent", pollDirty(poll));
    }
  }

  /* Anyone signed in may add an option (his call, 2026-09-15), which is why
     the owner can hide one. Adding is not voting — you still have to pick it,
     so the new bar arrives at zero. */
  /* The box stands open rather than unfolding from a button: a control that
     appears on click moves everything under it, and this one sits above the
     rest of the thread. At the cap it stays exactly where it is, disabled —
     the row keeps its space whether or not there is room left in the poll. */
  function addOptionControl(poll, full) {
    var row = el("div", "dm-poll__addrow");
    var input = el("input", "dm-field__input dm-poll__input");
    input.type = "text";
    input.maxLength = OPTION_MAX;
    input.placeholder = s("pollOptionPlace");
    var send = el("button", "home__cta home__cta--soft", s("pollOptionSend"));
    send.type = "button";
    row.appendChild(input);
    row.appendChild(send);
    if (full) { input.disabled = true; send.disabled = true; row.title = s("err_poll_full"); }

    function add() {
      var text = input.value.trim();
      if (!text) { toast("error", s("err_option_text")); return; }
      send.disabled = true;
      api("support", "POST", "/poll/" + poll.id + "/options", { text: text }, { creds: true })
        .then(function (res) {
          send.disabled = false;
          if (res.status !== 201) { toast("error", pollErrText(res)); return; }
          input.value = "";
          reloadOpenPost();          // the new card comes back with the thread
        });
    }
    send.addEventListener("click", add);
    // Enter sends it: the box is inside no form of its own.
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); add(); }
    });
    return row;
  }

  /* The owner's per-option menu — the price of an open option list. Hide and
     Show are the post menu's own strings; a hidden option leaves every count
     while it is hidden, and its votes come back if he shows it again. */
  function openOptionMenu(id, x, y) {
    closeMenu();
    var menu = el("div", "tb-pop dm-menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", s("pollOptionMenu"));
    var row = document.querySelector('[data-poll-opt="' + id + '"]');
    var hidden = !!(row && row.classList.contains("is-hidden-opt"));
    menu.appendChild(menuOpt(s(hidden ? "menuShow" : "menuHide"), function () {
      closeMenu();
      ownerApi("PATCH", "/admin/poll-options/" + id, { hidden: !hidden }).then(function (res) {
        if (!res.ok) { toast("error", errText(res)); return; }
        reloadOpenPost();
      });
    }));
    placeMenu(menu, x, y);
  }

  // ── Composing a poll, under the comment box ────────────────────
  /* The draft lives here rather than in the DOM so that reopening the editor
     keeps what was typed. `multi` is set HERE and never again: changing it
     mid-poll would reinterpret ballots already cast. */
  var pollDraft = { open: false, rows: ["", ""], multi: false };

  function pollFormNodes() {
    var form = $("[data-dm-reply]");
    if (!form) return null;
    return {
      form: form,
      // one node: the button beside Send is the composer's whole chrome
      host: $("[data-dm-pollform]", form),
      toggle: $("[data-dm-poll-open]", form),
      collapse: $("[data-dm-poll-collapse]", form),
      rows: $("[data-dm-poll-rows]", form),
      addRow: $("[data-dm-poll-addrow]", form)
    };
  }

  /* The editor is offered on a public thread, signed in, and nowhere else: a
     reporter's reply on #t= has no account behind it to hang a ballot on. */
  function paintPollForm() {
    var n = pollFormNodes();
    if (!n || !n.host) return;
    var offer = !!threadPid && !!ME;
    n.host.hidden = !offer;
    if (!offer && pollDraft.open) setPollOpen(false);
    n.toggle.textContent = s(pollDraft.open ? "pollDrop" : "pollAdd");
  }

  function setPollOpen(open) {
    var n = pollFormNodes();
    if (!n || !n.host) return;
    pollDraft.open = open;
    n.collapse.classList.toggle("is-open", open);
    n.collapse.inert = !open;
    n.toggle.setAttribute("aria-expanded", open ? "true" : "false");
    n.toggle.textContent = s(open ? "pollDrop" : "pollAdd");
    if (open) {
      renderPollRows();
      var first = $(".dm-polledit__input", n.rows);
      if (first) first.focus({ preventScroll: true });
    }
  }

  function resetPollDraft() {
    pollDraft = { open: false, rows: ["", ""], multi: false };
    var n = pollFormNodes();
    if (n && n.host) {
      n.collapse.classList.remove("is-open");
      n.collapse.inert = true;
      n.toggle.setAttribute("aria-expanded", "false");
      n.toggle.textContent = s("pollAdd");
      renderPollRows();
      paintPollMode();
    }
  }

  /* Rows are rebuilt from the draft, but a row that is only being ADDED grows
     in on the shared collapse kit — height carries the motion, --dur-med and
     --ease-ui carry the timing, and REDUCED skips to the end state. */
  function renderPollRows(grow) {
    var n = pollFormNodes();
    if (!n || !n.rows) return;
    n.rows.textContent = "";
    pollDraft.rows.forEach(function (value, i) {
      var wrap = el("div", "dm-collapse dm-polledit__row");
      var inner = el("div", "dm-collapse__inner");
      var row = el("div", "dm-polledit__field");
      var input = el("input", "dm-field__input dm-polledit__input");
      input.type = "text";
      input.maxLength = OPTION_MAX;
      input.value = value;
      input.placeholder = s("pollOptionPh", { n: i + 1 });
      input.addEventListener("input", function () { pollDraft.rows[i] = input.value; });
      row.appendChild(input);
      /* The remove slot is always in the row and only ever hides: taking the
         button out at two rows would re-measure every field on the way down
         to the minimum. */
      var drop = el("button", "dm-polledit__drop", "×");
      drop.type = "button";
      drop.setAttribute("aria-label", s("pollEditRemove", { n: i + 1 }));
      drop.hidden = pollDraft.rows.length <= POLL_MIN;
      drop.addEventListener("click", function () {
        pollDraft.rows.splice(i, 1);
        renderPollRows();
      });
      row.appendChild(drop);
      inner.appendChild(row);
      wrap.appendChild(inner);
      n.rows.appendChild(wrap);
      var last = grow && i === pollDraft.rows.length - 1;
      if (last && !REDUCED) {
        wrap.getBoundingClientRect();              // commit the closed height first
        requestAnimationFrame(function () { wrap.classList.add("is-open"); });
      } else {
        wrap.classList.add("is-open");
      }
    });
    // Disabled at the cap, never removed — the foot keeps its height.
    if (n.addRow) n.addRow.disabled = pollDraft.rows.length >= POLL_MAX;
  }

  function paintPollMode() {
    var form = $("[data-dm-reply]");
    if (!form) return;
    $all("[data-dm-poll-multi]", form).forEach(function (b) {
      var on = (b.getAttribute("data-dm-poll-multi") === "1") === !!pollDraft.multi;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.classList.toggle("is-on", on);
    });
  }

  function wirePollForm() {
    var n = pollFormNodes();
    if (!n || !n.host) return;
    n.toggle.addEventListener("click", function () { setPollOpen(!pollDraft.open); });
    n.addRow.addEventListener("click", function () {
      if (pollDraft.rows.length >= POLL_MAX) return;
      pollDraft.rows.push("");
      renderPollRows(true);
      var inputs = $all(".dm-polledit__input", n.rows);
      var last = inputs[inputs.length - 1];
      if (last) last.focus({ preventScroll: true });
    });
    $all("[data-dm-poll-multi]", n.form).forEach(function (b) {
      b.addEventListener("click", function () {
        pollDraft.multi = b.getAttribute("data-dm-poll-multi") === "1";
        paintPollMode();
      });
    });
    renderPollRows();
    paintPollMode();
  }

  /* What rides the comment. Null when the editor is shut; an error string
     when it is open and the rows do not make a poll — rejected whole, never
     trimmed to fit, so a poll can never quietly lose an option. */
  function pollPayload() {
    if (!pollDraft.open) return { poll: null };
    var rows = pollDraft.rows.map(function (r) { return r.trim(); }).filter(Boolean);
    if (rows.length < POLL_MIN || rows.length > POLL_MAX) return { err: s("err_poll_options") };
    var seen = {};
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].toLowerCase();
      if (seen[k]) return { err: s("err_poll_duplicate") };
      seen[k] = true;
    }
    return { poll: { options: rows, multi: !!pollDraft.multi, open_options: true } };
  }

  // ── Routing (fragment only) ────────────────────────────────────
  function route() {
    var h = location.hash.replace(/^#/, "");
    var m = /^t=([A-Za-z0-9_-]{8,32})$/.exec(h);
    if (m) { showTicket(m[1]); return; }
    var pm = /^p=([A-Za-z0-9_-]{8,32})$/.exec(h);
    if (pm) { showThread(pm[1]); return; }
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
        if (ticketCode || threadPid) return;
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
  wirePollForm();
  wireSignin();
  wireReplyMenu();
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
