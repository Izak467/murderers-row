/* Murderers' Row — scoring balance harness (dev tool, not loaded by the game)
 *
 * Plays N games per era with a greedy "best available player for a position of
 * need" strategy, DH only when it's the last slot open, then reports the score
 * distribution and which scoring axis has saturated.
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
 * then one of:
 *
 *   await mrReport()                     // the 3 MLB-API eras, copy-paste summary
 *   await mrReport(['modern'], 200)      // a single era
 *   await mrReport(null, 200, true)      // all six eras
 *
 * Modern / Juiced / Hardball fetch rosters from the MLB Stats API, so the first
 * pass is slow while it walks team+year combinations. Rosters are cached for
 * the run, so it speeds up substantially after the first ~50 games. Leave the
 * tab focused — background tabs get throttled and the run will crawl.
 */
(function () {
  var POS_PREF = ['C','SS','2B','3B','CF','RF','LF','1B','DH'];
  var AXES = ['woba','hr','rbi','runs','sb'];
  var rosterCache = {};

  function isLahman(era) { return !!(ERA_CONFIG[era] && ERA_CONFIG[era].lahman); }

  function resetGame(era) {
    S.era = era; S.hardMode = false;
    S.lineup = [null,null,null,null,null,null,null,null,null];
    S.recentYears = []; S.recentTeams = []; S.awardData = null; S.round = 0;
  }

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

  // Aggregate exactly as simulate() does, so axis numbers line up with scoring.
  function aggregate(era) {
    var hr=0, rbi=0, runs=0, sb=0, wobaS=0, n=0;
    for (var i = 0; i < 9; i++) {
      var slot = S.lineup[i], st = slot.player.stats;
      var sea = SEASON_AVG[slot.year] || SEASON_AVG[2019];
      var dur = Math.sqrt(Math.min(st.games,162)/162);
      var yw = (typeof WOBA_WEIGHTS !== 'undefined' && WOBA_WEIGHTS[slot.year]) || {};
      var lg = yw.lgWoba || sea.obp;
      wobaS += lg + (playerWOBA(st, slot.year) - lg) * dur;
      hr += era === 'deadball' ? ((st.hr||0)+(st.h2b||0)+(st.h3b||0)) : (st.hr||0);
      rbi += st.rbi||0; runs += st.runs||0; sb += st.sb||0; n++;
    }
    return { woba: wobaS/n, hr: hr, rbi: rbi, runs: runs, sb: sb };
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
    return { wins: simulate().wins, agg: aggregate(era) };
  }

  // One pass collects both the score distribution and the axis data, so
  // nothing has to replay the games twice.
  async function playMany(era, n) {
    var wins = [], aggs = [], t0 = Date.now();
    for (var i = 0; i < n; i++) {
      var r = await playOne(era);
      if (r) { wins.push(r.wins); aggs.push(r.agg); }
      if (i && i % 25 === 0) {
        var per = (Date.now() - t0) / i;
        console.log('  %s %d/%d  (~%ds left)', era, i, n, Math.round(per * (n - i) / 1000));
      }
    }
    return { wins: wins, aggs: aggs, seconds: Math.round((Date.now() - t0) / 1000) };
  }

  function q(sorted, p) {
    var n = sorted.length, k = (n-1)*p, f = Math.floor(k);
    return f+1 >= n ? sorted[f] : sorted[f] + (k-f)*(sorted[f+1]-sorted[f]);
  }

  function scoreStats(wins) {
    var s = wins.slice().sort(function (a,b) { return a-b; }), n = s.length;
    var mean = s.reduce(function (a,b) { return a+b; }, 0) / n;
    var sd = Math.sqrt(s.reduce(function (a,b) { return a+(b-mean)*(b-mean); }, 0) / n);
    return { n: n, mean: +mean.toFixed(1), median: +q(s,.5).toFixed(1), sd: +sd.toFixed(1),
             min: s[0], max: s[n-1], p10: Math.round(q(s,.10)), p90: Math.round(q(s,.90)),
             pct150plus: +(100*s.filter(function(x){return x>=150;}).length/n).toFixed(1),
             pctPerfect: +(100*s.filter(function(x){return x===162;}).length/n).toFixed(2) };
  }

  function axisStats(era, aggs) {
    var SC = ERA_SCORING[era], out = {};
    AXES.forEach(function (a) {
      var v = aggs.map(function (r) { return r[a]; }).sort(function (x,y) { return x-y; });
      var over = 100 * v.filter(function (x) { return x >= SC.CEIL[a]; }).length / v.length;
      out[a] = { weight: SC.W[a], ceil: SC.CEIL[a],
                 typical: +q(v,.5).toFixed(3), p99: +q(v,.99).toFixed(3),
                 pctAtOrOverCeil: +over.toFixed(1), saturated: over >= 20 };
    });
    return out;
  }

  window.mrSim = async function (era, n) {
    var r = await playMany(era, n || 200);
    var st = scoreStats(r.wins);
    console.log('%s  n=%d mean=%s median=%s sd=%s range %d-%d',
                era, st.n, st.mean, st.median, st.sd, st.min, st.max);
    return st;
  };

  window.mrDiagnose = async function (era, n) {
    var r = await playMany(era, n || 200);
    var ax = axisStats(era, r.aggs);
    console.table(ax);
    return ax;
  };

  window.mrSimAll = function (n) { return window.mrReport(null, n, true); };

  // The one to run. Prints a copy-pasteable JSON block at the end.
  window.mrReport = async function (eras, n, all) {
    n = n || 200;
    eras = eras || (all ? Object.keys(ERA_CONFIG) : ['modern','steroid','nostalgia']);
    var out = {};
    for (var i = 0; i < eras.length; i++) {
      var era = eras[i];
      console.log('=== %s (%d games) ===', era, n);
      var r = await playMany(era, n);
      if (!r.wins.length) { console.warn('  no completed games for ' + era); continue; }
      out[era] = { score: scoreStats(r.wins), axes: axisStats(era, r.aggs), seconds: r.seconds };
      var st = out[era].score;
      var sat = AXES.filter(function (a) { return out[era].axes[a].saturated; });
      console.log('  mean=%s median=%s sd=%s range %d-%d | perfect %s%% | saturated: %s',
                  st.mean, st.median, st.sd, st.min, st.max, st.pctPerfect,
                  sat.length ? sat.join(', ') : 'none');
    }
    console.log('\n===== COPY EVERYTHING BELOW =====\n' + JSON.stringify(out) +
                '\n===== COPY EVERYTHING ABOVE =====');
    return out;
  };

  console.log('mr sim harness ready — await mrReport()   (or mrReport(null,200,true) for all six)');
})();
