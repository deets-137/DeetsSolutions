/* DeetsRadio — shared listening rooms (design: docs/radio.md).

   Phase 2: rooms still run on the MOCK transport (transport-mock.js,
   window.RadioTransport) — same wire protocol the Cloudflare Worker will
   speak, so this file survives the swap untouched — but the Apple side is
   real: apple.js (window.RadioApple) owns search, authorize(), and the
   playback follower this file feeds from tick().

   ALL user-facing copy comes from radio/strings.js (window.RADIO_STRINGS);
   no string literals in here. NOTE: the toolbar/popover kit (pills,
   openPop/closePop, optButton) is deliberately duplicated from
   sotd.js / movies.js / league.js to keep each page self-contained —
   fix a bug there, mirror it here. */
(function () {
  "use strict";

  var S = window.RADIO_STRINGS;
  var T = window.RadioTransport;
  var A = window.RadioApple;   // Apple side (search / auth / playback follower)
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
  var PREVIEWS_KEY = "deets-radio-previews";
  var UP_NEXT_CAP = 50;
  var LIST_CAP = 50;

  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  var ICON_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6v12h2V6zM20 6 10 12 20 18z"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6 14 12 4 18zM16 6v12h2V6z"/></svg>';
  /* account-state sigils — DeetsMusic's login button anatomy (main.ts) */
  var ICON_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_X = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ICON_SPINNER = '<span class="radio-acct__spinner"></span>';

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
  var joining = false;      // a connect in flight — joins are single-shot
  var peekSeq = 0;          // only the newest peek may render the gate
  var pills = {};           // toolbar pill entries by name

  function roomNow() { return Date.now() + clockOffset; }
  function noteClock(serverNow) {
    var d = serverNow - Date.now();
    clockOffset = joined ? clockOffset * 0.7 + d * 0.3 : d;
  }
  /* A scheduled start counts down until startedAt + pausedPosition (a
     resume keeps pausedPosition set through the lead; a fresh start has
     none, so it reduces to startedAt). Position holds frozen while the
     digits run — the room clock never rewinds. */
  function position() {
    if (!model || !model.current) return 0;
    var t = model.transport;
    if (!t.playing || counting()) return t.pausedPosition || 0;
    return Math.max(0, roomNow() - t.startedAt);
  }
  function counting() {
    if (!model || !model.current || !model.transport.playing) return false;
    var t = model.transport;
    return t.startedAt + (t.pausedPosition || 0) > roomNow();
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
    if (joining || (joined && code === roomCode)) return;
    if (joined) leaveRoom();
    var seq = ++peekSeq;
    T.peek(code).then(function (p) {
      /* joins orphan in-flight peeks: a slow response must never render a
         stale gate over a room we've since entered */
      if (seq !== peekSeq || joining || joined) return;
      /* Returning listener: once a name is saved, existing stations join
         instantly — the gate only appears for create-confirm (always, so a
         typo never mints a room) or when we don't know who you are yet. */
      var stored = String(load(NAME_KEY, "")).trim();
      if (p.exists && stored) { joinRoom(code, stored, false); return; }
      renderGate(code, p);
    }).catch(function () {
      if (seq !== peekSeq || joining || joined) return;
      setMeta(S.peekFailed);
    });
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
      go.disabled = true;     // one press, one join; re-armed if it fails
      joinRoom(code, who, !p.exists).then(function () {
        if (!joined) go.disabled = false;
      });
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
    /* single-shot: an impatient second press while the handshake is in
       flight must not open a second socket (each one counts as a listener) */
    if (joining || (joined && code === roomCode)) return Promise.resolve();
    joining = true;
    peekSeq++;               // orphan any peek still in the air
    return T.connect(code, { name: who, create: !!create }).then(function (c) {
      joining = false;
      conn = c;
      roomCode = code;
      joined = true;
      conn.onMessage(onMessage);
      /* the real transport reports drops + rejoins; the mock has no wire */
      if (conn.onStatus) conn.onStatus(function (s) {
        if (!joined) return;
        if (s === "down") setMeta(S.disconnected);
        else toast(S.reconnected, "");
      });
      rememberStation(code);
      try { history.replaceState(null, "", "#" + code); } catch (e) {}
    }).catch(function (err) {
      joining = false;
      setMeta(err && err.code === "no-room" ? S.joinRefused : S.peekFailed);
    });
  }
  function leaveRoom() {
    if (A) A.stop();
    if (conn) conn.close();
    conn = null;
    model = null;
    joined = false;
    inRoom = false;
    roomCode = null;
    ROOM.hidden = true;
    GATE.hidden = true;
    buildToolbar();
    setMeta(metaIdle());
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
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
    pills.connect = makePill(S.connectPill, fillConnectPop);
    var leave = el("button", "tb-pill");
    leave.type = "button";
    leave.appendChild(el("span", "tb-pill__label", S.leavePill));
    leave.addEventListener("click", leaveRoom);
    TOOLBAR.appendChild(leave);
    renderListeners();
  }
  /* Music Source popover — an account block ported from DeetsMusic's
     login button (label · state sigil, status line under), plus a
     previews toggle that matters until a source is connected. Content
     follows the auth state (RadioApple re-fires onAuthChange after
     connect/disconnect). */
  function previewsOn() { return load(PREVIEWS_KEY, true) !== false; }
  function fillConnectPop(pop) {
    pop.textContent = "";
    if (!A || !A.hasToken()) {     // no signed dev token on this deployment
      pop.appendChild(el("p", "radio-connect__blurb", S.connectUnavailable));
      return;
    }
    var acct = el("div", "radio-acct");
    var btn = el("button", "radio-acct__btn");
    btn.type = "button";
    btn.appendChild(el("span", "radio-acct__label", S.acctLabel));
    var icon = el("span", "radio-acct__icon");
    icon.setAttribute("aria-hidden", "true");
    btn.appendChild(icon);
    var status = el("div", "radio-acct__status");
    acct.appendChild(btn);
    acct.appendChild(status);
    var setAcct = function (state, note) {   // "in" | "out" | "loading"
      icon.innerHTML = state === "in" ? ICON_CHECK : state === "out" ? ICON_X : ICON_SPINNER;
      if (state !== "loading") btn.dataset.state = state;
      btn.disabled = state === "loading";
      status.textContent = note ||
        (state === "in" ? S.acctConnected : state === "out" ? S.acctSignedOut : S.acctWorking);
    };
    setAcct(A.authorized() ? "in" : "out");
    btn.addEventListener("click", function () {
      var wasIn = A.authorized();
      setAcct("loading");
      (wasIn ? A.disconnect() : A.connect()).then(function () {
        setAcct(A.authorized() ? "in" : "out");
      }, function () {
        setAcct(A.authorized() ? "in" : "out");
        if (!wasIn) setMeta(S.connectFailed);  // persistent — cleared on success
      });
    });
    pop.appendChild(acct);
    if (!A.authorized()) {         // previews only matter before a source is on
      var row = el("div", "radio-toggle");
      row.appendChild(el("span", "radio-toggle__label", S.previewToggle));
      var sw = el("button", "radio-toggle__switch");
      sw.type = "button";
      sw.setAttribute("role", "switch");
      sw.setAttribute("aria-label", S.previewToggle);
      sw.setAttribute("aria-checked", String(previewsOn()));
      sw.addEventListener("click", function () {
        var on = !previewsOn();
        save(PREVIEWS_KEY, on);
        sw.setAttribute("aria-checked", String(on));
        A.setPreviews(on);
      });
      row.appendChild(sw);
      pop.appendChild(row);
    }
  }
  if (A) A.onAuthChange(function () {
    if (pills.connect) fillConnectPop(pills.connect.pop);
    /* a completed login clears the persistent failure line */
    if (A.authorized() && META.textContent === S.connectFailed) {
      setMeta(joined ? "" : metaIdle());
    }
  });
  if (A) A.setPreviews(previewsOn());
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
  var inRoom = false;
  function enterRoomUI() {
    /* a reconnect snapshot repairs the model; the shell (toolbar, search
       state, focus) stays exactly where the listener left it */
    if (inRoom) return;
    inRoom = true;
    GATE.hidden = true;
    ROOM.hidden = false;
    QUEUE_TITLE.textContent = S.colQueue;
    SEARCH_TITLE.textContent = S.colSearch;
    HISTORY_TITLE.textContent = S.colHistory;
    buildToolbar();
    buildTabs();
    buildSearch();
    setMeta("");
    /* fresh-station empty state: land on search, ready to type — the queue
       column already says it's empty, the meta line stays quiet */
    if (!model.current && !model.queue.length) {
      setActiveCol("search");
      var inp = SEARCH_BODY.querySelector("input");
      if (inp) inp.focus();
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
    /* display-only progress row: elapsed · bar · canonical duration
       (times are numbers, not affordances — there is no seek) */
    var prog = el("div", "radio-np__progress");
    var elapsed = el("span", "radio-np__time");
    var scrub = el("div", "radio-scrub");
    var fill = el("div", "radio-scrub__fill");
    scrub.appendChild(fill);
    var total = el("span", "radio-np__time radio-np__time--total");
    prog.appendChild(elapsed);
    prog.appendChild(scrub);
    prog.appendChild(total);
    var note = el("span", "radio-np__note");   // playback notes (preview over,
    center.appendChild(meta);                  // catalog gap) — see tick()
    center.appendChild(prog);
    center.appendChild(note);
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
    var back = mk(ICON_BACK, S.ariaBack, function () { send("back"); });
    var play = mk(ICON_PLAY, S.ariaPlayPause, function () {
      send(model && model.transport.playing ? "pause" : "play");
    });
    play.classList.add("radio-np__btn--play");
    var next = mk(ICON_NEXT, S.ariaSkip, function () { send("skip"); });
    NP.appendChild(art);
    NP.appendChild(center);
    NP.appendChild(controls);
    npNodes = { art: art, img: img, count: count, title: title, artist: artist,
                fill: fill, note: note, play: play, back: back, next: next,
                elapsed: elapsed, total: total };
  }
  function mmss(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function renderNP() {
    if (!npNodes) buildNP();
    var n = npNodes;
    var cur = model.current;
    var t = model.transport;
    NP.classList.toggle("radio-np--idle", !cur);
    /* DeetsMusic's disabled-state handling, communal edition: back needs a
       history, play/skip need something to play */
    n.back.disabled = !(model.history && model.history.length);
    var dead = !cur && !model.queue.length;
    n.play.disabled = dead;
    n.next.disabled = dead;
    if (!cur) {
      n.title.textContent = S.npIdle;
      n.artist.textContent = S.npIdleSub;
      n.img.removeAttribute("src");
      /* drop has-art too — its opacity rule out-specifies the idle one, and
         a src-less img left visible renders as a broken-image glyph */
      NP.classList.remove("radio-np--has-art");
      NP.classList.remove("radio-np--counting");
      n.fill.style.width = "0%";
      n.elapsed.textContent = "";
      n.total.textContent = "";
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
  /* the 200 ms heartbeat: countdown digits + progress fill — and the
     playback follower's feed (it chases this view; docs/radio.md §Sync) */
  function tick() {
    if (!model || !npNodes) return;
    if (A) {
      A.follow({
        entry: model.current,
        playing: model.transport.playing,
        counting: counting(),
        expectedMs: position()
      });
      var k = A.note();
      npNodes.note.textContent =
        k === "preview" ? S.previewEnded :
        k === "gap"     ? S.catalogGap :
        k === "blocked" ? S.audioBlocked : "";
    }
    if (!model.current) return;
    var n = npNodes;
    n.total.textContent = mmss(model.current.durationMs);
    if (counting()) {
      var t = model.transport;
      var left = t.startedAt + (t.pausedPosition || 0) - roomNow();
      var digit = Math.min(3, Math.ceil(left / 1000));
      NP.classList.add("radio-np--counting");
      n.count.textContent = digit > 0 ? String(digit) : "";
      var frozen = Math.min(position(), model.current.durationMs);
      n.fill.style.width = (frozen / model.current.durationMs * 100).toFixed(2) + "%";
      n.elapsed.textContent = mmss(frozen);
    } else {
      NP.classList.remove("radio-np--counting");
      n.count.textContent = "";
      var pos = Math.min(position(), model.current.durationMs);
      n.fill.style.width = (pos / model.current.durationMs * 100).toFixed(2) + "%";
      n.elapsed.textContent = mmss(pos);
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
    if (!(opts && opts.noKebab)) {
      var kebab = el("button", "radio-row__act", "⋯");
      kebab.type = "button";
      kebab.setAttribute("data-kebab", "");
      kebab.setAttribute("aria-label", S.ariaMore);
      side.appendChild(kebab);
    }
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
        noKebab: true,   // right-click carries the queue menu; keeps rows narrow
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
        list.appendChild(row(entry, { noKebab: true, menu: function () { return historyMenu(entry); } }));
      });
      HISTORY_BODY.appendChild(list);
    }
  }
  /* Play Now / Play Next / Add to Queue, translated to room sends — for one
     track or a whole collection. "now"/"next" front-load in order (add at
     0,1,2… keeps the block together ahead of the old queue), "later"
     appends; "now" then skips to the front. When the room is idle, the
     first add alone starts it (skipping would blow past it). */
  function sendAll(tracks, how) {   // how: "now" | "next" | "later"
    if (!tracks.length) return;
    var hadCurrent = model && model.current;
    tracks.forEach(function (t, i) {
      send("add", how === "later" ? { entry: t } : { entry: t, at: i });
    });
    if (how === "now" && hadCurrent) send("skip");
  }
  function playNow(entry) { sendAll([entry], "now"); }
  /* album / playlist tiles carry the song menu over the whole collection —
     DeetsMusic's collectionMenu, tracks fetched lazily on pick */
  function collectionMenu(fetchSongs) {
    var pick = function (how) {
      fetchSongs().then(function (tracks) { sendAll(tracks, how); },
                        function () { toast(S.paneFailed, ""); });
    };
    return [
      { label: S.menuPlayNow, run: function () { pick("now"); } },
      { label: S.menuPlayNext, run: function () { pick("next"); } },
      { label: S.menuAddQueue, run: function () { pick("later"); } }
    ];
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
    paneStack = [];
    lastSections = null;
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
  /* DeetsMusic's search idiom, one-to-one: click a song = Play Now;
     the menu is Play Now / Play Next / Add to Queue. */
  function songMenu(t) {
    return [
      { label: S.menuPlayNow, run: function () { playNow(t); } },
      { label: S.menuPlayNext, run: function () { send("add", { entry: t, at: 0 }); } },
      { label: S.menuAddQueue, run: function () { send("add", { entry: t }); } }
    ];
  }
  function wireOpen(node, run) {
    node.classList.add("radio-row--click");
    node.setAttribute("role", "button");
    node.tabIndex = 0;
    node.addEventListener("click", run);
    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); run(); }
    });
  }
  function songSearchRow(t) {
    var li = row(t, { menu: function () { return songMenu(t); } });
    wireOpen(li, function () { playNow(t); });
    return li;
  }
  function songList(tracks) {
    var list = el("ol", "radio-list");
    tracks.forEach(function (t) { list.appendChild(songSearchRow(t)); });
    return list;
  }
  /* compact song cell for the two-row songs scroller (DeetsMusic
     .search__song) — same click/menu contract as a row */
  function songCell(t) {
    var d = el("div", "radio-scell");
    d.appendChild(rowArt(t));
    var text = el("span", "radio-row__text");
    text.appendChild(el("span", "radio-row__title", t.title));
    text.appendChild(el("span", "radio-row__artist", t.artist));
    d.appendChild(text);
    wireOpen(d, function () { playNow(t); });
    bindMenus(d, function () { return songMenu(t); });
    return d;
  }
  /* artist / album / playlist tiles — click drills in; albums and
     playlists also carry the collection menu on right-click */
  function tile(name, sub, artworkUrl, round, onOpen, menu) {
    var d = el("div", "radio-tile" + (round ? " radio-tile--artist" : ""));
    var a = el("span", "radio-tile__art");
    var img = el("img", artworkUrl ? "radio-tile__img" : "radio-cover-blank");
    img.alt = "";
    img.loading = "lazy";
    img.src = artworkUrl || "../assets/sprites/radio/cover-blank.svg";
    a.appendChild(img);
    d.appendChild(a);
    d.appendChild(el("span", "radio-tile__name", name));
    if (sub) d.appendChild(el("span", "radio-tile__sub", sub));
    wireOpen(d, onOpen);
    if (menu) bindMenus(d, menu);
    return d;
  }
  function albumTile(al, sub) {
    return tile(al.title, sub, al.artworkUrl, false, function () {
      openAlbum(al);
    }, function () {
      return collectionMenu(function () { return A.albumSongs(al.id); });
    });
  }
  function scroller(mod) {
    return el("div", "radio-scroller" + (mod ? " radio-scroller--" + mod : ""));
  }
  function group(label) { return el("div", "radio-who__group", label); }

  /* ── pane stack (DeetsMusic's spane idiom; back pops) ─────────── */
  var lastSections = null;   // last root results, so ‹ lands back cheaply
  var paneStack = [];        // re-render closures for the panes above root
  function repaintSearch() {
    var top = paneStack[paneStack.length - 1];
    if (top) top();
    else if (lastSections) renderSections(lastSections.sec, lastSections.term);
    else renderSearchEmpty();
  }
  function drawPane(title, fill) {
    var res = searchNodes.results;
    var seq = ++searchSeq;    // a new search or pane orphans this draw
    res.textContent = "";
    var head = el("div", "radio-pane__head");
    var back = el("button", "radio-row__act radio-pane__back", "‹");
    back.type = "button";
    back.setAttribute("aria-label", S.ariaPaneBack);
    back.addEventListener("click", function () {
      paneStack.pop();
      repaintSearch();
    });
    head.appendChild(back);
    head.appendChild(el("span", "radio-pane__title", title));
    res.appendChild(head);
    var body = el("div", "radio-pane__body");
    body.appendChild(el("p", "sotd__empty", S.paneLoading));
    res.appendChild(body);
    fill(body, function () { return seq === searchSeq; });
  }
  function pushPane(title, fill) {
    paneStack.push(function () { drawPane(title, fill); });
    drawPane(title, fill);
  }
  /* pane fills — each memoizes its fetch, so ‹ and re-draws are free */
  function songsFill(fetchSongs) {
    var cached = null;
    return function (body, fresh) {
      cached = cached || fetchSongs();
      cached.then(function (tracks) {
        if (!fresh()) return;
        body.textContent = "";
        if (!tracks.length) body.appendChild(el("p", "sotd__empty", S.paneEmpty));
        else body.appendChild(songList(tracks));
      }, function () {
        if (!fresh()) return;
        body.textContent = "";
        body.appendChild(el("p", "sotd__empty", S.paneFailed));
      });
    };
  }
  function openAlbum(al) {
    pushPane(al.title, songsFill(function () { return A.albumSongs(al.id); }));
  }
  /* artist pane: Albums scroller first, Top Songs under (DeetsMusic) */
  function artistFill(id) {
    var cached = null;
    return function (body, fresh) {
      cached = cached || A.artistDetail(id);
      cached.then(function (d) {
        if (!fresh()) return;
        body.textContent = "";
        if (d.albums.length) {
          body.appendChild(group(S.secAlbums));
          var sc = scroller("");
          d.albums.forEach(function (al) {
            sc.appendChild(albumTile(al, al.year));
          });
          body.appendChild(sc);
        }
        body.appendChild(group(S.paneTopSongs));
        if (!d.topSongs.length) body.appendChild(el("p", "sotd__empty", S.paneEmpty));
        else body.appendChild(songList(d.topSongs));
      }, function () {
        if (!fresh()) return;
        body.textContent = "";
        body.appendChild(el("p", "sotd__empty", S.paneFailed));
      });
    };
  }

  /* ── root sections: Artists · Songs · Albums · Playlists ──────── */
  function renderSections(sec, term) {
    var res = searchNodes.results;
    res.textContent = "";
    var albums = sec.albums || [];
    if (!sec.songs.length && !sec.artists.length && !albums.length && !sec.playlists.length) {
      res.appendChild(el("p", "sotd__empty", fmt(S.searchNoResults, { term: term })));
      return;
    }
    if (sec.artists.length) {
      res.appendChild(group(S.secArtists));
      var asc = scroller("");
      sec.artists.forEach(function (a) {
        asc.appendChild(tile(a.name, "", a.artworkUrl, true, function () {
          pushPane(a.name, artistFill(a.id));
        }));
      });
      res.appendChild(asc);
    }
    if (sec.songs.length) {
      res.appendChild(group(S.secSongs));
      var ssc = scroller("songs");
      sec.songs.forEach(function (t) { ssc.appendChild(songCell(t)); });
      res.appendChild(ssc);
    }
    if (albums.length) {
      res.appendChild(group(S.secAlbums));
      var alsc = scroller("");
      albums.forEach(function (al) {
        alsc.appendChild(albumTile(al, al.artist));
      });
      res.appendChild(alsc);
    }
    if (sec.playlists.length) {
      res.appendChild(group(S.secPlaylists));
      var psc = scroller("");
      sec.playlists.forEach(function (p) {
        psc.appendChild(tile(p.name, p.curator, p.artworkUrl, false, function () {
          pushPane(p.name, songsFill(function () { return A.playlistSongs(p.id); }));
        }, function () {
          return collectionMenu(function () { return A.playlistSongs(p.id); });
        }));
      });
      res.appendChild(psc);
    }
  }
  function runSearch(term) {
    var q = String(term || "").trim();
    var res = searchNodes.results;
    if (!q) { renderSearchEmpty(); return; }
    var seq = ++searchSeq;
    res.textContent = "";
    res.appendChild(el("p", "sotd__empty", S.searchBusy));
    /* real Apple catalog when a dev token is deployed; mock otherwise
       (the mock only knows songs — normalize its flat list) */
    var real = A && A.hasToken();
    var lookup = real ? A.search(q) : T.search(q).then(function (tracks) {
      return { songs: tracks, artists: [], albums: [], playlists: [] };
    });
    lookup.then(function (sec) {
      if (seq !== searchSeq) return;
      pushTerm(q);
      paneStack = [];          // a fresh search lands at the root
      lastSections = { sec: sec, term: q };
      renderSections(sec, q);
    }).catch(function () {
      if (seq !== searchSeq) return;
      res.textContent = "";
      res.appendChild(el("p", "sotd__empty", S.searchFailed));
    });
  }

  /* ── truncation tooltips ──────────────────────────────────────── */
  /* One delegated hover: any title/artist line that's actually ellipsized
     gets a native tooltip with the full text — no layout shift, and it
     stays quiet when nothing is cut off. */
  ROOM.addEventListener("mouseover", function (e) {
    var t = e.target;
    if (!t || !t.classList) return;
    if (t.classList.contains("radio-row__title") ||
        t.classList.contains("radio-row__artist") ||
        t.classList.contains("radio-hero__title") ||
        t.classList.contains("radio-np__title") ||
        t.classList.contains("radio-np__artist") ||
        t.classList.contains("radio-tile__name") ||
        t.classList.contains("radio-tile__sub") ||
        t.classList.contains("radio-pane__title")) {
      if (t.scrollWidth > t.clientWidth) t.title = t.textContent;
      else t.removeAttribute("title");
    }
  });

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
  BAR_INPUT.setAttribute("aria-label", S.ariaTuneIn);
  setMeta(metaIdle());
  setActiveCol("queue");
  var hashCode = slugify(location.hash.replace(/^#/, ""));
  if (hashCode) {
    BAR_INPUT.value = hashCode;
    commitCode(hashCode);
  }
  /* stations are links, even mid-session: a #code arriving while the page
     is open (pasted URL, back button) switches rooms like typing it would */
  window.addEventListener("hashchange", function () {
    var code = slugify(location.hash.replace(/^#/, ""));
    if (!code || code === roomCode) return;
    BAR_INPUT.value = code;
    commitCode(code);
  });
})();
