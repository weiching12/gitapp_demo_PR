import { combineChunks, validateManifest } from "../src/provider.js";

// Dependency-injected admin operation: copies/validates data, never changes KV.
export async function bootstrapHistory(repository, baseUrl, fetcher = fetch) {
  const read = async (path) => {
    const response = await fetcher(`${baseUrl}${path}`);
    if (!response.ok) throw new Error(`History bootstrap HTTP ${response.status}`);
    return response.json();
  };
  const manifest = validateManifest(await read("/api/market"));
  const chunks = [];
  for (const path of manifest.chunks) chunks.push(await read(path));
  const dataset = combineChunks(manifest, chunks);
  for (const chunk of chunks) {
    await repository.saveShard(chunk);
    if (JSON.stringify(await repository.shard(chunk.generation, chunk.index)) !== JSON.stringify(chunk))
      throw new Error("D1 history roundtrip mismatch");
  }
  if ((await read("/api/market")).generation !== manifest.generation)
    throw new Error("Public generation changed during bootstrap; do not enable history yet");
  await repository.commit(manifest);
  return { generation: manifest.generation, shards: chunks.length, stocks: dataset.stocks.length,
    historyRows: dataset.stocks.reduce((count, stock) => count + stock.history.length, 0) };
}
