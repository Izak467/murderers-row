# Scoring balance — applied

Recalibration applied 2026-08-14. All six `ERA_SCORING` blocks and `simulate()`
were changed together. Measured with `sim-harness.js`, greedy play (best
available player for a position of need, DH only when it's the last slot open),
15,000 games per Lahman era and 4,000 per MLB-API era:

| era | mean | target | 162-rate | saturated axes |
|---|---|---|---|---|
| Modern | 111.6 | 110 | 0.20% | none |
| Juiced | 117.4 | 117 | 0.35% | none |
| Hardball | 111.0 | 110 | 0.15% | none |
| Post-War | 109.9 | 110 | 0.12% | none |
| Golden Age | 112.7 | 112 | 0.27% | none |
| Dead Ball | 105.7 | 106 | 0.27% | none |

Largest miss vs target 1.6 wins. Cross-era spread excluding Juiced's deliberate
premium: **7.0 wins, down from 20.2**. No saturated axis in any era.

Greedy is the calibration baseline — "a player who evaluates every option and
never skips". Casual play lands lower, careful play with both skips lands
higher. These means are not what a person scores.

---

## What was wrong

wOBA carried 50% of the weight in every era and was compared against
hand-picked per-era ceilings that good lineups had already passed. That half of
the score clamped to 1.0 and stopped discriminating:

| era | typical wOBA | old CEIL | % of lineups at/over CEIL | old mean |
|---|---|---|---|---|
| Post-War | 0.374 | 0.368 | **72.1%** | 128.6 |
| Golden Age | 0.396 | 0.392 | **63.7%** | 123.4 |
| Dead Ball | 0.367 | 0.385 | 5.5% | 109.4 |

Dead Ball's ceiling sat correctly above what was achievable, which is why it
still separated good lineups from great ones. It was the only correctly
calibrated era.

It was **not** the talent pool. All three average ~16 teams/year (Post-War 17.2
after expansion) yet spanned 19 wins.

## What was applied

**1. wOBA+ replaces raw wOBA.** `wOBA+ = durability-adjusted wOBA / lgWoba`,
with `lgWoba` already present per season in `woba_weights.js` (previously used
for the durability regression, then discarded). Measuring relative to league is
what removed the saturation.

**2. TB added at 10%, HR reduced.** HR is the heaviest term inside wOBA (for a
40-HR season, 37% of that player's wOBA), *and* it is 4 bases inside TB. It was
being counted three times. TB's weight is kept deliberately small for the same
reason.

**3. RBI and Runs pinned at 10% each.** Both depend on teammates: RBI on who
bats ahead, Runs on who bats behind. Lineups here are assembled from nine
*different* team-seasons, so summing them measures the 1955 Dodgers'
baserunners, not the lineup the player built. Reduced from 22–26% combined to a
flat 20%, but kept — they are on the results card, and a card that recommends a
stat the scoring ignores would be lying.

| era | wOBA+ | HR | TB | RBI | Runs | SB |
|---|---|---|---|---|---|---|
| modern | .50 | .12 | .10 | .10 | .10 | .08 |
| steroid | .50 | .14 | .10 | .10 | .10 | .06 |
| nostalgia | .50 | .11 | .10 | .10 | .10 | .09 |
| postwar | .50 | .12 | .10 | .10 | .10 | .08 |
| golden | .50 | .14 | .10 | .10 | .10 | .06 |
| deadball | .50 | .10 | .10 | .10 | .10 | .10 |

**4. Every CEIL is measured, not chosen** — a percentile (p91–p95) of what
lineups actually produce, with the percentile per era set so the mean lands on
target. FLOORs for hr/rbi/runs/sb are unchanged.

### FLOOR stays low — this is not optional

An early attempt set FLOOR at p01 of achievable. That is wrong. The existing
FLOORs are deliberately "theoretical bad", far below anything a real lineup
produces (Post-War HR floor is 10; the 1st percentile of actual lineups is 123).
That gap is what lifts a typical lineup to ~0.8 normalised. Moving FLOOR to p01
collapses every axis to ~0.5 and the mean falls to ~68. **Only the CEILs were
broken.**

## The shared wOBA+ ceiling did not survive contact with all six eras

The original plan was one shared `FLOOR 1.10 / CEIL 1.25` for every era, on the
strength of the three Lahman eras agreeing to three decimals (p50 ≈ 1.162). That
agreement is real but does not extend to the MLB-API eras:

| era | wOBA+ p50 | wOBA+ p92 |
|---|---|---|
| Modern | 1.136 | 1.173 |
| Juiced | 1.140 | 1.186 |
| Hardball | 1.152 | 1.187 |
| Post-War | 1.159 | 1.211 |
| Golden Age | 1.160 | 1.214 |
| Dead Ball | 1.163 | 1.210 |

Applying a shared 1.21 gives means of 99.6 / 105.0 / 105.2 / 109.9 / 110.5 /
109.4 — an 11-win spread with Modern 10 wins adrift, which is the same
incomparability the recalibration exists to remove. Per-era measured ceilings
cut it to 4.1 wins on the same data.

So the **method** survives (ceiling = a measured percentile) and the
**shortcut** does not (one shared number). The per-era percentiles land at
p91–p95, tightly clustered around the p92 the shared-ceiling analysis proposed,
so this is a refinement rather than a different approach.

Older eras appear to have genuinely wider talent dispersion above league
average — Ruth and Cobb were further clear of their peers than today's stars
are — which is a real property of the eras, not an artifact.

## 162-0

**SB is the binding constraint in every era.** Among the top 5% of lineups every
other axis sits at 0.94–1.00 normalised while SB sits at 0.72–0.91. SB is also
the axis least correlated with the offensive core — essentially zero or negative
against HR in four of six eras (Golden −0.06, Post-War −0.03, Hardball −0.03).
Sluggers do not steal, so pinning both at once is the conflict that makes a
perfect season hard. Dead Ball is the exception (SB↔HR 0.33, SB↔Runs 0.65),
where stealing was part of the offensive engine.

**The multiplier cannot be improved.** `wins = 42 + 120·strength^exp` capped at
162, and 42 + 120 = **exactly** 162. So:

- M = 120 is the *smallest* multiplier for which 162 is reachable at all —
  anything lower puts the formula's maximum below 162 and makes a perfect
  season impossible by construction;
- every increase makes 162 *more* common, not less (M = 124 pushes Juiced to
  2.9%).

M = 120 is therefore simultaneously the minimum for attainability and the
setting producing the rarest perfect seasons. There is no knob here. The
measured 0.12–0.35% is the floor of what this formula can deliver while keeping
162 possible.

**Do not trust small-sample perfect-season rates.** At a true rate of 0.2%, a
250-game run expects 0.5 perfect seasons and a 800-game run expects 1.6. During
this work Modern read 0.4% at n=250, 0% at n=800, and 0.20% at n=4,000; Golden
read 0.47% at n=1,500 and 0.27% at n=15,000. Anything below a few thousand games
per era is noise at this resolution.

## Harness changes

`sim-harness.js` now measures `wobaPlus` and `tb` alongside the original axes,
tolerates an axis with no ceiling yet (that measurement is what a new axis's
ceiling gets calibrated from), reports p01/p50/p92/p99 per axis, and keeps the
raw per-game aggregates from the last run so ceilings can be re-cut at a
different percentile without replaying games:

```js
var s=document.createElement('script'); s.src='/sim-harness.js'; document.head.appendChild(s);
await mrReport(null, 2000, true)   // all six eras
mrCeils(0.92)                      // proposed CEILs from that run
mrCeils(0.85, ['steroid'])         // lower percentile = higher mean
```

The MLB-API path, previously untested, runs clean: 2,894 requests, zero
failures.

## Open work

1. **Dead Ball's SB weight fell .14 → .10** to make room for TB. That dilutes
   the one axis carrying that era's identity (no home runs, steal to score).
   Numerically it costs almost nothing — the alternative (RBI/Runs .08–.10, SB
   up to .14) moved the mean by +0.0 to +0.5 wins — so this is a feel question,
   not a math one. First thing to revisit if the eras stop feeling distinct.

2. **Juiced and Golden sit slightly above a 0.2% perfect-season preference**
   (0.35% and 0.27%). Both are eras where a perfect lineup arguably *should* be
   more achievable. Nudging just those two CEIL blocks up would fix it at a cost
   of roughly a win of mean each.

3. **Two dead references to the old axis set**: `_playerScore` (declared, never
   called — it would return `NaN` now) and the legacy `W`/`CEIL`/`FLOOR` aliases
   below `ERA_SCORING`. Both were already unused; they were left alone as
   outside the recalibration, but they now describe a scoring scheme that no
   longer exists.

## Caveats

- The greedy is **myopic**: it maximises the current partial score with no
  lookahead and does not reason about which positions get hard to fill.
- It **never uses skips**, though real players get one team and one year skip.

Both mean real best-play scores run above these means.

## Before anyone plays

Recalibrating changed everyone's scores. Existing personal bests and any live
leaderboard entries are not comparable to new ones. `pb_*` fields live in
`users/{uid}` and daily scores in the per-era collections; neither is versioned
by scoring formula.

---

## Negro Leagues (added 2026-09-20)

Calibrated the same way: greedy play, ceilings set to a measured percentile,
percentile chosen so the mean lands on target.

| era | mean | target | 162-rate | saturated axes |
|---|---|---|---|---|
| Negro Leagues | 110.0 | 110 | 0.44% | none |

Ceilings are **p90** — a lower percentile than the other eras need, because
this era's spread is wider (sd 24 against 13-23 elsewhere). That spread is
real and comes from the source: seasons ran 40-100 documented games, and
scaling a 45-game season onto 162 multiplies its noise along with its totals.

Two things work differently here, both forced by the data:

**Season length is per team-season.** Every other era is scored against 162.
Negro Leagues schedules varied by team within a year, so each team-season
carries a `seasonG` -- its best-documented games played -- and durability is
`sqrt(min(g, seasonG) / seasonG)` against that. Team games from Lahman's Teams
table are *not* usable: the readme is explicit that player stats count games
against all opponents while team records are league-only, so team games
undercount. Nothing outside this era has a `seasonG`, so nothing outside this
era changed.

**Counting stats are scaled to 162** by `162 / seasonG`, per player, since a
lineup draws nine different team-seasons. This is what lets one set of ceilings
work across schedules. Roster cards during the draft show raw totals; the
results card shows the scaled aggregate and says so.

**wOBA+ is measured against Negro Leagues play.** 1920-1948 exists in
`WOBA_WEIGHTS` with AL/NL values, and using those would score these players
against a league they were barred from. `NEGRO_WOBA` carries league-average
wOBA computed from this data instead (.324-.370 across the span). The linear
weights are the same-year FanGraphs values -- those track the decade's run
environment and are a reasonable borrow; the league average is not.

### Threshold

Players qualify at `G >= 0.40 * seasonG` and `AB >= 20`, not a flat at-bat cut.
The recovery of these statistics is ongoing, so a flat threshold would quietly
punish the teams whose box scores are least recovered. The fraction also floors
durability at 0.63 for anyone draftable. Result: a median of 11 players per
team-season, p10 of 9, and 2% of team-seasons unable to field the core
positions.

### Open

- The perfect-season rate (0.44%) is the highest of the seven eras. Inherent to
  the variance above; lowering it means lowering the mean.
- No awards. The East-West Game was the biggest Black sporting event in America
  and the All-Star data is in Lahman's `AllstarFull` -- badges for it would be
  a real addition.
