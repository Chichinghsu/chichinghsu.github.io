# Prompt: Build "台挑估估王" daily slider-guess game

## Context

I have a static dataset of Taiwan county statistics, already built and
normalized. 

- `counties.json` — 22 records: `{ "id": "hsinchu_county", "name": "新竹縣", "region": "north" }`
- `indicators.json` — one record per stat: `{ "id": "執業醫師數", "name": "執業醫師數", "unit": "人", "definition": "...", "category": null }`
- `values.json` — one record per (indicator, county, year), e.g.:

```json
{
  "indicator": "執業醫師數",
  "county": "hsinchu_county",
  "year": 2024,
  "value": 1291.0,
  "rank": 12
}
```

All three files sit in `projects/norht-vs-south/data` alongside the app. Treat them as read-only
input — do not modify their schema.

## What to build

A single-page, static, no-backend game (plain HTML/CSS/JS — no build step,
no framework, matches a "Wordle-style daily puzzle" feel), similar to our who-is-older 
or north-vs-south. It must run entirely client-side by fetching the three JSON files above.

**No leaderboard, no accounts, no server.** Everything is local to the
browser session (optionally persisted in `localStorage` for streak
tracking — see "Nice to have" below).

## Game flow

One "daily session" = 5 questions, each about a different indicator, for
a specific county:

1. **Q1**: show the question ("《縣市》的《指標》是多少？"), the unit,
   and a slider bounded to the real `[min, max]` for that indicator
   across all 22 counties for that year (computed from `values.json` at
   load time — don't hardcode bounds).
2. Player drags the slider, hits **"確認"**.
3. On confirm: lock the slider, reveal the actual value, compute the
   score (formula below), show a visual bar with the player's guess and
   the actual value both marked along the min–max range, and show a
   short verdict label (e.g. 神準 / 接近 / 還可 / 問號
   based on score thresholds — pick your own reasonable bucket cutoffs).
4. **Leave a clearly marked empty slot here for a trivia/fun-fact line**
   (e.g. "你知道嗎？台北市是全台⋯"), shown after the reveal. For the first version,
   the fun fact is shown only when it is the max/min of the entire 22 values, 你知道嗎
   台北市有全台灣最多/高/大的 bla bla or something like this and show 最少的是 ... 市
5. **"下一題"** button advances to Q2, repeat through Q5.
6. After Q5's reveal, instead of "下一題" show **"看今日成績"**, which
   goes to a results screen.

## Scoring formula

For each question (total 500, not 5000 points):

```
range = max(indicatorValues) - min(indicatorValues)   // guard against 0
score = round(100 * (1 - abs(guess - actual) / range))
score = clamp(score, 0, 100)
```

Sum the 5 question scores for a total out of 500 on the results screen.
If you have better idea for scoring, we can discuss. The value range could vary a lot, 
this has to be considered. Like 失業率 may be boring

## Results screen

- Show total score (out of 500) and a per-question breakdown (5 small
  rows: indicator name, score, emoji (see below)).
  This is important because user screenshot and share this result card
- Show a Wordle-style shareable result string the player can copy to
  clipboard, e.g.:
  ```
  台挑估估王 #12
  421 分/500 分
  台北市高中數 🟩
  台中市失業率 🟩
  ...🟨
  ...🟥
  ...🟩

  台挑估估王 你敢來估嗎？ | 台灣大挑戰
  link here with parameter ?p=id
  ```
  (map score ranges to colored squares — you decide reasonable
  thresholds, e.g. 🟩 ≥80, 🟨 50–79, 🟥 <50).
- No leaderboard submission of any kind — the share string is the only
  "social" output.

## Daily rotation (deterministic, no manual curation)

Each day should present the same 5 questions to every player, chosen
without any server:

- Build a deterministic list of (indicator, county, year) triples from
  `values.json` at load time.
- Use `daysSinceLaunch = floor((today - LAUNCH_DATE) / 1 day)` as a seed
  to pick 5 triples for today (e.g. shuffle the full list once with a
  fixed seed at build/launch time, then take a rotating window of 5
  per day, wrapping around and reshuffling with a new seed each full
  cycle through the dataset).
- Support a `?p=id` or similar debug query param so I can preview
  future/past days while testing, without waiting for real dates.
- p=id where id is 1 for today (2026-09-23) and continue, so when user share they can 
click back and see
- generate a deterministic puzzles.json for the next 30 days.
- provide a mjs script to generate future puzzle automatically.

## Style / UX notes

- Mobile-first, single column, generous tap targets on the slider.
- Keep it visually consistent with a "daily puzzle" feel — think
  Wordle/NYT Games aesthetic: clean, minimal, one card per screen,
  small reveal animations are welcome but keep them lightweight. Reference to 
  who-is-older and north-vs-south
- Traditional Chinese UI throughout (zh-Hant).

## Nice to have (only if time allows, don't block on these)

- `localStorage` streak counter ("連續 N 天") shown on the start screen.
- Personal best total score, stored locally.
- Archive mode to replay previous days' question sets.

## Explicitly out of scope

- No backend, no database, no user accounts.
- No leaderboard of any kind, global or friends.