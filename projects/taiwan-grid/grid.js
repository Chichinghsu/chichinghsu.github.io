// 台灣九宮格 — static daily grid puzzle. No backend, no login, no build step.
// Data lives in people.json / puzzles.json / conditions.json; this file is logic + UI only.
//
// Routing: /projects/taiwan-grid/        → today's puzzle (Asia/Taipei)
//          /projects/taiwan-grid/?p=7    → puzzle with permanent id 7

const MAX_GUESSES = 11;
// v3 — people.json ids were renumbered to tw-NNN, orphaning v2's saved games.
// Saved games key on person id, so any id change needs a bump here.
const STORE_KEY = 'twgrid.v3';
const TAIPEI_OFFSET_MIN = 8 * 60;   // UTC+8, no DST — Taiwan has never observed it since 1980

// ── DEBUG ────────────────────────────────────────────────────────────────────
// Flip to true while developing locally, then flip back before committing.
// It unlocks two URL params:
//   ?replay=1              wipe this puzzle's saved progress and start it over
//   ?date=2026-09-05       pretend it is that Taipei day (picks that day's puzzle)
// Leave false in production: ?replay=1 would let anyone re-roll their daily score,
// which makes the shared 🟩 grids meaningless.
//
// Regardless of this flag, the browser console always has:
//   twgrid.replay()        restart the puzzle on screen
//   twgrid.replayAll()     wipe every saved game
//   twgrid.answers()       log the valid answers for all 9 cells
//   twgrid.state           the live game state object
const DEBUG = false;
// ─────────────────────────────────────────────────────────────────────────────

const RANKS = [
  { min: 9, title: '', quip: '名人你全認識！' },
  { min: 8, title: '',     quip: '' },
  { min: 7, title: '',   quip: '' },
  { min: 6, title: '',   quip: '' },
  { min: 5, title: '',   quip: '' },
  { min: 4, title: '',   quip: '' },
  { min: 3, title: '',   quip: '' },
  { min: 2, title: '',   quip: '' },
  { min: 1, title: '', quip: '' },
  { min: 0, title: '',   quip: '' },
];

/* ---------- Asia/Taipei calendar day, independent of device timezone ---------- */

const pad2 = n => String(n).padStart(2, '0');

function taipeiToday(now = new Date()) {
  const d = new Date(now.getTime() + TAIPEI_OFFSET_MIN * 60000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// ms until the next Taipei midnight — used to roll the puzzle over without a reload
function msUntilTaipeiMidnight(now = new Date()) {
  const d = new Date(now.getTime() + TAIPEI_OFFSET_MIN * 60000);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return next - d.getTime();
}

/* ---------- storage ---------- */

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && obj.games) return obj;
  } catch (e) { /* ignore */ }
  return { v: 3, games: {} };
}

function writeStore(obj) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(obj));
  } catch (e) { /* private mode / quota — game stays playable in memory */ }
}

/* ---------- conditions ---------- */

function makeMatcher(defs) {
  const taiwan = new Set(defs.taiwanPlaces);
  return function matches(key, person) {
    const def = defs.conditions[key];
    if (!def) return false;
    if (def.mode === 'foreign') {
      const cities = person.properties.birth_city || [];
      return cities.length > 0 && cities.some(c => !taiwan.has(c));
    }
    if (def.mode === 'decadeRange') {
      // minDecade/maxDecade are decade *starts*, e.g. maxDecade 1970 means
      // "the 1970s or earlier" — i.e. everyone born 1979 or before.
      return (person.properties.birth_decade || [])
        .map(d => parseInt(d, 10))
        .filter(n => Number.isFinite(n))
        .some(n => (def.minDecade === undefined || n >= def.minDecade)
                && (def.maxDecade === undefined || n <= def.maxDecade));
    }
    const i = key.indexOf(':');
    return (person.properties[key.slice(0, i)] || []).includes(key.slice(i + 1));
  };
}

/* ---------- search ---------- */

const norm = s => s.toLowerCase().replace(/\s+/g, '');

// Matching is prefix-only and in order, so 「清」 never surfaces 賴清德 — you have to
// start from the first character. Currently every name shows from the first character
// typed; return 2 for long names here to make 3+ character names wait for two.
const minChars = target => (target.length >= 3 ? 1 : 1);

function prefixHit(target, q) {
  return q.length >= minChars(target) && target.startsWith(q);
}

// Generous limit on purpose: the list is height-capped in CSS and scrolls, so more
// candidates cost nothing visually and 陳/林/李 stop being truncated at 8.
function searchPeople(people, query, limit = 40) {
  const q = norm(query);
  if (!q) return [];
  const hits = [];
  for (const p of people) {
    let rank = -1;
    if (prefixHit(norm(p.name), q)) rank = 0;
    else if ((p.aka || []).some(a => prefixHit(norm(a), q))) rank = 1;
    if (rank >= 0) hits.push({ p, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.p.name.length - b.p.name.length);
  return hits.slice(0, limit).map(h => h.p);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- entry point ---------- */

export async function mountGrid(cfg) {
  const [people, puzzles, condDefs] = await Promise.all([
    fetch('people.json').then(r => r.json()),
    fetch('puzzles.json').then(r => r.json()),
    fetch('conditions.json').then(r => r.json()),
  ]);

  const matches = makeMatcher(condDefs);
  const label = key => (condDefs.conditions[key] || {}).label || key;
  const byId = new Map(people.map(p => [p.id, p]));
  // Saved games hold person ids. If an id ever disappears from people.json the
  // stored id is all we have left — show it rather than throwing on undefined.
  const nameOf = pid => (byId.get(pid) || {}).name || pid;
  const byPuzzleId = new Map(puzzles.map(p => [p.id, p]));
  const firstDate = puzzles[0].date;

  /* ---------- which puzzle? ---------- */

  // Today's puzzle: exact date match, else cycle through the authored list so the
  // game keeps rolling over at Taipei midnight without a deploy.
  function puzzleForDate(dateKey) {
    const exact = puzzles.find(p => p.date === dateKey);
    if (exact) return exact;
    const n = daysBetween(firstDate, dateKey);
    return puzzles[((n % puzzles.length) + puzzles.length) % puzzles.length];
  }

  const params = new URLSearchParams(location.search);
  const debugDate = DEBUG && /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '')
    ? params.get('date') : null;

  let today = debugDate || taipeiToday();
  const todaysPuzzle = puzzleForDate(today);

  // A puzzle is only reachable once its own date has arrived in Taipei — ?p= must not
  // leak tomorrow's grid. Unknown ids and future ids both fall back to today.
  const isPlayable = p => p.date <= today || p.id === todaysPuzzle.id;

  const wantedId = Number(params.get('p'));
  const wanted = wantedId ? byPuzzleId.get(wantedId) : null;
  const blocked = Boolean(wanted) && !isPlayable(wanted);
  const isArchive = Boolean(wanted) && !blocked && wanted.id !== todaysPuzzle.id;

  let puzzle = isArchive ? wanted : todaysPuzzle;

  if (params.has('p') && !isArchive && !DEBUG) {
    // Strip a bad/future/redundant ?p= so the URL matches what's actually on screen.
    try { history.replaceState(null, '', './'); } catch (e) { /* non-fatal */ }
  }

  /* ---------- shell (built once) ---------- */

  document.body.innerHTML = `
<div class="topbar">
  <div class="brand">
    <h1><a href="./" id="homeLink">台灣九宮格 </a><span id="pno">#000</span></h1>
    <div class="stats"><span>每天一起認識（不一定是台灣人的）台灣名人</span></div>
    <div class="switcher" id="switcher"></div>
  </div>
  <div class="stats">
    <span>答題次數 <b id="left">9</b> / ${MAX_GUESSES}</span>
    <span>答對 <b class="pct" id="hit">0</b> / 9</span>
  </div>
</div>
<div class="progressWrap"><div class="progressBar" id="pbar"></div></div>

<div class="wrap">
  <div class="archive-banner" id="archiveBanner"></div>
  <p class="tagline">每格都要同時符合<strong>橫列</strong>與<strong>直行</strong>兩個條件。<br>隨便選一格開始作答，只有資料庫裡面有的名字才算。</p>
  <div class="grid" id="grid"></div>
  <div class="feedback" id="fb"></div>
  <div class="actions">
    <button id="giveUp">放棄本題</button>
    <button id="openResult" class="primary">查看結果</button>
  </div>
  <a href="#" class="archive-link" id="archiveLink">挑戰以前的題目</a>
  <p class="footer-note">
    資料整理自維基百科等公開資料，可能有誤，僅供娛樂。<br>必有疏漏，歡迎回報 → <a href="https://www.threads.com/@jppro.tw" target="_blank" rel="nofollow noopener">Threads</a><br>
    純屬好玩
  </p>
</div>

<div class="sheet-bd" id="sheetBd"></div>
<div class="sheet" id="sheet">
  <div class="sheet-hd">
    <div class="conds" id="sheetConds"></div>
    <button class="x" id="sheetClose" aria-label="關閉">✕</button>
  </div>
  <input type="text" id="q" autocomplete="off" autocapitalize="off" autocorrect="off"
         spellcheck="false" placeholder="請輸入人名..." />
  <div class="sugg" id="sugg"></div>
</div>

<div class="overlay" id="overlay">
  <div class="report">
    <h2 id="rpTitle"></h2>
    <p class="rp-quip">每天一起認識（不一定是台灣人的）台灣名人</p>
    <div class="rp-score" id="rpScore"></div>
    <div class="rp-rank" id="rpRank"></div>
    <p class="rp-quip" id="rpQuip"></p>
    <div class="rp-emoji" id="rpEmoji"></div>
    <div class="rp-stack">
      <p class="rp-quip">🔥 每天 00:00 更新題目</p>
      <button id="rpInsights" class="primary">九宮格詳解</button>
      <button id="rpOther">挑戰以前的題目</button>
      <button id="rpShare" class="primary">分享結果</button>
    </div>
    <p class="footer-note" style="margin-top:12px">資料整理自維基百科等公開資料，可能有誤，僅供娛樂。<br>必有疏漏，歡迎回報 → <a href="https://www.threads.com/@jppro.tw" target="_blank" rel="nofollow noopener">Threads</a></p>
  </div>
</div>

<div class="overlay wide" id="insights">
  <div class="panel">
    <div class="panel-hd">
      <h2 id="inTitle">詳細分析</h2>
      <button class="x" id="inClose" aria-label="關閉">✕</button>
    </div>
    <div class="tabs">
      <button class="tab on" data-tab="ans">正確答案</button>
      <button class="tab" data-tab="wrong">檢討答案</button>
    </div>
    <div id="tabAns">
      <p class="tab-hint">點任一格，看看這一格有哪些人可以填。</p>
      <div class="grid insight-grid" id="inGrid"></div>
    </div>
    <div id="tabWrong" style="display:none">
      <p class="tab-hint" id="wrHint"></p>
      <div class="grid insight-grid" id="wrGrid"></div>
    </div>
  </div>
</div>

<div class="overlay" id="other">
  <div class="panel">
    <div class="panel-hd">
      <h2>挑戰以前的題目</h2>
      <button class="x" id="otClose" aria-label="關閉">✕</button>
    </div>
    <div id="otList"></div>
    <h3 class="other-h3">其他小遊戲</h3>
    <div id="otGames" class="other-games"></div>
  </div>
</div>

<div class="pop-bd" id="popBd"></div>
<div class="pop" id="pop">
  <div class="pop-hd"><span id="popCond"></span><button class="x" id="popClose" aria-label="關閉">✕</button></div>
  <div class="pop-body" id="popBody"></div>
</div>`;

  const $ = id => document.getElementById(id);
  const grid = $('grid'), fb = $('fb'), sheet = $('sheet'), sheetBd = $('sheetBd'),
        qInput = $('q'), sugg = $('sugg'), overlay = $('overlay');

  $('switcher').innerHTML = (cfg.links || [])
    .map(l => `<a href="${l.href}">${esc(l.text)}</a>`).join('');
  $('otGames').innerHTML = (cfg.links || [])
    .map(l => `<a class="gamecard" href="${l.href}">${esc(l.text)}</a>`).join('');

  /* ---------- per-puzzle state ---------- */

  let store = readStore();
  let state, cellConds, solutions, title;

  function blankGame() {
    return {
      cells: Array(9).fill(null),     // null | personId (correct)
      misses: Array(9).fill(null).map(() => []),  // personId[] per cell
      skipped: Array(9).fill(false),
      usedIds: [],
      guessesUsed: 0,
      finished: false,
      gaveUp: false,
      quipCell: null,   // cell index the 「到底是誰…」 line is built from, once chosen
    };
  }

  function loadGame(p) {
    const saved = store.games[String(p.id)];
    const g = { ...blankGame(), ...(saved || {}) };
    // guard against a hand-edited or older store
    if (!Array.isArray(g.cells) || g.cells.length !== 9) return blankGame();
    if (!Array.isArray(g.misses) || g.misses.length !== 9) g.misses = Array(9).fill(null).map(() => []);
    if (!Array.isArray(g.skipped) || g.skipped.length !== 9) g.skipped = Array(9).fill(false);
    return g;
  }

  function persist() {
    store.games[String(puzzle.id)] = state;
    writeStore(store);
  }

  const solved = () => state.cells.filter(Boolean).length;
  const deadCells = () => state.cells.filter((c, i) => !c && state.skipped[i]).length;
  const remaining = () => Math.max(0, MAX_GUESSES - state.guessesUsed);
  const isOver = () =>
    state.finished || remaining() <= 0 || solved() + deadCells() === 9;

  function setPuzzle(p) {
    puzzle = p;
    state = loadGame(p);
    cellConds = [];
    for (const r of puzzle.rows) for (const c of puzzle.columns) cellConds.push({ row: r, col: c });
    solutions = cellConds.map(({ row, col }) =>
      people.filter(pp => matches(row, pp) && matches(col, pp)));
    solutions.forEach((s, i) => {
      if (!s.length) console.warn(
        `[台灣九宮格 #${puzzle.id}] 第 ${i + 1} 格無解：${label(cellConds[i].row)} × ${label(cellConds[i].col)}`);
    });
    title = `${cfg.shareTitle} #${String(puzzle.id).padStart(3, '0')}`;
    buildBoard();
    renderArchiveBanner();
    render();
    persist();
    if (isOver()) showResult(); else overlay.classList.remove('show');
  }

  /* ---------- board ---------- */

  let cellEls = [];

  function boardHTML(cls) {
    return [
      '<div class="corner"></div>',
      ...puzzle.columns.map(c => `<div class="hd col">${esc(label(c))}</div>`),
      ...puzzle.rows.map((r, ri) => [
        `<div class="hd row">${esc(label(r))}</div>`,
        ...puzzle.columns.map((c, ci) =>
          `<button class="${cls}" data-i="${ri * 3 + ci}"><span class="plus">＋</span></button>`),
      ].join('')),
    ].join('');
  }

  function buildBoard() {
    grid.innerHTML = boardHTML('cell');
    cellEls = [...grid.querySelectorAll('.cell')];
  }

  function renderCells() {
    cellEls.forEach((el, i) => {
      const pid = state.cells[i];
      if (pid) {
        el.className = 'cell done';
        el.innerHTML = `<span>${esc(nameOf(pid))}</span>`;
        el.disabled = true;
      } else if (state.skipped[i] || isOver()) {
        el.className = 'cell miss';
        el.innerHTML = '<span class="plus">✕</span>';
        el.disabled = true;
      } else {
        el.className = 'cell';
        el.innerHTML = '<span class="plus">＋</span>';
        el.disabled = false;
      }
    });
  }

  function renderStats() {
    $('pno').textContent = `#${String(puzzle.id).padStart(3, '0')}`;
    $('left').textContent = remaining();
    $('hit').textContent = solved();
    $('pbar').style.width = `${(state.guessesUsed / MAX_GUESSES) * 100}%`;
    const over = isOver();
    $('openResult').style.display = over ? '' : 'none';
    $('giveUp').style.display = over ? 'none' : '';
  }

  function renderArchiveBanner() {
    const b = $('archiveBanner');
    if (!isArchive) { b.style.display = 'none'; return; }
    b.style.display = '';
    b.innerHTML = `這是舊題目 #${String(puzzle.id).padStart(3, '0')}（${puzzle.date}）` +
                  ` · <a href="./">今天的題目</a>`;
  }

  const render = () => { renderCells(); renderStats(); };

  /* ---------- bottom sheet ---------- */

  let activeCell = null;

  function openSheet(i) {
    if (isOver() || state.cells[i] || state.skipped[i]) return;
    activeCell = i;
    const { row, col } = cellConds[i];
    $('sheetConds').innerHTML = `${esc(label(row))}<i>×</i>${esc(label(col))}`;
    qInput.value = '';
    sugg.innerHTML = '<div class="empty"></div>';
    sheetBd.classList.add('show');
    sheet.classList.add('show');
    setTimeout(() => qInput.focus(), 60);
  }

  function closeSheet() {
    activeCell = null;
    sheet.classList.remove('show');
    sheetBd.classList.remove('show');
    qInput.blur();
  }

  function renderSuggestions() {
    const q = qInput.value.trim();
    if (!q) { sugg.innerHTML = '<div class="empty"></div>'; return; }
    const hits = searchPeople(people, q);
    if (!hits.length) { sugg.innerHTML = '<div class="empty">目前資料庫裡沒有這個人 (ಥ_ಥ) 我有空會加入。</div>'; return; }
    sugg.innerHTML = hits.map(p => {
      const used = state.usedIds.includes(p.id);
      return `<button data-pid="${esc(p.id)}"${used ? ' disabled' : ''}>${esc(p.name)}` +
             `${used ? '<span class="sub">已用過</span>' : ''}</button>`;
    }).join('');
  }

  /* ---------- guessing ---------- */

  function guess(personId) {
    if (activeCell === null || isOver()) return;
    const i = activeCell;
    const person = byId.get(personId);
    if (!person) return;

    if (state.usedIds.includes(personId)) {
      say(`${person.name} 已出現過，不可再使用`, 'no');
      return;   // does not cost a guess
    }

    const { row, col } = cellConds[i];
    const ok = matches(row, person) && matches(col, person);

    state.guessesUsed += 1;
    if (ok) {
      state.cells[i] = personId;
      state.usedIds.push(personId);
    }
    else {
      state.misses[i].push(personId);
    }

    finishIfDone();
    persist();
    closeSheet();
    render();

    const el = cellEls[i];
    if (ok) {
      el.classList.add('pop-anim');
      setTimeout(() => el.classList.remove('pop-anim'), 460);
      say(`${person.name} 正解！`, 'ok');
    } else {
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 360);
      say(`${person.name} 不符合「${label(row)} × ${label(col)}」`, 'no');
    }
    if (isOver()) setTimeout(showResult, 700);
  }

  function giveUp() {
    if (isOver()) return;
    if (!confirm('放棄本題？剩下的格子會直接結算，之後不能再作答。')) return;
    state.gaveUp = true;
    state.finished = true;
    persist();
    render();
    showResult();
  }

  function finishIfDone() {
    if (remaining() <= 0 || solved() + deadCells() === 9) state.finished = true;
  }

  let sayTimer = null;
  function say(msg, kind) {
    fb.textContent = msg;
    fb.className = `feedback ${kind || ''}`;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { fb.textContent = ''; fb.className = 'feedback'; }, 3200);
  }

  /* ---------- result ---------- */

  const emojiRows = () => [0, 1, 2].map(r =>
    [0, 1, 2].map(c => state.cells[r * 3 + c] ? '🟩' : '🟥').join(' '));

  // Pick one cell the player failed and turn its two conditions into a rhetorical
  // grumble — 「到底是誰 歌手 又 金曲獎得主？」 — which is the most shareable part of a
  // bad round. Cells they actually guessed wrong at are preferred over ones they
  // never attempted; the choice is stored so reopening the card (or sharing later)
  // always shows the same line as the screenshot they took.
  function pickQuipCell() {
    if (Number.isInteger(state.quipCell) && !state.cells[state.quipCell]) return;
    const unsolved = cellConds.map((_, i) => i).filter(i => !state.cells[i]);
    if (!unsolved.length) { state.quipCell = null; return; }
    const attempted = unsolved.filter(i => state.misses[i].length);
    const pool = attempted.length ? attempted : unsolved;
    state.quipCell = pool[Math.floor(Math.random() * pool.length)];
  }

  function quipText() {
    if (!Number.isInteger(state.quipCell)) return '';
    const { row, col } = cellConds[state.quipCell];
    return `到底誰是 ${label(row)} 又 ${label(col)}？`;
  }

  const shareText = () => {
    const quip = quipText();
    return `${title}\n\n${emojiRows().join('\n')}\n\n${solved()}/9` +
      (quip ? `\n${quip}` : '') +
      `\n\n🔗 ${cfg.shareUrl}` + `?p=${puzzle.id}`;
  };

  function showResult() {
    const s = solved();
    const rank = RANKS.find(r => s >= r.min);
    pickQuipCell();
    persist();
    $('rpTitle').textContent = title;
    $('rpRank').textContent = state.gaveUp && s < 9 ? '中途放棄' : rank.title;
    $('rpQuip').textContent = quipText() || rank.quip;
    $('rpEmoji').innerHTML = emojiRows().join('<br>');
    $('rpScore').textContent = `${s}/9`;
    overlay.classList.add('show');
  }

  /* ---------- insights ---------- */

  function openInsights() {
    $('inTitle').textContent = `${title} 戰績分析`;
    $('inGrid').innerHTML = boardHTML('cell insight');
    [...$('inGrid').querySelectorAll('.cell')].forEach((el, i) => {
      const pid = state.cells[i];
      el.disabled = false;
      if (pid) {
        el.className = 'cell insight done';
        el.innerHTML = `<span>${esc(nameOf(pid))}</span>`;
      } else {
        el.className = 'cell insight miss';
        el.innerHTML = `<span class="cnt">${solutions[i].length} 人</span>`;
      }
    });
    showTab('ans');
    $('insights').classList.add('show');
  }

  function showTab(which) {
    [...document.querySelectorAll('.tab')].forEach(t =>
      t.classList.toggle('on', t.dataset.tab === which));
    $('tabAns').style.display = which === 'ans' ? '' : 'none';
    $('tabWrong').style.display = which === 'wrong' ? '' : 'none';
    if (which === 'wrong') renderWrongTab();
  }

  function renderWrongTab() {
    const total = state.misses.reduce((n, m) => n + m.length, 0);
    $('wrHint').textContent = total
      ? `這題你猜錯 ${total} 次。點紅色的格子，看看錯在哪裡。`
      : '這題你沒有猜錯';
    $('wrGrid').innerHTML = boardHTML('cell insight');
    [...$('wrGrid').querySelectorAll('.cell')].forEach((el, i) => {
      const n = state.misses[i].length;
      if (n) {
        el.className = 'cell insight wrong';
        el.innerHTML = `<span class="cnt">錯 ${n} 次</span>`;
        el.disabled = false;
      } else if (state.cells[i]) {
        el.className = 'cell insight done';
        el.innerHTML = `<span>${esc(nameOf(state.cells[i]))}</span>`;
        el.disabled = true;
      } else {
        el.className = 'cell insight blank';
        el.innerHTML = `<span class="cnt">${state.skipped[i] ? '跳過' : '沒作答'}</span>`;
        el.disabled = true;
      }
    });
  }

  // mode 'ans'  → every valid answer for the cell
  // mode 'wrong' → each of your wrong guesses, with the half that failed marked
  function openPop(i, mode) {
    const { row, col } = cellConds[i];
    $('popCond').textContent = `${label(row)} × ${label(col)}`;
    if (mode === 'wrong') {
      const rows = state.misses[i].map(pid => {
        const p = byId.get(pid);
        const mark = key => `<span class="${matches(key, p) ? 'y' : 'n'}">` +
          `${matches(key, p) ? '✓' : '✗'} ${esc(label(key))}</span>`;
        return `<div class="wr-row"><b>${esc(p.name)}</b>${mark(row)}${mark(col)}</div>`;
      }).join('');
      $('popBody').innerHTML =
        `<p class="pop-count">你在這格猜錯 ${state.misses[i].length} 次</p><div class="wrongs">${rows}</div>` +
        (state.cells[i] ? `<p class="pop-mine">最後答對了：<b>${esc(nameOf(state.cells[i]))}</b> ✓</p>` : '');
    } else {
      const names = solutions[i].map(p => p.name);
      const mine = state.cells[i];
      $('popBody').innerHTML =
        (mine ? `<p class="pop-mine">你填的是 <b>${esc(nameOf(mine))}</b> ✓</p>` : '') +
        (names.length
          ? `<p class="pop-count">共 ${names.length} 個可能答案</p><div class="ans-list">${esc(names.join('、'))}</div>`
          : '<div class="ans-none">（資料庫中暫無符合的人物）</div>');
    }
    $('popBd').classList.add('show');
    $('pop').classList.add('show');
  }

  const closePop = () => { $('popBd').classList.remove('show'); $('pop').classList.remove('show'); };

  /* ---------- other puzzles ---------- */

  function openOther() {
    const list = puzzles
      .filter(p => p.date <= today)
      .sort((a, b) => b.id - a.id)
      .map(p => {
        const g = store.games[String(p.id)];
        const done = g && (g.finished || (g.cells || []).filter(Boolean).length + 0 >= 9);
        const status = !g ? '未挑戰'
          : done ? `${g.cells.filter(Boolean).length}/9`
          : `進行中 ${g.cells.filter(Boolean).length}/9`;
        const isToday = p.date === today;
        const conds = [...p.rows, ...p.columns].map(label).join('、');
        return `<button class="plist" data-pid="${p.id}">
          <span class="pl-no">#${String(p.id).padStart(3, '0')}</span>
          <span class="pl-mid"><span class="pl-date">${p.date}${isToday ? ' · 今天' : ''}</span>
          <span class="pl-conds">${esc(conds)}</span></span>
          <span class="pl-status${done ? ' done' : ''}">${status}</span>
        </button>`;
      }).join('');
    $('otList').innerHTML = list || '<p class="tab-hint">目前還沒有可以回顧的題目。</p>';
    $('other').classList.add('show');
  }

  /* ---------- share ---------- */

  let shareTimer = null;
  function flashShare(msg) {
    const btn = $('rpShare');
    btn.textContent = msg;
    clearTimeout(shareTimer);
    shareTimer = setTimeout(() => { btn.textContent = '分享結果'; }, 2200);
  }

  async function share() {
    const text = shareText();
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      flashShare('已複製！貼到 Threads 吧');
      return;
    } catch (e) { /* fall through */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch (e) { done = false; }
    document.body.removeChild(ta);
    flashShare(done ? '已複製！貼到 Threads 吧' : '複製失敗，請長按畫面手動複製');
  }

  /* ---------- events ---------- */

  grid.addEventListener('click', e => {
    const cell = e.target.closest('.cell');
    if (cell && !cell.disabled) openSheet(Number(cell.dataset.i));
  });

  $('inGrid').addEventListener('click', e => {
    const cell = e.target.closest('.cell');
    if (cell) openPop(Number(cell.dataset.i), 'ans');
  });

  $('wrGrid').addEventListener('click', e => {
    const cell = e.target.closest('.cell');
    if (cell && !cell.disabled) openPop(Number(cell.dataset.i), 'wrong');
  });

  sugg.addEventListener('click', e => {
    const btn = e.target.closest('button[data-pid]');
    if (btn && !btn.disabled) guess(btn.dataset.pid);
  });

  qInput.addEventListener('input', renderSuggestions);
  qInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = sugg.querySelector('button[data-pid]:not([disabled])');
      if (first) guess(first.dataset.pid);
    } else if (e.key === 'Escape') closeSheet();
  });

  $('sheetClose').addEventListener('click', closeSheet);
  sheetBd.addEventListener('click', closeSheet);
  $('giveUp').addEventListener('click', giveUp);
  $('openResult').addEventListener('click', showResult);

  $('rpShare').addEventListener('click', share);
  $('rpInsights').addEventListener('click', openInsights);
  $('rpOther').addEventListener('click', openOther);
  $('inClose').addEventListener('click', () => $('insights').classList.remove('show'));
  $('otClose').addEventListener('click', () => $('other').classList.remove('show'));

  // Tap the dimmed area to dismiss. The target check matters: clicks on the card
  // itself bubble up to the overlay, so without it any button press would close too.
  ['overlay', 'insights', 'other'].forEach(id => {
    const el = $(id);
    el.addEventListener('click', e => {
      if (e.target === el) el.classList.remove('show');
    });
  });
  $('popClose').addEventListener('click', closePop);
  $('popBd').addEventListener('click', closePop);

  document.querySelector('.tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (t) showTab(t.dataset.tab);
  });

  $('archiveLink').addEventListener('click', e => { e.preventDefault(); openOther(); });

  $('otList').addEventListener('click', e => {
    const b = e.target.closest('.plist');
    if (!b) return;
    const id = Number(b.dataset.pid);
    const target = byPuzzleId.get(id);
    if (target && target.date === today) location.href = './';
    else location.href = `./?p=${id}`;
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('pop').classList.contains('show')) return closePop();
    ['insights', 'other', 'overlay'].some(id => {
      if ($(id).classList.contains('show')) { $(id).classList.remove('show'); return true; }
      return false;
    });
  });

  /* ---------- go, and roll over at Taipei midnight ---------- */

  // Debug-only replay: drop the saved game before the first render so the board is fresh.
  if (DEBUG && params.get('replay')) delete store.games[String(puzzle.id)];

  // Console helpers — invisible to normal players, handy while developing.
  window.twgrid = {
    get state() { return state; },
    get puzzle() { return puzzle; },
    replay() { delete store.games[String(puzzle.id)]; writeStore(store); location.reload(); },
    replayAll() { store = { v: 3, games: {} }; writeStore(store); location.reload(); },
    answers() {
      cellConds.forEach(({ row, col }, i) =>
        console.log(`${i} ${label(row)} × ${label(col)}:`, solutions[i].map(p => p.name).join('、')));
    },
  };

  setPuzzle(puzzle);

  if (!isArchive) {
    const scheduleRollover = () => setTimeout(() => {
      const d = taipeiToday();
      if (d !== today) {
        today = d;
        store = readStore();
        setPuzzle(puzzleForDate(today));
        say('新的一天，新的題目！', 'ok');
      }
      scheduleRollover();
    }, Math.min(msUntilTaipeiMidnight() + 1000, 2147483000));
    scheduleRollover();
  }
}
