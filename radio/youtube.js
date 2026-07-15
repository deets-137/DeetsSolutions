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
          onError: function () {
            /* embed-disabled / dead video: mark it and fall through to
               the Apple preview tier on the next tick */
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
  /* Seek-rebuffer armor (2026-07-15 — the choppy-video fix): a MusicKit
     seek is near-instant, an IFrame seek REBUFFERS. Seeking to the
     clock therefore lands behind it again by the buffer time, and a
     chronic reload loop follows every CORRECTION_GAP — both listeners
     in lockstep, since both chase the same room clock. So every
     seek/cue aims AHEAD at expected + seekPad; the pad is re-measured
     from where playback actually lands (a padded op corrects it, a
     bare scheduled start re-estimates it from spin-up); and a landing
     start/seek gets one drift-free settle window — apple.js's one-shot
     post-start resync idiom, inverted for a player whose seeks cost
     seconds instead of milliseconds. */
  var seekPad = 1200;          // ms the room clock moves while we buffer
  var PAD_MIN = 250;
  var PAD_MAX = 4000;
  var settling = false;        // a start/seek is landing — measure it
  var settlingPadded = false;  // whether seekPad rode that op
  var cuePadded = false;       // whether the current load's cue carried it
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
      } catch (e) {}
      loading = false;
      return;                              // next tick resumes the chase
    }
    if (hold) { starting = false; settling = false; return; }
    /* past the video's own end while the room clock runs (duration
       mismatch): fall silent, hide the end screen; the room advances */
    if (st === 0 ||
        (entry.youtube.durationMs && view.expectedMs >= entry.youtube.durationMs)) {
      hide();
      return;
    }
    if (st !== 1) {                        // not playing yet
      if (st === 3 && starting) {          // buffering under a start latch
        if (Date.now() - startingAt < START_RETRY_MS) { show(); return; }
        starting = false;                  // wedged — try again
      }
      if (!hasGesture()) { note = "blocked"; return; }
      starting = true;
      startingAt = Date.now();
      settling = true;                     // measure where this start lands
      settlingPadded = cuePadded;
      try { player.playVideo(); } catch (e) {}
      show();                              // playing (or ads) begins — visible
      return;
    }
    starting = false;
    show();
    var localMs = 0;
    try { localMs = player.getCurrentTime() * 1000; } catch (e) {}
    var t = Date.now();
    if (settling) {
      /* the start/seek just landed: fold the landing error into the pad
         (average damps the noise) and grant one settle window before
         drift checks resume — never an instant second correction */
      settling = false;
      var err = localMs - view.expectedMs;    // negative = landed behind
      var est = settlingPadded ? seekPad - err : -err;
      seekPad = Math.max(PAD_MIN, Math.min(PAD_MAX, Math.round((seekPad + est) / 2)));
      lastCorrection = t;
      return;
    }
    if (Math.abs(localMs - view.expectedMs) > DRIFT_MS &&
        t - lastCorrection > CORRECTION_GAP_MS) {
      lastCorrection = t;
      settling = true;                     // this seek rebuffers — measure it too
      settlingPadded = true;
      try { player.seekTo((view.expectedMs + seekPad) / 1000, true); } catch (e) {}
    }
  }

  function stop() {
    silence();
    hide();
    loadedId = null;
    loading = false;
    starting = false;
    settling = false;
    cuePadded = false;
    note = null;
  }

  /* ── auto-resolver: Data API Topic/VEVO search (docs/youtube.md) ── */
  function isoToMs(iso) {
    var m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
    if (!m) return 0;
    return (((+m[1] || 0) * 60 + (+m[2] || 0)) * 60 + (+m[3] || 0)) * 1000;
  }
  /* ── quota ledger (docs/youtube.md build log, 2026-07-15) ───────
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
     single metered call and no oEmbed (shape decision, build log). */
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

  /* keyless oEmbed lookup (2026-07-15, the key parked for launch — build
     log chunk 8): same shape as lookup() so runYtAdd can fall back to it,
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
    quotaLeft: quotaLeft
  };
})();
