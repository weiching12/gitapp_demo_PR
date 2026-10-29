// This Durable Object stores derived responses only, never market/research records.
// The versioned index replaces all legacy, unbounded view:* entries on first use.
const INDEX_KEY = "summary-cache:index:v4";
const PART_CHARS = 400_000;
export const SUMMARY_CACHE_LIMITS = Object.freeze({ maxEntries: 64, maxBytes: 16 * 1024 * 1024, ttlMs: 6 * 60 * 60 * 1000 });

export class SummaryCache {
  constructor(storage, options = {}) {
    this.storage = storage;
    this.options = { ...SUMMARY_CACHE_LIMITS, now: Date.now, ...options };
    this.tail = Promise.resolve();
    this.ready = false;
  }

  run(work) {
    const task = this.tail.then(async () => {
      if (!this.ready) {
        if (!await this.storage.get(INDEX_KEY)) {
          await this.storage.deleteAll();
          await this.storage.put(INDEX_KEY, []);
        }
        this.ready = true;
      }
      return this.storage.transaction(async tx => {
        const index = await tx.get(INDEX_KEY) ?? [];
        const active = [];
        for (const entry of index) {
          if (entry.expiresAt <= this.options.now()) await this.remove(tx, entry);
          else active.push(entry);
        }
        const value = await work(tx, active);
        await tx.put(INDEX_KEY, active);
        // This class is used by a SQLite-backed DO: alarm and payload writes
        // participate in the same transaction, including when scheduling fails.
        if (active.length) await this.storage.setAlarm(Math.min(...active.map(entry => entry.expiresAt)));
        else await this.storage.deleteAlarm();
        return value;
      });
    });
    this.tail = task.catch(() => {});
    return task;
  }

  async remove(tx, entry) {
    const keys = Array.from({ length: entry.parts }, (_, index) => `${entry.key}:part:${index}`);
    keys.push(`${entry.key}:parts`);
    for (let offset = 0; offset < keys.length; offset += 128) await tx.delete(keys.slice(offset, offset + 128));
  }

  read(key) {
    return this.run(async (tx, index) => {
      const position = index.findIndex(entry => entry.key === key);
      if (position < 0) return null;
      const [entry] = index.splice(position, 1);
      const parts = await Promise.all(Array.from({ length: entry.parts }, (_, part) => tx.get(`${key}:part:${part}`)));
      if (parts.some(part => typeof part !== "string")) { await this.remove(tx, entry); return null; }
      try {
        const body = JSON.parse(parts.join(""));
        index.push(entry);
        return body;
      } catch { await this.remove(tx, entry); return null; }
    });
  }

  write(key, body) {
    const serialized = JSON.stringify(body), bytes = new TextEncoder().encode(serialized).length;
    return this.run(async (tx, index) => {
      const old = index.findIndex(entry => entry.key === key);
      if (old >= 0) await this.remove(tx, index.splice(old, 1)[0]);
      if (bytes > this.options.maxBytes) return false;
      while (index.length && (index.length >= this.options.maxEntries || index.reduce((sum, entry) => sum + entry.bytes, 0) + bytes > this.options.maxBytes))
        await this.remove(tx, index.shift());
      const parts = [];
      for (let start = 0; start < serialized.length; start += PART_CHARS) parts.push(serialized.slice(start, start + PART_CHARS));
      for (let part = 0; part < parts.length; part++) await tx.put(`${key}:part:${part}`, parts[part]);
      await tx.put(`${key}:parts`, parts.length);
      index.push({ key, bytes, parts: parts.length, expiresAt: this.options.now() + this.options.ttlMs });
      return true;
    });
  }

  prune() { return this.run(async () => {}); }
}
