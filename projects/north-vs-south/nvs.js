// 戰南北 — daily "which county is higher/lower" game using real government
// statistics (data/{counties,indicators,values}.json, curated from the DGBAS
// county-indicator open dataset — see readme.md).
//
// Unlike who-is-older (which needs a human to pre-author birthday pairs),
// every round here is mechanically checkable from the shipped data, so the
// day's 7 rounds are generated ALGORITHMICALLY at runtime from a seed derived
// from the Taipei calendar date — no puzzles.json, no offline authoring step.
// Every visitor on the same Taipei day sees byte-identical rounds because the
// PRNG draw order in roundsForDate() is treated as frozen once shipped (see
// the seed-versioning note below).
//
// Routing: /projects/north-vs-south/           → today's rounds (Asia/Taipei)
//          /projects/north-vs-south/?d=2026-09-20 → rounds for that date (never future)

import {
  taipeiToday, daysBetween, msUntilTaipeiMidnight,
  esc, readStore, writeStore, share, flashShare, scheduleRollover,
  setupOverlayHideLogic, populateSwitcher, loadVersion,
} from '/projects/challenge.js';

const ROUNDS = 7;
const STORE_KEY = 'northvssouth.v1';
const FIRST_DATE = '2026-09-23'; // launch date — bounds the archive picker

// ── DEBUG ────────────────────────────────────────────────────────────────────
// Flip to true while developing locally, then flip back before committing.
//   ?replay=1              wipe today's saved progress and start it over
// Regardless of this flag, the browser console always has:
//   nvs.replay()       restart the game on screen
//   nvs.replayAll()    wipe every saved game
//   nvs.answers()      log the correct answer for every round
//   nvs.state          the live game state object
const DEBUG = false;
// ─────────────────────────────────────────────────────────────────────────────

const RANKS = [
  { min: 7, title: '', quip: '' },
  { min: 5, title: '', quip: '' },
  { min: 3, title: '', quip: '' },
  { min: 0, title: '', quip: '' },
];

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

// 'v1' seed prefix: bumping to 'v2' later lets a deliberate future change to
// roundsForDate()'s draw order ship without silently altering old replays.
function rngFor(dateKey) {
  return mulberry32(xmur3(`nvs:v1:${dateKey}`)());
}

/* ---------- wording heuristic ---------- */

// Manually audited overrides for indicators where the default 3-bucket
// heuristic (面積→大/小, ％/率→高/低, else→多/少) would read unnaturally.
// Add entries here as they're spotted; keyed by indicator.id (== name).
const WORD_OVERRIDES = new Map([
  // e.g. ['人口密度', ['高','低']],
]);

function wordPairFor(indicator) {
  if (WORD_OVERRIDES.has(indicator.id)) return WORD_OVERRIDES.get(indicator.id);
  const { name, unit } = indicator;
  if (name.includes('面積')) return ['大', '小'];
  if (unit.includes('公里')) return ['長', '短'];
  if (unit.includes('％') || name.includes('率') || unit.includes('歲') || unit.includes('元')) return ['高', '低'];
  return ['多', '少'];
}

function questionText(round, indicatorById) {
  const ind = indicatorById.get(round.indicatorId);
  const [hi, lo] = wordPairFor(ind);
  const word = round.direction === 'higher' ? hi : lo;
  return `哪個縣市${ind.name}比較${word}（${round.year}）？`;
}

function correctSide(r) {
  return r.direction === 'higher'
    ? (r.left.value > r.right.value ? 'left' : 'right')
    : (r.left.value < r.right.value ? 'left' : 'right');
}

const pad3 = n => String(n).padStart(3, '0');

/* ---------- entry point ---------- */

export async function mountNVS(cfg) {
  const [counties, indicators, values, puzzlesFile] = await Promise.all([
    fetch('data/counties.json').then(r => r.json()),
    fetch('data/indicators.json').then(r => r.json()),
    fetch('data/values.json').then(r => r.json()),
    fetch('puzzles.json').then(r => r.ok ? r.json() : null).catch(() => null),
  ]);

  const byPuzzleId = puzzlesFile ? new Map(puzzlesFile.map(p => [p.date, p])) : new Map();

  const countyById = new Map(counties.map(c => [c.id, c]));
  const indicatorById = new Map(indicators.map(i => [i.id, i]));

  const byIndicator = new Map();
  for (const v of values) {
    if (!countyById.has(v.county) || !indicatorById.has(v.indicator)) continue;
    if (!byIndicator.has(v.indicator)) byIndicator.set(v.indicator, []);
    byIndicator.get(v.indicator).push(v);
  }
  // Only indicators with >=2 counties reporting >=2 distinct values are
  // playable — everything else can never produce a fair round.
  const playableIndicatorIds = [...byIndicator.keys()].filter(id => {
    const rows = byIndicator.get(id);
    return rows.length >= 2 && new Set(rows.map(r => r.value)).size >= 2;
  });

  if (playableIndicatorIds.length < ROUNDS) {
    document.body.innerHTML = '<p style="padding:40px;text-align:center">資料還沒準備好。</p>';
    return;
  }

  /* ---------- round generation ---------- */

  function roundsForDate(dateKey) {
    // Load from authored puzzles.json if available; otherwise generate
    if (byPuzzleId.has(dateKey)) {
      return byPuzzleId.get(dateKey).rounds;
    }

    const rng = rngFor(dateKey);
    const usedIndicators = new Set();
    const rounds = [];
    let guard = 0;
    while (rounds.length < ROUNDS && guard++ < 5000) {
      const indicatorId = playableIndicatorIds[Math.floor(rng() * playableIndicatorIds.length)];
      if (usedIndicators.has(indicatorId)) continue;
      const rows = byIndicator.get(indicatorId);
      const a = rows[Math.floor(rng() * rows.length)];
      let b = rows[Math.floor(rng() * rows.length)], tries = 0;
      while ((b.county === a.county || b.value === a.value) && tries++ < 30) {
        b = rows[Math.floor(rng() * rows.length)];
      }
      if (b.county === a.county || b.value === a.value) continue;
      usedIndicators.add(indicatorId);
      const swap = rng() < 0.5;
      const [left, right] = swap ? [b, a] : [a, b];
      const direction = rng() < 0.5 ? 'higher' : 'lower';
      rounds.push({
        indicatorId, year: a.year,
        left: { countyId: left.county, value: left.value },
        right: { countyId: right.county, value: right.value },
        direction,
      });
    }
    if (rounds.length < ROUNDS) {
      console.warn(`[戰南北] ${dateKey} 只湊到 ${rounds.length}/${ROUNDS} 題`);
    }
    return rounds;
  }

  /* ---------- which date? ---------- */

  const params = new URLSearchParams(location.search);
  const debugReplay = DEBUG && params.get('replay') === '1';

  let today = taipeiToday();
  const requested = /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') || '') ? params.get('d') : null;
  const isFuture = requested && requested > today;
  const blocked = isFuture && !DEBUG; // allow future dates in debug mode
  let dateKey = (requested && !blocked) ? requested : today;
  let isArchive = dateKey !== today;

  if (params.has('d') && !isArchive && !DEBUG) {
    try { history.replaceState(null, '', './'); } catch (e) { /* non-fatal */ }
  }

  /* ---------- shell (built once) ---------- */

  document.body.innerHTML = `
<div class="topbar">
  <div class="brand">
    <h1><a href="./" id="homeLink">${esc(cfg.shareTitle)} </a><span id="pno">#001</span></h1>
    <div class="stats"><span>東西南北通通戰起來</span></div>
    <div class="switcher" id="switcher"></div>
  </div>
</div>
<div class="progressWrap"><div class="progressBar" id="pbar"></div></div>

<div class="wrap">
  <div class="archive-banner" id="archiveBanner"></div>
  <div class="stats" style="margin-bottom:12px;">
    <span>第 <b id="rno">1</b> / ${ROUNDS} 題</span>
  </div>
  <p class="question" id="qtext"></p>
  <div class="roundDots" id="dots"></div>
  <div class="arena" id="arena">
    <div class="ccard" id="cardL" data-side="left">
      <div class="cname" id="nameL"></div>
    </div>
    <div class="vs">VS</div>
    <div class="ccard" id="cardR" data-side="right">
      <div class="cname" id="nameR"></div>
    </div>
  </div>
  <div class="choices">
    <button id="btnResult">我不想玩了</button>
  </div>
  <a href="#" class="archive-link" id="archiveLink">玩以前的題目</a>
  <a href="#" class="archive-link" id="otherLink">其他挑戰</a>
  <p class="footer-note">
    ${cfg.footer}<br>
    純屬好玩<span class="ver" id="ver"></span>
  </p>
</div>

<div class="overlay" id="overlay">
  <div class="report">
    <h2 id="rpTitle"></h2>
    <p class="rp-quip">東西南北通通戰起來</p>
    <div class="rp-score" id="rpScore"></div>
    <div class="rp-rank" id="rpRank"></div>
    <p class="rp-quip" id="rpQuip"></p>
    <div class="rp-rounds" id="rpRounds"></div>
    <div class="rp-stack">
      <p class="rp-quip">🔥 每天 00:00 更新題目</p>
      <button id="rpSolution">檢討答案</button>
      <button id="rpShare" class="primary">分享結果</button>
      <button id="rpArchive">📅 玩以前的題目</button>
      <button id="rpDaily">📅 回到今天的題目</button>
      <button id="rpOther">其他挑戰</button>
    </div>
    <p class="footer-note" style="margin-top:12px">${cfg.footer}</p>
  </div>
</div>

<div class="overlay wide" id="review">
  <div class="panel">
    <div class="panel-hd">
      <h2>檢討答案</h2>
      <button class="x" id="revClose" aria-label="關閉">✕</button>
    </div>
    <p class="tab-hint">塗色的那個縣市是正確答案，綠色：答對，紅色：答錯。</p>
    <div id="revList"></div>
    <div class="rp-stack" style="margin-top:14px">
      <button id="revShare" class="primary">分享結果</button>
    </div>
  </div>
</div>

<div class="overlay wide" id="archive">
  <div class="panel">
    <div class="panel-hd">
      <h2>玩以前的題目</h2>
      <button class="x" id="arClose" aria-label="關閉">✕</button>
    </div>
    <p class="tab-hint">每天 00:00 出一題。以前的題目隨時可以補玩，成績會分開記錄。</p>
    <div id="arList"></div>
  </div>
</div>

<div class="overlay wide" id="other">
  <div class="panel">
    <div class="panel-hd">
      <h2>其他小遊戲</h2>
      <button class="x" id="otClose" aria-label="關閉">✕</button>
    </div>
    <div id="otGames" class="other-games"></div>
  </div>
</div>`;

  const $ = id => document.getElementById(id);
  const arena = $('arena'), overlay = $('overlay');

  populateSwitcher($, cfg);
  loadVersion('VERSION');
  setupOverlayHideLogic($);
  // Lock down the result overlay — Escape and click-outside don't close it
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('overlay').classList.contains('show')) {
      e.preventDefault();
    }
  }, true);
  // Override click-outside for main overlay only (allow other overlays to close)
  $('overlay').addEventListener('click', e => {
    if (e.target === $('overlay')) {
      e.stopPropagation();
    }
  }, true);

  /* ---------- state ---------- */

  let store = readStore(STORE_KEY);
  let rounds = [];
  let title = '';
  // choices[i] is 'left' | 'right' | null. Correctness is always derived from
  // the data, never stored, so fixing a value in values.json fixes old scores too.
  let state = { choices: [], finished: false };

  const gameKey = dk => `d${dk}`;
  const answered = () => state.choices.filter(Boolean).length;
  const score = () => rounds.reduce(
    (n, r, i) => n + (state.choices[i] && state.choices[i] === correctSide(r) ? 1 : 0), 0);
  const isOver = () => state.finished || answered() >= rounds.length;

  function blankState() { return { choices: Array(ROUNDS).fill(null), finished: false }; }

  function loadGame(dk) {
    const saved = store.games[gameKey(dk)];
    const s = blankState();
    if (saved && Array.isArray(saved.choices) && saved.choices.length === ROUNDS) {
      s.choices = saved.choices.slice();
      s.finished = Boolean(saved.finished);
    }
    return s;
  }

  function persist() {
    const g = store.games[gameKey(dateKey)] || {};
    store.games[gameKey(dateKey)] = { ...g, choices: state.choices, finished: state.finished };
    writeStore(STORE_KEY, store);
  }

  /* ---------- render ---------- */

  function currentIndex() {
    const i = state.choices.findIndex(c => !c);
    return i === -1 ? rounds.length : i;
  }

  function render() {
    const i = currentIndex();
    $('dots').innerHTML = rounds.map((_, n) =>
      `<i class="${state.choices[n] ? 'on' : (n === i ? 'now' : '')}"></i>`).join('');
    $('pbar').style.width = `${(answered() / rounds.length) * 100}%`;
    $('rno').textContent = String(Math.min(i + 1, rounds.length));

    if (i >= rounds.length) {
      arena.style.visibility = 'hidden';
      $('qtext').style.visibility = 'hidden';
      return;
    }
    arena.style.visibility = '';
    $('qtext').style.visibility = '';
    const r = rounds[i];
    const ind = indicatorById.get(r.indicatorId);
    const q = questionText(r, indicatorById);
    $('qtext').innerHTML = `<span class="q-text">${q}</span><div class="q-def">${esc(ind.definition)}</div>`;
    $('nameL').textContent = countyById.get(r.left.countyId).name;
    $('nameR').textContent = countyById.get(r.right.countyId).name;
    $('cardL').classList.remove('lit');
    $('cardR').classList.remove('lit');
  }

  function answer(choice) {
    if (isOver()) return;
    const i = currentIndex();
    if (i >= rounds.length) return;
    state.choices[i] = choice;
    if (answered() >= rounds.length) state.finished = true;
    persist();
    render();
    if (isOver()) showResult();
  }

  arena.addEventListener('click', e => {
    const card = e.target.closest('.ccard');
    if (!card || isOver()) return;
    answer(card.dataset.side);
  });

  document.addEventListener('keydown', e => {
    if (isOver()) return;
    const anyOverlayOpen = ['other', 'archive', 'review', 'overlay'].some(id => $(id).classList.contains('show'));
    if (anyOverlayOpen) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); answer('left'); }
    if (e.key === 'ArrowRight') { e.preventDefault(); answer('right'); }
  });

  /* ---------- result ---------- */

  const marks = () => rounds.map((r, i) =>
    state.choices[i] && state.choices[i] === correctSide(r) ? '🟩' : '🟥');

  const roundLines = () => rounds.map((r, i) =>
    `${countyById.get(r.left.countyId).name} vs ${countyById.get(r.right.countyId).name} ${marks()[i]}`);

  function roundsHTML() {
    const mk = marks();
    return rounds.map((r, i) => {
      const ind = indicatorById.get(r.indicatorId);
      return `<div class="rr"><span class="no">${i + 1}</span>`
        + `<span class="ind">${esc(ind.name)}</span>`
        + `<span class="pair">${esc(countyById.get(r.left.countyId).name)}<i>vs</i>${esc(countyById.get(r.right.countyId).name)}</span>`
        + `<span class="mk">${mk[i]}</span></div>`;
    }).join('');
  }

  function shareText() {
    const s = score();
    return `${title} ${s}/${rounds.length}\n\n${roundLines().join('\n')}`
      + `\n\n戰南北，你比較懂台灣嗎？\n🔗 ${cfg.shareUrl}?d=${dateKey}`;
  }

  function showResult() {
    const s = score();
    const rank = RANKS.find(r => s >= r.min);
    state.finished = true;
    persist();
    $('rpTitle').textContent = title;
    $('rpScore').textContent = `${s}/${rounds.length}`;
    $('rpRank').textContent = rank.title;
    $('rpQuip').textContent = rank.quip;
    $('rpRounds').innerHTML = roundsHTML();
    $('rpDaily').style.display = isArchive || blocked ? '' : 'none';
    overlay.classList.add('show');
  }

  /* ---------- archive (玩以前的題目) ---------- */

  function isPlayableDate(dk) { return dk <= today; }

  function savedScore(dk) {
    const g = store.games[gameKey(dk)];
    if (!g || !Array.isArray(g.choices) || g.choices.length !== ROUNDS) return null;
    const ans = g.choices.filter(Boolean).length;
    if (!ans) return null;
    const rs = roundsForDate(dk);
    const sc = rs.reduce((n, r, i) => n + (g.choices[i] && g.choices[i] === correctSide(r) ? 1 : 0), 0);
    return { answered: ans, score: sc, finished: Boolean(g.finished) };
  }

  function openArchive() {
    const dates = [];
    const span = daysBetween(FIRST_DATE, today);
    for (let n = span; n >= 0; n--) {
      const [year, month, day] = FIRST_DATE.split('-').map(Number);
      const d = new Date(Date.UTC(year, month - 1, day));
      d.setUTCDate(d.getUTCDate() + n);
      dates.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
    }
    $('arList').innerHTML = dates.map(dk => {
      const isToday = dk === today;
      const s = savedScore(dk);
      const status = !s ? '未挑戰'
        : s.finished ? `${s.score}/${ROUNDS}`
        : `進行中 ${s.answered}/${ROUNDS}`;
      return `<button class="plist" data-date="${dk}"${isToday && !isArchive ? ' disabled' : ''}>`
        + `<span class="pl-mid"><span class="pl-date">${esc(dk)}${isToday ? '（今天）' : ''}</span></span>`
        + `<span class="pl-status${s && s.finished ? ' done' : ''}">${status}</span></button>`;
    }).join('') || '<p class="tab-hint">還沒有以前的題目。</p>';
    $('archive').classList.add('show');
  }

  $('arList').addEventListener('click', e => {
    const b = e.target.closest('.plist');
    if (!b || b.disabled) return;
    location.href = `?d=${b.dataset.date}`;
  });

  /* ---------- review (檢討答案) ---------- */

  function openReview() {
    $('revList').innerHTML = rounds.map((r, i) => {
      const ind = indicatorById.get(r.indicatorId);
      const [hi, lo] = wordPairFor(ind);
      const word = r.direction === 'higher' ? hi : lo;
      const truth = correctSide(r);
      const ok = state.choices[i] === truth;
      const cell = (side, c) => {
        const isRight = truth === side;
        return `<span class="rev-c${isRight ? ` ok ${ok ? 'hit' : 'miss'}` : ''}">`
          + `<span class="nm">${esc(countyById.get(c.countyId).name)}</span>`
          + `<em>${c.value.toLocaleString('zh-TW')}${esc(ind.unit)}</em></span>`;
      };
      return `<div class="rev-row"><span class="no">${i + 1}</span>`
        + `<div class="rev-q"><span class="rev-ind">${esc(ind.name)} <span class="rev-word">${word}</span> （${r.year}）</span>`
        + `<button class="rev-info" data-def="${esc(ind.definition)}">?</button></div>`
        + `<div class="rev-pair">${cell('left', r.left)}<span class="rev-vs">vs</span>${cell('right', r.right)}</div></div>`;
    }).join('');

    // Add hover/click handlers for definition display
    // Detect touch capability to avoid double-display on mobile
    const isTouchDevice = () => {
      return (('ontouchstart' in window) ||
              (navigator.maxTouchPoints > 0) ||
              (navigator.msMaxTouchPoints > 0));
    };
    const isTouch = isTouchDevice();

    document.querySelectorAll('.rev-info').forEach(btn => {
      const def = btn.getAttribute('data-def');
      let defEl = null;
      let clicked = false;

      if (!isTouch) {
        // Desktop: show on hover
        btn.addEventListener('mouseenter', () => {
          if (!defEl && !clicked && def) {
            defEl = document.createElement('div');
            defEl.className = 'rev-def-popup';
            defEl.textContent = def;
            btn.insertAdjacentElement('afterend', defEl);
          }
        });
        btn.addEventListener('mouseleave', () => {
          if (defEl && !clicked) {
            defEl.remove();
            defEl = null;
          }
        });
      }

      // Mobile/touch: toggle on click
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const existing = btn.nextElementSibling;
        if (existing && (existing.classList.contains('rev-def-mobile') || existing.classList.contains('rev-def-popup'))) {
          existing.remove();
          defEl = null;
          clicked = false;
        } else if (def) {
          const mobileEl = document.createElement('div');
          mobileEl.className = isTouch ? 'rev-def-mobile' : 'rev-def-popup';
          mobileEl.textContent = def;
          btn.insertAdjacentElement('afterend', mobileEl);

          // For desktop popup, position it to match card width
          if (!isTouch) {
            const btnRect = btn.getBoundingClientRect();
            const arena = document.getElementById('arena');
            const arenaRect = arena ? arena.getBoundingClientRect() : null;
            if (arenaRect) {
              mobileEl.style.top = (btnRect.bottom + 4) + 'px';
              mobileEl.style.left = (arenaRect.left) + 'px';
              mobileEl.style.width = (arenaRect.width) + 'px';
            }
          }

          defEl = mobileEl;
          clicked = true;
        }
      });
    });

    $('review').classList.add('show');
  }

  /* ---------- buttons ---------- */

  $('btnResult').addEventListener('click', () => {
    if (!isOver()) {
      if (!confirm(`還有 ${rounds.length - answered()} 題沒答，現在看結果會直接結束這局。要繼續嗎？`)) return;
      state.finished = true;
      persist();
      render();
    }
    showResult();
  });
  $('rpShare').addEventListener('click', e => share(shareText(), e.currentTarget));
  $('revShare').addEventListener('click', e => share(shareText(), e.currentTarget));
  $('rpSolution').addEventListener('click', openReview);
  $('revClose').addEventListener('click', () => $('review').classList.remove('show'));
  $('rpOther').addEventListener('click', () => $('other').classList.add('show'));
  $('otClose').addEventListener('click', () => $('other').classList.remove('show'));
  $('rpArchive').addEventListener('click', openArchive);
  $('archiveLink').addEventListener('click', e => { e.preventDefault(); openArchive(); });
  $('otherLink').addEventListener('click', e => { e.preventDefault(); $('other').classList.add('show'); });
  $('arClose').addEventListener('click', () => $('archive').classList.remove('show'));
  $('rpDaily').addEventListener('click', () => { location.href = './'; });

  /* ---------- game setup ---------- */

  function setDate(dk) {
    dateKey = dk;
    isArchive = dateKey !== today;
    rounds = roundsForDate(dateKey);
    title = `${cfg.shareTitle} ${dateKey}`;
    if (debugReplay) {
      delete store.games[gameKey(dateKey)];
      writeStore(STORE_KEY, store);
    }
    state = loadGame(dateKey);
    if (DEBUG) {
      nvs.state = state;
      console.log(`[戰南北] date=${dateKey}, ${rounds.length}/${ROUNDS} rounds, saved=${store.games[gameKey(dateKey)] ? 'yes' : 'no'}`);
    }
    const puzzleNum = daysBetween(FIRST_DATE, dateKey) + 1;
    $('pno').textContent = `#${String(puzzleNum).padStart(3, '0')}`;
    const banner = $('archiveBanner');
    if (blocked) {
      banner.innerHTML = '這一題還沒開放，先玩今天的吧。 <a href="./">回到今天</a>';
      banner.style.display = '';
    } else if (isArchive) {
      banner.innerHTML = `這是 ${dateKey} 的題目。 <a href="./">回到今天</a>`;
      banner.style.display = '';
    } else {
      banner.style.display = 'none';
    }
    overlay.classList.remove('show');
    render();
    if (isOver()) showResult();
  }

  /* ---------- console helpers ---------- */

  const nvs = {
    replay() {
      delete store.games[gameKey(dateKey)];
      writeStore(STORE_KEY, store);
      setDate(dateKey);
    },
    replayAll() { store = { v: 1, games: {} }; writeStore(STORE_KEY, store); setDate(dateKey); },
    get rounds() { return rounds; },
    answers() {
      rounds.forEach((r, i) => console.log(
        `${i + 1} ${countyById.get(r.left.countyId).name} (${r.left.value}) vs `
        + `${countyById.get(r.right.countyId).name} (${r.right.value}) → ${correctSide(r)}`));
    },
    state,
  };
  window.nvs = nvs;

  setDate(dateKey);

  if (!isArchive) {
    scheduleRollover(newDate => {
      if (newDate !== today) {
        today = newDate;
        store = readStore(STORE_KEY);
        setDate(newDate);
      }
      return true; // keep looping forever
    });
  }
}
