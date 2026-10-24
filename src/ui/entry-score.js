const list = (items, esc, empty) => items.length
  ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p>${empty}</p>`;
const CORE_LABELS = { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現",
  institutional: "法人籌碼", entryRisk: "進場位置與風險" };
const coreData = (data, esc, number) => Object.entries(data ?? {}).map(([key, value]) =>
  `${esc(key)} ${Number.isFinite(value) ? number(value, 2) : esc(value ?? "—")}`).join(" · ");

export function entryScoreDialogMarkup(stock, esc, number, percent) {
  const score = stock.entryScore;
  if (!score) return `<h2 id="dialog-heading">個股進場評估</h2><p>資料不足，無法評分。</p>`;
  const valid = Number.isFinite(score.finalScore);
  if (!score.categories || !Object.keys(score.categories).length && valid)
    return `<h2 id="dialog-heading">${esc(stock.name)} ${esc(stock.symbol)}｜個股進場評估</h2><p role="status">評分明細載入中…</p>`;
  const metrics = score.metrics;
  return `<h2 id="dialog-heading">${esc(stock.name)} ${esc(stock.symbol)}｜個股進場評估</h2>
    <p class="dialog-intro">波段順勢進場 · ${esc(score.asOf)} · ${score.priceBasis === "adjusted" ? "還原價格" : "未還原價格"} · ${esc(score.modelVersion)}</p>
    <section class="entry-summary"><strong>${valid ? `${score.displayScore} / 100` : "—"}</strong><span>${esc(score.status)}</span>
      <p>收盤 ${stock.latest ? number(stock.latest.close, 2) : "—"} · 漲跌 ${stock.latest ? percent(stock.latest.changePercent) : "—"}</p>
      <p>基礎分數 ${Number.isFinite(score.baseScore) ? number(score.baseScore, 2) : "—"} / 100 · 最終分數 ${valid ? number(score.finalScore, 2) : "—"} / 100</p>
      <p>核心條件：${score.passedCount ?? 0} / ${score.totalConditions ?? 5} 通過${score.scoreCapped ? " · 已套用 60 分上限" : ""}</p>
      <p>${esc(score.conclusion)}</p><p>${esc(score.mainReason)}</p></section>
    <section class="entry-evidence"><h3>核心條件檢查</h3><ul>${Object.entries(CORE_LABELS).map(([key, label]) => {
      const item = score.coreConditions?.[key];
      return `<li><strong>${label}：${item?.status === "PASS" ? "通過" : item?.status === "FAIL" ? "未通過" : "資料不足"}</strong> · ${esc(item?.reason ?? "尚無判斷資料")}<br><small>${coreData(item?.data, esc, number)}</small></li>`;
    }).join("")}</ul></section>
    ${valid ? `<section class="entry-categories"><h3>五項評分明細</h3>${Object.entries(score.categories).map(([key, item]) =>
      `<div><div><strong>${esc(item.label)}</strong><span>${number(item.score, 2)} 分 × ${item.weight}% = ${number(item.contribution, 2)}</span></div><progress value="${item.score}" max="100" aria-label="${esc(item.label)}"></progress></div>`).join("")}
      <p>基礎加權分數 ${number(score.baseScore, 2)}；所有股票採相同固定權重。${score.scoreCapped ? "雖然基礎加權分數較高，但部分必要進場條件尚未成立，最終評估分數受到 60 分上限限制。" : "任一核心條件未通過時，最終分數最高 60 分。"}</p></section>
      <section class="entry-evidence"><h3>支持條件</h3>${list(score.supportingEvidence, esc, "目前沒有符合的支持條件。")}
      <h3>疑慮與風險</h3>${list(score.conflictingEvidence, esc, "目前沒有額外風險提示。")}
      <h3>後續觀察</h3>${list(score.pendingConditions, esc, "核心趨勢條件已齊備，仍須自行評估風險。")}
      <details class="entry-metrics"><summary>查看計算依據</summary><p>MA20 ${number(metrics.ma20, 2)}（前日 ${number(metrics.previousMa20, 2)}）· MA60 ${number(metrics.ma60, 2)}（前日 ${number(metrics.previousMa60, 2)}）· 近五日站上 MA20：${metrics.fiveAboveMa20} 日</p>
      <p>K／D ${number(metrics.k, 2)}／${number(metrics.d, 2)}（前日 ${number(metrics.previousK, 2)}／${number(metrics.previousD, 2)}）· 今日量價 ${esc(metrics.priceVolume)}，RVOL20 ${number(metrics.rvol20, 2)} 倍</p>
      <p>近五日法人淨額 ${number(metrics.institutionNet5)} 股 ÷ 成交量 ${number(metrics.institutionVolume5)} 股 = ${percent(metrics.netRatio * 100)}；買超 ${metrics.institutionBuyDays} 日，累計買超類別 ${metrics.institutionPositiveCategories}／3</p>
      <p>MA20 偏離 ${percent(metrics.deviation20)} · 近十日前低點 ${number(metrics.previous10Low, 2)} · 距離 ${percent(metrics.riskDistance)} · ATR14 ${number(metrics.atr14, 2)}（${percent(metrics.atrPercent)}）</p></details></section>` :
      `<section class="entry-evidence"><h3>無法評分的原因</h3>${list(score.missingData, esc, "必要資料尚未齊備。")}</section>`}
    <p class="helper-text">此分數僅表示官方固定研究策略的條件符合程度，不代表上漲機率、預期報酬率或買賣指令。法人完整明細請至法人買賣頁面查看。</p>`;
}
