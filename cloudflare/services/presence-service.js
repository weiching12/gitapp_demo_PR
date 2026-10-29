const browserIdentifier = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taipeiVisitDay(now) {
  const date = new Date(now + TAIPEI_OFFSET_MS);
  const asOf = date.toISOString().slice(0, 10);
  const expiresAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) - TAIPEI_OFFSET_MS;
  return { asOf, expiresAt };
}

export class InvalidPresenceIdentifier extends Error {
  constructor() {
    super("Invalid browser identifier");
    this.name = "InvalidPresenceIdentifier";
  }
}

// Count each browser once per Taipei calendar day; reading the count is read-only.
export class PresenceService {
  constructor(repository, { now = Date.now } = {}) {
    this.repository = repository;
    this.now = now;
  }

  heartbeat(id, { nationality = null, ip = null, country = null } = {}) {
    if (typeof id !== "string" || !browserIdentifier.test(id)) throw new InvalidPresenceIdentifier();
    const now = this.now(), { asOf, expiresAt } = taipeiVisitDay(now);
    return { today: this.repository.recordVisit({ id, now, expiresAt, nationality, ip, country }), asOf };
  }

  count() {
    const now = this.now();
    const { asOf, expiresAt } = taipeiVisitDay(now);
    return { today: this.repository.countVisits(expiresAt), asOf };
  }
}
