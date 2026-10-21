export const PRESENCE_TTL_MS = 90_000;
export const PRESENCE_REFRESH_INTERVAL_MS = 10_000;
const browserIdentifier = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export class InvalidPresenceIdentifier extends Error {
  constructor() {
    super("Invalid browser identifier");
    this.name = "InvalidPresenceIdentifier";
  }
}

// Presence policy is independent of HTTP and SQLite. Keep each observation
// synchronous so the repository's cleanup/upsert/count remains one operation.
export class PresenceService {
  constructor(repository, { now = Date.now } = {}) {
    this.repository = repository;
    this.now = now;
  }

  heartbeat(id) {
    if (typeof id !== "string" || !browserIdentifier.test(id)) throw new InvalidPresenceIdentifier();
    return this.observe(id);
  }

  count() {
    return this.observe();
  }

  observe(id) {
    const now = this.now();
    const expiresAt = now + PRESENCE_TTL_MS;
    return {
      online: this.repository.refreshAndCount({
        id, now, expiresAt, refreshBefore: expiresAt - PRESENCE_REFRESH_INTERVAL_MS,
      }),
      windowSeconds: PRESENCE_TTL_MS / 1000,
    };
  }
}
