/* DeetsRadio — YouTube side (design: docs/youtube.md).

   The free full-track tier. This module owns everything YouTube —
   - the PLAYER LAYER: one IFrame player in a fixed-position layer that
     NEVER reparents (moving an iframe reloads it — playback dies and ads
     replay). The layout moves under it: the layer rect-tracks the active
     .radio-np__art and sits exactly over it. Shown only while actually
     playing (API TOS: never hidden while audio plays, never overlaid
     while playing — the countdown runs on the placeholder art while the
     player is merely CUED, and the video reveals at zero).
   - the PLAYBACK FOLLOWER: same contract as apple.js — radio.js feeds
     follow(view) from tick(); this file chases the room clock and never
     advances anything. apple.js's wedge armor ports over: silence check
     first, timestamped latches that expire, no overlapping starts.
   - the AUTO-RESOLVER: Data API Topic-channel search (radio/yt-key.js;
     quietly inert while the key stub is null). Playback itself is
     keyless.

   No user-facing copy in here — notes are token strings radio.js maps
   through RADIO_STRINGS. */
(function () {
  "use strict";

  var KEY = window.RADIO_YT_KEY || null;
  var DRIFT_MS = 1750;           // mirror apple.js — keep in lockstep
  var CORRECTION_GAP_MS = 5000;
  var LOAD_RETRY_MS = 8000;      // a cue gets this long before we retry
  var START_RETRY_MS = 5000;     // playVideo() / buffering gets this long
  var ENABLED_KEY = "deets-radio-youtube";

  /* ── gesture gate (same policy as apple.js) ───────────────────── */
  var activated = false;
  document.addEventListener("pointerdown", function () { activated = true; }, true);
  document.addEventListener("keydown", function () { activated = true; }, true);
  function hasGesture() {
    if (navigator.userActivation) return navigator.userActivation.hasBeenActive;
    return activated;
  }

  /* ── the enable toggle (Music Source box; default on) ─────────── */
  function enabled() {
    try { return JSON.parse(localStorage.getItem(ENABLED_KEY)) !== false; }
    catch (e) { return true; }
  }
  function setEnabled(on) {
    try { localStorage.setItem(ENABLED_KEY, JSON.stringify(!!on)); } catch (e) {}
    if (!on) { silence(); hide(); }
  }

  /* ── IFrame API bootstrap (lazy — dead weight for Apple listeners) ── */
  var apiPromise = null;
  function loadApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(function (res) {
      if (window.YT && window.YT.Player) { res(); return; }
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (prev) try { prev(); } catch (e) {}
        res();
      };
      var s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
    return apiPromise;
  }

  /* ── the layer + the single player ────────────────────────────── */
  var layer = null;             // fixed-position host; never reparents
  var player = null;            // the YT.Player, created once
  var playerReady = false;
  var creating = false;
  var targetEl = null;          // the live .radio-np__art (radio.js attaches)
  var visible = false;
  var raf = 0;

  function ensureLayer() {
    if (layer) return;
    layer = document.createElement("div");
    layer.className = "radio-yt-layer";
    layer.setAttribute("aria-hidden", "true");
    var box = document.createElement("div");
    layer.appendChild(box);
    document.body.appendChild(layer);
  }
  function ensurePlayer() {
    if (player || creating) return;
    creating = true;
    ensureLayer();
    loadApi().then(function () {
      player = new window.YT.Player(layer.firstChild, {
        width: "200",
        height: "200",
        playerVars: {
          playsinline: 1, rel: 0, fs: 0, iv_load_policy: 3,
          origin: location.origin
        },
        events: {
          onReady: function () { playerReady = true; creating = false; },
          onError: function (e) {
            /* embed-disabled / dead video: mark it and fall through to
               the Apple preview tier on the next tick */
            dbg("error", { id: loadedId, code: e && e.data });
            if (loadedId) deadIds[loadedId] = true;
            loadedId = null;
          }
        }
      });
    });
  }

  /* Track the active art slot every frame while visible. The art node is
     one live element wherever it reparents (strip, dock, bottom strip),
     so there is always exactly one rect to chase. */
  function track() {
    if (!visible || !targetEl || !layer) return;
    var r = targetEl.getBoundingClientRect();
    if (r.width < 2 || (!r.top && !r.left && !r.height)) {
      layer.style.display = "none";       // slot momentarily unlaid-out
    } else {
      layer.style.display = "block";
      layer.style.transform = "translate(" + r.left + "px," + r.top + "px)";
      layer.style.width = r.width + "px";
      layer.style.height = r.height + "px";
    }
    raf = requestAnimationFrame(track);
  }
  function show() {
    if (visible) return;
    visible = true;
    if (layer) layer.style.display = "block";
    raf = requestAnimationFrame(track);
  }
  function hide() {
    visible = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (layer) layer.style.display = "none";
  }

  /* ── follower state (apple.js's latch anatomy) ────────────────── */
  var loadedId = null;
  var loading = false;
  var loadingAt = 0;
  var starting = false;
  var startingAt = 0;
  var lastCorrection = 0;
  /* Seek armor, round 3 (2026-07-15/16 — docs/youtube.md, "Sync
     armor"; SEAMLESS-FIRST): a MusicKit seek is near-instant, an
     IFrame seek rebuffers, so every seek/cue aims AHEAD at
     expected + seekPad and the pad is re-measured from where playback
     actually lands. The round-3 lessons, both evidence-backed
     (captured timelines in the doc): (1) measurements can be GARBAGE
     — a throttled background tab or a stalled player reports landing
     errors of 30-60 s that are not seek costs, and an unbounded
     "jump" rule turned one bad row into a 20 s invisible freeze — so
     learning is bounded: est must be plausible, one landing moves the
     pad at most 2x, and the cap models a real seek (~4 s). (2) When
     the player is hopelessly behind (> REANCHOR_MS) chasing is the
     failure mode — ONE decisive loadVideoById at the clock re-anchors
     with a single brief buffer. (3) A landed-ahead pause is capped at
     WAIT_MAX_MS (a longer freeze reads as a hang); bigger overshoots
     seek BACKWARD through content we just buffered — cheap. (4)
     Repeated behind-landings back the correction cadence off
     exponentially: continuous audio slightly behind beats stuttering
     sync on a link that can't do both. */
  var seekPad = 1200;          // ms the room clock moves while we buffer
  var PAD_MIN = 250;
  var PAD_MAX = 4000;          // pad models a SEEK's cost, nothing bigger —
                               // evidence: healthy seeks land in ~150-300 ms
  var WAIT_MAX_MS = 3000;      // longest invisible landed-ahead pause
  var REANCHOR_MS = 8000;      // beyond this, don't chase — reload at the clock
  var settling = false;        // a start/seek is landing — measure it
  var settlingPadded = false;  // whether seekPad rode that op
  var cuePadded = false;       // whether the current load's cue carried it
  var waitUntil = 0;           // landed ahead: paused until the clock catches us
  var strikes = 0;             // consecutive behind-landings — backs corrections off
  /* ── debug telemetry (the seek-armor investigation) ─────────────
     A capped ring of follower events — read it via RadioYouTube.dbg();
     set localStorage "deets-radio-yt-debug" = "1" to live-tail it on
     the console. Numbers and short strings only — cheap enough to
     leave in place. */
  var DBG_CAP = 500;
  var dbgLog = [];
  var dbgOn = false;
  try { dbgOn = localStorage.getItem("deets-radio-yt-debug") === "1"; } catch (e) {}
  var dbgT0 = Date.now();
  var dbgLastSt = null;
  function dbg(ev, x) {
    var row = { t: Date.now() - dbgT0, ev: ev };
    for (var k in x) row[k] = x[k];
    dbgLog.push(row);
    if (dbgLog.length > DBG_CAP) dbgLog.shift();
    if (dbgOn) { try { console.log("[yt] " + JSON.stringify(row)); } catch (e) {} }
  }
  var deadIds = {};             // embed-blocked / erroring videos this session
  var note = null;              // "blocked" | null — radio.js maps to copy

  function playable(entry) {
    if (!enabled()) return "none";
    if (!entry || !entry.youtube || !entry.youtube.id) return "none";
    if (deadIds[entry.youtube.id]) return "none";
    return "video";
  }

  function silence() {
    if (player && playerReady) {
      try {
        var st = player.getPlayerState();
        if (st === 1 || st === 3) player.pauseVideo();
      } catch (e) {}
    }
  }

  function follow(view) {
    note = null;
    var entry = view && view.entry;
    if (playable(entry) !== "video") { silence(); hide(); return; }
    ensurePlayer();
    if (!player || !playerReady) return;   // still booting; silent is correct
    var id = entry.youtube.id;
    var hold = view.counting || !view.playing;
    var st;
    try { st = player.getPlayerState(); } catch (e) { return; }
    if (st !== dbgLastSt) { dbg("state", { st: st, hold: hold }); dbgLastSt = st; }
    /* silence lands before everything else, every tick */
    if (hold && (st === 1 || st === 3)) { try { player.pauseVideo(); } catch (e) {} }
    if (hold) hide();                      // cued/held = legal to hide (not playing)
    if (loadedId !== id) {
      if (loading && Date.now() - loadingAt < LOAD_RETRY_MS) return;
      loading = true;
      loadingAt = Date.now();
      try {
        player.cueVideoById({
          videoId: id,
          /* fresh scheduled starts cue at 0 and begin at the boundary;
             a late joiner cues AHEAD of the room position by the pad —
             the clock keeps moving while the cue buffers */
          startSeconds: hold ? 0 : Math.max(0, (view.expectedMs + seekPad) / 1000)
        });
        cuePadded = !hold;
        loadedId = id;
        waitUntil = 0;                     // fresh track, fresh armor
        strikes = 0;
        dbg("cue", { id: id, padded: cuePadded, pad: seekPad,
                     at: hold ? 0 : Math.round(view.expectedMs + seekPad) });
      } catch (e) {}
      loading = false;
      return;                              // next tick resumes the chase
    }
    if (hold) { starting = false; settling = false; waitUntil = 0; return; }
    /* past the video's own end while the room clock runs (duration
       mismatch): fall silent, hide the end screen; the room advances */
    if (st === 0 ||
        (entry.youtube.durationMs && view.expectedMs >= entry.youtube.durationMs)) {
      hide();
      return;
    }
    var t = Date.now();
    if (waitUntil) {
      /* we landed AHEAD of the room clock and are paused on purpose —
         a visible frozen frame while the clock walks to us beats the
         rebuffer a backward seek would cost. TOS binds a player only
         WHILE PLAYING, so staying visible is fine. */
      show();
      if (t < waitUntil) {
        if (st === 1) { try { player.pauseVideo(); } catch (e) {} }
        return;
      }
      waitUntil = 0;
      starting = true;                     // resume is instant — no settle
      startingAt = t;
      lastCorrection = t;                  // but it earns one quiet window
      dbg("resume", {});
      try { player.playVideo(); } catch (e) {}
      return;
    }
    if (st !== 1) {                        // not playing yet
      if (st === 3 && starting) {          // buffering under a start latch
        if (t - startingAt < START_RETRY_MS) { show(); return; }
        starting = false;                  // wedged — try again
        dbg("wedge", {});
      }
      if (!hasGesture()) { note = "blocked"; return; }
      starting = true;
      startingAt = t;
      if (!settling) {
        /* a drift-seek already opened its own settle (padded) — don't
           relabel it with the load's stale cuePadded flag */
        settling = true;                   // measure where this start lands
        settlingPadded = cuePadded;
      }
      dbg("start", { st: st, padded: settlingPadded, pad: seekPad,
                     expected: Math.round(view.expectedMs) });
      try { player.playVideo(); } catch (e) {}
      show();                              // playing (or ads) begins — visible
      return;
    }
    starting = false;
    show();
    var localMs = 0;
    try { localMs = player.getCurrentTime() * 1000; } catch (e) {}
    if (settling) {
      /* the start/seek just landed: est recovers the true buffer/spin-up
         cost (padded op: pad − err; bare start: −err). A miss beyond
         DRIFT JUMPS the pad to est — averaging can't out-run a 10 s
         rebuffer; small residue still damps by average. Either way the
         landing earns one drift-free settle window — never an instant
         second correction. */
      settling = false;
      cuePadded = false;                   // the load's pad is spent once measured
      var err = localMs - view.expectedMs;    // negative = landed behind
      var est = settlingPadded ? seekPad - err : -err;
      dbg("land", { err: Math.round(err), est: Math.round(est),
                    padded: settlingPadded, padBefore: seekPad,
                    local: Math.round(localMs),
                    expected: Math.round(view.expectedMs) });
      /* BOUNDED learning: est only counts when it plausibly measured a
         seek/spin-up (sane magnitude), and one landing can at most
         double the pad — a garbage row (throttled tab, stalled player)
         must never slam it */
      if (est >= 0 && est <= PAD_MAX * 2) {
        var next = Math.abs(err) > DRIFT_MS ? est : (seekPad + est) / 2;
        seekPad = Math.max(PAD_MIN, Math.min(PAD_MAX,
          Math.min(Math.round(next), seekPad * 2)));
      }
      lastCorrection = t;
      if (err > DRIFT_MS && err <= WAIT_MAX_MS) {
        dbg("wait", { ms: Math.round(err), padAfter: seekPad });
        /* small overshoot: pause and let the clock catch up — free,
           and brief enough to read as a hiccup, not a hang */
        waitUntil = t + err;
        try { player.pauseVideo(); } catch (e) {}
        return;
      }
      if (err > WAIT_MAX_MS) {
        /* big overshoot: a long freeze reads as broken — seek BACK to
           the clock instead; that range just buffered, so it's cheap */
        settling = true;
        settlingPadded = true;
        dbg("seekback", { err: Math.round(err), to: Math.round(view.expectedMs + seekPad) });
        try { player.seekTo((view.expectedMs + seekPad) / 1000, true); } catch (e) {}
        return;
      }
      if (err < -DRIFT_MS) strikes += 1;   // still behind after a padded op
      else strikes = 0;                    // clean landing — armor at rest
      return;
    }
    /* strikes back the cadence off exponentially (5s → 10s → 20s → 40s):
       a connection that can't land a padded seek gets an occasional
       catch-up, not a 5-second stutter loop */
    var gap = CORRECTION_GAP_MS * (strikes ? Math.min(8, 1 << strikes) : 1);
    var drift = localMs - view.expectedMs;
    if (Math.abs(drift) > DRIFT_MS && t - lastCorrection > gap) {
      lastCorrection = t;
      settling = true;                     // this op rebuffers — measure it too
      settlingPadded = true;
      if (drift < -REANCHOR_MS) {
        /* hopelessly behind (a stall era, a throttled tab): chasing
           from here learns garbage and stutters — ONE decisive reload
           at the clock re-anchors with a single brief buffer */
        dbg("anchor", { drift: Math.round(drift), pad: seekPad,
                        to: Math.round(view.expectedMs + seekPad) });
        try {
          player.loadVideoById({
            videoId: id,
            startSeconds: (view.expectedMs + seekPad) / 1000
          });
        } catch (e) {}
      } else {
        dbg("seek", { drift: Math.round(drift),
                      pad: seekPad, gap: gap, strikes: strikes,
                      to: Math.round(view.expectedMs + seekPad) });
        try { player.seekTo((view.expectedMs + seekPad) / 1000, true); } catch (e) {}
      }
    }
  }

  function stop() {
    dbg("stop", {});
    silence();
    hide();
    loadedId = null;
    loading = false;
    starting = false;
    settling = false;
    cuePadded = false;
    waitUntil = 0;
    strikes = 0;
    note = null;
  }

  /* ── auto-resolver: Data API Topic/VEVO search (docs/youtube.md) ── */
  function isoToMs(iso) {
    var m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
    if (!m) return 0;
    return (((+m[1] || 0) * 60 + (+m[2] || 0)) * 60 + (+m[3] || 0)) * 1000;
  }
  /* ── quota ledger (docs/youtube.md, "The key & quota") ──────────
     Google exposes no remaining-quota endpoint, so we keep our own
     tab: units spent per Pacific day (Google's reset boundary),
     per device (the key is shared — this counts OUR spend only).
     A 403 quotaExceeded marks the day exhausted outright. */
  var QUOTA_KEY = "deets-radio-yt-quota";
  var QUOTA_DAY_UNITS = 10000;
  var SEARCH_COST = 101;      // search (100) + the videos.list verify (1)
  function ptDay() {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" })
        .format(new Date());
    } catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function quotaLedger() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(QUOTA_KEY)); } catch (e) {}
    if (!v || v.d !== ptDay()) v = { d: ptDay(), u: 0 };
    return v;
  }
  function spend(units) {
    var v = quotaLedger();
    v.u = Math.min(QUOTA_DAY_UNITS, v.u + units);
    try { localStorage.setItem(QUOTA_KEY, JSON.stringify(v)); } catch (e) {}
  }
  function quotaLeft() { return Math.max(0, QUOTA_DAY_UNITS - quotaLedger().u); }

  function apiGet(path, params, cost) {
    spend(cost || 0);
    var q = Object.keys(params).map(function (k) {
      return k + "=" + encodeURIComponent(params[k]);
    }).join("&");
    return fetch("https://www.googleapis.com/youtube/v3/" + path + "?" + q + "&key=" + KEY)
      .then(function (r) {
        if (r.status === 403) spend(QUOTA_DAY_UNITS);   // exhausted / blocked: sit out the day
        if (!r.ok) throw new Error("yt-api " + r.status);
        return r.json();
      });
  }

  /* entry → {id, durationMs, source} | null. One search (100 units) +
     one videos.list (1 unit), guarded by the ledger. The D1 registry
     upstream makes this a once-per-song-EVER cost. (An Odesli/song.link
     leg was built and removed same-day 2026-07-15: live probes showed
     its linksByPlatform no longer carries YouTube at all — verified on
     two mainstream tracks. Don't re-add without re-probing.) */
  function resolve(entry) {
    if (!KEY || !entry || !entry.title) return Promise.resolve(null);
    if (quotaLeft() < SEARCH_COST) return Promise.resolve(null);
    var q = (entry.artist ? entry.artist + " " : "") + entry.title;
    return apiGet("search", {
      part: "snippet", type: "video", maxResults: 10, q: q
    }, 100).then(function (data) {
      var items = (data.items || []).map(function (it) {
        var ch = (it.snippet && it.snippet.channelTitle) || "";
        return {
          id: it.id && it.id.videoId,
          source: /- Topic$/.test(ch) ? "topic" : /vevo$/i.test(ch) ? "vevo" : "search"
        };
      }).filter(function (c) { return !!c.id; });
      if (!items.length) return null;
      var ids = items.map(function (c) { return c.id; }).join(",");
      return apiGet("videos", {
        part: "contentDetails,status", id: ids
      }, 1).then(function (vids) {
        var detail = {};
        (vids.items || []).forEach(function (v) {
          detail[v.id] = {
            durationMs: isoToMs(v.contentDetails && v.contentDetails.duration),
            embeddable: !(v.status && v.status.embeddable === false)
          };
        });
        var rank = { topic: 0, vevo: 1, search: 2 };
        var best = null;
        items.forEach(function (c) {
          var d = detail[c.id];
          if (!d || !d.embeddable) return;
          /* duration ±2 s is the match test (the site's fuzzy rule) */
          if (entry.durationMs && Math.abs(d.durationMs - entry.durationMs) > 2000) return;
          if (!best || rank[c.source] < rank[best.source]) {
            best = { id: c.id, durationMs: d.durationMs, source: c.source };
          }
        });
        return best;
      });
    }).catch(function () { return null; });
  }

  /* ── YT-first adds (docs/youtube.md, "YouTube-first adds") ──────
     One videos.list with snippet+contentDetails+status is still 1 unit
     and carries title/channel/thumbnail — so a pasted link costs a
     single metered call and no oEmbed (docs/youtube.md,
     "YouTube-first adds"). */
  var lookupMemo = {};   // videoId → in-flight/settled Promise — a
                         // debounce + Enter double-fire spends once
  function lookup(videoId) {
    if (lookupMemo[videoId]) return lookupMemo[videoId];
    if (!KEY || quotaLeft() < 1) return Promise.resolve(null);
    var p = apiGet("videos", {
      part: "snippet,contentDetails,status", id: videoId
    }, 1).then(function (data) {
      var v = data.items && data.items[0];
      if (!v) return null;
      var sn = v.snippet || {};
      var th = sn.thumbnails || {};
      var pick = th.high || th.medium || th.default;   // 480×360 reads best in a square slot
      return {
        id: videoId,
        title: sn.title || "",
        channel: sn.channelTitle || "",
        thumb: (pick && pick.url) || null,
        durationMs: isoToMs(v.contentDetails && v.contentDetails.duration),
        embeddable: !(v.status && v.status.embeddable === false)
      };
    }).catch(function () { return null; });
    lookupMemo[videoId] = p.then(function (info) {
      if (!info) delete lookupMemo[videoId];   // a flaky miss may retry
      return info;
    });
    return lookupMemo[videoId];
  }

  /* keyless oEmbed lookup (docs/youtube.md, "YouTube-first adds",
     keyless path): same shape as lookup() so runYtAdd can fall back to it,
     but durationMs is 0 (oEmbed has no duration) and embeddable is
     unknowable here — reported true, a refusal surfaces at playback as a
     gap. Callers treat this as "matched adds only": without a real
     duration a YT-only entry can't exist (the room alarm schedules off
     durationMs), and the Apple match's clone supplies it instead. */
  var oembedMemo = {};
  function oembed(videoId) {
    if (oembedMemo[videoId]) return oembedMemo[videoId];
    var p = fetch("https://www.youtube.com/oembed?format=json&url=" +
        encodeURIComponent("https://www.youtube.com/watch?v=" + videoId))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.title) return null;
        return {
          id: videoId,
          title: j.title,
          channel: j.author_name || "",
          thumb: j.thumbnail_url || null,
          durationMs: 0,
          embeddable: true
        };
      }).catch(function () { return null; });
    oembedMemo[videoId] = p.then(function (info) {
      if (!info) delete oembedMemo[videoId];   // a flaky miss may retry
      return info;
    });
    return oembedMemo[videoId];
  }

  /* video title → {artist, title} guess (the fiddly part, docs/youtube.md):
     Topic uploads are label-clean — the channel IS "<Artist> - Topic" and
     the title IS the song. Everything else gets the music-video treatment:
     bracketed noise stripped, then an "Artist - Title" split, with the
     channel (minus VEVO/Official dressing) as the artist fallback. "Live"
     is deliberately NOT noise — a live cut is a different recording and
     the duration test should see it as one. */
  function parseTitle(title, channel) {
    var ch = String(channel || "").trim();
    var t = String(title || "").trim();
    var topic = / - Topic$/.test(ch);
    if (topic) return { artist: ch.replace(/ - Topic$/, ""), title: t };
    t = t.replace(/[(\[][^)\]]*[)\]]/g, function (seg) {
      return /official|video|audio|lyric|visuali|remaster|\b4k\b|\bhd\b|\bhq\b|\bmv\b|m\/v|explicit|clean|prod\.|color coded|colour coded/i
        .test(seg) ? "" : seg;
    }).replace(/\s+(official\s+(music\s+)?video|official\s+audio|lyrics)\s*$/i, "")
      .replace(/\s{2,}/g, " ").trim();
    var m = /\s[-–—|]\s/.exec(t);
    if (m) {
      return {
        artist: t.slice(0, m.index).trim(),
        title: t.slice(m.index + m[0].length).trim()
      };
    }
    return {
      artist: ch.replace(/\s*(vevo|official|music)\s*$/i, "").trim(),
      title: t
    };
  }

  /* ── public surface (the contract radio.js speaks) ────────────── */
  window.RadioYouTube = {
    hasKey: function () { return !!KEY; },
    enabled: enabled,
    setEnabled: setEnabled,
    playable: playable,
    attachTo: function (el) { targetEl = el; },
    follow: follow,
    note: function () { return note; },
    stop: stop,
    resolve: resolve,
    lookup: lookup,
    oembed: oembed,
    parseTitle: parseTitle,
    dbg: function () { return dbgLog.slice(); },
    quotaLeft: quotaLeft
  };
})();
