// Is a turn smooth? Plays to my turn, then traces the main thread while my
// discard and the next draw fly (perf: frames, the slow ones and what filled
// them). The flights run on the compositor, so the work to find is the
// renders a broadcast or a landing causes, and whether one blows a frame.
module.exports = {
  about: 'mahjong: trace the main thread through one turn (my discard + the next draw)',
  args: { tile: '"drawn" (default) or a hand index', ms: 'how long to trace after the tap (default 1200)', budget: 'a slow frame, in ms of main-thread work (default 12)' },
  url: '/mahjong/?mock',
  async run({ tab, args, log }) {
    const code = 'p' + Math.random().toString(36).slice(2, 7);
    await tab.cmd('table', { code, bots: 3, start: 1, autoroll: 1, timeout: 60000 });
    await tab.cmd('turn', { timeout: 90000 });
    await tab.cmd('pace', { ms: 700 });   // the next bot moves at the worker's step, as live
    const pick = args.tile && args.tile !== 'drawn'
      ? `document.querySelectorAll(".mj-racktile:not(.mj-racktile--drawn)")[${Number(args.tile)}]`
      : 'document.querySelector(".mj-racktile--drawn")';
    log('tracing the turn at', code);
    const perf = await tab.cmd('perf', { js: `${pick}.click()`, ms: Number(args.ms) || 1200, budget: args.budget || 12 });
    await tab.cmd('pace', { hold: 1 });
    return { code, ...perf, pageErrors: (await tab.cmd('errors')).errors };
  },
};
