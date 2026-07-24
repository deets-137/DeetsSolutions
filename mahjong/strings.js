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
   ship. Aditya's copy pass is DONE — every value below is handwritten, so
   Claude edits none of them; only newly wired strings arrive as [ph].

   {curly} tokens are filled by mahjong.js (fmt()). */
window.MAHJONG_STRINGS = {
   /* ── bar ─────────────────────────────────────────────────────── */
   tableCodePlaceholder: "Table Code",
   yourTables: "Recents",

   /* ── peek / create gate ──────────────────────────────────────── */
   peekFull: "Table full | {spectators} spectating",
   peekPlayers: "{seated} players | {spectators} spectating",
   sitButton: "Sit down",
   watchButton: "Spectate",
   createLine: "The '{code}' Table doesn't exist yet. Open it?",
   createButton: "Open the Table",
   nameLabel: "Your name",
   nameNeeded: "Enter a name first.",
   joinRefused: "Table no longer exists.",
   peekFailed: "Couldn't join the table. Try again soon!",

   /* ── toolbar pills ───────────────────────────────────────────── */
   invitePill: "Invite",
   settingsPill: "Table Settings",
   shareToast: "Invite link copied!",
   sitPill: "Sit down",
   leavePill: "Leave",
   closePill: "Close Table",
   closeConfirm: "Confirm?",
   tableClosed: "The host closed the table.",

   /* ── lobby (big tile: settings) ──────────────────────────────── */
   lobbyTitle: "Table settings",
   minFaanLabel: "Minimum faan (points)",
   minFaanCustomAria: "Custom minimum faan",
   capFaanLabel: "Faan cap (for scoring)",
   windsLabel: "Length",
   windsHand: "One hand",
   windsOne: "One wind (4 hands)",
   windsFour: "Four winds (full game)",
   timerLabel: "Turn timer",
   timerOff: "Off",
   timerSecs: "{n}s",
   deckLabel: "Tile art",
   deckNumeral: "Numerals",
   deckTraditional: "Traditional",
   startButton: "Start game",
   shufflePill: "Shuffle",
   startHint: "Dice roll on press for seating.",
   startNeedsFour: "Mahjong needs exactly 4 players.",
   seatOpen: "Open seat",
   seatYou: "{name} (you)",
   hostBadge: "Host",
   standButton: "Stand up",
   kickSeatAria: "Remove {name}",
   addBotButton: "Add Bot",
   addBotGo: "Confirm?",
   addBotNameAria: "Bot name",
   addBotCancelAria: "Cancel adding a bot",
   renameBotAria: "Rename {name}",
   botSeatTag: "{name} (bot)",
   /* seat-color picker */
   colorYours: "Your color",
   colorTheirs: "{name}'s color",
   colorBecome: "Become...",
   colorDotAria: "Change color for {name}",
   colorSwatchAria: "Claim this color",
   colorCustomAria: "Your custom color",
   colorTakenBy: "{name} has this one",
   colorHexLabel: "Custom:",
   colorBadHex: "Six hex digits, like #1fb0aa",
   colorClashWith: "Too close to {name}",

   /* ── tile / wind / dragon display names ──────────────────────── */
   suitM: "Characters",
   suitP: "Dots",
   suitS: "Bamboo",
   windE: "East",
   windS: "South",
   windW: "West",
   windN: "North",
   dragonR: "Red Dragon",
   dragonG: "Green Dragon",
   dragonW: "White Dragon",
   flowerName: "Flower {n}",
   seasonName: "Season {n}",
   tileNum: "{n} {suit}",   // "3 Bamboo"

   /* ── seating (dice pick the winds) ───────────────────────────── */
   seatingTitle: "Roll for seats",
   seatingNote: "Highest roll deals as East.",
   seatingYou: "Roll your dice!",
   seatingWaiting: "Waiting on {names}…",
   seatingReroll: "Tie! {names} roll again.",
   seatingRolled: "{name} rolled {sum}",
   rollPill: "Roll",
   seatedLine: "{name} deals as East.",
   windTag: "{wind}",

   /* ── the wall break (dealer's ceremonial roll) ───────────────── */
   breakPromptYou: "Roll to break the wall.",
   breakPrompt: "{name} rolls to break the wall…",
   breakRolled: "{name} broke the wall at {sum}.",

   /* ── play: table + rack ──────────────────────────────────────── */
   /* wallLeft / wallLeftTip / roundLine approved by Aditya in chat
      (2026-07-23, wall-panel redesign) — no [ph] */
   wallLeft: "{n}",
   wallLeftTip: "{n} tiles left in the wall",
   roundLine: "{wind} round · hand {n}",
   pondTip: "{name} discarded this",
   dealerTag: "Dealer",
   yourTurnToast: "Your turn!",
   discardHint: "Pick a tile to discard.",
   discardHintManual: "Drag a tile above to discard.",
   drawWaiting: "{name} is thinking…",
   handTitle: "Your hand",
   arrangeLabel: "Auto-Arrange",
   arrangeTip: "Auto-sort your hand every turn. Turn off to arrange tiles yourself and drag one out to discard.",
   nearWinLine: "{n} faan — table minimum is {min}",
   flowersLabel: "Flowers",
   meldsLabel: "Melds",
   scoreShort: "{n} pts",
   tilesShort: "{n} tiles",
   disconnected: "Away",

   /* ── action pills ────────────────────────────────────────────── */
   pillWin: "Mahjong!",
   pillKong: "Kong",
   pillPass: "Pass",
   claimTitle: "{name} discarded",
   robTitle: "{name} is adding to a kong",
   claimWin: "Mahjong!",
   claimPung: "Pung",
   claimKong: "Kong",
   claimChow: "Chow",
   chowPick: "Which run?",
   kongPick: "Which kong?",
   claimWaiting: "Waiting on claims…",

   /* ── hand over (settlement interstitial) ─────────────────────── */
   handWinLine: "{name} wins — {faan} faan",
   handWinSelf: "{name} wins by self-draw — {faan} faan",
   handWinLimit: "LIMIT HAND",
   handDrawnLine: "Exhaustive draw — the wall ran dry.",
   dealerRepeats: "{name} deals again.",
   faanTotal: "{n} faan",
   paysLabel: "{name} pays {n}",
   nextHandButton: "Next hand",
   nextHandAuto: "Next hand in {n}s…",

   /* faan part names (engine part keys) */
   faanThirteenOrphans: "Thirteen Orphans",
   faanHeavenly: "Heavenly Hand",
   faanEarthly: "Earthly Hand",
   faanAllHonors: "All Honors",
   faanGreatDragons: "Great Dragons",
   faanGreatWinds: "Great Winds",
   faanAllKongs: "All Kongs",
   faanNineGates: "Nine Gates",
   faanAllChows: "Common Hand",
   faanAllPungs: "All Pungs",
   faanHalfFlush: "Mixed One Suit",
   faanFullFlush: "Pure One Suit",
   faanDragonPung: "Dragon Pung",
   faanSmallDragons: "Small Dragons",
   faanSeatWind: "Seat Wind",
   faanPrevWind: "Round Wind",
   faanSmallWinds: "Small Winds",
   faanConcealed: "Concealed Hand",
   faanSelfDraw: "Self-Draw",
   faanRobbingKong: "Robbing the Kong",
   faanKongReplacement: "Kong Replacement",
   faanLastTileDraw: "Last Tile Draw",
   faanLastTileDiscard: "Last Tile Claim",
   faanNoFlowers: "No Flowers",
   faanSeatFlower: "Seat Flower",
   faanFlowerQuad: "Flower Quad",

   /* ── in-game attention toasts ────────────────────────────────── */
   claimToast: "You can claim {name}'s {tile}!",
   dealInToast: "You dealt into {name}'s hand.",
   winToast: "Mahjong! +{n} points.",
   robbedToast: "{name} robbed your kong!",

   /* ── game over ───────────────────────────────────────────────── */
   gameOver: "Game Over",
   handCount: "{n} hands",
   rematchButton: "Rematch",
   rematchSoon: "Rematch lands with the worker — reopen the table for now.",
   superMostWins: "Most wins",
   superBestHand: "Biggest hand",
   superMostDealIns: "Most deal-ins",
   superMostKongs: "Most kongs",
   superValue: "[{n}x]",
   statHidden: "—",

   /* ── spectator ───────────────────────────────────────────────── */
   spectatingNote: "You're spectating. Sit down if there's space and you'd like to play!",

   /* ── connection / refusals ───────────────────────────────────── */
   connDown: "Reconnecting…",
   connUp: "Back!",
   kickedMeta: "The host removed you from the table.",
   tableFull: "Table is full.",
   nameTaken: "That name is taken at the table.",
   noTable: "No such table.",
   toastDismiss: "Dismiss",

   /* ── error codes → friendly lines (engine denials) ───────────── */
   errTurn: "Not your turn.",
   errPhase: "Can't do that right now.",
   errLoc: "That doesn't work.",
   errPerm: "You can't do that.",
   errFull: "Table's full.",
   errColor: "That's not a hex color.",
   errColorTaken: "Too close to another player's color.",
   errFlood: "Slow down a moment.",

   /* ── disconnect grace + bot takeover ─────────────────────────── */
   leavingToast: "{name} disconnected — a bot takes over in {secs}s",
   returnedToast: "{name} is back.",
   takeoverToast: "A bot is now playing {name}'s seat.",

   /* ── desktop-only guard ──────────────────────────────────────── */
   desktopOnly: "DeetsMahjong needs a wider screen."
};
