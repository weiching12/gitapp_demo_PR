// This order is used only for canonical storage/hash input. Incoming columns are
// always located by their complete names, including the foreign dealer fields.
export const T86_FIELDS = Object.freeze([
  "證券代號", "證券名稱", "外陸資買進股數(不含外資自營商)", "外陸資賣出股數(不含外資自營商)",
  "外陸資買賣超股數(不含外資自營商)", "外資自營商買進股數", "外資自營商賣出股數", "外資自營商買賣超股數",
  "投信買進股數", "投信賣出股數", "投信買賣超股數", "自營商買賣超股數",
  "自營商買進股數(自行買賣)", "自營商賣出股數(自行買賣)", "自營商買賣超股數(自行買賣)",
  "自營商買進股數(避險)", "自營商賣出股數(避險)", "自營商買賣超股數(避險)", "三大法人買賣超股數",
]);
export const T86_QUERY = "TWSE:T86:ALLBUT0999";
const netColumns = new Set([4, 7, 10, 11, 14, 17, 18]);
const noData = (stat) => typeof stat === "string" && /^很抱歉[，,]?沒有符合條件的資料[!！。]?$/.test(stat.replace(/\s/g, ""));

export function normalizeT86Date(value) {
  const text = String(value ?? "").trim().replace(/[-/]/g, "");
  if (!/^\d{8}$/.test(text)) throw new Error("Invalid T86 date");
  const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
  if (!Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso)
    throw new Error("Invalid T86 calendar date");
  return text;
}

function integer(value, signed) {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Not an integer");
  const text = String(value).trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) throw new Error("Not an integer");
  const result = Number(text.replaceAll(",", ""));
  if (!Number.isSafeInteger(result) || (!signed && result < 0)) throw new Error("Integer out of range");
  return result;
}

export function t86FlowReport(rows, date) {
  return { date, records: Object.fromEntries(rows.map((r) => [r[0],
    [r[2], r[3], r[8], r[9], r[12] + r[15], r[13] + r[16]]])), reportRows: rows.length };
}

export class T86DataValidator {
  constructor({ historyRatio = 0.90, eveningRatio = 0.95 } = {}) {
    if (![historyRatio, eveningRatio].every((v) => Number.isFinite(v) && v > 0 && v <= 1))
      throw new Error("T86 count ratios must be greater than 0 and at most 1");
    this.historyRatio = historyRatio;
    this.eveningRatio = eveningRatio;
  }

  validate({ httpStatus, rawJson, tradeDate, recentCounts = [], earlyCount = null,
    slot = "backfill", baselineConfirmed = false }) {
    const checks = [], rows = [];
    let body, count = 0, code = "transport";
    const pass = (name, details = {}) => checks.push({ rule: name, passed: true, ...details });
    const fail = (message) => { throw new Error(message); };
    try {
      const expected = normalizeT86Date(tradeDate);
      if (httpStatus !== 200) fail(`TWSE HTTP ${httpStatus}; expected 200`);
      body = JSON.parse(rawJson);
      if (!body || typeof body !== "object" || Array.isArray(body)) fail("T86 JSON must be an object");
      pass(code);
      code = "date";
      if (noData(body.stat)) return { status: "NoData", valid: false, rows: [], recordCount: 0, checks, error: null };
      if (body.stat !== "OK") fail(`TWSE report unavailable: ${body.stat}`);
      if (normalizeT86Date(body.date) !== expected) fail("TWSE report date mismatch");
      pass(code, { expected });
      code = "structure";
      if (body.selectType !== undefined && body.selectType !== "ALLBUT0999") fail("T86 query condition mismatch");
      if (!Array.isArray(body.fields) || !Array.isArray(body.data)) fail("Missing T86 fields/data arrays");
      count = body.data.length;
      if (!body.fields.every((f) => typeof f === "string")) fail("Invalid T86 field name");
      const fields = body.fields.map((f) => f.replace(/\s/g, ""));
      if (new Set(fields).size !== fields.length) fail("Duplicate T86 field names");
      const indices = T86_FIELDS.map((name) => {
        const index = fields.indexOf(name);
        if (index < 0) fail(`Missing TWSE column: ${name}`);
        return index;
      });
      if (body.total !== undefined && integer(body.total, false) !== count) fail("Truncated T86 report total");
      if (!count) return { status: "NoData", valid: false, rows: [], recordCount: 0, checks, error: null };
      pass(code, { fieldCount: fields.length });
      const symbols = new Set();
      for (const [rowIndex, row] of body.data.entries()) {
        code = "row";
        if (!Array.isArray(row) || row.length !== fields.length) fail(`T86 row ${rowIndex + 1}: column count mismatch`);
        const symbol = row[indices[0]], name = row[indices[1]];
        if (typeof symbol !== "string" || !symbol.trim() || typeof name !== "string" || !name.trim())
          fail(`T86 row ${rowIndex + 1}: empty security code/name`);
        if (symbols.has(symbol.trim())) fail(`Duplicate TWSE security: ${symbol.trim()}`);
        symbols.add(symbol.trim());
        code = "integer";
        const values = [symbol.trim(), name.trim(), ...indices.slice(2).map((index, offset) => {
          try { return integer(row[index], netColumns.has(offset + 2)); }
          catch { fail(`Invalid T86 integer: ${symbol.trim()} ${T86_FIELDS[offset + 2]} = ${row[index]}`); }
        })];
        code = "arithmetic";
        for (const [buy, sell, net] of [[2, 3, 4], [5, 6, 7], [8, 9, 10], [12, 13, 14], [15, 16, 17]]) {
          if (!Number.isSafeInteger(values[buy] - values[sell]) || values[buy] - values[sell] !== values[net])
            fail(`TWSE published net totals disagree: ${values[0]} ${T86_FIELDS[net]}`);
        }
        if (!Number.isSafeInteger(values[12] + values[15]) || !Number.isSafeInteger(values[13] + values[16]) ||
            !Number.isSafeInteger(values[14] + values[17]) || values[14] + values[17] !== values[11] ||
            BigInt(values[4]) + BigInt(values[10]) + BigInt(values[11]) !== BigInt(values[18]))
          fail(`TWSE published net totals disagree: ${values[0]} dealer/official total`);
        // Keep the official total (column 18); never replace it with our calculation.
        rows.push(values);
      }
      pass("row"); pass("integer"); pass("arithmetic");
      code = "recordCount";
      if (!Array.isArray(recentCounts) || recentCounts.length > 5 ||
          !recentCounts.every((n) => Number.isSafeInteger(n) && n > 0)) fail("Invalid T86 count baseline");
      const sorted = [...recentCounts].sort((a, b) => a - b);
      const median = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null;
      const minimum = median === null ? null : Math.ceil(median * this.historyRatio);
      if (minimum !== null && count < minimum) fail(`T86 count ${count} below historical minimum ${minimum}`);
      if (earlyCount !== null && (!Number.isSafeInteger(earlyCount) || earlyCount <= 0)) fail("Invalid early-session count");
      const eveningMinimum = slot === "20:30" && earlyCount !== null ? Math.ceil(earlyCount * this.eveningRatio) : null;
      if (eveningMinimum !== null && count < eveningMinimum) fail(`T86 count ${count} below 18:30 minimum ${eveningMinimum}`);
      const pending = recentCounts.length < 5 && !baselineConfirmed;
      checks.push({ rule: code, passed: !pending, baselineStatus: pending ? "PendingConfirmation" : baselineConfirmed ? "ConfirmedBootstrap" : "Established",
        sampleDays: recentCounts.length, median, minimum, historyRatio: this.historyRatio, earlyCount,
        eveningMinimum, eveningRatio: this.eveningRatio });
      rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      return { status: pending ? "PendingConfirmation" : "Validated", valid: !pending, rows, recordCount: count, checks,
        error: pending ? "Fewer than five successful trading days; exact report requires baseline confirmation" : null };
    } catch (error) {
      checks.push({ rule: code, passed: false, error: error.message });
      return { status: "Failed", valid: false, rows: [], recordCount: count, checks, error: error.message };
    }
  }
}

export async function t86DataHash(rows, tradeDate, queryKey = T86_QUERY) {
  const canonical = JSON.stringify({ queryKey, tradeDate: normalizeT86Date(tradeDate), fields: T86_FIELDS, rows });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
