/* DeetsMusic page — UI copy (docs/support.md, "The page").

   EVERY user-facing string on the DeetsMusic page lives in this one flat
   object; deetsmusic.js holds no copy of its own. Aditya leads this page's
   design and writes its words. Claude may ADD a string when wiring up new
   UI, but every Claude-authored value must be prefixed "[ph]" — a
   placeholder Aditya rewrites, deleting the prefix as he goes. Claude never
   edits an un-prefixed (handwritten) value, and nothing still carrying
   "[ph]" may ship.

   State of his pass: NOT STARTED. The whole file is Claude's first draft
   (2026-09-14). A few lines lean on his existing DeetsMusic wording (the
   README's trademark notice and privacy section, the release notes'
   Installing steps) — still [ph] here, because reusing them is his call.

   {curly} tokens are filled by deetsmusic.js — keep a token if you keep
   the fact it carries; drop it freely otherwise. */
window.DM_STRINGS = {
  /* page bar + meta */
  tagline:     "[ph] An Apple Music player for Windows 11. Download it, see whether it is up, read what changed, and tell me what is broken.",
  ctaDownload: "[ph] Download {v}",
  ctaReport:   "[ph] Report a bug",
  mockBadge:   "[ph] Mock data",
  noticeLabel: "[ph] Notice",

  /* install */
  installName:    "[ph] DeetsMusic for Windows",
  installLoading: "[ph] Looking for the latest version…",
  installVersion: "[ph] Version {v} · {date}",
  installSize:    "[ph] {mb} MB installer",
  installButton:  "[ph] Download for Windows",
  installNone:    "[ph] No installer is up right now. Check back soon.",
  installFailed:  "[ph] Couldn't reach the download server.",
  installNeeds:   "[ph] Windows 11 and an Apple Music subscription.",
  installSmartScreen: "[ph] Windows SmartScreen warns you, because the installer is not code-signed yet. Click More info, then Run anyway.",

  /* status */
  statusTitle:        "[ph] Status",
  status_up:          "[ph] Up",
  status_degraded:    "[ph] Degraded",
  status_down:        "[ph] Down",
  status_unknown:     "[ph] Checking",
  status_unmonitored: "[ph] Not monitored",
  statusLine:         "[ph] {pct}% of checks passed in the last {hours} hours. Last checked {ago}.",
  statusEmpty:        "[ph] No checks have run yet.",
  statusUnmonitored:  "[ph] Nothing is checking this yet.",
  statusFailed:       "[ph] Couldn't load the status.",
  statusScope:        "[ph] DeetsMusic runs on your PC, so this checks what it depends on: the server that hands out its access key and its updates. An outage on Apple's side does not show here.",
  statusCellOk:       "[ph] {time} · OK · {ms} ms",
  statusCellBad:      "[ph] {time} · Failed · {note}",
  stripOld:           "[ph] 6 hours ago",
  stripNow:           "[ph] Now",
  agoNow:             "[ph] just now",
  agoMin:             "[ph] {n} min ago",
  agoHour:            "[ph] {n} h ago",

  /* release notes */
  releasesTitle:      "[ph] Release notes",
  releasesLead:       "[ph] Every version, newest first.",
  releasesLoading:    "[ph] Loading release notes…",
  releasesFailed:     "[ph] Release notes aren't available right now.",
  releasesEmpty:      "[ph] No releases yet.",
  tagLatest:          "[ph] Latest",
  tagWithdrawn:       "[ph] Withdrawn",
  tagNotesOnly:       "[ph] Notes only",
  relDownload:        "[ph] Download {v} ({mb} MB)",
  relWithdrawnReason: "[ph] Withdrawn: {reason}",
  relWithdrawn:       "[ph] This version was withdrawn, so it has no download.",
  relHistory:         "[ph] This version came out before the updater, so it has no download here.",
  relNoNotes:         "[ph] No notes for this version.",

  /* boards */
  suggestTitle: "[ph] Suggestions",
  suggestLead:  "[ph] Ideas for DeetsMusic. Add yours, or show interest in one that is already here.",
  suggestOpen:  "[ph] Suggest something",
  suggestEmpty: "[ph] No suggestions yet.",
  interestHint: "[ph] Interest is a signal, not a vote.",
  issuesTitle:  "[ph] Known issues",
  issuesLead:   "[ph] Bugs that people have reported, and what is happening with each one.",
  issuesOpen:   "[ph] Report a bug",
  issuesEmpty:  "[ph] No known issues.",
  boardLoading: "[ph] Loading…",
  boardFailed:  "[ph] Couldn't load this list.",
  postMore:     "[ph] More",
  postLess:     "[ph] Less",
  interestLabel: "[ph] Show interest",
  interestDone:  "[ph] You showed interest",
  interestAria:  "[ph] Show interest in this suggestion, {n} so far",

  state_new:     "[ph] New",
  state_open:    "[ph] Open",
  state_planned: "[ph] Planned",
  state_fixed:   "[ph] Fixed",
  state_wontfix: "[ph] Won't fix",

  /* the post form (both boards) */
  formTitleLabel:     "[ph] Title",
  formTitleIssuePh:   "[ph] What went wrong, in a few words",
  formTitleSuggestPh: "[ph] What you want, in a few words",
  formBodyLabel:      "[ph] Details",
  formBodyIssuePh:    "[ph] What you did, what you expected, and what happened instead.",
  formBodySuggestPh:  "[ph] What it would do, and when you would use it.",
  formVersionLabel:   "[ph] DeetsMusic version (Settings › About)",
  formVersionPh:      "[ph] 0.4.3",
  formCount:          "[ph] {n} / {max}",
  formNote:           "[ph] Posts are anonymous. Nothing shows on this page until I have read it. You get a private link to your post; keep it, because there is no other way back to it.",
  formLogNote:        "[ph] If you paste part of the app log (Settings › Bugs › App log), keep it short. Never paste a sign-in token.",
  formSend:           "[ph] Send",
  formSending:        "[ph] Sending…",
  formCancel:         "[ph] Cancel",
  sentToast:          "[ph] Sent. This page is your private link to it.",

  /* errors (keys are the worker's error codes) */
  err_rate:              "[ph] Too many posts at once. Wait a minute and try again.",
  err_slow_down:         "[ph] Too many requests at once. Wait a minute and try again.",
  err_too_large:         "[ph] That is too long to send.",
  err_credential_shaped: "[ph] That looks like it contains a sign-in token. Remove it and try again.",
  err_title:             "[ph] Add a title (up to 120 characters).",
  err_body:              "[ph] Add some details (up to 4000 characters).",
  err_ticket:            "[ph] That post isn't available.",
  err_off:               "[ph] This is switched off for now.",
  err_network:           "[ph] Couldn't reach the server. Try again soon.",
  err_generic:           "[ph] Something went wrong. Try again soon.",

  /* a ticket (#t=<code>) */
  ticketBack:            "[ph] ← Back to DeetsMusic",
  ticketLoading:         "[ph] Loading your post…",
  ticketMissing:         "[ph] No post matches this link.",
  ticketFailed:          "[ph] Couldn't load this post.",
  ticketKind_issue:      "[ph] Bug",
  ticketKind_suggestion: "[ph] Suggestion",
  ticketPrivate:         "[ph] Private",
  ticketPublic:          "[ph] On the board",
  ticketSent:            "[ph] Sent {date}",
  ticketUpdated:         "[ph] Updated {date}",
  ticketVersion:         "[ph] Version {v}",
  ticketKeep:            "[ph] This link is the only way back to this post. Bookmark it, or copy it somewhere safe.",
  ticketCopy:            "[ph] Copy link",
  ticketCopied:          "[ph] Link copied.",
  repliesTitle:          "[ph] Replies",
  repliesEmpty:          "[ph] No replies yet.",
  authorOwner:           "[ph] Aditya",
  authorReporter:        "[ph] You",
  replyLabel:            "[ph] Add a reply",
  replySend:             "[ph] Reply",
  replySent:             "[ph] Reply sent.",

  /* your posts (this browser's list of codes) */
  mineTitle:  "[ph] Your posts",
  mineLead:   "[ph] Saved in this browser only.",
  mineForget: "[ph] Forget",
  mineForgetAria: "[ph] Remove {title} from this list",

  /* fine print */
  fineTitle:  "[ph] Privacy",
  privacy1:   "[ph] Sign-in to Apple Music stays on your PC, and your Apple Music sign-in token never leaves it.",
  privacy2:   "[ph] The DeetsMusic server sees nothing about you unless you send a post on this page, and then it sees only what you typed.",
  trademark:  "[ph] Apple Music is a trademark of Apple Inc., registered in the U.S. and other countries. DeetsMusic is an independent project. It is not affiliated with, sponsored by, or endorsed by Apple."
};
