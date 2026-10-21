import { MANIFEST_KEY, SYNC_KEY } from "../twse.js";

// Keep authoritative progress and the published head in strongly consistent DO
// storage. Existing KV state is imported once; readers still use public KV.
export class CoordinatorStore {
  constructor(storage, kv) { this.storage = storage; this.kv = kv; }
  async get(key, type) {
    if (key !== SYNC_KEY && key !== MANIFEST_KEY) return this.kv.get(key, type);
    const name = key === SYNC_KEY ? "progress" : "manifest";
    let value = await this.storage.get(name);
    if (value === undefined) {
      value = await this.kv.get(key, "json");
      await this.storage.put(name, value);
    }
    return type === "json" ? value : value === null ? null : JSON.stringify(value);
  }
  async put(key, raw, options) {
    if (key === SYNC_KEY) return this.storage.put("progress", JSON.parse(raw));
    if (key === MANIFEST_KEY) {
      // A crash after the KV write can be recovered without constructing another
      // generation. Replay the identical publication before advancing any phase.
      await this.storage.put("pendingManifest", raw);
      await this.recoverPublication();
      return;
    }
    return this.kv.put(key, raw, options);
  }
  delete(key) {
    if (key === SYNC_KEY || key === MANIFEST_KEY) throw new Error("Cannot delete coordinator heads");
    return this.kv.delete(key);
  }
  async recoverPublication() {
    const raw = await this.storage.get("pendingManifest");
    if (raw === undefined) return;
    await this.kv.put(MANIFEST_KEY, raw);
    await this.storage.put("manifest", JSON.parse(raw));
    await this.storage.delete("pendingManifest");
  }
}
