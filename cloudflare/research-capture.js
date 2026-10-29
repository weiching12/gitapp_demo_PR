import { createApplicationServices } from "./composition.js";
import { DEFAULT_SETTINGS } from "../shared/indicators.js";
import { ENTRY_MODEL_VERSION } from "../shared/entry-score.js";
import { researchConfigId } from "../shared/research-tracking.js";

// Run inside the market sync coordinator's queue, with its authoritative store.
// A retry always targets the current publication, never an expired generation.
export async function captureLatestResearch(env, createServices = createApplicationServices) {
  if (!env.T86_DB) return { status: "not-required" };
  try {
    const services = createServices(env);
    const manifest = await services.market.market();
    const revisionId = `${manifest.generation}:${services.actions ? await services.actions.revision() : "no-actions"}`;
    const key = { asOf: manifest.asOf, modelVersion: ENTRY_MODEL_VERSION,
      configId: researchConfigId(DEFAULT_SETTINGS), revisionId };
    if (await services.research.hasRevision(key))
      return { status: "already-saved", generation: manifest.generation, asOf: manifest.asOf };
    const result = await services.summary.summary(undefined, DEFAULT_SETTINGS, { persistResearch: true });
    if (result.meta?.generation !== manifest.generation || result.meta?.researchCapture !== "saved")
      throw new Error("Research snapshot capture did not complete for the current publication");
    return { status: "saved", generation: manifest.generation, asOf: manifest.asOf };
  } catch (error) {
    console.error(JSON.stringify({ event: "research-capture-delayed", message: error.message }));
    return { status: "failed" };
  }
}
