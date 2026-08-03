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
   "[ph]" may ship.

   Un-prefixed provenance in THIS file (all per Aditya, chat 2026-08-03):
   - strings CARRIED VERBATIM from his cities/mahjong passes (the shared
     shell copy: gate, toolbar, lobby seats, color picker, refusals);
   - single-character badges (D / 1 / 2);
   - the four action buttons, "Raise by", "Confirm", "Your Hand";
   - the action hover lines, the small-blind hint, and the Stand up hover,
     dictated verbatim.
   Everything else still awaits his pass.

   {curly} tokens are filled by poker.js (fmt()). Money strings receive
   already-formatted amounts ("$1.20"). */
window.POKER_STRINGS = {
   /* ── bar (carried from cities) ───────────────────────────────── */
   tableCodePlaceholder: "Table Code",
   yourTables: "Recents",

   /* ── peek / create gate (carried from cities) ────────────────── */
   peekFull: "Table full | {spectators} spectating",
   peekPlayers: "{seated} players | {spectators} spectating",
   sitButton: "Sit down",
   watchButton: "Spectate",
   rejoinButton: "Rejoin or spectate",
   createLine: "The '{code}' Table doesn't exist yet. Open it?",
   createButton: "Open the Table",
   nameLabel: "Your name",
   nameNeeded: "Enter a name first.",
   joinRefused: "Table no longer exists.",
   peekFailed: "Couldn't join the table. Try again soon!",

   /* ── toolbar pills (carried from cities/mahjong) ─────────────── */
   invitePill: "Invite",
   settingsPill: "Table Settings",
   shareToast: "Invite link copied!",
   sitPill: "Sit down",
   leavePill: "Leave",
   closePill: "Close Table",
   closeConfirm: "Confirm?",
   tableClosed: "The host closed the table.",
   /* mid-game toolbar — poker's own pills. Stand up cashes you out
      (rejoin is locked to "none"); the hover title is Aditya's, chat
      2026-08-03. */
   standButton: "Stand up",
   standConfirm: "Confirm?",
   standHover: "Cash out",   /* Aditya's, chat 2026-08-03 — hover on Stand up */
   voteEndPill: "[ph]Vote to end",
   voteEndCount: "[ph]{n}/{need}",
   endGamePill: "[ph]End game",
   endGameConfirm: "Confirm?",
   sitInPill: "[ph]Sit in",
   voteToast: "[ph]{name} votes to end ({n}/{need}).",
   unvoteToast: "[ph]{name} withdrew their vote ({n}/{need}).",

   /* ── lobby (big tile: settings) ──────────────────────────────── */
   lobbyTitle: "Table settings",
   capacityLabel: "[ph]Seats",
   buyInLabel: "[ph]Buy-in",
   buyInCustom: "$#",
   chipsLabel: "[ph]Chips",
   chipsHint: "[ph]Values are each chip's worth.",
   chipsBad: "[ph]Chip values need to be positive amounts in cents.",
   blindLabel: "[ph]Big blind",
   /* the row's one hint line — Aditya's, chat 2026-08-03. The red toast
      below (blindBad) fires when a blind doesn't split into the chips. */
   blindHalfHint: "Small blind is half the Big blind",
   blindBad: "[ph]That blind doesn't split into the chips.",
   buyInBad: "[ph]That buy-in doesn't split into the chips.",
   timerLabel: "Turn timer",
   timerOff: "[ph]None",
   timerSecs: "{n}s",
   timerCustom: "#s",
   minRaiseLabel: "[ph]Minimum raise",
   minRaisePrev: "[ph]At least previous",
   minRaiseDouble: "[ph]Double previous",
   minRaiseNone: "[ph]No minimum",
   seatingLabel: "[ph]Seating",
   seatingOpen: "[ph]Anyone, any time",
   seatingLobby: "[ph]Lobby only",
   startButton: "Start game",
   shufflePill: "Shuffle",
   startHint: "[ph]Everyone buys in on press.",
   startNeedsTwo: "[ph]Poker needs at least 2 players.",
   seatOpen: "Open seat",
   seatYou: "{name} (you)",
   hostBadge: "Host",
   kickSeatAria: "Remove {name}",
   rejoinLabel: "Re-joining",
   rejoinAnyone: "Anyone",
   rejoinRejoin: "Rejoin",
   rejoinNone: "None",
   sitDownPill: "Take over for:",
   adoptedToast: "[ph]{name} sat down.",
   addBotButton: "Add Bot",
   addBotGo: "Confirm?",
   addBotNameAria: "Bot name",
   addBotCancelAria: "Cancel adding a bot",
   renameBotAria: "Rename {name}",
   botTierAria: "[ph]Bot difficulty",
   renameGo: "Save",
   renameReset: "Reset",
   renameYouAria: "[ph]Edit your name",
   renameNameAria: "[ph]Your name",
   renameResetAria: "[ph]Reset to your profile name",
   renameCancelAria: "[ph]Cancel renaming",
   botSeatTag: "{name} (bot)",
   /* seat-color picker (carried from cities) */
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

   /* ── play: felt + seats ──────────────────────────────────────── */
   handLine: "[ph]Hand {n}",
   potLine: "[ph]pot {amt}",
   /* the button badges — single characters, Aditya's call (chat 2026-08-03) */
   dealerTag: "D",
   smallBlindTag: "1",
   bigBlindTag: "2",
   dealerTip: "[ph]Dealer button",
   smallBlindTip: "[ph]Small blind",
   bigBlindTip: "[ph]Big blind",
   yourTurnToast: "Your turn!",
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
   /* the felt's popover buttons (cities' Odds/Resources idiom) — all
      four approved by Aditya in chat 2026-08-03, no [ph] */
   winningsButton: "Winnings",
   logButton: "Log",
   winningsNet: "Net",
   winningsHint: "Rows win from columns.",
   spectatingNote: "[ph]You're spectating. Sit in if there's a seat and you'd like to play!",

   /* ── the hand panel (your cards + actions) — the four buttons,
      "Raise by", "Confirm" and "Your Hand" are Aditya's (chat 2026-08-03) ── */
   handTitle: "Your Hand",
   actionFold: "Fold",
   actionCheck: "Check",
   actionCall: "Call {amt}",
   actionRaise: "Raise",
   /* hover lines on the four action buttons — Aditya's, dictated in
      chat 2026-08-03, verbatim. Native tooltips only (his call). */
   hoverCheck: "bet 0, to stay in the game without placing any money if everyone agrees",
   hoverRaise: "increase everyone's minimum bet to stay in",
   hoverCall: "match the last bet to stay in",
   hoverFold: "call your losses, if any.",
   raiseBy: "Raise by",
   raiseGo: "Confirm",
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
   handCount: "{n} hands",
   rematchButton: "Rematch",
   ordinals: ["[ph]1st", "[ph]2nd", "[ph]3rd", "[ph]4th", "[ph]5th", "[ph]6th",
              "[ph]7th", "[ph]8th", "[ph]9th", "[ph]10th", "[ph]11th", "[ph]12th"],
   placeTied: "[ph]T-{place}",

   /* ── connection / refusals (carried from cities/mahjong) ─────── */
   startBotWarn: "{n} disconnected seat(s) will be played by bots.",
   connDown: "Reconnecting…",
   connUp: "Back!",
   replacedToast: "You opened this table in another tab. Multiple tabs is no bueno, please close the other ones.",
   kickedMeta: "The host removed you from the table.",
   tableFull: "Table is full.",
   nameTaken: "That name is taken at the table.",
   noTable: "No such table.",
   toastDismiss: "Dismiss",
   concededToast: "[ph]{name} cashed out.",

   /* ── error codes → friendly lines (carried where the code is shared;
      poker's own codes still [ph]) ───────────────────────────────── */
   errTurn: "Not your turn.",
   errPhase: "Can't do that right now.",
   errPerm: "You can't do that.",
   errFull: "Table's full.",
   errColor: "That's not a hex color.",
   errColorTaken: "Too close to another player's color.",
   errFlood: "Slow down a moment.",
   errRaise: "[ph]That raise is too small.",
   errChips: "[ph]That amount doesn't split into the chips.",
   errSeating: "[ph]This table only seats players from the lobby.",

   /* ── disconnect (poker's no-bot wording — still awaits his pass) ── */
   leavingToast: "[ph]{name} disconnected — their seat folds until they're back.",
   returnedToast: "{name} is back.",
   takeoverToast: "[ph]{name}'s seat is folding on its own.",

   /* ── desktop-only guard (the sibling pages' sentence) ────────── */
   desktopOnly: "DeetsPoker needs a wider screen."
};
