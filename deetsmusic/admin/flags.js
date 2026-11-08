/* The "Needs a look" rules, shared (DeetsMusic docs/ops/LIVE-MCP.md §3.5, his call L7).
   One source for the admin page (this file, loaded by index.html) and the DeetsMusicAdminMCP
   worker (a copy made by its `npm run flags`, never edited by hand; its check fails when the
   two differ). Pure: no DOM, no fetch, no clock but the `now` it is given. The page turns each
   flag into words (strings.js `flag*`); the worker into its own lines.

   Plain ES5 on purpose: the page has no build step. */
var DeetsFlags = (function () {
  "use strict";

  // The thresholds. Drafts for his edit (2026-10-27); a change here moves both the page and the MCP.
  var FLAG = {
    rollback: 0.01, rollbackMin: 50,              // rollbacks per restart onto the newest version
    healthRatio: 1.5, healthGap: 0.01, healthMin: 50,   // a trouble metric against the version before
    freezes: 0.02,                                // panics flag at any count
    finish: 0.8, finishMin: 20,                   // site + Store downloads finished, 7 days
    drop: 0.15,                                   // mean daily active, last 7 whole days vs the 7 before
    waitDays: 3,                                  // a post waiting on him
    newErrMin: 1,                                 // installs with a new error kind on the newest version
    silent: 0.2, silentMin: 20,                   // installs at 0 minutes on their last day, newest version, 7 days
  };
  var DONE = { fixed: 1, wontfix: 1, closed: 1 };
  var HEALTH_WEEKS = 8;                           // the weeks of health reports the check reads

  function cmpVersionDesc(a, b) {
    var pa = a.split("."), pb = b.split(".");
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var d = (parseInt(pb[i], 10) || 0) - (parseInt(pa[i], 10) || 0);
      if (d) return d;
    }
    return a < b ? 1 : a > b ? -1 : 0;
  }

  /* Waiting on him: an open post with no reply from him yet, or one where the poster
     wrote after his last reply. A member's comment is talk among visitors, not a
     question to him, so it neither opens nor closes the wait. A hidden row counts for
     nothing. A thread not read yet (`thread` null) is not called waiting. */
  function isWaiting(post, thread) {
    if (DONE[post.state] || !thread) return false;
    var lastOwner = -1, lastPoster = -1;
    thread.forEach(function (r, i) {
      if (r.hidden) return;
      if (r.author === "owner") lastOwner = i;
      else if (r.author === "reporter") lastPoster = i;
    });
    return lastOwner < 0 || lastPoster > lastOwner;
  }
  // When the poster last spoke: their last shown reply, else the post itself.
  function waitSince(post, thread) {
    return (thread || []).reduce(function (m, r) {
      return !r.hidden && r.author === "reporter" ? Math.max(m, r.created_at) : m;
    }, post.created_at);
  }

  // ── Days and ISO weeks (UTC): "2026-11-07", "2026-W45" ──
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dayOf(d) { return d.toISOString().slice(0, 10); }
  function dayAgo(i, now) {
    return dayOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)));
  }
  function daysSince(unix, now) { return Math.floor((now.getTime() / 1000 - unix) / 86400); }
  function weekMonday(w) {
    var m = /^(\d{4})-W(\d{2})$/.exec(w || "");
    if (!m) return null;
    var jan4 = Date.UTC(+m[1], 0, 4), dow = (new Date(jan4).getUTCDay() + 6) % 7;
    return new Date(jan4 - dow * 864e5 + (+m[2] - 1) * 7 * 864e5);
  }
  function isoWeekOf(d) {
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() - (t.getUTCDay() + 6) % 7 + 3);   // the week's Thursday names its year
    var y = t.getUTCFullYear();
    return y + "-W" + pad2(1 + Math.floor((t - Date.UTC(y, 0, 4)) / 864e5 / 7 + ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7) / 7));
  }
  function weekShift(w, k) {
    var m = weekMonday(w);
    return m ? isoWeekOf(new Date(m.getTime() + k * 7 * 864e5)) : w;
  }

  // ── The health reports ──
  /* The week's health per version: its reports, and per metric the reports that counted it
     above 0 (a metric is stored only above 0, so every row but `reports` is one). */
  function healthStats(rows) {
    var rep = {}, above = {};
    (rows || []).forEach(function (r) {
      if (r.metric === "reports") { rep[r.v] = (rep[r.v] || 0) + r.n; return; }
      var m = above[r.metric] = above[r.metric] || {};
      m[r.v] = (m[r.v] || 0) + r.n;
    });
    return { versions: Object.keys(rep).sort(cmpVersionDesc), reports: rep, above: above };
  }
  function isTrouble(metric) { return !/\.2xx$/.test(metric); }
  /* Error kinds (DeetsMusic USAGE-COUNTS.md §16): `err.<how>.<type>@<place>`. */
  function parseFp(metric) {
    var fp = metric.slice(4), at = fp.indexOf("@");
    if (at < 0) return null;
    var head = fp.slice(0, at), dot = head.indexOf(".");
    return { how: head.slice(0, dot), type: head.slice(dot + 1), place: fp.slice(at + 1).replace("<", " ← ") };
  }
  /* The weeks in `hw` ([{ week, rows }], newest first) that hold at least one report. */
  function reportWeeks(hw) {
    return (hw || []).filter(function (x) {
      return (x.rows || []).some(function (r) { return r.metric === "reports" && r.n > 0; });
    }).map(function (x) { return x.week; });
  }
  // Is `metric` in any week of `hw` before `week`, or (with `notV`) on another version?
  function seenBefore(hw, metric, week, notV) {
    return (hw || []).some(function (x) {
      return (x.rows || []).some(function (r) {
        return r.metric === metric && (x.week < week || (notV && x.week === week && r.v !== notV));
      });
    });
  }

  // ── The day counters and the minutes ──
  /* Updates (USAGE-COUNTS.md §12.4): per version, every day summed. Waiting = downloaded but
     not restarted onto it yet (an update applies at the next start). */
  function updatesByVersion(events) {
    var by = {};
    (events || []).forEach(function (r) {
      if (r.metric !== "update.downloaded" && r.metric !== "update.applied") return;
      var x = by[r.v] = by[r.v] || { downloaded: 0, applied: 0, rollback: 0, since: r.period, days: {} };
      if (r.metric === "update.downloaded") x.downloaded += r.n;
      else { x.applied += r.n; x.days[r.period] = (x.days[r.period] || 0) + r.n; }
      if (r.bucket === "rollback" && r.metric === "update.applied") x.rollback += r.n;
      if (r.period < x.since) x.since = r.period;
    });
    return by;
  }
  // The day counters in `events`, from `from` to `to` days ago (0 = today), where test(row) holds.
  function eventSum(events, test, from, to, now) {
    var lo = dayAgo(to, now), hi = dayAgo(from, now);
    return (events || []).reduce(function (n, r) {
      return r.period >= lo && r.period <= hi && test(r) ? n + r.n : n;
    }, 0);
  }
  function sumActive(active, period) {
    return (active || []).reduce(function (n, r) { return r.period === period ? n + r.n : n; }, 0);
  }
  /* The count, average, median and the rows at 0 of [[minutes, n], …]; null when empty. */
  function listenStats(list) {
    var n = 0, sum = 0, zero = 0;
    list.forEach(function (p) { n += p[1]; sum += p[0] * p[1]; if (!p[0]) zero += p[1]; });
    if (!n) return null;
    var sorted = list.slice().sort(function (a, b) { return a[0] - b[0]; });
    var at = function (k) {                                    // the k-th row's minutes, 0-based
      for (var i = 0, seen = 0; i < sorted.length; i++) { seen += sorted[i][1]; if (k < seen) return sorted[i][0]; }
      return sorted[sorted.length - 1][0];
    };
    return { n: n, mean: sum / n, sum: sum, median: (at(Math.floor((n - 1) / 2)) + at(Math.ceil((n - 1) / 2))) / 2, zero: zero };
  }
  /* The last 7 whole days by version (the 0-minute flag reads it). */
  function listenByVersion(listen, now) {
    var lo = dayAgo(7, now), hi = dayAgo(1, now), by = {};
    (listen || []).forEach(function (r) {
      if (r.day < lo || r.day > hi) return;
      (by[r.v] = by[r.v] || []).push([r.minutes, r.n]);
    });
    return by;
  }

  /* The flags. `d`: { events, active, listen } as the worker's /admin/usage sends them (null
     while not read), `hw` the health weeks ([{ week, rows }], newest first), `hweek` the week
     health reads (the newest with reports unless the page picked one), `posts` with `threads`
     (code → replies, or missing while not read), `now` a Date.
     Each flag: { kind, tone ('stop' | 'pause'), ... its numbers }. Raw numbers only: the
     reader words them. `cells` and `releases` mark what the page's Releases tab outlines. */
  function compute(input) {
    var out = [], cells = {}, rel = {};
    var d = input.data, now = input.now, hw = input.hw || [], hweek = input.hweek;
    if (d) {
      var ups = updatesByVersion(d.events), uv = Object.keys(ups).sort(cmpVersionDesc)[0];
      if (uv && ups[uv].applied >= FLAG.rollbackMin && ups[uv].rollback / ups[uv].applied > FLAG.rollback) {
        var u = ups[uv];
        out.push({ kind: "rollback", tone: "stop", v: uv, share: u.rollback / u.applied, n: u.rollback, of: u.applied });
        rel[uv] = 1;
      }
      var wk = hw.filter(function (x) { return x.week === hweek; })[0];
      var h = healthStats(wk && wk.rows), hv = h.versions[0], pv = h.versions[1];
      var share = function (m, v) { return h.reports[v] ? ((h.above[m] || {})[v] || 0) / h.reports[v] : 0; };
      if (hv) {
        var panics = (h.above.panics || {})[hv] || 0;
        if (panics) {
          out.push({ kind: "panics", tone: "stop", v: hv, n: panics, week: hweek });
          cells["panics|" + hv] = 1;
        }
        if (share("freezes", hv) > FLAG.freezes) {
          out.push({ kind: "freezes", tone: "pause", v: hv, share: share("freezes", hv), week: hweek });
          cells["freezes|" + hv] = 1;
        }
        // An error kind on the newest version that no other version and no earlier week has.
        Object.keys(h.above).sort().forEach(function (m) {
          var n = (h.above[m] || {})[hv] || 0, p = m.indexOf("err.") === 0 && parseFp(m);
          if (!p || n < FLAG.newErrMin || seenBefore(hw, m, hweek, hv)) return;
          out.push({ kind: "newErr", tone: "pause", v: hv, metric: m, what: p.type, where: p.place, n: n, week: hweek });
          cells[m + "|" + hv] = 1;
        });
        if (pv && h.reports[hv] >= FLAG.healthMin && h.reports[pv] >= FLAG.healthMin) {
          Object.keys(h.above).sort().forEach(function (m) {
            if (!isTrouble(m) || m === "panics" || m === "freezes" || cells[m + "|" + hv]) return;
            var a = share(m, hv), b = share(m, pv);
            if (a > b * FLAG.healthRatio && a - b >= FLAG.healthGap) {
              out.push({ kind: "health", tone: "pause", v: hv, metric: m, share: a, prevShare: b, pv: pv, week: hweek });
              cells[m + "|" + hv] = 1;
            }
          });
        }
      }
      var people = function (metric) {
        return function (r) { return r.metric === metric && (r.bucket === "site" || r.bucket === "store"); };
      };
      var st = eventSum(d.events, people("setup.start"), 0, 6, now), dn = eventSum(d.events, people("setup.done"), 0, 6, now);
      if (st >= FLAG.finishMin && dn / st < FLAG.finish) {
        out.push({ kind: "finish", tone: "pause", share: dn / st, n: dn, of: st });
      }
      // Whole days only: today is never whole, and neither is this week.
      var mean = function (a, b) { var t = 0; for (var k = a; k <= b; k++) t += sumActive(d.active, dayAgo(k, now)); return t / (b - a + 1); };
      var now7 = mean(1, 7), prev7 = mean(8, 14);
      if (prev7 && (prev7 - now7) / prev7 > FLAG.drop) {
        out.push({ kind: "drop", tone: "pause", share: (prev7 - now7) / prev7, now: now7, prev: prev7 });
      }
      // The minutes (USAGE-COUNTS.md §17): an install that opens and plays nothing points to
      // broken playback. The newest version with enough rows in the last 7 days.
      var lv = listenByVersion(d.listen, now), lnew = Object.keys(lv).sort(cmpVersionDesc)[0], lst = lnew && listenStats(lv[lnew]);
      if (lst && lst.n >= FLAG.silentMin && lst.zero / lst.n > FLAG.silent) {
        out.push({ kind: "silent", tone: "pause", v: lnew, share: lst.zero / lst.n, n: lst.zero, of: lst.n });
      }
    }
    var threads = input.threads || {};
    (input.posts || []).forEach(function (p) {
      var t = threads[p.code];
      if (!isWaiting(p, t)) return;
      var days = daysSince(waitSince(p, t), now);
      if (days > FLAG.waitDays) out.push({ kind: "waiting", tone: "pause", post: p, days: days });
    });
    out.sort(function (a, b) { return (a.tone === "stop" ? 0 : 1) - (b.tone === "stop" ? 0 : 1); });
    return { list: out, cells: cells, releases: rel };
  }

  return {
    FLAG: FLAG, DONE: DONE, HEALTH_WEEKS: HEALTH_WEEKS,
    cmpVersionDesc: cmpVersionDesc, isWaiting: isWaiting, waitSince: waitSince,
    dayOf: dayOf, dayAgo: dayAgo, daysSince: daysSince, weekMonday: weekMonday, isoWeekOf: isoWeekOf, weekShift: weekShift,
    healthStats: healthStats, isTrouble: isTrouble, parseFp: parseFp, reportWeeks: reportWeeks, seenBefore: seenBefore,
    updatesByVersion: updatesByVersion, eventSum: eventSum, sumActive: sumActive,
    listenStats: listenStats, listenByVersion: listenByVersion,
    compute: compute,
  };
})();
