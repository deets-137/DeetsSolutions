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
   (handwritten) value, and nothing still carrying "[ph]" may ship. Aditya's
   copy pass is UNDERWAY: un-prefixed values are his (some dictated in chat,
   marked by section comments); [ph] entries still await him.

   {curly} tokens are filled by cities.js (fmt()). */
window.CITIES_STRINGS = {
  /* ── bar ─────────────────────────────────────────────────────── */
  tableCodePlaceholder: "Table Code",
  yourTables:           "Recents",
  metaSetup:            "Setup — place your first pieces.",

  /* ── peek / create gate (below the bar, pre-join) — peek lines +
     both pills are Aditya's wording (chat), no [ph] */
  peekFull:     "Table full | {spectators} spectating",
  peekPlayers:  "{seated} players | {spectators} spectating",
  sitButton:    "Sit down",
  watchButton:  "Spectate",
  createLine:   "The '{code}' Table doesn't exist yet. Open it?",
  createButton: "Open the Table",
  nameLabel:    "Your name",
  nameNeeded:   "Enter a name first.",
  joinRefused:  "Table no longer exists.",
  peekFailed:   "Couldn't join the table. Try again soon!",

  /* ── toolbar pills ───────────────────────────────────────────── */
  invitePill:   "Invite",
  settingsPill: "View Settings",
  shareToast:   "Invite link copied!",
  sitPill:      "Sit down",
  watchPill:    "Watch",
  leavePill:    "Leave",
  closePill:    "Close Table",
  closeConfirm: "Confirm?",
  tableClosed:  "The host closed the table.",

  /* ── lobby (big tile: settings) ──────────────────────────────── */
  lobbyTitle:      "Table settings",
  capacityLabel:   "Players",
  timerLabel:      "Turn timer",
  timerOff:        "Off",
  timerSecs:       "{n}s",
  bettingLabel:    "[ph]Spectator betting",   // [ph] OK to ship — betting is unbuilt (v1.1); Aditya's call (chat 2026-07-21)
  bettingOn:       "On",
  bettingOff:      "Off",
  startButton:     "Start game",
  shufflePill:     "Shuffle",   // Aditya's wording (chat 2026-07-22), no [ph] — randomizes seated player order
  startHint:       "Board deals on press.",
  startNeedsThree: "Need at least 3 seated.",
  seatOpen:        "Open seat",
  seatBot:         "{name}",
  seatYou:         "{name} (you)",
  hostBadge:       "Host",
  standButton:     "Stand up",
  kickSeatAria:    "Remove {name}",
  /* host-added bots (the addBot verb): "+ Bot" on an open seat opens an
     inline name editor; clicking a bot's name renames (lobby-only) */
  addBotButton:     "Add Bot",
  addBotGo:         "Confirm?",
  addBotNameAria:   "Bot name",
  addBotCancelAria: "Cancel adding a bot",
  renameBotAria:    "Rename {name}",
  /* seat-color picker (dot → slide-open expand) — "Your color",
     "{name}'s color", "Become...", "Custom:" and the six-digit help
     line are Aditya's wording (chat), no [ph] */
  colorYours:      "Your color",
  colorTheirs:     "{name}'s color",
  colorBecome:     "Become...",
  colorDotAria:    "Change color for {name}",
  colorSwatchAria: "Claim this color",
  colorCustomAria: "Your custom color",
  colorTakenBy:    "{name} has this one",
  colorHexLabel:   "Custom:",
  colorBadHex:     "Six hex digits, like #1fb0aa",
  colorClashWith:  "Too close to {name}",

  /* ── resource + piece display names (the carve-out's labels) ─── */
  resWood:  "Wood",
  resBrick: "Brick",
  resWheat: "Wheat",
  resSheep: "Sheep",
  resOre:   "Ore",
  resDesert: "Desert",
  harborAny: "Any",   // 3:1 harbor hover label (resource harbors reuse res* names)
  pieceSettlement: "Settlement",
  pieceCity:       "City",
  pieceRoad:       "Road",

  /* ── dev cards ───────────────────────────────────────────────── */
  devKnight:   "Knight",
  devRoad:     "Road Building",
  devPlenty:   "Year of Plenty",
  devMonopoly: "Monopoly",
  devVp:       "Victory Point",
  /* hover blurbs on the dev-card buttons in your hand */
  devKnightDesc:   "Move the robber, then steal a card from a player on that hex.",
  devRoadDesc:     "Place 2 roads for free.",
  devPlentyDesc:   "Take any 2 resources from the bank.",
  devMonopolyDesc: "Every player hands you all of their selected resource.",
  devVpDesc:       "A secret victory point towards your total.",

  /* ── board: number-token hover — Aditya's wording (chat), no [ph] ─
     {roll} arrives article-composed ("an 8", "a 9") from cities.js */
  tokenOdds: "{ways}/{total} ({pct}%) possible rolls lead to {roll}",

  /* ── board: Odds popover — button + bar-hover line are Aditya's
     wording (chat), no [ph]; {x} = expected count, {y} = seen count */
  oddsButton: "Odds",
  oddsRolls:  "{n} rolls",
  oddsHover:  "{x} rolls were expected, {y} rolls have been seen",

  /* ── board: Resources popover + its lobby toggle — Aditya's
     wording (chat), no [ph] */
  resButton:    "Resources",
  resViewLabel: "In-Game Resources View",

  /* ── dice tile ───────────────────────────────────────────────── */
  diceWaiting: "{name} to roll",
  diceRolling: "Rolling…",
  diceLast:    "{name} rolled {sum}",

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
  disconnected: "Away",
  /* right-click menu on a player strip — all Aditya's wording (chat),
     no [ph]. Kick is host-only (mid-game the seat converts to a bot) */
  embargoSet:  "I hate you",
  embargoLift: "It's chill now",
  kickOption:  "Kick",

  /* ── log tile rail (Log | Deck toggle) — Aditya OK'd, no [ph] ── */
  logTab:  "Log",
  deckTab: "Deck",
  /* deck pane: the dev deck's remainder card. {list} = the frame's fixed
     shuffle mix ("14x Knight, 5x Victory Point, …") — total only varies,
     the mix never does (per-type counts would leak what was drawn) */
  deckDevLabel: "Dev",
  devDeckTitle: "{list}",

  /* ── role tile (player) — action pills ───────────────────────── */
  pillRoll:  "Roll",
  pillBuild: "Build",
  pillTrade: "Trade Hub",
  pillDev:   "Dev card",
  pillEnd:   "End turn",
  handTitle: "Hand",
  buildRoad:       "Road",
  buildSettlement: "Settlement",
  buildCity:       "City",
  buyDev:          "Buy dev card",
  buildDev:        "Dev card",
  cancelBuild:     "Cancel",
  buildPrompt:     "Pick a spot on the board to build.",

  /* ── role tile: the "since your last turn" hand ledger — all
     Aditya's wording (title in chat 2026-07-21, fragments in his
     2026-07-22 pass), no [ph]. {name} = the other party. A row's
     hover reads "<ledgerTitle>: +2 <ledgerRoll> · …" */
  ledgerTitle:        "Since your last turn",
  ledgerRoll:         "from rolls",
  ledgerDev:          "from a dev card",
  ledgerStole:        "stolen from {name}",
  ledgerRobbed:       "robbed by {name}",
  ledgerMonopolyGain: "monopoly",
  ledgerMonopoly:     "monopoly ({name})",
  ledgerDiscard:      "discarded",

  /* ── role tile (spectator) ───────────────────────────────────── */
  spectatingNote: "You're spectating. Sit down if there's space and you'd like to play!",
  bettingSoon:    "Spectator betting lands in a later build.",
  chipsLabel:     "{n} chips",

  /* ── trade overlay ───────────────────────────────────────────── */
  tradeTitle:   "Trade Hub",
  tradeGive:    "Offer",
  tradeGet:     "Receive",
  tradeSend:    "Offer to Players",
  tradeAccept:  "Accept",
  tradeDecline: "Decline",
  tradeCounter: "Counter",
  tradeClose:   "Trade",
  tradeCancel:  "Withdraw",
  tradeBankTitle: "Trade with the bank",
  tradeWithBank:    "Bank",
  tradeWithPlayers: "Players",
  tradeRate:    "{rate}:1",
  offerFrom:    "{name} offers",
  offerToYou:   "{name} wants to trade",
  offerIncoming: "{name} sent a trade offer.",
  offerAccepted: "{name} accepted your trade.",
  offerShort:   "You don't have those resources to offer!",

  /* ── forced interrupts (on the board tile) ───────────────────── */
  discardPrompt: "Roll of 7 — discard {n} cards.",
  discardToast:  "You have {x} cards. Please discard {n}.",   // Aditya's wording (chat 2026-07-22), no [ph] — red toast when a 7 makes me discard
  discardGo:     "Discard",
  discardWaiting: "Waiting on others to discard…",
  robberPrompt:  "Move the robber to a hex.",
  stealPrompt:   "Steal from a player on that hex.",
  stealSkip:     "No one to steal from here.",
  roadsPrompt:   "Place {n} free roads.",
  plentyPrompt:  "Take any 2 resources from the bank.",
  monopolyPrompt: "Pick a resource to monopolize.",

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
  connDown:    "Reconnecting…",
  connUp:      "Back!",
  kickedMeta:  "The host removed you from the table.",
  tableFull:   "Table is full.",
  nameTaken:   "That name is taken at the table.",
  noTable:     "No such table.",
  toastDismiss: "Dismiss",

  /* ── error codes → friendly lines (engine denials) ───────────── */
  errCost:  "Not enough resources.",
  errLoc:   "Can't build there.",
  errTurn:  "Not your turn.",
  errPhase: "Can't do that right now.",
  errRate:  "That trade doesn't work.",
  errPerm:  "You can't do that.",
  errFull:  "Table's full.",
  errEmpty: "The bank's out of that resource.",
  errSupply: "No pieces left in the supply.",
  errColor:      "That's not a hex color.",   // placeholder wording approved as-is (chat 2026-07-21)
  errColorTaken: "Too close to another player's color.",
  errFlood:      "Slow down a moment. Limited to 30 server actions in 10s.",

  /* ── disconnect grace + bot takeover (the red countdown toast) ───
     {name} = the dropped player, {secs} = the live countdown cities.js
     ticks down from the seat's graceUntil */
  leavingToast:  "{name} disconnected — a bot takes over in {secs}s",
  returnedToast: "{name} is back.",
  takeoverToast: "A bot is now playing {name}'s seat.",
  botSeatTag:    "{name} (bot)",

  /* ── desktop-only guard ──────────────────────────────────────── */
  desktopOnly: "DeetsCities needs a wider screen to work rip."
};
