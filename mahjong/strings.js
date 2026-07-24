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
   /* shown instead of the Sit/Spectate pair when there's no open seat to take
      (running game, or a full lobby). One enabled pill, because joining is one
      action: the worker hands your seat back if your token owns one, else you
      land as a spectator. */
   rejoinButton: "[ph]Rejoin or spectate",
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

   /* ── scoring guide (the Scoring pill's popup) ────────────────
      approved by Aditya in chat (2026-07-24, scoring-guide session) —
      no [ph] */
   pillGuide: "Scoring",
   guideTitle: "Scoring guide",
   guideCloseAria: "Close the scoring guide",
   guideIntro: "A winning hand is 4 sets + a pair. Every pattern below adds faan — this table needs {min} faan to win, capped at {cap}.",
   guideLiveTitle: "Your hand right now",
   guideLiveNote: "Patterns you already hold are marked below.",
   guideLivePays: "Winning now would pay a {n}-chip base.",
   guideSecShape: "Hand shape",
   guideSecWinds: "Dragons and winds",
   guideSecWon: "How you won",
   guideSecFlowers: "Flowers",
   guideSecLimit: "Limit hands",
   guideLimitBadge: "score the cap: {n}",
   guideWonNote: "Decided at the moment you win — they can't be held early.",
   guideSecPay: "Getting paid",
   guidePayBase: "Your faan set the base",
   guidePayBaseVal: "2^faan chips",
   guidePayDiscard: "Win by discard",
   guidePayDiscardVal: "discarder pays 2x, others 1x",
   guidePaySelf: "Win by self-draw",
   guidePaySelfVal: "everyone pays 2x",

   /* per-pattern one-liners (guide rows; keys mirror the faan names) */
   guideDescAllChows: "all runs, plain pair",
   guideDescAllPungs: "all triplets",
   guideDescHalfFlush: "one suit + honors",
   guideDescFullFlush: "one suit only",
   guideDescDragonPung: "each dragon triplet",
   guideDescSmallDragons: "2 dragon pungs + dragon pair",
   guideDescSeatWind: "triplet of your wind",
   guideDescPrevWind: "triplet of the round's wind",
   guideDescSmallWinds: "3 wind pungs + wind pair",
   guideDescSelfDraw: "won on your own draw",
   guideDescConcealed: "nothing melded, won by discard",
   guideDescRobbingKong: "steal a promoted kong tile",
   guideDescKongReplacement: "win on the extra tile after a kong",
   guideDescLastTileDraw: "self-draw the wall's final tile",
   guideDescLastTileDiscard: "win on the discard after it",
   guideDescNoFlowers: "drew none all hand",
   guideDescSeatFlower: "each flower matching your seat",
   guideDescFlowerQuad: "all 4 flowers or all 4 seasons",
   guideDescThirteenOrphans: "one of every 1, 9, and honor + a pair",
   guideDescHeavenly: "dealer wins on the very first draw",
   guideDescEarthly: "win on the dealer's first discard",
   guideDescAllHonors: "only winds and dragons",
   guideDescGreatDragons: "triplets of all 3 dragons",
   guideDescGreatWinds: "triplets of all 4 winds",
   guideDescAllKongs: "four kongs",
   guideDescNineGates: "concealed 1112345678999 + one more",

   /* ── in-game attention toasts ────────────────────────────────── */
   claimToast: "You can claim {name}'s {tile}!",
   dealInToast: "You dealt into {name}'s hand.",
   winToast: "Mahjong! +{n} points.",
   robbedToast: "{name} robbed your kong!",

   /* ── game over ───────────────────────────────────────────────── */
   gameOver: "Game Over",
   handCount: "{n} hands",
   rematchButton: "Rematch",
   superMostWins: "Most wins",
   superBestHand: "Biggest hand",
   superMostDealIns: "Most deal-ins",
   superMostKongs: "Most kongs",
   superValue: "[{n}x]",
   statHidden: "—",

   /* ── spectator ───────────────────────────────────────────────── */
   spectatingNote: "You're spectating. Sit down if there's space and you'd like to play!",

   /* ── connection / refusals ───────────────────────────────────── */
   /* host-only warning under Start: seats that went dark in the lobby are
      dealt in as bots (the lobby hold itself never expires — see docs). */
   startBotWarn: "{n} disconnected seat(s) will be played by bots.",
   connDown: "Reconnecting…",
   connUp: "Back!",
   /* sticky: this tab lost the table to another tab on the same device. One
      device is one player, so the fix is to close a tab, not to retry. */
   replacedToast: "You opened this table in another tab. Multiple tabs is no bueno, please close the other ones.",
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
