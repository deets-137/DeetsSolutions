/* DeetsRadio — shared listening rooms (design: docs/radio.md).

   Phase 1: the whole page runs against the MOCK transport
   (transport-mock.js, window.RadioTransport) — same wire protocol the
   Cloudflare Worker will speak, so this file survives the swap untouched.
   No audio yet: the room clock runs, the UI follows it.

   ALL user-facing copy comes from radio/strings.js (window.RADIO_STRINGS);
   no string literals in here. NOTE: the toolbar/popover kit (pills,
   openPop/closePop, optButton) is deliberately duplicated from
   sotd.js / movies.js / league.js to keep each page self-contained —
   fix a bug there, mirror it here. */
(function () {
  "use strict";

  var S = window.RADIO_STRINGS;
  var T = window.RadioTransport;
  var BAR_INPUT = document.querySelector("[data-radio-who]");
  if (!BAR_INPUT || !S || !T) return;
  var BAR_POP = document.querySelector("[data-radio-who-pop]");
  var TOOLBAR = document.querySelector("[data-radio-toolbar]");
  var META = document.querySelector("[data-radio-meta]");
  var GATE = document.querySelector("[data-radio-gate]");
  var ROOM = document.querySelector("[data-radio-room]");
  var NP = document.querySelector("[data-radio-np]");
  var TABS = document.querySelector("[data-radio-tabs]");
  var COLS = document.querySelector("[data-radio-columns]");
  var QUEUE_TITLE = document.querySelector("[data-radio-title-queue]");
  var QUEUE_BODY = document.querySelector("[data-radio-queue]");
  var SEARCH_TITLE = document.querySelector("[data-radio-title-search]");
  var SEARCH_BODY = document.querySelector("[data-radio-search]");
  var HISTORY_TITLE = document.querySelector("[data-radio-title-history]");
  var HISTORY_BODY = document.querySelector("[data-radio-history]");

  var NAME_KEY = "deets-radio-name";
  var STATIONS_KEY = "deets-radio-stations";
  var TERMS_KEY = "deets-radio-search-recents";
  var UP_NEXT_CAP = 50;
  var LIST_CAP = 50;

  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  var ICON_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6v12h2V6zM20 6 10 12 20 18z"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6 14 12 4 18zM16 6v12h2V6z"/></svg>';

  /* ── tiny helpers ─────────────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmt(str, vals) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      return vals && vals[k] != null ? vals[k] : m;
    });
  }
  function slugify(raw) {
    return String(raw || "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  }
  function load(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  var metaTimer = null;
  function setMeta(text) {
    if (metaTimer) { clearTimeout(metaTimer); metaTimer = null; }
    META.textContent = text || "";
  }
  function toast(text, revertTo) {
    setMeta(text);
    metaTimer = setTimeout(function () { setMeta(revertTo || ""); }, 3200);
  }
  function metaIdle() {
    return S.metaIdle + (T.kind === "mock" ? "  ·  " + S.mockNotice : "");
  }

  /* ── popover kit (mirrored from league.js) ────────────────────── */
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
    if (fillPop) fillPop(pop, entry);
    TOOLBAR.appendChild(ctrl);
    return entry;
  }
  function optButton(label, onPick) {
    var b = el("button", "tb-pop__opt", label);
    b.type = "button";
    b.setAttribute("role", "menuitemradio");
    b.addEventListener("click", onPick);
    return b;
  }

  /* ── context menu (row right-click / kebab — DeetsMusic idiom) ── */
  var menuEl = null;
  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    document.removeEventListener("click", closeMenu, true);
    document.removeEventListener("keydown", onMenuKey);
    window.removeEventListener("scroll", closeMenu, true);
  }
  function onMenuKey(e) { if (e.key === "Escape") closeMenu(); }
  function openMenu(x, y, items) {
    closeMenu();
    closePop();
    menuEl = el("div", "tb-pop radio-menu");
    menuEl.setAttribute("role", "menu");
    items.forEach(function (it) {
      menuEl.appendChild(optButton(it.label, function () { closeMenu(); it.run(); }));
    });
    document.body.appendChild(menuEl);
    var r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
    menuEl.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
    document.addEventListener("click", closeMenu, true);
    document.addEventListener("keydown", onMenuKey);
    window.addEventListener("scroll", closeMenu, true);
  }
  function bindMenus(row, items) {
    row.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      openMenu(e.clientX, e.clientY, items());
    });
    var kebab = row.querySelector("[data-kebab]");
    if (kebab) kebab.addEventListener("click", function (e) {
      e.stopPropagation();
      var r = kebab.getBoundingClientRect();
      openMenu(r.left, r.bottom + 4, items());
    });
  }

  /* ── client state ─────────────────────────────────────────────── */
  var conn = null;
  var model = null;         // mirror of the room: transport/current/queue/history/listeners
  var clockOffset = 0;      // serverNow − Date.now(), rolling
  var roomCode = null;
  var joined = false;
  var pills = {};           // toolbar pill entries by name

  function roomNow() { return Date.now() + clockOffset; }
  function noteClock(serverNow) {
    var d = serverNow - Date.now();
    clockOffset = joined ? clockOffset * 0.7 + d * 0.3 : d;
  }
  function position() {
    if (!model || !model.current) return 0;
    var t = model.transport;
    if (!t.playing) return t.pausedPosition || 0;
    return Math.max(0, roomNow() - t.startedAt);
  }
  function counting() {
    return !!(model && model.current && model.transport.playing &&
              model.transport.startedAt > roomNow());
  }

  /* ── bar combobox: the title IS the station field ─────────────── */
  var whoEntry = { ctrl: BAR_INPUT.parentElement, pill: null, pop: BAR_POP };
  function stations() { return load(STATIONS_KEY, []); }
  function rememberStation(code) {
    var r = stations().filter(function (c) { return c !== code; });
    r.unshift(code);
    save(STATIONS_KEY, r.slice(0, 8));
  }
  function fillWhoPop() {
    BAR_POP.textContent = "";
    var r = stations();
    if (!r.length) { BAR_POP.hidden = true; return; }
    BAR_POP.appendChild(el("div", "radio-who__group", S.yourStations));
    r.forEach(function (code) {
      var b = optButton(code, function () { commitCode(code); });
      if (code === roomCode) b.classList.add("is-active");
      BAR_POP.appendChild(b);
    });
  }
  BAR_INPUT.addEventListener("focus", function () {
    fillWhoPop();
    if (stations().length) openPop(whoEntry);
    BAR_INPUT.select();
  });
  BAR_INPUT.addEventListener("input", function () {
    var slug = slugify(BAR_INPUT.value);
    BAR_INPUT.setAttribute("data-slug", slug && slug !== BAR_INPUT.value ? slug : "");
  });
  BAR_INPUT.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitCode(BAR_INPUT.value);
      BAR_INPUT.blur();
    }
  });

  /* ── gate: peek → join / create (below the bar) ───────────────── */
  function commitCode(raw) {
    var code = slugify(raw);
    if (!code) return;
    closePop();
    BAR_INPUT.value = code;
    BAR_INPUT.setAttribute("data-slug", "");
    if (joined && code === roomCode) return;
    if (joined) leaveRoom();
    T.peek(code).then(function (p) {
      /* Returning listener: once a name is saved, existing stations join
         instantly — the gate only appears for create-confirm (always, so a
         typo never mints a room) or when we don't know who you are yet. */
      var stored = String(load(NAME_KEY, "")).trim();
      if (p.exists && stored) { joinRoom(code, stored, false); return; }
      renderGate(code, p);
    }).catch(function () { setMeta(S.peekFailed); });
  }
  function nameField() {
    var wrap = el("label", "radio-gate__name");
    wrap.appendChild(el("span", "radio-gate__name-label", S.nameLabel));
    var input = el("input", "radio-gate__name-input");
    input.type = "text";
    input.maxLength = 40;
    input.value = load(NAME_KEY, "");
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }
  function renderGate(code, p) {
    GATE.hidden = false;
    GATE.textContent = "";
    var line, button;
    if (p.exists) {
      line = p.nowPlaying
        ? fmt(S.peekLive, { title: p.nowPlaying.title, artist: p.nowPlaying.artist, n: p.listeners })
        : fmt(S.peekQuiet, { n: p.listeners });
      button = S.joinButton;
    } else {
      line = fmt(S.createLine, { code: code });
      button = S.createButton;
    }
    GATE.appendChild(el("p", "radio-gate__line", line));
    var form = el("div", "radio-gate__form");
    var stored = String(load(NAME_KEY, "")).trim();
    var name = null;
    if (!stored) {                    // name is asked once, then remembered
      name = nameField();
      form.appendChild(name.wrap);
    }
    var go = el("button", "tb-pill radio-gate__go");
    go.type = "button";
    go.appendChild(el("span", "tb-pill__label", button));
    go.addEventListener("click", function () {
      var who = name ? name.input.value.trim() : stored;
      if (!who) { toast(S.nameNeeded, ""); if (name) name.input.focus(); return; }
      save(NAME_KEY, who);
      joinRoom(code, who, !p.exists);
    });
    form.appendChild(go);
    GATE.appendChild(form);
    if (name) name.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); go.click(); }
    });
    setMeta("");
  }

  /* ── join / leave ─────────────────────────────────────────────── */
  function joinRoom(code, who, create) {
    T.connect(code, { name: who, create: !!create }).then(function (c) {
      conn = c;
      roomCode = code;
      joined = true;
      conn.onMessage(onMessage);
      rememberStation(code);
      try { history.replaceState(null, "", "#" + code); } catch (e) {}
    }).catch(function (err) {
      setMeta(err && err.code === "no-room" ? S.joinRefused : S.peekFailed);
    });
  }
  function leaveRoom() {
    if (conn) conn.close();
    conn = null;
    model = null;
    joined = false;
    roomCode = null;
    ROOM.hidden = true;
    GATE.hidden = true;
    buildToolbar();
    setMeta(metaIdle());
  }

  /* ── wire in ──────────────────────────────────────────────────── */
  function onMessage(msg) {
    if (msg.serverNow) noteClock(msg.serverNow);
    if (msg.type === "snapshot") {
      model = {
        v: msg.v, transport: msg.transport, current: msg.current,
        queue: msg.queue, history: msg.history, listeners: msg.listeners
      };
      enterRoomUI();
      renderAll();
      return;
    }
    if (!model) return;
    if (msg.type === "presence") {
      model.listeners = msg.listeners;
      renderListeners();
      return;
    }
    if (msg.type === "state") {
      model.v = msg.v;
      ["transport", "current", "queue", "history"].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(msg, k)) model[k] = msg[k];
      });
      renderAll();
    }
  }
  function send(type, extra) {
    if (!conn) return;
    var msg = extra || {};
    msg.type = type;
    conn.send(msg);
  }

  /* ── toolbar ──────────────────────────────────────────────────── */
  function buildToolbar() {
    TOOLBAR.textContent = "";
    pills = {};
    if (!joined) return;
    pills.listening = makePill(fmt(S.listeningPill, { n: 1 }), function (pop, entry) {
      pills.listeningPop = pop;
    });
    var share = el("button", "tb-pill");
    share.type = "button";
    share.appendChild(el("span", "tb-pill__label", S.sharePill));
    share.addEventListener("click", function () {
      var url = location.origin + location.pathname + "#" + roomCode;
      var done = function () { toast(S.shareToast, ""); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, done);
      } else done();
    });
    TOOLBAR.appendChild(share);
    makePill(S.connectPill, function (pop) {
      pop.appendChild(el("p", "radio-connect__blurb", S.connectExplain));
      var b = optButton(S.connectApple, function () {
        closePop();
        toast(S.connectSoon, "");
      });
      pop.appendChild(b);
    });
    var leave = el("button", "tb-pill");
    leave.type = "button";
    leave.appendChild(el("span", "tb-pill__label", S.leavePill));
    leave.addEventListener("click", leaveRoom);
    TOOLBAR.appendChild(leave);
    renderListeners();
  }
  function renderListeners() {
    if (!pills.listening || !model) return;
    var names = model.listeners || [];
    pills.listening.pill.querySelector(".tb-pill__label").textContent =
      fmt(S.listeningPill, { n: names.length });
    if (pills.listeningPop) {
      pills.listeningPop.textContent = "";
      names.forEach(function (n) {
        pills.listeningPop.appendChild(el("div", "radio-listener", n));
      });
    }
  }

  /* ── room UI shell ────────────────────────────────────────────── */
  var activeCol = "queue";
  function enterRoomUI() {
    GATE.hidden = true;
    ROOM.hidden = false;
    QUEUE_TITLE.textContent = S.colQueue;
    SEARCH_TITLE.textContent = S.colSearch;
    HISTORY_TITLE.textContent = S.colHistory;
    buildToolbar();
    buildTabs();
    buildSearch();
    setMeta("");
    if (!model.current && !model.queue.length) {
      setActiveCol("search");
      var inp = SEARCH_BODY.querySelector("input");
      if (inp) inp.focus();
      setMeta(S.queueEmpty);
    }
  }
  function buildTabs() {
    TABS.textContent = "";
    [["search", S.colSearch], ["queue", S.colQueue], ["history", S.colHistory]]
      .forEach(function (t) {
        var b = el("button", "radio-tabs__tab", t[1]);
        b.type = "button";
        b.dataset.col = t[0];
        b.setAttribute("aria-pressed", String(t[0] === activeCol));
        b.addEventListener("click", function () { setActiveCol(t[0]); });
        TABS.appendChild(b);
      });
  }
  function setActiveCol(col) {
    activeCol = col;
    COLS.setAttribute("data-active", col);
    TABS.querySelectorAll(".radio-tabs__tab").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.col === col));
    });
  }

  /* ── now-playing strip (transport + countdown + progress) ─────── */
  var npNodes = null;
  function buildNP() {
    NP.textContent = "";
    var art = el("div", "radio-np__art");
    var mono = el("img", "radio-cover-blank radio-cover-blank--np");
    mono.alt = "";
    mono.src = "../assets/sprites/radio/cover-blank.svg";
    var img = el("img", "radio-np__img");
    img.alt = "";
    var count = el("span", "radio-np__count");
    art.appendChild(mono);
    art.appendChild(img);
    art.appendChild(count);
    var center = el("div", "radio-np__center");
    var title = el("span", "radio-np__title");
    var artist = el("span", "radio-np__artist");
    var meta = el("div", "radio-np__meta");
    meta.appendChild(title);
    meta.appendChild(artist);
    var scrub = el("div", "radio-scrub");
    var fill = el("div", "radio-scrub__fill");
    scrub.appendChild(fill);
    center.appendChild(meta);
    center.appendChild(scrub);
    var controls = el("div", "radio-np__controls");
    var mk = function (svg, label, onClick) {
      var b = el("button", "radio-np__btn");
      b.type = "button";
      b.innerHTML = svg;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", onClick);
      controls.appendChild(b);
      return b;
    };
    var back = mk(ICON_BACK, "back", function () { send("back"); });
    var play = mk(ICON_PLAY, "play-pause", function () {
      send(model && model.transport.playing ? "pause" : "play");
    });
    play.classList.add("radio-np__btn--play");
    var next = mk(ICON_NEXT, "skip", function () { send("skip"); });
    NP.appendChild(art);
    NP.appendChild(center);
    NP.appendChild(controls);
    npNodes = { art: art, img: img, count: count, title: title, artist: artist,
                fill: fill, play: play, back: back, next: next };
  }
  function renderNP() {
    if (!npNodes) buildNP();
    var n = npNodes;
    var cur = model.current;
    var t = model.transport;
    NP.classList.toggle("radio-np--idle", !cur);
    if (!cur) {
      n.title.textContent = S.npIdle;
      n.artist.textContent = S.npIdleSub;
      n.img.removeAttribute("src");
      NP.classList.remove("radio-np--counting");
      n.fill.style.width = "0%";
      n.play.innerHTML = ICON_PLAY;
      return;
    }
    n.title.textContent = cur.title;
    n.artist.textContent = cur.artist;
    if (cur.artworkUrl) n.img.src = cur.artworkUrl; else n.img.removeAttribute("src");
    NP.classList.toggle("radio-np--has-art", !!cur.artworkUrl);
    n.play.innerHTML = t.playing ? ICON_PAUSE : ICON_PLAY;
    tick();
  }
  /* the 200 ms heartbeat: countdown digits + progress fill */
  function tick() {
    if (!model || !npNodes || !model.current) return;
    var n = npNodes;
    if (counting()) {
      var left = model.transport.startedAt - roomNow();
      var digit = Math.min(3, Math.ceil(left / 1000));
      NP.classList.add("radio-np--counting");
      n.count.textContent = digit > 0 ? String(digit) : "";
      n.fill.style.width = "0%";
    } else {
      NP.classList.remove("radio-np--counting");
      n.count.textContent = "";
      var pct = Math.min(100, position() / model.current.durationMs * 100);
      n.fill.style.width = pct.toFixed(2) + "%";
    }
  }
  setInterval(function () { if (joined && !ROOM.hidden) tick(); }, 200);

  /* ── rows (shared anatomy: art · text · chip · kebab) ─────────── */
  function rowArt(entry) {
    var a = el("span", "radio-row__art");
    if (entry.artworkUrl) {
      var img = el("img", "radio-row__img");
      img.alt = "";
      img.loading = "lazy";
      img.src = entry.artworkUrl;
      a.appendChild(img);
    } else {
      var ph = el("img", "radio-cover-blank");
      ph.alt = "";
      ph.src = "../assets/sprites/radio/cover-blank.svg";
      a.appendChild(ph);
    }
    return a;
  }
  function row(entry, opts) {
    var li = el("li", "radio-row");
    li.appendChild(rowArt(entry));
    var text = el("span", "radio-row__text");
    text.appendChild(el("span", "radio-row__title", entry.title));
    text.appendChild(el("span", "radio-row__artist", entry.artist));
    li.appendChild(text);
    var side = el("span", "radio-row__side");
    if (opts && opts.chip) side.appendChild(el("span", "song__chip song__chip--soft", opts.chip));
    if (opts && opts.action) {
      var act = el("button", "radio-row__act", opts.action.glyph);
      act.type = "button";
      act.setAttribute("aria-label", opts.action.label);
      act.addEventListener("click", function (e) { e.stopPropagation(); opts.action.run(); });
      side.appendChild(act);
    }
    var kebab = el("button", "radio-row__act", "⋯");
    kebab.type = "button";
    kebab.setAttribute("data-kebab", "");
    kebab.setAttribute("aria-label", "more");
    side.appendChild(kebab);
    li.appendChild(side);
    if (opts && opts.menu) bindMenus(li, opts.menu);
    return li;
  }

  /* ── queue column ─────────────────────────────────────────────── */
  var dragFrom = null;
  function renderQueue() {
    QUEUE_BODY.textContent = "";
    /* Now-playing hero at the top of the Queue card + an "Up next" label —
       DeetsMusic's qcard anatomy (.qnow + .qcard__label), mirrored. */
    var cur = model.current;
    var hero = el("div", "radio-hero" + (cur ? "" : " radio-hero--idle"));
    hero.appendChild(rowArt(cur || {}));
    var htext = el("span", "radio-row__text");
    htext.appendChild(el("span", "radio-hero__title", cur ? cur.title : S.npIdle));
    htext.appendChild(el("span", "radio-row__artist", cur ? cur.artist : ""));
    hero.appendChild(htext);
    QUEUE_BODY.appendChild(hero);
    var q = model.queue;
    if (!q.length) {
      QUEUE_BODY.appendChild(el("p", "sotd__empty", S.queueEmpty));
      return;
    }
    QUEUE_BODY.appendChild(el("div", "radio-who__group", S.queueUpNext));
    var list = el("ol", "radio-list");
    q.slice(0, UP_NEXT_CAP).forEach(function (entry, i) {
      var li = row(entry, {
        chip: fmt(S.addedBy, { name: entry.addedBy }),
        menu: function () {
          return [
            { label: S.menuPlayNext, run: function () { send("reorder", { entryId: entry.entryId, to: 0 }); } },
            { label: S.menuMoveTop, run: function () { send("reorder", { entryId: entry.entryId, to: 0 }); } },
            { label: S.menuMoveBottom, run: function () { send("reorder", { entryId: entry.entryId, to: model.queue.length - 1 }); } },
            { label: S.menuRemove, run: function () { send("remove", { entryId: entry.entryId }); } }
          ];
        }
      });
      li.draggable = true;
      li.dataset.idx = String(i);
      li.addEventListener("dragstart", function (e) {
        dragFrom = i;
        li.classList.add("is-dragging");
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      li.addEventListener("dragend", function () {
        dragFrom = null;
        li.classList.remove("is-dragging");
        list.querySelectorAll(".is-drop").forEach(function (x) { x.classList.remove("is-drop"); });
      });
      li.addEventListener("dragover", function (e) {
        if (dragFrom == null) return;
        e.preventDefault();
        list.querySelectorAll(".is-drop").forEach(function (x) { x.classList.remove("is-drop"); });
        li.classList.add("is-drop");
      });
      li.addEventListener("drop", function (e) {
        e.preventDefault();
        if (dragFrom == null || dragFrom === i) return;
        send("reorder", { entryId: model.queue[dragFrom].entryId, to: i });
      });
      list.appendChild(li);
    });
    if (q.length > UP_NEXT_CAP) {
      list.appendChild(el("li", "radio-list__more", fmt(S.moreQueued, { n: q.length - UP_NEXT_CAP })));
    }
    QUEUE_BODY.appendChild(list);
  }

  /* ── history column: hero + "Previously" (DeetsMusic idiom) ───── */
  function renderHistory() {
    HISTORY_BODY.textContent = "";
    var h = model.history;
    if (!h.length) {
      HISTORY_BODY.appendChild(el("p", "sotd__empty", S.historyEmpty));
      return;
    }
    var view = h.slice().reverse();
    var latest = view[0];
    var hero = el("div", "radio-hero");
    hero.appendChild(rowArt(latest));
    var text = el("span", "radio-row__text");
    text.appendChild(el("span", "radio-hero__title", latest.title));
    text.appendChild(el("span", "radio-row__artist", latest.artist));
    hero.appendChild(text);
    bindMenus(hero, function () { return historyMenu(latest); });
    HISTORY_BODY.appendChild(hero);
    var older = view.slice(1, LIST_CAP + 1);
    if (older.length) {
      HISTORY_BODY.appendChild(el("div", "radio-who__group", S.historyPreviously));
      var list = el("ol", "radio-list");
      older.forEach(function (entry) {
        list.appendChild(row(entry, { menu: function () { return historyMenu(entry); } }));
      });
      HISTORY_BODY.appendChild(list);
    }
  }
  /* Play Now — the DeetsMusic idiom, translated to a communal room:
     put it at the front of the queue and skip to it. When the room is
     idle, the add alone starts it (skipping would blow past it). */
  function playNow(entry) {
    send("add", { entry: entry, at: 0 });
    if (model && model.current) send("skip");
  }
  function historyMenu(entry) {
    return [
      { label: S.menuPlayNow, run: function () { playNow(strip(entry)); } },
      { label: S.menuPlayNext, run: function () { send("add", { entry: strip(entry), at: 0 }); } },
      { label: S.menuAddQueue, run: function () { send("add", { entry: strip(entry) }); } }
    ];
  }
  function strip(entry) {   // re-adds mint a fresh entryId server-side
    var e = JSON.parse(JSON.stringify(entry));
    delete e.entryId; delete e.addedBy; delete e.addedAt;
    return e;
  }

  /* ── search column ────────────────────────────────────────────── */
  var searchNodes = null;
  var searchSeq = 0;
  function terms() { return load(TERMS_KEY, []); }
  function pushTerm(t) {
    var r = [t].concat(terms().filter(function (x) { return x !== t; })).slice(0, 8);
    save(TERMS_KEY, r);
  }
  function buildSearch() {
    SEARCH_BODY.textContent = "";
    var bar = el("div", "radio-search__bar");
    var input = el("input", "radio-search__input");
    input.type = "search";
    input.placeholder = S.searchPlaceholder;
    input.spellcheck = false;
    bar.appendChild(input);
    var results = el("div", "radio-search__results");
    SEARCH_BODY.appendChild(bar);
    SEARCH_BODY.appendChild(results);
    searchNodes = { input: input, results: results };
    var timer = null;
    input.addEventListener("input", function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { runSearch(input.value); }, 300);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); runSearch(input.value); }
    });
    renderSearchEmpty();
  }
  function renderSearchEmpty() {
    var res = searchNodes.results;
    res.textContent = "";
    var r = terms();
    if (r.length) {
      res.appendChild(el("div", "radio-who__group", S.searchRecent));
      var wrap = el("div", "radio-search__recents");
      r.forEach(function (t) {
        var chip = el("button", "song__chip radio-search__recent", t);
        chip.type = "button";
        chip.addEventListener("click", function () {
          searchNodes.input.value = t;
          runSearch(t);
        });
        wrap.appendChild(chip);
      });
      res.appendChild(wrap);
    } else {
      res.appendChild(el("p", "sotd__empty", S.searchEmpty));
    }
  }
  function runSearch(term) {
    var q = String(term || "").trim();
    var res = searchNodes.results;
    if (!q) { renderSearchEmpty(); return; }
    var seq = ++searchSeq;
    res.textContent = "";
    res.appendChild(el("p", "sotd__empty", S.searchBusy));
    T.search(q).then(function (tracks) {
      if (seq !== searchSeq) return;
      res.textContent = "";
      if (!tracks.length) {
        res.appendChild(el("p", "sotd__empty", fmt(S.searchNoResults, { term: q })));
        return;
      }
      pushTerm(q);
      var list = el("ol", "radio-list");
      tracks.forEach(function (t) {
        /* DeetsMusic's search idiom, one-to-one: click a song = Play Now;
           the menu is Play Now / Play Next / Add to Queue. */
        var li = row(t, {
          menu: function () {
            return [
              { label: S.menuPlayNow, run: function () { playNow(t); } },
              { label: S.menuPlayNext, run: function () { send("add", { entry: t, at: 0 }); } },
              { label: S.menuAddQueue, run: function () { send("add", { entry: t }); } }
            ];
          }
        });
        li.classList.add("radio-row--click");
        li.setAttribute("role", "button");
        li.tabIndex = 0;
        li.addEventListener("click", function () { playNow(t); });
        li.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); playNow(t); }
        });
        list.appendChild(li);
      });
      res.appendChild(list);
    });
  }

  /* ── render root ──────────────────────────────────────────────── */
  function renderAll() {
    if (!model) return;
    renderNP();
    renderQueue();
    renderHistory();
    renderListeners();
  }

  /* ── boot ─────────────────────────────────────────────────────── */
  BAR_INPUT.placeholder = S.tuneInPlaceholder;
  setMeta(metaIdle());
  setActiveCol("queue");
  var hashCode = slugify(location.hash.replace(/^#/, ""));
  if (hashCode) {
    BAR_INPUT.value = hashCode;
    commitCode(hashCode);
  }
})();
