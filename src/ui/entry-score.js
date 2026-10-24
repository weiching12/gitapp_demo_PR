const list = (items, esc, empty) => items.length
  ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p>${empty}</p>`;
const CORE_LABELS = { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現",
  institutional: "法人籌碼", entryRisk: "進場位置與風險" };
const CORE_DATA_LABELS = { close: "收盤價", ma20: "月線", ma60: "季線", previousMa20: "前日月線", previousMa60: "前日季線", k: "K 值", d: "D 值", previousK: "前日 K 值", dayBeforeK: "前二日 K 值", changePercent: "漲跌幅", rvol20: "均量倍數", institutionalNet5: "近五日法人淨額", deviation20: "月線乖離", previous10Low: "近十日前低點", atr14: "平均波動" };
const coreData = (data, esc, number) => Object.entries(data ?? {}).map(([key, value]) =>
  `<span><dt>${esc(CORE_DATA_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2"))}</dt><dd>${Number.isFinite(value) ? number(value, 2) : esc(value ?? "—")}</dd></span>`).join("");

export function entryScoreDialogMarkup(stock, esc, number, percent) {
  const score = stock.entryScore;
  if (!score) return `<h2 id="dialog-heading">個股進場評估</h2><p>資料不足，無法評分。</p>`;
  const valid = Number.isFinite(score.finalScore);
  if (!score.categories || !Object.keys(score.categories).length && valid)
    return `<h2 id="dialog-heading">${esc(stock.name)} ${esc(stock.symbol)}｜個股進場評估</h2><p role="status">評分明細載入中…</p>`;
  const metrics = score.metrics;
  return `<div class="entry-dialog"><h2 id="dialog-heading">${esc(stock.name)} ${esc(stock.symbol)}｜株研評分</h2>
    <p class="entry-dialog-meta">波段順勢進場 · ${esc(score.asOf)} · ${score.priceBasis === "adjusted" ? "還原價格" : "未還原價格"}</p>
    <section class="entry-summary"><div class="entry-summary-head"><strong>${valid ? `${score.displayScore} / 100` : "—"}</strong><span>${esc(score.status)}</span></div>
      <p class="entry-summary-reason">${esc(score.mainReason ?? score.conclusion ?? "必要資料尚未齊備")}</p>
      <dl class="entry-summary-facts"><div><dt>核心條件</dt><dd>${score.passedCount ?? 0} / ${score.totalConditions ?? 5} 通過</dd></div>
      <div><dt>收盤／漲跌</dt><dd>${stock.latest ? number(stock.latest.close, 2) : "—"}／${stock.latest ? percent(stock.latest.changePercent) : "—"}</dd></div>
      ${valid ? `<div><dt>基礎分數</dt><dd>${number(score.baseScore, 2)}</dd></div><div><dt>最終分數</dt><dd>${number(score.finalScore, 2)}${score.scoreCapped ? "（上限 60）" : ""}</dd></div>` : ""}</dl></section>
    <section class="entry-evidence"><h3>核心條件檢查</h3><div class="entry-condition-list">${Object.entries(CORE_LABELS).map(([key, label]) => {
      const item = score.coreConditions?.[key];
      const status = item?.status === "PASS" ? "通過" : item?.status === "FAIL" ? "未通過" : "資料不足";
      const tone = item?.status === "PASS" ? "pass" : item?.status === "FAIL" ? "fail" : "missing";
      const data = coreData(item?.data, esc, number);
      return `<article class="entry-condition"><div class="entry-condition-head"><strong>${label}</strong><span class="entry-condition-status ${tone}">${status}</span></div><p>${esc(item?.reason ?? "尚無判斷資料")}</p>${data ? `<details><summary>查看此條件數據</summary><dl class="entry-condition-data">${data}</dl></details>` : ""}</article>`;
    }).join("")}</div></section>
    ${valid ? `<section class="entry-categories"><h3>五項評分明細</h3>${Object.entries(score.categories).map(([key, item]) =>
      `<div class="entry-category"><div><strong>${esc(item.label)}</strong><span>${number(item.score, 2)} 分 · 權重 ${item.weight}% · 貢獻 ${number(item.contribution, 2)}</span></div><progress value="${item.score}" max="100" aria-label="${esc(item.label)}"></progress></div>`).join("")}
      <p>基礎加權分數 ${number(score.baseScore, 2)}。${score.scoreCapped ? "核心條件未全數通過，最終分數套用 60 分上限。" : "任一核心條件未通過時，最終分數最高 60 分。"}</p></section>
      <section class="entry-evidence entry-more"><details><summary>支持條件、風險與後續觀察</summary><h4>支持條件</h4>${list(score.supportingEvidence, esc, "目前沒有符合的支持條件。")}
      <h4>疑慮與風險</h4>${list(score.conflictingEvidence, esc, "目前沒有額外風險提示。")}
      <h4>後續觀察</h4>${list(score.pendingConditions, esc, "核心趨勢條件已齊備，仍須自行評估風險。")}</details>
      <details class="entry-metrics"><summary>查看完整計算依據</summary><p>MA20 ${number(metrics.ma20, 2)}（前日 ${number(metrics.previousMa20, 2)}）· MA60 ${number(metrics.ma60, 2)}（前日 ${number(metrics.previousMa60, 2)}）· 近五日站上 MA20：${metrics.fiveAboveMa20} 日</p>
      <p>K／D ${number(metrics.k, 2)}／${number(metrics.d, 2)}（前日 ${number(metrics.previousK, 2)}／${number(metrics.previousD, 2)}）· 今日量價 ${esc(metrics.priceVolume)}，RVOL20 ${number(metrics.rvol20, 2)} 倍</p>
      <p>近五日法人淨額 ${number(metrics.institutionNet5)} 股 ÷ 成交量 ${number(metrics.institutionVolume5)} 股 = ${percent(metrics.netRatio * 100)}；買超 ${metrics.institutionBuyDays} 日，累計買超類別 ${metrics.institutionPositiveCategories}／3</p>
      <p>MA20 偏離 ${percent(metrics.deviation20)} · 近十日前低點 ${number(metrics.previous10Low, 2)} · 距離 ${percent(metrics.riskDistance)} · ATR14 ${number(metrics.atr14, 2)}（${percent(metrics.atrPercent)}）</p></details></section>` :
      `<section class="entry-evidence"><h3>無法評分的原因</h3>${list(score.missingData, esc, "必要資料尚未齊備。")}</section>`}
    <p class="helper-text entry-disclaimer">此分數僅表示固定研究策略的條件符合程度，不代表上漲機率、預期報酬率或買賣指令。法人完整明細請至法人買賣頁面查看。<br>模型版本：${esc(score.modelVersion)}</p></div>`;
}
