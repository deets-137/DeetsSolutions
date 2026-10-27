// Real-time play at the live bot pace, my seat discarding as it comes round
// (the drawn tile and a hand tile in turn, so the rack's slide runs too),
// claims passed. Whenever the page is idle the board must match the mock
// table: hand counts, backs, pond, wall. A mismatch counts only if it lasts
// past `grace` ms: a broadcast is ~110 ms behind the mock's own state, so a
// one-sample miss is the probe racing the wire, not a bug.
//
// The check reads mahjong's DOM; another game needs its own probe.
const PROBE = `(function () {
  var x = Object.values(MahjongTransport.tables()).find(function (t) { return t.code === location.hash.slice(1); });
  var G = x && x.game;
  if (!G || G.phase !== "play" || G.handOver) return { over: true };
  var want = G.players.map(function (p, i) { return p.hand.length + (G.turn && G.turn.seat === i && G.turn.drawn != null ? 1 : 0); });
  var me = x.conns.filter(function (c) { return !c.closed && c.seat != null; })[0];
  var seat = me ? me.seat : null;
  var count = function (s) { return document.querySelectorAll(s).length; };
  var wall = (document.querySelector(".mj-wallpanel__count") || {}).textContent || "";
  var counts = Array.prototype.map.call(document.querySelectorAll(".mj-pstrip__cards"), function (n) { return parseInt(n.textContent, 10); });
  var backs = want.map(function (_, i) { return i === seat ? null : count('.mj-zone[data-zone="' + i + '"] .mj-zone__backs > .mj-tilef'); });
  var bad = [], seen = {};
  var pondN = count("[data-mj-pond] .mj-tilef");
  if (pondN !== G.pond.length) { bad.push("pond"); seen.pond = pondN + " shown, " + G.pond.length + " in the table"; }
  if (wall.indexOf(String(G.wall.length)) < 0) { bad.push("wall"); seen.wall = wall + " shown, " + G.wall.length + " in the table"; }
  if (counts.join() !== want.join()) { bad.push("counts"); seen.counts = counts + " shown, " + want + " in the table"; }
  backs.forEach(function (b, i) { if (b != null && b !== want[i]) { bad.push("backs@" + i); seen["backs@" + i] = b + " shown, " + want[i] + " in the table"; } });
  if (bad.length) seen.context = { claims: G.claims ? { from: G.claims.from, can: Object.keys(G.claims.can || {}) } : null, turn: G.turn && G.turn.seat,
    melds: G.players.map(function (p) { return p.melds.length; }), log: [].slice.call(document.querySelectorAll(".mj-log__list > *"), -3).map(function (n) { return n.textContent; }) };
  return { bad: bad, seen: seen, idle: !document.querySelector(".mj-fly") && !document.querySelector(".mj .is-pending"),
    mine: !!(me && G.turn && G.turn.seat === seat && G.turn.drawn != null && !G.claims),
    claim: !!(G.claims && !G.claims.robbing && (G.claims.ask || []).indexOf(seat) >= 0 && !(G.claims.responses || {})[seat]) };
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  about: 'mahjong: real-time play at the live bot pace, board checked against the table',
  args: { secs: 'how long (default 40)', pace: 'bot step ms (default 700, the worker\'s)', grace: 'ms a mismatch may last (default 400)' },
  url: '/mahjong/?mock',
  async run({ tab, args, log }) {
    const secs = Number(args.secs) || 40, grace = Number(args.grace) || 400;
    const code = 's' + Math.random().toString(36).slice(2, 7);
    await tab.cmd('table', { code, bots: 3, start: 1, autoroll: 1, timeout: 60000 });
    await tab.cmd('pace', { ms: Number(args.pace) || 700 });
    await tab.cmd('errors', { clear: 1 });
    const end = Date.now() + secs * 1000, open = new Map(), bugs = [];
    let samples = 0, idleSamples = 0, mine = 0, passes = 0, alt = 0, over = false;
    while (Date.now() < end) {
      const p = await tab.eval(PROBE);
      samples++;
      if (p.over) { over = true; break; }
      if (p.claim) { await tab.eval('document.querySelector(".mj-claimbox button:last-child") && [...document.querySelectorAll(".mj-claimbox button")].find(b => /pass/i.test(b.textContent))?.click()'); passes++; }
      // a mismatch counts only while it holds across back-to-back idle
      // samples: any movement (a flight, a new broadcast) starts it over
      if (!p.idle) open.clear();
      if (p.idle) {
        idleSamples++;
        const now = Date.now();
        for (const k of [...open.keys()]) if (!p.bad.includes(k)) open.delete(k);
        for (const k of p.bad) {
          if (!open.has(k)) open.set(k, now);
          else if (now - open.get(k) > grace && !bugs.some((b) => b.what === k)) {
            bugs.push({ what: k, seen: p.seen[k], context: p.seen.context, at: Math.round((now - end) / 1000 + secs) + 's' });
          }
        }
        if (p.mine) {
          const which = alt++ % 2 ? 'document.querySelectorAll(".mj-racktile:not(.mj-racktile--drawn)")[2]' : 'document.querySelector(".mj-racktile--drawn")';
          // the probe and the click are two round trips apart: the tile may be gone
          if (await tab.eval(`(function () { var b = ${which}; if (b) b.click(); return !!b; })()`)) mine++;
          await sleep(150);
        }
      }
      await sleep(40);
    }
    await tab.cmd('pace', { hold: 1 });
    const errors = (await tab.cmd('errors')).errors;
    log(`${samples} samples, ${mine} of my discards, ${bugs.length} lasting mismatches`);
    return { code, secs, samples, idleSamples, myDiscards: mine, passes, handEnded: over, mismatches: bugs, pageErrors: errors };
  },
};
