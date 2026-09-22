#!/usr/bin/env node
// Generate 30 days of balanced daily puzzles for 戰南北.
// Prefers indicators with good county coverage and pairs with similar values.
// Run this once to seed puzzles.json, then edit as desired.

import fs from 'fs';
import path from 'path';

const DAYS = 30;
const ROUNDS_PER_DAY = 7;
const FIRST_DATE = '2026-09-23';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const dataDir = path.join(__dirname, '..', 'data');
const counties = JSON.parse(fs.readFileSync(path.join(dataDir, 'counties.json'), 'utf8'));
const indicators = JSON.parse(fs.readFileSync(path.join(dataDir, 'indicators.json'), 'utf8'));
const values = JSON.parse(fs.readFileSync(path.join(dataDir, 'values.json'), 'utf8'));

const countyById = new Map(counties.map(c => [c.id, c]));
const indicatorById = new Map(indicators.map(i => [i.id, i]));

// Group values by indicator to assess county coverage
const byIndicator = new Map();
for (const v of values) {
  if (!countyById.has(v.county) || !indicatorById.has(v.indicator)) continue;
  if (!byIndicator.has(v.indicator)) byIndicator.set(v.indicator, []);
  byIndicator.get(v.indicator).push(v);
}

// Prefer indicators with full or near-full coverage (≥20/22 counties)
const coverageScore = (id) => {
  const rows = byIndicator.get(id) || [];
  const counties = new Set(rows.map(r => r.county));
  return counties.size >= 20 ? 100 : (counties.size >= 18 ? 50 : 0);
};

const playableIndicatorIds = [...byIndicator.keys()].filter(id => {
  const rows = byIndicator.get(id);
  return rows.length >= 2 && new Set(rows.map(r => r.value)).size >= 2;
}).sort((a, b) => coverageScore(b) - coverageScore(a)); // high coverage first

console.log(`Playable indicators: ${playableIndicatorIds.length} (${playableIndicatorIds.slice(0, 10).length} high-coverage)`);

// Distance score: prefer pairs with closer values (interesting guesses, not obvious)
function pairDist(a, b) {
  return Math.abs(a - b) / Math.max(a, b);
}

function roundsForDate(dateKey, usedIndicators) {
  const rounds = [];
  const candidates = playableIndicatorIds.filter(id => !usedIndicators.has(id));

  for (let attempt = 0; attempt < ROUNDS_PER_DAY * 10 && rounds.length < ROUNDS_PER_DAY; attempt++) {
    const idx = Math.floor(Math.random() * candidates.length);
    const indicatorId = candidates[idx];
    if (usedIndicators.has(indicatorId)) continue;

    const rows = byIndicator.get(indicatorId);
    if (rows.length < 2) continue;

    // Find a good pair: distinct values, reasonable distance
    let best = null;
    let bestScore = -Infinity;

    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        if (a.county === b.county || a.value === b.value) continue;

        const dist = pairDist(a.value, b.value);
        // Prefer medium distance (0.1 - 0.5): visible difference but not obvious
        const score = 1 - Math.abs(0.3 - dist);
        if (score > bestScore) {
          bestScore = score;
          best = [a, b];
        }
      }
    }

    if (!best || bestScore < -0.5) continue;

    const [a, b] = best;
    const swap = Math.random() < 0.5;
    const [left, right] = swap ? [b, a] : [a, b];
    const direction = Math.random() < 0.5 ? 'higher' : 'lower';

    rounds.push({
      indicatorId,
      year: a.year,
      left: { countyId: left.county, value: left.value },
      right: { countyId: right.county, value: right.value },
      direction,
    });
    usedIndicators.add(indicatorId);
  }

  if (rounds.length < ROUNDS_PER_DAY) {
    console.warn(`⚠ ${dateKey}: only ${rounds.length}/${ROUNDS_PER_DAY} rounds found`);
  }
  return rounds;
}

const puzzles = [];
const usedIndicators = new Set();

for (let d = 0; d < DAYS; d++) {
  const [year, month, day] = FIRST_DATE.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + d);
  const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

  const rounds = roundsForDate(dateKey, usedIndicators);
  puzzles.push({ id: d + 1, date: dateKey, rounds });

  if ((d + 1) % 10 === 0) console.log(`✓ Generated ${d + 1}/${DAYS} days`);
}

const outputPath = path.join(__dirname, '..', 'puzzles.json');
fs.writeFileSync(outputPath, JSON.stringify(puzzles, null, 2) + '\n');
console.log(`\n✓ puzzles.json: ${DAYS} days, ${DAYS * ROUNDS_PER_DAY} total rounds`);
