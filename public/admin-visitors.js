import { trendSeries } from "./visitor-trend.js";
const node = id => document.getElementById(id);
let offset = 0, pending = false, generation = 0, controller, pendingKey, lastTrend, renderedWidth;
const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
node('end').value = day;
node('start').value = new Date(Date.now() + 8 * 3600000 - 29 * 86400000).toISOString().slice(0, 10);
const time = value => value == null || !Number.isFinite(new Date(value).getTime()) ? '未記錄' : new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
function rows(id, values) {
  if (!values.length) {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan = id === 'visitors' ? 7 : 2; td.className = 'empty-state';
    td.textContent = '此期間尚無造訪紀錄'; tr.append(td); node(id).replaceChildren(tr); return;
  }
  node(id).replaceChildren(...values.map(values => {
    const tr = document.createElement('tr');
    for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    return tr;
  }));
}
function clearReport() {
  generation++; controller?.abort(); pending = false; pendingKey = null; lastTrend = null;
  node('report').hidden = true; node('query-panel').hidden = true; node('logout').hidden = true;
  node('login').hidden = true; node('retry').hidden = true; node('query').disabled = false;
  for (const id of ['daily', 'visitors', 'trend', 'today', 'today-date', 'range-summary', 'pagination', 'status']) node(id).replaceChildren();
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
  const view = node('view').value;
  const params = new URLSearchParams({ start: node('start').value, end: node('end').value, offset, period: view === 'day' ? 'day' : 'month', scope: view === 'history' ? 'history' : 'range' });
  const key = params.toString();
  if (pending && pendingKey === key) return;
  controller?.abort();
  const currentGeneration = ++generation;
  controller = new AbortController();
  pending = true; pendingKey = key; node('query').disabled = true;
  node('status').dataset.state = 'pending'; node('status').textContent = '正在載入訪客統計…';
  node('retry').hidden = true; node('login').hidden = true;
  // Keep filters usable while replacing a result; never leave private data on an auth failure.
  node('report').hidden = true; lastTrend = null;
  for (const id of ['daily', 'visitors', 'trend', 'today', 'today-date', 'range-summary', 'pagination']) node(id).replaceChildren();
  try {
    const response = await fetch(`/api/v1/presence?${params}`, {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    });
    if (currentGeneration !== generation) return;
    if (response.status === 401) { clearReport(); location.replace('/login.html'); return; }
    if (response.status === 403) {
      const failure = await response.clone().json().catch(() => null);
      if (currentGeneration !== generation) return;
      if ((failure?.error?.code || failure?.code) === 'PASSWORD_CHANGE_REQUIRED') { clearReport(); location.replace('/change-password.html'); return; }
      node('query-panel').hidden = true; node('logout').hidden = true; node('login').hidden = false;
    }
    if (!response.ok) throw new Error(response.status === 403 ? '僅管理員可查看造訪紀錄' : response.status >= 500 ? '統計服務暫時無法使用，請稍後再試。' : '查詢失敗，請確認日期範圍');
    const data = await response.json().catch(() => { throw new Error('統計資料回應異常，請稍後再試。'); });
    if (currentGeneration !== generation) return;
    if (!data || !Array.isArray(data.daily) || !Array.isArray(data.visitors) || !Number.isFinite(data.today?.today)
        || typeof data.today.asOf !== 'string' || typeof data.start !== 'string' || typeof data.end !== 'string'
        || !Number.isFinite(data.unique) || !Number.isFinite(data.total) || !Number.isFinite(data.limit))
      throw new Error('統計資料回應異常，請稍後再試。');
    node('today').textContent = data.today.today.toLocaleString('zh-TW');
    node('today-date').textContent = data.today.asOf;
    const points = trendSeries(data.start, data.end, data.daily, data.period);
    rows('daily', [...points].reverse().map(p => [p.day, p.value ?? '無紀錄']));
    node('trend-title').textContent = view === 'day' ? '每日瀏覽者趨勢' : view === 'month' ? '每月瀏覽者趨勢' : '全部歷史趨勢（按月）';
    node('range-summary').textContent = `${data.start} ～ ${data.end} · 期間不重複瀏覽器 ${data.unique} 位 · 每日造訪紀錄 ${data.total} 筆`;
    rows('visitors', data.visitors.map(v => [v.day, v.id, v.nationality || '未填寫', v.ip || '未記錄', v.country || '未知', time(v.first_seen), time(v.last_seen)]));
    node('pagination').textContent = `共 ${data.total} 筆每日造訪紀錄 · 本頁 ${data.visitors.length} 筆`;
    node('previous').disabled = offset === 0; node('next').disabled = offset + data.limit >= data.total;
    node('query-panel').hidden = false; node('report').hidden = false; node('logout').hidden = false;
    node('login').hidden = true; node('status').textContent = '';
    lastTrend = { start: data.start, end: data.end, daily: data.daily, period: data.period };
    renderTrend(lastTrend);
  } catch (error) {
    if (currentGeneration !== generation) return;
    node('status').dataset.state = 'error';
    node('status').textContent = error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error.name)
      ? '無法取得訪客統計，請確認連線後重試。' : error.message;
    node('retry').hidden = !node('login').hidden;
  } finally { if (currentGeneration === generation) { pending = false; pendingKey = null; node('query').disabled = false; } }
}
node('filters').addEventListener('submit', event => { event.preventDefault(); offset = 0; void load(); });
node('previous').onclick = () => { offset = Math.max(0, offset - 100); void load(); };
node('next').onclick = () => { offset += 100; void load(); };
node('logout').onclick = logout;
node('retry').onclick = () => void load();
window.addEventListener('pagehide', clearReport);
window.addEventListener('pageshow', () => void load());
document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); });
const channel = new BroadcastChannel('stock-insight-auth');
channel.onmessage = () => { clearReport(); void load(); };

function renderTrend({ start, end, daily, period }) {
  const series = trendSeries(start, end, daily, period);
  if (!series.some(point => point.value !== null)) {
    const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = '此期間尚無造訪紀錄';
    node('trend').replaceChildren(empty); return;
  }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  renderedWidth = Math.max(240, Math.round(node('trend').clientWidth));
  const width = renderedWidth, height = width < 500 ? 216 : 260, left = 36, right = width - 12, baseline = height - 34;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '不重複瀏覽器人數趨勢；詳細數值見下方表格');
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text != null) el.textContent = text;
    svg.append(el); return el;
  };
  const x = i => left + i / Math.max(1, series.length - 1) * (right - left);
  const max = Math.max(1, ...series.map(p => p.value ?? 0));
  const y = value => baseline - value / max * (baseline - 20);
  for (const value of new Set([0, Math.round(max / 2), max])) {
    add('line', { x1: left, x2: right, y1: y(value), y2: y(value), stroke: '#e8edf5' });
    add('text', { x: left - 8, y: y(value) + 4, 'text-anchor': 'end', 'font-size': 12, fill: '#64748b' }, value);
  }
  let previous;
  series.forEach((point, i) => {
    if (point.value == null) { previous = undefined; return; }
    if (previous != null) add('line', { x1: x(previous), y1: y(series[previous].value), x2: x(i), y2: y(point.value), stroke: '#2563eb', 'stroke-width': 2.5, 'stroke-linecap': 'round' });
    const dot = add('circle', { cx: x(i), cy: y(point.value), r: 3, fill: '#fff', stroke: '#2563eb', 'stroke-width': 2 });
    const title = document.createElementNS(ns, 'title'); title.textContent = `${point.day}：${point.value} 人`; dot.append(title);
    previous = i;
  });
  add('text', { x: left, y: height - 6, 'font-size': 12, fill: '#64748b' }, start);
  add('text', { x: right, y: height - 6, 'text-anchor': 'end', 'font-size': 12, fill: '#64748b' }, end);
  node('trend').replaceChildren(svg);
}

const resize = new ResizeObserver(() => {
  if (lastTrend && !node('report').hidden && Math.max(240, Math.round(node('trend').clientWidth)) !== renderedWidth)
    renderTrend(lastTrend);
});
resize.observe(node('trend'));

node('view').addEventListener('change', () => {
  const history = node('view').value === 'history';
  node('start').disabled = history; node('end').disabled = history;
  offset = 0; void load();
});
