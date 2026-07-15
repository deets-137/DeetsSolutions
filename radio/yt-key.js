/* DeetsRadio — YouTube Data API key (docs/youtube.md, "The platform
   reality"). The dev-token idiom: committed on purpose, referrer-locked
   in the Google Cloud console to deets.solutions + the localhost dev
   ports, quota-capped (10k units/day; a search costs 100). It only
   powers the AUTO-RESOLVER (Topic-channel search) — playback is the
   keyless IFrame API and never touches this. While this is null the
   resolver quietly sits out; playback of already-matched entries and
   the match desk (oEmbed is keyless) still work. */
window.RADIO_YT_KEY = "REMOVED-RETIRED-KEY";
