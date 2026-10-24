const labels = { breadth: "市場漲跌家數", trend: "站上季線", momentum: "20 日動能", institutions: "法人方向", volume: "成交量熱度" };
const value = (number) => Number.isFinite(number) ? `${Math.round(number)}` : "—";
const toneStops = [
  [0, [59, 130, 246]], [20, [96, 165, 250]], [40, [142, 169, 188]],
  [50, [196, 157, 105]], [60, [223, 152, 114]], [80, [232, 135, 112]], [100, [232, 102, 102]],
];

export function sentimentTone(score) {
  if (!Number.isFinite(score)) return "#64748b";
  const bounded = Math.min(100, Math.max(0, score));
  const upperIndex = toneStops.findIndex(([point]) => point >= bounded);
  const [upperPoint, upperColor] = toneStops[upperIndex];
  if (upperIndex === 0 || upperPoint === bounded) return `#${upperColor.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  const [lowerPoint, lowerColor] = toneStops[upperIndex - 1];
  const mix = (bounded - lowerPoint) / (upperPoint - lowerPoint);
  return `#${upperColor.map((channel, index) => Math.round(lowerColor[index] + (channel - lowerColor[index]) * mix)
    .toString(16).padStart(2, "0")).join("")}`;
}

export function renderSentiment(sentiment) {
  const card = document.querySelector("#market-sentiment"); if (!card) return;
  card.dataset.sentiment = sentiment.band.key;
  card.querySelector("button").style.setProperty("--sentiment-tone", sentimentTone(sentiment.score));
  card.querySelector(".sentiment-score").textContent = value(sentiment.score);
  card.querySelector(".sentiment-band").textContent = sentiment.band.label;
  card.style.setProperty("--sentiment-score", `${sentiment.score ?? 0}%`);
  card.querySelector(".sentiment-date").textContent = sentiment.status === "insufficient"
    ? sentiment.score === null ? "資料不足 · 等待有效市場資料" : `資料不足 · 沿用 ${sentiment.date} 分數`
    : `${sentiment.date} · 當日 · ${sentiment.components.coverage} 檔上市個股`;
}
export function sentimentDialogMarkup(sentiment) {
  const segments = [];
  let segment = [];
  sentiment.series.forEach(({ score }, index) => {
    if (Number.isFinite(score)) segment.push(`${index / Math.max(sentiment.series.length - 1, 1) * 100},${100 - score}`);
    else { if (segment.length > 1) segments.push(segment.join(" ")); segment = []; }
  });
  if (segment.length > 1) segments.push(segment.join(" "));
  const descriptions = { breadth: "上漲計 1、平盤計 0.5", trend: "高於 MA60 計 1、相等計 0.5", momentum: "可比較價格的 20 日報酬方向", institutions: "近 5 日法人淨股數占成交量比率", volume: "放量個股的漲跌方向" };
  return `<h2 id="dialog-heading">台股市場情緒</h2><p class="dialog-intro">以最新交易日的當日資料計算，切換清單的歷史日期不會改變此指數。分數以 0–100 呈現市場的恐懼與貪婪程度；這是株研建立的觀察指標，不是交易所官方指數。</p><div class="sentiment-dialog-summary" data-sentiment="${sentiment.band.key}"><strong>${value(sentiment.score)}</strong><span>${sentiment.band.label}</span></div>${sentiment.status === "insufficient" ? `<p class="dialog-intro">資料不足；${sentiment.score === null ? "尚無有效分數" : `沿用 ${sentiment.date} 的最後有效分數`}。最新資料有效權重 ${Math.round(sentiment.latestEffectiveWeight * 100)}%。</p>` : ""}<div class="sentiment-trend" role="img" aria-label="近 ${sentiment.series.length} 個交易日每日市場情緒分數">${segments.length ? `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="50" x2="100" y2="50"/>${segments.map((points) => `<polyline points="${points}"/>`).join("")}</svg>` : "資料累積中"}</div><p class="sentiment-trend-note">折線每個點是該交易日的分數，由下列五項當日指標加權產生；圖表顯示最近 ${sentiment.series.length} 個交易日。</p><dl class="sentiment-components">${Object.entries(labels).map(([key, label]) => `<div><dt>${label}<span>${descriptions[key]}${sentiment.notes?.[key] ? ` · ${sentiment.notes[key]}` : ""}</span></dt><dd>${value(sentiment.components[key])}</dd></div>`).join("")}</dl><p class="helper-text">每個交易日各自計分。權重：漲跌家數 25%、季線位置 20%、20 日動能 20%、法人方向 25%、成交量熱度 10%。僅計上市普通股；各項至少 80% 樣本覆蓋，總有效權重至少 80%。20 日動能使用已查核公司行動的可比較價格；個股資料不完整或事件無法可靠調整時不計入樣本。其餘有效項目按權重換算。每日只使用當日及以前資料。版本：${sentiment.version}</p>`;
}
