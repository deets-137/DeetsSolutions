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
  /* account block — anatomy ported from DeetsMusic's login button
     (src/main.ts setAccount / index.html .account), per Aditya. The
     status-text line died 2026-07-15 (his call): the icon IS the
     status now, so acctSignedOut/acctConnected/acctWorking sit unused —
     kept for reference, his to delete. */
  acctLabel:     "Apple Music",
  acctSignedOut: "Not signed in",
  acctConnected: "Connected",
  acctWorking:   "Working…",
  /* previews relabel + the YouTube box label are Aditya's, dictated in
     the 2026-07-14 YouTube-design session. (ytOn/ytOff/ytQuota died with
     the status line, 2026-07-15.) */
  previewToggle: "AM Previews",
  ytLabel:       "YouTube",
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
  /* personal silence — the room plays but THIS device hears nothing
     (gap / preview over / previews off): ONE red sticky toast while it
     lasts + the parked progress bar (his call + copy, 2026-07-15);
     also the NP note for the previews-off cause */
  silenceOff:     "No audio is playing as no source or previews are available.",

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

  /* YT-first adds (docs/youtube.md, "YouTube-first adds") — pasting a
     YouTube link into the search box: lookup → Apple reverse-match →
     a one-result add pane. Aditya's copy pass, 2026-07-15. */
  ytAddBusy:      "Reading that link…",
  ytAddMatched:   "Matched to an Apple Music song. Click or add to queue as you normally would!",
  ytAddVideoOnly: "No easy match on Apple Music, match it at the desk below for the future!",
  ytAddFailed:    "Couldn't find a video at the link, try the share button on YouTube!",
  /* fires as a toast; the entry still adds, just without that video */
  ytAddNoEmbed:   "The artist turned off embedding so that exact video can't play here.",
  /* keyless unmatched paste: parked at the desk's pending list — a
     human links the AM song there and only then can it play */
  ytAddParked:    "No Apple Music song match, check the Match Desk to link one up.",

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
  menuFixVideo:   "Fix video",

  /* match desk (docs/youtube.md, "The match desk") — songs left, video
     workbench right. The field is dual-mode (2026-07-15): paste a
     YouTube link to re-pin the video, or type to search the Apple
     catalog (songs only) and click a result to re-pin the SONG. */
  deskTitle:    "Match Desk",
  deskEmpty:    "Nothing queued to match.",
  deskNoVideo:  "No video attached yet.",
  /* the dual-mode field stays dual-mode; the placeholder just leads
     with the likelier act (his call, 2026-07-15): no video attached ⇒
     invite the paste, video attached ⇒ invite the song fix */
  deskPaste:    "Paste a YouTube link",
  deskSearch:   "Search Apple Music",
  deskNoSongs:  "No songs by that name.",
  deskSent:     "Received!",
  deskSongSent: "New song attached, updating the room!",
  /* pending matches (docs/youtube.md, "Pending matches") — parked unmatched
     pastes pinned atop the desk list. Label, search placeholder, both
     buttons, and the sticky toast are Aditya's (sketch review,
     2026-07-15). Picking a result only arms the link; Confirm adds. */
  deskPendingLabel:   "Waiting to be matched",
  deskPendingSearch:  "Search in the AM catalog to link",
  deskPendingConfirm: "Confirm link",
  deskPendingRemove:  "Remove from queue",
  pendingToast: "{n} songs waiting to be matched. Check the desk to link them up so they can play!",
  /* singular, mechanically derived from his plural (2026-07-15) */
  pendingToastOne: "1 song waiting to be matched. Check the desk to link it up so it can play!",

  /* connection */
  disconnected: "Lost a cable or two, plugging back in...",
  reconnected:  "Back!",
  /* the sticky disconnected toast's one action button (js/toast.js) */
  toastDismiss: "Dismiss",

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
     Radio Room and the armed "?" (rendered after a checkmark icon) are
     Aditya's, dictated in the 2026-07-14 session (the bottom strip's
     stand-ins for the hidden return pill; its Disconnect reuses
     leavePill); the rest approved as-is 2026-07-15. */
  shellReturn:       "Back to the station",
  shellRoomPill:     "Radio Room",
  shellLeaveConfirm: "?",
  ariaShellPage: "Site page — the radio keeps playing",

  /* crew panel + permissions (docs/radio.md, "Listener identity & queue
     permissions"). R / E and Open / Restricted are Aditya's, dictated in
     the 2026-07-14 session; the rest are his copy pass, 2026-07-15. */
  capR:           "R",
  capE:           "E",
  modeOpen:       "Open",
  modeRestricted: "Restricted",
  crewTitle:      "Listeners",
  crewColQueue:   "Queue",
  crewColPlayer:  "Play/Pause",
  permDenied:     "Ask owner for permissions!",
  kickedMeta:     "You have been disconnected by the owner.",
  nameTaken:      "That tag is already taken, try another one!",
  roomFull:       "Room is full.",
  ariaKick:       "Kick {name}",
  ariaCapQueue:   "Queue edits for {name}",
  ariaCapPlayer:  "Player control for {name}"
};
