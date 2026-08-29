// One-off data prep: 鄉鎮市區界線 GeoJSON  ->  districts.json
//
//   curl -sLO https://raw.githubusercontent.com/g0v/twgeojson/master/json/twTown1982.geo.json
//   node prep.js twTown1982.geo.json > districts.json
//
// The source is ~20 MB of full-resolution coastline. We only need silhouettes
// that a player can recognise, so every ring is projected, Douglas-Peucker'd,
// and rounded to 2 decimals (~2 m at this scale). Specks smaller than a pixel
// on screen are dropped — except a city's largest ring, which always survives.
//
// Output paths live in ONE all-Taiwan projected frame, so adding 桃園/台中/…
// later is a matter of listing them in CITIES; nothing needs re-projecting.

const fs = require('fs');

// ---------------------------------------------------------------- registry
// COUNTYNAME in the source uses 台, not 臺. `name` is what we display.
const CITIES = [
  { id:'tpe',  src:'台北市', name:'臺北市', accent:'#b8860b' },
  { id:'ntpc', src:'新北市', name:'新北市', accent:'#0f766e' },
  // Extension: add { id:'kee', src:'基隆市', name:'基隆市', accent:'#... ' } etc.
];

const EN = {
  // 臺北市
  中正區:'Zhongzheng', 大同區:'Datong', 中山區:'Zhongshan', 松山區:'Songshan',
  大安區:'Da’an', 萬華區:'Wanhua', 信義區:'Xinyi', 士林區:'Shilin',
  北投區:'Beitou', 內湖區:'Neihu', 南港區:'Nangang', 文山區:'Wenshan',
  // 新北市
  板橋區:'Banqiao', 三重區:'Sanchong', 中和區:'Zhonghe', 永和區:'Yonghe',
  新莊區:'Xinzhuang', 新店區:'Xindian', 土城區:'Tucheng', 蘆洲區:'Luzhou',
  汐止區:'Xizhi', 樹林區:'Shulin', 鶯歌區:'Yingge', 三峽區:'Sanxia',
  淡水區:'Tamsui', 瑞芳區:'Ruifang', 五股區:'Wugu', 泰山區:'Taishan',
  林口區:'Linkou', 深坑區:'Shenkeng', 石碇區:'Shiding', 坪林區:'Pinglin',
  三芝區:'Sanzhi', 石門區:'Shimen', 八里區:'Bali', 平溪區:'Pingxi',
  雙溪區:'Shuangxi', 貢寮區:'Gongliao', 金山區:'Jinshan', 萬里區:'Wanli',
  烏來區:'Wulai',
};

// -------------------------------------------------------------- projection
// Equirectangular, x stretched by cos(24°) so the island isn't squashed.
// Origin sits north-west of everything in Taiwan including 連江.
const LON0 = 118.0, LAT0 = 26.5, K = 1000, COS = Math.cos(24 * Math.PI / 180);
const px = lon => (lon - LON0) * COS * K;
const py = lat => (LAT0 - lat) * K;

const TOL  = 0.35;  // Douglas-Peucker tolerance, projected units (~35 m)
const MIN_AREA = 1.5; // drop rings smaller than this (projected units²)

// ------------------------------------------------------------------ helpers
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, best = tol2;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      let t = len2 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - (ax + t * dx), ey = y - (ay + t * dy);
      const d2 = ex * ex + ey * ey;
      if (d2 > best) { best = d2; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const ringArea = r => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    a += (r[j][0] * r[i][1]) - (r[i][0] * r[j][1]);
  return Math.abs(a / 2);
};

const inRing = (x, y, r) => {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

// Pole of inaccessibility by coarse-then-fine grid search. Centroids fall
// outside the C-shaped 區 (石碇, 坪林, 瑞芳), which would strand their labels.
function labelPoint(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const dist = (x, y) => {
    if (!inRing(x, y, ring)) return -1;
    let m = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j], [bx, by] = ring[i];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      let t = len2 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - (ax + t * dx), ey = y - (ay + t * dy);
      m = Math.min(m, ex * ex + ey * ey);
    }
    return m;
  };
  let best = [(x0 + x1) / 2, (y0 + y1) / 2], bestD = dist(best[0], best[1]);
  let stepX = (x1 - x0) / 24, stepY = (y1 - y0) / 24;
  for (let pass = 0; pass < 3; pass++) {
    const cx = best[0], cy = best[1];
    for (let i = -12; i <= 12; i++) for (let j = -12; j <= 12; j++) {
      const x = cx + i * stepX, y = cy + j * stepY;
      const d = dist(x, y);
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
    stepX /= 8; stepY /= 8;
  }
  return best;
}

const r2 = n => Math.round(n * 100) / 100;

// --------------------------------------------------------------------- main
const src = JSON.parse(fs.readFileSync(process.argv[2] || 'twTown1982.geo.json', 'utf8'));
const districts = [];

for (const city of CITIES) {
  const feats = src.features.filter(f => f.properties.COUNTYNAME === city.src);
  if (!feats.length) throw new Error(`no features for ${city.src}`);

  for (const f of feats) {
    const name = f.properties.TOWNNAME;
    const polys = f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates] : f.geometry.coordinates;

    // Outer rings only; holes are invisible at this simplification level.
    let rings = polys
      .map(p => simplify(p[0].map(([lon, lat]) => [px(lon), py(lat)]), TOL))
      .filter(r => r.length > 3)
      .map(r => ({ r, a: ringArea(r) }))
      .sort((x, y) => y.a - x.a);
    rings = [rings[0], ...rings.slice(1).filter(o => o.a >= MIN_AREA)];

    const d = rings.map(({ r }) =>
      'M' + r.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L') + 'Z').join('');

    const [lx, ly] = labelPoint(rings[0].r);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { r } of rings) for (const [x, y] of r) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }

    districts.push({
      id: `${city.id}-${name}`,
      city: city.id,
      name,
      short: name.replace(/[區市鎮鄉]$/, ''),
      en: EN[name] || '',
      d,
      lx: r2(lx), ly: r2(ly),
      bbox: [r2(x0), r2(y0), r2(x1), r2(y1)],
    });
  }
}

const out = {
  cities: CITIES.map(c => ({
    id: c.id, name: c.name, accent: c.accent,
    count: districts.filter(d => d.city === c.id).length,
  })),
  districts,
};

const missingEn = districts.filter(d => !d.en).map(d => d.name);
if (missingEn.length) console.error('missing EN:', missingEn.join(' '));
console.error(out.cities.map(c => `${c.name} ${c.count}`).join(' | '));
process.stdout.write(JSON.stringify(out));
