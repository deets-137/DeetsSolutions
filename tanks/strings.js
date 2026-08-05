/* DeetsTanks — UI copy (docs/tanks.md, "Copy").

   EVERY user-facing flavor string on the tanks page lives in this one
   flat object. tanks.js holds no flavor copy of its own.

   The house convention, verbatim (docs/games.md): Claude may ADD a
   string when wiring new UI, but every Claude-authored value must be
   prefixed "[ph]" — a placeholder Aditya rewrites, deleting the prefix
   as he goes. Claude never edits an un-prefixed (handwritten) value,
   and nothing still carrying "[ph]" may ship.

   Tanks is deliberately LIGHT on words (his call, 2026-08-05): the HUD
   is icons — hearts, pips, a level numeral — so most entries here are
   aria labels and hovers rather than visible text.

   Un-prefixed strings below are CARRIED VERBATIM from the poker/cities/
   mahjong handwritten passes (the shared shell copy — gate, toolbar,
   lobby seats, color picker, refusals); he already approved those exact
   words, so they land clean (docs/design-language.md, "[ph]"). */
window.TANKS_STRINGS = {
  /* ── bar (carried from cities/poker) ─────────────────────────── */
  tableCodePlaceholder: "Table Code",
  yourTables: "Recents",

  /* ── peek / create gate (carried from cities/poker) ──────────── */
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

  /* ── toolbar pills (carried from cities/mahjong/poker) ───────── */
  invitePill: "Invite",
  settingsPill: "Table Settings",
  shareToast: "Invite link copied!",
  sitPill: "Sit down",
  leavePill: "Leave",
  closePill: "Close Table",
  closeConfirm: "Confirm?",
  tableClosed: "The host closed the table.",
  standButton: "Stand up",
  standConfirm: "Confirm?",

  /* ── lobby (carried from poker unless noted) ─────────────────── */
  lobbyTitle: "Table settings",
  /* the five settings strings are Aditya's — approved in chat 2026-08-05 */
  livesLabel: "Lives",
  aimLineLabel: "Aim line",
  ffLabel: "Friendly fire",
  settingOn: "On",
  settingOff: "Off",
  startButton: "Start game",
  shufflePill: "Shuffle",
  seatOpen: "Open seat",
  seatYou: "{name} (you)",
  hostBadge: "Host",
  kickSeatAria: "Remove {name}",
  rejoinLabel: "Mid-game Join",
  rejoinRejoin: "Rejoin",
  adoptedToast: "{name} sat down.",
  addBotButton: "Add Bot",
  addBotGo: "Confirm?",
  addBotNameAria: "Bot name",
  addBotCancelAria: "Cancel adding a bot",
  renameBotAria: "Rename {name}",
  botTierAria: "Bot difficulty",
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
  /* the lobby preview caption under the rendered level */
  previewCaption: "[ph] Level {n}",

  /* ── play: HUD (aria/hover only — the HUD itself is icons) ───── */
  playersTitle: "[ph] Tanks",
  livesAria: "[ph] {name}: {n} lives",
  killsAria: "[ph] {name}: {n} kills",
  campaignAria: "[ph] Level {n}, {left} enemies left",
  enemyPipAria: "[ph] Enemy tank",
  controlsDrive: "[ph] WASD to drive",
  controlsAim: "[ph] Mouse to aim",
  controlsFire: "[ph] Click to fire — two shells a second, five in the air",
  controlsMine: "[ph] Space to lay a mine (two per life)",
  shellsAria: "[ph] {n} of {max} shells ready",
  minesAria: "[ph] {n} mines left",
  spectatingNote: "[ph] You're spectating.",

  /* ── interstitials (over the arena, mahjong's handOver idiom) ── */
  clearedLine: "[ph] Level {n} cleared!",
  failedLine: "[ph] Boom. Try again.",
  nextIn: "[ph] Next level in {s}…",
  retryIn: "[ph] Back in it in {s}…",
  wonLine: "[ph] Campaign complete!",
  lostLine: "[ph] Out of tanks.",
  rematchButton: "Rematch",

  /* ── dev (mock only) ─────────────────────────────────────────── */
  lagPill: "[ph] Lag {ms}ms",
  lagPillTip: "[ph] Mock only: extra one-way latency on the sim channel.",

  /* ── connection / refusals (carried from cities/mahjong/poker) ── */
  connDown: "Reconnecting…",
  connUp: "Back!",
  replacedToast: "You opened this table in another tab. Multiple tabs is no bueno, please close the other ones.",
  kickedMeta: "The host removed you from the table.",
  tableFull: "Table is full.",
  nameTaken: "That name is taken at the table.",
  noTable: "No such table.",
  toastDismiss: "Dismiss",
  concededToast: "{name} cashed out.",
  leavingToast: "{name} has disconnected.",
  returnedToast: "{name} is back.",
  /* adapted from poker's (new noun), so it re-arrives as a placeholder */
  takeoverToast: "[ph] {name}'s tank is on its own.",
  errTurn: "Not your turn.",
  errPhase: "Can't do that right now.",
  errPerm: "You can't do that.",
  errFull: "Table's full.",
  errColor: "That's not a hex color.",
  errColorTaken: "Too close to another player's color.",
  errFlood: "Slow down a moment.",

  /* ── desktop-only guard ──────────────────────────────────────── */
  desktopOnly: "[ph] DeetsTanks needs a wider screen."
};
