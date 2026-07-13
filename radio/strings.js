/* DeetsRadio — UI copy (docs/radio.md, "UI text is handwritten").

   EVERY user-facing string on the radio page lives in this one flat object;
   radio.js holds no copy of its own. All values below are Claude-scaffolded
   PLACEHOLDERS, prefixed "[ph]" — Aditya handwrites each one, deleting the
   prefix as he goes. Nothing still carrying "[ph]" may ship.

   {curly} tokens are filled by radio.js (fmt()) — keep a token if you keep
   the fact it carries; drop it freely otherwise. */
window.RADIO_STRINGS = {
  /* bar + meta */
  tuneInPlaceholder: "[ph] tune in…",
  yourStations:      "[ph] Your stations",
  metaIdle:          "[ph] Type a station code to tune in — or make one up to start it.",

  /* peek / create gate (below the bar, pre-join) */
  peekLive:     "[ph] On the air: {title} — {artist} · {n} listening",
  peekQuiet:    "[ph] The air is quiet right now · {n} listening",
  joinButton:   "[ph] Tune in",
  createLine:   "[ph] No station called {code} yet.",
  createButton: "[ph] Start this station",
  nameLabel:    "[ph] Your name",
  nameNeeded:   "[ph] Pick a name first — the room wants to know who's adding bangers.",
  joinRefused:  "[ph] That station doesn't exist. Check the code with whoever sent it.",
  peekFailed:   "[ph] Couldn't reach the station. Try again in a moment.",

  /* toolbar pills — these four are handwritten (2026-07-13) */
  listeningPill: "{n} Listeners",
  sharePill:     "Invite",
  shareToast:    "[ph] Link copied — send it to a friend.",
  connectPill:   "Music Source",
  connectExplain:"[ph] You're on previews (30 seconds a song). Connect Apple Music to hear it all.",
  connectApple:  "[ph] Connect Apple Music",
  connectSoon:   "[ph] Apple sign-in lands in the next build.",
  leavePill:     "Disconnect",

  /* now-playing strip */
  npIdle:         "[ph] Nothing on the air",
  npIdleSub:      "[ph] The queue is empty — add something.",
  npCounting:     "[ph] Up next: {title} — {artist}",
  catalogGap:     "[ph] This one isn't on your service — it'll pass.",
  previewEnded:   "[ph] Preview's over — the song plays on for the room.",

  /* columns */
  colQueue:   "[ph] Queue",
  colSearch:  "[ph] Search",
  colHistory: "[ph] History",

  queueEmpty:  "[ph] Nothing queued. Go find something →",
  queueUpNext: "[ph] Up next",
  addedBy:     "[ph] added by {name}",
  moreQueued:  "[ph] +{n} more",

  searchPlaceholder: "[ph] Search for a song…",
  searchEmpty:       "[ph] Whatever you find goes in the room's queue.",
  searchRecent:      "[ph] Recent searches",
  searchNoResults:   "[ph] Nothing matched “{term}”.",
  searchBusy:        "[ph] digging…",

  historyEmpty:      "[ph] Nothing has played yet.",
  historyPreviously: "[ph] Previously",

  /* row menus */
  menuPlayNow:    "[ph] Play now",
  menuPlayNext:   "[ph] Play next",
  menuMoveTop:    "[ph] Move to top",
  menuMoveBottom: "[ph] Move to bottom",
  menuRemove:     "[ph] Remove",
  menuAddQueue:   "[ph] Add to queue",

  /* connection */
  disconnected: "[ph] Lost the station — reconnecting…",
  reconnected:  "[ph] Back on the air.",

  /* dev / mock era (visible while the mock transport is in play) */
  mockNotice: "[ph] Mock radio — fake catalog, silent playback, real rules."
};
