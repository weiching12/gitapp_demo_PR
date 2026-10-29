import { presenceResponse } from "../presence.js";
import { error } from "./http.js";

export async function presenceController(request, env, versioned) {
  const response = await presenceResponse(request, env);
  if (!versioned || response.ok) return response;
  const body = await response.json();
  return error(request, true, "PRESENCE_ERROR", body.error, response.status);
}
