/* DeetsRadio — YouTube Data API key (docs/youtube.md, "The platform
   reality"). The dev-token idiom: committed on purpose, referrer-locked
   in the Google Cloud console to deets.solutions + the localhost dev
   ports, quota-capped (10k units/day; a search costs 100). It only
   powers the AUTO-RESOLVER (Topic-channel search) — playback is the
   keyless IFrame API and never touches this. While this is null the
   resolver quietly sits out; playback of already-matched entries, the
   match desk (oEmbed is keyless), and MATCHED search-box pastes (the
   keyless oEmbed fallback, build log chunk 8) still work — only
   auto-resolve and YT-only adds are down.

   PARKED FOR LAUNCH (2026-07-15): the quota is one shared 10k-unit/day
   pool across every visitor, and the D1 registry isn't created yet, so
   nothing amortizes — a public push with the key live could exhaust the
   day in one afternoon. Re-enable once the registry lands by restoring
   the key from the Google Cloud console (or this file's git history). */
window.RADIO_YT_KEY = null;
