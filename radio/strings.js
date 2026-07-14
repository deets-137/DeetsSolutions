/* DeetsRadio — UI copy (docs/radio.md, "UI text is handwritten").

   EVERY user-facing string on the radio page lives in this one flat object;
   radio.js holds no copy of its own. All values below are Claude-scaffolded
   PLACEHOLDERS, prefixed "[ph]" — Aditya handwrites each one, deleting the
   prefix as he goes. Nothing still carrying "[ph]" may ship.

   {curly} tokens are filled by radio.js (fmt()) — keep a token if you keep
   the fact it carries; drop it freely otherwise. */
window.RADIO_STRINGS = {
  /* bar + meta */
  tuneInPlaceholder: "Radio Room Code",
  yourStations:      "[ph] Your stations",
  metaIdle:          "Type in the Radio Room Code to tune in to a room (duh).",

  /* peek / create gate (below the bar, pre-join) */
  peekLive:     "[ph] On the air: {title} — {artist} · {n} listening",
  peekQuiet:    "[ph] The air is quiet right now · {n} listening",
  joinButton:   "[ph] Tune in",
  createLine:   "The '{code}' Room doesn't exist yet. Open it?",
  createButton: "Open the Room",
  nameLabel:    "Your Tag",
  nameNeeded:   "[ph] Pick a name first — the room wants to know who's adding bangers.",
  joinRefused:  "[ph] That station doesn't exist. Check the code with whoever sent it.",
  peekFailed:   "[ph] Couldn't reach the station. Try again in a moment.",

  /* toolbar pills — these four are handwritten (2026-07-13) */
  listeningPill: "{n} Listeners",
  sharePill:     "Invite",
  shareToast:    "[ph] Link copied — send it to a friend.",
  connectPill:   "Music Source",
  /* account block — anatomy + strings ported from DeetsMusic's login
     button (src/main.ts setAccount / index.html .account), per Aditya */
  acctLabel:     "Apple Music",
  acctSignedOut: "Not signed in",
  acctConnected: "Connected",
  acctWorking:   "Working…",
  previewToggle: "[ph] 30-second previews",
  connectFailed: "Apple log in failed. Try again!",
  connectUnavailable: "[ph] Full songs aren't wired up on this copy of the site.",
  leavePill:     "Disconnect",

  /* now-playing strip */
  npIdle:         "[ph] Nothing on the air",
  npIdleSub:      "[ph] The queue is empty — add something.",
  npCounting:     "[ph] Up next: {title} — {artist}",
  catalogGap:     "[ph] This one isn't on your service — it'll pass.",
  previewEnded:   "[ph] Preview's over — the song plays on for the room.",
  audioBlocked:   "[ph] Your browser is holding the sound — tap anything to let it out.",

  /* columns */
  colQueue:   "Queue",
  colSearch:  "Search",
  colHistory: "History",

  queueEmpty:  "[ph] Nothing queued. Go find something →",
  queueUpNext: "Up next",
  addedBy:     "{name}",
  moreQueued:  "[ph] +{n} more",

  searchPlaceholder: "Search (using the Apple Music Catalog)",
  searchEmpty:       "[ph] Whatever you find goes in the room's queue.",
  searchRecent:      "Recents",
  searchNoResults:   "[ph] Nothing matched “{term}”.",
  searchBusy:        "[ph] digging…",
  searchFailed:      "[ph] Search hiccuped — give it another go.",
  secArtists:        "Artists",
  secSongs:          "Songs",
  secAlbums:         "Albums",
  secPlaylists:      "[ph] Playlists",
  paneTopSongs:      "Top Songs",
  paneLoading:       "[ph] Loading…",
  paneFailed:        "[ph] Couldn't load that one.",
  paneEmpty:         "[ph] Nothing playable in there.",

  historyEmpty:      "[ph] Nothing has played yet.",
  historyPreviously: "Previously",

  /* row menus */
  menuPlayNow:    "Play now",
  menuPlayNext:   "Play next",
  menuMoveTop:    "Move to top",
  menuMoveBottom: "Move to bottom",
  menuRemove:     "Remove",
  menuAddQueue:   "Add to queue",

  /* connection */
  disconnected: "[ph] Lost the station — reconnecting…",
  reconnected:  "[ph] Back on the air.",

  /* screen-reader labels (aria) — spoken, never seen */
  ariaTuneIn:    "[ph] Tune in to a station",
  ariaBack:      "[ph] Previous track",
  ariaPlayPause: "[ph] Play or pause",
  ariaSkip:      "[ph] Next track",
  ariaMore:      "[ph] More actions",
  ariaPaneBack:  "[ph] Back to results",

  /* dev / mock era (visible while the mock transport is in play) */
  mockNotice: "Create a Radio Room by typing in a new room code!"
};
