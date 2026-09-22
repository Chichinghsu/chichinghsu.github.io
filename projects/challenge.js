// Shared daily-challenge infrastructure for who-is-older, north-vs-south, and future games.
// No gameplay logic here — just utilities for date/storage/sharing/overlays that every game needs.

export const TAIPEI_OFFSET_MIN = 8 * 60;   // UTC+8, no DST since 1980

export const pad2 = n => String(n).padStart(2, '0');

export function taipeiToday(now = new Date()) {
  const d = new Date(now.getTime() + TAIPEI_OFFSET_MIN * 60000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function msUntilTaipeiMidnight(now = new Date()) {
  const d = new Date(now.getTime() + TAIPEI_OFFSET_MIN * 60000);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return next - d.getTime();
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function readStore(storeKey) {
  try {
    const raw = localStorage.getItem(storeKey);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && obj.games) return obj;
  } catch (e) { /* ignore */ }
  return { v: 1, games: {} };
}

export function writeStore(storeKey, obj) {
  try {
    localStorage.setItem(storeKey, JSON.stringify(obj));
  } catch (e) { /* private mode / quota — game stays playable in memory */ }
}

export async function share(shareText, shareBtn, cfg) {
  try {
    if (navigator.share) {
      await navigator.share({ text: shareText });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(shareText);
    flashShare(shareBtn, '已複製！貼到 Threads 吧');
    return;
  } catch (e) { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = shareText;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let done = false;
  try { done = document.execCommand('copy'); } catch (e) { done = false; }
  document.body.removeChild(ta);
  flashShare(shareBtn, done ? '已複製！貼到 Threads 吧' : '複製失敗，請長按畫面手動複製');
}

let shareTimer = null;
export function flashShare(btn, msg) {
  btn.textContent = msg;
  clearTimeout(shareTimer);
  shareTimer = setTimeout(() => { btn.textContent = '分享結果'; }, 2200);
}

export function scheduleRollover(rolloverCallback) {
  const loop = () => setTimeout(() => {
    const d = taipeiToday();
    if (rolloverCallback(d)) loop();  // callback returns true to continue looping
  }, Math.min(msUntilTaipeiMidnight() + 1000, 2147483000));
  loop();
}

export function setupOverlayHideLogic($) {
  document.addEventListener('keydown', e => {
    const top = ['other', 'archive', 'solution', 'review', 'overlay'].find(id => {
      const el = $(id);
      return el && el.classList.contains('show');
    });
    if (top) {
      if (e.key === 'Escape') $(top).classList.remove('show');
    }
  });
  ['archive', 'solution', 'review', 'other', 'overlay'].forEach(id => {
    const overlay = $(id);
    if (!overlay) return;
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('show');
    });
  });
}

export function populateSwitcher($, cfg) {
  if (cfg.links && $(0, 'switcher')) {
    const switcher = document.getElementById('switcher');
    if (switcher) {
      switcher.innerHTML = (cfg.links || [])
        .map(l => `<a href="${l.href}">${esc(l.text)}</a>`).join('');
    }
  }
  const otGames = document.getElementById('otGames');
  if (otGames && cfg.links) {
    otGames.innerHTML = (cfg.links || [])
      .map(l => `<a class="gamecard" href="${l.href}">${esc(l.text)}</a>`).join('');
  }
}

export function loadVersion(versionPath) {
  const verEl = document.getElementById('ver');
  if (!verEl) return;
  fetch(versionPath)
    .then(r => (r.ok ? r.text() : Promise.reject()))
    .then(t => {
      const v = t.trim();
      if (/^\d+\.\d+\.\d+/.test(v)) verEl.textContent = ` · ${v}`;
    })
    .catch(() => { /* no version shown */ });
}

// ────────────────────────────────────────────────────────────────── leaderboard

export function getLeaderboard(gameId) {
  try {
    const key = `leaderboard.${gameId}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveScore(gameId, scoreData) {
  try {
    const key = `leaderboard.${gameId}`;
    const records = getLeaderboard(gameId);
    const record = {
      date: taipeiToday(),
      timestamp: Date.now(),
      count: scoreData.count,
      total: scoreData.total,
      time: scoreData.time, // seconds
      ...(scoreData.details && { details: scoreData.details })
    };
    records.push(record);
    // Keep top 10, sorted by count DESC, then by time ASC (faster wins ties)
    records.sort((a, b) => b.count - a.count || a.time - b.time);
    const top10 = records.slice(0, 10);
    localStorage.setItem(key, JSON.stringify(top10));
    return record;
  } catch (e) {
    return null;
  }
}

export function deleteScore(gameId, timestamp) {
  try {
    const key = `leaderboard.${gameId}`;
    const records = getLeaderboard(gameId);
    const filtered = records.filter(r => r.timestamp !== timestamp);
    localStorage.setItem(key, JSON.stringify(filtered));
    return true;
  } catch (e) {
    return false;
  }
}

export function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

export function renderLeaderboard(gameId, records) {
  if (!records.length) {
    return '<p style="padding:12px; color:#999; text-align:center;">還沒有戰績。</p>';
  }
  return `<div class="lb-list">` + records.map((r, i) => `
    <div class="lb-row" data-timestamp="${r.timestamp}">
      <span class="lb-rank">#${i + 1}</span>
      <span class="lb-score">${r.count}/${r.total}</span>
      <span class="lb-time">${formatTime(r.time)}</span>
      <span class="lb-date">${r.date}</span>
      <button class="lb-delete" title="刪除此記錄">✕</button>
    </div>
  `).join('') + `</div>`;
}

export function setupLeaderboardOverlay($, gameId) {
  const records = getLeaderboard(gameId);
  const lbListEl = $('lbList');
  if (!lbListEl) return;

  // Remove any existing listeners first
  const newListEl = lbListEl.cloneNode(false);
  newListEl.innerHTML = renderLeaderboard(gameId, records);
  lbListEl.parentNode.replaceChild(newListEl, lbListEl);

  // Delete button handlers - use event delegation
  newListEl.addEventListener('click', e => {
    if (!e.target.classList.contains('lb-delete')) return;
    e.preventDefault();
    const row = e.target.closest('.lb-row');
    const ts = parseInt(row.dataset.timestamp);
    const confirm = `確定要刪除這筆戰績嗎？\n${row.querySelector('.lb-score').textContent} ${row.querySelector('.lb-date').textContent} ${row.querySelector('.lb-time').textContent}`;
    if (window.confirm(confirm)) {
      deleteScore(gameId, ts);
      setupLeaderboardOverlay($, gameId);
    }
  });
}
