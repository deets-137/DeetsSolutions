/* DeetsMusic page — UI copy (docs/support.md, "The page").

   EVERY user-facing string on the DeetsMusic page lives in this one flat
   object; deetsmusic.js holds no copy of its own. Aditya leads this page's
   design and writes its words. Claude may ADD a string when wiring up new
   UI, but every Claude-authored value must be prefixed "[ph]" — a
   placeholder Aditya rewrites, deleting the prefix as he goes. Claude never
   edits an un-prefixed (handwritten) value, and nothing still carrying
   "[ph]" may ship.

   State of his pass: DONE. Every string, the boards' Filter and Sort
   included, was approved in chat 2026-09-14; the board-thread strings (thread
   page, comments, moderation) on 2026-09-15; and the POLL block on 2026-09-15
   — section comments below name the lines he dictated. Zero [ph] left;
   anything added from here carries one.

   {curly} tokens are filled by deetsmusic.js — keep a token if you keep
   the fact it carries; drop it freely otherwise. */
window.DM_STRINGS = {
  /* page bar + meta */
  /* page bar buttons: dictated by Aditya in chat, 2026-09-14 */
  ctaDownload: "Download: V {v}",
  ctaSuggest:  "Suggestions",
  ctaReport:   "Bug!",
  mockBadge:   "Mock data",
  noticeLabel: "Notice",

  /* install */
  /* install box: approved by Aditya in chat, 2026-09-14 (all un-[ph] lines
     here; name and version format are his edits) */
  installName:    "DeetsMusic",
  installLoading: "Looking for the latest version…",
  installVersion: "V{v} · {date}",
  installSize:    "{mb} MB installer",
  installButton:  "Download for Windows",
  installNone:    "No installer is up right now. Check back soon.",
  installFailed:  "Couldn't reach the download server.",
  installNeeds:   "Windows 11 and an Apple Music subscription.",
  /* browser warning steps: approved by Aditya in chat, 2026-09-15 (replaces the
     "not code-signed yet" line). The page shows the visitor's own browser, and
     "Other browsers" shows the rest. Edge and Firefox were tested on his PC with
     0.6.0; Chrome was not. */
  installSigned:        "The installer is signed by Aditya Sundaram. Your browser may still warn that it isn't commonly downloaded.",
  /* the ⓘ note beside installSigned: label and text approved by Aditya in chat, 2026-09-15 */
  installWhyLabel:      "Why the warning?",
  installWhy:           "Why the warning? Browsers trust a file more as more people download it safely. Each new version of DeetsMusic starts with no download history, so the warning shows less often as more people download that version.",
  installSteps_edge:    "Edge: in the download list, click … › Keep, then the arrow on Delete › Keep anyway.",
  installSteps_firefox: "Firefox: in the downloads panel, click the arrow next to the file and allow the download. When you open it, Windows may show a blue screen: click More info, then Run anyway.",
  installSteps_chrome:  "Chrome: in the download list, click Keep. When you open it, Windows may show a blue screen: click More info, then Run anyway.",
  installOtherBrowsers: "Other browsers",

  /* status */
  /* status box: the lines without [ph] were approved by Aditya in chat, 2026-09-14 */
  statusTitle:        "Status",
  /* dictated by Aditya in chat, 2026-09-14 — what the status reading is about;
     renamed by him 2026-09-15: the check probes music-api /health (the token mint) */
  statusSubject:      "DeetsMusic Gatekeeper:",
  /* the second row, approved by Aditya in chat, 2026-09-15 — probes /update/deetsmusic/health */
  statusSubject_installer: "DeetsMusic installer:",
  status_up:          "Up",
  status_degraded:    "Degraded",
  status_down:        "Down",
  status_unknown:     "Checking",
  status_unmonitored: "Not monitored",
  statusEmpty:        "No checks have run yet.",
  statusUnmonitored:  "Nothing is checking this yet.",
  statusFailed:       "Couldn't load the status.",
  statusCellOk:       "{time} · OK · {ms} ms",
  statusCellBad:      "{time} · Failed · {note}",
  stripOld:           "6 hours ago",
  stripNow:           "Now",

  /* release notes */
  /* release notes: title, hint, the Latest / Notes only tags and the three
     withdrawn lines approved or dictated by Aditya in chat, 2026-09-14 */
  releasesTitle:      "Release notes",
  releasesHint:       "Click the card for update notes",
  releasesLoading:    "Loading release notes…",
  releasesFailed:     "Release notes aren't available right now.",
  releasesEmpty:      "No releases yet.",
  tagLatest:          "Latest",
  tagWithdrawn:       "Withdrawn",
  tagNotesOnly:       "Notes only",
  relDownload:        "Download {v} ({mb} MB)",
  relWithdrawnReason: "Withdrawn: {reason}",
  relWithdrawn:       "This version was withdrawn, so it has no download.",
  relHistory:         "This version came out before the updater, so it has no download here.",
  relNoNotes:         "No notes for this version.",

  /* boards */
  /* Suggestions + Known issues boards, top to bottom — every string from
     here through the errors approved by Aditya in chat, 2026-09-14 */
  suggestTitle: "Suggestions",
  suggestOpen:  "Suggest something",   /* the + button's label and hover tip */
  suggestEmpty: "No suggestions yet.",
  issuesTitle:  "Known issues",
  issuesOpen:   "Report a bug",       /* the + button's label and hover tip */
  issuesEmpty:  "No known issues.",
  boardLoading: "Loading…",
  boardFailed:  "Couldn't load this list.",
  postMore:     "More",
  postLess:     "Less",
  interestLabel: "Show interest",
  interestDone:  "You showed interest",
  interestAria:  "Show interest in this suggestion, {n} so far",
  /* the same ▲ button on a known issue */
  interestLabel_issue: "This affects me too",
  interestDone_issue:  "You said this affects you",
  interestAria_issue:  "Say this affects you too, {n} so far",

  state_new:     "New",
  state_open:    "Open",
  state_planned: "Planned",
  state_fixed:   "Fixed",
  state_wontfix: "Won't fix",
  state_closed:  "Closed",

  /* board toolbars — Filter + Sort: approved by Aditya in chat, 2026-09-14 */
  filterPill:     "Filter",
  filterStatus:   "Status",
  filterVersion:  "Version",
  filterClear:    "Clear filters",
  filterNone:     "None",   /* the Filter pill's value when nothing is ticked — dictated by Aditya in chat, 2026-09-14 */
  versionUnknown: "Not given",   /* a bug sent without a version */
  sortPill:       "Sort",
  sortVotes:      "Votes",
  sortDate:       "Date",
  sortAsc:        "Ascending",
  sortDesc:       "Descending",
  boardNoMatch:   "Nothing matches these filters.",

  /* the post form (both boards) */
  formTitleLabel:     "Title",
  /* both title placeholders dictated by Aditya in chat, 2026-09-14 (the page caps titles at 10 words) */
  formTitleIssuePh:   "Bug in 10 words",
  formTitleSuggestPh: "Request in 10 words",
  formBodyLabel:      "Details",
  /* the closing "Be as descriptive as possible!" in both body placeholders was dictated by Aditya in chat, 2026-09-14 */
  formBodyIssuePh:    "What you did, what you expected, and what happened instead. Be as descriptive as possible!",
  formBodySuggestPh:  "What it would do, and when you would use it. Be as descriptive as possible!",
  formVersionLabel:   "DeetsMusic version (Settings › About)",
  versionAll:         "All",   /* the version picker's catch-all choice */
  formCount:          "{n} / {max}",
  formSend:           "Send",
  formSending:        "Sending…",
  formCancel:         "Cancel",
  sentToast:          "Sent. This page is your private link to it.",

  /* errors (keys are the worker's error codes) */
  err_rate:              "Too many posts at once. Wait a minute and try again.",
  err_slow_down:         "Too many requests at once. Wait a minute and try again.",
  err_too_large:         "That is too long to send.",
  err_credential_shaped: "That looks like it contains a sign-in token. Remove it and try again.",
  err_title:             "Add a title (up to 120 characters).",
  err_title_words:       "Keep the title to 10 words.",
  err_body:              "Add some details (up to 4000 characters).",
  err_ticket:            "That post isn't available.",
  err_off:               "This is switched off for now.",
  err_network:           "Couldn't reach the server. Try again soon.",
  err_generic:           "Something went wrong. Try again soon.",
  err_owner:             "Only the owner can do that. Sign in again and reload.",

  /* owner menu — right-click a post, signed in as Aditya. Approved by Aditya in chat, 2026-09-14 */
  menuAria:          "Actions for {title}",
  menuStatus:        "Status",
  menuHide:          "Hide",
  menuShow:          "Show",
  menuReply:         "Reply",
  menuDelete:        "Delete",
  menuDeleteConfirm: "Click again to delete",
  tagHidden:         "Hidden",

  /* a ticket (#t=<code>) */
  /* ticket page lines without [ph]: approved by Aditya in chat, 2026-09-14.
     ticketSent is his wording; ticketVersion is his install-box "V{v}" format. */
  ticketBack:            "← Back to DeetsMusic",
  ticketLoading:         "Loading your post…",
  ticketMissing:         "No post matches this link.",
  ticketFailed:          "Couldn't load this post.",
  /* the two kind tags (also on "Your posts"): approved by Aditya in chat, 2026-09-14 */
  ticketKind_issue:      "Bug",
  ticketKind_suggestion: "Suggestion",
  ticketPrivate:         "Private",
  ticketPublic:          "On the board",
  ticketSent:            "Submitted {date}",
  ticketUpdated:         "Updated {date}",
  ticketVersion:         "V{v}",
  ticketVersionAll:      "All versions",
  ticketKeep:            "This link is the only way back to this post.",
  ticketCopy:            "Copy link",
  ticketCopied:          "Link copied.",
  repliesTitle:          "Replies",
  repliesEmpty:          "No replies yet.",
  authorOwner:           "Aditya",
  authorReporter:        "You",
  replyLabel:            "Add a reply",
  replySend:             "Reply",
  replySent:             "Reply sent.",

  /* a public thread (#p=<pid>) — the same page read-only, reached by
     clicking a card on either board. Approved by Aditya in chat, 2026-09-15.
     The thread reuses his ticketMissing, ticketFailed and tagHidden rather
     than saying the same thing twice. */
  threadOpen:            "Open this post",
  threadLoading:         "Loading this post…",   /* ticketLoading says "your" — this one isn't */
  threadShare:           "Anyone with this link can read this post.",
  authorPoster:          "Poster",   /* the byline where #t= says "You" — here it isn't you */

  /* signed-in comments on a public thread. Approved by Aditya in chat,
     2026-09-15; commentSignin is BOTH the resting prompt and the worker's
     401, his call — it is one sentence, so it is one string. */
  commentLabel:          "Add a comment",
  commentSend:           "Comment",
  commentSent:           "Comment sent.",
  commentSignin:         "Sign in to leave a comment.",
  commentSigninGo:       "Sign in",
  err_blocked:           "You can't comment on the boards.",
  err_name:              "Add a name to your profile first.",

  /* owner moderation of a thread row. Approved by Aditya in chat, 2026-09-15.
     menuHide / menuShow / menuDelete / menuDeleteConfirm and tagHidden are
     reused from the post menu. */
  replyMenuAria:         "Actions for {who}'s comment",
  menuBlock:             "Block",
  menuBlockConfirm:      "Click again to block",
  menuUnblock:           "Unblock",
  commentBlocked:        "Blocked",
  err_reply:             "That comment isn't available.",

  /* POLLS (2026-09-15, docs/support.md "Polls"). Approved by Aditya in chat,
     2026-09-15, after a pass that measured every draft against his own lines:
     bare labels take no
     full stop and sentences do ("No suggestions yet."), a failure says what
     happened and what to do ("Keep the title to 10 words."), negatives
     contract and pronouns do not ("isn't", but "That is too long to send"),
     and a person who posted is the "Poster". Four drafts said something he
     had already said and were collapsed into one key, as his threads pass
     did with commentSignin. */
  pollAdd:            "Add a poll",
  pollDrop:           "Remove poll",
  pollOptionPh:       "Option {n}",
  pollAddOption:      "Add an option",   /* the composer's row button AND the reader's */
  pollEditRemove:     "Remove option {n}",
  pollModeLabel:      "Picks",
  pollModeOne:        "One",
  pollModeMany:       "Several",

  /* reading a poll. The counts show from the first look — the animation is
     the vote landing, not a reveal (his call, 2026-09-15). Hints take no full
     stop, the way releasesHint and mineLead do not. */
  pollAria:           "Poll: {question}",
  pollVotes:          "{n} votes",
  pollVotesOne:       "1 vote",
  pollShare:          "{n}%",
  pollMine:           "You picked this",
  pollPickOne:        "Pick one",
  pollPickMany:       "Pick as many as you want",
  pollSignin:         "Sign in to vote.",
  pollOptionPlace:    "Another option",
  pollOptionSend:     "Add",
  /* picking is local; this sends the ballot. Off until there is something
     unsent, so a poll costs one write per mind made up. */
  pollVote:           "Vote",

  /* closed. Closed by its author and closed because the post is are different
     facts, so they are different lines — and only the first can be reopened.
     pollClosed is BOTH the line on the poll and the worker's poll_closed
     refusal, because it is one sentence either way. */
  pollClosed:         "This poll is closed.",
  pollClosedState:    "This poll closed with the post.",
  pollClose:          "Close poll",
  pollReopen:         "Reopen poll",
  pollClosedToast:    "Poll closed.",
  pollReopenedToast:  "Poll reopened.",
  /* the board card's mark: a thread HAS a poll, never how the vote is going */
  tagPoll:            "Poll",
  /* the owner's per-option menu — the price of letting anyone add one.
     menuHide / menuShow are reused from the post menu. */
  pollOptionMenu:     "Actions for this option",
  /* the worker's poll errors (poll_closed reuses pollClosed above) */
  err_poll_options:   "Give the poll 2 to 6 options.",
  err_poll_duplicate: "That option is already on the poll.",
  err_poll_full:      "This poll is full at 6 options.",
  err_poll_fixed:     "Only the poster can add options to this poll.",
  err_one_choice:     "This poll takes one pick.",
  err_options:        "That pick isn't on this poll.",
  err_option_text:    "Add an option first.",
  err_poll:           "That poll isn't available.",
  err_author:         "Only the poster can do that.",

  /* your posts (this browser's list of codes) — the whole box approved by
     Aditya in chat, 2026-09-14; mineLead and mineClose are his dictation */
  mineTitle:  "Your posts",
  mineLead:   "Links saved locally in this browser only",
  mineClose:  "Close",
  mineCloseConfirm: "Click again to close",
  mineCloseAria:    "Close {title}",
  closedToast:      "Closed.",

  /* fine print — the Privacy box, approved by Aditya in chat, 2026-09-14 */
  fineTitle:  "Privacy",
  privacy1:   "Sign-in to Apple Music stays on your PC, and your Apple Music sign-in token never leaves it.",
  privacy2:   "The DeetsMusic server sees nothing about you unless you send a post on this page, and then it sees only what you typed.",
  trademark:  "Apple Music is a trademark of Apple Inc., registered in the U.S. and other countries. DeetsMusic is an independent project. It is not affiliated with, sponsored by, or endorsed by Apple."
};
