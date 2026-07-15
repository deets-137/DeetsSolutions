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

  /* Framed radio is the site-shell's go-home signal, never a second room.
     While the shell is up (see the site-shell section), every page of the
     site loads inside an iframe on TOP of the live radio page — including
     /radio/ itself when a framed page's nav points back here. Booting in
     that frame would peek, auto-join from a saved name or #code, and
     double-count a listener. So a framed radio page does exactly one
     thing: tell the parent to close the shell, then stay inert. */
  if (window.top !== window) {
    try { window.parent.postMessage({ deetsRadio: "home" }, location.origin); } catch (e) {}
    return;
  }

  var S = window.RADIO_STRINGS;
  var T = window.RadioTransport;
  var A = window.RadioApple;   // Apple side (search / auth / playback follower)
  var Y = window.RadioYouTube; // YouTube side (free full-track tier + player layer)
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
  var CREW = document.querySelector("[data-radio-crew]");
  var DESK = document.querySelector("[data-radio-desk]");

  var NAME_KEY = "deets-radio-name";
  var TOKEN_KEY = "deets-radio-token";
  var STATIONS_KEY = "deets-radio-stations";
  var TERMS_KEY = "deets-radio-search-recents";
  var PREVIEWS_KEY = "deets-radio-previews";
  var UP_NEXT_CAP = 50;
  var LIST_CAP = 50;

  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  var ICON_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6v12h2V6zM20 6 10 12 20 18z"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6 14 12 4 18zM16 6v12h2V6z"/></svg>';
  /* shell-strip stand-ins: a radio (home to the station) and an
     unplugged plug (disconnect) — line icons, ICON_CHECK's idiom */
  var ICON_RADIO = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9 18 4"/><rect x="3.5" y="9" width="17" height="11" rx="2"/><circle cx="9" cy="14.5" r="2.5"/><path d="M15 12.5h3M15 15h3M15 17.5h2"/></svg>';
  var ICON_UNPLUG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 8.5h3a3.5 3.5 0 0 1 0 7H9z"/><path d="M15.5 10.5H19M15.5 13.5H19"/><path d="M9 12H6.5C4.7 12 4 13.3 4 15v2"/><path d="M20.5 7.5 22 6M20.5 16.5 22 18"/></svg>';
  /* account-state sigils — DeetsMusic's login button anatomy (main.ts) */
  var ICON_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_X = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ICON_WAIT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h8M4 14h8M5 2c0 5 6 5 6 12M11 2c0 5-6 5-6 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
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
  /* The device token (docs/radio.md, "Listener identity & queue
     permissions"): a random secret minted once per browser, sent on every
     join. It's what capability grants and ownership anchor to — never the
     editable display name — and it never rides any broadcast. */
  function deviceToken() {
    var t = load(TOKEN_KEY, null);
    if (t) return t;
    var bytes = new Uint8Array(16);
    try { crypto.getRandomValues(bytes); } catch (e) {
      for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    t = Array.prototype.map.call(bytes, function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
    save(TOKEN_KEY, t);
    return t;
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
  /* Transient pops ride the site's shared toast host (js/toast.js) —
     it floats over the site-shell, so the room reaches you while you
     browse; the meta line stays for persistent status. Falls back to
     the meta line if the module didn't load. */
  function notify(kind, text, extra) {
    if (window.DeetsToast) {
      var opts = extra || {};
      opts.kind = kind;
      opts.text = text;
      return window.DeetsToast.push(opts);
    }
    toast(text, "");
    return { dismiss: function () {} };
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
    if (!items.length) return;   // caps may have emptied a row's menu
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
  var connToast = null;     // the sticky disconnected toast (see onStatus)
  var blockedToast = null;  // the sticky audio-blocked toast (see tick)
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
  /* Capabilities (docs/radio.md, "Listener identity & queue permissions"):
     mine ride the roster the server broadcasts. The checks here only shape
     affordances — enforcement is the room's, always. */
  function amOwner() {
    return !!model && model.owner != null && model.owner === model.you;
  }
  function myCaps() {
    var me = model && model.listeners && model.listeners[model.you];
    return (me && me.caps) || { queue: "e", player: "e" };
  }
  function canQueue() { return myCaps().queue === "e"; }
  function canPlayer() { return myCaps().player === "e"; }
  function roomMode() {
    return model && model.room && model.room.settings &&
           model.room.settings.mode === "restricted" ? "restricted" : "open";
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
  function renderGate(code, p, nameTaken) {
    GATE.hidden = false;
    GATE.textContent = "";
    var line, button;
    if (nameTaken) {
      /* the join bounced off the room's unique-name rule — same gate,
         name field forced so a new tag can be picked */
      line = S.nameTaken;
      button = S.joinButton;
    } else if (p.exists) {
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
    if (!stored || nameTaken) {       // name is asked once, then remembered
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
    return T.connect(code, {
      name: who, create: !!create, token: deviceToken()
    }).then(function (c) {
      joining = false;
      conn = c;
      roomCode = code;
      joined = true;
      conn.onMessage(onMessage);
      /* the real transport reports drops + rejoins; the mock has no wire.
         Down = persistent meta + a sticky toast (its Dismiss is the one
         action button); the reconnect retires the toast itself. */
      if (conn.onStatus) conn.onStatus(function (s) {
        if (!joined) return;
        if (s === "down") {
          setMeta(S.disconnected);
          if (!connToast) connToast = notify("error", S.disconnected, {
            sticky: true, actions: [{ label: S.toastDismiss }]
          });
        } else {
          if (connToast) { connToast.dismiss(); connToast = null; }
          setMeta("");
          notify("success", S.reconnected);
        }
      });
      rememberStation(code);
      try { history.replaceState(null, "", "#" + code); } catch (e) {}
    }).catch(function (err) {
      joining = false;
      var code2 = err && err.code;
      if (code2 === "name-taken") {          // someone in there wears this name
        renderGate(code, { exists: true }, true);
        return;
      }
      setMeta(code2 === "no-room" ? S.joinRefused :
              code2 === "full" ? S.roomFull : S.peekFailed);
    });
  }
  function leaveRoom() {
    /* Leaving from inside the shell: shellClose()'s history.back() lands
       on an entry that still carries #code, and that hashchange would
       re-commit the room we're leaving — a disconnect (or kick, or room
       close) would silently boomerang right back in. Arm a one-shot
       guard so the hashchange listener can swallow its own echo. */
    if (shell && shell.open) hashEcho = { code: roomCode, at: Date.now() };
    shellClose();            // no room, no shell — land back on the gate
    if (connToast) { connToast.dismiss(); connToast = null; }
    if (blockedToast) { blockedToast.dismiss(); blockedToast = null; }
    if (silenceToast) { silenceToast.dismiss(); silenceToast = null; }
    if (pendingToast) { pendingToast.dismiss(); pendingToast = null; }
    pendingToastN = -1;   // a rejoin re-raises the nudge
    if (A) A.stop();
    if (Y) Y.stop();
    activeEngine = null;
    NP.classList.remove("radio-np--video");   // hero size resets at the gate
    if (conn) conn.close();
    conn = null;
    model = null;
    joined = false;
    inRoom = false;
    roomCode = null;
    ROOM.hidden = true;
    GATE.hidden = true;
    if (CREW) { CREW.hidden = true; CREW.textContent = ""; }
    if (DESK) { DESK.hidden = true; DESK.textContent = ""; deskSel = null; }
    buildToolbar();
    META.hidden = false;      // the gate's status line is back in play
    setMeta(metaIdle());
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }

  /* ── site-shell: browse the site while the room plays ─────────── */
  /* No browser lets audio survive a real navigation, so while joined the
     shell inverts the site: a header nav click loads that page in a
     full-viewport same-origin iframe OVER this one, and the radio page —
     socket, MusicKit, room clock — never unloads. The framed page needs
     no changes and doesn't know it's framed; its own header (nav, Vibe
     picker) is THE header while browsing. The room UI reparents into a
     gutter dock beside the frame — the NP strip re-stacked as a square
     player over the tabbed columns (same live nodes, so queue drag,
     menus, search panes, and the countdown all ride along) — and CSS
     collapses the dock to a bottom strip when the gutter is too thin.
     Coming home (dock pill, Back past the first framed page, or any
     framed page navigating to /radio/ — see the framed-guard up top)
     reparents everything where it was. The address bar stays on
     /radio/#code the whole time: that IS the page you're on. */
  var shell = null;          // { root, slot, frame, open }
  var hashEcho = null;       // leaveRoom's history.back() echo (see there)
  function buildShell() {
    var root = el("div", "radio-shell");
    root.hidden = true;
    var dock = el("aside", "radio-shell__dock");
    var ret = el("button", "tb-pill radio-shell__return");
    ret.type = "button";
    ret.appendChild(el("span", "tb-pill__label", S.shellReturn));
    ret.addEventListener("click", function () { shellClose(); });
    var slot = el("div", "radio-shell__slot");
    dock.appendChild(ret);
    dock.appendChild(slot);
    root.appendChild(dock);
    document.body.appendChild(root);
    shell = { root: root, slot: slot, frame: null, open: false };
  }
  function shellOpen(path) {
    if (!shell) buildShell();
    if (!shell.open) {
      shell.open = true;
      shell.slot.appendChild(NP);
      shell.slot.appendChild(TABS);
      shell.slot.appendChild(COLS);
      shell.root.hidden = false;
      document.documentElement.setAttribute("data-radio-shell", "");
      /* one entry, so Back past the framed page closes the shell (the
         frame's own navigations stack their entries on top of this) */
      try { history.pushState({ radioShell: true }, ""); } catch (e) {}
    }
    /* a fresh iframe per visit: removing it on close collapses the
       frame's session-history entries, so the close-pill's history.back()
       reliably pops OUR entry instead of walking dead framed pages */
    if (shell.frame) shell.frame.remove();
    var frame = el("iframe", "radio-shell__frame");
    frame.setAttribute("title", S.ariaShellPage);
    frame.src = path;
    shell.root.insertBefore(frame, shell.root.firstChild);
    shell.frame = frame;
  }
  function shellClose(fromPop) {
    if (!shell || !shell.open) return;
    shell.open = false;
    if (shell.frame) { shell.frame.remove(); shell.frame = null; }
    shell.root.hidden = true;
    document.documentElement.removeAttribute("data-radio-shell");
    /* home, in markup order (np · tabs · columns) — anchored BEFORE the
       crew panel, which stays in ROOM and would otherwise end up on top */
    var anchor = CREW && CREW.parentNode === ROOM ? CREW : null;
    ROOM.insertBefore(NP, anchor);
    ROOM.insertBefore(TABS, anchor);
    ROOM.insertBefore(COLS, anchor);
    if (!fromPop) { try { history.back(); } catch (e) {} }
  }
  window.addEventListener("popstate", function () {
    shellClose(true);
  });
  /* a framed /radio/ page announcing itself (see the framed-guard) */
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin) return;
    if (e.data && e.data.deetsRadio === "home") shellClose();
  });
  /* While joined, same-origin page links in OUR header open the shell
     instead of navigating (navigation kills the music). Modified clicks,
     new-tab targets, and external links keep their native behavior; a
     click on this page's own nav entry becomes a no-op rather than a
     music-killing reload. */
  document.addEventListener("click", function (e) {
    if (!joined || e.defaultPrevented || e.button !== 0 ||
        e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest(".site-header a") : null;
    if (!a || (a.target && a.target !== "_self")) return;
    var url;
    try { url = new URL(a.getAttribute("href") || "", location.href); } catch (err) { return; }
    if (url.origin !== location.origin) return;
    e.preventDefault();
    var here = location.pathname.replace(/\/?$/, "/");
    if (url.pathname.replace(/\/?$/, "/") === here) return;   // already home
    shellOpen(url.pathname + url.search);
  });
  /* Theme/skin changes made INSIDE a framed page write localStorage; the
     storage event carries them back so this page (the dock, the room
     behind the frame) never falls out of step. The layers (ocean/storm)
     are always injected and opt in by attribute, so the attribute IS the
     switch; the deets:appearance event brings our own Vibe menu's checks
     along (controls.js listens for it). */
  window.addEventListener("storage", function (e) {
    var attr = e.key === "deets-theme" ? "data-theme" :
               e.key === "deets-skin" ? "data-skin" : null;
    if (!attr || !e.newValue) return;
    document.documentElement.setAttribute(attr, e.newValue);
    try {
      document.dispatchEvent(new CustomEvent("deets:appearance", {
        detail: { attr: attr, id: e.newValue }
      }));
    } catch (err) {}
  });

  /* ── wire in ──────────────────────────────────────────────────── */
  function onMessage(msg) {
    if (msg.serverNow) noteClock(msg.serverNow);
    if (msg.type === "snapshot") {
      model = {
        v: msg.v, room: msg.room, transport: msg.transport, current: msg.current,
        queue: msg.queue, history: msg.history, listeners: msg.listeners,
        owner: msg.owner, you: msg.you
      };
      enterRoomUI();
      renderAll();
      return;
    }
    if (msg.type === "closed") {   // the owner signed the station off
      leaveRoom();
      notify("info", S.roomClosed);
      setMeta(S.roomClosed);       // after notify: its meta fallback would
      return;                      // otherwise revert-erase this line
    }
    if (msg.type === "kicked") {   // the owner's ✕ — a kick is just a kick
      leaveRoom();
      notify("error", S.kickedMeta);
      setMeta(S.kickedMeta);
      return;
    }
    if (msg.type === "error") {
      if (msg.code === "perm") { notify("warn", S.permDenied); return; }
      if (msg.code === "name-taken" || msg.code === "full") {
        /* a rejoin was refused mid-session (name grabbed while we were
           down / room filled up) — land back at the gate */
        var c = roomCode;
        leaveRoom();
        if (msg.code === "full") setMeta(S.roomFull);
        else renderGate(c, { exists: true }, true);
      }
      return;
    }
    if (!model) return;
    if (msg.type === "presence") {
      model.listeners = msg.listeners;
      model.owner = msg.owner;     // creator's token, join-order fallback
      model.you = msg.you;
      /* caps ride presence, and they gate transport buttons, drag, and
         menus everywhere — re-render the lot, it's cheap and rare */
      renderAll();
      return;
    }
    if (msg.type === "state") {
      model.v = msg.v;
      ["transport", "current", "queue", "history", "room"].forEach(function (k) {
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
      var done = function () { notify("success", S.shareToast); };
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
    /* Close Room — the owner's one power. Hidden for everyone else
       (renderListeners toggles it as ownership passes); closing is the
       one irreversible act, so it asks to be pressed twice. */
    var close = el("button", "tb-pill radio-close");
    close.type = "button";
    close.hidden = true;
    var closeLabel = el("span", "tb-pill__label", S.closePill);
    close.appendChild(closeLabel);
    var armed = null;
    close.addEventListener("click", function () {
      if (!armed) {
        closeLabel.textContent = S.closeConfirm;
        armed = setTimeout(function () {
          armed = null;
          closeLabel.textContent = S.closePill;
        }, 4000);
        return;
      }
      clearTimeout(armed);
      send("close");
    });
    pills.close = close;
    TOOLBAR.appendChild(close);
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
    /* DeetsMusic's presentation minus its status line (his call,
       2026-07-15): two sources stacked, and the icon IS the status —
       check in, ✕ out, spinner while working; aria-pressed says it
       for screen readers */
    var acct = el("div", "radio-acct");
    var btn = el("button", "radio-acct__btn");
    btn.type = "button";
    btn.appendChild(el("span", "radio-acct__label", S.acctLabel));
    var icon = el("span", "radio-acct__icon");
    icon.setAttribute("aria-hidden", "true");
    btn.appendChild(icon);
    acct.appendChild(btn);
    var setAcct = function (state) {   // "in" | "out" | "loading"
      icon.innerHTML = state === "in" ? ICON_CHECK : state === "out" ? ICON_X : ICON_SPINNER;
      if (state !== "loading") {
        btn.dataset.state = state;
        btn.setAttribute("aria-pressed", String(state === "in"));
      }
      btn.disabled = state === "loading";
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
    /* YouTube box — account anatomy, no account: its one control is the
       enable toggle (docs/youtube.md; the free full-track tier) */
    if (Y) {
      var yt = el("div", "radio-acct");
      var ybtn = el("button", "radio-acct__btn");
      ybtn.type = "button";
      ybtn.appendChild(el("span", "radio-acct__label", S.ytLabel));
      var yicon = el("span", "radio-acct__icon");
      yicon.setAttribute("aria-hidden", "true");
      ybtn.appendChild(yicon);
      var setYt = function () {
        var on = Y.enabled();
        yicon.innerHTML = on ? ICON_CHECK : ICON_X;
        ybtn.dataset.state = on ? "in" : "out";
        ybtn.setAttribute("aria-pressed", String(on));
      };
      setYt();
      ybtn.addEventListener("click", function () {
        Y.setEnabled(!Y.enabled());
        setYt();
      });
      yt.appendChild(ybtn);
      pop.appendChild(yt);
    }
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
    var crowd = model.listeners || [];   // roster objects: { name, h, caps }
    pills.listening.pill.querySelector(".tb-pill__label").textContent =
      fmt(S.listeningPill, { n: crowd.length });
    if (pills.listeningPop) {
      pills.listeningPop.textContent = "";
      crowd.forEach(function (l, i) {
        var row = el("div", "radio-listener", l.name);
        if (i === model.owner) {   // the arrow points at the room's owner
          row.appendChild(el("span", "radio-listener__owner", "←"));
        }
        pills.listeningPop.appendChild(row);
      });
    }
    if (pills.close) pills.close.hidden = !amOwner();
  }

  /* ── crew panel: the always-up roster under the columns ───────── */
  /* Everyone sees the same panel; non-owners read it as a plain list.
     The owner's edition adds, per listener, two R|E split pills — queue
     edits and player control, the two capabilities — plus the kick ✕
     (a kick is just a kick: disconnect, no ban), and the room-mode
     dropdown top-right (Open joins land e|e, Restricted joins land r|r).
     Grants/kicks target the roster's opaque handles, never names. */
  function capPill(l, cap, locked) {
    var wrap = el("span", "radio-cap");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label",
      fmt(cap === "queue" ? S.ariaCapQueue : S.ariaCapPlayer, { name: l.name }));
    [["r", S.capR], ["e", S.capE]].forEach(function (lv) {
      var b = el("button", "radio-cap__seg", lv[1]);
      b.type = "button";
      b.dataset.level = lv[0];
      var on = (l.caps && l.caps[cap]) === lv[0];
      b.setAttribute("aria-pressed", String(on));
      b.disabled = locked;
      if (!locked && !on) b.addEventListener("click", function () {
        send("setCap", { t: l.h, cap: cap, level: lv[0] });
      });
      wrap.appendChild(b);
    });
    return wrap;
  }
  function renderCrew() {
    if (!CREW || !model) return;
    CREW.hidden = false;
    CREW.textContent = "";
    var owner = amOwner();
    var head = el("div", "radio-crew__head");
    head.appendChild(el("span", "radio-crew__title", S.crewTitle));
    if (owner) {
      /* room-mode dropdown — the popover kit, panel edition */
      var ctrl = el("div", "tb-ctrl radio-crew__mode");
      var pill = el("button", "tb-pill");
      pill.type = "button";
      pill.setAttribute("aria-haspopup", "true");
      pill.setAttribute("aria-expanded", "false");
      pill.appendChild(el("span", "tb-pill__label",
        roomMode() === "restricted" ? S.modeRestricted : S.modeOpen));
      pill.appendChild(el("span", "tb-pill__caret", "▾"));
      var pop = el("div", "tb-pop");
      pop.hidden = true;
      pop.setAttribute("role", "menu");
      var entry = { ctrl: ctrl, pill: pill, pop: pop };
      [["open", S.modeOpen], ["restricted", S.modeRestricted]].forEach(function (m) {
        var b = optButton(m[1], function () {
          closePop();
          send("setMode", { mode: m[0] });
        });
        if (m[0] === roomMode()) b.classList.add("is-active");
        pop.appendChild(b);
      });
      pill.addEventListener("click", function () { togglePop(entry); });
      ctrl.appendChild(pill);
      ctrl.appendChild(pop);
      head.appendChild(ctrl);
    } else {
      head.appendChild(el("span", "radio-crew__modenote",
        roomMode() === "restricted" ? S.modeRestricted : S.modeOpen));
    }
    CREW.appendChild(head);
    var grid = el("div", "radio-crew__grid" + (owner ? " radio-crew__grid--owner" : ""));
    if (owner) {
      grid.appendChild(el("span", "radio-crew__col"));   // name column, unlabeled
      grid.appendChild(el("span", "radio-crew__col", S.crewColQueue));
      grid.appendChild(el("span", "radio-crew__col", S.crewColPlayer));
      grid.appendChild(el("span", "radio-crew__col"));   // the ✕ column
    }
    (model.listeners || []).forEach(function (l, i) {
      var name = el("span", "radio-crew__name", l.name);
      if (i === model.owner) name.appendChild(el("span", "radio-listener__owner", "←"));
      grid.appendChild(name);
      if (!owner) return;
      var lockedRow = i === model.owner;   // the owner's own caps don't toggle
      grid.appendChild(capPill(l, "queue", lockedRow));
      grid.appendChild(capPill(l, "player", lockedRow));
      var x = el("button", "radio-crew__kick");
      x.type = "button";
      x.innerHTML = ICON_X;
      x.setAttribute("aria-label", fmt(S.ariaKick, { name: l.name }));
      if (i === model.you || lockedRow) {
        x.disabled = true;                 // no self-kick, no kicking the owner
      } else {
        x.addEventListener("click", function () { send("kick", { t: l.h }); });
      }
      grid.appendChild(x);
    });
    CREW.appendChild(grid);
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
    /* in-room the meta line is dead air — its one in-room message
       (disconnected) rides the sticky toast now, so the reserved line
       + margin collapse and the room scoots up under the bar. It
       returns with the gate (leaveRoom), where its copy lives. */
    META.hidden = true;
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
    syncPendingToast();   // parked matches survive reloads — nudge on entry
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
  var activeEngine = null;   // whichever follower tick() is feeding (A or Y)
  var silenceToast = null;   // the sticky personal-silence toast (see tick)
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
    /* the video layer rect-tracks this node wherever it reparents
       (docs/youtube.md, "The player layer") */
    if (Y) Y.attachTo(art);
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
    /* shell-strip stand-ins, riding INSIDE the card under the transport
       (CSS shows them only in the bottom strip, where the return pill is
       hidden): Radio Room = home, Disconnect asks twice like Close Room */
    var actions = el("div", "radio-shell__actions");
    var room = el("button", "tb-pill radio-shell__room");
    room.type = "button";
    room.innerHTML = ICON_RADIO;
    room.setAttribute("aria-label", S.shellRoomPill);
    room.addEventListener("click", function () { shellClose(); });
    var leave = el("button", "tb-pill radio-shell__leave");
    leave.type = "button";
    leave.setAttribute("aria-label", S.leavePill);
    var leaveLabel = el("span", "tb-pill__label");
    leaveLabel.innerHTML = ICON_UNPLUG;
    leave.appendChild(leaveLabel);
    var leaveArmed = null;
    leave.addEventListener("click", function () {
      if (!leaveArmed) {
        /* armed = checkmark + "?" — same footprint as the icon, no
           text-width jump (Aditya's call) */
        leaveLabel.innerHTML = ICON_CHECK;
        leaveLabel.appendChild(document.createTextNode(S.shellLeaveConfirm));
        leaveArmed = setTimeout(function () {
          leaveArmed = null;
          leaveLabel.innerHTML = ICON_UNPLUG;
        }, 4000);
        return;
      }
      clearTimeout(leaveArmed);
      leaveArmed = null;
      leaveLabel.innerHTML = ICON_UNPLUG;
      leaveRoom();
    });
    actions.appendChild(room);
    actions.appendChild(leave);
    NP.appendChild(art);
    NP.appendChild(center);
    NP.appendChild(controls);
    NP.appendChild(actions);
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
       history, play/skip need something to play — and all three need the
       player capability (Restricted rooms hand it out; docs/radio.md) */
    var lock = !canPlayer();
    n.back.disabled = lock || !(model.history && model.history.length);
    var dead = !cur && !model.queue.length;
    n.play.disabled = lock || dead;
    n.next.disabled = lock || dead;
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
    /* engine mux (docs/youtube.md) — PER-ENTRY since YT-first adds:
       Apple keeps an entry only when it can actually play it (connected
       AND the entry carries an apple id) — a YT-only add goes to video
       even for Apple subscribers; else YouTube when the entry has a
       video and the box is enabled; else apple.js lands on previews /
       the gap note internally. Exactly one engine follows; a switch
       stops the loser. The hero holds video size for the whole session
       once YouTube first plays (no per-track height bounce). */
    var eng = A;
    var appleFull = A && A.authorized() &&
                    model.current && model.current.apple && model.current.apple.id;
    if (Y && !appleFull && Y.playable(model.current) === "video") eng = Y;
    if (eng !== activeEngine) {
      if (activeEngine) activeEngine.stop();
      activeEngine = eng;
    }
    if (eng === Y && !NP.classList.contains("radio-np--video")) {
      NP.classList.add("radio-np--video");
    }
    var k = null;
    if (eng) {
      eng.follow({
        entry: model.current,
        playing: model.transport.playing,
        counting: counting(),
        expectedMs: position()
      });
      k = eng.note();
      npNodes.note.textContent =
        k === "preview" ? S.previewEnded :
        k === "gap"     ? S.catalogGap :
        k === "off"     ? S.silenceOff : "";
      /* blocked is a page-wide condition, not a track note: a sticky red
         toast — and the unblocking click is itself what retires it (the
         follower's next tick clears the note, we dismiss here) */
      if (k === "blocked") {
        if (!blockedToast) blockedToast = notify("error", S.audioBlocked, { sticky: true });
      } else if (blockedToast) {
        blockedToast.dismiss();
        blockedToast = null;
      }
    }
    /* Personal silence (2026-07-15, Aditya's calls from live testing): a
       room that plays while THIS device hears nothing must say so — ONE
       red sticky toast for as long as it lasts (retired the moment audio
       comes back or the room idles; his copy), and the progress row
       parks (empty + dimmed) instead of rolling. The room clock is
       untouched; the bar simply shows what YOU hear, not what the room
       does. Raised before the no-current return so an emptied queue
       can't strand it. */
    var silentNow = !!model.current && model.transport.playing && !counting() &&
                    (k === "gap" || k === "preview" || k === "off");
    if (silentNow) {
      if (!silenceToast) silenceToast = notify("error", S.silenceOff, { sticky: true });
    } else if (silenceToast) {
      silenceToast.dismiss();
      silenceToast = null;
    }
    if (!model.current) return;
    var n = npNodes;
    NP.classList.toggle("radio-np--muted", silentNow);
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
      if (silentNow) {
        n.fill.style.width = "0%";
        n.elapsed.textContent = "";
      } else {
        var pos = Math.min(position(), model.current.durationMs);
        n.fill.style.width = (pos / model.current.durationMs * 100).toFixed(2) + "%";
        n.elapsed.textContent = mmss(pos);
      }
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
          /* every queue-menu item mutates; read-only caps empty it and
             openMenu stays shut (items() runs at open time, so a grant
             mid-session takes effect without a re-render) */
          if (!canQueue()) return [];
          return [
            { label: S.menuPlayNext, run: function () { send("reorder", { entryId: entry.entryId, to: 0 }); } },
            { label: S.menuMoveTop, run: function () { send("reorder", { entryId: entry.entryId, to: 0 }); } },
            { label: S.menuMoveBottom, run: function () { send("reorder", { entryId: entry.entryId, to: model.queue.length - 1 }); } },
            { label: S.menuRemove, run: function () { send("remove", { entryId: entry.entryId }); } },
            /* jumps to the match desk with this row selected */
            { label: S.menuFixVideo, run: function () {
              deskSelect(entry.entryId);
              if (DESK) DESK.scrollIntoView({ behavior: "smooth", block: "nearest" });
            } }
          ];
        }
      });
      li.draggable = canQueue();
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
  function sendAll(tracks, how, src) {   // how: "now" | "next" | "later"
    if (!tracks.length) return;
    /* the one funnel every add takes (search click, menus, collections) —
       a read-only queue cap stops it here with the note, before any send.
       src is the D1 provenance of an adder-attached video block: YT-first
       adds ride "manual" (human-picked video); everything else omits it. */
    if (!canQueue()) { toast(S.permDenied, ""); return; }
    var hadCurrent = model && model.current;
    tracks.forEach(function (t, i) {
      var msg = how === "later" ? { entry: t } : { entry: t, at: i };
      if (src) msg.source = src;
      send("add", msg);
    });
    if (how === "now" && hadCurrent) send("skip");
  }
  function playNow(entry, src) { sendAll([entry], "now", src); }
  /* album / playlist tiles carry the song menu over the whole collection —
     DeetsMusic's collectionMenu, tracks fetched lazily on pick */
  function collectionMenu(fetchSongs) {
    if (!canQueue()) return [];      // every item queues; read-only = no menu
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
    if (!canQueue()) return [];      // every item queues; read-only = no menu
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
    } else if (S.searchEmpty) {
      res.appendChild(el("p", "sotd__empty", S.searchEmpty));
    }
  }
  /* DeetsMusic's search idiom, one-to-one: click a song = Play Now;
     the menu is Play Now / Play Next / Add to Queue (+ Go to Artist on
     real catalog tracks). */
  function songMenu(t, src) {
    var items = canQueue() ? [
      { label: S.menuPlayNow, run: function () { playNow(t, src); } },
      { label: S.menuPlayNext, run: function () { sendAll([t], "next", src); } },
      { label: S.menuAddQueue, run: function () { sendAll([t], "later", src); } }
    ] : [];   // read-only queue: the drills below still work
    if (canDrillArtist(t.apple && t.apple.id)) {
      items.push({ label: S.menuGoArtist, run: function () {
        setActiveCol("search");          // the drill lands in the search column
        goToArtist("songs", t.apple.id, t.artist);
      } });
    }
    return items;
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
  function songSearchRow(t, src) {
    var li = row(t, { menu: function () { return songMenu(t, src); } });
    wireOpen(li, function () { playNow(t, src); });
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
  /* withArtist mirrors DeetsMusic: Go to Artist only where the album's
     artist isn't already on screen (root results, not the artist pane) */
  function albumTile(al, sub, withArtist) {
    return tile(al.title, sub, al.artworkUrl, false, function () {
      openAlbum(al);
    }, function () {
      var items = collectionMenu(function () { return A.albumSongs(al.id); });
      if (withArtist && canDrillArtist(al.id)) {
        items.push({ label: S.menuGoArtist, run: function () {
          goToArtist("albums", al.id, al.artist || "");
        } });
      }
      return items;
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
    var titleEl = el("span", "radio-pane__title", title);
    head.appendChild(titleEl);
    res.appendChild(head);
    var body = el("div", "radio-pane__body");
    body.appendChild(el("p", "sotd__empty", S.paneLoading));
    res.appendChild(body);
    fill(body, function () { return seq === searchSeq; },
         function (t) { titleEl.textContent = t; });   // late relabel (go-to drills)
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
  /* Go to Artist — DeetsMusic's drillRelated: the pane opens at once on the
     fallback name (the row's own artist string), the catalog id resolves
     via one memoized hop, then the pane relabels and fills in place. */
  function goToArtist(kind, id, fallbackName) {
    var fillCache = null;                // ‹ back re-draws reuse the fill
    pushPane(fallbackName, function (body, fresh, setTitle) {
      A.relatedArtist(kind, id).then(function (a) {
        if (!fresh()) return;
        if (!a) {
          body.textContent = "";
          body.appendChild(el("p", "sotd__empty", S.paneFailed));
          return;
        }
        setTitle(a.name || fallbackName);
        fillCache = fillCache || artistFill(a.id);
        fillCache(body, fresh);
      }, function () {
        if (!fresh()) return;
        body.textContent = "";
        body.appendChild(el("p", "sotd__empty", S.paneFailed));
      });
    });
  }
  /* real catalog items only — the mock knows no artists to go to */
  function canDrillArtist(appleId) {
    return !!(A && A.hasToken() && appleId && String(appleId).indexOf("mock.") !== 0);
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
        alsc.appendChild(albumTile(al, al.artist, true));
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
    /* YT-first adds (docs/youtube.md): a pasted YouTube link takes the
       lookup → reverse-match path instead of Apple search. URLs stay out
       of the Recents chips (pushTerm is the Apple path's). */
    var ytId = parseYtId(q);
    if (ytId) { runYtAdd(ytId); return; }
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

  /* ── YT-first adds (docs/youtube.md, "YouTube-first adds") ──────
     Paste a link → one 1-unit videos.list (title/channel/thumb/duration/
     embeddable) → title-parse guess → FREE Apple reverse-match at the
     resolver's ±2 s rule → a one-result pane: a matched link mints the
     full dual entry, a miss mints a YT-only entry (apple: null, the
     video thumb as artwork). Adds ride source "manual" — the pasted
     video is a human pick, curated-grade D1 provenance. */
  function pickByDuration(songs, ms) {
    for (var i = 0; i < (songs || []).length; i++) {
      var d = songs[i].durationMs || 0;
      if (d && Math.abs(d - ms) <= 2000) return songs[i];
    }
    return null;
  }
  function runYtAdd(id) {
    var res = searchNodes.results;
    var seq = ++searchSeq;
    res.textContent = "";
    paneStack = [];
    lastSections = null;
    res.appendChild(el("p", "sotd__empty", S.ytAddBusy));
    /* videos.list is the full path (real duration + embeddable). When it
       can't run — key parked, quota dry, API flaky — keyless oEmbed is
       the fallback: enough metadata to reverse-match on Apple, whose
       clone carries the load-bearing durationMs (the room alarm
       schedules off it). So MATCHED pastes survive keyless; a YT-only
       entry can't exist without a real duration, so an unmatched
       keyless paste parks at the desk instead of minting
       (docs/youtube.md, "YouTube-first adds" + "Pending matches"). */
    var lookP = Y ? Y.lookup(id) : Promise.resolve(null);
    lookP.then(function (info) {
      if (seq !== searchSeq) return;
      if (info && info.durationMs) { ytMatch(seq, info, false); return; }
      var oeP = Y ? Y.oembed(id) : Promise.resolve(null);
      oeP.then(function (oe) {
        if (seq !== searchSeq) return;
        if (!oe) {
          res.textContent = "";
          res.appendChild(el("p", "sotd__empty", S.ytAddFailed));
          return;
        }
        ytMatch(seq, oe, true);
      });
    });
  }
  function ytMatch(seq, info, keyless) {
    var res = searchNodes.results;
    var parsed = Y.parseTitle(info.title, info.channel);
    var q1 = parsed.artist ? parsed.artist + " " + parsed.title : parsed.title;
    /* keyless has no duration to test against — take the top hit; the
       one-result pane is human-reviewed before anything adds, and the
       eyeballs are the verification the duration test stood in for */
    var pick = keyless
      ? function (songs) { return (songs && songs[0]) || null; }
      : function (songs) { return pickByDuration(songs, info.durationMs); };
    var matchP = (A && A.hasToken() && q1)
      ? A.search(q1).then(function (sec) {
          var hit = pick(sec.songs);
          if (hit || !parsed.artist) return hit;
          /* one retry on the bare title — artist guesses miss more */
          return A.search(parsed.title).then(function (sec2) {
            return pick(sec2.songs);
          });
        }).catch(function () { return null; })
      : Promise.resolve(null);
    matchP.then(function (song) {
      if (seq !== searchSeq) return;
      if (keyless && !song) {
        /* no auto-match and no duration to mint with — park it at the
           desk (device-local) and let a human link the AM song there
           (docs/youtube.md, "Pending matches") */
        addPending({ id: info.id, title: info.title, channel: info.channel });
        res.textContent = "";
        res.appendChild(el("p", "sotd__empty", S.ytAddParked));
        renderDesk();
        syncPendingToast();
        return;
      }
      renderYtPane(info, parsed, song);
    });
  }
  function renderYtPane(info, parsed, song) {
    var res = searchNodes.results;
    res.textContent = "";
    var entry;
    if (song) {
      entry = JSON.parse(JSON.stringify(song));
    } else {
      entry = {
        isrc: null,
        title: parsed.title || info.title,
        artist: parsed.artist || "",
        album: "",
        artworkUrl: info.thumb,      // https i.ytimg.com — passes sanitizeEntry
        apple: null,
        spotify: null,
        previewUrl: null,
        durationMs: info.durationMs,
        match: "single"
      };
    }
    var statusText = song ? S.ytAddMatched : S.ytAddVideoOnly;
    if (info.embeddable) {
      entry.youtube = { id: info.id, durationMs: info.durationMs };
    } else {
      /* the artist turned embedding off — that exact video can never play
         in the room, so it doesn't ride (Aditya, 2026-07-15). A matched
         entry still adds clean (resolveSweep finds a playable video like
         any Apple add); a miss adds video-less — the desk is the fix, and
         "video only" would be a lie, so the status says why instead. */
      entry.youtube = null;
      notify("warn", S.ytAddNoEmbed);
      if (!song) statusText = S.ytAddNoEmbed;
    }
    res.appendChild(el("p", "radio-ytadd__status", statusText));
    var list = el("ol", "radio-list");
    list.appendChild(songSearchRow(entry, "manual"));
    res.appendChild(list);
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
    renderCrew();
    renderDesk();
    resolveSweep();
  }

  /* ── match desk: songs left, video workbench right (docs/youtube.md,
     "The match desk"). Everyone reads it; edits (the paste field) ride
     the queue capability like every other entry mutation. Pasting
     applies immediately — no confirm; undo is pasting something else. */
  var deskSel = null;            // selected entryId
  var deskMeta = {};             // videoId → oEmbed title (best-effort cache)
  /* Pending matches (docs/youtube.md, "Pending matches"): unmatched
     pastes park HERE — device-local, localStorage-backed, never on the
     wire — until a human links an AM song (which is just a normal add
     with the video block riding) or removes them. Oldest fall off past
     the cap. */
  var PENDING_KEY = "deets-radio-pending";
  var PENDING_CAP = 20;
  var pending = load(PENDING_KEY, []);
  var pendingSel = null;         // selected pending videoId in the desk list
  var pendingPick = null;        // {videoId, song} armed, awaiting Confirm
  var pendingToast = null;       // the sticky nudge (syncPendingToast)
  var pendingToastN = -1;        // count last toasted — manual dismiss holds
                                 // the toast down until the count CHANGES
  function addPending(v) {
    if (pending.some(function (p) { return p.id === v.id; })) return;
    pending.push(v);
    if (pending.length > PENDING_CAP) pending = pending.slice(-PENDING_CAP);
    save(PENDING_KEY, pending);
  }
  function dropPending(id) {
    pending = pending.filter(function (p) { return p.id !== id; });
    save(PENDING_KEY, pending);
    if (pendingSel === id) pendingSel = null;
    if (pendingPick && pendingPick.videoId === id) pendingPick = null;
  }
  function syncPendingToast() {
    var n = pending.length;
    if (!inRoom || !n) {
      if (pendingToast) { pendingToast.dismiss(); pendingToast = null; }
      if (!n) pendingToastN = -1;
      return;
    }
    if (n === pendingToastN) return;
    if (pendingToast) pendingToast.dismiss();
    var msg = n === 1 ? S.pendingToastOne : fmt(S.pendingToast, { n: n });
    pendingToast = notify("warn", msg, {
      sticky: true,
      actions: [{ label: S.toastDismiss, onPick: function () { pendingToast = null; } }]
    });
    pendingToastN = n;
  }
  /* YouTube URLs ONLY — no bare-id fallback: both fields that call this
     are dual-mode now (link = video, words = song search), and any
     11-char word ("temperature") would otherwise read as a video id */
  function parseYtId(raw) {
    var s = String(raw || "").trim();
    var m = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/.exec(s);
    return m ? m[1] : null;
  }
  function deskSelect(id) {
    deskSel = id;
    pendingSel = null;
    pendingPick = null;
    renderDesk();
  }
  function renderDesk() {
    if (!DESK || !model) return;
    /* don't rebuild mid-typing — a presence ping would eat the paste */
    if (DESK.contains(document.activeElement) &&
        document.activeElement.tagName === "INPUT") return;
    DESK.hidden = false;
    DESK.textContent = "";
    var head = el("div", "radio-crew__head");
    head.appendChild(el("span", "radio-crew__title", S.deskTitle));
    DESK.appendChild(head);
    var entries = model.current ? [model.current] : [];
    entries = entries.concat(model.queue || []);
    if (!entries.length && !pending.length) {
      DESK.appendChild(el("p", "sotd__empty", S.deskEmpty));
      deskSel = null;
      pendingSel = null;
      return;
    }
    if (pendingSel && !pending.some(function (p) { return p.id === pendingSel; })) {
      pendingSel = null;
    }
    if (!entries.length && !pendingSel) pendingSel = pending[0].id;
    if (entries.length &&
        !entries.some(function (e) { return e.entryId === deskSel; })) {
      deskSel = entries[0].entryId;
    }
    var cols = el("div", "radio-desk__cols");
    var list = el("div", "radio-desk__list");
    /* pending matches sit on top — parked pastes waiting for a human to
       link an AM song; wide video thumbs + the --pause hourglass keep
       them legible as not-real-entries-yet (his sketch, 2026-07-15) */
    if (pending.length) {
      list.appendChild(el("p", "radio-desk__group", S.deskPendingLabel));
      pending.forEach(function (p) {
        var isPSel = p.id === pendingSel;
        var guess = Y ? Y.parseTitle(p.title, p.channel)
                      : { artist: p.channel, title: p.title };
        var b = el("button", "radio-desk__row" + (isPSel ? " is-selected" : ""));
        b.type = "button";
        var th = el("img", "radio-desk__rowthumb");
        th.alt = "";
        th.loading = "lazy";
        th.src = "https://i.ytimg.com/vi/" + p.id + "/mqdefault.jpg";
        b.appendChild(th);
        var ptext = el("span", "radio-row__text");
        ptext.appendChild(el("span", "radio-row__title", guess.title));
        ptext.appendChild(el("span", "radio-row__artist", guess.artist));
        b.appendChild(ptext);
        var pbadge = el("span", "radio-desk__badge radio-desk__badge--wait");
        pbadge.innerHTML = ICON_WAIT;
        pbadge.setAttribute("aria-hidden", "true");
        b.appendChild(pbadge);
        b.addEventListener("click", function () {
          pendingSel = p.id;
          pendingPick = null;
          renderDesk();
        });
        list.appendChild(b);
      });
      if (entries.length) list.appendChild(el("div", "radio-desk__rule"));
    }
    var sel = null;
    entries.forEach(function (e) {
      var isSel = !pendingSel && e.entryId === deskSel;
      if (isSel) sel = e;
      var b = el("button", "radio-desk__row" + (isSel ? " is-selected" : ""));
      b.type = "button";
      b.appendChild(rowArt(e));
      var text = el("span", "radio-row__text");
      text.appendChild(el("span", "radio-row__title", e.title));
      text.appendChild(el("span", "radio-row__artist", e.artist));
      b.appendChild(text);
      var badge = el("span", "radio-desk__badge" + (e.youtube ? " radio-desk__badge--has" : ""));
      badge.innerHTML = e.youtube ? ICON_CHECK : ICON_X;
      badge.setAttribute("aria-hidden", "true");
      b.appendChild(badge);
      b.addEventListener("click", function () { deskSelect(e.entryId); });
      list.appendChild(b);
    });
    cols.appendChild(list);
    var work = el("div", "radio-desk__work");
    var psel = null;
    pending.forEach(function (p) { if (p.id === pendingSel) psel = p; });
    if (psel) {
      /* pending workbench (his layout from the sketch review): video
         first, the search UNDER it so results sit adjacent to the box,
         then Confirm/Remove — picking a result only ARMS the link;
         Confirm performs it, so a misclick costs nothing */
      var pthumb = el("img", "radio-desk__thumb");
      pthumb.alt = "";
      pthumb.loading = "lazy";
      pthumb.src = "https://i.ytimg.com/vi/" + psel.id + "/mqdefault.jpg";
      work.appendChild(pthumb);
      work.appendChild(el("p", "radio-desk__video", psel.title));
      var acts = el("div", "radio-desk__acts");
      if (canQueue()) {
        var pin = el("input", "radio-desk__input");
        pin.type = "text";
        pin.placeholder = S.deskPendingSearch;
        pin.setAttribute("aria-label", S.deskPendingSearch);
        var pres = el("div", "radio-desk__results");
        var pseq = 0;
        var runPend = function (q) {
          q = String(q || "").trim();
          var seq = ++pseq;
          if (!q || !(A && A.hasToken())) { pres.textContent = ""; return; }
          A.search(q).then(function (sec) {
            if (seq !== pseq) return;
            pres.textContent = "";
            var songs = (sec.songs || []).slice(0, 5);
            if (!songs.length) {
              pres.appendChild(el("p", "sotd__empty", S.deskNoSongs));
              return;
            }
            songs.forEach(function (t) {
              var b = el("button", "radio-desk__row");
              b.type = "button";
              b.appendChild(rowArt(t));
              var tx = el("span", "radio-row__text");
              tx.appendChild(el("span", "radio-row__title", t.title));
              tx.appendChild(el("span", "radio-row__artist", t.artist));
              b.appendChild(tx);
              b.addEventListener("click", function () {
                pendingPick = { videoId: psel.id, song: t };
                Array.prototype.forEach.call(pres.children, function (c) {
                  c.classList.remove("is-selected");
                });
                b.classList.add("is-selected");
                renderPick();
              });
              pres.appendChild(b);
            });
          }).catch(function () {});
        };
        var pendTimer = null;
        pin.addEventListener("input", function () {
          if (pendTimer) clearTimeout(pendTimer);
          pendTimer = setTimeout(function () { runPend(pin.value); }, 300);
        });
        pin.addEventListener("keydown", function (e) {
          if (e.key === "Enter") runPend(pin.value);
        });
        work.appendChild(pin);
        work.appendChild(pres);
        /* the armed pick gets a persistent pane — search results are
           transient DOM (a broadcast re-render wipes them), and Confirm
           must never act on something the user can't see */
        var pickPane = el("div", "radio-desk__song");
        var renderPick = function () {
          pickPane.textContent = "";
          var pk = (pendingPick && pendingPick.videoId === psel.id)
            ? pendingPick.song : null;
          pickPane.hidden = !pk;
          if (!pk) return;
          pickPane.appendChild(rowArt(pk));
          var ptx = el("span", "radio-row__text");
          ptx.appendChild(el("span", "radio-row__title", pk.title));
          ptx.appendChild(el("span", "radio-row__artist", pk.artist));
          pickPane.appendChild(ptx);
        };
        renderPick();
        work.appendChild(pickPane);
        var confirmB = el("button", "radio-desk__act radio-desk__act--go", S.deskPendingConfirm);
        confirmB.type = "button";
        confirmB.addEventListener("click", function () {
          if (!pendingPick || pendingPick.videoId !== psel.id) return;  // nothing armed
          if (!canQueue()) return;   // cap revoked mid-session: keep the pending
          var entry = JSON.parse(JSON.stringify(pendingPick.song));
          entry.youtube = { id: psel.id, durationMs: 0 };  // setVideo's idiom: 0 = unknown
          sendAll([entry], "later", "manual");
          dropPending(psel.id);
          renderDesk();
          syncPendingToast();
        });
        acts.appendChild(confirmB);
      }
      var removeB = el("button", "radio-desk__act", S.deskPendingRemove);
      removeB.type = "button";
      removeB.addEventListener("click", function () {
        dropPending(psel.id);
        renderDesk();
        syncPendingToast();
      });
      acts.appendChild(removeB);
      work.appendChild(acts);
    } else if (sel) {
      /* the workbench field, first — always at the top (Aditya,
         2026-07-15) — and DUAL-MODE since YT-first adds (his call,
         2026-07-15): a YouTube link re-pins the video (setVideo, as
         ever); anything else searches the free Apple catalog — songs
         only — and clicking a result re-pins the SONG (setSong). One
         rule page-wide: links mean video, words mean songs. */
      if (canQueue()) {
        var input = el("input", "radio-desk__input");
        input.type = "text";
        /* still dual-mode — the placeholder just leads with the likelier
           act: no video yet invites the paste, attached video means the
           song fix is what's left (his call, 2026-07-15) */
        var inPh = sel.youtube ? S.deskSearch : S.deskPaste;
        input.placeholder = inPh;
        input.setAttribute("aria-label", inPh);
        var status = el("p", "radio-desk__status");
        var results = el("div", "radio-desk__results");
        var miniSeq = 0;
        var runMini = function (q) {
          q = String(q || "").trim();
          var seq = ++miniSeq;
          if (!q || !(A && A.hasToken())) { results.textContent = ""; return; }
          A.search(q).then(function (sec) {
            if (seq !== miniSeq) return;
            results.textContent = "";
            var songs = (sec.songs || []).slice(0, 5);
            if (!songs.length) {
              results.appendChild(el("p", "sotd__empty", S.deskNoSongs));
              return;
            }
            songs.forEach(function (t) {
              var b = el("button", "radio-desk__row");
              b.type = "button";
              b.appendChild(rowArt(t));
              var tx = el("span", "radio-row__text");
              tx.appendChild(el("span", "radio-row__title", t.title));
              tx.appendChild(el("span", "radio-row__artist", t.artist));
              b.appendChild(tx);
              b.addEventListener("click", function () {
                input.value = "";
                results.textContent = "";
                /* immediate ack; the broadcast's re-render (row swap) is
                   the real confirmation and replaces this within a beat */
                status.textContent = S.deskSongSent;
                input.blur();      // let the broadcast's re-render land
                send("setSong", { entryId: sel.entryId, song: t });
              });
              results.appendChild(b);
            });
          }).catch(function () {});
        };
        var miniTimer = null;
        var commit = function () {
          var id = parseYtId(input.value);
          if (id) {
            input.value = "";
            results.textContent = "";
            status.textContent = S.deskSent;
            input.blur();          // let the broadcast's re-render land
            send("setVideo", { entryId: sel.entryId, youtube: { id: id, durationMs: 0 } });
            return;
          }
          runMini(input.value);
        };
        input.addEventListener("input", function () {
          if (miniTimer) clearTimeout(miniTimer);
          if (parseYtId(input.value)) return;    // links apply on Enter/paste
          miniTimer = setTimeout(function () { runMini(input.value); }, 300);
        });
        input.addEventListener("keydown", function (e) { if (e.key === "Enter") commit(); });
        input.addEventListener("paste", function () { setTimeout(commit, 0); });
        work.appendChild(input);
        work.appendChild(status);
        work.appendChild(results);
      }
      /* the attached AM song — what setSong re-pins; a YT-only entry
         shows its parsed guess here until a real song is pinned */
      var songPane = el("div", "radio-desk__song" + (sel.apple ? "" : " radio-desk__song--none"));
      songPane.appendChild(rowArt(sel));
      var stx = el("span", "radio-row__text");
      stx.appendChild(el("span", "radio-row__title", sel.title));
      stx.appendChild(el("span", "radio-row__artist", sel.artist));
      songPane.appendChild(stx);
      work.appendChild(songPane);
      if (sel.youtube) {
        var vid = sel.youtube.id;
        var thumb = el("img", "radio-desk__thumb");
        thumb.alt = "";
        thumb.loading = "lazy";
        thumb.src = "https://i.ytimg.com/vi/" + vid + "/mqdefault.jpg";
        work.appendChild(thumb);
        work.appendChild(el("p", "radio-desk__video", deskMeta[vid] || vid));
        if (!deskMeta[vid]) {
          /* oEmbed is keyless; a CORS refusal just leaves the bare id */
          fetch("https://www.youtube.com/oembed?format=json&url=" +
                encodeURIComponent("https://www.youtube.com/watch?v=" + vid))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              if (j && j.title) { deskMeta[vid] = j.title; renderDesk(); }
            }).catch(function () {});
        }
      } else {
        work.appendChild(el("p", "radio-desk__video radio-desk__video--none", S.deskNoVideo));
      }
    }
    cols.appendChild(work);
    DESK.appendChild(cols);
  }
  /* auto-resolver sweep (docs/youtube.md, "Resolve"): the current entry +
     the next two queued get one Data-API attempt each; a hit rides the
     resolve verb so the whole room — and the D1 registry — benefits. The
     registry upstream makes this once-per-song-EVER; the once-per-session
     memo here just stops a missing match from burning quota every render. */
  var resolveTried = {};
  function resolveSweep() {
    if (!Y || !Y.hasKey() || !joined || !model || !canQueue()) return;
    [model.current].concat((model.queue || []).slice(0, 2)).forEach(function (e) {
      if (!e || e.youtube || resolveTried[e.entryId]) return;
      /* mock-catalog entries stay silent mocks */
      if (!e.apple || !e.apple.id || e.apple.id.indexOf("mock.") === 0) return;
      resolveTried[e.entryId] = true;
      Y.resolve(e).then(function (best) {
        if (!best || !joined) return;
        send("resolve", {
          entryId: e.entryId,
          youtube: { id: best.id, durationMs: best.durationMs },
          source: best.source
        });
      });
    });
  }

  /* Leaving the page kills the music for any engine — ask first while
     the room is live (docs/youtube.md; room-wide, arguably owed since
     v0.9). Browsers show their own generic wording; ours can't ride it. */
  window.addEventListener("beforeunload", function (e) {
    if (joined && model && model.transport && model.transport.playing) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

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
    /* the echo of leaveRoom's own history.back() (see leaveRoom): swallow
       it once and strip the restored hash instead of rejoining */
    if (hashEcho && code === hashEcho.code && Date.now() - hashEcho.at < 2000) {
      hashEcho = null;
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
      return;
    }
    if (!code || code === roomCode) return;
    BAR_INPUT.value = code;
    commitCode(code);
  });
})();
