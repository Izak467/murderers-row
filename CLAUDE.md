# Murderers' Row — CLAUDE.md

## Project overview

**Site:** murderers-row.net (GitHub Pages, CNAME in repo root)
**Repo:** `C:\Users\ischwartz\162-0-repo\`
**Stack:** Single-file vanilla JS/CSS/HTML — everything lives in `index.html`. No frameworks, no build step.
**Deployment:** Push to `main` → GitHub Pages auto-deploys. Commit + push is all that's needed.

---

## File editing rules (CRITICAL)

- **All edits via PowerShell** using `[System.IO.File]::ReadAllText/WriteAllText` with `[System.Text.Encoding]::UTF8`. The Edit tool is unreliable on this file due to Unicode and CRLF line endings.
- **Validate after every edit:** `grep -Pc '\r\n' index.html` must return 0 (no literal `\r\n` contamination).
- Never let `[regex]::Escape()` output land as literal file content — always validate with grep after.

---

## Current eras (live — MLB Stats API backed)

| Era key | Name | Year pool | Notes |
|---|---|---|---|
| `modern` | Modern Era | 2005–2025 | 2020 excluded |
| `steroid` | Steroid Era | 1995–2004 | 1994 excluded (strike); 1995 scaled to 144g |
| `nostalgia` | Nostalgia Era | 1969–1993 | 1972, 1981 excluded (strike) |

All three eras fetch rosters live from `https://statsapi.mlb.com/api/v1` via `fetchRoster(teamId, year)`.
Awards (MVP, ROY, Silver Slugger, All-Star) fetched from MLB API + `MVP_RANKS` object + `NOSTALGIA_ALLSTARS` fallback.

---

## Planned eras (Lahman static data — NOT YET IMPLEMENTED)

| Era key | Name | Year pool | CSS theme |
|---|---|---|---|
| `postwar` | Post-War Era | 1946–1968 | teal/dot-grid — exists |
| `golden` | Golden Age | 1920–1942 | amber/art-deco — exists |
| `deadball` | Dead Ball Era | 1901–1919 | burgundy/scanlines — exists |

CSS body themes (`body.era-postwar`, `.era-golden`, `.era-deadball`) already exist in index.html.
`applyEraTheme()` already handles all 6 eras.
**ERA_CONFIG and ERA_SCORING do NOT yet have entries for these 3 eras.**
**SEASON_AVG does NOT yet have entries for 1901–1968.**

---

## Lahman data files

Preprocessed from the SABR Lahman Database 2025 CSV files.

| File | Location | Contents |
|---|---|---|
| `lahman_data.js` | `C:\Users\ischwartz\Downloads\lahman_data.js` | Batting stats, 1901–1968, AB≥200, AL/NL only |
| `lahman_awards_data.js` | `C:\Users\ischwartz\Downloads\lahman_awards_data.js` | Awards data (MVP_RANKS etc.) — covers 1969+ |
| `preprocess_lahman.py` | `C:\Users\ischwartz\Downloads\preprocess_lahman.py` | Script that generated lahman_data.js from CSVs |
| `lahman_csv.zip` | `C:\Users\ischwartz\AppData\Local\Temp\lahman_csv.zip` | Original Lahman CSVs (People.csv, Batting.csv, etc.) |

**These files need to be moved/embedded into the repo before implementation.**

### lahman_data.js structure

```js
var LAHMAN_DATA = {
  1901: [
    { id:"lajoina01", name:"Nap Lajoie", bats:"R",
      g:131, ab:544, r:145, hr:14, rbi:125, sb:27,
      avg:0.426, obp:0.463, slg:0.643, ops:1.106 },
    ...
  ],
  1902: [...],
  // years: 1901–1919 (Dead Ball), 1920–1942 (Golden Age), 1946–1968 (Post-War)
  // 1943/1944/1945 excluded (WWII depleted rosters)
};
```

Fields: `id` (Lahman playerID), `name`, `bats`, `g`, `ab`, `r`, `hr`, `rbi`, `sb`, `avg`, `obp`, `slg`, `ops`. Optional: `cs` (caught stealing, when tracked).
**No position eligibility data. No team assignments.**

---

## Key architectural difference for Lahman eras

The MLB API eras spin **team + year** → fetch that team's roster + fielding positions.
Lahman eras need a different approach because:
1. `lahman_data.js` has NO fielding position data (only batting stats)
2. `lahman_data.js` is organized by **year** (all qualifying hitters league-wide), not by team

### Design decisions needed before implementing:

**A) Spin mechanic:** Options are:
- Spin just a **year** (no team), show all qualifying players from that year (~30–60 players)
- Add team assignments to lahman_data.js (requires re-running preprocess_lahman.py with teamID + join on historical team list) then spin team+year as today

**B) Position eligibility:** Options are:
- Process `Fielding.csv` from Lahman (games per position per player-year) and add `positions: ["1B","OF",...]` to each entry
- Hardcode positions for famous players only, use a position-flexible fallback for others

**C) Awards for pre-1969:** `lahman_awards_data.js` only covers 1969+. Pre-1969 MVP/awards would need separate processing from Lahman `AwardsPlayers.csv`.

---

## Key data structures in index.html

### ERA_CONFIG (line ~1342)
Controls year pool, season scaling, which awards to show, stat ranges for card color-coding:
```js
var ERA_CONFIG = {
  modern:   { yearPool:[...], seasonScale:{}, showSS:true, showASG:true, showROY:true, showMVP:true, fbColl:'scores', ... },
  steroid:  { yearPool:[...], seasonScale:{1995:144/162}, ... },
  nostalgia:{ yearPool:[...], ssSince:1980, ... }
  // postwar / golden / deadball not yet added
};
```

### ERA_SCORING (line ~1385)
Floor/ceiling benchmarks for the 9-man lineup aggregate, used by `simulate()`:
```js
var ERA_SCORING = {
  modern:   { W:{avg:.10,obp:.22,slg:.20,hr:.18,rbi:.14,runs:.10,sb:.06}, CEIL:{...}, FLOOR:{...} },
  steroid:  { ... },
  nostalgia:{ ... }
  // postwar / golden / deadball not yet added
};
```

### SEASON_AVG (line ~1409)
League-average rate stats per season, used for durability-adjusted normalization in `simulate()`:
```js
var SEASON_AVG = {
  2005:{avg:.264,obp:.330,slg:.421}, ...
  // 1901–1968 not yet added
};
```

### simulate() (line ~3363)
Core scoring function: durability-weighted rate stat aggregation → normalization against era FLOOR/CEIL → weighted composite → power curve wins formula.
`wins = clamp(round(42 + 120 * strength^2.4), 162)`

### fetchRoster() (line ~3296)
Hits MLB API for hitting + fielding stats, builds position eligibility (10+ games at position), returns player objects.
Lahman eras will need a parallel `fetchRosterLahman(year)` (or similar) that reads from LAHMAN_DATA instead.

### loadRoster() (line ~3730)
Called after each spin. Calls `fetchRoster()`, also calls `fetchAwardsForYear()` and standings API.
Will need branching logic: if era is lahman-backed, skip MLB API calls and use static data.

---

## Game mechanics

- 9 positions: C · 1B · 2B · 3B · SS · LF · CF · RF · DH
- 10+ games at position = eligible there; 40+ games = DH eligible
- One team skip + one year skip per game
- One Move Token (reassign placed player to different open eligible position)
- Scoring: AVG, OBP, SLG, HR, RBI, R, SB — era-adjusted, durability-weighted

## Badge SVG functions (in JS)
- `_svgTrophy(rank, w)` — MVP (rank 1 = gold, 2 = silver, 3–5 = bronze)
- `_svgFlame(w)` — Rookie of the Year
- `_svgStar(w)` — All-Star
- `_svgBall(w)` — Silver Slugger

## State object
```js
var S = {
  era: 'modern',          // current era key
  round: 0,               // rounds completed
  lineup: [null×9],       // filled slots
  spin: { teamId, teamName, year, record },
  allPlayers: [],         // current roster
  awardData: null,
  moveToken: 1,
  ...
};
```

---

## Era UI

Era selector tabs are in HTML (~line 1072). Currently shows 3 tabs (modern, steroid, nostalgia).
New eras will need tab buttons added here.

Era description text controlled by `_ERA_DESCS` object (~line 3442) — add entry per new era.

`applyEraTheme(era)` (~line 3420) already handles all 6 era CSS classes — no changes needed.

---

## Head-to-Head (1v1) feature — reworked July 2026

Formerly "1v1 Challenge". One Firebase doc per game in `challenges/{id}` (7-char id):
`{era, wins, slots, uid, ts}` from the sender; `{p2wins, p2era, p2slots, p2uid, p2ts}` merged in by the responder.
Share links are `#vs={id}` — the same link always shows the game's current state.

Both players keep a local entry in localStorage `mr-h2h-games`:
`{id, role:'sender'|'responder', era, myW, oppW, oppEra, status:'waiting'|'done', seen, label, ts, doc}`.

**Turn loop (GamePigeon-style):**
- Sender plays with the ⚔ Head-to-Head toggle on → results screen shows a send card ("Your Move Is In" → "⏳ Their Move" once sent). The Firebase doc is **pre-created when the card renders** (`_h2hPrepare`) so `navigator.share` fires synchronously on tap (iOS drops the share sheet if the user gesture expires during an async save).
- `_h2hSync()` polls open sender games on page load / tab-visible (30s throttle) → hub row flips to "🔔 They played!".
- Responder opens link → era locked, **no-spoiler banner** (era only — never the sender's record; share text has no wins either) → plays → **first completed lineup auto-submits** (`_h2hSubmitState`, kills replay-until-you-win) → final duel report inline + "Send Result Back".
- Invite links route through per-era stub pages `h2h-{era}.html` (era-colored OG image `og-h2h-{era}.png`) that JS-redirect to `/#vs={id}` — static OG tags are the only way to era-color iMessage previews on GitHub Pages. Generator scripts live in session scratchpad history (Pillow).
- Opening your own link shows the waiting banner, not the challenge banner (localStorage role check + uid fallback).
- Home-screen hub (`#vs-hub`) lists all games with turn-status chips; View opens the duel modal.

Key functions (single JS module after `// ─── Head-to-Head (1v1)` header): `_h2hGames/_h2hUpsert`, `_loadFirebaseChallenge`, `_h2hSync`, `shareChallenge`, `respondToChallenge`, `_renderVsResult`, `_showVsBanner`, `_renderVsHub`, `_duelReportHtml`.
Legacy base64 `#vs=` links (pre-Firebase) are no longer parsed.

**⚠ Firestore rules must allow the `challenges` collection.** As of 2026-07-06 the console rules deny ALL access (verified via REST: PERMISSION_DENIED on create/get/update) — the backend never worked. Required addition inside `match /databases/{database}/documents { }` (keep existing scores/users rules):

```
match /challenges/{id} {
  allow get: if true;
  allow list: if false;
  allow create: if request.auth != null
                && request.resource.data.keys().hasAll(['era','wins','slots','uid','ts']);
  allow update: if request.auth != null
                && resource.data.p2wins == null
                && request.auth.uid != resource.data.uid
                && request.resource.data.p2wins is int
                && request.resource.data.p2wins >= 0
                && request.resource.data.p2wins <= 162
                && request.resource.data.diff(resource.data).affectedKeys()
                     .hasOnly(['p2wins','p2era','p2slots','p2uid','p2ts']);
  allow delete: if false;
}
```

## Other files in repo

| File | Purpose |
|---|---|
| `CNAME` | Points to murderers-row.net |
| `og-image.png` / `og-image.svg` | Social sharing image |
| `palette.html` | Design palette scratchpad |
| `svg-test.html` | SVG badge test page |
