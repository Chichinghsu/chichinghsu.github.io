import { readStore, writeStore, share } from '/projects/challenge.js';

const DATA_URL = '/projects/taipei-cities/districts.json';
const STORE_KEY = 'draw-taiwan';

// 離島 are left out entirely.
const ISLAND_CITIES = new Set(['phu', 'kmt', 'llj']);
const ISLAND_TOWNS = new Set(['ptz-琉球鄉', 'ttz-綠島鄉', 'ttz-蘭嶼鄉']);
const MAIN_RING_ONLY = new Set(['ilan-頭城鎮']); // drop 龜山島 sub-path

const REGIONS = [
  { id: 'tw',   name: '台灣', cities: null },
  { id: 'nnk',  name: '北北基', cities: ['tpe', 'ntpc', 'kee'] },
  { id: 'tyc',  name: '桃園', cities: ['tyc'] },
  { id: 'hs',   name: '新竹', cities: ['hsz', 'hsc'] },
  { id: 'mli',  name: '苗栗', cities: ['hs'] },
  { id: 'tcc',  name: '台中', cities: ['tcc'] },
  { id: 'chw',  name: '彰化', cities: ['chw'] },
  { id: 'ntn',  name: '南投', cities: ['ntn'] },
  { id: 'yln',  name: '雲林', cities: ['yln'] },
  { id: 'cy',   name: '嘉義', cities: ['cyz', 'cyc'] },
  { id: 'tnn',  name: '台南', cities: ['tnn'] },
  { id: 'khh',  name: '高雄', cities: ['khh'] },
  { id: 'ptz',  name: '屏東', cities: ['ptz'] },
  { id: 'ila',  name: '宜蘭', cities: ['ilan'] },
  { id: 'hls',  name: '花蓮', cities: ['hls'] },
  { id: 'ttz',  name: '台東', cities: ['ttz'] },
];

// Scoring knobs — tune here.
const SCORING = {
  N: 256,             // raster frame size
  PAD: 16,            // frame padding
  W_IOU: 0.6,         // weight of area overlap
  W_EDGE: 0.4,        // weight of edge accuracy
  EDGE_ZERO: 0.10,    // mean boundary error (fraction of long side) that scores 0
  CURVE: 0.8,         // <1 is gentler
  ASPECT_FREE: 1.25,  // aspect ratio deviation with no penalty
  ASPECT_MAX_PEN: 10, // max points lost for wrong proportions
  MIN_LEN: 0.8,       // min stroke length, in canvas widths
  MIN_BOX: 0.2,       // min bbox long side, in canvas widths
  MIN_AREA: 0.02,     // min filled area, fraction of frame
};

const GRADES = [
  [90, '台灣大挑戰大師'],
  [75, '台灣大挑戰中師'],
  [60, '及格'],
  [40, '台灣大挑戰小師'],
  [0,  '加油好嗎'],
];
const gradeOf = s => GRADES.find(([min]) => s >= min)[1];

// ---------- geometry data ----------

function pathBBox(d) {
  const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < n.length; i += 2) {
    x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]);
    y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]);
  }
  return [x0, y0, x1, y1];
}

function buildRegions(data) {
  const towns = data.districts
    .filter(t => !ISLAND_CITIES.has(t.city) && !ISLAND_TOWNS.has(t.id))
    .map(t => {
      let d = t.d;
      if (MAIN_RING_ONLY.has(t.id)) d = d.split(/(?=M)/).filter(Boolean)[0];
      return { city: t.city, d, path: new Path2D(d), bbox: pathBBox(d) };
    });
  return REGIONS.map(r => {
    const set = r.cities && new Set(r.cities);
    const parts = towns.filter(t => !set || set.has(t.city));
    const bbox = parts.reduce((b, t) => [
      Math.min(b[0], t.bbox[0]), Math.min(b[1], t.bbox[1]),
      Math.max(b[2], t.bbox[2]), Math.max(b[3], t.bbox[3]),
    ], [Infinity, Infinity, -Infinity, -Infinity]);
    return { ...r, parts, bbox };
  });
}

// Maps a bbox into the N×N frame: long side = N - 2·PAD, centred.
function frameOf(bbox) {
  const { N, PAD } = SCORING;
  const w = bbox[2] - bbox[0], h = bbox[3] - bbox[1];
  const s = (N - 2 * PAD) / Math.max(w, h, 1e-6);
  return {
    s,
    tx: N / 2 - s * (bbox[0] + bbox[2]) / 2,
    ty: N / 2 - s * (bbox[1] + bbox[3]) / 2,
  };
}

// ---------- scoring ----------

function maskOf(drawFn) {
  const { N } = SCORING;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  drawFn(ctx);
  const px = ctx.getImageData(0, 0, N, N).data;
  const m = new Uint8Array(N * N);
  for (let i = 0; i < m.length; i++) m[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}

function boundaryOf(m) {
  const { N } = SCORING;
  const b = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (!m[i]) continue;
    if (x === 0 || y === 0 || x === N - 1 || y === N - 1 ||
        !m[i - 1] || !m[i + 1] || !m[i - N] || !m[i + N]) b[i] = 1;
  }
  return b;
}

// Two-pass 3-4 chamfer distance to the nearest boundary pixel, in pixels.
function distanceTo(b) {
  const { N } = SCORING;
  const INF = 1e9, d = new Float32Array(N * N);
  for (let i = 0; i < d.length; i++) d[i] = b[i] ? 0 : INF;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) {
      v = Math.min(v, d[i - N] + 3);
      if (x > 0) v = Math.min(v, d[i - N - 1] + 4);
      if (x < N - 1) v = Math.min(v, d[i - N + 1] + 4);
    }
    d[i] = v;
  }
  for (let y = N - 1; y >= 0; y--) for (let x = N - 1; x >= 0; x--) {
    const i = y * N + x; let v = d[i];
    if (x < N - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < N - 1) {
      v = Math.min(v, d[i + N] + 3);
      if (x < N - 1) v = Math.min(v, d[i + N + 1] + 4);
      if (x > 0) v = Math.min(v, d[i + N - 1] + 4);
    }
    d[i] = v;
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

const meanDistOver = (b, dist) => {
  let sum = 0, n = 0;
  for (let i = 0; i < b.length; i++) if (b[i]) { sum += dist[i]; n++; }
  return n ? sum / n : Infinity;
};

function pointsBBox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

function strokeLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

function fillTarget(ctx, region, f) {
  ctx.setTransform(f.s, 0, 0, f.s, f.tx, f.ty);
  for (const t of region.parts) ctx.fill(t.path, 'evenodd');
}

function fillUser(ctx, pts, f) {
  ctx.setTransform(f.s, 0, 0, f.s, f.tx, f.ty);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

// Returns { error } or { score, iou, edge, penalty, userFrame }.
function scoreDrawing(pts, region, canvasW) {
  const S = SCORING;
  if (pts.length < 8 || strokeLength(pts) < S.MIN_LEN * canvasW) return { error: '線太短了，請畫出完整的輪廓' };
  const ub = pointsBBox(pts);
  const uw = ub[2] - ub[0], uh = ub[3] - ub[1];
  if (Math.max(uw, uh) < S.MIN_BOX * canvasW) return { error: '畫得太小了，請畫大一點' };

  const tf = frameOf(region.bbox), uf = frameOf(ub);
  const T = maskOf(ctx => fillTarget(ctx, region, tf));
  const U = maskOf(ctx => fillUser(ctx, pts, uf));

  let inter = 0, uni = 0, area = 0;
  for (let i = 0; i < T.length; i++) {
    if (T[i] && U[i]) inter++;
    if (T[i] || U[i]) uni++;
    if (U[i]) area++;
  }
  if (area < S.MIN_AREA * T.length) return { error: '請畫出一個封閉的輪廓（起點和終點要靠近）' };
  const iou = inter / uni;

  const TB = boundaryOf(T), UB = boundaryOf(U);
  const dT = distanceTo(TB), dU = distanceTo(UB);
  const meanErr = (meanDistOver(UB, dT) + meanDistOver(TB, dU)) / 2;
  const edge = Math.max(0, 1 - meanErr / ((S.N - 2 * S.PAD) * S.EDGE_ZERO));

  const tw = region.bbox[2] - region.bbox[0], th = region.bbox[3] - region.bbox[1];
  const dev = Math.abs(Math.log((uw / Math.max(uh, 1e-6)) / (tw / th)));
  const penalty = Math.min(S.ASPECT_MAX_PEN, Math.max(0, dev - Math.log(S.ASPECT_FREE)) * 30);

  const raw = S.W_IOU * iou + S.W_EDGE * edge;
  const score = Math.max(0, Math.round(100 * Math.pow(raw, S.CURVE) - penalty));
  return { score, iou, edge, penalty, userFrame: uf };
}

// Circle practice: fit a circle to the stroke and measure how far it strays.
const CIRCLE = {
  DEV_ZERO: 0.35,   // RMS radial error (fraction of radius) that scores 0
  GAP_ZERO: 0.8,    // start/end gap (fraction of radius) that zeroes closure
  GAP_PEN: 15,      // points lost per radius of start/end gap (max 10)
  MAX_ANGLE_GAP: Math.PI * 0.75,
};

function scoreCircle(pts, canvasW) {
  const S = SCORING, C = CIRCLE;
  const ub = pointsBBox(pts);
  if (pts.length < 8 || Math.max(ub[2] - ub[0], ub[3] - ub[1]) < S.MIN_BOX * canvasW) return { error: '畫得太小了，請畫大一點' };

  // resample evenly by arc length so slow/fast hand speed doesn't bias the fit
  const total = strokeLength(pts), n = 120, rs = [];
  let seg = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = total * k / n;
    while (seg < pts.length - 2 && acc + Math.hypot(pts[seg + 1][0] - pts[seg][0], pts[seg + 1][1] - pts[seg][1]) < target) {
      acc += Math.hypot(pts[seg + 1][0] - pts[seg][0], pts[seg + 1][1] - pts[seg][1]);
      seg++;
    }
    const a = pts[seg], b = pts[seg + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = Math.min(1, Math.max(0, (target - acc) / l));
    rs.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  const cx = rs.reduce((s, p) => s + p[0], 0) / n, cy = rs.reduce((s, p) => s + p[1], 0) / n;
  const dist = rs.map(p => Math.hypot(p[0] - cx, p[1] - cy));
  const r = dist.reduce((s, d) => s + d, 0) / n;

  const ang = rs.map(p => Math.atan2(p[1] - cy, p[0] - cx)).sort((a, b) => a - b);
  let maxGap = ang[0] + 2 * Math.PI - ang[n - 1];
  for (let i = 1; i < n; i++) maxGap = Math.max(maxGap, ang[i] - ang[i - 1]);
  if (maxGap > C.MAX_ANGLE_GAP) return { error: '請畫出完整的一圈' };

  const dev = Math.sqrt(dist.reduce((s, d) => s + (d - r) ** 2, 0) / n) / r;
  const roundness = Math.max(0, 1 - dev / C.DEV_ZERO);
  const gap = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) / r;
  const closure = Math.max(0, 1 - gap / C.GAP_ZERO);
  const penalty = Math.min(10, gap * C.GAP_PEN);
  const score = Math.max(0, Math.round(100 * roundness - penalty));
  return { score, iou: roundness, edge: closure, penalty, circle: { cx, cy, r } };
}

// ---------- UI ----------

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export async function mountDraw(root, { shareUrl }) {
  root.innerHTML = '<p class="sub">載入地圖中…</p>';
  let regions;
  try {
    const data = await (await fetch(DATA_URL)).json();
    regions = [...buildRegions(data), { id: 'circle', name: '練手感（畫圓挑戰）', circle: true }];
  } catch (e) {
    root.innerHTML = '<p class="sub">地圖載入失敗，請重新整理。</p>';
    return;
  }

  const footer = document.querySelector('.foot');
  const setFooter = show => { if (footer) footer.style.visibility = show ? '' : 'hidden'; };

  const store = readStore(STORE_KEY);
  const best = id => (store.games[id] && store.games[id].best) || 0;

  function showMenu() {
    root.innerHTML = '';
    root.append(el('div', 'nav', '<a href="/projects/">← 所有挑戰</a>'));
    root.append(el('h1', null, '✏️ 台灣大挑戰：畫台灣'));
    root.append(el('p', 'sub', '<b>一筆畫</b>畫出輪廓，不能中途放開，放開手指就會算分。'));
    const [tw, ...rest] = regions.slice(0, -1);
    const circle = regions[regions.length - 1];
    const hero = el('button', 'menu-hero', `${tw.name}<small>${best(tw.id) ? `最佳 ${best(tw.id)} 分` : '先從台灣本島開始'}</small>`);
    hero.onclick = () => showGame(tw);
    root.append(hero);
    const grid = el('div', 'grid');
    for (const r of rest) {
      const b = el('button', 'rbtn', `${r.name}<span class="best">${best(r.id) ? `最佳 ${best(r.id)}` : ''}</span>`);
      b.onclick = () => showGame(r);
      grid.append(b);
    }
    const cb = el('button', 'menu-hero circle', `${circle.name}<small>${best(circle.id) ? `最佳 ${best(circle.id)} 分` : '畫一個圓，看看有多圓'}</small>`);
    cb.onclick = () => showGame(circle);
    root.append(grid, cb);
  }

  function showGame(region) {
    root.innerHTML = '';
    const bar = el('div', 'bar');
    bar.append(el('h2', null, region.circle ? region.name : `畫${region.name}`));
    const tog = el('label', 'tog', '<input type="checkbox"> 提示輪廓');
    const hintBox = tog.querySelector('input');
    const back = el('button', 'btn', '← 選縣市');
    back.onclick = showMenu;
    if (region.circle) tog.hidden = true;
    bar.append(tog, back);
    root.append(bar);

    const stage = el('div', 'stage');
    const canvas = el('canvas');
    stage.append(canvas);
    root.append(stage);
    const tip = el('div', 'tip', region.circle ? '按住並一筆畫出一個圓，放開就會算分' : '按住並一筆畫完，放開就會算分');
    root.append(tip);
    const rules = el('p', 'rules', region.circle
      ? '<b>計分方式</b>：畫完會找出最貼近你線條的正圓，看每一點偏離多少（圓度），起點與終點沒接上會扣分（封閉度）。'
      : '<b>計分方式</b>：你的圖會先縮放並置中，再與真實輪廓比對。<br>60% 看形狀重疊，40% 看邊緣貼合程度。<br>長寬比例差太多最多扣 10 分。<br>大小和位置不影響分數。');
    root.append(rules);
    const resultBox = el('div');
    root.append(resultBox);

    const ctx = canvas.getContext('2d');
    let W = 0, dpr = 1;
    let pts = [], drawing = false, finished = false, result = null;

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      W = r.width;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(W * dpr);
      render();
    }

    function frameToCanvas(f) {
      const k = (W * dpr) / SCORING.N;
      ctx.setTransform(k * f.s, 0, 0, k * f.s, k * f.tx, k * f.ty);
    }

    function render() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const tf = region.circle ? null : frameOf(region.bbox);
      if (result && !result.error && region.circle) {
        const { cx, cy, r } = result.circle;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,200,115,.9)';
        ctx.stroke();
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.lineWidth = 4;
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.strokeStyle = '#f5b800';
        ctx.stroke();
        return;
      }
      if (result && !result.error) {
        frameToCanvas(tf);
        ctx.fillStyle = 'rgba(0,160,90,.55)';
        for (const t of region.parts) ctx.fill(t.path, 'evenodd');
        frameToCanvas(result.userFrame);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = 'rgba(245,184,0,.25)';
        ctx.fill();
        ctx.lineWidth = 3 * SCORING.N / (W * result.userFrame.s);
        ctx.strokeStyle = '#f5b800';
        ctx.lineJoin = 'round';
        ctx.stroke();
        return;
      }
      if (hintBox.checked && !region.circle) {
        frameToCanvas(tf);
        ctx.fillStyle = 'rgba(255,255,255,.12)';
        for (const t of region.parts) ctx.fill(t.path, 'evenodd');
      }
      if (pts.length) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.lineWidth = 4;
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.strokeStyle = '#f5b800';
        ctx.stroke();
        if (finished) { // faint closing segment
          ctx.beginPath();
          ctx.moveTo(...pts[pts.length - 1]);
          ctx.lineTo(...pts[0]);
          ctx.setLineDash([6, 6]);
          ctx.strokeStyle = 'rgba(245,184,0,.5)';
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    const pos = e => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    canvas.addEventListener('pointerdown', e => {
      if (finished) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawing = true;
      setFooter(false);
      pts = [pos(e)];
      tip.className = 'tip';
      tip.textContent = '畫畫中…回到起點附近再放開';
      render();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) pts.push(pos(ev));
      render();
    });
    const end = e => {
      if (!drawing) return;
      drawing = false;
      setFooter(true);
      finished = true;
      result = region.circle ? scoreCircle(pts, W) : scoreDrawing(pts, region, W);
      if (result.error) {
        tip.className = 'tip err';
        tip.textContent = result.error;
        finished = false; pts = []; result = null;
        render();
        return;
      }
      showResult();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    hintBox.addEventListener('change', () => { if (!finished) render(); });
    window.addEventListener('resize', resize);

    function showResult() {
      const hinted = hintBox.checked;
      const { score, iou, edge, penalty } = result;
      const prev = best(region.id);
      const isBest = !hinted && score > prev;
      if (isBest) {
        store.games[region.id] = { best: score };
        writeStore(STORE_KEY, store);
      }
      tip.className = 'tip';
      tip.textContent = '';
      hintBox.disabled = true;
      render();
      const pct = v => Math.round(v * 100);
      const row = (label, v) =>
        `<span>${label}</span><div class="meter"><i style="width:${pct(v)}%"></i></div><span>${pct(v)}%</span>`;
      resultBox.innerHTML = '';
      const box = el('div', 'result',
        `<div class="score">${score}<span> / 100</span></div>
         <div class="grade">${gradeOf(score)}${isBest ? ' · 🎉 新紀錄' : ''}</div>
         <div class="parts">${row(region.circle ? '圓度' : '形狀重疊', iou)}${row(region.circle ? '封閉度' : '邊緣精準', edge)}</div>
         <div class="note">${penalty > 0.5 ? `${region.circle ? '起點和終點沒接上' : '長寬比例不對'}，扣 ${Math.round(penalty)} 分。` : ''}
           ${hinted ? '使用了提示，不計入最佳紀錄。' : `最佳：${Math.max(prev, score)} 分`}</div>
         <div class="legend">${region.circle ? '<span><b style="background:#00a05a"></b>最接近的正圓</span><span><b style="background:#f5b800"></b>你畫的</span>' : '<span><b style="background:#00a05a"></b>正確輪廓</span><span><b style="background:#f5b800"></b>你畫的（已縮放置中）</span>'}</div>`);
      const actions = el('div', 'actions');
      const again = el('button', 'btn primary', '再畫一次');
      again.onclick = () => showGame(region);
      const other = el('button', 'btn', '換縣市');
      other.onclick = showMenu;
      const sh = el('button', 'btn', '分享結果');
      sh.onclick = () => share(`我在「台挑畫台灣」${region.circle ? '畫圓' : '一筆畫' + region.name}拿了 ${score} 分！換你來畫了：\n${shareUrl}`, sh);
      const more = el('a', 'btn', '其他挑戰');
      more.href = 'https://cchsu.tw/projects/';
      actions.append(again, other, sh, more);
      box.append(actions);
      box.append(rules);
      resultBox.append(box);
    }

    resize();
  }

  showMenu();
}
