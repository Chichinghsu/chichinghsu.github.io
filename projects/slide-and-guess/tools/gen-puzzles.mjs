#!/usr/bin/env node
// Generate 30 days of deterministic daily puzzles for 台挑估估王.
// Each day picks 5 distinct, well-covered indicators and one county per
// indicator. Seeded PRNG keyed by date, so re-running reproduces the same file.

import fs from 'fs';
import path from 'path';

const DAYS = 30;
const ROUNDS_PER_DAY = 5;
const FIRST_DATE = '2026-09-30';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const dataDir = path.join(__dirname, '..', '..', 'north-vs-south', 'data');
const counties = JSON.parse(fs.readFileSync(path.join(dataDir, 'counties.json'), 'utf8'));
const indicators = JSON.parse(fs.readFileSync(path.join(dataDir, 'indicators.json'), 'utf8'));
const values = JSON.parse(fs.readFileSync(path.join(dataDir, 'values.json'), 'utf8'));

const countyById = new Map(counties.map(c => [c.id, c]));
const indicatorById = new Map(indicators.map(i => [i.id, i]));

// Group values by indicator (only the most recent year available per indicator).
const byIndicator = new Map();
for (const v of values) {
  if (!countyById.has(v.county) || !indicatorById.has(v.indicator)) continue;
  if (!byIndicator.has(v.indicator)) byIndicator.set(v.indicator, []);
  byIndicator.get(v.indicator).push(v);
}

function latestYearRows(rows) {
  const maxYear = Math.max(...rows.map(r => r.year));
  return rows.filter(r => r.year === maxYear);
}

// Playable: >=18/22 counties reporting for its latest year, and a real spread
// (avoid indicators where every county reports the same value — no fair guess).
const playableIndicatorIds = [...byIndicator.keys()].filter(id => {
  const rows = latestYearRows(byIndicator.get(id));
  if (rows.length < 18) return false;
  const vals = rows.map(r => r.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  return max > min;
});

console.log(`Playable indicators: ${playableIndicatorIds.length}/${byIndicator.size}`);

/* ---------- seeded PRNG (deterministic per date) ---------- */

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(dateKey) {
  return mulberry32(xmur3(`slide:v1:${dateKey}`)());
}

function roundsForDate(dateKey) {
  const rng = rngFor(dateKey);
  const usedIndicators = new Set();
  const usedCounties = new Set();
  const rounds = [];
  let guard = 0;
  while (rounds.length < ROUNDS_PER_DAY && guard++ < 5000) {
    const indicatorId = playableIndicatorIds[Math.floor(rng() * playableIndicatorIds.length)];
    if (usedIndicators.has(indicatorId)) continue;
    const rows = latestYearRows(byIndicator.get(indicatorId));
    const candidates = rows.filter(r => !usedCounties.has(r.county));
    if (!candidates.length) continue;
    const row = candidates[Math.floor(rng() * candidates.length)];
    usedIndicators.add(indicatorId);
    usedCounties.add(row.county);
    rounds.push({ indicatorId, year: row.year, countyId: row.county });
  }
  if (rounds.length < ROUNDS_PER_DAY) {
    console.warn(`⚠ ${dateKey}: only ${rounds.length}/${ROUNDS_PER_DAY} rounds found`);
  }
  return rounds;
}

const puzzles = [];
for (let d = 0; d < DAYS; d++) {
  const [year, month, day] = FIRST_DATE.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + d);
  const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

  const rounds = roundsForDate(dateKey);
  puzzles.push({ id: d + 1, date: dateKey, rounds });
}

const outputPath = path.join(__dirname, '..', 'puzzles_test.json');
fs.writeFileSync(outputPath, JSON.stringify(puzzles, null, 2) + '\n');
console.log(`\n✓ puzzles.json: ${DAYS} days, ${DAYS * ROUNDS_PER_DAY} total rounds`);
