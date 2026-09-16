/* DeetsMusic page — the in-page mock (?mock), for local evaluation.

   Loaded on every visit but inert unless the URL carries ?mock. It answers
   deetsmusic.js's requests with the DeetsSupport worker's exact response
   shapes (docs/support.md; DeetsSupport src/index.js + src/update.js), so
   the page can be judged before the releases route is deployed and before
   the boards hold real posts. Nothing here reaches a server.

   Modes:
     ?mock          degraded status (an old failure in the window), full data
     ?mock=up       every check passed
     ?mock=down     the last checks failed
     ?mock=empty    unmonitored, no posts, releases route 404 (not deployed)
   In every mode the visitor is signed in (js/account.js MOCK_USER) and that
   account is the OWNER (2026-09-14, for testing): hidden posts list, the
   right-click menu works, and comments post. Signing OUT in the page makes
   you a guest here too — the only local way to see what a stranger is sent.
   The real owner check only runs in the worker, so this grants nothing on
   the live site.

   Posts you send are kept in sessionStorage per mode, so a reload keeps
   them. Unlike the worker (where a new issue stays private until Aditya
   approves it), EVERY post you send here goes straight onto its board, so
   the mock doubles as a preview of how a new post reads. A private ticket
   with an owner reply is seeded at #t=mockticket000001.

   Release notes are the real text from DeetsMusic docs/RELEASE-NOTES.md
   (each entry up to its first ###). The withdrawn 0.2.2 row and every
   post are invented, and say so with a [mock] prefix. */
(function () {
  "use strict";

  var q = new URLSearchParams(location.search);
  if (!q.has("mock")) return;

  var MODE = q.get("mock") || "";
  var KEY = "deets-dm-mock";
  var JWT_SHAPE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
  var NOW = Math.floor(Date.now() / 1000);
  var HOUR = 3600, DAY = 86400;

  function paras(list) { return list.join("\n\n"); }

  var RELEASES = [
    { version: "0.4.3", pub_date: "2026-09-14T20:00:00.000Z", size: 9876543,
      url: "https://music-api.deets.solutions/update/deetsmusic/file/DeetsMusic_0.4.3_x64-setup.exe",
      notes: paras([
        "**DeetsMusic updates itself.** When a new version is out, DeetsMusic downloads it in the background and asks you to restart. The restart takes a few seconds, and the song you were on comes back where it stopped. Press Later to finish what you are doing, or Skip this version to wait for the next one. Choose Automatic, Ask, or Off in Settings › Updates.",
        "**Go back to an earlier version.** Settings › Updates › Roll back installs an earlier version if a new one gives you trouble. Your library, playlists, and settings stay. (Roll back lists versions from 0.4.3 on.)",
        "**The extension question shows once.** The installer asks about the browser extension only the first time. It does not ask again after you say No, after the extension is set up, or during an update."
      ]) },
    { version: "0.4.1", pub_date: "2026-09-14T00:00:00.000Z", history: true,
      notes: paras([
        "**Drag songs between cards.** Press and drag a song, album, artist, or playlist from any card. Drop it on the Queue card to queue it where the line shows. Drop it on a playlist to add it. Drop it on the Library card to add it to your library. Drop it on Now Playing to play it at once; what you had queued plays after it (Settings › Playback › Drop on Now Playing). Press Escape to cancel a drag.",
        "**Edit your playlists.** Drag songs to reorder a playlist, rename it, give it your own cover, and delete it (a playlist with songs asks first). Export a playlist to Apple Music, send it new songs later, or import an Apple playlist to edit it here.",
        "**Playback comes back after a network drop.** When the connection returns, the song you were on reloads at the place it stopped.",
        "**Smaller fixes.** The Settings scrollbar no longer shifts the rows when a section opens. A card's title menu uses two columns when the window is too short. Right-click shows DeetsMusic menus only; a text field gets Cut, Copy, Paste, and Select All. Browser keys such as Ctrl+F and F5 do nothing in the app."
      ]) },
    { version: "0.4.0", pub_date: "2026-09-13T00:00:00.000Z", history: true,
      notes: paras([
        "**Sign in from a clear page.** The browser sign-in now opens a DeetsMusic sign-in page. When you finish, the page sends you back to DeetsMusic and a notice confirms the sign-in. Click the Account button again to cancel a sign-in that is still waiting.",
        "**A large Library scrolls smoothly.** DeetsMusic draws only the rows near the screen, so a library of thousands of songs scrolls smoothly and uses less memory.",
        "**Settings are easier to scan.** Each section folds and remembers whether you left it open. Notices now show for every action by default (Settings › Look and feel › Show notices)."
      ]) },
    { version: "0.3.2", pub_date: "2026-09-13T00:00:00.000Z", history: true,
      notes: paras([
        "**Signing in works every time.** A sign-in now always asks Apple for a fresh sign-in, and DeetsMusic checks it before saving it. Before, the sign-in page could reuse an old sign-in that Apple no longer accepted and still say \"Done\".",
        "**No restart after a sign-in.** Songs play as soon as you sign in again.",
        "**Playback recovers by itself.** If Apple Music drops the connection for a moment, DeetsMusic reconnects it before the next song. If Apple has really signed you out, a notice says so and gives you a Sign in button. At launch, an expired sign-in is named at once instead of a library sync failing quietly.",
        "**Better bug reports.** The log now records playback and sign-in problems as they happen (Settings › Bugs › App log)."
      ]) },
    { version: "0.3.1", pub_date: "2026-09-13T00:00:00.000Z", history: true,
      notes: paras([
        "**DeetsMusic says what went wrong.** If Apple Music stops working, a notice names the cause and gives the one button that fixes it: **Sign in**, **Try again**, or **Try now**. If the problem is on Apple's side, DeetsMusic says your account is fine and keeps trying on its own. The old \"Unable to prepare for playback\" box is gone.",
        "**Sign-in is clearer.** Playing a song while signed out asks you to sign in. An expired sign-in shows as \"Sign-in expired\" under Account. A sign-in that does not finish says so at once, with a Try again button.",
        "**Notices.** Short messages confirm or explain actions (Settings › Look and feel › Show notices).",
        "**Also new:** smoother scrolling through a large Library, calmer moving backgrounds with a Settings › Look and feel › Animate backgrounds choice, an Add to Library square on Search songs, the official Apple Music icon on Apple playlists, and Settings › About."
      ]) },
    { version: "0.3.0", pub_date: "2026-09-12T00:00:00.000Z", history: true,
      notes: paras([
        "**Favorites.** Right-click a song › Favorite. The ♥ syncs with Apple Music. The Library has a \"Favorites only\" filter.",
        "**Faster start.** A song starts sooner after a click. The queue comes back after a restart.",
        "**Songs Apple Music no longer offers are skipped.** DeetsMusic remembers them for 7 days, then tries them again.",
        "**Copy Link.** Right-click a song or an album › Copy Link. The link opens in Apple Music.",
        "**Also new:** local playlist covers, pinned searches, a weekly Replay, smooth theme and skin changes, Now Playing text in the album's colors, and a Glass \"Play on\" panel."
      ]) },
    { version: "0.2.2", pub_date: "2026-09-11T00:00:00.000Z", withdrawn: true,
      withdrawn_reason: "[mock] An invented row, so the withdrawn style can be judged.",
      notes: "**[mock] A withdrawn release.** No such entry exists in RELEASE-NOTES.md; this row only shows how a withdrawn version reads on the page." },
    { version: "0.2.1", pub_date: "2026-09-10T00:00:00.000Z", history: true,
      notes: "A fix for 0.2.0: the first speaker connect on an installed build now asks for the Windows firewall permission it needs. (0.2.0 could skip the prompt and then fail with \"Couldn't reach\".)" },
    { version: "0.2.0", pub_date: "2026-09-10T00:00:00.000Z", history: true,
      notes: paras([
        "**Play on a HomePod.** Click the AirPlay square next to the volume slider and pick a speaker. The volume slider then controls the speaker, and the speaker starts at 20 % the first time. The HomePod's touch surface and Siri control playback. The Home app on an iPhone shows the song and its cover. The PC keeps playing too in this version.",
        "**Control from an AI app or the command line.** Settings › Connections. Claude Desktop, Claude Code, Cursor and any local MCP app can play, pause, search, queue and read what is playing. \"Copy setup for\" gives you the exact text to paste. The guide is [docs/AGENT-SETUP.md](AGENT-SETUP.md). Turn it off with one switch.",
        "**Start with Windows.** Settings › Window. Starts in the tray at sign-in."
      ]) },
    { version: "0.1.3", pub_date: "2026-09-09T00:00:00.000Z", history: true,
      notes: "First installer line: one instance only, the tray flyout, the browser extension, the `deetsmusic` CLI and MCP server." }
  ];

  function post(code, kind, state, pub, title, body, interest, ageDays) {
    var t = NOW - Math.round(ageDays * DAY);
    return { code: code, pid: null, app: "deetsmusic", kind: kind, state: state, public: pub ? 1 : 0,
             source: "web", title: title, body: body, meta: null, interest: interest,
             created_at: t, updated_at: t };
  }

  function seed() {
    var posts = MODE === "empty" ? [] : [
      post("mocksuggest00001", "suggestion", "planned", true, "[mock] A lyrics card",
        "Show the lyrics of the song that is playing, in a card like the Queue card.", 14, 3),
      post("mocksuggest00002", "suggestion", "open", true, "[mock] Last.fm scrobbling",
        "Send what I play to Last.fm.", 9, 2),
      post("mocksuggest00003", "suggestion", "open", true, "[mock] A mini player that stays on top",
        "A small window with the cover, play/pause and skip, that stays above other windows while I work.\n\nIt could be the tray flyout, torn off and pinned. Bonus if it follows the album colors like Now Playing does, and if it remembers where I put it on which monitor.", 5, 1),
      post("mockissue0000001", "issue", "fixed", true, "[mock] The queue forgets its order after a restart",
        "After I restart DeetsMusic, songs I dragged into a new order go back to the order I queued them in.", 6, 4),
      post("mockissue0000002", "issue", "open", true, "[mock] HomePod volume jumps at the start of a song",
        "When a new song starts on a HomePod, the volume is loud for a second and then drops to where the slider is.", 3, 1.5),
      post("mockissue0000003", "issue", "planned", true, "[mock] Library sync stalls on a very large library",
        "With about 40,000 songs, the first sync stops near 80% and does not finish.", 11, 0.5),
      post("mockticket000001", "issue", "open", false, "[mock] Sign-in page never sends me back",
        "I finish signing in on the browser page, but DeetsMusic still says Not signed in.\n\nWindows 11 23H2, Edge as default browser.", 0, 1)
    ];
    if (posts.length) posts[posts.length - 1].meta = JSON.stringify({ version: "0.4.1" });
    // Aditya's own test bug from the live board, under its REAL code, so the
    // "Your posts" link his browser saved opens here as a full ticket page.
    // Its version is one the bug form's dropdown offers (the live row still
    // holds "0.0402", typed into the old free-text box).
    if (posts.length) {
      var lobster = post("4x0NsiAsa16J9EZ6", "issue", "open", false, "Lobster too buttery", "Ate", 0, 0.2);
      lobster.meta = JSON.stringify({ version: "0.4.3" });
      posts.push(lobster);
    }
    // The public id (support.md, "Threads"). Fixed here, random on the worker,
    // so a #p= link into the mock survives a reload.
    posts.forEach(function (x, i) { x.pid = "mockpid" + String(100000001 + i); });
    /* A member's comment: an account, a name and a colour snapshotted at post
       time. `hidden` is the owner's flag; `uid` is what Block acts on. */
    var rid = 0;
    function cmt(code, name, color, uid, hoursAgo, text, hidden) {
      return { id: ++rid, code: code, author: "member", uid: uid, name: name,
               color: color, hidden: hidden ? 1 : 0, body: text,
               created_at: NOW - Math.round(hoursAgo * HOUR) };
    }
    function said(code, author, hoursAgo, text) {   // the reporter's, or Aditya's
      return { id: ++rid, code: code, author: author, body: text,
               created_at: NOW - Math.round(hoursAgo * HOUR) };
    }
    var replies = MODE === "empty" ? [] : [
      said("mockticket000001", "owner", 20,
        "[mock] Thanks. Does it still happen on 0.4.3? The sign-in page changed in 0.4.0."),
      said("mockticket000001", "reporter", 18,
        "[mock] Updated to 0.4.3 and it works now."),
      // the lobster thread: his real reporter reply, then an invented owner answer
      said("4x0NsiAsa16J9EZ6", "reporter", 4, "Yo no way!"),
      said("4x0NsiAsa16J9EZ6", "owner", 2,
        "[mock] Confirmed on 0.4.3. Halving the butter in the next update."),

      /* ── Threads to click through (2026-09-15) ──────────────────────
         Anything you post here comes out as Aditya, because everyone on the
         mock is the owner. These are seeded so the OTHER rows — a member's
         name and colour, a hidden one, a blocked one — are visible without a
         second account. Each public post below is a different case:

           A lyrics card       a short thread, one hidden row
           Last.fm scrobbling  members and an owner answer, ending on his
           mini player         the long one: eight rows, a blocked account
           queue forgets       the reporter ("Poster"), his answer, a follow-up
           library sync        one lonely comment
           HomePod volume      NOTHING — the empty-thread line          */

      // A lyrics card — one row hidden by the owner
      cmt("mocksuggest00001", "Margot", "#3f8fd0", "mock-member-1", 30,
        "[mock] Would love this. Even just the current line, big, would do it."),
      cmt("mocksuggest00001", "kev", "#6ec06e", "mock-member-2", 26,
        "[mock] Seconded, and it should follow the album colours like Now Playing."),
      cmt("mocksuggest00001", "throwaway", null, "mock-member-3", 25,
        "[mock] (a hidden comment — only the owner sees this one, dashed)", true),

      // Last.fm — members, then his answer closes it out
      cmt("mocksuggest00002", "hal", "#c77dd4", "mock-member-4", 44,
        "[mock] Scrobbling is the one thing keeping me on the old player."),
      cmt("mocksuggest00002", "Margot", "#3f8fd0", "mock-member-1", 41,
        "[mock] Same. ListenBrainz too, if it is not much more work — it is the same shape of API."),
      said("mocksuggest00002", "owner", 12,
        "[mock] Reading up on both. The half I am unsure about is what happens to a scrobble queued while you are offline."),

      // the mini player — the long thread, with a blocked account in it
      cmt("mocksuggest00003", "kev", "#6ec06e", "mock-member-2", 70,
        "[mock] A pinned mini player would be the whole reason I keep it open."),
      cmt("mocksuggest00003", "Priya", "#e0a23c", "mock-member-5", 66,
        "[mock] Please let it remember which monitor. Every other player I have tried forgets."),
      cmt("mocksuggest00003", "sam_r", "#4fb3a5", "mock-member-6", 52,
        "[mock] Tearing the tray flyout off is exactly right. It already looks like the thing."),
      cmt("mocksuggest00003", "nine", "#d94141", "mock-member-9", 50,
        "[mock] (a blocked account's comment — hidden, and marked Blocked in the owner's view)", true),
      cmt("mocksuggest00003", "hal", "#c77dd4", "mock-member-4", 48,
        "[mock] One more: keep the keyboard shortcuts working while it has focus."),
      said("mocksuggest00003", "owner", 30,
        "[mock] All of this is the same window, so it is one job. The monitor memory is the fiddly part."),
      cmt("mocksuggest00003", "Priya", "#e0a23c", "mock-member-5", 20,
        "[mock] Happy to test it on a three-monitor setup whenever there is a build."),
      cmt("mocksuggest00003", "a-very-long-display-name", "#8b7bd8", "mock-member-7", 6,
        "[mock] A long name and a long comment, for the wrapping: the point of this one is to run past a single line so the thread has something tall in it and the name has somewhere to break."),

      /* the fixed bug — the only PUBLIC thread with a reporter row in it, so
         it is where the "Poster" byline shows (on #t= the same row says
         "You"). Then his answer, then someone saying it is not fixed. */
      said("mockissue0000001", "reporter", 100,
        "[mock] It is the drag order specifically — the queue itself survives, the order I dragged them into does not."),
      said("mockissue0000001", "owner", 96,
        "[mock] Fixed in 0.4.2 — the queue order is written on every change now, not on exit."),
      cmt("mockissue0000001", "sam_r", "#4fb3a5", "mock-member-6", 9,
        "[mock] Still happens for me on 0.4.3, but only if I close from the tray icon rather than the window."),

      // library sync — one comment, so the thread is not empty but barely
      cmt("mockissue0000003", "Priya", "#e0a23c", "mock-member-5", 5,
        "[mock] 62,000 songs here and it stops around the same place.")

      // NOTE: mockissue0000002 (HomePod volume) has no thread on purpose —
      // it is where "No replies yet" shows.
    ];
    /* ── Polls (support.md, "Polls") ──────────────────────────────
       A poll hangs off ONE comment, whose body is its question, so these add
       comments that carry one. Four cases, so every state can be looked at
       without voting your way into it:

         mini player   one pick, a runaway option — a 90%-vs-2% bar
         Last.fm       several picks, and an option a member added
         lyrics card   closed BY ITS AUTHOR, results standing
         queue order   closed BY THE THREAD (its post is 'fixed'), closed = 0

       Votes are rows, not totals, because that is what the worker counts: a
       blocked account's votes leave every count the moment it is blocked. The
       one vote of yours is on the Last.fm poll, so the mini player opens
       unvoted and the bars have somewhere to move to. */
    var polls = [], pollOptions = [], pollVotes = [], oid = 0;
    function poll(id, code, question, hoursAgo, opts, conf) {
      conf = conf || {};
      var r = { id: ++rid, code: code, author: "member",
                uid: conf.uid, name: conf.name, color: conf.color, hidden: 0,
                body: question, created_at: NOW - Math.round(hoursAgo * HOUR) };
      replies.push(r);
      polls.push({ id: id, reply_id: r.id, code: code, multi: conf.multi ? 1 : 0,
                   closed: conf.closed ? 1 : 0, open_options: 1, created_at: r.created_at });
      opts.forEach(function (o) {
        pollOptions.push({ id: ++oid, poll_id: id, text: o.text, uid: o.uid || conf.uid,
                           hidden: o.hidden ? 1 : 0, created_at: r.created_at });
        var here = oid;
        for (var i = 0; i < (o.votes || 0); i++) {     // one row per voter, as D1 holds them
          pollVotes.push({ poll_id: id, uid: "mock-voter-" + id + "-" + here + "-" + i, option_id: here });
        }
        (o.who || []).forEach(function (u) { pollVotes.push({ poll_id: id, uid: u, option_id: here }); });
      });
    }
    if (MODE !== "empty") {
      poll(1, "mocksuggest00003", "[mock] Where should the mini player live?", 40, [
        { text: "[mock] A window you can pin over anything", votes: 89 },
        { text: "[mock] Docked to the side of the main window", votes: 2 },
        { text: "[mock] The tray flyout, torn off", votes: 8 }
      ], { uid: "mock-member-2", name: "kev", color: "#6ec06e" });

      poll(2, "mocksuggest00002", "[mock] Which of these would you actually use?", 36, [
        { text: "[mock] Last.fm scrobbling", votes: 14, who: ["mock-user"] },
        { text: "[mock] ListenBrainz", votes: 6 },
        { text: "[mock] Nothing — I do not scrobble", votes: 3 },
        // An option a VOTER added: open_options is on by default (his call).
        { text: "[mock] Libre.fm — added by someone else", votes: 4, uid: "mock-member-5" }
      ], { multi: true, uid: "mock-member-4", name: "hal", color: "#c77dd4" });

      poll(3, "mocksuggest00001", "[mock] How big should the lyrics card be?", 28, [
        { text: "[mock] Just the line playing now", votes: 11 },
        { text: "[mock] The whole song, scrolling", votes: 19 }
      ], { closed: true, uid: "mock-member-1", name: "Margot", color: "#3f8fd0" });

      // closed = 0: this one is closed because its POST is 'fixed'.
      poll(4, "mockissue0000001", "[mock] Did 0.4.2 fix the queue order for you?", 8, [
        { text: "[mock] Fixed for me", votes: 6 },
        { text: "[mock] Still broken", votes: 2 }
      ], { uid: "mock-member-6", name: "sam_r", color: "#4fb3a5" });
    }
    // mock-member-9 is blocked, which is why its comment above is hidden.
    return { mode: MODE, posts: posts, replies: replies, blocked: ["mock-member-9"],
             polls: polls, pollOptions: pollOptions, pollVotes: pollVotes };
  }

  var db = (function () {
    try {
      var d = JSON.parse(sessionStorage.getItem(KEY));
      if (d && d.mode === MODE && Array.isArray(d.posts)) {
        d.posts.forEach(function (x) { if (!x.pid) x.pid = code16(); });   // a db saved before the id split
        if (!Array.isArray(d.blocked)) d.blocked = [];                    // …or before comments
        if (!Array.isArray(d.polls)) { d.polls = []; d.pollOptions = []; d.pollVotes = []; }   // …or before polls
        return d;
      }
    } catch (e) {}
    return seed();
  })();
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }

  function checks() {
    if (MODE === "empty") return [];
    var out = [];
    for (var i = 0; i < 72; i++) {
      var bad = MODE === "down" ? i < 4 : (MODE === "up" ? false : (i === 38 || i === 39));
      out.push({ checked_at: NOW - 60 - i * 300, ok: !bad, ms: bad ? null : 40 + ((i * 37) % 90),
                 note: bad ? (i % 2 ? "TimeoutError" : "http 503") : null });
    }
    return out;
  }
  function deriveStatus(c) {   // DeetsSupport src/index.js, verbatim logic
    if (!c.length) return "unknown";
    if (c.slice(0, 3).every(function (x) { return !x.ok; })) return "down";
    if (c[0].ok && c.every(function (x) { return x.ok; })) return "up";
    return "degraded";
  }

  function code16() {
    var b = new Uint8Array(12);
    crypto.getRandomValues(b);
    return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_");
  }
  function str(v, max) {
    if (typeof v !== "string") return null;
    v = v.trim();
    return v && v.length <= max ? v : null;
  }
  /* js/account.js signs you in as MOCK_USER on every ?mock load, and here
     that account is also the owner — the stand-in for a verified ds_sess.
     It follows the sign-in rather than being a constant, so signing out in
     the page turns you into a guest: the one way to see, locally, what a
     stranger is sent (no hidden rows, no owner menu, no comment box). */
  function signedIn() {
    var a = window.DeetsAccount;
    return (a && a.get()) || null;
  }
  function isOwnerMock() { return !!signedIn(); }
  var MOCK_UID = "mock-user";

  /* ── Polls (support.md, "Polls") ────────────────────────────────────
     The worker's threadPolls, shape for shape. `closed` goes out already
     OR'd with the post's state, so the page never has to know a post is
     fixed to stop offering a vote, and the counts drop blocked accounts and
     hidden options exactly as the worker's GROUP BY does. */
  var POLL_CLOSED_STATES = ["fixed", "wontfix", "closed"];
  var POLL_MAX_OPTS = 6;
  function pollBy(id) { return db.polls.filter(function (x) { return x.id === id; })[0] || null; }
  function pollPost(p) { return db.posts.filter(function (x) { return x.code === p.code; })[0] || null; }
  function pollIsClosed(p) {
    var post = pollPost(p);
    return !!p.closed || !!(post && POLL_CLOSED_STATES.indexOf(post.state) >= 0);
  }
  function pollOn(replyId) {
    var p = db.polls.filter(function (x) { return x.reply_id === replyId; })[0];
    if (!p) return null;
    var owner = isOwnerMock();
    var me = signedIn();
    var author = db.replies.filter(function (r) { return r.id === p.reply_id; })[0];
    function blocked(u) { return db.blocked.indexOf(u) >= 0; }
    var opts = db.pollOptions
      .filter(function (o) { return o.poll_id === p.id && (owner || !o.hidden); })
      .sort(function (a, b) { return a.created_at - b.created_at || a.id - b.id; })
      .map(function (o) {
        var out = { id: o.id, text: o.text, votes: o.hidden ? 0 : db.pollVotes.filter(function (v) {
          return v.option_id === o.id && !blocked(v.uid);
        }).length };
        if (owner) { out.hidden = !!o.hidden; out.uid = o.uid == null ? null : o.uid; }
        return out;
      });
    return {
      id: p.id,
      multi: !!p.multi,
      open_options: !!p.open_options,
      closed: pollIsClosed(p),
      closed_state: !!(pollPost(p) && POLL_CLOSED_STATES.indexOf(pollPost(p).state) >= 0),
      // Whether THIS viewer may close it — a member is never sent another
      // row's uid, so the worker answers the question instead.
      yours: !!me && !!author && author.uid === MOCK_UID,
      options: opts,
      mine: me
        ? db.pollVotes.filter(function (v) { return v.poll_id === p.id && v.uid === MOCK_UID; })
                      .map(function (v) { return v.option_id; })
        : []
    };
  }
  function nextOptionId() {
    return db.pollOptions.reduce(function (n, o) { return Math.max(n, o.id); }, 0) + 1;
  }
  function nextPollId() {
    return db.polls.reduce(function (n, p) { return Math.max(n, p.id); }, 0) + 1;
  }
  // What the page repaints from after a vote: the worker's voteState.
  function voteState(id) {
    function blocked(u) { return db.blocked.indexOf(u) >= 0; }
    return {
      options: db.pollOptions.filter(function (o) { return o.poll_id === id && !o.hidden; })
        .map(function (o) {
          return { id: o.id, votes: db.pollVotes.filter(function (v) {
            return v.option_id === o.id && !blocked(v.uid);
          }).length };
        }),
      mine: db.pollVotes.filter(function (v) { return v.poll_id === id && v.uid === MOCK_UID; })
                        .map(function (v) { return v.option_id; })
    };
  }
  // A poll belongs to a comment, so a deleted comment takes it and its votes.
  function dropPollsFor(match) {
    var gone = db.polls.filter(match).map(function (p) { return p.id; });
    if (!gone.length) return;
    db.polls = db.polls.filter(function (p) { return gone.indexOf(p.id) < 0; });
    db.pollOptions = db.pollOptions.filter(function (o) { return gone.indexOf(o.poll_id) < 0; });
    db.pollVotes = db.pollVotes.filter(function (v) { return gone.indexOf(v.poll_id) < 0; });
  }
  // The comment's poll spec, as the worker's readPollSpec reads it.
  function readPollSpec(spec) {
    if (spec == null) return { poll: null };
    if (typeof spec !== "object" || !Array.isArray(spec.options)) return { err: "poll_options" };
    var opts = spec.options.map(function (o) { return str(o, 120); });
    if (opts.length < 2 || opts.length > POLL_MAX_OPTS) return { err: "poll_options" };
    if (opts.some(function (o) { return o === null; })) return { err: "poll_options" };
    var seen = {};
    for (var i = 0; i < opts.length; i++) {
      var k = opts[i].toLowerCase();
      if (seen[k]) return { err: "poll_duplicate" };
      seen[k] = true;
    }
    return { poll: { options: opts, multi: spec.multi === true, open_options: spec.open_options !== false } };
  }

  /* The worker's threadReplies. Comments and replies are one table in one
     order. A hidden row shows to the owner only, and `uid`/`blocked` go to
     the owner only — his menu is the only thing that acts on them. */
  function thread(code) {
    var owner = isOwnerMock();
    return db.replies
      .filter(function (r) { return r.code === code && (owner || !r.hidden); })
      .sort(function (a, b) { return a.created_at - b.created_at || a.id - b.id; })
      .map(function (r) {
        var o = { id: r.id, author: r.author, name: r.name == null ? null : r.name,
                  color: r.color == null ? null : r.color, body: r.body,
                  created_at: r.created_at, hidden: !!r.hidden };
        if (owner) {
          o.uid = r.uid == null ? null : r.uid;
          o.blocked = !!(r.uid && db.blocked.indexOf(r.uid) >= 0);
        }
        var poll = pollOn(r.id);
        if (poll) o.poll = poll;
        return o;
      });
  }

  function pub(p) {
    var version = null;   // the worker's json_extract(meta, '$.version'), invalid JSON → null
    try { var mv = p.meta && JSON.parse(p.meta); if (mv && mv.version != null) version = mv.version; } catch (e) {}
    // pid, never code — the worker's PUBLIC_COLS, verbatim in what it omits.
    return { pid: p.pid, app: p.app, kind: p.kind, state: p.state, title: p.title, body: p.body,
             interest: p.interest, created_at: p.created_at, updated_at: p.updated_at, version: version,
             /* A flag, never a tally: the card says the thread HAS a poll and
                nothing about how the vote is going (support.md, "Polls"). */
             polls: db.polls.some(function (pl) {
               var host = db.replies.filter(function (r) { return r.id === pl.reply_id; })[0];
               return pl.code === p.code && host && !host.hidden;
             }) };
  }
  /* The next reply id. NOT db.replies.length + 1: deleting a comment (the
     owner's menu) would then hand the next one an id that is already spoken
     for. D1's INTEGER PRIMARY KEY never reuses a row id either. */
  function nextReplyId() {
    return db.replies.reduce(function (n, r) { return Math.max(n, r.id); }, 0) + 1;
  }

  function res(status, data) { return { ok: status >= 200 && status < 300, status: status, data: data }; }

  function handle(host, method, path, body) {
    var u = new URL(path, "https://mock.invalid");
    var p = u.pathname;

    if (host === "music") {
      if (p === "/update/deetsmusic/releases" && method === "GET") {
        if (MODE === "empty") return res(404, { error: "route" });
        var latest = RELEASES.filter(function (r) { return r.url; })[0] || null;
        return res(200, { latest: latest, releases: RELEASES });
      }
      return res(404, { error: "route" });
    }

    // One app per row, as the worker answers /status?app=<id>. The Gatekeeper
    // (deetsmusic) follows the mode; the installer row passes in every mode
    // but empty, so ?mock=down shows the two rows disagreeing.
    if (p === "/status" && method === "GET") {
      var app = u.searchParams.get("app") || "deetsmusic";
      if (app === "deetsmusic-installer") {
        var ic = MODE === "empty" ? [] : checks().map(function (x) {
          return { checked_at: x.checked_at, ok: true, ms: 20 + ((x.checked_at / 300) % 30), note: null };
        });
        return res(200, { apps: [{ id: app, label: "DeetsMusic installer", monitored: MODE !== "empty",
          status: MODE === "empty" ? "unmonitored" : deriveStatus(ic), notice: "", checks: ic }] });
      }
      if (app !== "deetsmusic") return res(200, { apps: [] });
      var c = checks();
      return res(200, { apps: [{ id: "deetsmusic", label: "DeetsMusic", monitored: MODE !== "empty",
        status: MODE === "empty" ? "unmonitored" : deriveStatus(c),
        notice: MODE === "down" ? "[mock] 0.4.3 can't fetch its access key right now. Playback you already started keeps going." : "",
        checks: c }] });
    }

    if (p === "/posts" && method === "GET") {
      var kind = u.searchParams.get("kind");
      var list = db.posts.filter(function (x) { return x.public && (!kind || x.kind === kind); })
        .sort(function (a, b) { return b.interest - a.interest || b.created_at - a.created_at; })
        .map(pub);
      return res(200, { posts: list });
    }

    if (method === "POST" && JWT_SHAPE.test(JSON.stringify(body || {}))) return res(400, { error: "credential_shaped" });

    // Owner routes — the worker's handleAdmin. The signed-in mock account is
    // the owner (isOwnerMock above), standing in for a verified ds_sess.
    if (p === "/admin/me" && method === "GET") return res(200, { owner: isOwnerMock() });
    if (p.indexOf("/admin/") === 0) {
      if (!isOwnerMock()) return res(403, { error: "owner" });
      if (p === "/admin/posts" && method === "GET") {
        var akind = u.searchParams.get("kind");
        return res(200, { posts: db.posts.filter(function (x) { return !akind || x.kind === akind; })
          .sort(function (a, b) { return b.interest - a.interest || b.created_at - a.created_at; })
          .map(function (x) { var o = pub(x); o.public = !!x.public; o.code = x.code; return o; }) });
      }
      /* One poll option — the price of an open option list. Hidden, never
         deleted: the votes on it are still somebody's, and showing it again
         gives them back. */
      var pom = /^\/admin\/poll-options\/([0-9]{1,15})$/.exec(p);
      if (pom) {
        if (method !== "PATCH") return res(405, { error: "method" });
        var po = db.pollOptions.filter(function (o) { return o.id === Number(pom[1]); })[0];
        if (!po) return res(404, { error: "option" });
        if (typeof body.hidden !== "boolean") return res(400, { error: "hidden" });
        po.hidden = body.hidden ? 1 : 0;
        save();
        return res(200, { ok: true });
      }

      // Comment moderation — the worker's /admin/replies/<id> and /admin/block.
      var rm = /^\/admin\/replies\/([0-9]{1,15})$/.exec(p);
      if (rm) {
        var rr = db.replies.filter(function (x) { return x.id === Number(rm[1]); })[0];
        if (!rr) return res(404, { error: "reply" });
        if (method === "PATCH") {
          if (typeof body.hidden !== "boolean") return res(400, { error: "hidden" });
          rr.hidden = body.hidden ? 1 : 0; save();
          return res(200, { ok: true });
        }
        if (method === "DELETE") {
          // The comment IS the poll's question, so the poll goes with it.
          dropPollsFor(function (pl) { return pl.reply_id === rr.id; });
          db.replies = db.replies.filter(function (x) { return x.id !== rr.id; });
          save();
          return res(200, { ok: true });
        }
        return res(405, { error: "method" });
      }
      if (p === "/admin/block" && method === "POST") {
        var bu = str(body.uid, 64); if (!bu) return res(400, { error: "uid" });
        if (body.undo === true) {
          // Lifting a block does NOT unhide what it hid — Show is per-comment.
          db.blocked = db.blocked.filter(function (x) { return x !== bu; });
          save();
          return res(200, { blocked: false });
        }
        if (db.blocked.indexOf(bu) < 0) db.blocked.push(bu);
        db.replies.forEach(function (x) { if (x.uid === bu) x.hidden = 1; });
        // …and the options it added. Its votes leave the counts on their own.
        db.pollOptions.forEach(function (o) { if (o.uid === bu) o.hidden = 1; });
        save();
        return res(200, { blocked: true });
      }

      var am = /^\/admin\/posts\/([A-Za-z0-9_-]{8,32})(\/replies)?$/.exec(p);
      var ap = am && db.posts.filter(function (x) { return x.code === am[1]; })[0];
      if (am && !ap) return res(404, { error: "ticket" });
      if (ap) {
        var at = Math.floor(Date.now() / 1000);
        if (!am[2] && method === "PATCH") {
          if (body.state !== undefined) ap.state = body.state;
          if (body.public !== undefined) ap.public = body.public ? 1 : 0;
          ap.updated_at = at; save();
          return res(200, { ok: true });
        }
        if (!am[2] && method === "DELETE") {
          db.posts = db.posts.filter(function (x) { return x.code !== ap.code; });
          dropPollsFor(function (pl) { return pl.code === ap.code; });
          db.replies = db.replies.filter(function (r) { return r.code !== ap.code; });
          save();
          return res(200, { ok: true });
        }
        if (am[2] && method === "POST") {
          var ob = str(body.body, 4000); if (!ob) return res(400, { error: "body" });
          db.replies.push({ id: nextReplyId(), code: ap.code, author: "owner", body: ob, created_at: at });
          ap.updated_at = at; save();
          return res(201, { ok: true });
        }
      }
      return res(404, { error: "route" });
    }

    if (p === "/posts" && method === "POST") {
      if (body.kind !== "issue" && body.kind !== "suggestion") return res(400, { error: "kind" });
      var title = str(body.title, 120); if (!title) return res(400, { error: "title" });
      if (title.split(/\s+/).length > 10) return res(400, { error: "title_words" });
      var text = str(body.body, 4000); if (!text) return res(400, { error: "body" });
      // A preview, not the worker: every post you send here goes straight
      // onto its board, so how a new post reads can be judged at once.
      var np = post(code16(), body.kind, "new", true, title, text, 0, 0);
      np.pid = code16();
      np.meta = body.meta == null ? null : (typeof body.meta === "string" ? body.meta : JSON.stringify(body.meta));
      db.posts.push(np); save();
      return res(201, { code: np.code });
    }

    var mc = /^\/t\/([A-Za-z0-9_-]{8,32})\/close$/.exec(p);
    if (mc && method === "POST") {
      var cp = db.posts.filter(function (x) { return x.code === mc[1]; })[0];
      if (!cp) return res(404, { error: "ticket" });
      cp.state = "closed"; cp.updated_at = Math.floor(Date.now() / 1000); save();
      return res(200, { ok: true });
    }

    var m = /^\/t\/([A-Za-z0-9_-]{8,32})(\/replies)?$/.exec(p);
    if (m) {
      var found = db.posts.filter(function (x) { return x.code === m[1]; })[0];
      if (!found) return res(404, { error: "ticket" });
      if (!m[2] && method === "GET") {
        var full = pub(found);
        full.code = found.code;   // you already hold it — /t/<code> is how you got here
        full.public = !!found.public; full.source = found.source; full.meta = found.meta;
        return res(200, { post: full, replies: thread(found.code) });
      }
      if (m[2] && method === "POST") {
        var rb = str(body.body, 4000); if (!rb) return res(400, { error: "body" });
        db.replies.push({ id: nextReplyId(), code: found.code, author: "reporter", body: rb, created_at: Math.floor(Date.now() / 1000) });
        found.updated_at = Math.floor(Date.now() / 1000);
        save();
        return res(201, { ok: true });
      }
    }

    // GET /p/<pid> — the public thread page. Public posts only, and never a
    // code, a source or a meta: the worker's handleThread, shape for shape.
    var tm = /^\/p\/([A-Za-z0-9_-]{8,32})$/.exec(p);
    if (tm && method === "GET") {
      var tp = db.posts.filter(function (x) { return x.pid === tm[1] && x.public; })[0];
      if (!tp) return res(404, { error: "ticket" });
      return res(200, { post: pub(tp), replies: thread(tp.code) });
    }

    // POST /p/<pid>/comments — a signed-in account's comment. Everyone on the
    // mock is signed in (js/account.js MOCK_USER) as well as the owner, so
    // this stands in for a verified ds_sess exactly as /admin/ does.
    var cm = /^\/p\/([A-Za-z0-9_-]{8,32})\/comments$/.exec(p);
    if (cm && method === "POST") {
      var cp = db.posts.filter(function (x) { return x.pid === cm[1] && x.public; })[0];
      if (!cp) return res(404, { error: "ticket" });
      var me = signedIn();
      if (!me) return res(401, { error: "signin" });
      var cb = str(body.body, 4000); if (!cb) return res(400, { error: "body" });
      var cn = str(body.name, 24); if (!cn) return res(400, { error: "name" });
      var cc = /^#[0-9a-fA-F]{6}$/.test(body.color || "") ? String(body.color).toLowerCase() : null;
      if (db.blocked.indexOf(MOCK_UID) >= 0) return res(403, { error: "blocked" });
      var spec = readPollSpec(body.poll);
      if (spec.err) return res(400, { error: spec.err });
      var newId = nextReplyId(), at = Math.floor(Date.now() / 1000);
      db.replies.push({ id: newId, code: cp.code,
        author: isOwnerMock() ? "owner" : "member", uid: MOCK_UID,
        name: cn, color: cc, body: cb, hidden: 0, created_at: at });
      /* The poll rides the comment: the comment is the question, so the two
         land together or not at all. */
      if (spec.poll) {
        var np = nextPollId();
        db.polls.push({ id: np, reply_id: newId, code: cp.code,
          multi: spec.poll.multi ? 1 : 0, closed: 0,
          open_options: spec.poll.open_options ? 1 : 0, created_at: at });
        spec.poll.options.forEach(function (text) {
          db.pollOptions.push({ id: nextOptionId(), poll_id: np, text: text,
            uid: MOCK_UID, hidden: 0, created_at: at });
        });
      }
      cp.updated_at = at;
      save();
      return res(201, { ok: true });
    }

    /* POST /poll/<id>/vote — the WHOLE ballot, replacing whatever this
       account had. [] takes the vote back. One vote per account per poll is
       enforced here, not by a key, exactly as the worker does it. */
    var vm = /^\/poll\/([0-9]{1,15})\/vote$/.exec(p);
    if (vm && method === "POST") {
      var vp = pollBy(Number(vm[1]));
      if (!vp) return res(404, { error: "poll" });
      if (!signedIn()) return res(401, { error: "signin" });
      if (pollIsClosed(vp)) return res(409, { error: "poll_closed" });
      if (db.blocked.indexOf(MOCK_UID) >= 0) return res(403, { error: "blocked" });
      if (!Array.isArray(body.options)) return res(400, { error: "options" });
      var picks = body.options.map(Number);
      if (!vp.multi && picks.length > 1) return res(400, { error: "one_choice" });
      var live = db.pollOptions.filter(function (o) { return o.poll_id === vp.id && !o.hidden; })
                               .map(function (o) { return o.id; });
      if (picks.some(function (x) { return live.indexOf(x) < 0; })) return res(400, { error: "options" });
      db.pollVotes = db.pollVotes.filter(function (v) {
        return !(v.poll_id === vp.id && v.uid === MOCK_UID);
      });
      picks.forEach(function (x) { db.pollVotes.push({ poll_id: vp.id, uid: MOCK_UID, option_id: x }); });
      save();
      return res(200, voteState(vp.id));
    }

    /* POST /poll/<id>/options — anyone signed in, while open_options. Adding
       is not voting: the new bar arrives at zero. */
    var om = /^\/poll\/([0-9]{1,15})\/options$/.exec(p);
    if (om && method === "POST") {
      var op = pollBy(Number(om[1]));
      if (!op) return res(404, { error: "poll" });
      if (!signedIn()) return res(401, { error: "signin" });
      if (!op.open_options) return res(403, { error: "poll_fixed" });
      if (pollIsClosed(op)) return res(409, { error: "poll_closed" });
      if (db.blocked.indexOf(MOCK_UID) >= 0) return res(403, { error: "blocked" });
      var ot = str(body.text, 120);
      if (!ot) return res(400, { error: "option_text" });
      var held = db.pollOptions.filter(function (o) { return o.poll_id === op.id; });
      if (held.length >= POLL_MAX_OPTS) return res(409, { error: "poll_full" });
      if (held.some(function (o) { return o.text.toLowerCase() === ot.toLowerCase(); })) {
        return res(409, { error: "poll_duplicate" });
      }
      var newOpt = nextOptionId();
      db.pollOptions.push({ id: newOpt, poll_id: op.id, text: ot, uid: MOCK_UID,
                            hidden: 0, created_at: Math.floor(Date.now() / 1000) });
      save();
      return res(201, { id: newOpt, text: ot });
    }

    // PATCH /poll/<id> — {closed}, the poll's author or the owner.
    var pm2 = /^\/poll\/([0-9]{1,15})$/.exec(p);
    if (pm2 && method === "PATCH") {
      var pp = pollBy(Number(pm2[1]));
      if (!pp) return res(404, { error: "poll" });
      if (!signedIn()) return res(401, { error: "signin" });
      var host = db.replies.filter(function (r) { return r.id === pp.reply_id; })[0];
      if (!isOwnerMock() && !(host && host.uid === MOCK_UID)) return res(403, { error: "author" });
      if (typeof body.closed !== "boolean") return res(400, { error: "closed" });
      pp.closed = body.closed ? 1 : 0;
      save();
      return res(200, { closed: pollIsClosed(pp) });
    }

    if (p === "/interest" && method === "POST") {
      var id = body.pid || body.code;   // the worker honours a pre-split body too
      var s = db.posts.filter(function (x) { return (x.pid === id || x.code === id) && x.public; })[0];
      if (!s) return res(404, { error: "ticket" });
      if (body.undo === true) s.interest = Math.max(0, s.interest - 1); else s.interest++;
      save();
      return res(200, { interest: s.interest });
    }

    return res(404, { error: "route" });
  }

  window.DM_MOCK = {
    mode: MODE,
    request: function (host, method, path, body) {
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(handle(host, method, path, body)); }, 250);
      });
    }
  };
})();
