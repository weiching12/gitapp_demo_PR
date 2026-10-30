import { trendSeries } from "./visitor-trend.js";
const node = id => document.getElementById(id);
let offset = 0, pending = false, generation = 0, controller;
const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
node('end').value = day;
node('start').value = new Date(Date.now() + 8 * 3600000 - 29 * 86400000).toISOString().slice(0, 10);
const time = value => value == null ? '未記錄' : new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
function rows(id, values) {
  node(id).replaceChildren(...values.map(values => {
    const tr = document.createElement('tr');
    for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    return tr;
  }));
}
function clearReport() {
  generation++; controller?.abort(); pending = false;
  node('report').hidden = true; node('login').hidden = false;
  rows('daily', []); rows('visitors', []); node('trend').replaceChildren(); node('today').textContent = '';
}
async function logout() {
  clearReport();
  try {
    const response = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error();
    const channel = new BroadcastChannel('stock-insight-auth'); channel.postMessage('changed'); channel.close();
    location.replace('/login.html');
  } catch { node('status').textContent = '登出失敗，請重新登入後重試'; }
}

async function load() {
  if (pending) return;
  const currentGeneration = generation;
  controller = new AbortController();
  pending = true; node('status').textContent = '載入中…';
  // Remove the previous result while loading, including on authentication failure.
  node('report').hidden = true; rows('daily', []); rows('visitors', []); node('trend').replaceChildren();
  try {
    const view = node('view').value;
    const params = new URLSearchParams({ start: node('start').value, end: node('end').value, offset, period: view === 'day' ? 'day' : 'month', scope: view === 'history' ? 'history' : 'range' });
    const response = await fetch(`/api/v1/presence?${params}`, {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    });
    if (response.status === 401) { clearReport(); location.replace('/login.html'); return; }
    if (response.status === 403) {
      const failure = await response.clone().json().catch(() => null);
      if ((failure?.error?.code || failure?.code) === 'PASSWORD_CHANGE_REQUIRED') { clearReport(); location.replace('/change-password.html'); return; }
    }
    if (!response.ok) throw new Error(response.status === 403 ? '僅管理員可查看造訪紀錄' : response.status === 503 ? '統計服務尚未設定或暫時無法使用' : '查詢失敗，請確認日期範圍');
    const data = await response.json();
    if (currentGeneration !== generation) return;
    node('today').textContent = `今日 ${data.today.asOf}：${data.today.today} 位瀏覽者`;
    const points = trendSeries(data.start, data.end, data.daily, data.period);
    rows('daily', [...points].reverse().map(p => [p.day, p.value ?? '無紀錄']));
    node('trend-title').textContent = view === 'day' ? '每日瀏覽者趨勢' : view === 'month' ? '每月瀏覽者趨勢' : '全部歷史趨勢（按月）';
    node('range-summary').textContent = `${data.start} ～ ${data.end} · 期間不重複瀏覽器 ${data.unique} 位 · 每日造訪紀錄 ${data.total} 筆`;
    renderTrend(data.start, data.end, data.daily, data.period);
    rows('visitors', data.visitors.map(v => [v.day, v.id, v.nationality || '未填寫', v.ip || '未記錄', v.country || '未知', time(v.first_seen), time(v.last_seen)]));
    node('pagination').textContent = `共 ${data.total} 筆每日造訪紀錄 · 本頁 ${data.visitors.length} 筆`;
    node('previous').disabled = offset === 0; node('next').disabled = offset + data.limit >= data.total;
    node('report').hidden = false; node('login').hidden = true; node('status').textContent = '';
  } catch (error) { if (currentGeneration !== generation) return; node('status').textContent = error.message; node('login').hidden = false; }
  finally { if (currentGeneration === generation) pending = false; }
}
node('filters').addEventListener('submit', event => { event.preventDefault(); offset = 0; void load(); });
node('previous').onclick = () => { offset = Math.max(0, offset - 100); void load(); };
node('next').onclick = () => { offset += 100; void load(); };
node('logout').onclick = logout;
window.addEventListener('pagehide', clearReport);
window.addEventListener('pageshow', () => void load());
document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); });
const channel = new BroadcastChannel('stock-insight-auth');
channel.onmessage = () => { clearReport(); void load(); };

function renderTrend(start, end, daily, period) {
  const series = trendSeries(start, end, daily, period);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 800 260'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '不重複瀏覽器人數趨勢；詳細數值見下方表格');
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text != null) el.textContent = text;
    svg.append(el); return el;
  };
  const x = i => 60 + i / Math.max(1, series.length - 1) * 710;
  const max = Math.max(1, ...series.map(p => p.value ?? 0));
  const y = value => 215 - value / max * 180;
  for (const value of [0, max / 2, max]) {
    add('line', { x1: 60, x2: 770, y1: y(value), y2: y(value), stroke: '#cbd5e1' });
    add('text', { x: 50, y: y(value) + 5, 'text-anchor': 'end', 'font-size': 13 }, Number(value.toFixed(1)));
  }
  let previous;
  series.forEach((point, i) => {
    if (point.value == null) { previous = undefined; return; }
    if (previous != null) add('line', { x1: x(previous), y1: y(series[previous].value), x2: x(i), y2: y(point.value), stroke: '#2563eb', 'stroke-width': 2 });
    const dot = add('circle', { cx: x(i), cy: y(point.value), r: 3, fill: '#2563eb' });
    const title = document.createElementNS(ns, 'title'); title.textContent = `${point.day}：${point.value} 人`; dot.append(title);
    previous = i;
  });
  add('text', { x: 60, y: 245, 'font-size': 13 }, start);
  add('text', { x: 770, y: 245, 'text-anchor': 'end', 'font-size': 13 }, end);
  node('trend').replaceChildren(svg);
}

node('view').addEventListener('change', () => {
  const history = node('view').value === 'history';
  node('start').disabled = history; node('end').disabled = history;
  offset = 0; void load();
});
