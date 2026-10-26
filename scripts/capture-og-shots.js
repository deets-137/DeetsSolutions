// Screenshots of each site section, for the link-preview cards
// (scripts/build-og-cards.py composes them). No dependencies: it drives the
// Edge that ships with Windows over the DevTools protocol, with Node's own
// WebSocket.
//
//   node scripts/capture-og-shots.js [base-url] [page ...]
//
// base-url defaults to production, so the cards show what a visitor sees (a
// local server would also inject the copy editor and any uncommitted work).
// Every page is captured in the light default look (Glass × Lilac) from a
// fresh profile. Game pages run on ?mock: the script opens a table, seats
// bots and starts the game, so the card shows play rather than an empty lobby.
// Shots land in <tmp>/deets-og-shots/, outside the repo.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('./lib/cdp');   // the headless Edge (docs/tooling.md, "Headless")

const BASE = (process.argv[2] && process.argv[2].startsWith('http'))
  ? process.argv[2].replace(/\/$/, '') : 'https://deets.solutions';
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('http'));
const OUT = path.join(os.tmpdir(), 'deets-og-shots');
const PROFILE = path.join(os.tmpdir(), 'deets-og-edge');
const PORT = 9333;
const W = 1440, H = 720;

// In-page setup for a ?mock game: open a table, sit, add bots, start.
const PLAY_GAME = (bots, settle) => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const input = $('.gt-code__input');
  input.value = 'og';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(800);
  const name = $('.gt-gate__name-input');
  if (name) { name.value = 'Deets'; name.dispatchEvent(new Event('input', { bubbles: true })); }
  $('.gt-gate__go').click();
  await wait(1200);
  // Count seated bots from the lobby itself: a click can land mid-render and
  // do nothing, so retry until the table has them.
  const botCount = () => [...document.querySelectorAll('.gt-seat')].filter((s) => /\\(bot\\)/.test(s.textContent)).length;
  for (let i = 0; i < ${bots} * 3 && botCount() < ${bots}; i++) {
    const add = [...document.querySelectorAll('.gt-seat__addbot')].find((b) => !b.disabled && b.textContent.trim() !== 'Sit here');
    if (!add) break;
    add.click(); await wait(600);
    const go = $('.gt-seat__addgo'); if (go) go.click();
    await wait(1200);
  }
  const added = botCount();
  // The first .gt-lobby__start is Start (the second is Shuffle); it can take a
  // broadcast or two to enable, so poll.
  let started = false;
  for (let t = 0; t < 20 && !started; t++) {
    const start = $('.gt-lobby__start');
    if (start && !start.disabled) { start.click(); started = true; } else await wait(250);
  }
  if (!started) return 'bots ' + added + ', start never enabled: ' +
    [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim() + (b.disabled ? '(off)' : '')).join(' | ');
  // Let the bots play. Mahjong opens on a roll for seats that waits on us.
  for (let t = 0; t < ${settle}; t += 700) {
    const roll = [...document.querySelectorAll('button')].find((b) => b.offsetParent && !b.disabled && b.textContent.trim() === 'Roll');
    if (roll) roll.click();
    await wait(700);
  }
  return 'bots ' + added + ', started ' + started;
})()`;

// Radio on ?mock: tune in to a station, so the card shows a room.
const TUNE_RADIO = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const input = document.querySelector('[data-radio-who]');
  input.value = 'deets';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(1200);
  const go = document.querySelector('[data-radio-gate] button:not([disabled])');
  if (go) go.click();
  await wait(5000);
  return 'gate button ' + !!go;
})()`;

const PAGES = {
  home:         { path: '/' },
  'cool-stuff': { path: '/cool-stuff/' },
  resume:       { path: '/resume/' },
  sotd:         { path: '/sotd/' },
  movies:       { path: '/movies/', settle: 7000 },
  league:       { path: '/league/', settle: 6000 },
  radio:        { path: '/radio/?mock', run: TUNE_RADIO },
  cities:       { path: '/cities/?mock', run: PLAY_GAME(2, 9000) },
  mahjong:      { path: '/mahjong/?mock', run: PLAY_GAME(3, 9000) },
  poker:        { path: '/poker/?mock', run: PLAY_GAME(4, 9000) },
  tanks:        { path: '/tanks/?mock', run: PLAY_GAME(0, 5000) },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch({ width: W, height: H, port: PORT, profile: PROFILE, scheme: 'light' });

  try {
    const cdp = await browser.first();

    const names = ONLY.length ? ONLY : Object.keys(PAGES);
    for (const name of names) {
      const page = PAGES[name];
      if (!page) { console.error(`unknown page: ${name}`); continue; }
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: BASE + page.path });
      await loaded;
      await wait(page.settle || 3000);
      if (page.run) {
        const r = await cdp.send('Runtime.evaluate', { expression: page.run, awaitPromise: true });
        if (r.result && r.result.value) console.log(`  ${name}: ${r.result.value}`);
        if (r.exceptionDetails) console.error(`${name}: setup failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      }
      // The card adds its own Deets and Happy, so hide the page's walkers;
      // and undo any scroll a focused input caused.
      await cdp.send('Runtime.evaluate', { expression: `
        document.head.insertAdjacentHTML('beforeend', '<style>.walker{display:none!important}</style>');
        if (document.activeElement) document.activeElement.blur();
        window.scrollTo(0, 0);` });
      // Wait out the on-screen images (posters, album art) and their fade-in.
      await cdp.send('Runtime.evaluate', { awaitPromise: true, expression: `(async () => {
        for (let t = 0; t < 40; t++) {
          const imgs = [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width; });
          if (imgs.every((i) => i.complete)) break;
          await new Promise((r) => setTimeout(r, 250));
        }
      })()` });
      await wait(1500);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(`${name} → ${file}`);
    }
    cdp.close();
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
