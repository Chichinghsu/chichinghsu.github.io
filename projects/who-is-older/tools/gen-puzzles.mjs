// Generate daily puzzles for 博愛座大挑戰 into puzzles.json.
//
//   node tools/gen-puzzles.mjs --start 2026-08-21 --days 10 [--seed 42] [--out puzzles.json]
//
// The game itself no longer generates anything at runtime — every puzzle is
// authored data. This script is where the difficulty rules live:
//
//   * ROUNDS pairs per day.
//   * At least CLOSE_PAIRS of them are within MAX_GAP_YEARS of each other, so a day
//     isn't padded with 90歲 vs 20歲 gimmes.
//   * TIE_DAYS days include one exact same-birthday pair, so 「同年同月同日生」
//     is a real answer often enough to be worth considering, but not predictable.
//   * A person appears at most once per day, and no unordered pair is ever reused
//     across the whole run.
//
// Deterministic given --seed, so a run can be reproduced or extended.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUNDS = 7;
const CLOSE_PAIRS = 4;
const MAX_GAP_YEARS = 8;
const TIE_DAYS = 3;
const EXCLUDE_TAG = '已故';

const here = path.dirname(fileURLToPath(import.meta.url));
const PEOPLE = path.join(here, '..', '..', 'taiwan-grid', 'people.json');

/* ---------- args ---------- */

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const START = arg('start', null);
const DAYS = Number(arg('days', 10));
const SEED = Number(arg('seed', 20260821));
const ID = Number(arg('id', 1));
const OUT = path.join(here, '..', arg('out', 'puzzles_test.json'));
if (!/^\d{4}-\d{2}-\d{2}$/.test(START || '')) {
  console.error('usage: node tools/gen-puzzles.mjs --start YYYY-MM-DD --days 10 [--seed N]');
  process.exit(1);
}

/* ---------- seeded RNG (mulberry32) ---------- */

let s = SEED >>> 0;
const rnd = () => {
  s = (s + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ---------- pool ---------- */

const parseDob = raw => {
  const m = String(raw || '').match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
};
const people = JSON.parse(fs.readFileSync(PEOPLE, 'utf8'));
const pool = people.filter(p => {
  const b = parseDob(p.properties.birthday);
  if (!b) return false;                                        // needs a full date
  if ((p.properties.tags || []).includes(EXCLUDE_TAG)) return false;
  if (/PLACEHOLDER/i.test(p.name)) return false;               // test rows
  return true;
});
const at = new Map(pool.map(p => {
  const b = parseDob(p.properties.birthday);
  return [p.id, Date.UTC(b.y, b.m - 1, b.d)];
}));
const gapYears = (a, b) => Math.abs(at.get(a.id) - at.get(b.id)) / (365.2425 * 86400000);

if (pool.length < ROUNDS * 2) {
  console.error(`pool too small: ${pool.length} eligible people, need ${ROUNDS * 2}`);
  process.exit(1);
}

// Every close pair, and every exact tie, precomputed once.
const closePairs = [], tiePairs = [];
for (let i = 0; i < pool.length; i++) {
  for (let j = i + 1; j < pool.length; j++) {
    const g = gapYears(pool[i], pool[j]);
    if (g === 0) tiePairs.push([pool[i], pool[j]]);
    if (g <= MAX_GAP_YEARS) closePairs.push([pool[i], pool[j]]);
  }
}
console.log(`pool=${pool.length}  closePairs(<=${MAX_GAP_YEARS}y)=${closePairs.length}  tiePairs=${tiePairs.length}`);

/* ---------- build ---------- */

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
const key = (a, b) => [a.id, b.id].sort().join('|');
const usedPairs = new Set();              // never reuse a matchup across the run
// Which days get a tie, spread out rather than clustered.
const tieDays = new Set(shuffle([...Array(DAYS).keys()]).slice(0, Math.min(TIE_DAYS, tiePairs.length)));

function buildDay(dayIndex) {
  const usedPeople = new Set();           // one appearance per person per day
  const rounds = [];
  const take = (a, b) => {
    if (!a || !b || a.id === b.id) return false;
    if (usedPeople.has(a.id) || usedPeople.has(b.id)) return false;
    if (usedPairs.has(key(a, b))) return false;
    usedPairs.add(key(a, b));
    usedPeople.add(a.id); usedPeople.add(b.id);
    rounds.push(rnd() < 0.5 ? [a, b] : [b, a]);
    return true;
  };

  if (tieDays.has(dayIndex)) {
    for (const [a, b] of shuffle(tiePairs)) if (take(a, b)) break;
  }
  // Close pairs up to the quota (a tie already counts as close).
  for (const [a, b] of shuffle(closePairs)) {
    if (rounds.length >= CLOSE_PAIRS) break;
    take(a, b);
  }
  // Fill the rest from anywhere, so difficulty still varies.
  let guard = 0;
  while (rounds.length < ROUNDS && guard++ < 20000) {
    take(pick(pool), pick(pool));
  }
  if (rounds.length < ROUNDS) throw new Error(`day ${dayIndex}: only built ${rounds.length}/${ROUNDS} rounds`);
  return shuffle(rounds);
}

const puzzles = [];
for (let i = ID - 1; i < ID+DAYS-1; i++) {
  const rounds = buildDay(i);
  puzzles.push({ id: i + 1, date: addDays(START, i  - ID + 1), pairs: rounds.map(([a, b]) => [a.id, b.id]) });
  const close = rounds.filter(([a, b]) => gapYears(a, b) <= MAX_GAP_YEARS).length;
  const ties = rounds.filter(([a, b]) => gapYears(a, b) === 0).length;
  console.log(`#${String(i + 1).padStart(3, '0')} ${addDays(START, i - ID)}  close=${close}/${ROUNDS} ties=${ties}  `
    + rounds.map(([a, b]) => `${a.name}/${b.name}`).join(', '));
}

fs.writeFileSync(OUT, JSON.stringify(puzzles, null, 2) + '\n');
console.log(`\nwrote ${puzzles.length} puzzles → ${path.relative(process.cwd(), OUT)}`);
