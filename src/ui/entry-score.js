const list = (items, esc, empty) => items.length
  ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p>${empty}</p>`;
const guideItem = (index, title, content) =>
  `<article class="guide-item entry-guide-item"><span>${index}</span><div><h4>${title}</h4>${content}</div></article>`;
const CORE_LABELS = { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現",
  institutional: "法人籌碼", entryRisk: "進場位置與風險" };
const CORE_DATA_LABELS = { close: "收盤價", ma20: "月線", ma60: "季線", previousMa20: "前日月線", previousMa60: "前日季線", k: "K 值", d: "D 值", previousK: "前日 K 值", dayBeforeK: "前二日 K 值", changePercent: "漲跌幅", rvol20: "均量倍數", institutionalNet5: "近五日法人淨額", deviation20: "月線乖離", previous10Low: "近十日前低點", atr14: "平均波動" };
const coreData = (data, esc, number) => Object.entries(data ?? {}).map(([key, value]) =>
  `<span><dt>${esc(CORE_DATA_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2"))}</dt><dd>${Number.isFinite(value) ? number(value, 2) : esc(value ?? "—")}</dd></span>`).join("");

export function entryScoreDialogMarkup(stock, esc, number, percent) {
  const score = stock.entryScore;
  const heading = `<p class="entry-dialog-sector">${esc(stock.sector ?? "產業未分類")}</p><h2 id="dialog-heading">${esc(stock.symbol)} ${esc(stock.name)}｜株研評分</h2>`;
  if (!score) return `${heading}<p>資料不足，無法評分。</p>`;
  const valid = Number.isFinite(score.finalScore);
  if (!score.categories || !Object.keys(score.categories).length && valid)
    return `${heading}<p role="status">評分明細載入中…</p>`;
  const metrics = score.metrics;
  return `<div class="entry-dialog">${heading}
    <p class="entry-dialog-meta">波段順勢進場 · ${esc(score.asOf)}</p>
    <section class="entry-summary"><div class="entry-summary-head"><strong${valid ? ` data-score-target="${score.finalScore}"` : ""}>${valid ? `${number(score.finalScore, 2)} / 100` : "—"}</strong><span>${esc(score.status)}</span></div>
      <dl class="entry-summary-facts"><div><dt>核心條件</dt><dd>${score.passedCount ?? 0} / ${score.totalConditions ?? 5} 通過</dd></div>
      <div><dt>收盤／漲跌</dt><dd>${stock.latest ? number(stock.latest.close, 2) : "—"}／${stock.latest ? percent(stock.latest.changePercent) : "—"}</dd></div>
      ${valid ? `<div><dt>基礎分數</dt><dd>${number(score.baseScore, 2)}</dd></div><div><dt>最終分數</dt><dd>${number(score.finalScore, 2)}</dd></div>` : ""}</dl></section>
    <section class="entry-evidence entry-core-panel"><h3>核心條件檢查</h3><div class="entry-condition-list">${Object.entries(CORE_LABELS).map(([key, label]) => {
      const item = score.coreConditions?.[key];
      const status = item?.status === "PASS" ? "通過" : item?.status === "FAIL" ? "未通過" : "資料不足";
      const tone = item?.status === "PASS" ? "pass" : item?.status === "FAIL" ? "fail" : "missing";
      const data = coreData(item?.data, esc, number);
      const iconPath = tone === "pass" ? "M4.5 10.25 8.5 14.25 15.5 6.5" :
        tone === "fail" ? "M5.5 5.5 14.5 14.5 M14.5 5.5 5.5 14.5" : "M5 10 15 10";
      return `<details class="entry-condition ${tone}"><summary><span class="entry-condition-icon" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="${iconPath}"/></svg></span><span class="entry-condition-copy"><strong>${label}</strong><small>${esc(item?.reason ?? "尚無判斷資料")}</small></span><span class="entry-condition-status ${tone}">${status}</span></summary><div class="entry-condition-detail">${data ? `<dl class="entry-condition-data">${data}</dl>` : "<p>尚無條件數據。</p>"}</div></details>`;
    }).join("")}</div></section>
    ${valid ? `<section class="entry-categories"><h3>五項評分明細</h3>${Object.entries(score.categories).map(([key, item]) =>
      `<div class="entry-category ${score.coreConditions?.[key]?.status === "PASS" ? "" : "excluded"}"><div><strong>${esc(item.label)}</strong><span>權重 ${item.weight}% · 基礎貢獻 ${number(item.creditedContribution ?? (score.coreConditions?.[key]?.status === "PASS" ? item.contribution : 0), 2)}</span></div><small>${number(item.score, 2)} 分${score.coreConditions?.[key]?.status === "PASS" ? "" : " · 條件未通過，計入 0.00"}</small><progress value="${item.score}" max="100" aria-label="${esc(item.label)}"></progress></div>`).join("")}
      <p>基礎加權分數 ${number(score.baseScore, 2)}；通過條件計入 ${number(score.qualifiedScore, 2)}。未通過條件的貢獻不計入最終分數。</p></section>
      <section class="entry-evidence entry-more"><details><summary>支持條件、風險與後續觀察</summary>
      ${guideItem("01", "支持條件", list(score.supportingEvidence, esc, "目前沒有符合的支持條件。"))}
      ${guideItem("02", "疑慮與風險", list(score.conflictingEvidence, esc, "目前沒有額外風險提示。"))}
      ${guideItem("03", "後續觀察", list(score.pendingConditions, esc, "核心趨勢條件已齊備，仍須自行評估風險。"))}</details>
      <details class="entry-metrics"><summary>查看完整計算依據</summary>
      ${guideItem("01", "趨勢與均線", `<p>月線 MA20：${number(metrics.ma20, 2)}（前日 ${number(metrics.previousMa20, 2)}）</p><p>季線 MA60：${number(metrics.ma60, 2)}（前日 ${number(metrics.previousMa60, 2)}）</p><code>近五日站上月線：${metrics.fiveAboveMa20} 日</code>`)}
      ${guideItem("02", "KD 與今日量價", `<p>K／D：${number(metrics.k, 2)}／${number(metrics.d, 2)}（前日 ${number(metrics.previousK, 2)}／${number(metrics.previousD, 2)}）</p><code>${esc(metrics.priceVolume)} · ${number(metrics.rvol20, 2)} 倍均量</code>`)}
      ${guideItem("03", "法人籌碼", `<p>近五日法人淨額 ${number(metrics.institutionNet5)} 股，成交量 ${number(metrics.institutionVolume5)} 股</p><code>法人淨額占比 ${percent(metrics.netRatio * 100)} · 買超 ${metrics.institutionBuyDays} 日 · 買超類別 ${metrics.institutionPositiveCategories}／3</code>`)}
      ${guideItem("04", "進場位置與波動", `<p>月線乖離 ${percent(metrics.deviation20)} · 近十日前低點 ${number(metrics.previous10Low, 2)} · 距離 ${percent(metrics.riskDistance)}</p><code>ATR14 ${number(metrics.atr14, 2)}（${percent(metrics.atrPercent)}）</code>`)}</details></section>` :
      `<section class="entry-evidence"><h3>無法評分的原因</h3>${list(score.missingData, esc, "必要資料尚未齊備。")}</section>`}
    <p class="helper-text entry-disclaimer">此分數僅表示固定研究策略的條件符合程度，不代表上漲機率、預期報酬率或買賣指令。法人完整明細請至法人買賣頁面查看。<br>模型版本：${esc(score.modelVersion)}</p></div>`;
}
