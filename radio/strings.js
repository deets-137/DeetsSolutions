/* DeetsRadio — UI copy (docs/radio.md, "UI text is handwritten").

   EVERY user-facing string on the radio page lives in this one flat object;
   radio.js holds no copy of its own. The copy here is Aditya's, handwritten.
   Claude may ADD a string when wiring up new UI, but every Claude-authored
   value must be prefixed "[ph]" — a placeholder Aditya rewrites, deleting the
   prefix as he goes. Claude never edits an un-prefixed (handwritten) value,
   and nothing still carrying "[ph]" may ship.

   {curly} tokens are filled by radio.js (fmt()) — keep a token if you keep
   the fact it carries; drop it freely otherwise. */
window.RADIO_STRINGS = {
  /* bar + meta */
  tuneInPlaceholder: "Radio Room Code",
  yourStations:      "Recents",
  metaIdle:          "Type in the Radio Room Code to tune in to a room (duh).",

  /* peek / create gate (below the bar, pre-join) */
  peekLive:     "On the air: {title} — {artist} · {n} listening",
  peekQuiet:    "Nothing's playing · {n} listening",
  joinButton:   "Hop in",
  createLine:   "The '{code}' Room doesn't exist yet. Open it?",
  createButton: "Open the Room",
  nameLabel:    "Your Tag",
  nameNeeded:   "No randos allowed, enter your name first!",
  joinRefused:  "Room no longer exists.",
  peekFailed:   "Couldn't join the radio room. Try again soon!",

  /* toolbar pills — these four are handwritten (2026-07-13) */
  listeningPill: "{n} Listeners",
  sharePill:     "Invite",
  shareToast:    "Invite link copied!",
  connectPill:   "Music Source",
  /* account block — anatomy + strings ported from DeetsMusic's login
     button (src/main.ts setAccount / index.html .account), per Aditya */
  acctLabel:     "Apple Music",
  acctSignedOut: "Not signed in",
  acctConnected: "Connected",
  acctWorking:   "Working…",
  previewToggle: "30s previews",
  connectFailed: "Apple log in failed. Try again!",
  connectUnavailable: "Couldn't connect.",
  leavePill:     "Disconnect",
  /* owner-only (creator, then longest-connected): signs the station off
     for everyone and frees the code */
  closePill:     "Close Room",
  closeConfirm:  "You sure?",
  roomClosed:    "Closed for the night.",

  /* now-playing strip */
  npIdle:         "Silence",
  npIdleSub:      "Queue something to hear something.",
  npCounting:     "Coming up: {title} by {artist}",
  catalogGap:     "Not on your service... skipping for you",
  previewEnded:   "Preview's done. Still continuing for the rest of the room.",
  audioBlocked:   "Click anywhere to tune back in!",

  /* columns */
  colQueue:   "Queue",
  colSearch:  "Search",
  colHistory: "History",

  queueEmpty:  "Add something to the queue!",
  queueUpNext: "Up next",
  addedBy:     "{name}",
  moreQueued:  "+{n} more",

  searchPlaceholder: "Search (using the Apple Music Catalog)",
  searchEmpty:       "",
  searchRecent:      "Recents",
  searchNoResults:   "No matches for {term}.",
  searchBusy:        "Searching...",
  searchFailed:      "Search errored out, try again!",
  secArtists:        "Artists",
  secSongs:          "Songs",
  secAlbums:         "Albums",
  secPlaylists:      "Playlists",
  paneTopSongs:      "Top Songs",
  paneLoading:       "Loading…",
  paneFailed:        "Couldn't load this one",
  paneEmpty:         "Nothing playable present",

  historyEmpty:      "Nothing yet",
  historyPreviously: "Previously",

  /* row menus */
  menuPlayNow:    "Play now",
  menuPlayNext:   "Play next",
  menuMoveTop:    "Move to top",
  menuMoveBottom: "Move to bottom",
  menuRemove:     "Remove",
  menuAddQueue:   "Add to queue",
  menuGoArtist:   "Go to artist",

  /* connection */
  disconnected: "Lost a cable or two, plugging back in...",
  reconnected:  "Back!",
  /* the sticky disconnected toast's one action button (js/toast.js) */
  toastDismiss: "[ph]Dismiss",

  /* screen-reader labels (aria) — spoken, never seen */
  ariaTuneIn:    "Tune in to a station",
  ariaBack:      "Previous track",
  ariaPlayPause: "Play or pause",
  ariaSkip:      "Next track",
  ariaMore:      "More actions",
  ariaPaneBack:  "Back to results",

  /* dev / mock era (visible while the mock transport is in play) */
  mockNotice: "Create a Radio Room by typing in a new room code!",

  /* site-shell — browsing the site while the room plays (docs/radio.md).
     [ph] placeholders, Aditya's to rewrite. Radio Room and the armed
     "?" (rendered after a checkmark icon) are Aditya's, dictated in the
     2026-07-14 session (the bottom strip's stand-ins for the hidden
     return pill; its Disconnect reuses leavePill). */
  shellReturn:       "[ph]Back to the station",
  shellRoomPill:     "Radio Room",
  shellLeaveConfirm: "?",
  ariaShellPage: "[ph]Site page — the radio keeps playing",

  /* crew panel + permissions (docs/radio.md, "Listener identity & queue
     permissions"). R / E and Open / Restricted are Aditya's, dictated in
     the 2026-07-14 session; the rest are [ph] placeholders. */
  capR:           "R",
  capE:           "E",
  modeOpen:       "Open",
  modeRestricted: "Restricted",
  crewTitle:      "[ph]Listeners",
  crewColQueue:   "[ph]Queue",
  crewColPlayer:  "[ph]Player",
  permDenied:     "[ph]The owner has that locked down.",
  kickedMeta:     "[ph]The owner kicked you out.",
  nameTaken:      "[ph]Someone in there already has that name — pick another.",
  roomFull:       "[ph]That room is full.",
  ariaKick:       "[ph]Kick {name}",
  ariaCapQueue:   "[ph]Queue edits for {name}",
  ariaCapPlayer:  "[ph]Player control for {name}"
};
