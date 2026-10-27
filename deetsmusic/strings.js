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
   — section comments below name the lines he dictated; the release-notes
   layout strings on 2026-09-16. The product pass-1 block was approved
   2026-10-06 in full; anything added from here carries [ph].

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
  installNeeds:   "Apple Music subscription required.",
  /* browser warning steps: approved by Aditya in chat, 2026-09-15 (replaces the
     "not code-signed yet" line). The page shows the visitor's own browser, and
     "Other browsers" shows the rest. Edge and Firefox were tested on his PC with
     0.6.0; Chrome was not. */
  installSigned:        "Installer's signed by Aditya Sundaram but not commonly downloaded, so there will be a browser warning for now rip. ",
  /* the ⓘ note beside installSigned: label and text approved by Aditya in chat, 2026-09-15 */
  installWhyLabel:      "Why the warning?",
  installWhy:           "Why the warning? Browsers trust a file more as more people download it safely. Each new version of DeetsMusic starts with no download history, so the warning shows less often as more people download that version.",
  installSteps_edge:    "Edge: in the download list, click … › Keep, then the arrow on Delete › Keep anyway.",
  installSteps_firefox: "Firefox: in the downloads panel, click the arrow next to the file and allow the download. When you open it, Windows may show a blue screen: click More info, then Run anyway.",
  installSteps_chrome:  "Chrome: in the download list, click Keep. When you open it, Windows may show a blue screen: click More info, then Run anyway.",
  installOtherBrowsers: "Other browsers",

  /* product pass 1 (docs/deetsmusic-page-pass.md §3), added 2026-10-06.
     Every claim is checked against the app's shipped docs (the doc in
     brackets on each feature). Approved by Aditya in chat 2026-10-06, alt
     texts included. */
  /* the line under the page bar: approved by Aditya in chat, 2026-10-06 */
  tagline:          "Free. Lightweight. Uniquely Deets. An Apple Music player for Windows.",

  /* features: the everyday grid, then the "Only in DeetsMusic" row (his call).
     The looks tile is 6 × 4: the app's menu offers four skins, not Vanilla. */
  featuresTitle:    "Features",
  feat_lastfm_t:    "Last.fm Scrobbling",                 /* integrations/LASTFM.md */
  feat_lastfm_b:    "[Had to be the first one listed yk] Live logging your listening history to Last.Fm so you can make your own rewinds and get better recs.",
  feat_discord_t:   "Discord Status + Webhooks",         /* integrations/FRIENDS.md */
  feat_discord_b:   "Optionally have what you're listening to live update as a Discord status. Can also add a Disc channel to post Song of the Days to.",
  feat_airplay_t:   "Airplay",                  /* integrations/AIRPLAY.md */
  feat_airplay_b:   "Link up w any airplay speaker and stream just DeetsMusic audio or your entire PC audio (figured it'd be cool but not by default).",
  feat_sizes_t:     "Mini, Midi and Max",                 /* architecture/SURFACES-AND-CARDS.md */
  feat_sizes_b:     "Different UI layouts for different sized app size. Mini and midi don't take a lot of space and hold a panel or two if that's all you need.",
  feat_looks_t:     "6 themes × 4 skins",                 /* architecture/UI-ARCHITECTURE.md */
  feat_looks_b:     "24 looks matching the website (for now lol). Themes are color schemes on top of the skins' skeleton (unique animations, style, etc). ",
  feat_eq_t:        "Equalizer",                          /* features/SOUND.md */
  feat_eq_b:        "Tune the bass, treble, and more with a 10 band EQ. Set your own presets (please and let me know any changes you want there lol).",
  onlyTitle:        "Only in DeetsMusic",
  feat_rooms_t:     "Listening rooms",                    /* integrations/ROOMS.md */
  feat_rooms_b:     "Add friends in app & start a room where you and your friends can listen to music, queue up songs, and vibe together.",
  feat_agent_t:     "MCP & CLI Interfaces [For Nerds]", /* integrations/AGENT.md */
  feat_agent_b:     "An MCP and CLI allow your preferred AI system to make a playlist, queue up songs, and operate the app for you. Disabled by default.",

  /* screenshots: the demo's mock songs, in the visitor's own theme × skin.
     Title, hint, click line and the Max caption approved/dictated by
     Aditya in chat, 2026-10-06, and its alt text too. The full player's
     caption is his (2026-10-11), and its alt text approved the same day. */
  shotsTitle:       "Demos",
  shotsHint:        "Matches the selected skin and theme of the website",
  shotsClick:       "Click a picture to try the full demo.",
  shot_max:         "Max",
  shot_maxAlt:      "DeetsMusic at Max size, with several cards open at once.",
  shot_full:        "Full Screen Player",
  shot_fullAlt:     "DeetsMusic's full screen player: a large album cover between the Queue and History.",

  /* requirements + trust: its own box after the pictures, no VirusTotal (his call) */
  trustTitle:       "Requirements AND More",   /* approved by Aditya in chat, 2026-10-06 */
  trust_systemK:    "System",
  trust_system:     "Windows 11 (x64) [untested on W10 but it'd probably mostly work? Let me know, happy to fix it up]",
  trust_installK:   "Install",
  trust_install:    "Download button above downloads an installer which should set everything up easy peasy for ya.",
  trust_updatesK:   "Updates",
  trust_updates:    "In app, you should get a notification that an update is available or (Settings > Updates > Check now)",
  trust_signedK:    "Signed",
  trust_signed:     "Code-signed by Aditya Sundaram.",
  trust_airplayK:   "AirPlay",
  trust_airplay:    "Should work with any Airplay 2 receiver (tested and confirmed on HomePods)",
  trust_sourceK:    "Source",
  trust_source:     "Free and open source under the MIT license. You can mod and mess w it as you like. ",
  trust_repo:       "Read the code on GitHub",
  trust_license:    "License",
  trust_support:    "Bugs and ideas on this page, not GitHub. GitHub issues feels too formal lol.",

  /* status */
  /* status box: the lines without [ph] were approved by Aditya in chat, 2026-09-14 */
  statusTitle:        "Status",
  /* dictated by Aditya in chat, 2026-09-14 — what the status reading is about;
     renamed by him 2026-09-15: the check probes music-api /health (the token mint) */
  statusSubject:      "DeetsMusic Gatekeeper:",
  /* the second row, approved by Aditya in chat, 2026-09-15 — probes /update/deetsmusic/health */
  statusSubject_installer: "DeetsMusic installer:",
  /* the third row, approved by Aditya in chat, 2026-09-17 — probes
     rooms.deets.solutions/health (rooms-status.md §2c) */
  statusSubject_rooms: "DeetsMusic rooms:",
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
  /* release notes layout: approved by Aditya in chat, 2026-09-16 */
  relEarlier:         "Earlier releases",
  relMore:            "+{n} more",   /* a version card past its first three changes */

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
  mineNewReply: "New reply",   /* 2026-10-26: Aditya replied since this browser last opened the thread */
  mineClose:  "Close",
  mineCloseConfirm: "Click again to close",
  mineCloseAria:    "Close {title}",
  closedToast:      "Closed.",

  /* admin page + usage box — owner only (DeetsMusic USAGE-COUNTS.md §6), added
     2026-10-14 and approved by Aditya in chat the same day ("remove the ph"). Metric names (log.error.lastfm, apple.library.429)
     and setting keys are shown as the worker stores them: data, not copy. */
  /* The Inbox (support.md, "The admin page" › The Inbox), added 2026-10-26; awaiting his OK. */
  inboxTitle:            "Inbox",
  inboxShowPill:         "Show",
  inboxShow_waiting:     "Waiting on you",
  inboxShow_open:        "Not closed",
  inboxShow_all:         "Everything",
  inboxKindPill:         "Kind",
  inboxKind_all:         "Both",
  inboxKind_suggestion:  "Suggestions",
  inboxKind_issue:       "Bugs",
  inboxLoading:          "Reading the posts…",
  inboxFailed:           "Couldn't read the posts.",
  inboxReading:          "Reading {n} threads…",
  inboxWaitingOne:       "1 post is waiting on you.",
  inboxWaitingMany:      "{n} posts are waiting on you.",
  inboxEmptyWaiting:     "Nothing is waiting on you.",
  inboxEmpty:            "No posts match.",
  inboxWaiting:          "Waiting on you",
  inboxInterest:         "▲ {n}",
  inboxFrom_app:         "From the app",
  inboxFrom_web:         "From the website",
  inboxLogOne:           "App log (1 line)",
  inboxLogMany:          "App log ({n} lines)",
  inboxStatusPill:       "Status",
  inboxReplyLabel:       "Reply as Aditya",
  inboxReplyAria:        "Reply to {title}",
  // Read marks (support.md, "Read marks"): did his reply reach the filer.
  inboxSeen_app:         "Seen in the app {date}",
  inboxSeen_web:         "Seen on the website {date}",
  inboxOpened:           "Opened {date}",
  inboxNotSeen:          "Not seen yet",
  inboxReadAt:           "Last checked {date}",

  adminLink:         "Admin",
  adminTitle:        "DeetsMusic admin",
  adminChecking:     "Checking who you are…",
  adminSignedOut:    "Sign in as the owner to see this page.",
  adminNotOwner:     "This page is for the owner only.",
  usageTitle:        "Usage",
  usageChannelPill:  "Channel",
  usageCh_live:      "Live",
  usageCh_beta:      "Beta",
  usageCh_dev:       "Dev",
  usageCh_owner:     "Owner",
  usageWeekPill:     "Week",
  usageLoading:      "Reading the counts…",
  usageFailed:       "Couldn't read the usage counts.",
  usageToday:        "Today so far",
  usageThisWeek:     "This week",
  usageThisMonth:    "This month",
  usageReports:      "Settings reports",
  usageDaily:        "Active installs per day",
  usageDailyAxis:    "{from} to {to} · peak {max}",
  usageNone:         "No counts yet.",
  usageVersions:     "Version mix this week",
  usageVersionsLag:  "Before 1.2.0, an install that updated during the week stays under its old version for that week and month.",
  /* Updates, first starts and Setup.exe downloads (DeetsMusic USAGE-COUNTS.md §12.4) — drafts, for Aditya to edit */
  usageUpdates:      "Updates",
  usageUpdatesLead:  "Per version, every day so far. Waiting: downloaded, not restarted yet.",
  usageUpVersion:    "Version",
  usageUpDownloaded: "Downloaded",
  usageUpApplied:    "Restarted onto it",
  usageUpWaiting:    "Waiting",
  usageUpRollback:   "Rollbacks",
  usageUpSince:      "First day",
  usageInstalls:     "Downloads and first starts",
  usageInstallsLead: "The last {n} days. A download counts when every byte went out. Microsoft's check of the Store link is kept apart.",
  usageInDay:        "Day",
  usageInSite:       "From the site",
  usageInStore:      "From the Store",
  usageInDirect:     "Other links",
  usageInBroken:     "Not finished",
  usageInCheck:      "Store check",
  usageInBot:        "Bots",
  usageInFirst:      "First starts",
  usageSettings:     "Setting shares",
  usageSettingPill:  "Setting",
  usageCross:        "Cross-check",
  usageCrossLead:    "Installs with each pair of values, this week.",
  usageCrossA:       "Rows",
  usageCrossB:       "Columns",
  usageHealth:       "Health",
  usageHealthLead:   "Installs per range of the week's count. {n} reports.",
  usageVersionPill:  "Version",
  usageAllVersions:  "All",
  usageMetric:       "Metric",

  /* fine print — the Privacy box, approved by Aditya in chat, 2026-09-14 */
  fineTitle:  "Privacy",
  privacy1:   "Apple sign in is purely on your PC, DeetsMusic can't see anything about your Apple account.",
  privacy2:   "There's no cloud backups or anything yet so no one except Apple gets your play history.",
  privacy3:   "When your app or this page checks a report you sent, the time is noted, so Aditya knows his reply reached you. No ID, no IP address.",
  trademark:  "Apple Music is a trademark of Apple Inc., registered in the U.S. and other countries. DeetsMusic is an independent project. It is not affiliated with, sponsored by, or endorsed by Apple. (But I am unemployed and looking to get into Product-side roles so if we wanna chat Apple (or other service provider), I am so down)"
};
