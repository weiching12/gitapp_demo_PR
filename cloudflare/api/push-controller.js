import { json, error } from "./http.js";

const sameOrigin = (request, native = false) => {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin || native && origin === "capacitor://localhost";
};
const body = async (request) => {
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) throw Object.assign(new Error("Request body too large"), { status: 413, code: "BODY_TOO_LARGE" });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 4096) throw Object.assign(new Error("Request body too large"), { status: 413, code: "BODY_TOO_LARGE" });
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("Invalid JSON"), { status: 400, code: "INVALID_JSON" }); }
};

export async function pushController(request, route, service) {
  if (route.name === "pushConfig" || route.name === "nativePushConfig") return json(request, service.config());
  if (!sameOrigin(request, route.name === "nativePushSubscriptions")) return error(request, true, "CROSS_ORIGIN", "Cross-origin request rejected", 403);
  const input = await body(request);
  const result = request.method === "POST" ? await service.subscribe(input) : await service.unsubscribe(input);
  return json(request, result);
}
