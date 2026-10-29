import { DEFAULT_SETTINGS } from "../../shared/indicators.js";
import { DomainError } from "../../shared/domain-error.js";

const integer = (value, fallback, max) => {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max)
    throw new DomainError("INVALID_QUERY", "分頁參數格式或範圍不正確");
  return Number(value);
};

export function stockCollectionOptions(params) {
  const type = params.get("type");
  if (type && !["stock", "etf"].includes(type)) throw new DomainError("INVALID_QUERY", "type 必須是 stock 或 etf");
  const limit = integer(params.get("limit"), 100, 200);
  if (!limit) throw new DomainError("INVALID_QUERY", "limit 必須大於 0");
  return { offset: integer(params.get("offset"), 0, Number.MAX_SAFE_INTEGER), limit, type,
    sector: params.get("sector"), query: params.get("q") };
}

export function analysisOptions(params) {
  const settings = { ...DEFAULT_SETTINGS };
  for (const name of Object.keys(settings)) {
    const raw = params.get(name);
    if (raw === null) continue;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > (name === "period" ? 60 : 20))
      throw new DomainError("INVALID_QUERY", "指標參數超出允許範圍");
    settings[name] = Number(raw);
  }
  const asOf = params.get("asOf");
  if (asOf && (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) ||
      new Date(asOf).toISOString().slice(0, 10) !== asOf)) throw new DomainError("INVALID_QUERY", "日期格式不正確");
  return { settings, asOf };
}
