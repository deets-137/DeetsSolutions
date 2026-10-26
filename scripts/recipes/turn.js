// A seated mock table, played to this seat's turn, with a screenshot of it.
// The starting point for anything that needs "my move" on screen.
module.exports = {
  about: 'seat a mock table with bots and play to my turn; screenshot the board',
  args: { game: 'which game (default mahjong)', code: 'table code (default random)', bots: 'bots to seat (default 3)', sel: 'what to screenshot (default the bento)' },
  url: (a) => `/${a.game || 'mahjong'}/?mock`,
  async run({ tab, args, log }) {
    const code = args.code || 'r' + Math.random().toString(36).slice(2, 7);
    const t0 = Date.now();
    await tab.cmd('table', { code, bots: args.bots || 3, start: 1, autoroll: 1, timeout: 60000 });
    log('seated at', code);
    const turn = await tab.cmd('turn', { timeout: 90000 });
    log('my turn after', Date.now() - t0, 'ms');
    const shot = await tab.shot({ sel: args.sel || '.mj-bento, .gt-bento, main', pad: 8 });
    const errors = await tab.cmd('errors');
    return { code, ms: Date.now() - t0, turn, shot: shot.file, pageErrors: errors.errors };
  },
};
