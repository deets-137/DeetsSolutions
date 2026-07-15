/* DeetsRadio — Apple Music side (docs/radio.md, "Providers" + "Sync details").

   Phase 2: real MusicKit. This module owns everything Apple —
   - the developer token (radio/dev-token.js, signed by scripts/radio-token.ps1)
   - catalog search (plain REST with the dev token; no MusicKit, no auth needed)
   - the authorize()/unauthorize() flow behind the Music Source pill
   - the PLAYBACK FOLLOWER: radio.js feeds it the room's view every tick and
     after every render; it drives one of two engines toward that view —
     MusicKit full tracks when authorized, a plain <audio> on the 30 s Apple
     preview otherwise. Any entry with no playable asset sits silent with a
     note ("one mechanism covers both cases" — the design's catalog-gap rule).

   The room stays the boss: this file never advances tracks, never seeks the
   room, never touches the queue. It only chases the clock it's shown.
   No user-facing copy in here — notes are token strings radio.js maps
   through RADIO_STRINGS. */
(function () {
  "use strict";

  var DRIFT_MS = 1750;        // correct when |local − expected| exceeds this
  var CORRECTION_GAP_MS = 5000;  // …but at most once per this window
  var PREVIEW_MS = 30000;     // Apple preview assets run ~30 s
  var SEARCH_LIMIT = 15;
  var STOREFRONT = "us";      // hardcoded for v0.9 — Aditya's storefront

  var token = window.RADIO_DEV_TOKEN || null;

  /* ── MusicKit bootstrap ───────────────────────────────────────── */
  var music = null;           // configured MusicKit instance
  var configuring = null;     // in-flight configure promise
  var authListeners = [];

  function notifyAuth() {
    authListeners.forEach(function (cb) { try { cb(); } catch (e) {} });
  }
  function configure() {
    if (music) return Promise.resolve(music);
    if (configuring) return configuring;
    if (!token || !window.MusicKit) return Promise.reject(new Error("musickit-unavailable"));
    configuring = window.MusicKit.configure({
      developerToken: token,
      app: { name: "DeetsRadio", build: "0.9" },
      /* MusicKit ships its own alert() for playback errors ("undefined",
         autoplay refusals) — the room narrates those itself via note() */
      suppressErrorDialog: true
    }).then(function () {
      music = window.MusicKit.getInstance();
      configuring = null;
      notifyAuth();          // isAuthorized may already be true from a past visit
      return music;
    }, function (err) {
      configuring = null;
      throw err;
    });
    return configuring;
  }
  /* A returning subscriber should get full tracks without re-clicking
     Connect — configure as soon as the CDN script lands so isAuthorized
     (persisted by MusicKit itself) is known early. Failures are quiet;
     the preview engine is always there. */
  if (token) {
    if (window.MusicKit) configure().catch(function () {});
    else document.addEventListener("musickitloaded", function () {
      configure().catch(function () {});
    });
  }

  /* ── catalog: REST + dev token (works for preview listeners too) ── */
  function apiGet(path) {
    var url = "https://api.music.apple.com/v1/catalog/" + STOREFRONT + path;
    return fetch(url, { headers: { Authorization: "Bearer " + token } })
      .then(function (res) {
        if (!res.ok) throw new Error("apple " + res.status);
        return res.json();
      });
  }
  function artUrl(a, px) {
    return a.artwork && a.artwork.url
      ? a.artwork.url.replace("{w}", String(px)).replace("{h}", String(px)) : null;
  }
  function mapSong(song) {
    var a = song.attributes || {};
    return {
      isrc: a.isrc || null,
      title: a.name || "",
      artist: a.artistName || "",
      album: a.albumName || "",
      artworkUrl: artUrl(a, 300),
      apple: { id: song.id, durationMs: a.durationInMillis || 0 },
      spotify: null,
      previewUrl: (a.previews && a.previews[0] && a.previews[0].url) || null,
      durationMs: a.durationInMillis || 0,
      match: "single"
    };
  }
  function mapAlbum(x) {
    var a = x.attributes || {};
    return { id: x.id, title: a.name || "", artist: a.artistName || "",
             year: String(a.releaseDate || "").slice(0, 4),
             artworkUrl: artUrl(a, 300) };
  }
  /* Sectioned results — DeetsMusic's search anatomy (Artists / Songs /
     Albums / Playlists; radio.js renders + drills). */
  function search(term) {
    var q = String(term || "").trim();
    if (!q) return Promise.resolve({ songs: [], artists: [], albums: [], playlists: [] });
    return apiGet("/search?types=songs,artists,albums,playlists&limit=" + SEARCH_LIMIT +
        "&term=" + encodeURIComponent(q))
      .then(function (json) {
        var r = json.results || {};
        var sec = function (kind) { return (r[kind] && r[kind].data) || []; };
        return {
          songs: sec("songs").map(mapSong),
          artists: sec("artists").map(function (x) {
            var a = x.attributes || {};
            return { id: x.id, name: a.name || "", artworkUrl: artUrl(a, 300) };
          }),
          albums: sec("albums").map(mapAlbum),
          playlists: sec("playlists").map(function (x) {
            var a = x.attributes || {};
            return { id: x.id, name: a.name || "", curator: a.curatorName || "",
                     artworkUrl: artUrl(a, 300) };
          })
        };
      });
  }
  /* drill-ins (DeetsMusic's panes): artist = albums + top songs;
     albums / playlists = their tracks, as Entries */
  function artistDetail(id) {
    var enc = encodeURIComponent(id);
    return Promise.all([
      apiGet("/artists/" + enc + "/albums?limit=25").catch(function () { return { data: [] }; }),
      apiGet("/artists/" + enc + "/view/top-songs?limit=20")
    ]).then(function (r) {
      return {
        albums: (r[0].data || []).map(mapAlbum),
        topSongs: (r[1].data || []).map(mapSong)
      };
    });
  }
  function albumSongs(id) {
    return apiGet("/albums/" + encodeURIComponent(id) + "/tracks?limit=100")
      .then(function (json) {
        return (json.data || []).filter(function (x) {
          return x.type === "songs";
        }).map(mapSong);
      });
  }
  function playlistSongs(id) {
    return apiGet("/playlists/" + encodeURIComponent(id) + "/tracks?limit=50")
      .then(function (json) {
        return (json.data || []).filter(function (x) {
          return x.type === "songs";     // playlists can carry music videos
        }).map(mapSong);
      });
  }
  /* Go-to-Artist hop (DeetsMusic's drillRelated): a song or album knows its
     artist's NAME but not its catalog id — one relationship call resolves
     it, session-memoized so a repeat drill costs no Apple call. */
  var relatedCache = {};
  function relatedArtist(kind, id) {     // kind: "songs" | "albums"
    var key = kind + ":" + id;
    relatedCache[key] = relatedCache[key] ||
      apiGet("/" + kind + "/" + encodeURIComponent(id) + "/artists")
        .then(function (json) {
          var a = (json.data && json.data[0]) || null;
          return a ? { id: a.id, name: (a.attributes && a.attributes.name) || "" } : null;
        });
    return relatedCache[key];
  }

  /* ── playback follower ────────────────────────────────────────── */
  /* Shared engine state. `view` is what radio.js last showed us:
     { entry, playing, counting, expectedMs } (entry may be null). */
  var note = null;            // "gap" | "preview" | "blocked" | null
  var gapLoggedId = null;     // last apple id logged as a catalog gap (dedupe)
  var latestView = null;      // most recent view (async callbacks read live pos)
  var lastCorrection = 0;
  var deadIds = {};           // apple ids MusicKit refused this session
  var previewsOn = true;      // Music Source toggle (radio.js persists it)

  /* Autoplay policy: until the page has seen a user gesture, play() is
     refused — so the engines don't even try (a hard refresh into a live
     room lands silent with the "blocked" note until a tap; the 200 ms
     tick picks playback up on the first gesture). */
  var activated = false;
  document.addEventListener("pointerdown", function () { activated = true; }, true);
  document.addEventListener("keydown", function () { activated = true; }, true);
  function hasGesture() {
    if (navigator.userActivation) return navigator.userActivation.hasBeenActive;
    return activated;
  }

  /* preview engine: one hidden <audio>, reused */
  var audio = new Audio();
  audio.preload = "auto";
  var audioUrl = null;
  var audioBlocked = false;

  /* full-track engine bookkeeping. MusicKit's setQueue()/play() promises
     can hang without settling when called mid-transition, so every latch
     carries a timestamp and expires — a wedged call costs one retry
     window, never the room. */
  var LOAD_RETRY_MS = 8000;   // setQueue gets this long before we try again
  var START_RETRY_MS = 5000;  // play() / spin-up gets this long
  var mkLoadedId = null;      // apple id currently in MusicKit's queue
  var mkLoading = false;
  var mkLoadingAt = 0;
  var mkSeq = 0;              // orphans a timed-out setQueue that settles late
  var mkStarting = false;     // a play() in flight — never overlap starts
  var mkStartingAt = 0;

  function playable(entry) {
    if (!entry) return "none";
    var appleId = entry.apple && entry.apple.id;
    var real = appleId && appleId.indexOf("mock.") !== 0;
    if (real && music && music.isAuthorized && !deadIds[appleId]) return "full";
    if (entry.previewUrl) return "preview";
    return "none";
  }

  function silence() {
    if (!audio.paused) audio.pause();
    if (music && music.isAuthorized && mkLoadedId) {
      try { if (music.playbackState === window.MusicKit.PlaybackStates.playing) music.pause(); }
      catch (e) {}
    }
  }

  /* full tracks: chase the view through MusicKit */
  function followFull(entry, view) {
    var states = window.MusicKit.PlaybackStates;
    var st = music.playbackState;
    var mkPlaying = st === states.playing;
    var hold = view.counting || !view.playing;
    /* silence is enforced before anything else, every tick — a pause must
       land even while a queue load is pending or wedged */
    if (hold && mkPlaying) music.pause();
    var id = entry.apple.id;
    if (mkLoadedId !== id) {
      if (mkLoading && Date.now() - mkLoadingAt < LOAD_RETRY_MS) return;
      mkLoading = true;
      mkLoadingAt = Date.now();
      var seq = ++mkSeq;
      if (!audio.paused) audio.pause();      // hand-off from the preview engine
      if (!hold && mkPlaying) {              // swap queues from a stopped player
        try { music.stop(); } catch (e) {}
      }
      music.setQueue({ songs: [id], startPlaying: false }).then(function () {
        if (seq !== mkSeq) return;           // a retried load already superseded this
        mkLoadedId = id;
        mkLoading = false;
      }, function () {
        if (seq !== mkSeq) return;
        deadIds[id] = true;                  // e.g. NOT_FOUND — fall to preview
        mkLoading = false;
      });
      return;                                // next tick resumes the chase
    }
    mkLoading = false;
    if (hold) {                              // preloaded and waiting is correct
      mkStarting = false;
      return;
    }
    if (!mkPlaying) {
      /* one start at a time (overlapping play() calls were the source of
         MusicKit's own error alert), but bounded — a play() that never
         settles gets retried after its window */
      var spinning = st === states.loading || st === states.waiting || st === states.seeking;
      if (spinning && !mkStarting) { mkStarting = true; mkStartingAt = Date.now(); }
      if (mkStarting) {
        if (Date.now() - mkStartingAt < START_RETRY_MS) return;
        mkStarting = false;                  // wedged — try again
      }
      if (!hasGesture()) { note = "blocked"; return; }
      mkStarting = true;
      mkStartingAt = Date.now();
      music.play().then(function () {
        mkStarting = false;
        /* Fresh starts are born behind: the room clock ran from startedAt
           while setQueue()/play() spun up, so audio begins already late.
           Absorb that gap with one resync to the live room position now that
           playback is real — otherwise the drift loop below limps behind and
           re-seeks (re-buffering, audibly cutting) every few seconds. A resume
           doesn't hit this: MusicKit picks up where it paused, already aligned.
           Guarded so an already-aligned start (fast spin-up) takes no hitch. */
        if (!latestView || !latestView.playing || latestView.counting) return;
        if (mkLoadedId !== id) return;
        var expected = latestView.expectedMs;
        if (Math.abs(music.currentPlaybackTime * 1000 - expected) > 500) {
          music.seekToTime(expected / 1000).catch(function () {});
          lastCorrection = Date.now();       // hold off the drift loop's own seek
        }
      }, function () { mkStarting = false; note = "blocked"; });
      return;                                // let it spin up before drift checks
    }
    mkStarting = false;
    var localMs = music.currentPlaybackTime * 1000;
    var t = Date.now();
    if (Math.abs(localMs - view.expectedMs) > DRIFT_MS &&
        t - lastCorrection > CORRECTION_GAP_MS) {
      lastCorrection = t;
      music.seekToTime(view.expectedMs / 1000).catch(function () {});
    }
  }

  /* previews: chase the view through <audio>; past 30 s = honest silence */
  function followPreview(entry, view) {
    if (audioUrl !== entry.previewUrl) {
      audioUrl = entry.previewUrl;
      audio.src = audioUrl;
      audioBlocked = false;
    }
    if (view.counting || !view.playing) {
      if (!audio.paused) audio.pause();
      return;
    }
    if (view.expectedMs >= PREVIEW_MS || audio.ended) {
      if (!audio.paused) audio.pause();
      note = "preview";                      // preview over; the room plays on
      return;
    }
    if (audio.paused) {
      if (!hasGesture()) { note = "blocked"; return; }
      audio.currentTime = view.expectedMs / 1000;
      var p = audio.play();
      if (p && p.then) p.then(function () {
        audioBlocked = false;                // a success clears a stale block
      }, function () {
        audioBlocked = true;                 // autoplay policy — needs a gesture
      });
      if (audioBlocked) note = "blocked";
      return;
    }
    var t = Date.now();
    if (Math.abs(audio.currentTime * 1000 - view.expectedMs) > DRIFT_MS &&
        t - lastCorrection > CORRECTION_GAP_MS) {
      lastCorrection = t;
      audio.currentTime = view.expectedMs / 1000;
    }
  }

  function follow(view) {
    note = null;
    latestView = view;
    var entry = view && view.entry;
    var mode = playable(entry);
    if (mode === "full") { followFull(entry, view); return; }
    if (mode === "preview" && !previewsOn) {
      /* toggled off — chosen silence, but SAY so (note "off"): a rolling
         room with a silent device was read as a bug in live testing
         (2026-07-15) — radio.js toasts it and parks the progress bar */
      silence();
      note = "off";
      return;
    }
    if (mode === "preview") { followPreview(entry, view); return; }
    silence();
    /* a YT-only entry landing here (video off, or a dead id) has nothing
       Apple-side by construction — same silent-device treatment (note
       "gap": toast + parked bar), but nothing to report: the gap
       collector keys on Apple ids (docs/youtube.md, YT-first adds) */
    if (entry && !entry.apple) { note = "gap"; return; }
    /* a real entry with nothing to play is a catalog gap; the mock
       catalog's silent tracks are just the mock being the mock */
    if (entry && entry.apple && entry.apple.id &&
        entry.apple.id.indexOf("mock.") !== 0) {
      note = "gap";
      if (gapLoggedId !== entry.apple.id) {   // once per track, not every tick
        gapLoggedId = entry.apple.id;
        var info = { id: entry.apple.id, title: entry.title, artist: entry.artist };
        console.warn("[radio] catalog gap — not playable on this account:", info);
        /* …and to the worker's collector, so gaps accumulate for review
           (docs/radio.md — graduated from console-only) */
        var T = window.RadioTransport;
        if (T && T.reportGap) T.reportGap(info);
      }
    }
  }

  function stop() {
    silence();
    audio.removeAttribute("src");
    audioUrl = null;
    mkLoadedId = null;
    mkLoading = false;
    mkStarting = false;
    mkSeq++;                  // orphan any setQueue still settling
    note = null;
  }

  /* ── public surface ───────────────────────────────────────────── */
  window.RadioApple = {
    hasToken: function () { return !!token; },
    authorized: function () { return !!(music && music.isAuthorized); },
    onAuthChange: function (cb) { authListeners.push(cb); },
    connect: function () {
      return configure().then(function (m) {
        return m.authorize();
      }).then(function () { notifyAuth(); });
    },
    disconnect: function () {
      if (!music) return Promise.resolve();
      return music.unauthorize().then(function () {
        mkLoadedId = null;
        notifyAuth();
      });
    },
    search: search,
    artistDetail: artistDetail,
    albumSongs: albumSongs,
    playlistSongs: playlistSongs,
    relatedArtist: relatedArtist,
    follow: follow,
    note: function () { return note; },
    setPreviews: function (on) { previewsOn = !!on; },
    stop: stop
  };
})();
