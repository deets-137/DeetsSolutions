/* DeetsPoker — UI copy (docs/poker.md, "Copy").

   EVERY user-facing FLAVOR string on the poker page lives in this one flat
   object: gate copy, buttons, empty states, settings labels, hand names.
   poker.js holds no flavor copy of its own — the terse mechanical LOG lines
   are Claude-authored in poker.js, rendered from typed event records (they
   pull display names from here).

   Radio/cities/mahjong convention, verbatim: Claude may ADD a string when
   wiring new UI, but every Claude-authored value must be prefixed "[ph]" —
   a placeholder Aditya rewrites, deleting the prefix as he goes. Claude
   never edits an un-prefixed (handwritten) value, and nothing still
   carrying "[ph]" may ship.

   THIS FILE IS PAST ITS PASS. Aditya cleared the last 79 placeholders in
   one go (chat 2026-08-03) — the tags, the settlement lines, the hand
   names, the cash-out columns and the aria labels are all his now, same
   as the lines he dictated:
   - strings CARRIED VERBATIM from his cities/mahjong passes (the shared
     shell copy: gate, toolbar, lobby seats, color picker, refusals);
   - single-character badges (D / 1 / 2);
   - the four action buttons, "Raise by", "Confirm", "Your Hand";
   - the action hover lines and the Stand up hover, dictated verbatim;
   - the LOBBY SETTINGS labels + the min-raise chips ("1x prev" / "2x prev"
     / "No min") and "Mid-game Join", approved/renamed in chat 2026-08-03.
   Cleared again on 2026-08-04: the sixteen placeholders behind the
   showdown pass (the reveal + Show To + Rotation hovers) are his now, as
   are "Hand recap", "Rotation" / "Rotate Dealer" / "Rotate Seats",
   "Show To", the shown-you toast, and the whole Hand Rankings block —
   which he waived the rule on outright and asked to be written final.

   So the rule now bites the other way: a NEW string still arrives as
   "[ph]", but nothing already here may be reworded without him.

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
   /* mid-game toolbar — poker's own pills. Stand up cashes you out at a
      "none" table only; the hover title is Aditya's, chat 2026-08-03.
      The sit-out wording below replaces it in the other two modes. */
   standButton: "Stand up",
   standConfirm: "Confirm?",
   standHover: "Cash out",   /* Aditya's, chat 2026-08-03 — hover on Stand up */
   /* the same pill at an "anyone"/"rejoin" table, where the stack survives
      the absence (docs/poker.md, "Stepping away") */
   sitOutButton: "Sit out",
   sitOutHover: "Keep your seat and your stack",
   sitBackPill: "Sit down",   /* Aditya's, chat 2026-08-03 — was "Sit back in" */
   sitBackHover: "Deal me in next hand",
   /* NOT awayTag — that one (below, with the seat tags) means the socket
      dropped. This is a deliberate sit-out, which is a different thing. */
   sittingOutTag: "Sitting out",
   owesAnteTag: "Posting ante",
   awayToast: "{name} is sitting out.",
   backToast: "{name} is back.",
   anteToast: "You posted a big blind as an ante to sit back in.",
   voteEndPill: "Vote to end",
   voteEndCount: "{n}/{need}",
   endGamePill: "End game",   /* Aditya's, chat 2026-08-03 */
   endGameConfirm: "Confirm?",
   sitInPill: "Sit in",
   /* How the felt reads. The pill and its two options are his words,
      chat 2026-08-04; the hovers are Claude's. Display only, per viewer —
      "Rotate Dealer" (the default) keeps every player in their chair and
      walks the button; "Rotate Seats" pins the button to the top of the
      felt and moves everyone else. */
   rotationPill: "Rotation",
   rotateDealer: "Rotate Dealer",
   rotateSeats: "Rotate Seats",
   rotationTip: "Choose what stays put on the felt.",
   rotateDealerTip: "Everyone keeps their chair; the button moves.",
   rotateSeatsTip: "The button stays at the top; the players move.",
   voteToast: "{name} votes to end ({n}/{need}).",
   unvoteToast: "{name} withdrew their vote ({n}/{need}).",

   /* ── lobby (big tile: settings) ──────────────────────────────── */
   lobbyTitle: "Table settings",
   capacityLabel: "Seats",
   buyInLabel: "Buy-in",
   buyInCustom: "$#",
   chipsLabel: "Chips",
   chipsBad: "Chip values need to be positive amounts in cents.",
   /* the settings cascade (buy-in → blind → ladder): the 4|5 pill picks
      how many rungs, and each derived row wears autoMark */
   chipCountTip: "Deal the table {n} denominations.",
   /* a derived row carries NO mark — it was derived before anyone
      touched it. Only an overridden one offers the way back. */
   autoReset: "reset",
   autoResetTip: "Go back to the suggested values.",
   blindLabel: "Big blind",
   /* the small-blind-is-half hint was cut (his call, chat 2026-08-03) —
      the settings panel has to fit the bento's big tile without an inner
      scroller. blindBad fires when a blind doesn't split into the chips. */
   blindBad: "That blind doesn't split into the chips.",
   buyInBad: "That buy-in doesn't split into the chips.",
   timerLabel: "Turn timer",
   timerOff: "None",
   timerSecs: "{n}s",
   timerCustom: "#s",
   handOverLabel: "Hand recap",   /* Aditya's, chat 2026-08-04 — the settlement card's dwell */
   minRaiseLabel: "Minimum raise",
   minRaisePrev: "1x prev",
   minRaiseDouble: "2x prev",
   minRaiseNone: "No min",
   /* no Seating row — the shared "Mid-game Join" row IS that setting now
      (rejoinLabel below); its three modes cover both halves of joining a
      running table: a new seat, and taking over one left behind. */
   startButton: "Start game",
   shufflePill: "Shuffle",
   /* no hint line under Start (his call, chat 2026-08-03) — poker sets the
      shell's `noStartHint`, so startHint/startNeedsTwo/startBotWarn are
      gone. Cities and mahjong still render theirs. */
   seatOpen: "Open seat",
   seatYou: "{name} (you)",
   hostBadge: "Host",
   kickSeatAria: "Remove {name}",
   /* Aditya's, chat 2026-08-03 — renamed from "Re-joining" when this row
      absorbed the old Seating setting: it now governs every way of
      joining a table already in play, not just coming back to one. */
   rejoinLabel: "Mid-game Join",
   rejoinAnyone: "Anyone",
   rejoinRejoin: "Rejoin",
   rejoinNone: "None",
   sitDownPill: "Take over for:",
   adoptedToast: "{name} sat down.",
   addBotButton: "Add Bot",
   addBotGo: "Confirm?",
   addBotNameAria: "Bot name",
   addBotCancelAria: "Cancel adding a bot",
   renameBotAria: "Rename {name}",
   botTierAria: "Bot difficulty",
   /* bot difficulty (docs/bots.md): the segmented picker in the host's
      bot editor, and the badge on a bot's seat row. One entry per name
      in the engine's BOT_TIER_LIST — botTier_<name>. The short forms are
      the seat-row picker (falls back to the tier name's first letter). */
   botTier_easy: "Easy",
   botTier_normal: "Normal",
   botTier_hard: "Hard",
   botTierShort_easy: "E",
   botTierShort_normal: "M",
   botTierShort_hard: "H",
   renameGo: "Save",
   renameReset: "Reset",
   renameYouAria: "Edit your name",
   renameNameAria: "Your name",
   renameResetAria: "Reset to your profile name",
   renameCancelAria: "Cancel renaming",
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
   handLine: "Hand {n}",
   /* no pot LABEL: the pot is its chips with the amount under them, and
      the word was doing no work a pile in the middle of a felt doesn't */
   /* the button badges — single characters, Aditya's call (chat 2026-08-03) */
   dealerTag: "D",
   smallBlindTag: "1",
   bigBlindTag: "2",
   dealerTip: "Dealer button",
   smallBlindTip: "Small blind",
   bigBlindTip: "Big blind",
   yourTurnToast: "Your turn!",
   waitingLine: "Waiting for players…",
   foldedTag: "Folded",
   allInTag: "All-in",
   outTag: "Busted",
   leftTag: "Cashed out",
   waitingTag: "Next hand",
   awayTag: "Away",
   stackShort: "{amt}",
   betShort: "{amt}",
   playersTitle: "Players",
   /* the felt's popover buttons (cities' Odds/Resources idiom) — all
      four approved by Aditya in chat 2026-08-03, no [ph] */
   winningsButton: "Winnings",
   logButton: "Log",
   winningsNet: "Net",
   winningsHint: "Rows win from columns.",
   spectatingNote: "You're spectating. Sit in if there's a seat and you'd like to play!",

   /* ── the hand panel (your cards + actions) — the four buttons,
      "Raise by", "Confirm" and "Your Hand" are Aditya's (chat 2026-08-03) ── */
   handTitle: "Your Hand",
   /* the chip rail beside your cards, and the tray art on the felt.
      The rail has no label — its heading is the cash total itself. */
   chipCount: "×{n}",
   chipTip: "{n} × {amt}",
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
   raiseBad: "That amount doesn't split into the chips.",
   raiseCustomAria: "Type a raise amount",
   buyInButton: "Buy in ({amt})",
   buyInNote: "You're out of chips.",
   waitingNote: "You're in at the next deal.",
   notYourTurn: "Waiting on {name}…",

   /* ── hand over (settlement interstitial) ─────────────────────── */
   winLine: "{name} wins {amt}",
   winLineHand: "{name} wins {amt} — {hand}",
   foldWinLine: "{name} takes it — everyone folded",
   splitTag: "Split pot",
   sidePotTag: "Side pot",
   nextHandButton: "Next hand",
   nextHandAuto: "Next hand in {n}s…",
   /* the opt-in show. "Reveal" and the checkbox beside it are his shape,
      dictated in chat 2026-08-03 ("Reveal | X"); the three hover lines
      and the settings label below are Claude's and still want his pass. */
   revealButton: "Reveal",
   revealTip: "Show your hand to the table.",
   revealDoneTip: "Your hand is already face-up.",
   revealNoneTip: "You had no hand in this pot.",
   revealAlwaysTip: "Always show my hand at the end of a pot.",

   /* ── show to (the private show, mid-hand) ────────────────────────
      "Show To" is his, chat 2026-08-04, as is the toast line. Anyone
      holding cards may show; only players OUT of the hand may be shown
      to. The rest of these are Claude's and want his pass. */
   showToButton: "Show To",
   shownToast: "{name} has shown you their cards!",
   showToTip: "Show your hand to someone out of the pot.",
   showToNoneTip: "Nobody is out of this pot yet.",
   showToHead: "Out of the hand",
   showToFolded: "folded",
   showToSittingOut: "sitting out",
   showToDone: "shown",
   showToCount: "{n} selected",
   showToConfirm: "Show",
   shownToYou: "shown to you",
   bustToast: "You're bust — buy back in to keep playing.",

   /* ── Hand Rankings (the guide, hand panel bottom-left) ───────────
      The button name is his (chat 2026-08-04); he waived the [ph] rule on
      the rest of this block, so these lines are final rather than
      placeholders. One row per category, best first, each with a hand
      that IS it — the fastest answer to "does a flush beat a full house"
      is one of each, side by side. Descriptions name the SHAPE only;
      what beats what is the order itself. */
   guideButton: "Hand Rankings",
   guideTitle: "Hand Rankings",
   guideTip: "Which hands beat which",
   guideClose: "Close",
   guideIntro: "Best to worst. You make your best five out of your two cards and the five on the table — either, both or neither of yours.",
   guideStraightFlush: "Five in a row, all one suit.",
   guideQuads: "All four of a rank.",
   guideFullHouse: "Three of a rank, plus a pair.",
   guideFlush: "Any five of one suit.",
   guideStraight: "Five in a row, suits mixed.",
   guideTrips: "Three of a rank.",
   guideTwoPair: "Two ranks paired.",
   guidePair: "Two of a rank.",
   guideHigh: "None of the above — your highest card plays.",
   guideFoot: "Same category on both sides? The higher cards win, and a fifth card can break it. Aces play high or low, so A-2-3-4-5 is a straight — the smallest one.",

   /* hand-category names (engine HAND_NAMES keys) */
   handHigh: "High card",
   handPair: "Pair",
   handTwoPair: "Two pair",
   handTrips: "Three of a kind",
   handStraight: "Straight",
   handFlush: "Flush",
   handFullHouse: "Full house",
   handQuads: "Four of a kind",
   handStraightFlush: "Straight flush",

   /* ── game over (the cash-out lobby) ──────────────────────────── */
   gameOver: "Cashing out",
   /* no endedByHost line — the host closing his own table explains
      itself, so `over.endedBy === "host"` renders no subtitle at all. */
   endedByVote: "The table voted to end the game.",
   endedByAttrition: "Everyone else cashed out.",
   colBought: "Bought in",
   colStack: "Walked with",
   colNet: "Net",
   handCount: "{n} hands",
   rematchButton: "Rematch",
   /* settling up — the Winnings grid's pill slot at `over` */
   repayButton: "Repayment",
   repayPays: "pays",
   repayHint: "{n} transfers settles the table.",
   repayEven: "Everyone's square — nothing to settle.",
   ordinals: ["1st", "2nd", "3rd", "4th", "5th", "6th",
              "7th", "8th", "9th", "10th", "11th", "12th"],
   placeTied: "T-{place}",

   /* ── connection / refusals (carried from cities/mahjong) ─────── */
   connDown: "Reconnecting…",
   connUp: "Back!",
   replacedToast: "You opened this table in another tab. Multiple tabs is no bueno, please close the other ones.",
   kickedMeta: "The host removed you from the table.",
   tableFull: "Table is full.",
   nameTaken: "That name is taken at the table.",
   noTable: "No such table.",
   toastDismiss: "Dismiss",
   concededToast: "{name} cashed out.",

   /* ── error codes → friendly lines (carried where the code is shared;
      poker's own codes are his too, since the pass) ─────────────────── */
   errTurn: "Not your turn.",
   errPhase: "Can't do that right now.",
   errPerm: "You can't do that.",
   errFull: "Table's full.",
   errColor: "That's not a hex color.",
   errColorTaken: "Too close to another player's color.",
   errFlood: "Slow down a moment.",
   errRaise: "That raise is too small.",
   errChips: "That amount doesn't split into the chips.",
   errMidJoin: "This table isn't taking new players mid-game.",

   /* ── disconnect ──────────────────────────────────────────────────
      What happens next is the table's business, not this toast's: the
      grace window is drawn on the seat itself, and when it closes the
      seat goes AWAY with its stack (docs/poker.md, "Stepping away").
      The old wording promised a fold that no longer happens. */
   leavingToast: "{name} has disconnected.",
   returnedToast: "{name} is back.",
   /* Poker seats no bots, so a `takeover` event is only the shared
      shell's fallback for an away action the engine refused — rare
      enough to be a bug, live enough that the string must exist. */
   takeoverToast: "{name}'s seat is folding on its own.",

   /* ── desktop-only guard (the sibling pages' sentence) ────────── */
   desktopOnly: "DeetsPoker needs a wider screen."
};
