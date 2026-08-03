/* DeetsPoker — UI copy (docs/poker.md, "Copy").

   EVERY user-facing FLAVOR string on the poker page lives in this one flat
   object: gate copy, buttons, empty states, settings labels, hand names.
   poker.js holds no flavor copy of its own — the terse mechanical LOG lines
   are Claude-authored in poker.js, rendered from typed event records (they
   pull display names from here).

   Radio/cities/mahjong convention, verbatim: Claude may ADD a string when
   wiring new UI, but every Claude-authored value must be prefixed "[ph]" — a
   placeholder Aditya rewrites, deleting the prefix as he goes. Claude never
   edits an un-prefixed (handwritten) value, and nothing still carrying
   "[ph]" may ship. The action-button hover lines, the small-blind hint, and
   the Stand up hover were DICTATED BY ADITYA IN CHAT (2026-08-03) and are
   un-prefixed from birth — section comments mark them.

   {curly} tokens are filled by poker.js (fmt()). Money strings receive
   already-formatted amounts ("$1.20"). */
window.POKER_STRINGS = {
   /* ── bar ─────────────────────────────────────────────────────── */
   tableCodePlaceholder: "[ph]Table Code",
   yourTables: "[ph]Recents",

   /* ── peek / create gate ──────────────────────────────────────── */
   peekFull: "[ph]Table full | {spectators} spectating",
   peekPlayers: "[ph]{seated} players | {spectators} spectating",
   sitButton: "[ph]Sit down",
   watchButton: "[ph]Spectate",
   rejoinButton: "[ph]Rejoin or spectate",
   createLine: "[ph]The '{code}' Table doesn't exist yet. Open it?",
   createButton: "[ph]Open the Table",
   nameLabel: "[ph]Your name",
   nameNeeded: "[ph]Enter a name first.",
   joinRefused: "[ph]Table no longer exists.",
   peekFailed: "[ph]Couldn't join the table. Try again soon!",

   /* ── toolbar pills ───────────────────────────────────────────── */
   invitePill: "[ph]Invite",
   settingsPill: "[ph]Table Settings",
   shareToast: "[ph]Invite link copied!",
   sitPill: "[ph]Sit down",
   leavePill: "[ph]Leave",
   closePill: "[ph]Close Table",
   closeConfirm: "[ph]Confirm?",
   tableClosed: "[ph]The host closed the table.",
   /* mid-game toolbar — poker's own pills. Stand up cashes you out
      (rejoin is locked to "none"); the hover title is Aditya's, chat
      2026-08-03. */
   standButton: "[ph]Stand up",
   standConfirm: "[ph]Confirm?",
   standHover: "Cash out",   /* Aditya's, chat 2026-08-03 — hover on Stand up */
   voteEndPill: "[ph]Vote to end",
   voteEndCount: "[ph]{n}/{need}",
   endGamePill: "[ph]End game",
   endGameConfirm: "[ph]Confirm?",
   sitInPill: "[ph]Sit in",
   voteToast: "[ph]{name} votes to end ({n}/{need}).",
   unvoteToast: "[ph]{name} withdrew their vote ({n}/{need}).",

   /* ── lobby (big tile: settings) ──────────────────────────────── */
   lobbyTitle: "[ph]Table settings",
   capacityLabel: "[ph]Seats",
   buyInLabel: "[ph]Buy-in",
   buyInCustom: "$#",
   chipsLabel: "[ph]Chips",
   chipsHint: "[ph]Lowest to highest — values are each chip's worth.",
   chipsBad: "[ph]Chip values need to be positive amounts in cents.",
   blindLabel: "[ph]Big blind",
   /* the row's one hint line — Aditya's, chat 2026-08-03. The red toast
      below (blindBad) fires when a blind doesn't split into the chips. */
   blindHalfHint: "Small blind is half the Big blind",
   blindBad: "[ph]That blind doesn't split into the chips.",
   buyInBad: "[ph]That buy-in doesn't split into the chips.",
   timerLabel: "[ph]Turn timer",
   timerOff: "[ph]None",
   timerSecs: "[ph]{n}s",
   timerCustom: "#s",
   minRaiseLabel: "[ph]Minimum raise",
   minRaisePrev: "[ph]At least previous",
   minRaiseDouble: "[ph]Double previous",
   minRaiseNone: "[ph]No minimum",
   seatingLabel: "[ph]Seating",
   seatingOpen: "[ph]Anyone, any time",
   seatingLobby: "[ph]Lobby only",
   startButton: "[ph]Start game",
   shufflePill: "[ph]Shuffle",
   startHint: "[ph]Everyone buys in on press.",
   startNeedsTwo: "[ph]Poker needs at least 2 players.",
   seatOpen: "[ph]Open seat",
   seatYou: "[ph]{name} (you)",
   hostBadge: "[ph]Host",
   kickSeatAria: "[ph]Remove {name}",
   rejoinLabel: "[ph]Re-joining",
   rejoinAnyone: "[ph]Anyone",
   rejoinRejoin: "[ph]Rejoin",
   rejoinNone: "[ph]None",
   sitDownPill: "[ph]Take over for:",
   adoptedToast: "[ph]{name} sat down.",
   addBotButton: "[ph]Add Bot",
   addBotGo: "[ph]Confirm?",
   addBotNameAria: "[ph]Bot name",
   addBotCancelAria: "[ph]Cancel adding a bot",
   renameBotAria: "[ph]Rename {name}",
   botTierAria: "[ph]Bot difficulty",
   renameGo: "[ph]Save",
   renameReset: "[ph]Reset",
   renameYouAria: "[ph]Edit your name",
   renameNameAria: "[ph]Your name",
   renameResetAria: "[ph]Reset to your profile name",
   renameCancelAria: "[ph]Cancel renaming",
   botSeatTag: "[ph]{name} (bot)",
   /* seat-color picker */
   colorYours: "[ph]Your color",
   colorTheirs: "[ph]{name}'s color",
   colorBecome: "[ph]Become...",
   colorDotAria: "[ph]Change color for {name}",
   colorSwatchAria: "[ph]Claim this color",
   colorCustomAria: "[ph]Your custom color",
   colorTakenBy: "[ph]{name} has this one",
   colorHexLabel: "[ph]Custom:",
   colorBadHex: "[ph]Six hex digits, like #1fb0aa",
   colorClashWith: "[ph]Too close to {name}",

   /* ── play: felt + seats ──────────────────────────────────────── */
   handLine: "[ph]Hand {n}",
   potLine: "[ph]pot {amt}",
   dealerTag: "[ph]D",
   smallBlindTag: "[ph]1",
   bigBlindTag: "[ph]2",
   dealerTip: "[ph]Dealer button",
   smallBlindTip: "[ph]Small blind",
   bigBlindTip: "[ph]Big blind",
   yourTurnToast: "[ph]Your turn!",
   waitingLine: "[ph]Waiting for players…",
   foldedTag: "[ph]Folded",
   allInTag: "[ph]All-in",
   outTag: "[ph]Busted",
   leftTag: "[ph]Cashed out",
   waitingTag: "[ph]Next hand",
   awayTag: "[ph]Away",
   stackShort: "[ph]{amt}",
   betShort: "[ph]{amt}",
   playersTitle: "[ph]Players",
   spectatingNote: "[ph]You're spectating. Sit in if there's a seat and you'd like to play!",

   /* ── the hand panel (your cards + actions) ───────────────────── */
   handTitle: "[ph]Your hand",
   actionFold: "[ph]Fold",
   actionCheck: "[ph]Check",
   actionCall: "[ph]Call {amt}",
   actionRaise: "[ph]Raise",
   /* hover lines under the four action buttons — Aditya's, dictated in
      chat 2026-08-03, verbatim. */
   hoverCheck: "bet 0, to stay in the game without placing any money if everyone agrees",
   hoverRaise: "increase everyone's minimum bet to stay in",
   hoverCall: "match the last bet to stay in",
   hoverFold: "call your losses, if any.",
   raiseTo: "[ph]Raise to",
   raiseGo: "[ph]Confirm",
   raiseBad: "[ph]That amount doesn't split into the chips.",
   raiseCustomAria: "[ph]Type a raise amount",
   buyInButton: "[ph]Buy in ({amt})",
   buyInNote: "[ph]You're out of chips.",
   waitingNote: "[ph]You're in at the next deal.",
   notYourTurn: "[ph]Waiting on {name}…",

   /* ── hand over (settlement interstitial) ─────────────────────── */
   winLine: "[ph]{name} wins {amt}",
   winLineHand: "[ph]{name} wins {amt} — {hand}",
   foldWinLine: "[ph]{name} takes it — everyone folded",
   splitTag: "[ph]Split pot",
   sidePotTag: "[ph]Side pot",
   nextHandButton: "[ph]Next hand",
   nextHandAuto: "[ph]Next hand in {n}s…",
   bustToast: "[ph]You're bust — buy back in to keep playing.",

   /* hand-category names (engine HAND_NAMES keys) */
   handHigh: "[ph]High card",
   handPair: "[ph]Pair",
   handTwoPair: "[ph]Two pair",
   handTrips: "[ph]Three of a kind",
   handStraight: "[ph]Straight",
   handFlush: "[ph]Flush",
   handFullHouse: "[ph]Full house",
   handQuads: "[ph]Four of a kind",
   handStraightFlush: "[ph]Straight flush",

   /* ── game over (the cash-out lobby) ──────────────────────────── */
   gameOver: "[ph]Cashing out",
   endedByVote: "[ph]The table voted to end the game.",
   endedByHost: "[ph]The host ended the game.",
   endedByAttrition: "[ph]Everyone else cashed out.",
   colBought: "[ph]Bought in",
   colStack: "[ph]Walked with",
   colNet: "[ph]Net",
   handCount: "[ph]{n} hands",
   rematchButton: "[ph]Rematch",
   ordinals: ["[ph]1st", "[ph]2nd", "[ph]3rd", "[ph]4th", "[ph]5th", "[ph]6th",
              "[ph]7th", "[ph]8th", "[ph]9th", "[ph]10th", "[ph]11th", "[ph]12th"],
   placeTied: "[ph]T-{place}",

   /* ── connection / refusals ───────────────────────────────────── */
   startBotWarn: "[ph]{n} disconnected seat(s) will be played by bots.",
   connDown: "[ph]Reconnecting…",
   connUp: "[ph]Back!",
   replacedToast: "[ph]You opened this table in another tab. Multiple tabs is no bueno, please close the other ones.",
   kickedMeta: "[ph]The host removed you from the table.",
   tableFull: "[ph]Table is full.",
   nameTaken: "[ph]That name is taken at the table.",
   noTable: "[ph]No such table.",
   toastDismiss: "[ph]Dismiss",
   concededToast: "[ph]{name} cashed out.",

   /* ── error codes → friendly lines (engine denials) ───────────── */
   errTurn: "[ph]Not your turn.",
   errPhase: "[ph]Can't do that right now.",
   errPerm: "[ph]You can't do that.",
   errFull: "[ph]Table's full.",
   errColor: "[ph]That's not a hex color.",
   errColorTaken: "[ph]Too close to another player's color.",
   errFlood: "[ph]Slow down a moment.",
   errRaise: "[ph]That raise is too small.",
   errChips: "[ph]That amount doesn't split into the chips.",
   errSeating: "[ph]This table only seats players from the lobby.",

   /* ── disconnect grace ────────────────────────────────────────── */
   leavingToast: "[ph]{name} disconnected — their seat folds until they're back.",
   returnedToast: "[ph]{name} is back.",
   takeoverToast: "[ph]{name}'s seat is folding on its own.",

   /* ── desktop-only guard ──────────────────────────────────────── */
   desktopOnly: "[ph]DeetsPoker needs a wider screen."
};
