# Scoring balance — findings and open work

Status as of 2026-08-13. Nothing in `ERA_SCORING` has been changed yet.

## The problem

Scores are not comparable across eras. Measured with `sim-harness.js`,
2,000 greedy games per era (best available player for a position of need,
DH only when it's the last slot open):

| era | mean | median | sd | p10 | p90 | range | 140+ | =162 |
|---|---|---|---|---|---|---|---|---|
| Post-War | 128.6 | 130 | 13.7 | 110 | 145 | 73–161 | 24.9% | 0.00% |
| Golden Age | 123.4 | 124 | 15.1 | 103 | 142 | 74–162 | 15.2% | 0.10% |
| Dead Ball | 109.4 | 108 | 19.5 | 85 | 136 | 64–162 | 7.7% | 0.15% |

Modern, Juiced and Hardball are **unmeasured** — they fetch rosters from the
MLB Stats API, which the dev sandbox blocks. Run them locally (see below).

## Root cause: a saturated wOBA axis

wOBA carries **50% of the weight** in every era. In Post-War and Golden a
typical good lineup is already *past* the ceiling, so that half of the score
clamps to 1.0 and stops discriminating:

| era | typical wOBA | CEIL | % of lineups at/over CEIL |
|---|---|---|---|
| Post-War | 0.374 | 0.368 | **72.1%** |
| Golden Age | 0.396 | 0.392 | **63.7%** |
| Dead Ball | 0.367 | 0.385 | 5.5% |

Dead Ball's ceiling sits correctly above what's achievable, which is why it
still separates good lineups from great ones. **Dead Ball is the correctly
calibrated era; the other two are inflated.**

Secondary: Dead Ball's RBI axis is dead in the other direction — typical 522
against a 740 ceiling, which **0.1%** of lineups ever reach. It contributes
almost nothing while still consuming its weight.

### It is not the talent pool

The obvious hypothesis — fewer teams means a more concentrated pool — does not
explain it. All three eras average ~16 teams/year (Post-War 17.2 after
expansion) yet span 19 wins. Team count may still matter for modern-vs-old
comparisons; that is untested.

### Why Post-War never reaches 162

A perfect season needs `strength ≥ 0.998` (from `wins = 42 + 120·strength^2.2`,
capped at 162) — every axis pinned at its ceiling simultaneously. Post-War's SB
ceiling is 180 but a typical lineup manages 62–70, with only 0.1% reaching 180.
Needing that *and* every other axis maxed in the same game makes 162
unreachable there: 0 perfect seasons in 2,000 games, despite the highest mean.
Dead Ball, with the lowest mean, hit 162 most often. Post-War is compressed from
both ends — clamped at the top, capped at the bottom.

## Agreed targets (not yet applied)

Mean is for the **greedy baseline**, roughly "player who evaluates every option
and never skips". Casual play lands lower; careful play with both skips lands
higher. Calibrate to the baseline, not to personal scores.

| era | target mean | reasoning |
|---|---|---|
| Dead Ball | ~106 | thematically the grind era; small discount is honest |
| Post-War / Hardball / Modern | ~110 | baseline |
| Golden Age | ~112 | Ruth-era power, slight nudge |
| Juiced | ~117 | genuinely inflated offence — a premium, not a chasm |

Rationale: the game's tagline tiers are 130+ "Historic", 115+ "Transcendent",
100+ "Dominant". A mean of ~110 puts average good play in "Dominant" and keeps
the top labels meaningful. Post-War's current 128.6 makes "Historic" the
*typical* outcome.

Also target: **sd 16–20** (Post-War's 13.7 is the saturation bug, not a property
of the era) and **0.2–0.5% perfect seasons**, so 162-0 stays a real chase.

## The fix: wOBA+ instead of raw wOBA

Hand-tuning six sets of wOBA ceilings is the wrong approach. The metric should
be **relative to league**: `wOBA+ = durability-adjusted wOBA / lgWoba`, where
`lgWoba` is already present per season in `woba_weights.js` — currently used
for the durability regression and then discarded before normalisation.

Measured over 1,500 greedy games per era:

```
              p01     p50     p99
postwar      1.099   1.162   1.243
golden       1.096   1.161   1.263
deadball     1.098   1.163   1.251
```

The eras are **already balanced** on wOBA once expressed relative to league —
a typical lineup is ~16% above league average in every era, agreeing to three
decimal places. The entire cross-era imbalance on that axis was an artifact of
comparing raw wOBA against hand-picked ceilings.

So the wOBA axis takes **one shared FLOOR 1.10 / CEIL 1.25 for all six eras**,
and never needs per-era tuning again — including for any era added later.

### Two secondary problems with the counting stats

**HR is double-counted.** It is the heaviest term inside wOBA — for a 40-HR
season, 37% of that player's wOBA is home runs — and then HR carries another
14–18% of the score on its own. It is also 4 bases inside Total Bases.

**RBI and Runs do not transfer.** Both depend on teammates: RBI on who bats
ahead, Runs on who bats behind. Lineups here are assembled from nine *different*
team-seasons, so summing them measures the 1955 Dodgers' baserunners, not the
lineup the player built. Currently 22–26% of the score. Kept, but reduced —
they stay legible on the results card and shouldn't vanish from scoring
entirely, or the display would be recommending a stat the game ignores.

## Proposed weights ("Goldilocks")

wOBA+ holds at 50%. HR down a notch. TB added at 10% (kept small precisely
because HR already lives inside it — a home run is 4 bases). RBI and Runs
pinned at 10% each, with the balance taken from SB.

| era | wOBA+ | HR | TB | RBI | Runs | SB |
|---|---|---|---|---|---|---|
| modern | .50 | .12 | .10 | .10 | .10 | .08 |
| steroid | .50 | .14 | .10 | .10 | .10 | .06 |
| nostalgia | .50 | .11 | .10 | .10 | .10 | .09 |
| postwar | .50 | .12 | .10 | .10 | .10 | .08 |
| golden | .50 | .14 | .10 | .10 | .10 | .06 |
| deadball | .50 | .10 | .10 | .10 | .10 | .10 |

Every row sums to 1.00. Context-dependent share (RBI+Runs) drops from 22–26%
to a flat 20%; individual-production share rises to 80%.

Uniform RBI/Runs costs almost nothing numerically — tested against the
alternative (RBI/Runs .08–.10, SB up to .14) the mean moved by +0.0 to +0.5
wins. The real cost is thematic: Dead Ball's SB weight falls .14 → .10, which
dilutes the one axis that carried that era's identity (no home runs, steal to
score). Worth revisiting if the eras stop feeling distinct.

## Calibration method — FLOOR stays low, CEIL at p92

An early attempt set FLOOR at p01 of achievable. That is wrong: the existing
FLOORs are deliberately "theoretical bad", far below anything a real lineup
produces (Post-War HR floor is 10, but the 1st percentile of actual lineups is
123). That gap is what lifts a typical lineup to ~0.8 normalised. Moving FLOOR
to p01 collapses every axis to ~0.5 and the mean falls to ~68.

**Keep the low FLOORs. Only the CEILs were broken.**

With FLOORs unchanged (plus `wobaPlus` FLOOR 1.00 = a league-average lineup),
sweeping the CEIL percentile over the measured distributions:

```
CEIL      mean (pw/gold/dead)   spread   sd    150+   perfect  saturated axes
p99        93.8  89.8  90.4      4.0    18.2   0.4%    0.00%      0/18
p97       101.4  98.2 100.0      3.1    20.7   1.7%    0.11%      0/18
p95       105.4 102.8 104.1      2.6    21.7   3.0%    0.13%      0/18
p92       110.8 108.7 109.3      2.1    22.7   5.6%    0.18%      0/18   <-- use this
p90       113.8 111.2 112.2      2.6    23.1   7.1%    0.38%      0/18
p85       119.7 117.7 117.3      2.3    23.6  11.7%    0.82%      0/18
```

**p92 hits every target**: mean ~110, era spread 2.1 wins (down from 19), no
saturated axis anywhere, 0.18% perfect seasons. sd ~23 is a little wider than
the 16–20 originally suggested, which is an improvement — more separation
between a good game and a great one.

Juiced can be given its ~117 premium by using a lower percentile (p85) for that
era alone, once it has been measured.

## Measured ceilings (p92) for the three tested eras

```
wobaPlus   CEIL 1.21   FLOOR 1.00     (shared by every era)

postwar    tb 2470  hr 245  rbi 855  runs 840  sb 135
golden     tb 2595  hr 197  rbi 950  runs 925  sb 138
deadball   tb 2035  hr 400  rbi 665  runs 745  sb 300
```

Existing FLOORs for hr/rbi/runs/sb are unchanged. TB floor ≈ 55% of p01.

**Modern, Juiced and Hardball still need measuring** — TB is a new axis with no
ceiling at all for them. Run `mrReport()` on a machine with MLB API access (see
below), then apply all six eras in one change; recalibrating some now and others
later leaves them mutually incomparable in between.

## Open work

1. Measure Modern, Juiced and Hardball. On a machine with MLB API access, open
   `murderers-row.net`, then in the console:

   ```js
   var s=document.createElement('script'); s.src='/sim-harness.js'; document.head.appendChild(s);
   await mrReport()            // the 3 API eras
   await mrReport(null,200,true)  // all six, cross-checks the numbers above
   ```

   The MLB-API path in the harness has never executed — it could not be tested
   from the sandbox. If it errors, that is the first thing to fix.

2. Recalibrate all six `ERA_SCORING` FLOOR/CEIL blocks from the combined data.

3. Re-run the harness to confirm the means land on target.

## Caveats on the numbers

- The greedy is **myopic**: it maximises the current partial score with no
  lookahead, and does not reason about which positions get hard to fill. A
  careful human beats it.
- It **never uses skips**, though real players get one team and one year skip.

Both mean real best-play scores run higher than the table above, which makes the
Post-War compression worse in practice than it looks.

## Note before applying

Recalibrating changes everyone's scores: existing personal bests and any live
leaderboard entries become non-comparable to new ones. `pb_*` fields live in
`users/{uid}` and daily scores in the per-era collections; neither is versioned
by scoring formula.
