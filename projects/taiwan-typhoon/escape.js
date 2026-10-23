import { readStore, writeStore, share, esc } from '/projects/challenge.js';
import { NAMES } from '/projects/taiwan-typhoon/names.js';

const STORE_KEY = 'taiwan-typhoon';
let WX = 310, WY = -30, W = 1040, H = 1760;
const HOURS_PER_SEC = 6;      // 現實 1 秒 = 遊戲 6 小時
const SPEED = 340;            // 台灣移動速度（單位/秒）
const SPRITE = 0.8;           // 台灣縮放
const PUSH_R = 20;            // 擠壓鄰國的半徑
const MAX_PUSH = 110;          // 陸地最多被擠多遠
const WARN = 2;
const MOVE_T = 0.45;         // 颱風每一步的移動時間
const PRED = 3;              // 預測幾步             // 颱風生成後的預警秒數

const fmtTime = h => { const t = Math.floor(h); return `${Math.floor(t / 24)} 天 ${t % 24} 小時`; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

export async function mountTyphoonEscape(root, cfg = {}) {
  root.innerHTML = '<p class="sub">地圖載入中…</p>';
  let map = null;
  try { map = await (await fetch('/projects/taiwan-typhoon/map.json')).json(); } catch (e) { /* 沒有陸地也能玩 */ }
  const haw = map && map.hawaii;   // 夏威夷：真實位置離台灣太遠，改放在地圖右緣（緯度照實）

  // ---------------------------------------------------------------- 陸地（可被擠壓）
  const polys = [];            // { s, e, x0,y0,x1,y1 } 指向 flat 陣列的區段
  const rx = [], ry = [];      // 原始座標
  let twPts = [[0, -60], [20, 0], [0, 60]], twHome = [WX + W * 0.4, WY + H * 0.4];
  if (map) {
    for (const l of map.land) {
      const p = l.p;
      if (l.tw) {
        let cx = 0, cy = 0; const n = p.length / 2;
        for (let i = 0; i < p.length; i += 2) { cx += p[i]; cy += p[i + 1]; }
        cx /= n; cy /= n;
        twHome = [cx, cy];
        twPts = []; for (let i = 0; i < p.length; i += 2) twPts.push([(p[i] - cx) * SPRITE, (p[i + 1] - cy) * SPRITE]);
        continue;
      }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
      const s = rx.length, m = p.length / 2;
      for (let i = 0; i < m; i++) {
        const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[((i + 1) % m) * 2], by = p[((i + 1) % m) * 2 + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 7)); // 補點，擠壓才平滑
        for (let k = 0; k < n; k++) { rx.push(ax + (bx - ax) * k / n); ry.push(ay + (by - ay) * k / n); }
      }
      polys.push({ s, e: rx.length, x0, y0, x1, y1, ox: 0, oy: 0, bx: 0, by: 0, path: null });
    }
  }
  const hawPolys = [];
  if (haw) for (const l of haw.land) {
    const p = l.p, s0 = rx.length; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < p.length; i += 2) { rx.push(p[i]); ry.push(p[i + 1]); x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
    const P = { s: s0, e: rx.length, x0, y0, x1, y1, ox: 0, oy: 0, bx: 0, by: haw.top, path: null };
    polys.push(P); hawPolys.push(P);
  }
  // 台灣的碰撞膠囊：以輪廓最上/最下 20% 的點平均當兩端
  const byY = [...twPts].sort((a, b) => a[1] - b[1]), q = Math.max(1, Math.floor(byY.length * 0.2));
  const avg = a => [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
  const capA = avg(byY.slice(0, q)), capB = avg(byY.slice(-q));
  const CAP_R = 13;

  let st = null;
  // ---------------------------------------------------------------- DOM
  root.innerHTML = `
    <div class="nav"><a href="/projects/">← 所有挑戰</a></div>
    <div class="stage"><div class="hud"><span id="te-time">第 0 天 0 時</span><span id="te-cnt">現有 0 颱風</span></div><canvas id="te-cv"></canvas><div class="joy" id="te-joy"><div class="knob"></div></div><div class="ov" id="te-ov"></div></div>`;
  const stage = root.querySelector('.stage');
  const cv = root.querySelector('#te-cv'), ctx = cv.getContext('2d');
  const ov = root.querySelector('#te-ov'), elTime = root.querySelector('#te-time'), elCnt = root.querySelector('#te-cnt');
  let scale = 1;
  const px = n => n / scale;   // 螢幕像素 → 世界座標，讓線寬、字級不隨縮放變細
  const resize = () => {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.width * H / W * dpr); scale = cv.width / W;
  };
  // 依螢幕決定視窗：盡量把可用高度用滿，寬高比落在 0.5–0.6（直式）
  function fit() {
    const availW = Math.min(root.clientWidth || innerWidth, 1100);
    const top = stage.getBoundingClientRect().top + scrollY;
    const availH = Math.max(420, innerHeight - top - 8);
    const aspect = clamp(availW / availH, 0.5, 0.6);
    const sw = Math.min(availW, availH * aspect);
    W = 1040; WX = 310; H = W / aspect; WY = -30;
    for (const P of hawPolys) P.bx = WX + W - (haw.w + 14);
    stage.style.width = sw + 'px'; cv.style.aspectRatio = `${W} / ${H}`;
    resize();
    if (st) { st.px = clamp(st.px, WX + 15, WX + W - 15); }
  }
  // 設定 canvas.width 會清空畫面，閒置/結束畫面沒有每幀重繪，所以 resize 後要補畫
  const redrawIdle = () => { if (st && (st.idle || st.over)) draw(); };
  new ResizeObserver(() => { resize(); redrawIdle(); }).observe(cv);
  addEventListener('resize', () => { fit(); redrawIdle(); }); fit();

  const store = readStore(STORE_KEY);
  const rec = () => store.games.escape || (store.games.escape = { runs: 0, bestHours: 0 });

  // ---------------------------------------------------------------- 狀態
  let raf = 0, last = 0;
  const keys = new Set();
  const joy = { on: false, x: 0, y: 0 };

  const newGame = () => ({
    t: 0, hours: 0, px: twHome[0], py: twHome[1], vx: 0, vy: 0,
    ty: [], nextSpawn: 0.3, over: false, squeeze: 0, squeezeHold: 0, squeezeTotal: 0, spawned: 0, dodged: 0, ang: 0,
  });

  function spawn() {
    const s = st, diff = Math.min(1, s.t / 90);
    let x, y, tries = 0;
    do { x = rnd(WX + 120, WX + W - 120); y = rnd(WY + 120, WY + H - 120); } while (Math.hypot(x - s.px, y - s.py) < 320 && ++tries < 40);
    const [zh] = NAMES[Math.floor(Math.random() * NAMES.length)];
    s.ty.push({
      x, y, fx: x, fy: y, tx: x, ty: y, mt: 1, hist: [],
      r: rnd(34, 52) * (1 + diff * 0.2), chase: Math.random() < 0.85 ? rnd(0.5, 0.8) + diff * 0.3 : 0, head: rnd(0, Math.PI * 2), curv: rnd(-0.12, 0.12), len: rnd(160, 235) * (1 + diff * 0.7),
      timer: rnd(0.1, 0.8), age: 0, life: rnd(12, 24), name: zh,
    });
    s.spawned++;
  }

  function danger(T) { return T.age >= WARN; }

  function nearestOnCap(x, y) {
    const ax = st.px + capA[0], ay = st.py + capA[1], bx = st.px + capB[0], by = st.py + capB[1];
    const ex = bx - ax, ey = by - ay, u = clamp(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey), 0, 1);
    return [ax + ex * u, ay + ey * u];
  }

  // 颱風預測路徑：從目前位置沿著 head/curv 外推 PRED 步（不含隨機擾動）
  function predict(t) {
    const pts = [[t.tx, t.ty]]; let h = t.head;
    for (let k = 1; k <= PRED; k++) { h += t.curv; const [x, y] = pts[k - 1]; pts.push([x + Math.cos(h) * t.len, y + Math.sin(h) * t.len]); }
    return pts;
  }
  // 走一步：實際落點 = 預測 + 隨機偏差；走完後把舊位置存進歷史路徑
  function beginStep(t, hist) {
    const h = t.head + t.curv + (Math.random() - 0.5) * 0.9;
    t.fx = t.tx; t.fy = t.ty; t.nh = h;
    t.tx = t.fx + Math.cos(h) * t.len; t.ty = t.fy + Math.sin(h) * t.len; t.mt = 0;
  }
  function endStep(t) {
    t.hist.push([t.fx, t.fy]); if (t.hist.length > 14) t.hist.shift();
    t.head = t.nh; t.curv = clamp(t.curv + (Math.random() - 0.5) * 0.12, -0.3, 0.3); t.mt = 1;
    // 追著玩家跑：把預測方向往目前的台灣轉
    if (t.chase) { let d = Math.atan2(st.py - t.ty, st.px - t.tx) - t.head; d = Math.atan2(Math.sin(d), Math.cos(d)); t.head += clamp(d * t.chase, -1, 1); }
    // 太靠邊就把預測方向轉回海上
    const m = 240, ox = t.tx < WX + m ? 1 : t.tx > WX + W - m ? -1 : 0, oy = t.ty < WY + m ? 1 : t.ty > WY + H - m ? -1 : 0;
    if (ox || oy) { let d = Math.atan2(oy, ox) - t.head; d = Math.atan2(Math.sin(d), Math.cos(d)); t.head += clamp(d, -0.7, 0.7); }
  }

  function update(dt) {
    const s = st;
    s.t += dt; s.hours = s.t * HOURS_PER_SEC;
    // 移動
    let ix = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
    let iy = (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0);
    if (joy.on) { ix = joy.x; iy = joy.y; }
    const il = Math.max(1, Math.hypot(ix, iy));   // 鍵盤斜走正規化；搖桿保留力道（推多少走多快）
    const sp = SPEED * (s.squeeze > 0 ? 0.65 : 1);   // 擠到鄰國會被拖慢
    s.vx += (ix / il * sp - s.vx) * Math.min(1, dt * 20);
    s.vy += (iy / il * sp - s.vy) * Math.min(1, dt * 20);
    s.px = clamp(s.px + s.vx * dt, WX + 15, WX + W - 15);
    s.py = clamp(s.py + s.vy * dt, WY + 40, WY + H - 40);
    // 擠壓鄰國
    const decay = Math.exp(-dt * 1.3);
    let touched = 0;
    const L = s.px - 100, R = s.px + 100, T = s.py - 120, B = s.py + 120;
    for (const P of polys) {
      const ax = P.bx + P.ox, ay = P.by + P.oy;
      const near = P.x1 + ax + 40 > L && P.x0 + ax - 40 < R && P.y1 + ay + 40 > T && P.y0 + ay - 40 < B;
      let n = 0, nx = 0, ny = 0, maxC = 0;
      if (near) {
        for (let i = P.s; i < P.e; i++) {
          const cx = rx[i] + ax, cy = ry[i] + ay;
          if (cx < L || cx > R || cy < T || cy > B) continue;
          const [qx, qy] = nearestOnCap(cx, cy), d = Math.hypot(cx - qx, cy - qy);
          if (d < PUSH_R) { const c = PUSH_R - d, ux = d > 0.01 ? (cx - qx) / d : 1, uy = d > 0.01 ? (cy - qy) / d : 0; nx += ux; ny += uy; maxC = Math.max(maxC, c); n++; }
        }
      }
      if (n) {
        // 整塊陸地被推開（不變形）：沿著平均法線移動「最深的穿透量」
        const nl = Math.hypot(nx, ny) || 1;
        P.ox += nx / nl * maxC; P.oy += ny / nl * maxC;
        const m = Math.hypot(P.ox, P.oy); if (m > MAX_PUSH) { P.ox *= MAX_PUSH / m; P.oy *= MAX_PUSH / m; }
        touched += n;
      } else if (P.ox || P.oy) {
        P.ox *= decay; P.oy *= decay; if (Math.abs(P.ox) + Math.abs(P.oy) < 0.05) P.ox = P.oy = 0;
      }
    }
    s.squeeze = touched;
    if (touched) { s.squeezeHold = 1.5; s.squeezeTotal += dt; } else s.squeezeHold = Math.max(0, s.squeezeHold - dt);

    // 颱風
    s.nextSpawn -= dt;
    const cap = 4 + Math.floor(s.t / 8);
    if (s.nextSpawn <= 0 && s.ty.length < Math.min(cap, 14)) { spawn(); s.nextSpawn = Math.max(0.4, 1.7 - s.t / 40) * rnd(0.6, 1.4); }
    const stepT = Math.max(0.5, 1.1 - s.t / 150);
    for (const t of s.ty) {
      t.age += dt;
      if (!danger(t)) continue;
      if (t.mt >= 1) { t.timer -= dt; if (t.timer <= 0) { beginStep(t); t.timer = stepT; } }
      if (t.mt < 1) {
        t.mt = Math.min(1, t.mt + dt / MOVE_T);
        const e = t.mt * t.mt * (3 - 2 * t.mt);
        t.x = t.fx + (t.tx - t.fx) * e; t.y = t.fy + (t.ty - t.fy) * e;
        if (t.mt >= 1) endStep(t);
      }
    }
    const alive = s.ty.filter(t => t.age < t.life);
    s.dodged += s.ty.length - alive.length;   // 自然消散 = 躲過了
    s.ty = alive;
    // 碰撞
    for (const t of s.ty) {
      if (!danger(t)) continue;
      const [qx, qy] = nearestOnCap(t.x, t.y);
      if (Math.hypot(t.x - qx, t.y - qy) < t.r + CAP_R) { gameOver(t); return; }
    }
  }

  // ---------------------------------------------------------------- 繪圖
  function drawTy(t) {
    const warn = !danger(t), fade = Math.min(1, (t.life - t.age) / 2), OR = t.r * 1.9;
    ctx.save(); ctx.globalAlpha = fade * (warn ? 0.4 + 0.25 * Math.sin(t.age * 9) : 1); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // 歷史路徑（實線 + 圓點）
    const trail = [...t.hist, [t.x, t.y]];
    if (trail.length > 1) {
      ctx.strokeStyle = 'rgba(235,240,250,.75)'; ctx.lineWidth = px(2); ctx.beginPath(); trail.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      ctx.fillStyle = '#eef2fa'; for (const [x, y] of t.hist) { ctx.beginPath(); ctx.arc(x, y, px(3), 0, 7); ctx.fill(); }
    }
    // 預測路徑：不確定圓錐（紅線）+ 白色虛線
    const pts = predict(t), W0 = OR * 0.9;
    const wid = k => W0 * 0.7 + k * t.len * 0.13, ang = k => Math.atan2(pts[Math.min(k + 1, PRED)][1] - pts[Math.min(k, PRED - 1)][1], pts[Math.min(k + 1, PRED)][0] - pts[Math.min(k, PRED - 1)][0]);
    const side = sg => pts.map(([x, y], k) => { const a = ang(k) + sg * Math.PI / 2; return [x + Math.cos(a) * wid(k), y + Math.sin(a) * wid(k)]; });
    const L = side(1), R = side(-1);
    ctx.fillStyle = 'rgba(255,80,80,.10)'; ctx.beginPath(); L.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(235,90,90,.75)'; ctx.lineWidth = px(1.5);
    for (const E of [L, R]) { ctx.beginPath(); E.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = px(2); ctx.setLineDash([px(8), px(7)]); ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; for (let k = 1; k <= PRED; k++) { ctx.beginPath(); ctx.arc(pts[k][0], pts[k][1], px(3), 0, 7); ctx.fill(); }
    // 颱風本體：黃色暴風圈 + 紅色中心 + 白色 X
    ctx.translate(t.x, t.y);
    ctx.fillStyle = 'rgba(180,170,60,.62)'; ctx.strokeStyle = '#f5d63b'; ctx.lineWidth = px(2); ctx.beginPath(); ctx.arc(0, 0, OR, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c8453a'; ctx.beginPath(); ctx.arc(0, 0, t.r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(px(2.5), t.r * 0.16); const k = t.r * 0.38;
    ctx.beginPath(); ctx.moveTo(-k, -k); ctx.lineTo(k, k); ctx.moveTo(k, -k); ctx.lineTo(-k, k); ctx.stroke();
    ctx.restore();
    ctx.save(); ctx.globalAlpha = fade; ctx.fillStyle = '#fff'; ctx.font = `700 ${px(17)}px sans-serif`; ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(20,28,60,.85)'; ctx.lineWidth = px(4); ctx.strokeText(t.name, t.x, t.y + OR + px(20)); ctx.fillText(t.name, t.x, t.y + OR + px(20));
    ctx.restore();
  }

  function draw() {
    const s = st;
    ctx.setTransform(scale, 0, 0, scale, -WX * scale, -WY * scale);
    ctx.fillStyle = '#1f2c5a'; ctx.fillRect(WX, WY, W, H);
    // 陸地：每塊都是快取的 Path2D，被推開時只平移
    ctx.fillStyle = '#52645a'; ctx.strokeStyle = '#6a7d71'; ctx.lineWidth = px(1); ctx.lineJoin = 'round';
    for (const P of polys) {
      const ax = P.bx + P.ox, ay = P.by + P.oy;
      if (P.x1 + ax < WX || P.x0 + ax > WX + W) continue;
      const path = P.path || (P.path = (() => { const q = new Path2D(); for (let i = P.s; i < P.e; i++) i === P.s ? q.moveTo(rx[i], ry[i]) : q.lineTo(rx[i], ry[i]); q.closePath(); return q; })());
      ctx.save(); ctx.translate(ax, ay); ctx.fill(path); ctx.stroke(path); ctx.restore();
    }
    // 台灣
    ctx.save(); ctx.translate(s.px, s.py);
    ctx.fillStyle = '#9bbf84'; ctx.strokeStyle = '#fff'; ctx.lineWidth = px(1.5);
    ctx.beginPath(); twPts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    for (const t of s.ty) drawTy(t);
  }

  // ---------------------------------------------------------------- 流程
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = clamp((now - last) / 1000 || 0, 0, 0.05); last = now;
    if (!st || st.over || st.idle) return;
    update(dt);
    if (st.over) return;
    draw();
    const h = Math.floor(st.hours);
    elTime.textContent = `第 ${Math.floor(h / 24)} 天 ${h % 24} 時`;
    elCnt.textContent = `現有 ${st.ty.filter(danger).length} 颱風`;
  }

  function start() {
    for (const P of polys) P.ox = P.oy = 0;
    st = newGame(); ov.innerHTML = ''; ov.classList.remove('on'); last = performance.now();
    draw();
  }

  function showIntro() {
    const r = rec();
    st = newGame(); st.idle = true; draw();
    ov.classList.add('on');
    ov.innerHTML = `<div class="card"><h2>台灣大挑戰：颱置遠</h2>
      <ul class="rules"><li>你是台灣，要躲颱風</li>
      <li>颱風紅色中心登陸就結束</li>
      <li>1 秒 = 6 小時，看你能撐幾天</li></ul>
      <div class="best">${r.runs ? `最佳紀錄：${fmtTime(r.bestHours)}` : ''}</div>
      <button class="te-btn primary" id="te-go">開始</button>
      <div class="te-foot">Inspired by: <a href="https://lovewcycle.com/games/others/typhoon-escape.html" target="_blank" rel="noopener">typhoon_escape</a></div></div>`;
    ov.querySelector('#te-go').onclick = start;
  }

  function gameOver(by) {
    const s = st; s.over = true; draw();
    const r = rec(), hrs = Math.floor(s.hours), isBest = hrs > r.bestHours;
    r.runs++; if (isBest) r.bestHours = hrs; writeStore(STORE_KEY, store);
    const txt = fmtTime(hrs), nm = esc(by.name);
    ov.classList.add('on');
    ov.innerHTML = `<div class="card"><div class="quip">台灣大挑戰：颱置遠</div><div class="over">被 ${nm} 颱風 登陸成功</div>
      <div class="quip">看來還是無法把颱置遠啊</div>
      <div class="score">${txt}</div>
      <div class="dodged">躲過了 ${s.dodged} 個颱風</div>
      <div class="best">${isBest ? '🏆 新紀錄！' : `最佳紀錄：${fmtTime(r.bestHours)}`}</div>
      <div class="btns"><button class="te-btn primary" id="te-again">再玩一次</button>
      <button class="te-btn" id="te-share">分享</button></div>
      <div class="te-foot"><a href="https://cchsu.tw/projects/">其他挑戰</a><br>歡迎點<a href="https://buymeacoffee.com/jppro.tw" target="_blank" rel="nofollow noopener">這裡</a>贊助我，做更多無廣告的挑戰</div></div>`;
    ov.querySelector('#te-again').onclick = start;
    const sh = ov.querySelector('#te-share');
    sh.onclick = () => share(`台灣大挑戰：颱置遠！\n我在太平洋躲颱風，撐了 ${txt}、躲過了 ${s.dodged} 個颱風\n最後被 ${by.name}颱風登陸成功。\n你能撐多久？\n${cfg.shareUrl}\n`, sh, {});
  }
  
  // ---------------------------------------------------------------- 輸入
  const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  addEventListener('keydown', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (GAME_KEYS.includes(k)) e.preventDefault();
    keys.add(k);
    if ((k === 'Enter' || k === ' ') && st && st.over) { const b = ov.querySelector('#te-again'); if (b) b.click(); }
  });
  addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  addEventListener('blur', () => keys.clear());
  // 手機：虛擬搖桿（拖曳中間的圓球，方向與力道＝移動方向與速度）
  const joyEl = root.querySelector('#te-joy'), knob = joyEl.firstElementChild;
  const joyMove = e => {
    const r = joyEl.getBoundingClientRect(), R = r.width / 2, travel = R - knob.offsetWidth / 2;
    let vx = e.clientX - (r.left + R), vy = e.clientY - (r.top + R); const m = Math.hypot(vx, vy);
    if (m > travel) { vx *= travel / m; vy *= travel / m; }
    knob.style.transform = `translate(${vx}px, ${vy}px)`;
    const f = Math.hypot(vx, vy) / travel; // 0–1
    joy.x = f < 0.12 ? 0 : vx / travel; joy.y = f < 0.12 ? 0 : vy / travel;
  };
  const joyEnd = () => { joy.on = false; joy.x = joy.y = 0; knob.style.transform = ''; };
  joyEl.addEventListener('pointerdown', e => { e.preventDefault(); joyEl.setPointerCapture(e.pointerId); joy.on = true; joyMove(e); });
  joyEl.addEventListener('pointermove', e => { if (joy.on) joyMove(e); });
  joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);
  joyEl.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  showIntro();
  raf = requestAnimationFrame(frame);
}
