#!/usr/bin/env python3
"""
Build negro_data.js for Murderers' Row from the SABR Lahman Database v2025.

Source: SABR Lahman Baseball Database, Version 2025 (CC BY-SA 3.0).
Negro Leagues statistics within it are licensed from Seamheads.com and follow
SABR's Negro Leagues Task Force (2021) and Special Committee (2024)
recommendations for major league status.

Two facts from the Lahman readme drive the shape of this script:

  * Player-level stats are recorded against ALL opponents, while the Teams
    table's games are league-only. Team games therefore UNDERCOUNT relative to
    player games and cannot be used as a season length. We derive season length
    from the player data itself instead.

  * NULL means "unknown", not zero. The statistical recovery is ongoing, so a
    player with few recorded games may simply be one whose box scores have not
    been found. That is why the playing-time threshold below is a fraction of
    each team-season's own documented schedule rather than a flat number --
    a flat cut would silently punish the least-recovered teams.
"""
import csv, json, sys, collections, datetime

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'negro_data.js'

# The seven leagues SABR/MLB recognize as major, 1920-1948. WWII years are kept:
# unlike the white majors, Negro League baseball ran through the war, and 1943-45
# includes some of the best-documented seasons in the record (Gibson's 1943).
NEL_LEAGUES = {'NNL', 'ECL', 'ANL', 'EWL', 'NSL', 'NN2', 'NAL'}
MIN_SEASON_FRAC = 0.40   # of the team-season's best-documented games
MIN_AB          = 20
MIN_ROSTER      = 6      # drop team-seasons too thin to draft from
POS_SKIP        = {'P', 'PH', 'PR'}


def n(v, d=0):
    """NULL/blank means unknown. Callers decide what unknown should become."""
    if v in ('', 'NA', 'NULL', None):
        return d
    try:
        return int(v)
    except ValueError:
        return d


def read(name):
    with open(f'{SRC}/{name}', encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


# ── source tables ────────────────────────────────────────────────────────────
teams_tbl = {(r['yearID'], r['teamID']): r
             for r in read('Teams.csv') if r['lgID'] in NEL_LEAGUES}

people = {}
for r in read('People.csv'):
    nm = ' '.join(x for x in (r.get('nameFirst'), r.get('nameLast')) if x).strip()
    people[r['playerID']] = (nm or r['playerID'], (r.get('bats') or '').strip())

batting = collections.defaultdict(list)
for r in read('Batting.csv'):
    key = (r['yearID'], r['teamID'])
    if key in teams_tbl and r['lgID'] in NEL_LEAGUES:
        batting[key].append(r)

fielding = collections.defaultdict(lambda: collections.defaultdict(int))
for r in read('Fielding.csv'):
    key = (r['yearID'], r['teamID'])
    if key in teams_tbl and r['lgID'] in NEL_LEAGUES and r['POS'] not in POS_SKIP:
        fielding[(r['playerID'],) + key][r['POS']] += n(r['G'])

# MLB linear weights for the same season. The weights move slowly and track the
# run environment of the decade; what must NOT be borrowed is league-average
# wOBA, which we compute from Negro Leagues play below.
weights = {}
with open('woba_weights.js', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if line[:4].isdigit() and ':' in line:
            yr = int(line.split(':', 1)[0])
            body = line.split('{', 1)[1].rsplit('}', 1)[0]
            weights[yr] = {k.strip(): float(v) for k, v in
                           (p.split(':') for p in body.split(','))}

# ── build ────────────────────────────────────────────────────────────────────
data      = collections.defaultdict(dict)
lg_totals = collections.defaultdict(lambda: collections.Counter())
dropped   = []

for (year, tid), trow in sorted(teams_tbl.items()):
    rows = batting.get((year, tid), [])
    if not rows:
        continue
    season_g = max(n(r['G']) for r in rows)      # the team's documented schedule
    if season_g <= 0:
        continue

    players = []
    for r in rows:
        g, ab = n(r['G']), n(r['AB'])
        if g < MIN_SEASON_FRAC * season_g or ab < MIN_AB:
            continue
        h, d2, t3, hr = n(r['H']), n(r['2B']), n(r['3B']), n(r['HR'])
        bb, hbp, sf   = n(r['BB']), n(r['HBP']), n(r['SF'])
        h1b = h - d2 - t3 - hr
        if h1b < 0:
            continue
        pa = ab + bb + hbp + sf
        if not pa:
            continue

        pos = [p for p, pg in sorted(fielding[(r['playerID'], year, tid)].items(),
                                     key=lambda kv: -kv[1])
               if pg >= max(3, 0.20 * g)]
        pos.append('DH')          # every qualifying regular can DH

        name, bats = people.get(r['playerID'], (r['playerID'], ''))
        tb = h1b + 2 * d2 + 3 * t3 + 4 * hr
        players.append({
            'id': r['playerID'], 'name': name, 'bats': bats, 'positions': pos,
            'g': g, 'ab': ab, 'r': n(r['R']), 'hr': hr, 'rbi': n(r['RBI']),
            'sb': n(r['SB']), 'bb': bb, 'h1b': h1b, 'h2b': d2, 'h3b': t3,
            'hbp': hbp, 'sf': sf,
            'avg': round(h / ab, 3) if ab else 0,
            'obp': round((h + bb + hbp) / pa, 3),
            'slg': round(tb / ab, 3) if ab else 0,
            'ops': round((h + bb + hbp) / pa + (tb / ab if ab else 0), 3),
        })

        t = lg_totals[int(year)]
        t['bb'] += bb; t['hbp'] += hbp; t['h1b'] += h1b; t['h2b'] += d2
        t['h3b'] += t3; t['hr'] += hr; t['pa'] += pa
        t['ab'] += ab; t['h'] += h; t['tb'] += tb

    if len(players) < MIN_ROSTER:
        dropped.append(f'{year} {tid} ({len(players)})')
        continue
    players.sort(key=lambda p: -p['ops'])
    data[int(year)][tid] = {'name': trow['name'], 'abbr': tid,
                            'seasonG': season_g, 'players': players}

# League-average wOBA and slash line per Negro Leagues season -- this is the
# denominator that makes wOBA+ era-neutral, and it must come from this league.
season_woba, season_avg = {}, {}
for yr, t in sorted(lg_totals.items()):
    c = weights.get(yr) or weights[min(weights, key=lambda w: abs(w - yr))]
    num = (c['bb'] * t['bb'] + c['hbp'] * t['hbp'] + c['h1b'] * t['h1b'] +
           c['h2b'] * t['h2b'] + c['h3b'] * t['h3b'] + c['hr'] * t['hr'])
    season_woba[yr] = {**{k: c[k] for k in ('bb', 'hbp', 'h1b', 'h2b', 'h3b', 'hr')},
                       'lgWoba': round(num / t['pa'], 3)}
    season_avg[yr] = {'avg': round(t['h'] / t['ab'], 3),
                      'obp': round((t['h'] + t['bb'] + t['hbp']) / t['pa'], 3),
                      'slg': round(t['tb'] / t['ab'], 3)}


def jsobj(o, ind):
    return json.dumps(o, separators=(',', ':'), ensure_ascii=False)


with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
    f.write(f"""// Negro Leagues data for Murderers' Row -- generated {datetime.date.today()}
// by preprocess_negro.py. Do not hand-edit.
//
// Source: SABR Lahman Baseball Database, Version 2025, whose Negro Leagues
// statistics are licensed from Seamheads.com and follow the recommendations of
// SABR's Negro Leagues Task Force (2021) and Negro Leagues and Teams Special
// Committee (2024). Covers the seven leagues recognized as major, 1920-1948.
//
// The Lahman Database is (c) 1996-2025 SABR, licensed CC BY-SA 3.0
// <http://creativecommons.org/licenses/by-sa/3.0/>. This derived file is
// distributed under the same license.
//
// The recovery of Negro Leagues statistics is ongoing and these numbers will
// change as more box scores are found. Records here are league play plus games
// against other major-league-caliber Black teams; exhibitions and Cuban league
// play are excluded.
//
// seasonG is the team-season's best-documented games played -- the closest
// thing to a schedule length these records support, and the denominator for
// both durability and the 162-game display scaling.

var NEGRO_DATA = {{\n""")
    for yr in sorted(data):
        f.write(f'  {yr}: {{\n')
        for tid, t in sorted(data[yr].items()):
            f.write(f'    "{tid}": {{name:{json.dumps(t["name"])},abbr:"{t["abbr"]}",'
                    f'seasonG:{t["seasonG"]},players:[\n')
            for p in t['players']:
                f.write('      ' + jsobj(p, 6) + ',\n')
            f.write('    ]},\n')
        f.write('  },\n')
    f.write('};\n\n')
    f.write('// League-average wOBA per Negro Leagues season (linear weights are the\n'
            '// same-year FanGraphs values; lgWoba is computed from Negro Leagues play).\n')
    f.write('var NEGRO_WOBA = {\n')
    for yr in sorted(season_woba):
        f.write(f'  {yr}: {jsobj(season_woba[yr], 2)},\n')
    f.write('};\n\n')
    f.write('var NEGRO_SEASON_AVG = {\n')
    for yr in sorted(season_avg):
        f.write(f'  {yr}: {jsobj(season_avg[yr], 2)},\n')
    f.write('};\n')

tot = sum(len(t['players']) for y in data.values() for t in y.values())
nteams = sum(len(y) for y in data.values())
print(f'years        {min(data)}-{max(data)} ({len(data)})')
print(f'team-seasons {nteams}')
print(f'players      {tot}  (avg {tot/nteams:.1f} per team-season)')
print(f'dropped      {len(dropped)} thin team-seasons')
print(f'lgWoba range {min(v["lgWoba"] for v in season_woba.values()):.3f}'
      f' - {max(v["lgWoba"] for v in season_woba.values()):.3f}')
