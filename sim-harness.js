/* Murderers' Row — scoring balance harness (dev tool, not loaded by the game)
 *
 * Plays N games per era with a greedy "best available player for a position of
 * need" strategy, DH only when it's the last slot open, then reports the score
 * distribution and which scoring axis is saturated.
 *
 * It drives the game's own doSpin selection rules, eligibleSlotsFor and
 * simulate(), so results reflect real scoring rather than a reimplementation.
 *
 * USAGE — on murderers-row.net, open the browser console and run:
 *
 *   var s=document.createElement('script');
 *   s.src='/sim-harness.js';
 *   document.head.appendChild(s);
 *
 * then:
 *
 *   await mrSim('modern', 200)        // one era
 *   await mrSimAll(200)               // all six, prints a comparison table
 *   await mrDiagnose('modern', 200)   // per-axis saturation report
 *
 * Modern / Juiced / Hardball fetch rosters from the MLB Stats API, so those
 * need network and take a while on the first pass; rosters are cached per
 * team+year for the run.
 */
(function () {
  var POS_PREF = ['C','SS','2B','3B','CF','RF','LF','1B','DH'];
  var rosterCache = {};

  function resetGame(era) {
    S.era = era; S.hardMode = false;
    S.lineup = [null,null,null,null,null,null,null,null,null];
    S.recentYears = []; S.recentTeams = []; S.awardData = null; S.round = 0;
  }

  function isLahman(era) { return !!(ERA_CONFIG[era] && ERA_CONFIG[era].lahman); }

  // Mirrors doSpin's year/team selection, minus the animation.
  function spin(era) {
    var cfg = ERA_CONFIG[era];
    var pool = cfg.yearPool.filter(function (y) { return S.recentYears.indexOf(y) === -1; });
    var year = pick(pool.length ? pool : cfg.yearPool);
    var teams = isLahman(era) ? getLahmanTeams(year) : getValidTeams(year);
    if (!teams || !teams.length) return false;
    var tp = teams.filter(function (t) { return S.recentTeams.indexOf(t.id) === -1; });
    var team = pick(tp.length ? tp : teams);
    S.recentYears.push(year); if (S.recentYears.length > 3) S.recentYears.shift();
    S.recentTeams.push(team.id); if (S.recentTeams.length > 3) S.recentTeams.shift();
    S.spin = { year: year, teamId: team.id, teamName: team.name || '' };
    return true;
  }

  function getRoster(era, year, teamId) {
    var key = era + '|' + year + '|' + teamId;
    if (rosterCache[key]) return Promise.resolve(rosterCache[key]);
    var p = isLahman(era) ? fetchRosterLahman(year, teamId) : fetchRoster(teamId, year);
    return p.then(function (r) { rosterCache[key] = r || []; return rosterCache[key]; })
            .catch(function () { rosterCache[key] = []; return []; });
  }

  // Place a player where they're hardest to replace; DH is last by construction.
  function slotFor(player) {
    var open = eligibleSlotsFor(player).available;
    if (!open.length) return -1;
    for (var r = 0; r < POS_PREF.length; r++)
      for (var i = 0; i < open.length; i++)
        if (POS[open[i]] === POS_PREF[r]) return open[i];
    return open[0];
  }

  // Greedy on the game's own simulate(): whichever placement scores highest.
  function bestPick(roster, picked) {
    var best = null, bestW = -Infinity, bestSlot = -1;
    for (var i = 0; i < roster.length; i++) {
      var p = roster[i];
      if (picked[p.id]) continue;
      var slot = slotFor(p);
      if (slot === -1) continue;
      S.lineup[slot] = { player: p, year: S.spin.year, teamName: S.spin.teamName, awards: {} };
      var w = simulate().wins;
      S.lineup[slot] = null;
      if (w > bestW) { bestW = w; best = p; bestSlot = slot; }
    }
    return best ? { player: best, slot: bestSlot } : null;
  }

  async function playOne(era) {
    resetGame(era);
    var picked = {};
    for (var round = 0; round < 9; round++) {
      var choice = null, tries = 0;
      while (!choice && tries < 25) {
        tries++;
        if (!spin(era)) continue;
        var roster = await getRoster(era, S.spin.year, S.spin.teamId);
        if (!roster.length) continue;
        choice = bestPick(roster, picked);
      }
      if (!choice) return null;
      S.lineup[choice.slot] = { player: choice.player, year: S.spin.year,
                                teamName: S.spin.teamName, awards: {} };
      picked[choice.player.id] = true;
    }
    return simulate().wins;
  }

  function stats(w) {
    var s = w.slice().sort(function (a, b) { return a - b; }), n = s.length;
    function q(p) { var k = (n-1)*p, f = Math.floor(k);
      return f+1 >= n ? s[f] : s[f] + (k-f)*(s[f+1]-s[f]); }
    var mean = s.reduce(function (a, b) { return a + b; }, 0) / n;
    var sd = Math.sqrt(s.reduce(function (a, b) { return a + (b-mean)*(b-mean); }, 0) / n);
    return { n: n, mean: mean, median: q(.5), sd: sd, min: s[0], max: s[n-1],
             p10: q(.10), p90: q(.90) };
  }

  window.mrSim = async function (era, n) {
    n = n || 200;
    var wins = [];
    for (var i = 0; i < n; i++) {
      var w = await playOne(era);
      if (w != null) wins.push(w);
      if (i % 25 === 0) console.log(era, i + '/' + n);
    }
    var st = stats(wins);
    console.log('%s  n=%d  mean=%s  median=%s  sd=%s  range %d-%d',
      era, st.n, st.mean.toFixed(1), st.median.toFixed(1), st.sd.toFixed(1), st.min, st.max);
    return st;
  };

  window.mrSimAll = async function (n) {
    n = n || 200;
    var out = {};
    var eras = Object.keys(ERA_CONFIG);
    for (var i = 0; i < eras.length; i++) out[eras[i]] = await window.mrSim(eras[i], n);
    console.table(out);
    return out;
  };

  // Which axis is saturated? An axis most lineups already exceed has stopped
  // discriminating, and with wOBA at 50% weight that alone can float an era.
  window.mrDiagnose = async function (era, n) {
    n = n || 200;
    var SC = ERA_SCORING[era], rows = [];
    for (var g = 0; g < n; g++) {
      if (await playOne(era) == null) continue;
      var hr=0, rbi=0, runs=0, sb=0, wobaS=0, cnt=0;
      for (var i = 0; i < 9; i++) {
        var slot = S.lineup[i], st = slot.player.stats;
        var sea = SEASON_AVG[slot.year] || SEASON_AVG[2019];
        var dur = Math.sqrt(Math.min(st.games,162)/162);
        var yw = (typeof WOBA_WEIGHTS !== 'undefined' && WOBA_WEIGHTS[slot.year]) || {};
        var lg = yw.lgWoba || sea.obp;
        wobaS += lg + (playerWOBA(st, slot.year) - lg) * dur;
        hr += era === 'deadball' ? ((st.hr||0)+(st.h2b||0)+(st.h3b||0)) : (st.hr||0);
        rbi += st.rbi||0; runs += st.runs||0; sb += st.sb||0; cnt++;
      }
      rows.push({ woba: wobaS/cnt, hr: hr, rbi: rbi, runs: runs, sb: sb });
    }
    var report = {};
    ['woba','hr','rbi','runs','sb'].forEach(function (a) {
      var v = rows.map(function (r) { return r[a]; }).sort(function (x, y) { return x - y; });
      function q(p) { var k=(v.length-1)*p, f=Math.floor(k);
        return f+1>=v.length ? v[f] : v[f]+(k-f)*(v[f+1]-v[f]); }
      var over = 100 * v.filter(function (x) { return x >= SC.CEIL[a]; }).length / v.length;
      report[a] = { weight: SC.W[a], ceil: SC.CEIL[a], p50: +q(.5).toFixed(3),
                    p99: +q(.99).toFixed(3), pctAtOrOverCeil: +over.toFixed(1),
                    saturated: over >= 20 };
    });
    console.table(report);
    return report;
  };

  console.log('mr sim harness ready — mrSim(era,n) | mrSimAll(n) | mrDiagnose(era,n)');
})();
