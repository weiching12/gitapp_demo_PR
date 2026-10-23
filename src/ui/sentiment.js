const labels = { breadth: "市場漲跌家數", trend: "站上季線", momentum: "20 日動能", institutions: "法人方向", volume: "成交量熱度" };
const value = (number) => Number.isFinite(number) ? `${Math.round(number)}` : "—";
export function renderSentiment(sentiment) {
  const card = document.querySelector("#market-sentiment"); if (!card) return;
  card.dataset.sentiment = sentiment.band.key;
  card.querySelector(".sentiment-score").textContent = value(sentiment.score);
  card.querySelector(".sentiment-band").textContent = sentiment.band.label;
  card.style.setProperty("--sentiment-score", `${sentiment.score ?? 0}%`);
  card.querySelector(".sentiment-date").textContent = sentiment.score === null ? "等待近 5 日完整市場資料" : `${sentiment.date} 止 · 近 5 日 · ${sentiment.components.coverage} 檔上市個股`;
}
export function sentimentDialogMarkup(sentiment) {
  const points = sentiment.series.filter(({ score }) => Number.isFinite(score));
  const polyline = points.length > 1 ? points.map(({ score }, index) => `${index / (points.length - 1) * 100},${100 - score}`).join(" ") : "";
  return `<h2 id="dialog-heading">台股市場情緒</h2><p class="dialog-intro">固定以最新資料日回推 5 個交易日計算，切換下方歷史日期不會改變此指數。分數以 0–100 呈現市場的恐懼與貪婪程度；這是株研建立的觀察指標，不是交易所官方指數。</p><div class="sentiment-dialog-summary" data-sentiment="${sentiment.band.key}"><strong>${value(sentiment.score)}</strong><span>${sentiment.band.label}</span></div><div class="sentiment-trend" role="img" aria-label="近 ${points.length} 個交易日市場情緒趨勢">${polyline ? `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="50" x2="100" y2="50"/><polyline points="${polyline}"/></svg>` : "資料累積中"}</div><dl class="sentiment-components">${Object.entries(labels).map(([key, label]) => `<div><dt>${label}<span>${key === "volume" ? "近 5 日每日相對前 20 日均量" : "近 5 日有效個股偏多占比平均"}</span></dt><dd>${value(sentiment.components[key])}</dd></div>`).join("")}</dl><p class="helper-text">各項先計算每個交易日，再取最新 5 個交易日平均。權重：漲跌家數 25%、季線位置 20%、20 日動能 20%、法人方向 25%、成交量熱度 10%。ETF 與缺漏值不納入分母；各日只使用當日及以前資料。版本：${sentiment.version}</p>`;
}
