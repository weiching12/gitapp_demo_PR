export const EX_RIGHTS_URL = "https://www.twse.com.tw/exchangeReport/TWT49U";
export const REDUCTION_URL = "https://www.twse.com.tw/exchangeReport/TWTAUU";
export const PAR_VALUE_URL = "https://www.twse.com.tw/exchangeReport/TWTB8U";

function reportUrl(base, start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end)
    throw new Error("Invalid ex-rights date range");
  return `${base}?response=json&startDate=${start.replaceAll("-", "")}&endDate=${end.replaceAll("-", "")}`;
}
export const exRightsUrl = (start, end) => reportUrl(EX_RIGHTS_URL, start, end);
export const reductionUrl = (start, end) => reportUrl(REDUCTION_URL, start, end);
export const parValueUrl = (start, end) => reportUrl(PAR_VALUE_URL, start, end);

function parseDate(value) {
  const match = /^(\d{2,3})年(\d{2})月(\d{2})日$/.exec(value);
  if (!match) throw new Error("Invalid TWSE ex-rights date");
  const date = `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    throw new Error("Invalid TWSE ex-rights calendar date");
  return date;
}

export function parseExRightsReport(report, start, end) {
  if (report?.stat === "很抱歉，沒有符合條件的資料!" && !report.data && !report.fields)
    return [];
  if (report?.stat !== "OK" || !Array.isArray(report.fields) || !Array.isArray(report.data) ||
      report.fields[0] !== "資料日期" || report.fields[1] !== "股票代號" ||
      report.fields[3] !== "除權息前收盤價" || report.fields[4] !== "除權息參考價")
    throw new Error("TWSE ex-rights report unavailable or format changed");
  const events = new Map();
  for (const row of report.data) {
    if (!Array.isArray(row) || row.length < 7) throw new Error("Invalid TWSE ex-rights row");
    const date = parseDate(row[0]), symbol = String(row[1]);
    if (date < start || date > end)
      throw new Error("TWSE ex-rights row outside requested range");
    // The official report also contains alphanumeric ETF and preferred-share codes.
    // Market sentiment considers ordinary listed shares only.
    if (!/^\d{4,6}$/.test(symbol)) continue;
    const beforeClose = Number(String(row[3]).replaceAll(",", ""));
    const reference = Number(String(row[4]).replaceAll(",", ""));
    if (!(beforeClose > 0) || !(reference > 0)) throw new Error("Invalid TWSE ex-rights prices");
    const key = `${date}:${symbol}`;
    if (events.has(key)) throw new Error("Duplicate TWSE ex-rights event");
    events.set(key, { date, symbol, kind: String(row[6]), beforeClose, reference });
  }
  return [...events.values()];
}

function parseResumeDate(value) {
  const match = /^(\d{2,3})\/(\d{2})\/(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid TWSE resumption date");
  const date = `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    throw new Error("Invalid TWSE resumption calendar date");
  return date;
}

function parseResumptionReport(report, start, end, kind) {
  if (report?.stat === "很抱歉，沒有符合條件的資料!" && !report.data && !report.fields)
    return [];
  if (report?.stat !== "OK" || !Array.isArray(report.fields) || !Array.isArray(report.data) ||
      report.fields[0] !== "恢復買賣日期" || report.fields[1] !== "股票代號" ||
      report.fields[3] !== "停止買賣前收盤價格" || report.fields[4] !== "恢復買賣參考價")
    throw new Error(`TWSE ${kind} report unavailable or format changed`);
  const events = new Map();
  for (const row of report.data) {
    if (!Array.isArray(row) || row.length < 5) throw new Error(`Invalid TWSE ${kind} row`);
    const date = parseResumeDate(row[0]), symbol = String(row[1]);
    if (date < start || date > end) throw new Error(`TWSE ${kind} row outside requested range`);
    if (!/^\d{4,6}$/.test(symbol)) continue;
    const beforeClose = Number(String(row[3]).replaceAll(",", ""));
    const reference = Number(String(row[4]).replaceAll(",", ""));
    if (!(beforeClose > 0) || !(reference > 0)) throw new Error(`Invalid TWSE ${kind} prices`);
    const key = `${date}:${symbol}`;
    if (events.has(key)) throw new Error(`Duplicate TWSE ${kind} event`);
    events.set(key, { date, symbol, kind, beforeClose, reference });
  }
  return [...events.values()];
}

export const parseReductionReport = (report, start, end) =>
  parseResumptionReport(report, start, end, "減資");
export const parseParValueReport = (report, start, end) =>
  parseResumptionReport(report, start, end, "面額變更");

export function combineCorporateActions(...reports) {
  const events = new Map();
  // Later, unsupported changes supersede an ex-rights row on the same date.
  for (const report of reports)
    for (const event of report) events.set(`${event.date}:${event.symbol}`, event);
  return [...events.values()];
}
