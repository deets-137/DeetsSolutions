const e=[{version:"1.4.2",date:"2026-11-09",body:`**Choose where Add to Queue puts songs.** A new row in Settings › Playback puts them at the end of
the queue or after the songs you added before. A notice now tells you exactly where they landed,
such as "Added 25 songs in positions #25–49." You can turn the notice off.

**Mouse forward button support.** The forward button on your mouse now takes back what the back
button closed, in the card your pointer is over. Go back two pages, and forward brings back the
same two, at the place you left them. It also reopens a search you closed, an Album Review, a
rule in Rulez, and a card that a Go to Album swapped out. Open something new, and the forward
steps reset.

**Friends' names on their albums.** On Home's Friends on DM shelf, each album now shows the
friend's name in a small pill on its cover, and the line under it is the artist again. When two
friends played the same album, the pill reads "Sam +1"; hover over it to see everyone. A friend
you added by code also shows the name they typed now, not "Friend".

**Your uploaded songs, one album at a time.** Songs you added to Apple Music from your own files
now stay together as one album, their covers no longer go blank after a day, they play with the
Equalizer or Match loudness on, and an album plays through to its last track.

**Rewind remembers your place.** The Rewind card's list comes back where you scrolled it after
the card is swapped out or the app restarts.

**Fixes.** The Discord card's progress bar now shows the right position and length after a song
change, a seek or a resume. Marking an Album Review Done from an AI agent or the command line now
copies the review even while the app is behind another window. The Donate panel no longer shows
an older total when you open it quickly several times. A setting saved with a value the app does
not know now goes back to its default, and your other settings stay as they are. The cover
wallpaper no longer stays empty after a fade.`},{version:"1.4.1",date:"2026-11-06",body:`**Double-click to play.** A click on an album, playlist or artist opens it, and a double-click now
plays it, in the Library, Playlists, Search and artist pages. Change either in Settings > Playback >
Click a collection, and on Home in Settings > Home. Each pin has its own On Click and On Double
Click rows. For one type only, make a rule in Rulez: When You click a playlist, Use Play.

**Play counts on song rows.** Album and playlist song rows now show each song's Last.fm plays in a
small pill. In a grown card, the album's columns show them under Stats. Turn them off in
Settings > Playback > Show play counts from Last.FM.

**Truer Last.fm counts.** Last.fm counts each spelling of a song title apart, so a count now comes
from the song's largest page. To read only the exact title, change Settings > Playback > Count a
song's plays by. An album's count also no longer reads a wrong, tiny number while its page loads.

**Paused music lets your other devices play.** While a song is paused, Apple Music still counts
this PC as playing, so a paused DeetsMusic could stop the music on an iPhone signed in to the same
Apple ID. Now DeetsMusic lets go of Apple after 10 minutes of pause, or a little sooner when Apple
would check in again first. Your song stays in Now Playing at the same spot, and Play starts it
there, about a second slower than usual. Change the wait, or choose Never, in Settings > Playback >
Let go of Apple after a pause.

**A mark on the playing song.** In an album or playlist you play from, a small chevron beside the
song slides down to the next one. Any other list that holds the song shows a short line.

**Album colors on Press and Cyber.** Your card edges now light up in the colors of the album you
are playing. On Press, the plate and the thin card edges glow in the album's main color. On Cyber,
the thin edges take that color and the lightning takes the album's second color. When a new album
starts, its color turns in around each card. Change the strength, or set it to 0, with Album light
in Settings > Skin settings. To change the color at once, with no turn, switch off Spin in new
colors.

**Match loudness in the Sound panel.** A song can be much louder than the one before it. Turn on
Match loudness, under the Equalizer. The first time a song plays, DeetsMusic adjusts its level and
measures it. After that, the song plays at one fixed level. It is off until you turn it on. To
play quieter at night, turn on the Quieter after sunset recipe in Rulez.

**Truer album colors on Ocean and Glass.** A color error gave these album colors a slight pink
tint. Ocean's glow and neon waves, and Glass's Now Playing text, now show the true color.

**Playlists remember their sort.** A playlist now keeps the sort you choose, each playlist its own,
after you leave it and after a restart. Play follows that sort everywhere: from the playlist, the
Playlists card, Home and your pins.

**Album columns in Search.** An album in a grown Search card now shows its songs in columns.

**Donate button in Max.** A dollar sign in the title bar opens the Donate panel: what donations
pay for, and a link to PayPal.

**Title bar buttons rearranged in Max.** The updates and Network buttons moved left of the Compass.
From the left, the order is now the cog, updates, Donate, Network, the Compass, Rewind and the pin.

**Pinned playlists open from Home.** A click on a pinned playlist did nothing while the Playlists
card was off screen. It opens now, and so does a playlist picked in the Compass.

**Compass and toasts with Now Playing on the right.** Ctrl+Space opened out of sight in Max with Now
Playing on the right. The bar now sits beside the card, and toasts move to the top left.

**Compilations on artist pages.** The Full artist page now shows an artist's compilations, and the
filter on the Albums shelf has a Compilations choice.

**Unshuffled from the top.** With shuffle on, an album's Play button starts on a random song. Turn
on this new recipe in Rulez, and pressing Play or clicking the first song turns shuffle off, so the
album plays in order from its first song. Shuffle stays off until you turn it on again. To make
your own rule, use the new When, You start an album from the top.`,intro:`Welcome to 1.4 squad. Look below for the sea of changes, updates, upgrades, and bug fixes. You'll
find about 11 of the 16 changes in this update were a result of listeners like you putting in
feedback. Keep em coming! Everytime you see a feature or bug people complain about AM not having
that we do, shout out DeetsMusic to help grow the community and build a powerhouse ready to
compete with Apple (to get their attention on actual User Experience for Windows). Thanks again
everyone.

I've also added my paypal for a donation link in the toolbar panel, it has a bar tracking how much
we've raised and what each milestone buys us. Would appreciate any 2 cents y'all can provide,
money or enhancements. Absolutely no pressure, the app will stay free forever.

PS for people following: Happy just got surgery yesterday, docs said it went well and I'm so
excited to see him again today. Rooting for the little guy.`,open:["Double-click to play","Play counts on song rows","Paused music lets your other devices play","A mark on the playing song","Album colors on Press and Cyber"]},{version:"1.3.1",date:"2026-11-02",body:`**Flip flip (the side of the Queue and Now Playing).** In Settings > Window, there now exists two
new settings rows. Now Playing and Queue in Max chooses which side the playing card and queue
appear while you have 1/2/4 other cards on screen. Queue in the full player sets which side of
the player the queue falls in while the player is expanded to be fullscreen.

**Mouse back button support.** The back button on your mouse can now be used to go back one step
in the card your pointer is over, like leaving an album you opened for details. It’s the same
step as Escape or the card’s Back arrow.

**Fixes.** The app no longer keeps trying to reconnect to a listening room that ended while it
was closed, asleep or offline.`},{version:"1.3.0",date:"2026-11-01",body:`**Find out What's New.** Each sizable update now starts with a full page of what's changed, the
relevant settings that have been added, and updated defaults. Search through patch notes as
needed and check what's about to go in so you don't get defaults or settings you'd rather not
have. To see after you've closed it, you can always open the update panel (the up/down arrow
icon) and hit "See the new settings" in the What's New section.

**Mark a song or album to Listen Later.** Right-click a song or album and hit Listen Later to
add them to a playlist ("Saved for the Right Day" since not every day is a bedroom pop or a
reggae type of day for me anyway). In Settings > Playlists > Remove from Later, you can choose
what takes the song out of the Later list, if you listened anywhere or if you listened
specifically from the playlist (gone are the days of my 2500 video youtube watch later list).

**DeetsMusic Lists category in Playlists.** The lists the app makes on its own for you, like
"Saved for the Right Day" and "Replay" along with webs, are now grouped together in the
Playlists card. The "Made Here" section is now "Created Here" to be a little more accurate to
your created playlists.

**Reporting errors.** An error notice now has a Report button which opens Settings > Bugs with
the form already filled in: what went wrong and logs (with the songs themselves removed /
de-identified).

**Grouping resolved reports.** In Settings > Bugs > My reports, closed / fixed reports fold
away into a "Resolved" folder so the open ones stay on the top for you to reference.

**Quicker Refreshes for your Library.** Clicking the refresh button now does a quicker check
and adds only songs you added since the last refresh. If you hover the icon, you'll have a
dropdown and an option to do a Full Refresh, removing songs you removed on AM and such. Should
speed up pulling a one or two song addition by almost 15-30 seconds in many instances.`,intro:`Welcome to 1.3 gang. There's a slew of new features and some settings that go with them. Wanted
to highlight the settings so you don't get jump-scared by a feature you didn't know about and
have a chance to turn it off. Hope you enjoy!

PS: Continue leaving feedback! Someone had asked about lyrics, and here's the thing, if I want
to do it right, the best option out there is 200/month but would support ~1000 users which is
tough (still job searching moment). Y'all think it's worth it? Lmk with a suggestion or upvote
one if it exists already!`,open:["Find out What's New","Mark a song or album to Listen Later","DeetsMusic Lists category in Playlists"]},{version:"1.2.1",date:"2026-10-29",body:`**Friends on DM, a new shelf on Home.** When you have friends in DeetsMusic, Home shows the
albums they are playing now, then a line, then up to 10 albums they played lately. With several
friends, they take turns on the shelf. Click an album to play it. Right-click an album a friend
is playing now to Listen Along. Your friends see your last 3 albums only while *Share what I
play* is on. Turn it off, and your albums are deleted from your friends' apps: at once when
they are online, otherwise within 7 days.

**Clear Queue on the Queue's right-click.** Right-click any song in Up Next and pick *Clear
Queue*: the songs you added by hand, or the entire queue. Each choice shows how many songs it
clears. A second click confirms, and Undo puts the songs back. It works in a listening room
too. To start every launch with an empty Up Next, turn on Settings › Playback › *Clear the
queue on launch*.`},{version:"1.2.0",date:"2026-10-27",body:`**Adjust volume by scrolling on the Player!** Roll the mouse wheel anywhere on Now Playing to
turn the volume up or down, 5 % per notch. On a trackpad the volume goes up no faster than 40 %
a second, so a fast swipe never makes the music suddenly loud. Turning it down is never held
back. In Mini and Midi, the small volume bar in the title bar grows while you scroll. It now
grows over the buttons beside it, so the window buttons stay in place. A scroll during the sleep
timer's fade no longer leaves the music at the faded level. Settings › Playback › *Scroll over
the Player for volume* turns it off.

**Filter Singles, EPs and Live on Artist pages.** A small pill at the end of an artist's Albums
shelf shows all releases, or only albums, singles and EPs, or live albums, with a count for
each. Your pick stays the same on the next artist. To make every artist open on All, turn off
Settings › Playback › *Remember Artist filters*.`},{version:"1.1.2",date:"2026-10-26",body:`**Singles, EPs, and Live Albums for Artists.** An artist's Apple Music page now shows their singles, EPs
and live albums in the Albums shelf, the whole list, newest first. A new Appears On shelf at the
bottom shows releases by other artists that they are on.

**A cleaner artist page.** No dark band behind Top Songs, and a thin line between each section.

**Setting to move the title under the cover.** Settings › Window › *Title under the cover* puts the song, artist and
album in a row under the cover in the full player, so nothing sits on the art. Off by default.

**Less intrusive album titles in fullscreen.** In the full player with the controls under the cover, a soft
shade behind the title lines takes the place of the dark band. Settings › Window › *Shade behind
the title* brings the band back.

**Notification for Bug/Suggestion replies.** When Aditya replies to a bug report or a suggestion you sent from
Settings › Bugs, the app tells you. It checks your open reports on its own; *Don't show again*
turns the checks off.

**On your left: Queue can move in fullscreen.** In the full player in Max, point at the gap
beside the Queue and click the bar on its edge: the Queue moves to the other side of the cover,
and stays there. When the side column shows, its edge has the same bar.

**On top: Pin widget to keep your music on screen.** Click the pin in the title bar and pick
what stays above your other windows: the album cover alone, the player, Mini, or the window as
it is. Point at the cover to play, pause or skip, and drag it to move it. Click the pin again to
put the window back the way it was. Settings › Window › *Keep on top* is still there for a
lasting choice.

**Fixes.** In a small Library card, Sort and View keep their names; the Filter button shows as a
funnel only while a filter is on. The full player now resizes when you drag only the window's
height.`},{version:"1.0.0",date:"2026-10-23",body:`**DeetsMusic 1.0.**

**First-time onboarding screen.**

**6 skins | 6 themes.**`}];export{e as default};
