/* DeetsMahjong — UI copy (docs/mahjong.md, "Copy").

   EVERY user-facing FLAVOR string on the mahjong page lives in this one flat
   object: gate copy, buttons, empty states, tile / wind / faan display names.
   mahjong.js holds no flavor copy of its own — the terse mechanical LOG
   lines are Claude-authored in mahjong.js, rendered from typed event records
   (they pull display names from here).

   Radio/cities convention, verbatim: Claude may ADD a string when wiring new
   UI, but every Claude-authored value must be prefixed "[ph]" — a placeholder
   Aditya rewrites, deleting the prefix as he goes. Claude never edits an
   un-prefixed (handwritten) value, and nothing still carrying "[ph]" may
   ship. As of this build EVERYTHING is [ph]: Aditya's copy pass hasn't
   started.

   {curly} tokens are filled by mahjong.js (fmt()). */
window.MAHJONG_STRINGS = {
  /* ── bar ─────────────────────────────────────────────────────── */
  tableCodePlaceholder: "Table Code",
  yourTables:           "Recents",

  /* ── peek / create gate ──────────────────────────────────────── */
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
  settingsPill: "Table Settings",
  shareToast:   "Invite link copied!",
  sitPill:      "Sit down",
  leavePill:    "Leave",
  closePill:    "Close Table",
  closeConfirm: "Confirm?",
  tableClosed:  "The host closed the table.",

  /* ── lobby (big tile: settings) ──────────────────────────────── */
  lobbyTitle:      "[ph]Table settings",
  minFaanLabel:    "[ph]Minimum faan",
  minFaanCustomAria: "[ph]Custom minimum faan",
  capFaanLabel:    "[ph]Faan cap",
  windsLabel:      "[ph]Length",
  windsOne:        "[ph]One wind",
  windsFour:       "[ph]Four winds",
  timerLabel:      "[ph]Turn timer",
  timerOff:        "[ph]Off",
  timerSecs:       "[ph]{n}s",
  deckLabel:       "[ph]Tile art",
  deckNumeral:     "[ph]Numerals",
  deckTraditional: "[ph]Traditional",
  startButton:     "[ph]Start game",
  shufflePill:     "[ph]Shuffle",
  startHint:       "[ph]Seating dice roll on press.",
  startNeedsFour:  "[ph]Mahjong needs exactly 4 seated.",
  seatOpen:        "[ph]Open seat",
  seatYou:         "[ph]{name} (you)",
  hostBadge:       "[ph]Host",
  standButton:     "[ph]Stand up",
  kickSeatAria:    "[ph]Remove {name}",
  addBotButton:     "[ph]Add Bot",
  addBotGo:         "[ph]Confirm?",
  addBotNameAria:   "[ph]Bot name",
  addBotCancelAria: "[ph]Cancel adding a bot",
  renameBotAria:    "[ph]Rename {name}",
  botSeatTag:       "[ph]{name} (bot)",
  /* seat-color picker */
  colorYours:      "[ph]Your color",
  colorTheirs:     "[ph]{name}'s color",
  colorBecome:     "[ph]Become...",
  colorDotAria:    "[ph]Change color for {name}",
  colorSwatchAria: "[ph]Claim this color",
  colorCustomAria: "[ph]Your custom color",
  colorTakenBy:    "[ph]{name} has this one",
  colorHexLabel:   "[ph]Custom:",
  colorBadHex:     "[ph]Six hex digits, like #1fb0aa",
  colorClashWith:  "[ph]Too close to {name}",

  /* ── tile / wind / dragon display names ──────────────────────── */
  suitM: "[ph]Characters",
  suitP: "[ph]Dots",
  suitS: "[ph]Bamboo",
  windE: "[ph]East",
  windS: "[ph]South",
  windW: "[ph]West",
  windN: "[ph]North",
  dragonR: "[ph]Red Dragon",
  dragonG: "[ph]Green Dragon",
  dragonW: "[ph]White Dragon",
  flowerName: "[ph]Flower {n}",
  seasonName: "[ph]Season {n}",
  tileNum:    "[ph]{n} {suit}",   // "3 Bamboo"

  /* ── seating (dice pick the winds) ───────────────────────────── */
  seatingTitle:   "[ph]Roll for seats",
  seatingNote:    "[ph]Highest roll deals as East.",
  seatingYou:     "[ph]Roll your dice!",
  seatingWaiting: "[ph]Waiting on {names}…",
  seatingReroll:  "[ph]Tie! {names} roll again.",
  seatingRolled:  "[ph]{name} rolled {sum}",
  rollPill:       "[ph]Roll",
  seatedLine:     "[ph]{name} deals as East.",
  windTag:        "[ph]{wind}",

  /* ── the wall break (dealer's ceremonial roll) ───────────────── */
  breakPromptYou:  "[ph]Roll to break the wall.",
  breakPrompt:     "[ph]{name} rolls to break the wall…",
  breakRolled:     "[ph]{name} broke the wall at {sum}.",

  /* ── play: table + rack ──────────────────────────────────────── */
  /* wallLeft / wallLeftTip / roundLine approved by Aditya in chat
     (2026-07-23, wall-panel redesign) — no [ph] */
  wallLeft:       "{n}",
  wallLeftTip:    "{n} tiles left in the wall",
  roundLine:      "{wind} round · hand {n}",
  pondTip:        "[ph]{name} discarded this",
  dealerTag:      "[ph]Dealer",
  yourTurnToast:  "[ph]Your turn!",
  discardHint:    "[ph]Pick a tile to discard.",
  drawWaiting:    "[ph]{name} is thinking…",
  handTitle:      "[ph]Your hand",
  nearWinLine:    "[ph]{n} faan — table minimum is {min}",
  flowersLabel:   "[ph]Flowers",
  meldsLabel:     "[ph]Melds",
  scoreShort:     "[ph]{n} pts",
  tilesShort:     "[ph]{n} tiles",
  disconnected:   "[ph]Away",

  /* ── action pills ────────────────────────────────────────────── */
  pillWin:   "[ph]Mahjong!",
  pillKong:  "[ph]Kong",
  pillPass:  "[ph]Pass",
  claimTitle: "[ph]{name} discarded",
  robTitle:   "[ph]{name} is adding to a kong",
  claimWin:  "[ph]Mahjong!",
  claimPung: "[ph]Pung",
  claimKong: "[ph]Kong",
  claimChow: "[ph]Chow",
  chowPick:  "[ph]Which run?",
  kongPick:  "[ph]Which kong?",
  claimWaiting: "[ph]Waiting on claims…",

  /* ── hand over (settlement interstitial) ─────────────────────── */
  handWinLine:   "[ph]{name} wins — {faan} faan",
  handWinSelf:   "[ph]{name} wins by self-draw — {faan} faan",
  handWinLimit:  "[ph]LIMIT HAND",
  handDrawnLine: "[ph]Exhaustive draw — the wall ran dry.",
  dealerRepeats: "[ph]{name} deals again.",
  faanTotal:     "[ph]{n} faan",
  paysLabel:     "[ph]{name} pays {n}",
  nextHandButton: "[ph]Next hand",
  nextHandAuto:   "[ph]Next hand in {n}s…",

  /* faan part names (engine part keys) */
  faanThirteenOrphans: "[ph]Thirteen Orphans",
  faanHeavenly:        "[ph]Heavenly Hand",
  faanEarthly:         "[ph]Earthly Hand",
  faanAllHonors:       "[ph]All Honors",
  faanGreatDragons:    "[ph]Great Dragons",
  faanGreatWinds:      "[ph]Great Winds",
  faanAllKongs:        "[ph]All Kongs",
  faanNineGates:       "[ph]Nine Gates",
  faanAllChows:        "[ph]Common Hand",
  faanAllPungs:        "[ph]All Pungs",
  faanHalfFlush:       "[ph]Mixed One Suit",
  faanFullFlush:       "[ph]Pure One Suit",
  faanDragonPung:      "[ph]Dragon Pung",
  faanSmallDragons:    "[ph]Small Dragons",
  faanSeatWind:        "[ph]Seat Wind",
  faanPrevWind:        "[ph]Round Wind",
  faanSmallWinds:      "[ph]Small Winds",
  faanConcealed:       "[ph]Concealed Hand",
  faanSelfDraw:        "[ph]Self-Draw",
  faanRobbingKong:     "[ph]Robbing the Kong",
  faanKongReplacement: "[ph]Kong Replacement",
  faanLastTileDraw:    "[ph]Last Tile Draw",
  faanLastTileDiscard: "[ph]Last Tile Claim",
  faanNoFlowers:       "[ph]No Flowers",
  faanSeatFlower:      "[ph]Seat Flower",
  faanFlowerQuad:      "[ph]Flower Quad",

  /* ── in-game attention toasts ────────────────────────────────── */
  claimToast:     "[ph]You can claim {name}'s {tile}!",
  dealInToast:    "[ph]You dealt into {name}'s hand.",
  winToast:       "[ph]Mahjong! +{n} points.",
  robbedToast:    "[ph]{name} robbed your kong!",

  /* ── game over ───────────────────────────────────────────────── */
  gameOver:      "[ph]Game Over",
  handCount:     "[ph]{n} hands",
  rematchButton: "[ph]Rematch",
  rematchSoon:   "[ph]Rematch lands with the worker — reopen the table for now.",
  superMostWins:     "[ph]Most wins",
  superBestHand:     "[ph]Biggest hand",
  superMostDealIns:  "[ph]Most deal-ins",
  superMostKongs:    "[ph]Most kongs",
  superValue:  "[ph][{n}x]",
  statHidden:  "[ph]—",

  /* ── spectator ───────────────────────────────────────────────── */
  spectatingNote: "[ph]You're spectating. Sit down if there's space and you'd like to play!",

  /* ── connection / refusals ───────────────────────────────────── */
  connDown:    "[ph]Reconnecting…",
  connUp:      "[ph]Back!",
  kickedMeta:  "[ph]The host removed you from the table.",
  tableFull:   "[ph]Table is full.",
  nameTaken:   "[ph]That name is taken at the table.",
  noTable:     "[ph]No such table.",
  toastDismiss: "[ph]Dismiss",

  /* ── error codes → friendly lines (engine denials) ───────────── */
  errTurn:  "[ph]Not your turn.",
  errPhase: "[ph]Can't do that right now.",
  errLoc:   "[ph]That doesn't work.",
  errPerm:  "[ph]You can't do that.",
  errFull:  "[ph]Table's full.",
  errColor:      "[ph]That's not a hex color.",
  errColorTaken: "[ph]Too close to another player's color.",
  errFlood:      "[ph]Slow down a moment.",

  /* ── disconnect grace + bot takeover ─────────────────────────── */
  leavingToast:  "[ph]{name} disconnected — a bot takes over in {secs}s",
  returnedToast: "[ph]{name} is back.",
  takeoverToast: "[ph]A bot is now playing {name}'s seat.",

  /* ── desktop-only guard ──────────────────────────────────────── */
  desktopOnly: "[ph]DeetsMahjong needs a wider screen."
};
