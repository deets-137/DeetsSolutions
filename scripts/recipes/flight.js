// A mahjong discard, and the draw that follows it, frame by frame: the
// stepped clock is frozen the instant the discard's flying copy appears,
// then stepped `every` ms at a time with a screenshot each step, until the
// table is quiet. Writes the frames, the flight log (each copy's centre,
// size and transform per 10 ms) and a contact sheet (sheet.html) to `out`.
//
// The beat between a landing and the next flight is a page timer, which
// runs in real time; the recipe pauses for it between steps, so the next
// flight starts a step or two later in clock time than it would live.
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  about: 'mahjong: my discard (and the next draw) frame by frame, with a contact sheet',
  args: {
    tile: '"drawn" (default) or a hand index to discard', every: 'ms between frames (default 40)',
    ms: 'longest run (default 1500)', sel: 'what each frame shows (default .mj-bento)', code: 'table code',
  },
  url: '/mahjong/?mock',
  async run({ tab, args, log, out }) {
    const every = Number(args.every) || 40, max = Number(args.ms) || 1500, sel = args.sel || '.mj-bento';
    const code = args.code || 'f' + Math.random().toString(36).slice(2, 7);
    await tab.cmd('table', { code, bots: 3, start: 1, autoroll: 1, timeout: 60000 });
    await tab.cmd('turn', { timeout: 90000 });
    log('my turn at', code);
    const pick = args.tile && args.tile !== 'drawn'
      ? `document.querySelectorAll(".mj-racktile:not(.mj-racktile--drawn)")[${Number(args.tile)}]`
      : 'document.querySelector(".mj-racktile--drawn")';
    const before = await tab.shot({ sel, pad: 4, out: path.join(out, 'before.png') });
    await tab.cmd('fly/log', { sel: '.mj-fly' });
    const hit = await tab.cmd('trap', { sel: '.mj-fly', do: `${pick}.click()`, timeout: 15000 });
    if (!hit.hit) throw new Error('the discard never flew (is the tab driving a ?mock table at its turn?)');
    const frames = [{ t: 'before', file: before.file }];
    let t = 0, quiet = 0, flown = 0, first = true;
    while (t <= max) {
      const step = await tab.cmd('clock/step', { ms: first ? 0 : every, by: 10 });
      first = false;
      t = step.t;
      const s = await tab.eval('({ fly: document.querySelectorAll(".mj-fly").length, pending: document.querySelectorAll(".mj .is-pending").length })');
      if (s.fly) flown++;
      const f = await tab.shot({ sel, pad: 4, out: path.join(out, `t${String(t).padStart(4, '0')}.png`) });
      frames.push({ t, file: f.file, flying: s.fly, pending: s.pending });
      if (!s.fly && !s.pending) { if (++quiet >= 3 && flown) break; await sleep(120); }   // a beat's real-time timer
      else quiet = 0;
    }
    const flight = await tab.cmd('fly/log', { stop: 1 });
    await tab.cmd('clock/thaw');
    fs.writeFileSync(path.join(out, 'flight-log.json'), JSON.stringify(flight.log, null, 1));
    fs.writeFileSync(path.join(out, 'sheet.html'), sheet(frames, code));
    log(frames.length, 'frames');
    return { code, frames: frames.length, sheet: path.join(out, 'sheet.html'), logSteps: flight.steps, pageErrors: (await tab.cmd('errors')).errors };
  },
};

function sheet(frames, code) {
  const cells = frames.map((f) => `<figure><img src="${path.basename(f.file)}" loading="lazy">` +
    `<figcaption>${f.t === 'before' ? 'before' : f.t + ' ms'}${f.flying ? ` · ${f.flying} in flight` : ''}${f.pending ? ` · ${f.pending} waiting` : ''}</figcaption></figure>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Flight ${code}</title>
<style>body{margin:0;padding:16px;background:#111;color:#ddd;font:13px system-ui}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}
figure{margin:0}img{width:100%;display:block}figcaption{padding:4px 0;font-family:monospace}</style>
<h1>Flight ${code}</h1><main>${cells}</main>`;
}
