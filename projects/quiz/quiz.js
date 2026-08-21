// Shared engine for the station-recall quizzes.
//
// A game is one folder under /projects/ containing an index.html (meta tags +
// a call to mountQuiz) and a data JSON. Everything else — DOM, projection,
// matching, scoring, pan/zoom — lives here, so adding a new network means
// adding a data file plus a GAMES entry.

// ---- registry: powers the cross-quiz switcher in the header ----
 
export const GAMES = [
  { id:'homepage', path:'/projects/',     short:'看所有挑戰',   title:'看所有挑戰',     accent:'#b8860b' },
  { id:'metro', path:'/projects/metro/',     short:'雙北捷運',   title:'雙北捷運',     accent:'#b8860b' },
  { id:'khh',   path:'/projects/khh_metro/', short:'高雄捷運',   title:'高雄捷運',     accent:'#de3b34' },
  { id:'tra',   path:'/projects/tra/',       short:'台鐵西部', title:'台鐵西部', accent:'#0b4f9e' },
  { id:'tra-east',   path:'/projects/tra-east/',       short:'台鐵東部', title:'台鐵東部', accent:'#0b4f9e' },
  { id:'freeway', path:'/projects/freeway/',    short:'國道一號',   title:'國道一號',     accent:'#00703C' },
  { id:'freeway3', path:'/projects/freeway3/',    short:'國道三號',   title:'國道三號',     accent:'#00703C' },
  { id:'who-is-older', path:'/projects/who-is-older/',    short:'博愛座',   title:'博愛座',     accent:'#0f766e' },
  { id:'taiwan-grid',   path:'/projects/taiwan-grid/',       short:'台灣九宮格',       title:'台灣九宮格',         accent:'#0f766e' },
];

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => {
  const n = document.createElementNS(SVGNS, tag);
  for(const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

// ---------------------------------------------------------------- projection
//
// Three layouts, all equirectangular at heart:
//   core   — scale from the stations flagged `core`, then squeeze outliers
//            asymptotically into a margin band (Taipei: keeps the dense centre
//            legible while folding in the Airport/Sanying branches).
//   geo    — plain bounding box of every station.
//   island — bounding box of the `outline` ring, which is drawn behind the
//            network so the empty side of Taiwan reads as mountains.
function buildProjection(DATA, layout){
  const mode = layout.mode || 'geo';
  const stations = DATA.stations;
  const pts = mode === 'island'
    ? DATA.outline.map(c => ({lat:c[1], lon:c[0]}))
    : (mode === 'core' ? stations.filter(s=>s.core) : stations);
  const lats = pts.map(p=>p.lat), lons = pts.map(p=>p.lon);
  const latMin = Math.min(...lats), latMax = Math.max(...lats);
  const lonMin = Math.min(...lons), lonMax = Math.max(...lons);
  const cosLat = Math.cos((latMin+latMax)/2*Math.PI/180);

  if(mode === 'core'){
    const PAD = layout.pad ?? 40;
    const MARGIN = layout.margin ?? 150;
    const CW = layout.width ?? 760, CH = layout.height ?? 900;
    const scale = Math.min((CW-2*PAD)/((lonMax-lonMin)*cosLat), (CH-2*PAD)/(latMax-latMin));
    const squeeze = (v, lo, hi) => {
      if(v < lo){ const over = lo-v; return lo - MARGIN*(1-1/(1+over/MARGIN)); }
      if(v > hi){ const over = v-hi; return hi + MARGIN*(1-1/(1+over/MARGIN)); }
      return v;
    };
    return {
      W: CW + 2*MARGIN, H: CH + 2*MARGIN,
      project(lat, lon){
        const x = PAD + (lon-lonMin)*cosLat*scale;
        const y = PAD + (latMax-lat)*scale;
        return [squeeze(x, PAD, CW-PAD)+MARGIN, squeeze(y, PAD, CH-PAD)+MARGIN];
      },
    };
  }

  const PAD = layout.pad ?? 120;
  const PLOT_H = layout.height ?? 1320;
  const scale = PLOT_H/(latMax-latMin);
  return {
    W: PAD*2 + (lonMax-lonMin)*cosLat*scale,
    H: PAD*2 + PLOT_H,
    project: (lat, lon) => [PAD + (lon-lonMin)*cosLat*scale, PAD + (latMax-lat)*scale],
  };
}

// Real GPS positions bunch up wherever a network serves a city centre (TRA
// around Taipei and Kaohsiung is the worst case): dots overlap and there is no
// room left for a label. Nudge any pair closer than `minSep` apart, with a weak
// spring back to the true position so the map stays recognisably geographic.
function declutter(stations, minSep, spring = 0.04, iterations = 260){
  if(!minSep) return;
  const home = stations.map(s => [s.x, s.y]);
  for(let it=0; it<iterations; it++){
    for(let i=0; i<stations.length; i++){
      for(let j=i+1; j<stations.length; j++){
        const a = stations[i], b = stations[j];
        let dx = b.x-a.x, dy = b.y-a.y;
        let d = Math.hypot(dx, dy);
        if(d >= minSep) continue;
        if(d < 1e-6){ dx = (i%2?1:-1)*0.1; dy = 0.1; d = Math.hypot(dx,dy); }
        const push = (minSep-d)/2 * 0.5;
        const ux = dx/d*push, uy = dy/d*push;
        a.x -= ux; a.y -= uy; b.x += ux; b.y += uy;
      }
    }
    for(let i=0; i<stations.length; i++){ // spring home
      stations[i].x += (home[i][0]-stations[i].x)*spring;
      stations[i].y += (home[i][1]-stations[i].y)*spring;
    }
  }
}

// ---------------------------------------------------------------------- DOM
function buildLayout(cfg){
  document.body.innerHTML = `
<div class="topbar">
  <div class="brand">
    <h1>${cfg.heading}</h1>
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
        <g id="islandLayer"></g>
        <g id="linesLayer"></g>
        <g id="dotsLayer"></g>
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
      <input id="guessInput" type="text" placeholder="請輸入 ..." />
      <button class="primary" type="submit">確定</button>
    </form>
    <div class="feedback" id="feedback"></div>
    <div class="hint">${cfg.hint}<br>想不出來了就按「交卷」看成績單</div>

    <div style="display:flex; gap:8px;">
      <button id="revealBtn" style="flex:1;">公布解答</button>
      <button id="submitBtn" class="primary" style="flex:1;">交卷</button>
    </div>

    <div class="legend" id="legend"></div>

    <div class="found-list" id="foundList">
      <h3>已找到的站</h3>
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
    <div class="rp-share"><span class="rp-tag">${cfg.hashtag}</span></div>
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
      ${GAMES.filter(g=>g.id!==cfg.id).map(g=>`
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
  document.getElementById('rpMore').addEventListener('click', e=>{
    e.preventDefault();
    gamesOverlay.classList.add('show');
  });
  document.getElementById('gamesClose').addEventListener('click', ()=> gamesOverlay.classList.remove('show'));
  gamesOverlay.addEventListener('click', e=>{
    if(e.target === gamesOverlay) gamesOverlay.classList.remove('show');
  });

  const me = GAMES.find(g=>g.id===cfg.id);
  if(me) document.documentElement.style.setProperty('--accent', me.accent);
  if(cfg.label){
    document.documentElement.style.setProperty('--lbl-zh', cfg.label.zh+'px');
    document.documentElement.style.setProperty('--lbl-en', cfg.label.en+'px');
  }
  document.getElementById('switcher').innerHTML = '更多挑戰：' + GAMES
    .filter(g=>g.id!==cfg.id)
    .map(g=>`<a href="${g.path}">${g.title} →</a>`)
    .join('') + '<a href="https://apps.apple.com/ph/app/id6774146443" target="_blank" rel="nofollow noopener">日本車牌制霸 App (iOS) →</a>';
}

// -------------------------------------------------------------------- engine
export async function mountQuiz(cfg){
  buildLayout(cfg);
  const DATA = await (await fetch(cfg.data)).json();
  run(cfg, DATA);
}

function run(cfg, DATA){
  const stations = DATA.stations;
  const lines = DATA.lines;
  const lineMeta = DATA.lineMeta;
  // The legend / report / dot colours are usually grouped by line, but a network
  // that is a single line (國道1號) is better broken down some other way. Setting
  // `groupBy: "type"` in the data buckets stations by that field instead, using
  // `typeMeta` for the names and colours. Lines still drive the drawn polylines.
  const groupBy = DATA.groupBy;
  const groupMeta = (groupBy && DATA[groupBy+'Meta']) || lineMeta;
  const groupsOf = s => groupBy ? [s[groupBy]] : s.lines;
  const layout = cfg.layout || {};
  const LBL_ZH = cfg.label?.zh ?? 6.5;
  const LBL_EN = cfg.label?.en ?? 4.6;

  const proj = buildProjection(DATA, layout);
  const {W, H} = proj;
  const byId = {};
  stations.forEach(s=>{
    const [x,y] = proj.project(s.lat, s.lon);
    s.x = x; s.y = y;
    byId[s.id] = s;
  });
  declutter(stations, layout.minSep, layout.spring);

  // ---- island background ----
  if(layout.mode === 'island' && DATA.outline){
    document.getElementById('islandLayer').appendChild(el('polygon', {
      points: DATA.outline.map(c=>proj.project(c[1], c[0]).join(',')).join(' '),
      class: 'island',
    }));
  }

  // ---- normalization / matching ----
  function norm(str){
    return str.toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/mrt|lrt|station|臺|台/g, m => (m==='臺'||m==='台') ? '台' : '') // unify 臺/台, drop mrt/lrt/station
      .replace(/[^a-z0-9\u4e00-\u9fff]/g,'');
  }
  // A guess maps to a LIST of station ids: some names are shared by two
  // physically separate stations (雙北 三重 on the Orange Line vs the Airport
  // MRT; 高雄 哈瑪星 on the Orange Line vs the light rail), and naming one
  // should unlock both.
  const aliasMap = {};
  function addAlias(alias, id){
    const n = norm(alias);
    if(!n || !byId[id]) return;
    (aliasMap[n] ||= []).push(id);
    aliasMap[n] = [...new Set(aliasMap[n])];
  }
  stations.forEach(s=>{
    addAlias(s.en, s.id);
    addAlias(s.zh, s.id);
    addAlias(s.zh+'車站', s.id);
    s.en.split('/').forEach(part=>addAlias(part, s.id));
    addAlias(s.en.replace(/\./g,''), s.id);
  });
  Object.entries(cfg.aliases || {}).forEach(([k,v])=> addAlias(k, v));

  // ---- draw lines ----
  const linesLayer = document.getElementById('linesLayer');
  Object.keys(lines).forEach(key=>{
    const meta = lineMeta[key.split('_')[0]];
    linesLayer.appendChild(el('polyline', {
      points: lines[key].map(id=>byId[id].x+','+byId[id].y).join(' '),
      fill: 'none',
      stroke: meta.color,
      'stroke-width': 3,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      opacity: 0.85,
    }));
  });

  // ---- station dots ----
  const dotsLayer = document.getElementById('dotsLayer');
  const labelsLayer = document.getElementById('labelsLayer');
  const dotEls = {};
  stations.forEach(s=>{
    const c = el('circle', {cx:s.x, cy:s.y, r:s.lines.length>1?3.6:2.4, class:'station-dot-bg', 'data-id':s.id});
    dotsLayer.appendChild(c);
    dotEls[s.id] = c;
  });

  const found = new Set();
  const placedBoxes = []; // {x1,y1,x2,y2} of placed labels, for collision avoidance

  // Nothing is persisted, so an accidental close / back-swipe wipes the whole
  // game. Guard the tab once there is progress worth losing. Browsers show
  // their own wording and ignore ours, but the prompt is the point.
  let leaving = false; // set by 再玩一次, which throws the progress away on purpose
  window.addEventListener('beforeunload', e=>{
    if(leaving || !found.size) return;
    e.preventDefault();
    e.returnValue = '確定要離開此頁嗎？作答進度不會保存。';
    return e.returnValue;
  });

  const colorForStation = s => groupMeta[groupsOf(s)[0]].color;

  // Rough text width: CJK glyphs are ~1em square, Latin glyphs ~0.55em.
  function textWidth(str, fontSize){
    let w = 0;
    for(const ch of str){
      if(/[\u4e00-\u9fff]/.test(ch)) w += fontSize;
      else if(ch === ' ') w += fontSize*0.3;
      else w += fontSize*0.58;
    }
    return w;
  }
  // Freeway data carries a milepost; on a road the distance marker is half the
  // identity of an interchange ("71 楊梅端"), so prefix it onto the map label.
  const labelZh = s => (s.km != null ? s.km+' '+s.zh : s.zh);
  const boxesOverlap = (a,b,pad) =>
    !(a.x2+pad < b.x1 || b.x2+pad < a.x1 || a.y2+pad < b.y1 || b.y2+pad < a.y1);

  // Candidate placements around a dot; dx/dyZh/dyEn are offsets from the
  // station centre, anchor controls which way the text grows. Networks that run
  // mostly north-south (TRA) prefer the left/right slots, since above/below
  // almost always collides with the neighbouring station — hence `sideFirst`.
  const SIDE_FIRST = [
    {dx:6,  dyZh:2.4,  dyEn:7.8,  anchor:'start'},
    {dx:-6, dyZh:2.4,  dyEn:7.8,  anchor:'end'},
    {dx:6,  dyZh:-6,   dyEn:-0.6, anchor:'start'},
    {dx:-6, dyZh:-6,   dyEn:-0.6, anchor:'end'},
    {dx:6,  dyZh:11,   dyEn:16.4, anchor:'start'},
    {dx:-6, dyZh:11,   dyEn:16.4, anchor:'end'},
    {dx:0,  dyZh:-11,  dyEn:-5.6, anchor:'middle'},
    {dx:0,  dyZh:9.5,  dyEn:14.9, anchor:'middle'},
  ];
  const ALL_ROUND = [
    {dx:6,  dyZh:2.2,  dyEn:7.4,  anchor:'start'},
    {dx:-6, dyZh:2.2,  dyEn:7.4,  anchor:'end'},
    {dx:0,  dyZh:-11,  dyEn:-5.8, anchor:'middle'},
    {dx:0,  dyZh:9,    dyEn:14.2, anchor:'middle'},
    {dx:6,  dyZh:-6,   dyEn:-0.8, anchor:'start'},
    {dx:6,  dyZh:10.5, dyEn:15.7, anchor:'start'},
    {dx:-6, dyZh:-6,   dyEn:-0.8, anchor:'end'},
    {dx:-6, dyZh:10.5, dyEn:15.7, anchor:'end'},
  ];
  const CANDIDATES = layout.sideFirst ? SIDE_FIRST : ALL_ROUND;
  const RINGS = layout.labelRings ?? 3;

  function computeBox(s, c, ring){
    const scaleUp = 1 + ring*0.85;
    const dx = c.dx*scaleUp;
    const dyZh = c.dyZh<0 ? c.dyZh*scaleUp : (c.dyZh===0 ? 0 : c.dyZh + ring*5.5);
    const dyEn = c.dyEn<0 ? c.dyEn*scaleUp : (c.dyEn===0 ? 0 : c.dyEn + ring*5.5);
    const maxW = Math.max(textWidth(labelZh(s), LBL_ZH), textWidth(s.en, LBL_EN));
    const x = s.x + dx;
    let x1, x2;
    if(c.anchor==='start'){ x1=x; x2=x+maxW; }
    else if(c.anchor==='end'){ x1=x-maxW; x2=x; }
    else { x1=x-maxW/2; x2=x+maxW/2; }
    return {
      x1, x2,
      y1: s.y + Math.min(dyZh, dyEn) - LBL_ZH*0.8,
      y2: s.y + Math.max(dyZh, dyEn) + LBL_ZH*0.34,
      dx, dyZh, dyEn, anchor:c.anchor,
    };
  }

  function placeLabel(s){
    for(let ring=0; ring<RINGS; ring++){
      for(const c of CANDIDATES){
        const box = computeBox(s, c, ring);
        if(!placedBoxes.some(pb => boxesOverlap(box, pb, 1.2))){
          placedBoxes.push(box);
          return box;
        }
      }
    }
    const fallback = computeBox(s, CANDIDATES[0], 0); // accept overlap
    placedBoxes.push(fallback);
    return fallback;
  }

  function drawLabel(s, box, {muted=false}={}){
    const g = el('g', {});
    const zh = el('text', {x:s.x+box.dx, y:s.y+box.dyZh, 'text-anchor':box.anchor, class:'station-label'});
    if(muted) zh.setAttribute('fill', '#9098a3');
    zh.textContent = labelZh(s);
    g.appendChild(zh);
    if(!muted){
      const en = el('text', {x:s.x+box.dx, y:s.y+box.dyEn, 'text-anchor':box.anchor, class:'station-label en'});
      en.textContent = s.en;
      g.appendChild(en);
    }
    labelsLayer.appendChild(g);
  }

  function revealStation(id, {isGuess=false}={}){
    const s = byId[id];
    if(!s) return false;
    if(found.has(id)) return null; // already found
    found.add(id);
    const dot = dotEls[id];
    dot.setAttribute('class', 'station-dot-found pop-anim');
    dot.setAttribute('fill', colorForStation(s));
    dot.setAttribute('r', s.lines.length>1 ? 4.4 : 3);
    if(s.lines.length>1){
      dotsLayer.appendChild(el('circle', {cx:s.x, cy:s.y, r:6.4, class:'interchange-ring', stroke:'#1c2530'}));
    }
    drawLabel(s, placeLabel(s));
    updateStats();
    addFoundListItem(s, isGuess);
    return true;
  }

  let submitted = false;
  let finalScore = null; // frozen at 交卷 or 公布解答, whichever comes first

  // Closing the game: no more guessing, and 交卷 turns into 看成績單.
  function endGame(){
    if(submitted) return;
    submitted = true;
    input.disabled = true;
    input.placeholder = '已交卷';
    form.querySelector('button[type=submit]').disabled = true;
    document.getElementById('submitBtn').textContent = '看成績單';
    feedback.textContent = '已交卷 — 成績已結算';
    feedback.className = 'feedback ok';
  }

  // 公布解答 fills the map in, so the score has to be frozen *before* that —
  // otherwise 交卷 afterwards reads the revealed stations back as 100%.
  function revealAllRemaining(){
    if(!finalScore) finalScore = snapshotScore();
    endGame();
    stations.forEach(s=>{
      if(found.has(s.id)) return;
      found.add(s.id);
      const dot = dotEls[s.id];
      dot.setAttribute('class', 'station-dot-found');
      dot.setAttribute('fill', '#c7ccd4');
      dot.setAttribute('stroke', '#98a1ad');
      drawLabel(s, placeLabel(s), {muted:true});
      addFoundListItem(s, false, true);
    });
    updateStats();
  }

  function snapshotScore(){
    return {
      count: found.size,
      perLine: Object.fromEntries(Object.keys(groupMeta).map(k=>{
        let f = 0;
        stations.forEach(s=>{ if(groupsOf(s).includes(k) && found.has(s.id)) f++; });
        return [k, f];
      })),
    };
  }

  // Once the score is frozen the counters keep showing it, so the header never
  // contradicts the report card.
  function updateStats(){
    const count = finalScore ? finalScore.count : found.size;
    document.getElementById('foundCount').textContent = count;
    document.getElementById('totalCount').textContent = stations.length;
    const pct = (count/stations.length*100).toFixed(1);
    document.getElementById('pctCount').textContent = pct+'%';
    document.getElementById('progressBar').style.width = pct+'%';
    updateLegendProgress();
  }

  const foundItemsEl = document.getElementById('foundItems');
  function addFoundListItem(s, isGuess, isReveal=false){
    const row = document.createElement('div');
    row.className = 'found-item'+(isReveal?' reveal':'');
    const badges = groupsOf(s).map(lk=>{
      const lm = groupMeta[lk];
      return '<span class="line-badge" style="background:'+lm.color+'">'+(lm.short || lk)+
        '<span class="line-tip">'+lm.name+'</span></span>';
    }).join('');
    row.innerHTML = '<span class="fi-name">'+badges+s.zh+'</span><span class="zh">'+s.en+'</span>';
    foundItemsEl.prepend(row);
  }

  // ---- form handling ----
  const form = document.getElementById('guessForm');
  const input = document.getElementById('guessInput');
  const feedback = document.getElementById('feedback');
  form.addEventListener('submit', e=>{
    e.preventDefault();
    const raw = input.value.trim();
    if(!raw) return;
    const ids = aliasMap[norm(raw)];
    if(!ids || !ids.length){
      feedback.textContent = '"'+raw+'" — 沒有這站 QQ';
      feedback.className = 'feedback no';
      input.select();
      return;
    }
    const newlyFound = [];
    ids.forEach(id=>{ if(revealStation(id, {isGuess:true}) === true) newlyFound.push(byId[id]); });
    if(newlyFound.length){
      feedback.textContent = '✓ ' + newlyFound.map(s=>s.zh+' ('+s.en+')').join('  +  ');
      feedback.className = 'feedback ok';
      input.value = '';
    } else {
      feedback.textContent = '已解鎖: '+ids.map(id=>byId[id].zh).join(', ');
      feedback.className = 'feedback no';
    }
    input.focus();
  });

  document.getElementById('revealBtn').addEventListener('click', ()=>{
    if(confirm('公布所有還沒解鎖的車站？成績會以目前的進度結算，之後不能再作答。')) revealAllRemaining();
  });

  // ---- 交卷 / report card ----
  // Ranks are checked top-down; the first threshold the score clears wins.
  const rankFor = pct => cfg.ranks.find(r=>pct>=r.min) || cfg.ranks[cfg.ranks.length-1];
  const overlay = document.getElementById('reportOverlay');
  function showReport(){
    if(!finalScore) finalScore = snapshotScore();
    const pctNum = finalScore.count/stations.length*100;
    const rank = rankFor(pctNum);
    const d = new Date();
    document.getElementById('rpDate').textContent =
      d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+String(d.getDate()).padStart(2,'0');
    document.getElementById('rpRank').textContent = rank.title;
    document.getElementById('rpQuip').textContent = rank.quip;
    document.getElementById('rpScore').textContent = pctNum.toFixed(1)+'%';
    document.getElementById('rpCount').textContent = finalScore.count+' / '+stations.length+' 站';
    document.getElementById('rpBar').style.width = Math.max(pctNum, 0.8)+'%';
    document.getElementById('rpLines').innerHTML = Object.keys(groupMeta).map(k=>{
      const tot = lineTotals[k];
      const lp = tot ? Math.round((finalScore.perLine[k]||0)/tot*100) : 0;
      return '<div class="rp-line"><span class="sw" style="background:'+groupMeta[k].color+
        '"></span>'+groupMeta[k].name.replace(/\s*\(.*\)$/,'')+'<span class="v">'+lp+'%</span></div>';
    }).join('');
    overlay.classList.add('show');
  }

  document.getElementById('submitBtn').addEventListener('click', ()=>{
    if(!submitted && !confirm('確定交卷？交卷後就不能再作答了。')) return;
    if(!finalScore) finalScore = snapshotScore();
    endGame();
    showReport();
  });
  document.getElementById('rpRestart').addEventListener('click', ()=>{
    leaving = true;
    location.reload();
  });
  document.getElementById('rpReveal').addEventListener('click', ()=>{
    overlay.classList.remove('show');
    revealAllRemaining();
  });
  overlay.addEventListener('click', e=>{ if(e.target === overlay) overlay.classList.remove('show'); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') overlay.classList.remove('show'); });

  // ---- legend ----
  const legendEl = document.getElementById('legend');
  const lineTotals = {}, legendProgEls = {};
  Object.keys(groupMeta).forEach(k=>{
    lineTotals[k] = stations.filter(s=>groupsOf(s).includes(k)).length;
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = '<span class="swatch" style="background:'+groupMeta[k].color+'"></span><b>'+
      groupMeta[k].name+'</b><span class="legend-prog"></span>';
    legendEl.appendChild(row);
    legendProgEls[k] = row.querySelector('.legend-prog');
  });
  function updateLegendProgress(){
    Object.keys(groupMeta).forEach(k=>{
      let f = 0;
      if(finalScore) f = finalScore.perLine[k] || 0;
      else stations.forEach(s=>{ if(groupsOf(s).includes(k) && found.has(s.id)) f++; });
      const tot = lineTotals[k];
      legendProgEls[k].textContent = f+'/'+tot+' · '+(tot ? (f/tot*100).toFixed(0) : 0)+'%';
    });
  }

  // ---- viewBox / pan & zoom ----
  const svg = document.getElementById('svg');
  let vb = {x:0, y:0, w:W, h:H};
  const applyVB = ()=> svg.setAttribute('viewBox', vb.x+' '+vb.y+' '+vb.w+' '+vb.h);
  applyVB();

  const mapArea = document.getElementById('mapArea');
  let isPanning = false, start = {x:0,y:0}, startVB = null;
  const pointers = new Map();   // active touch/pointer positions
  let pinch = null;             // {dist, cx, cy} in screen coords when pinch begins
  function pinchState(){
    const pts = [...pointers.values()];
    const dx = pts[0].x-pts[1].x, dy = pts[0].y-pts[1].y;
    return {dist: Math.hypot(dx,dy), cx:(pts[0].x+pts[1].x)/2, cy:(pts[0].y+pts[1].y)/2};
  }
  mapArea.addEventListener('pointerdown', e=>{
    // The zoom buttons live inside mapArea; capturing the pointer here would
    // retarget the follow-up events (and the click) to mapArea, so the buttons
    // would never fire. Leave that corner alone.
    if(e.target.closest('.zoomctl')) return;
    pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
    mapArea.setPointerCapture(e.pointerId);
    if(pointers.size === 1){
      isPanning = true; start = {x:e.clientX, y:e.clientY}; startVB = {...vb};
    } else if(pointers.size === 2){
      isPanning = false;
      pinch = pinchState();
    }
  });
  mapArea.addEventListener('pointermove', e=>{
    if(!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
    const rect = mapArea.getBoundingClientRect();
    if(pointers.size >= 2 && pinch){
      const now = pinchState();
      if(now.dist > 0){
        const px = vb.x + (now.cx-rect.left)/rect.width*vb.w;
        const py = vb.y + (now.cy-rect.top)/rect.height*vb.h;
        zoomAt(pinch.dist/now.dist, px, py);
      }
      pinch = now;
      return;
    }
    if(!isPanning) return;
    vb.x = startVB.x - (e.clientX-start.x)*(vb.w/rect.width);
    vb.y = startVB.y - (e.clientY-start.y)*(vb.h/rect.height);
    applyVB();
  });
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>{
    mapArea.addEventListener(ev, e=>{
      pointers.delete(e.pointerId);
      if(pointers.size < 2) pinch = null;
      if(pointers.size === 1){
        const p = [...pointers.values()][0];
        isPanning = true; start = {x:p.x, y:p.y}; startVB = {...vb};
      } else if(pointers.size === 0){
        isPanning = false;
      }
    });
  });
  function zoomAt(factor, cx, cy){
    const nw = Math.max(60, Math.min(W*2.2, vb.w*factor));
    const nh = nw * (vb.h/vb.w);
    const relX = (cx-vb.x)/vb.w, relY = (cy-vb.y)/vb.h;
    vb.x = cx - relX*nw; vb.y = cy - relY*nh;
    vb.w = nw; vb.h = nh;
    applyVB();
  }
  mapArea.addEventListener('wheel', e=>{
    e.preventDefault();
    const rect = mapArea.getBoundingClientRect();
    const px = vb.x + (e.clientX-rect.left)/rect.width*vb.w;
    const py = vb.y + (e.clientY-rect.top)/rect.height*vb.h;
    zoomAt(e.deltaY>0 ? 1.12 : 0.89, px, py);
  }, {passive:false});
  document.getElementById('zoomIn').addEventListener('click', ()=> zoomAt(0.8, vb.x+vb.w/2, vb.y+vb.h/2));
  document.getElementById('zoomOut').addEventListener('click', ()=> zoomAt(1.25, vb.x+vb.w/2, vb.y+vb.h/2));
  document.getElementById('zoomReset').addEventListener('click', ()=>{ vb = {x:0, y:0, w:W, h:H}; applyVB(); });

  updateStats();
  input.focus();
}
