// 博愛座大挑戰 — static daily "who is older" game. No backend, no login, no build step.
// People data is shared with 台灣九宮格 (../taiwan-grid/people.json); the daily
// pairings live in puzzles.json. This file is logic + UI only.
//
// Routing: /projects/who-is-older/        → today's puzzle (Asia/Taipei)
//          /projects/who-is-older/?p=7    → puzzle with permanent id 7
//
// Every puzzle is authored data. Nothing is generated at runtime — the difficulty
// rules (close-age quota, tie days) live in tools/gen-puzzles.mjs, which writes
// puzzles.json. That keeps a given puzzle id identical for everyone, forever.

const ROUNDS = 7;
const EXCLUDE_TAG = '已故';
const STORE_KEY = 'twolder.v1';
const TAIPEI_OFFSET_MIN = 8 * 60;   // UTC+8, no DST — Taiwan has never observed it since 1980

// ── DEBUG ────────────────────────────────────────────────────────────────────
// Flip to true while developing locally, then flip back before committing.
//   ?replay=1              wipe this puzzle's saved progress and start it over
//   ?date=2026-09-05       pretend it is that Taipei day (picks that day's puzzle)
// Leave false in production: ?replay=1 would let anyone re-roll their daily score,
// which makes the shared 🟩 rows meaningless.
//
// Regardless of this flag, the browser console always has:
//   twolder.replay()       restart the game on screen
//   twolder.replayAll()    wipe every saved game
//   twolder.answers()      log the correct answer for every round
//   twolder.state          the live game state object
const DEBUG = false;
// ─────────────────────────────────────────────────────────────────────────────

const RANKS = [
  { min: 7,  title: '',   quip: '你是不是有他們的身分證？' },
  { min: 5,  title: '',   quip: '' },
  { min: 3,  title: '',   quip: '' },
  { min: 0,  title: '',     quip: '全錯就是全對' },
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
  return { v: 1, games: {} };
}

function writeStore(obj) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(obj));
  } catch (e) { /* private mode / quota — game stays playable in memory */ }
}

/* ---------- birthdays ---------- */

// people.json stores birthdays as a loose "YYYY/M/D" string (also tolerates '-').
// Anything that isn't a full year+month+day is unusable here: a partial date can't
// settle "who is older", so those people are simply not eligible for the game.
function parseDob(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return y * 10000 + mo * 100 + d;   // sortable integer: smaller = older
}

// The correct answer for a pair. Older = earlier birthday. Identical y/m/d means
// neither side is older and 「一樣老」is the only right answer — the fun edge case.
function correctFor(left, right) {
  const a = parseDob(left.properties.birthday);
  const b = parseDob(right.properties.birthday);
  if (a === b) return 'same';
  return a < b ? 'left' : 'right';
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const occOf = p => {
  const occupations = p.properties.occupation || [];
  return occupations.includes('藝人') ? '藝人' : occupations[0] || '';
};

const pad3 = n => String(n).padStart(3, '0');

/* ---------- entry point ---------- */

export async function mountOlder(cfg) {
  const [people, puzzles] = await Promise.all([
    fetch('../taiwan-grid/people.json').then(r => r.json()),
    fetch('puzzles.json').then(r => r.json()),
  ]);

  const byId = new Map(people.map(p => [p.id, p]));
  // Only people with a usable full birthday can appear. Everyone else in
  // people.json has just birth_decade, which can't decide a matchup. The dead are
  // excluded outright.
  const pool = people.filter(p =>
    parseDob(p.properties.birthday) !== null
    && !(p.properties.tags || []).includes(EXCLUDE_TAG));
  if (pool.length < 2) {
    document.body.innerHTML = '<p style="padding:40px;text-align:center">資料還沒準備好。</p>';
    return;
  }

  const byPuzzleId = new Map(puzzles.map(p => [p.id, p]));
  const firstDate = puzzles[0].date;

  /* ---------- which puzzle? ---------- */

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

  // A puzzle is only reachable once its own date has arrived in Taipei — ?p= must
  // not leak tomorrow's pairings.
  const isPlayable = p => p.date <= today || p.id === todaysPuzzle.id;
  const wantedId = Number(params.get('p'));
  const wanted = wantedId ? byPuzzleId.get(wantedId) : null;
  const blocked = Boolean(wanted) && !isPlayable(wanted);
  const isArchive = Boolean(wanted) && !blocked && wanted.id !== todaysPuzzle.id;

  let puzzle = isArchive ? wanted : todaysPuzzle;

  if (params.has('p') && !isArchive && !DEBUG) {
    try { history.replaceState(null, '', './'); } catch (e) { /* non-fatal */ }
  }

  /* ---------- shell (built once) ---------- */

  document.body.innerHTML = `
<div class="topbar">
  <div class="brand">
    <h1><a href="./" id="homeLink">博愛座大挑戰 </a><span id="pno">#000</span></h1>
    <div class="stats"><span>誰才能坐博愛座？猜猜誰比較年長</span></div>
    <div class="switcher" id="switcher"></div>
  </div>
  <div class="stats">
    <span>第 <b id="rno">1</b> / ${ROUNDS} 題</span>
  </div>
</div>
<div class="progressWrap"><div class="progressBar" id="pbar"></div></div>

<div class="wrap">
  <div class="archive-banner" id="archiveBanner"></div>
  <p class="tagline" id="tagline"></p>
  <div class="roundDots" id="dots"></div>
  <div class="arena" id="arena">
    <div class="pcard" id="cardL" data-side="left">
      <div class="pname" id="nameL"></div>
      <div class="pocc" id="occL"></div>
      <div class="hintArrow" id="hintL"></div>
    </div>
    <div class="vs">VS</div>
    <div class="pcard" id="cardR" data-side="right">
      <div class="pname" id="nameR"></div>
      <div class="pocc" id="occR"></div>
      <div class="hintArrow" id="hintR"></div>
    </div>
  </div>
  <div class="choices">
    <button id="btnSame" class="primary">同年同月同日生</button>
    <button id="btnResult">我不想玩了</button>
  </div>
  <a href="#" class="archive-link" id="archiveLink">玩以前的題目</a>
  <p class="footer-note">
    資料整理自維基百科等公開資料，可能有誤，僅供娛樂。<br>必有疏漏，歡迎回報 → <a href="https://www.threads.com/@jppro.tw" target="_blank" rel="nofollow noopener">Threads</a><br>
    純屬好玩<span class="ver" id="ver"></span>
  </p>
</div>

<div class="overlay" id="overlay">
  <div class="report">
    <h2 id="rpTitle"></h2>
    <p class="rp-quip">誰才可以坐博愛座？猜猜誰比較年長</p>
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
    <p class="footer-note" style="margin-top:12px">資料整理自維基百科等公開資料，可能有誤，僅供娛樂。<br>必有疏漏，歡迎回報 → <a href="https://www.threads.com/@jppro.tw" target="_blank" rel="nofollow noopener">Threads</a></p>
  </div>
</div>

<div class="overlay wide" id="solution">
  <div class="panel">
    <div class="panel-hd">
      <h2 id="solTitle">解答</h2>
      <button class="x" id="solClose" aria-label="關閉">✕</button>
    </div>
    <p class="tab-hint">塗色的那位比較年長，綠色：答對，紅色：答錯。</p>
    <div id="solList"></div>
    <div class="rp-stack" style="margin-top:14px">
      <button id="solShare" class="primary">分享結果</button>
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

  // Swiping is a touch idiom. On a mouse-and-keyboard machine a click-drag on the
  // cards is far more likely to be an accidental text-selection gesture than an
  // answer, so desktop gets click (and arrow keys) only.
  const CLICK_ONLY = matchMedia('(hover: hover) and (pointer: fine)').matches;
  $('tagline').innerHTML = CLICK_ONLY
    ? '<strong>點</strong>比較年長的那一位；也可以用 <strong>← → ↑</strong> 方向鍵。<br>同年同月同日生的話，選<strong>一樣老</strong>'
    : '左邊比較老就<strong>往左滑</strong>，右邊比較年長就<strong>往右滑</strong>；也可直接點名字<br>同年同月同日生的話，選<strong>一樣老</strong>';
  $('hintL').textContent = CLICK_ONLY ? '' : '';
  $('hintR').textContent = CLICK_ONLY ? '' : '';
  if (CLICK_ONLY) arena.style.touchAction = 'auto';

  $('switcher').innerHTML = (cfg.links || [])
    .map(l => `<a href="${l.href}">${esc(l.text)}</a>`).join('');
  $('otGames').innerHTML = (cfg.links || [])
    .map(l => `<a class="gamecard" href="${l.href}">${esc(l.text)}</a>`).join('');

  // VERSION is the single source of truth for the version number (see HISTORY.md).
  fetch('VERSION')
    .then(r => (r.ok ? r.text() : Promise.reject()))
    .then(t => {
      const v = t.trim();
      if (/^\d+\.\d+\.\d+/.test(v)) $('ver').textContent = ` · ${v}`;
    })
    .catch(() => { /* no version shown */ });

  /* ---------- rounds ---------- */

  // Authored rounds from puzzles.json. Each pair is [leftId, rightId] — the order
  // is honoured so a puzzle looks exactly as authored. A pair naming a missing id,
  // or someone without a usable birthday, is dropped with a warning: the day plays
  // one round shorter rather than substituting a different matchup, so everyone
  // who plays puzzle #N plays the same #N. Regenerate with tools/gen-puzzles.mjs
  // if a warning shows up.
  function roundsFromPuzzle(p) {
    const out = [];
    for (const pair of (p.pairs || []).slice(0, ROUNDS)) {
      const [a, b] = (pair || []).map(id => byId.get(id));
      if (!a || !b || a === b || parseDob(a.properties.birthday) === null
          || parseDob(b.properties.birthday) === null) {
        console.warn('[博愛座大挑戰] 跳過無法使用的題目組合', pair);
        continue;
      }
      out.push({ left: a, right: b });
    }
    if (out.length < ROUNDS) {
      console.warn(`[博愛座大挑戰] puzzle #${p.id} 只有 ${out.length}/${ROUNDS} 組可用`);
    }
    return out;
  }

  /* ---------- state ---------- */

  let store = readStore();
  let rounds = [];
  let title = '';
  // choices[i] is 'left' | 'right' | 'same' | null. Correctness is always derived
  // from the data, never stored, so fixing a wrong birthday fixes old scores too.
  let state = { choices: [], finished: false };
  let dragging = null;

  const gameKey = () => `p${puzzle.id}`;
  const answered = () => state.choices.filter(Boolean).length;
  const score = () => rounds.reduce(
    (n, r, i) => n + (state.choices[i] && state.choices[i] === correctFor(r.left, r.right) ? 1 : 0), 0);
  const isOver = () => state.finished || answered() >= rounds.length;

  function blankState() { return { choices: Array(ROUNDS).fill(null), finished: false }; }

  function loadGame() {
    const saved = store.games[gameKey()];
    const s = blankState();
    // A saved game whose length no longer matches ROUNDS is from a different
    // version of the game and can't be resumed. Drop `finished` with it —
    // carrying it over alone would strand the player on a 0/N result card with
    // no rounds to play.
    if (saved && Array.isArray(saved.choices) && saved.choices.length === ROUNDS) {
      s.choices = saved.choices.slice();
      s.finished = Boolean(saved.finished);
    }
    return s;
  }

  function persist() {
    const g = store.games[gameKey()] || {};
    store.games[gameKey()] = { ...g, choices: state.choices, finished: state.finished };
    writeStore(store);
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
      $('btnSame').disabled = true;
      return;
    }
    arena.style.visibility = '';
    $('btnSame').disabled = false;
    const r = rounds[i];
    // Names run from 2 to 15+ characters (黃宏成台灣阿成世界偉人財神總統). Step the
    // type down instead of letting a long one blow out the card height.
    const setName = (el, p) => {
      el.textContent = p.name;
      el.classList.toggle('long', p.name.length >= 7);
      el.classList.toggle('xlong', p.name.length >= 11);
    };
    setName($('nameL'), r.left);
    setName($('nameR'), r.right);
    $('occL').textContent = occOf(r.left);
    $('occR').textContent = occOf(r.right);
    arena.style.transform = '';
    arena.classList.remove('gone', 'settling');
    $('cardL').classList.remove('lit');
    $('cardR').classList.remove('lit');
  }

  // No feedback of any kind here — that is the whole point of the game. Record,
  // advance, and keep the player guessing until the card at the end.
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

  function flyOut(choice) {
    const dx = choice === 'left' ? -window.innerWidth : choice === 'right' ? window.innerWidth : 0;
    const dy = choice === 'same' ? -window.innerHeight * 0.5 : 0;
    arena.classList.add('settling', 'gone');
    arena.style.transform = `translate(${dx * 0.6}px,${dy}px)`;
    setTimeout(() => answer(choice), 150);
  }

  /* ---------- swipe (Pointer Events) — touch devices only ---------- */

  const COMMIT = 60;   // px before a drag counts as an answer

  if (!CLICK_ONLY) {
  arena.addEventListener('pointerdown', e => {
    if (isOver() || dragging) return;
    dragging = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false };
    arena.classList.remove('settling');
    try { arena.setPointerCapture(e.pointerId); } catch (err) { /* non-fatal */ }
  });

  arena.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== dragging.id) return;
    dragging.dx = e.clientX - dragging.x0;
    dragging.dy = e.clientY - dragging.y0;
    if (Math.abs(dragging.dx) > 6 || Math.abs(dragging.dy) > 6) dragging.moved = true;
    const upward = dragging.dy < -COMMIT * 0.5 && Math.abs(dragging.dy) > Math.abs(dragging.dx);
    const dy = upward ? dragging.dy : 0;
    arena.style.transform =
      `translate(${dragging.dx}px,${dy}px) rotate(${(upward ? 0 : dragging.dx) * 0.02}deg)`;
    $('cardL').classList.toggle('lit', !upward && dragging.dx < -COMMIT);
    $('cardR').classList.toggle('lit', !upward && dragging.dx > COMMIT);
  });

  function endDrag(e) {
    if (!dragging || (e && e.pointerId !== dragging.id)) return;
    const { dx, dy, moved } = dragging;
    dragging = null;
    if (!moved) { snapBack(); return; }   // a tap: let the click handler decide
    if (dy < -COMMIT && Math.abs(dy) > Math.abs(dx)) { flyOut('same'); return; }
    if (dx <= -COMMIT) { flyOut('left'); return; }
    if (dx >= COMMIT) { flyOut('right'); return; }
    snapBack();
  }

  function snapBack() {
    arena.classList.add('settling');
    arena.style.transform = '';
    $('cardL').classList.remove('lit');
    $('cardR').classList.remove('lit');
  }

  arena.addEventListener('pointerup', endDrag);
  arena.addEventListener('pointercancel', endDrag);
  arena.addEventListener('lostpointercapture', endDrag);
  }

  // Click/tap a card = pick that side. On touch this fires only when the pointer
  // never travelled far enough to count as a drag, so a swipe never answers twice.
  arena.addEventListener('click', e => {
    const card = e.target.closest('.pcard');
    if (!card || isOver() || (dragging && dragging.moved)) return;
    flyOut(card.dataset.side);
  });

  document.addEventListener('keydown', e => {
    const top = ['other', 'archive', 'solution', 'overlay'].find(id => $(id).classList.contains('show'));
    if (top) {
      if (e.key === 'Escape') $(top).classList.remove('show');
      return;
    }
    if (isOver()) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); flyOut('left'); }
    if (e.key === 'ArrowRight') { e.preventDefault(); flyOut('right'); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); flyOut('same'); }
  });

  /* ---------- result ---------- */

  const marks = () => rounds.map((r, i) =>
    state.choices[i] && state.choices[i] === correctFor(r.left, r.right) ? '🟩' : '🟥');

  // 2×5 block so the share text stays short enough for a Threads post.
  const emojiRows = () => {
    const m = marks();
    return [m.slice(0, 5).join(''), m.slice(5, 10).join('')].filter(Boolean);
  };

  const roundLines = () => rounds.map((r, i) =>
    `${r.left.name} vs ${r.right.name} ${marks()[i]}`);

  // Deliberately reveals nothing: the pair, and whether the player got it right.
  // Which of the two is actually older stays behind the 看解答 button, so a shared
  // screenshot doesn't spoil the day's puzzle for whoever sees it.
  function roundsHTML() {
    const mk = marks();
    return rounds.map((r, i) =>
      `<div class="rr"><span class="no">${i + 1}</span>`
      + `<span class="pair">${esc(r.left.name)}<i>vs</i>${esc(r.right.name)}</span>`
      + `<span class="mk">${mk[i]}</span></div>`).join('');
  }

  // The emoji block lives in the share text only — on the card itself the ten
  // recap rows already carry the same information.
  const shareText = () => {
    const s = score();
    const rank = RANKS.find(r => s >= r.min);
    return `${title}\n\n${roundLines().join('\n')}`
      + `\n\n快來猜猜誰能坐博愛座\n🔗 ${cfg.shareUrl}?p=${puzzle.id}`;
  };

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
    // Only offer the way back when you're on an older puzzle.
    $('rpDaily').style.display = isArchive || blocked ? '' : 'none';
    overlay.classList.add('show');
  }

  /* ---------- archive (玩以前的題目) ---------- */

  // Resolve a puzzle strictly, for scoring a *saved* game in the list: every pair
  // must be usable, or no score is claimed. roundsFromPuzzle() is lenient (it drops
  // a broken pair and plays on), which would silently shift the round indices the
  // saved choices refer to.
  function authoredRounds(p) {
    const out = [];
    for (const pair of (p.pairs || []).slice(0, ROUNDS)) {
      const [a, b] = (pair || []).map(id => byId.get(id));
      if (!a || !b || a === b
          || parseDob(a.properties.birthday) === null
          || parseDob(b.properties.birthday) === null) return null;
      out.push({ left: a, right: b });
    }
    return out.length === ROUNDS ? out : null;
  }

  function savedScore(p) {
    const g = store.games[`p${p.id}`];
    if (!g || !Array.isArray(g.choices) || g.choices.length !== ROUNDS) return null;
    const answered = g.choices.filter(Boolean).length;
    if (!answered) return null;
    const rs = authoredRounds(p);
    if (!rs) return { answered, score: null, finished: Boolean(g.finished) };
    const score = rs.reduce(
      (n, r, i) => n + (g.choices[i] && g.choices[i] === correctFor(r.left, r.right) ? 1 : 0), 0);
    return { answered, score, finished: Boolean(g.finished) };
  }

  function openArchive() {
    // Newest first, and never a puzzle whose Taipei date hasn't arrived — the list
    // must not leak tomorrow's pairings any more than ?p= does.
    const playable = puzzles.filter(isPlayable).sort((a, b) => b.date.localeCompare(a.date));
    $('arList').innerHTML = playable.map(p => {
      const isToday = p.id === todaysPuzzle.id;
      const s = savedScore(p);
      const status = !s ? '未挑戰'
        : s.finished ? (s.score === null ? '已完成' : `${s.score}/${ROUNDS}`)
        : `進行中 ${s.answered}/${ROUNDS}`;
      return `<button class="plist" data-id="${p.id}"${isToday && !isArchive ? ' disabled' : ''}>`
        + `<span class="pl-no">#${pad3(p.id)}</span>`
        + `<span class="pl-mid"><span class="pl-date">${esc(p.date)}${isToday ? '（今天）' : ''}</span></span>`
        + `<span class="pl-status${s && s.finished ? ' done' : ''}">${status}</span></button>`;
    }).join('') || '<p class="tab-hint">還沒有以前的題目。</p>';
    $('archive').classList.add('show');
  }

  // A full navigation rather than an in-page swap: the archive/blocked banner state
  // is decided once at mount from the URL, so ?p= is the single source of truth for
  // which puzzle is on screen.
  $('arList') && $('arList').addEventListener('click', e => {
    const b = e.target.closest('.plist');
    if (!b || b.disabled) return;
    location.href = `?p=${b.dataset.id}`;
  });

  /* ---------- solution ---------- */

  // One row per round: both names with their birthdays, and the *older* person
  // tinted green if the player got that round right, red if not. On a tie both
  // are tinted, since neither is older.
  function openSolution() {
    $('solTitle').textContent = `${title} 解答`;
    $('solList').innerHTML = rounds.map((r, i) => {
      const truth = correctFor(r.left, r.right);
      const ok = state.choices[i] === truth;
      const tint = side => {
        const isOld = truth === 'same' || truth === side;
        return isOld ? ` old ${ok ? 'ok' : 'no'}` : '';
      };
      // The name gets its own element so it can wrap inside the tinted chip.
      // Without that the chip is a flex item that shrinks to min-content, and a
      // long name (黃宏成台灣阿成世界偉人財神總統) renders one character per line.
      const cell = (p, side) =>
        `<span class="sol-p${tint(side)}"><span class="nm">${esc(p.name)}</span>`
        + `<em>${esc(p.properties.birthday)}</em></span>`;
      return `<div class="sol-row">`
        + `<span class="no">${i + 1}</span>`
        + `<div class="sol-pair">`
        + cell(r.left, 'left')
        + `<span class="sol-vs">vs</span>`
        + cell(r.right, 'right')
        + `</div>`
        + (truth === 'same' ? '<span class="sol-tie">同一天生日</span>' : '')
        + `</div>`;
    }).join('');
    $('solution').classList.add('show');
  }

  /* ---------- share ---------- */

  let shareTimer = null;
  let shareBtn = null;         
  function flashShare(msg) {
    const btn = shareBtn || $('rpShare');
    btn.textContent = msg;
    clearTimeout(shareTimer);
    shareTimer = setTimeout(() => { btn.textContent = '分享結果'; }, 2200);
  }

  async function share(ev) {
    shareBtn = (ev && ev.currentTarget) || $('rpShare');
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

  /* ---------- buttons ---------- */

  $('btnSame').addEventListener('click', () => { if (!isOver()) flyOut('same'); });
  $('btnResult').addEventListener('click', () => {
    if (!isOver()) {
      if (!confirm(`還有 ${rounds.length - answered()} 題沒答，現在看結果會直接結束這局。要繼續嗎？`)) return;
      state.finished = true;
      persist();
      render();
    }
    showResult();
  });
  $('rpShare').addEventListener('click', share);
  $('solShare').addEventListener('click', share);
  $('rpSolution').addEventListener('click', openSolution);
  $('solClose').addEventListener('click', () => $('solution').classList.remove('show'));
  $('solution').addEventListener('click', e => { if (e.target === $('solution')) $('solution').classList.remove('show'); });
  $('rpOther').addEventListener('click', () => $('other').classList.add('show'));
  $('otClose').addEventListener('click', () => $('other').classList.remove('show'));
  $('other').addEventListener('click', e => { if (e.target === $('other')) $('other').classList.remove('show'); });
  $('rpArchive').addEventListener('click', openArchive);
  $('archiveLink').addEventListener('click', e => { e.preventDefault(); openArchive(); });
  $('arClose').addEventListener('click', () => $('archive').classList.remove('show'));
  $('archive').addEventListener('click', e => { if (e.target === $('archive')) $('archive').classList.remove('show'); });
  $('rpDaily').addEventListener('click', () => { location.href = './'; });

  /* ---------- game setup ---------- */

  function setPuzzle(p) {
    puzzle = p;
    rounds = roundsFromPuzzle(p);
    title = `${cfg.shareTitle} #${String(p.id).padStart(3, '0')}`;
    if (DEBUG && params.get('replay') === '1') {
      delete store.games[gameKey()];
      writeStore(store);
    }
    state = loadGame();
    if (DEBUG) {
      twolder.state = state;
      // Which puzzle is actually on screen, and why. An authored date in the
      // future is not served: puzzleForDate() falls back to cycling the list.
      const exact = puzzles.some(x => x.date === today);
      console.log(`[博愛座大挑戰] today=${today} → puzzle #${p.id} (date ${p.date}, `
        + `${exact ? 'exact date match' : 'no puzzle authored for today, cycling the list'}), `
        + `${rounds.length}/${ROUNDS} rounds, saved=${store.games[gameKey()] ? 'yes' : 'no'}`);
    }
    $('pno').textContent = `#${String(p.id).padStart(3, '0')}`;
    const banner = $('archiveBanner');
    if (blocked) {
      banner.innerHTML = '這一題還沒開放，先玩今天的吧。 <a href="./">回到今天</a>';
      banner.style.display = '';
    } else if (isArchive) {
      banner.innerHTML = `這是 ${p.date} 的題目。 <a href="./">回到今天</a>`;
      banner.style.display = '';
    } else {
      banner.style.display = 'none';
    }
    overlay.classList.remove('show');
    render();
    if (isOver()) showResult();
  }

  /* ---------- console helpers ---------- */

  const twolder = {
    replay() {
      delete store.games[gameKey()];
      writeStore(store);
      setPuzzle(puzzle);
    },
    replayAll() { store = { v: 1, games: {} }; writeStore(store); setPuzzle(puzzle); },
    get rounds() { return rounds; },
    get pool() { return pool; },
    answers() {
      rounds.forEach((r, i) => console.log(
        `${i + 1} ${r.left.name} (${r.left.properties.birthday}) vs ${r.right.name} (${r.right.properties.birthday}) → ${correctFor(r.left, r.right)}`));
    },
    state,
  };
  window.twolder = twolder;

  setPuzzle(puzzle);

  if (!isArchive) {
    const scheduleRollover = () => setTimeout(() => {
      const d = taipeiToday();
      if (d !== today) {
        today = d;
        store = readStore();
        setPuzzle(puzzleForDate(today));
      }
      scheduleRollover();
    }, Math.min(msUntilTaipeiMidnight() + 1000, 2147483000));
    scheduleRollover();
  }
}
