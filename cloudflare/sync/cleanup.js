import { shardKey } from "../twse.js";

export async function retireShard(kv, manifest, state, index) {
  const retired = new Set([manifest?.previousGeneration, ...(state.cleanupGenerations ?? [])].filter(Boolean));
  for (const generation of retired) {
    if (generation === manifest?.generation || generation === state.generation) continue;
    const key = shardKey(generation, index);
    if (await kv.get(key) !== null) await kv.delete(key);
  }
}
