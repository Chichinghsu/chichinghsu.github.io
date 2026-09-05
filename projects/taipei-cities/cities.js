// Engine for the 鄉鎮市區 map-filling challenge.
//
// The station quizzes (/projects/quiz/quiz.js) draw points; this one draws
// polygons, so it needs its own projection-free renderer — districts.json ships
// pre-projected SVG paths. Everything else deliberately mirrors quiz.js: the
// same layout, the same #rp* report card, the same 交卷 / 公布解答 flow, and the
// same quiz.css. Only the middle layer (dots -> paths) differs.
//
// The active city set is chosen on a pre-game picker and recorded in ?c=, and
// it drives everything downstream: the district filter, the viewBox fit, the
// type scale, the legend, the per-city score rows and the share text. Any
// combination of the six is playable, so nothing here may assume a fixed set —
// in particular the score is a percentage of whatever was selected, and the
// rank ladder is generic unless exactly one city is in play.

import { GAMES } from '/projects/quiz/quiz.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

// A short name for the chosen set, used in the heading and the share text so
// two different games don't post identical results: 六都 / 臺中+高雄 / 臺北.
const setLabel = (cfg, cities, all) => cities.length === all.length
  ? cfg.allLabel
  : cities.map(c => c.name.replace(/[市縣]$/, '')).join('+');

// -------------------------------------------------------------------- picker
// Gate the game on a city choice rather than booting a fixed set. The chosen
// ids go into ?c= before mounting, so a result is shareable, bookmarkable, and
// survives 再玩一次 (which is a location.reload) instead of dumping the player
// back here.
function showPicker(cfg, DATA, onStart) {
  document.body.innerHTML = `
<div class="overlay show">
  <div class="report pick-card">
    <h2>${cfg.shareTitle}</h2>
    <div class="rp-sub">選擇想挑戰的縣市，可以複選</div>
    <div class="pick-list">${DATA.cities.map(c => `
      <label class="pick-item">
        <input type="checkbox" value="${c.id}"${cfg.defaultCities.includes(c.id) ? ' checked' : ''}/>
        <span class="sw" style="background:${c.accent}"></span>
        <span class="nm">${c.name}</span>
        <span class="ct">${c.count} 區</span>
      </label>`).join('')}</div>
    <div class="pick-total">共 <b id="pickTotal">0</b> 區</div>
    <div class="pick-quick">
      <button type="button" id="pickAll">全選</button>
      <button type="button" id="pickNone">清除</button>
      <button type="button" id="pickRandom">隨機一都</button>
    </div>
    <div class="rp-actions"><button id="pickStart" class="primary">開始挑戰</button></div>
  </div>
</div>`;

  const boxes = [...document.querySelectorAll('.pick-item input')];
  const startBtn = document.getElementById('pickStart');
  const totalEl = document.getElementById('pickTotal');
  const countOf = id => DATA.cities.find(c => c.id === id).count;
  const chosen = () => boxes.filter(b => b.checked).map(b => b.value);

  function sync() {
    const ids = chosen();
    totalEl.textContent = ids.reduce((n, id) => n + countOf(id), 0);
    startBtn.disabled = !ids.length;
  }
  const setAll = fn => { boxes.forEach((b, i) => { b.checked = fn(b, i); }); sync(); };

  boxes.forEach(b => b.addEventListener('change', sync));
  document.getElementById('pickAll').addEventListener('click', () => setAll(() => true));
  document.getElementById('pickNone').addEventListener('click', () => setAll(() => false));
  // One random 都, not a random subset: "臺南+桃園" is an arbitrary pairing,
  // whereas "you got 高雄" is a challenge.
  document.getElementById('pickRandom').addEventListener('click', () => {
    const pick = Math.floor(Math.random() * boxes.length);
    setAll((_, i) => i === pick);
  });
  startBtn.addEventListener('click', () => {
    gtag('event', 'city_selected', {
      cities: chosen().join(','),
      city_count: chosen().length
    });
    onStart(chosen());
  });
  sync();
}

// ---------------------------------------------------------------------- DOM
function buildLayout(cfg, label) {
  document.body.innerHTML = `
<div class="topbar">
  <div class="brand">
    <h1>${label}${cfg.heading}</h1>
    <div class="switcher" id="switcher"></div>
  </div>
  <div class="stats">
    <span>解鎖 <b id="foundCount">0</b> / <span id="totalCount">0</span></span>
    <span class="pct"><b id="pctCount">0.0%</b></span>
  </div>
</div>
<div class="progressWrap"><div class="progressBar" id="progressBar"></div></div>

<div class="main">
  <div class="mapArea" id="mapArea">
    <svg id="svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
      <g id="viewport">
        <g id="fillLayer"></g>
        <g id="labelsLayer"></g>
      </g>
    </svg>
    <div class="zoomctl">
      <button id="zoomIn" title="Zoom in">+</button>
      <button id="zoomOut" title="Zoom out">&minus;</button>
      <button id="zoomReset" title="Reset view">⤾</button>
    </div>
  </div>

  <div class="sidebar">
    <form id="guessForm" autocomplete="off">
      <input id="guessInput" type="text" placeholder="請輸入區名 ..." />
      <button class="primary" type="submit">確定</button>
    </form>
    <div class="feedback" id="feedback"></div>
    <div class="hint">${cfg.hint}<br>想不出來了就按「交卷」看成績單
      <br><a href="${location.pathname}">← 換其他縣市</a></div>

    <div style="display:flex; gap:8px;">
      <button id="revealBtn" style="flex:1;">公布解答</button>
      <button id="submitBtn" class="primary" style="flex:1;">交卷</button>
    </div>

    <div class="legend" id="legend"></div>

    <div class="found-list" id="foundList">
      <h3>已找到的區</h3>
      <div id="foundItems"></div>
    </div>

    <div class="footer-note">${cfg.footer} | 追蹤我的 <a href="https://www.threads.com/@jppro.tw" target="_blank" rel="nofollow noopener">Threads</a></div>
  </div>
</div>

<div class="overlay" id="reportOverlay">
  <div class="report" id="reportCard">
    <h2>${cfg.shareTitle}</h2>
    <div class="rp-sub" id="rpDate"></div>
    <div class="rp-rank" id="rpRank">—</div>
    <div class="rp-quip" id="rpQuip"></div>
    <div class="rp-score" id="rpScore">0.0%</div>
    <div class="rp-count" id="rpCount"></div>
    <div class="rp-bar"><i id="rpBar" style="width:0%"></i></div>
    <div class="rp-lines" id="rpLines"></div>
    <div class="rp-share"><span class="rp-tag">${cfg.hashtag} ${label}</span></div>
    <a class="rp-more" id="rpMore" href="#">看更多挑戰 →</a>
    <div class="rp-actions">
      <button id="rpReveal">公布解答</button>
      <button id="rpRestart" class="primary">再玩一次</button>
    </div>
    <a class="rp-cta" href="https://www.threads.com/@jppro.tw" target="_blank" rel="nofollow noopener">
      <span class="rp-cta-main">👉 追蹤我的 Threads</span>
    </a>
  </div>
</div>

<div class="overlay" id="gamesOverlay">
  <div class="report games-card">
    <h2>更多挑戰</h2>
    <div class="rp-sub"></div>
    <div class="games-list">
      ${GAMES.filter(g => g.id !== cfg.id).map(g => `
      <a class="game-item" href="${g.path}">
        <span class="sw" style="background:${g.accent}"></span>
        <span class="nm">${g.title}</span>
        <span class="go">→</span>
      </a>`).join('')}
      <a class="game-item" href="https://apps.apple.com/ph/app/id6774146443" target="_blank" rel="nofollow noopener">
        <span class="sw" style="background:#333"></span>
        <span class="nm">日本車牌制霸 App (iOS)</span>
        <span class="go">→</span>
      </a>
    </div>
    <div class="rp-actions"><button id="gamesClose" class="primary">關閉</button></div>
  </div>
</div>`;

  const gamesOverlay = document.getElementById('gamesOverlay');
  document.getElementById('rpMore').addEventListener('click', e => {
    e.preventDefault();
    gamesOverlay.classList.add('show');
  });
  document.getElementById('gamesClose').addEventListener('click', () => gamesOverlay.classList.remove('show'));
  gamesOverlay.addEventListener('click', e => {
    if (e.target === gamesOverlay) gamesOverlay.classList.remove('show');
  });

  const me = GAMES.find(g => g.id === cfg.id);
  if (me) document.documentElement.style.setProperty('--accent', me.accent);
  if (cfg.label) {
    document.documentElement.style.setProperty('--lbl-zh', cfg.label.zh + 'px');
    document.documentElement.style.setProperty('--lbl-en', cfg.label.en + 'px');
  }
  document.getElementById('switcher').innerHTML = '更多挑戰：' + GAMES
    .filter(g => g.id !== cfg.id)
    .map(g => `<a href="${g.path}">${g.title} →</a>`)
    .join('') + '<a href="https://apps.apple.com/ph/app/id6774146443" target="_blank" rel="nofollow noopener">日本車牌制霸 App (iOS) →</a>';
}

// -------------------------------------------------------------------- mount
export async function mountCities(cfg) {
  const DATA = await (await fetch(cfg.data)).json();

  function start(ids, { push = false } = {}) {
    // Filter DATA.cities rather than map the ids, so the legend and report card
    // always read north-to-south regardless of what order they were ticked in.
    const cities = DATA.cities.filter(c => ids.includes(c.id));
    if (push) history.replaceState(null, '', '?c=' + cities.map(c => c.id).join(','));
    const label = setLabel(cfg, cities, DATA.cities);
    buildLayout(cfg, label);
    run(cfg, DATA, cities, label);
  }

  // ?c= skips the picker entirely — that's what makes a shared result replayable.
  const wanted = new URLSearchParams(location.search).get('c');
  if (wanted) {
    const ids = wanted.split(',').map(s => s.trim());
    const known = DATA.cities.filter(c => ids.includes(c.id)).map(c => c.id);
    start(known.length ? known : cfg.defaultCities);
    return;
  }
  showPicker(cfg, DATA, ids => start(ids, { push: true }));
}

function run(cfg, DATA, cities, label) {
  const cityIds = new Set(cities.map(c => c.id));
  const cityById = Object.fromEntries(cities.map(c => [c.id, c]));

  const districts = DATA.districts.filter(d => cityIds.has(d.city));
  const byId = Object.fromEntries(districts.map(d => [d.id, d]));
  const TOTAL = districts.length;

  // ---- viewBox frame: the bbox of what's actually in play, plus a margin ----
  const bb = districts.reduce((a, d) => [
    Math.min(a[0], d.bbox[0]), Math.min(a[1], d.bbox[1]),
    Math.max(a[2], d.bbox[2]), Math.max(a[3], d.bbox[3]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
  const PAD = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.04;
  const HOME = { x: bb[0] - PAD, y: bb[1] - PAD, w: bb[2] - bb[0] + PAD * 2, h: bb[3] - bb[1] + PAD * 2 };

  // Type and border widths are anchored to the DISTRICTS, not the frame.
  // Frame width runs 191 units (臺北 alone) to 1809 (六都) — a 9x spread — but
  // 永和 is the same 16 units across either way. Sizing off the frame meant a
  // 六都 board drew 永和 with a label wider than the district and a border
  // thicker than it, i.e. it broke exactly where the map is densest. The median
  // minor-axis is stable (48-75) across every city combination, so use that.
  const minorAxis = d => Math.min(d.bbox[2] - d.bbox[0], d.bbox[3] - d.bbox[1]);
  const REF = [...districts].map(minorAxis).sort((a, b) => a - b)[districts.length >> 1];
  // Ratios chosen to reproduce the previous 雙北 rendering to within a hair.
  const STROKE = REF * 0.05;

  // ---- normalization / matching ----
  // 臺 and 台 are interchangeable, and a trailing 區/市/鎮/鄉 is noise: 新北's
  // districts were 市/鎮/鄉 before the 2010 upgrade and plenty of people still
  // say 三重市 or 鶯歌鎮.
  function norm(str) {
    return str.toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/臺/g, '台')
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
      .replace(/[區市鎮鄉]$/, '');
  }
  // A guess maps to a LIST of ids: 中正/中山/信義 repeat across 縣市, so once
  // more cities are added one typed name should unlock all of them.
  const aliasMap = {};
  function addAlias(alias, id) {
    const n = norm(alias);
    if (!n || !byId[id]) return;
    (aliasMap[n] ||= []).push(id);
    aliasMap[n] = [...new Set(aliasMap[n])];
  }
  districts.forEach(d => {
    const city = cityById[d.city].name;
    addAlias(d.name, d.id);
    addAlias(d.short, d.id);
    addAlias(d.en, d.id);
    // Both 臺中市東區 and 臺中東區: 東/南/北區 exist in two 都 each and 大安區
    // in two, so the qualified form is the only way to claim just one — and
    // nobody types the 市. norm() strips the trailing 區, not an internal 市.
    addAlias(city + d.name, d.id);
    addAlias(city.replace(/[市縣]$/, '') + d.name, d.id);
  });
  Object.entries(cfg.aliases || {}).forEach(([k, v]) => {
    (Array.isArray(v) ? v : [v]).forEach(id => addAlias(k, id));
  });

  // ---- draw ----
  const fillLayer = document.getElementById('fillLayer');
  const labelsLayer = document.getElementById('labelsLayer');
  const pathEls = {};
  districts.forEach(d => {
    // Unsolved districts are tinted towards their city's accent — barely
    // saturated, but enough that the 臺北 / 新北 split reads on a blank board
    // without drawing a boundary. (A true union outline would need real polygon
    // geometry; per-district strokes just thicken every internal border.)
    // Fill goes through style, not the `fill` attribute: .dist in cities.css
    // sets a fill, and a stylesheet rule always beats a presentation attribute.
    const p = el('path', { d: d.d, class: 'dist', 'stroke-width': STROKE });
    p.style.fill = `color-mix(in srgb, ${cityById[d.city].accent} 12%, #dfe3e9)`;
    fillLayer.appendChild(p);
    pathEls[d.id] = p;
  });

  // Label type is sized to the district it sits in — 中正 and 石碇 differ by an
  // order of magnitude in area, and one shared size either overflows the small
  // ones or vanishes in the big ones.
  const clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v));
  const fontFor = d => clamp(REF * 0.105, minorAxis(d) * 0.34, REF * 0.30);

  // Chinese only. The English line doubled the vertical space every label
  // needed, and in the 板橋/三重/中和 cluster that was the difference between
  // crowded and unreadable — the English is still in the 已找到的區 list.
  function drawLabel(d, { muted = false } = {}) {
    const size = fontFor(d);
    // Dark ink with a white halo: labels sit on top of the white district
    // borders, so light-on-light was disappearing exactly where the outlines run.
    const zh = el('text', {
      x: d.lx, y: d.ly + size * 0.34, 'text-anchor': 'middle', class: 'dist-label',
      'font-size': size, 'stroke-width': size * 0.22,
    });
    if (muted) zh.setAttribute('fill', '#6c7480');
    zh.textContent = d.short;
    labelsLayer.appendChild(zh);
  }

  // ---- reveal ----
  const found = new Set();
  function revealDistrict(id, { isGuess = false } = {}) {
    const d = byId[id];
    if (!d) return false;
    if (found.has(id)) return null; // already found
    found.add(id);
    const p = pathEls[id];
    p.setAttribute('class', 'dist found pop-anim');
    p.style.fill = cityById[d.city].accent;
    drawLabel(d);
    updateStats();
    addFoundListItem(d, isGuess);
    return true;
  }

  let submitted = false;
  let finalScore = null; // frozen at 交卷 or 公布解答, whichever comes first

  function endGame() {
    if (submitted) return;
    submitted = true;
    input.disabled = true;
    input.placeholder = '已交卷';
    form.querySelector('button[type=submit]').disabled = true;
    document.getElementById('submitBtn').textContent = '看成績單';
    feedback.textContent = '已交卷 — 成績已結算';
    feedback.className = 'feedback ok';
  }

  // 公布解答 fills the map in, so the score has to be frozen *before* that —
  // otherwise 交卷 afterwards reads the revealed districts back as 100%.
  function revealAllRemaining() {
    if (!finalScore) finalScore = snapshotScore();
    endGame();
    districts.forEach(d => {
      if (found.has(d.id)) return;
      found.add(d.id);
      pathEls[d.id].setAttribute('class', 'dist revealed');
      pathEls[d.id].style.fill = '#c7ccd4';
      drawLabel(d, { muted: true });
      addFoundListItem(d, false, true);
    });
    updateStats();
  }

  function snapshotScore() {
    return {
      count: found.size,
      perCity: Object.fromEntries(cities.map(c =>
        [c.id, districts.filter(d => d.city === c.id && found.has(d.id)).length])),
    };
  }

  // Once the score is frozen the counters keep showing it, so the header never
  // contradicts the report card.
  function updateStats() {
    const count = finalScore ? finalScore.count : found.size;
    document.getElementById('foundCount').textContent = count;
    document.getElementById('totalCount').textContent = TOTAL;
    const pct = (count / TOTAL * 100).toFixed(1);
    document.getElementById('pctCount').textContent = pct + '%';
    document.getElementById('progressBar').style.width = pct + '%';
    updateLegendProgress();
  }

  const foundItemsEl = document.getElementById('foundItems');
  function addFoundListItem(d, isGuess, isReveal = false) {
    const c = cityById[d.city];
    const row = document.createElement('div');
    row.className = 'found-item' + (isReveal ? ' reveal' : '');
    row.innerHTML = '<span class="fi-name"><span class="line-badge" style="background:' + c.accent +
      '">' + c.name.slice(0, 1) + '</span>' + d.name + '</span><span class="zh">' + d.en + '</span>';
    foundItemsEl.prepend(row);
  }

  // ---- form handling ----
  const form = document.getElementById('guessForm');
  const input = document.getElementById('guessInput');
  const feedback = document.getElementById('feedback');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;
    const ids = aliasMap[norm(raw)];
    if (!ids || !ids.length) {
      feedback.textContent = '"' + raw + '" — 沒有這個區 QQ';
      feedback.className = 'feedback no';
      input.select();
      return;
    }
    const newly = [];
    ids.forEach(id => { if (revealDistrict(id, { isGuess: true }) === true) newly.push(byId[id]); });
    if (newly.length) {
      feedback.textContent = '✓ ' + newly.map(d => cityById[d.city].name + d.name).join('  +  ');
      feedback.className = 'feedback ok';
      input.value = '';
    } else {
      feedback.textContent = '已解鎖: ' +
        ids.map(id => cityById[byId[id].city].name + byId[id].name).join(', ');
      feedback.className = 'feedback no';
    }
    input.focus();
  });

  document.getElementById('revealBtn').addEventListener('click', () => {
    if (confirm('公布所有還沒解鎖的區？成績會以目前的進度結算，之後不能再作答。')) revealAllRemaining();
  });

  // ---- 交卷 / report card ----
  // Ranks are checked top-down; the first threshold the score clears wins.
  // cfg.ranks is a generic percentage ladder, because an arbitrary combination
  // of 都 can't have a themed one. A single city can, and single-city is the
  // common case, so it gets its own set when one is supplied.
  const ranks = (cities.length === 1 && cfg.rankSets?.[cities[0].id]) || cfg.ranks;
  const rankFor = pct => ranks.find(r => pct >= r.min) || ranks[ranks.length - 1];
  const overlay = document.getElementById('reportOverlay');
  function showReport() {
    if (!finalScore) finalScore = snapshotScore();
    const pctNum = finalScore.count / TOTAL * 100;
    const rank = rankFor(pctNum);
    gtag('event', 'game_complete', {
      cities_played: [...cityIds].join(','),
      score: Math.round(pctNum * 10) / 10,
      districts_found: finalScore.count,
      districts_total: TOTAL
    });
    const dt = new Date();
    document.getElementById('rpDate').textContent =
      dt.getFullYear() + '.' + String(dt.getMonth() + 1).padStart(2, '0') + '.' + String(dt.getDate()).padStart(2, '0') +
      ' · ' + label;
    document.getElementById('rpRank').textContent = rank.title;
    document.getElementById('rpQuip').textContent = rank.quip;
    document.getElementById('rpScore').textContent = pctNum.toFixed(1) + '%';
    document.getElementById('rpCount').textContent = finalScore.count + ' / ' + TOTAL + ' 區';
    document.getElementById('rpBar').style.width = Math.max(pctNum, 0.8) + '%';
    document.getElementById('rpLines').innerHTML = cities.map(c => {
      const f = finalScore.perCity[c.id] || 0;
      return '<div class="rp-line"><span class="sw" style="background:' + c.accent + '"></span>' +
        c.name + '<span class="v">' + f + '/' + c.count + '</span></div>';
    }).join('');
    overlay.classList.add('show');
  }

  document.getElementById('submitBtn').addEventListener('click', () => {
    if (!submitted && !confirm('確定交卷？交卷後就不能再作答了。')) return;
    if (!finalScore) finalScore = snapshotScore();
    endGame();
    showReport();
  });
  document.getElementById('rpRestart').addEventListener('click', () => location.reload());
  document.getElementById('rpReveal').addEventListener('click', () => {
    overlay.classList.remove('show');
    revealAllRemaining();
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('show'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.classList.remove('show'); });

  // ---- legend: one row per city in play ----
  const legendEl = document.getElementById('legend');
  const legendProgEls = {};
  cities.forEach(c => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = '<span class="swatch" style="background:' + c.accent + '"></span><b>' +
      c.name + '</b><span class="legend-prog"></span>';
    legendEl.appendChild(row);
    legendProgEls[c.id] = row.querySelector('.legend-prog');
  });
  function updateLegendProgress() {
    cities.forEach(c => {
      const f = finalScore
        ? (finalScore.perCity[c.id] || 0)
        : districts.filter(d => d.city === c.id && found.has(d.id)).length;
      legendProgEls[c.id].textContent = f + '/' + c.count + ' · ' + (f / c.count * 100).toFixed(0) + '%';
    });
  }

  // ---- viewBox / pan & zoom (same interaction model as quiz.js) ----
  const svg = document.getElementById('svg');
  let vb = { ...HOME };
  const applyVB = () => svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
  applyVB();

  const mapArea = document.getElementById('mapArea');
  let isPanning = false, start = { x: 0, y: 0 }, startVB = null;
  const pointers = new Map();
  let pinch = null;
  function pinchState() {
    const pts = [...pointers.values()];
    const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
    return { dist: Math.hypot(dx, dy), cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2 };
  }
  mapArea.addEventListener('pointerdown', e => {
    // The zoom buttons live inside mapArea; capturing the pointer here would
    // retarget the click and they'd never fire.
    if (e.target.closest('.zoomctl')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    mapArea.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      isPanning = true; start = { x: e.clientX, y: e.clientY }; startVB = { ...vb };
    } else if (pointers.size === 2) {
      isPanning = false;
      pinch = pinchState();
    }
  });
  mapArea.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = mapArea.getBoundingClientRect();
    if (pointers.size >= 2 && pinch) {
      const now = pinchState();
      if (now.dist > 0) {
        const cx = vb.x + (now.cx - rect.left) / rect.width * vb.w;
        const cy = vb.y + (now.cy - rect.top) / rect.height * vb.h;
        zoomAt(pinch.dist / now.dist, cx, cy);
      }
      pinch = now;
      return;
    }
    if (!isPanning) return;
    vb.x = startVB.x - (e.clientX - start.x) * (vb.w / rect.width);
    vb.y = startVB.y - (e.clientY - start.y) * (vb.h / rect.height);
    applyVB();
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => {
    mapArea.addEventListener(ev, e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        const p = [...pointers.values()][0];
        isPanning = true; start = { x: p.x, y: p.y }; startVB = { ...vb };
      } else if (pointers.size === 0) {
        isPanning = false;
      }
    });
  });
  function zoomAt(factor, cx, cy) {
    const nw = Math.max(HOME.w * 0.06, Math.min(HOME.w * 2.2, vb.w * factor));
    const nh = nw * (vb.h / vb.w);
    const relX = (cx - vb.x) / vb.w, relY = (cy - vb.y) / vb.h;
    vb.x = cx - relX * nw; vb.y = cy - relY * nh;
    vb.w = nw; vb.h = nh;
    applyVB();
  }
  mapArea.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = mapArea.getBoundingClientRect();
    const cx = vb.x + (e.clientX - rect.left) / rect.width * vb.w;
    const cy = vb.y + (e.clientY - rect.top) / rect.height * vb.h;
    zoomAt(e.deltaY > 0 ? 1.12 : 0.89, cx, cy);
  }, { passive: false });
  document.getElementById('zoomIn').addEventListener('click', () => zoomAt(0.8, vb.x + vb.w / 2, vb.y + vb.h / 2));
  document.getElementById('zoomOut').addEventListener('click', () => zoomAt(1.25, vb.x + vb.w / 2, vb.y + vb.h / 2));
  document.getElementById('zoomReset').addEventListener('click', () => { vb = { ...HOME }; applyVB(); });

  updateStats();
  input.focus();
}
