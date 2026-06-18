# Murderers' Row — Scoring Algorithm Whitepaper

*murderers-row.net · last updated June 2026*

---

## 1. Purpose

Murderers' Row is a baseball lineup-building game in which players construct a nine-man batting order from players randomly drawn from a single MLB team and season. The scoring engine converts that lineup into a projected win-loss record — a single number that rewards deep baseball knowledge while remaining legible to casual fans.

This document describes every mathematical decision behind that number: why each stat was chosen, how it is weighted, and what design tradeoffs were made.

---

## 2. The Hidden Rate Stat: wOBA

### 2.1 Why Not OPS?

The game displays traditional statistics — AVG, OBP, SLG, OPS — because those are the numbers fans recognize and can reason about at a glance. But OPS has a well-documented flaw: it adds on-base percentage and slugging percentage as if they are denominated in the same unit, which they are not. A point of OBP is worth approximately 1.7× a point of SLG in run production terms (Tango, Lichtman & Dolphin, *The Book*, 2007). OPS systematically undervalues walks and contact hitters relative to sluggers.

### 2.2 Weighted On-Base Average (wOBA)

The underlying scoring engine uses **wOBA** (Weighted On-Base Average), developed by Tom Tango and popularized through FanGraphs. wOBA assigns a run-value coefficient to each offensive event — walk, hit-by-pitch, single, double, triple, home run — based on how many runs that event produces on average relative to an out:

```
wOBA = (c.bb × BB + c.hbp × HBP + c.1b × 1B + c.2b × 2B + c.3b × 3B + c.hr × HR)
       ───────────────────────────────────────────────────────────────────────────
                              AB + BB + HBP + SF
```

The denominator is plate appearances (excluding sacrifice hits, which are considered outs-on-purpose). The resulting value is scaled to match league OBP, giving wOBA a familiar range (~.270–.420 for MLB regulars).

### 2.3 Per-Season Linear Weights

Crucially, the coefficients are **not fixed**. FanGraphs publishes a "Guts!" table of linear weights recalculated each season from actual run expectancy data going back to 1901. The game loads these per-season coefficients from `woba_weights.js` (126 seasons, 1901–2026) and uses the weights matching each player's actual season year.

This matters because run environments change dramatically across eras. In 2001 (peak steroid era), runs were plentiful and therefore *cheap* — each home run was worth less in run value than it would be in a pitcher's era when runs are scarce. The per-season wHR coefficient reflects this: steroid-era wHR (~1.990) is actually *lower* than nostalgia-era wHR (~2.143), which is counterintuitive but mathematically correct.

> **Source:** FanGraphs Guts! table — `fangraphs.com/guts.aspx?type=cn`. Coefficients derived from linear weights methodology described in Tango, Lichtman & Dolphin, *The Book: Playing the Percentages in Baseball* (2007), and Pete Palmer's original linear weights work (*The Hidden Game of Baseball*, 1984).

---

## 3. Durability Adjustment

### 3.1 The Problem with Raw Rate Stats

A player who posts a .420 wOBA in 40 games is likely a different proposition than one who posts .420 in 162 games. Small samples regress toward league average; the 40-game player's true talent level is far less certain. The game applies a **durability adjustment** to rate stats to capture this:

```
adjustedWOBA = lgWoba + (playerWoba − lgWoba) × √(games / 162)
```

The square-root curve was chosen deliberately over a linear adjustment. It gives substantial credit for half-seasons (√(81/162) ≈ 0.71, meaning 71% of the excess over average is preserved), while still discounting injury-shortened seasons. A full 162-game season gets the full weight (√1 = 1.0).

`lgWoba` is the league-average wOBA for that specific season, sourced directly from the FanGraphs Guts! table (stored as `lgWoba` in each season's weight entry). This ensures the baseline moves with the run environment — a .320 wOBA in 1968 (a year of historically low offense) represents a different quality of performance than .320 in 2000.

### 3.2 Counting Stats Are Not Adjusted

Home runs, RBI, runs scored, and stolen bases are **summed directly** without any durability penalty. A player who hit 40 HR in 100 games legitimately hit 40 HR — those happened. The counting stats measure volume of production, not rate, so shrinking them by games played would be incorrect and would penalize legitimate productivity. Only rate stats (wOBA) are subject to the durability regression.

---

## 4. Lineup Aggregation

The nine-player lineup is aggregated as follows:

- **wOBA:** Durability-adjusted values are averaged across all nine slots. League-average wOBA is used as the baseline for each player's adjustment, ensuring the team wOBA is expressed relative to the run environment of each player's own season.
- **HR, RBI, Runs, SB:** Summed directly (no averaging, no durability adjustment).
- **AVG, OBP, SLG:** Averaged across nine players. These are used for **display only** — they appear as slash-line chips in the results dashboard but do not drive the win calculation.

---

## 5. Era-Specific Scoring

The aggregated lineup statistics are normalized against era-specific floors and ceilings, then combined via a weighted composite score.

### 5.1 Normalization

Each component is normalized to [0, 1]:

```
norm(x) = clamp((x − FLOOR) / (CEIL − FLOOR), 0, 1)
```

The FLOOR represents the lower bound of what a genuinely bad but plausible nine-man lineup produces; the CEIL represents an elite historical lineup. Floors for RBI and Runs are set to approximately 9 players × 50 RBI (era-adjusted), not zero, because even a bad MLB lineup accumulates substantial counting stats over 162 games.

### 5.2 Weights

| Component | Modern | Steroid | Nostalgia | Rationale |
|-----------|--------|---------|-----------|-----------|
| wOBA | 50% | 50% | 50% | Best single measure of offensive quality; era-adjusted by construction |
| HR | 16% | 20% | 14% | More weight in HR-inflated steroid era; less in contact-and-speed nostalgia era |
| RBI | 12% | 12% | 12% | Consistent proxy for run production across eras |
| Runs | 12% | 12% | 12% | Correlated with RBI but measures run scoring rather than run driving |
| SB | 10% | 6% | 12% | Stolen bases peaked in value pre-steroid era; negligible in 1995–2004 |


### 5.3 Nostalgia Era SB Ceiling

The stolen base ceiling for the nostalgia era was set at 240 (down from an earlier value of 340). The 340 figure represented extreme outlier teams like the 1985 St. Louis Cardinals (314 SB), but most randomly spun nostalgia teams produce 80–160 SB. A ceiling calibrated only to outliers caused non-speed teams to score near-zero on a 12% component through no strategic fault of their own. At 240, a power team with 80 SB still scores ~33% of the SB component, while a genuine speed team (200+ SB) approaches the ceiling.

---

## 6. The Win Curve

### 6.1 Formula

The composite strength score (0 to 1) is converted to projected wins via a **convex power curve**:

```
wins = clamp(round(42 + 120 × strength^2.4), 162)
```

### 6.2 The Floor: 42

The minimum possible win total is **42**, chosen as a deliberate Easter egg honoring Jackie Robinson's retired number. In practice, no reasonable lineup scores strength = 0.0 (that would require every player to be at or below every floor simultaneously), so real games rarely produce fewer than ~55 wins.

### 6.3 Why a Power Curve?

A linear function would make marginal improvements feel uniformly rewarding: going from a terrible lineup to a mediocre one would feel the same as going from a good lineup to a great one. The power curve (exponent 2.4) creates a different dynamic:

- **Low end is compressed:** Mediocre lineups (strength ~0.50) project to ~65 wins. You cannot get to a .500 record without intentional, informed construction.
- **High end is sparse:** The jump from 90 wins to 100 wins requires meaningful strength improvement (Δs ≈ 0.06), making elite scores feel genuinely earned.
- **Extreme scores are rare:** A 115+ win projection (equivalent to one of the greatest teams in MLB history) requires strength ≥ 0.83 — achievable only with near-perfect lineup construction.

The result tier thresholds are calibrated to this curve:

| Wins | Label | Required Strength |
|------|-------|-------------------|
| 162 | Perfect Season | 1.00 |
| 130+ | Historic | ~0.88 |
| 115+ | Transcendent | ~0.83 |
| 100+ | Dominant | ~0.76 |
| 87+ | Elite | ~0.66 |
| 74+ | Solid Contender | ~0.58 |
| 63+ | Decent | ~0.50 |
| <63 | Lineup Has Gaps | — |

---

## 7. Hidden Depth: The Design of wOBA as a Secret Layer

A deliberate design choice keeps wOBA invisible to the player. The game displays AVG, OBP, SLG, and OPS everywhere in the UI. wOBA is never labeled or surfaced directly — with one exception.

### 7.1 The Scatter Plot

The "Power vs. Patience" scatter plot in the results dashboard charts OBP (x-axis) against SLG (y-axis), with bubble size proportional to HR. The **color** of each bubble is mapped to OPS (OBP + SLG) — literally the sum of the two visible axes — so the color gradient tracks each player's position in the chart space coherently. A player in the upper-right corner (high OBP and high SLG) will naturally appear with the warmest color; a player in the lower-left will appear cool. This makes the visualization self-consistent: no external knowledge is required to interpret the color.

### 7.2 HR Double-Counting

Home runs contribute to the score through two separate channels simultaneously:

1. **Inside wOBA:** Each HR earns `c.hr × 1` in the wOBA numerator, where `c.hr` is the era- and season-adjusted run value of a home run (~1.99–2.14). This captures the *quality-adjusted* value.
2. **Explicit HR component:** The raw HR total is summed across the lineup and normalized against the era FLOOR/CEIL, weighted at 14–20% depending on era.

This is intentional. The two channels measure different things: wOBA captures how much each HR was *worth* in its run environment (a HR in 2001 is worth less than one in 1968 because runs were cheap), while the explicit HR component rewards *volume* of home run production regardless of era context. A player with 60 HR gains from both channels; a player with 0 HR gains from neither. This creates a hidden asymmetry that rewards users who understand why the formula favors sluggers in lower-offense eras — specifically, because `c.hr` (the wHR coefficient) is *higher* when runs are scarce.

---

## 8. Data Sources

| Data | Source |
|------|--------|
| Per-season wOBA linear weights (1901–2026) | FanGraphs Guts! table (`fangraphs.com/guts.aspx?type=cn`) |
| League-average wOBA per season (`lgWoba`) | FanGraphs Guts! table |
| Player batting statistics (1969–present) | MLB Stats API (`statsapi.mlb.com/api/v1`) |
| Player batting statistics (1901–1968) | Lahman Database 2025 (`seanlahman.com`) |
| Linear weights theory | Tango, Lichtman & Dolphin — *The Book: Playing the Percentages in Baseball* (2007) |
| Original linear weights methodology | Palmer & Thorn — *The Hidden Game of Baseball* (1984) |

---

## 9. What Is Not in the Formula

**Defensive value** is excluded entirely. Wins Above Replacement (WAR) and Defensive Runs Saved (DRS) would incorporate fielding, but the game is explicitly about *offensive* lineup construction — the spirit of "Murderers' Row" (the 1927 Yankees' fearsome batting order) is pure hitting. Pitching and defense are assumed equal across all lineups.

**Park factors** are not applied. Adjusting for Coors Field or Fenway Park would add accuracy but at the cost of obscuring the signal: users would need to track park-adjusted stats rather than box-score stats, breaking the accessibility of the display layer.

**Baserunning value beyond SB** (e.g., extra bases taken, GDP rate) is not modeled. These events are either unavailable in the MLB Stats API at the aggregation level used or too granular for meaningful era comparison across 1901–2026.

---

*For technical implementation details, see `CLAUDE.md` in the repository root.*
