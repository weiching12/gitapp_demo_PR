import { createMarketService } from "../composition.js";
import { resolveApiRoute } from "./routes.js";
import { marketController } from "./market-controller.js";
import { presenceController } from "./presence-controller.js";
import { apiFailure } from "./errors.js";
import { json, error } from "./http.js";

export async function routeApi(request, env, service) {
  const url = new URL(request.url), route = resolveApiRoute(url.pathname);
  if (!route.name) return error(request, route.versioned, "NOT_FOUND", "找不到這個資料端點", 404);
  if (!route.methods.includes(request.method)) return error(request, route.versioned,
    "METHOD_NOT_ALLOWED", "Method not allowed", 405, { Allow: route.methods.join(", ") });
  try {
    if (route.name === "presence") return await presenceController(request, env, route.versioned);
    const body = await marketController(route, url, service ?? createMarketService(env));
    return json(request, body, 200, route.name === "snapshot"
      ? "public, max-age=86400, immutable" : "public, max-age=60");
  } catch (cause) { return apiFailure(request, route.versioned, cause); }
}
