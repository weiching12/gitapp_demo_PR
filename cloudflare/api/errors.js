import { DomainError } from "../../shared/domain-error.js";
import { error } from "./http.js";

const statuses = Object.freeze({ INVALID_QUERY: 400, STOCK_NOT_FOUND: 404, DATA_UNAVAILABLE: 503 });

export function apiFailure(request, versioned, cause) {
  if (cause instanceof DomainError && Object.hasOwn(statuses, cause.code))
    return error(request, versioned, cause.code, cause.message, statuses[cause.code]);
  // Infrastructure errors and unknown application failures never leak details.
  console.error(JSON.stringify({ event: "api-read-failed", path: new URL(request.url).pathname, message: cause?.message }));
  return error(request, versioned, "DATA_UNAVAILABLE", "目前無法讀取股票資料，請稍後重試。", 503);
}
