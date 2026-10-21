import { validSymbol } from "../../shared/market-codec.js";
import { validDate } from "../../shared/market.js";
import { T86DataValidator, t86FlowReport } from "../t86-validator.js";

// Public TWSE whole-market sources and their wire-format parsers.
export const CATALOG_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L";
export const ETF_CATALOG_URL = "https://www.twse.com.tw/rwd/zh/ETF/list?response=json";

const sectors = {
  "01": "水泥工業", "02": "食品工業", "03": "塑膠工業", "04": "紡織纖維", "05": "電機機械",
  "06": "電器電纜", "08": "玻璃陶瓷", "09": "造紙工業", "10": "鋼鐵工業", "11": "橡膠工業",
  "12": "汽車工業", "14": "建材營造", "15": "航運業", "16": "觀光餐旅", "17": "金融保險",
  "18": "貿易百貨", "19": "綜合", "20": "其他", "21": "化學工業", "22": "生技醫療業",
  "23": "油電燃氣業", "24": "半導體業", "25": "電腦及週邊設備業", "26": "光電業",
  "27": "通信網路業", "28": "電子零組件業", "29": "電子通路業", "30": "資訊服務業",
  "31": "其他電子業", "35": "綠能環保", "36": "數位雲端", "37": "運動休閒", "38": "居家生活",
  "91": "存託憑證",
};

export function reportUrl(type, date) {
  if (!validDate(date) || !["prices", "flows"].includes(type)) throw new Error("Invalid report request");
  const url = new URL(type === "prices"
    ? "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX"
    : "https://www.twse.com.tw/rwd/zh/fund/T86");
  url.searchParams.set("response", "json");
  url.searchParams.set("date", date.replaceAll("-", ""));
  // Same whole-market coverage needed here, without tens of thousands of warrants.
  url.searchParams.set(type === "prices" ? "type" : "selectType", "ALLBUT0999");
  return url;
}

export async function fetchJson(url, fetcher = fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(30000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`TWSE HTTP ${response.status}; stop and retry later`);
  try { return await response.json(); }
  catch { throw new Error("TWSE returned non-JSON data; stop and retry later"); }
}

export function normalizeCatalog(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Empty TWSE company catalog");
  const seen = new Set();
  return rows.map((row) => {
    const symbol = row["公司代號"]?.trim(), name = row["公司簡稱"]?.trim();
    const sector = sectors[row["產業別"]?.trim()];
    const rawDate = row["上市日期"];
    const listedOn = /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}` : null;
    if (!/^\d{4,6}$/.test(symbol) || !name || !sector || !validDate(listedOn) || seen.has(symbol))
      throw new Error(`Invalid or duplicate TWSE company: ${symbol}`);
    seen.add(symbol);
    return { symbol, name, sector, market: "上市", listedOn };
  }).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function normalizeEtfCatalog(body) {
  if (body?.stat !== "OK" || !Array.isArray(body.fields) || !Array.isArray(body.data) || !body.data.length)
    throw new Error("Invalid TWSE ETF catalog");
  const required = ["上市日期", "證券代號", "證券簡稱"];
  const indices = required.map((name) => body.fields.indexOf(name));
  if (indices.some((index) => index < 0) || new Set(body.fields).size !== body.fields.length)
    throw new Error("Missing or duplicate ETF catalog columns");
  const seen = new Set();
  const result = body.data.map((row) => {
    if (!Array.isArray(row) || row.length !== body.fields.length) throw new Error("Invalid ETF catalog row");
    // Dual-currency counters share one table cell. This app quotes TWD: select
    // the primary TWD counter, never relabel the foreign-currency counter TWD.
    const cells = indices.map((index) => {
      if (typeof row[index] !== "string") throw new Error("Invalid ETF catalog cell");
      return row[index].split(/<br\s*\/?\s*>/i)[0].trim();
    });
    const date = cells[0].match(/^(\d{4})[./-](\d{2})[./-](\d{2})(?:\(新臺幣\))?$/);
    const symbol = cells[1].replace(/\(新臺幣\)$/, "").trim();
    const name = cells[2].replace(/\(新臺幣\)$/, "").trim();
    const listedOn = date ? `${date[1]}-${date[2]}-${date[3]}` : null;
    if (!validSymbol(symbol) || !symbol.startsWith("00") || !name || /<|>/.test(name) || !validDate(listedOn) || seen.has(symbol))
      throw new Error(`Invalid or duplicate ETF identity: ${symbol}`);
    seen.add(symbol);
    return { symbol, name, sector: "ETF", market: "上市", listedOn, assetType: "etf", currency: "TWD" };
  });
  return result.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function checkReport(body, date) {
  if (body?.stat !== "OK") {
    // Only this explicit exchange response means no report. HTML, throttling,
    // changed schemas and other errors must not silently become market holidays.
    if (typeof body?.stat === "string" && /^很抱歉[，,]?沒有符合條件的資料[!！。]?$/.test(body.stat.replaceAll(" ", "")))
      return false;
    throw new Error(`TWSE report unavailable: ${body?.stat}`);
  }
  if (body.date !== date.replaceAll("-", "")) throw new Error("TWSE report date mismatch");
  return true;
}

function columns(fields, required) {
  if (!Array.isArray(fields)) throw new Error("Missing TWSE report fields");
  const clean = fields.map((field) => field.replace(/\s/g, ""));
  return required.map((name) => {
    const index = clean.indexOf(name);
    if (index === -1) throw new Error(`Missing TWSE column: ${name}`);
    return index;
  });
}

function numeric(value, integer = false, signed = false) {
  const clean = typeof value === "string" ? value.trim().replaceAll(",", "") : value;
  if (clean === "" || clean === null || clean === undefined ||
      !(signed ? /^[+-]?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/).test(String(clean)))
    throw new Error(`Invalid TWSE number: ${value}`);
  const result = Number(clean);
  if (!Number.isFinite(result) || (!signed && result < 0) || (integer && !Number.isSafeInteger(result)))
    throw new Error("Invalid TWSE numeric range");
  return result;
}

function addUnique(map, symbol, value) {
  if (map.has(symbol)) throw new Error(`Duplicate TWSE security: ${symbol}`);
  map.set(symbol, value);
}

export function normalizePrices(body, date) {
  if (!checkReport(body, date)) return null;
  // Current reports use tables; archived reports may use fields9/data9.
  const table = body.tables?.find((item) => item.fields?.includes("證券代號") && item.fields.includes("收盤價"))
    ?? { fields: body.fields9, data: body.data9 };
  const [symbolCol, ...indices] = columns(table.fields, ["證券代號", "開盤價", "最高價", "最低價", "收盤價", "成交股數"]);
  if (!Array.isArray(table.data) || !table.data.length) throw new Error("Empty TWSE price table");
  const records = new Map(), inactive = [];
  for (const row of table.data) {
    const symbol = row[symbolCol]?.trim();
    if (!symbol) throw new Error("Missing TWSE price symbol");
    const raw = indices.map((index) => row[index]);
    if (raw.slice(0, 4).every((value) => typeof value === "string" && /^(--|---|-)$/.test(value.trim()))) {
      // Odd-lot-only trading can have positive volume but no regular-session
      // OHLC. Keep the unpriced status; never manufacture a closing price.
      numeric(raw[4], true);
      if (records.has(symbol) || inactive.includes(symbol)) throw new Error("Duplicate inactive security");
      inactive.push(symbol);
      continue;
    }
    const values = raw.map((value, index) => numeric(value, index === 4));
    const [open, high, low, close] = values;
    if (Math.min(open, high, low, close) <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || high < low)
      throw new Error(`Invalid TWSE OHLC: ${symbol}`);
    if (inactive.includes(symbol)) throw new Error("Duplicate security");
    addUnique(records, symbol, values);
  }
  return { date, records: Object.fromEntries(records), inactive, reportRows: table.data.length };
}

export function normalizeFlows(body, date) {
  // Pure parser for fixtures/legacy consumers. All ingestion paths must also pass
  // the contextual count gate (syncT86 or the seed validator) before publishing.
  const result = new T86DataValidator().validate({ httpStatus: 200, rawJson: JSON.stringify(body), tradeDate: date, baselineConfirmed: true });
  if (result.status === "NoData") return null;
  if (!result.valid) throw new Error(result.error);
  return t86FlowReport(result.rows, date);
}
