/* DeetsBall — UI copy for the demo (/ball/ and /ball/draft/).

   Every user-facing string on these pages lives here. No '[ph]' prefix on
   these pages (his call, 2026-11-25): Claude writes these plainly, and
   he edits one when he wants to. Team and player names are data
   (snapshot.json), not copy.

   {curly} tokens are filled by the page's script. */
window.BALL_STRINGS = {
  /* ── /ball/ ─────────────────────────────────────────────────── */
  draftButton: "Draft",
  teamPill:   "Team",
  emptyTeam:  "No players on this team.",
  loadFailed: "Couldn't load the players.",

  /* ── /ball/draft/ — the host screen ─────────────────────────── */
  draftTitle:    "Draft",
  newDraft:      "New draft",
  roomsEmpty:    "No drafts yet. Start one.",
  roomsFailed:   "Couldn't reach the draft server.",
  roomLobby:     "Waiting for teams",
  roomRound:     "Round {n}",
  roomDone:      "Finished",
  openSeat:      "Open seat",
  roomTitle:     "Draft {code}",
  joinAt:        "Join at {url}",
  allDrafts:     "All drafts",
  addBot:        "Add bot",
  removeSeat:    "Remove",
  startDraft:    "Start draft",
  needTeams:     "Waiting for {n} more",
  botTag:        "Bot",
  statusIn:      "Ballot in",
  statusWaiting: "Choosing",
  statusFull:    "Full",
  rosterHead:    "Roster {n}/15",
  roundHead:     "Round {n}",
  roundsHead:    "Every round",
  noRoundsYet:   "Round 1 results show here.",
  draftDone:     "Draft complete",
  reconnecting:  "Reconnecting…",
  roomClosed:    "This draft has closed. A draft room closes an hour after it was made.",
  outTaken:      "Taken by {team}",
  out_won:       "Won",
  out_tie:       "Tie",
  out_tied:      "Tied above",
  out_full:      "Roster full",

  /* ── /ball/draft/<code> — the GM's phone ────────────────────── */
  gmTitle:          "Draft {code}",
  teamName:         "Team name",
  join:             "Join",
  waitStart:        "You're in. Waiting for the host to start.",
  gmStarted:        "This draft has started without you.",
  ballotHead:       "Round {n} ballot",
  rankEmpty:        "Rank {n}",
  search:           "Search players",
  sendBallot:       "Send ballot",
  resendBallot:     "Send changes",
  ballotSent:       "Ballot sent. Waiting for the other teams.",
  needFive:         "Pick {n} more",
  lastRound:        "Last round",
  yourRoster:       "Your roster {n}/15",
  rosterEmpty:      "No players yet.",
  youFull:          "Your roster is full.",
  draftOver:        "The draft is over.",
  moveUp:           "Move up",
  moveDown:         "Move down",
  removePick:       "Remove",
  noRoom:           "No draft with that code."
};
