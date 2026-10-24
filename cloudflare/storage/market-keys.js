// Storage identity stays outside the shared market rules.
export const MANIFEST_KEY = "twse:v2:market";
export const SYNC_KEY = "twse:v2:sync";
export const shardKey = (generation, index) => `twse:v2:${generation}:shard:${index}`;
export const stageKey = (generation, type) => `twse:v2:${generation}:${type}`;
