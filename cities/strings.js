/* DeetsCities — UI copy (docs/cities.md, "Minimal mechanical text; Aditya
   authors flavor").

   EVERY user-facing FLAVOR string on the cities page lives in this one flat
   object: gate copy, buttons, empty states, and the resource / piece / dev
   DISPLAY names. cities.js holds no flavor copy of its own — but the terse
   mechanical LOG lines and rules prompts are Claude-authored in cities.js,
   rendered from typed event records (they pull display names from here).

   Radio convention, verbatim: Claude may ADD a string when wiring new UI, but
   every Claude-authored value must be prefixed "[ph]" — a placeholder Aditya
   rewrites, deleting the prefix as he goes. Claude never edits an un-prefixed
   (handwritten) value, and nothing still carrying "[ph]" may ship. This whole
   file is scaffolding right now: it is ALL [ph] until Aditya's copy pass.

   {curly} tokens are filled by cities.js (fmt()). */
window.CITIES_STRINGS = {
  /* ── bar ─────────────────────────────────────────────────────── */
  tableCodePlaceholder: "[ph]Table Code",
  yourTables:           "[ph]Your tables",
  metaSetup:            "[ph]Setup — place your first pieces.",

  /* ── peek / create gate (below the bar, pre-join) ────────────── */
  peekLobby:    "[ph]Lobby open · {seated}/{capacity} seated · {spectators} watching",
  peekRunning:  "[ph]Game in progress · {seated} players · {spectators} watching",
  peekFull:     "[ph]Table full · {spectators} watching",
  sitButton:    "[ph]Sit down",
  watchButton:  "[ph]Watch",
  createLine:   "The '{code}' Table doesn't exist yet. Open it?",
  createButton: "Open the Table",
  nameLabel:    "[ph]Your name",
  nameNeeded:   "[ph]Enter a name first.",
  joinRefused:  "Table no longer exists.",
  peekFailed:   "Couldn't join the table. Try again soon!",

  /* ── toolbar pills ───────────────────────────────────────────── */
  invitePill:   "Invite",
  settingsPill: "View Settings",
  shareToast:   "Invite link copied!",
  sitPill:      "[ph]Sit down",
  watchPill:    "[ph]Watch",
  leavePill:    "[ph]Leave",
  closePill:    "Close Table",
  closeConfirm: "[ph]Close it?",
  tableClosed:  "[ph]The host closed the table.",

  /* ── lobby (big tile: settings) ──────────────────────────────── */
  lobbyTitle:      "Table settings",
  capacityLabel:   "Players",
  timerLabel:      "Turn timer",
  timerOff:        "Off",
  timerSecs:       "{n}s",
  bettingLabel:    "[ph]Spectator betting",
  bettingOn:       "On",
  bettingOff:      "Off",
  startButton:     "Start game",
  startHint:       "Board deals on press.",
  startNeedsThree: "Need at least 3 seated.",
  seatOpen:        "Open seat",
  seatBot:         "{name}",
  seatYou:         "{name} (you)",
  hostBadge:       "Host",
  standButton:     "Stand up",
  kickSeatAria:    "Remove {name}",

  /* ── resource + piece display names (the carve-out's labels) ─── */
  resWood:  "Wood",
  resBrick: "Brick",
  resWheat: "Wheat",
  resSheep: "Sheep",
  resOre:   "Ore",
  resDesert: "[ph]Desert",
  pieceSettlement: "[ph]Settlement",
  pieceCity:       "[ph]City",
  pieceRoad:       "[ph]Road",

  /* ── dev cards ───────────────────────────────────────────────── */
  devKnight:   "[ph]Knight",
  devRoad:     "[ph]Road Building",
  devPlenty:   "[ph]Year of Plenty",
  devMonopoly: "[ph]Monopoly",
  devVp:       "[ph]Victory Point",
  /* hover blurbs on the dev-card buttons in your hand */
  devKnightDesc:   "[ph]Move the robber, then steal a card from a player on that hex.",
  devRoadDesc:     "[ph]Place 2 roads at no cost.",
  devPlentyDesc:   "[ph]Take any 2 resources from the bank.",
  devMonopolyDesc: "[ph]Name a resource — every player hands you all of theirs.",
  devVpDesc:       "[ph]A hidden victory point. It counts toward your total.",

  /* ── board: number-token hover — Aditya's wording (chat), no [ph] ─
     {roll} arrives article-composed ("an 8", "a 9") from cities.js */
  tokenOdds: "{ways}/{total} ({pct}%) possible rolls lead to {roll}",

  /* ── dice tile ───────────────────────────────────────────────── */
  diceWaiting: "[ph]{name} to roll",
  diceRolling: "[ph]Rolling…",
  diceLast:    "[ph]{name} rolled {sum}",

  /* ── players tile ────────────────────────────────────────────── */
  vpShort:     "{n} VP",
  handShort:   "{n} cards",
  devShort:    "{n} dev",
  awardRoad:   "Longest Road",
  awardArmy:   "Largest Army",
  roadProgress: "{n}x Roads",     // award pill, progress toward Longest Road (longest contiguous path)
  armyProgress: "{n}x Knights",   // award pill, progress toward Largest Army (knights played)
  awardRoadHeld: "Longest Road [{n}x]",  // award pill when held — [{n}x] is the bar to beat
  awardArmyHeld: "Largest Army [{n}x]",
  disconnected: "[ph]away",
  /* right-click embargo menu on a player strip */
  embargoSet:  "I hate you",
  embargoLift: "[ph]We're cool",

  /* ── log tile rail (Log | Deck toggle) — Aditya OK'd, no [ph] ── */
  logTab:  "Log",
  deckTab: "Deck",

  /* ── role tile (player) — action pills ───────────────────────── */
  pillRoll:  "[ph]Roll",
  pillBuild: "[ph]Build",
  pillTrade: "[ph]Trade",
  pillDev:   "[ph]Dev card",
  pillEnd:   "[ph]End turn",
  handTitle: "[ph]Your hand",
  buildRoad:       "[ph]Road",
  buildSettlement: "[ph]Settlement",
  buildCity:       "[ph]City",
  buyDev:          "[ph]Buy dev card",
  buildDev:        "[ph]Dev card",
  cancelBuild:     "[ph]Cancel",
  buildPrompt:     "[ph]Pick a spot on the board.",

  /* ── role tile (spectator) ───────────────────────────────────── */
  spectatingNote: "[ph]You're watching. Sit down at the next lobby to play.",
  bettingSoon:    "[ph]Spectator betting lands in a later build.",
  chipsLabel:     "[ph]{n} chips",

  /* ── trade overlay ───────────────────────────────────────────── */
  tradeTitle:   "Trade Hub",
  tradeGive:    "Offer",
  tradeGet:     "Receive",
  tradeSend:    "Offer to Players",
  tradeAccept:  "[ph]Accept",
  tradeDecline: "[ph]Decline",
  tradeCounter: "[ph]Counter",
  tradeClose:   "Trade",
  tradeCancel:  "Withdraw",
  tradeBankTitle: "[ph]Trade with the bank",
  tradeWithBank:    "Bank",
  tradeWithPlayers: "Players",
  tradeRate:    "[ph]{rate}:1",
  offerFrom:    "{name} offers",
  offerToYou:   "[ph]{name} wants to trade",
  offerIncoming: "[ph]{name} sent a trade offer.",
  offerAccepted: "{name} accepted your trade.",
  offerShort:   "You don't have those resources to offer!",

  /* ── forced interrupts (on the board tile) ───────────────────── */
  discardPrompt: "[ph]Roll of 7 — discard {n} cards.",
  discardGo:     "[ph]Discard",
  discardWaiting: "[ph]Waiting on others to discard…",
  robberPrompt:  "[ph]Move the robber to a hex.",
  stealPrompt:   "[ph]Steal from a player on that hex.",
  stealSkip:     "[ph]No one to steal from.",
  roadsPrompt:   "[ph]Place {n} free roads.",
  plentyPrompt:  "[ph]Take any 2 from the bank.",
  monopolyPrompt: "[ph]Name a resource to monopolize.",

  /* ── game over ───────────────────────────────────────────────── */
  gameOver:    "Game Over",
  turnCount:   "{n} turns",   // top-right of the Game Over header
  abandoned:   "Game abandoned — no winner.",
  rematchButton: "Rematch",
  superMostResources: "Most resources",
  superMostRobbed:    "Most robbed",
  superBiggestHaul:   "Biggest single haul",
  superMostKnights:   "Most knights",
  superValue:  "[{n}x]",   // appended to a superlative winner — the value they topped
  statHidden:  "—",

  /* ── connection / refusals ───────────────────────────────────── */
  connDown:    "[ph]Reconnecting…",
  connUp:      "Back!",
  kickedMeta:  "[ph]The host removed you from the table.",
  tableFull:   "Table is full.",
  nameTaken:   "[ph]That name is taken here.",
  noTable:     "[ph]No such table.",
  toastDismiss: "Dismiss",

  /* ── error codes → friendly lines (engine denials) ───────────── */
  errCost:  "[ph]Not enough resources.",
  errLoc:   "[ph]Can't build there.",
  errTurn:  "[ph]Not your turn.",
  errPhase: "[ph]Can't do that right now.",
  errRate:  "[ph]That trade doesn't work.",
  errPerm:  "[ph]You can't do that.",
  errFull:  "[ph]Table's full.",
  errEmpty: "[ph]The bank's out.",
  errSupply: "[ph]No pieces left.",

  /* ── desktop-only guard ──────────────────────────────────────── */
  desktopOnly: "[ph]DeetsCities is a desktop game — open it on a wider screen."
};
