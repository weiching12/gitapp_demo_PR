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

// A new page-entry key counts a new visit; retries and metadata edits reuse that key.
export class PresenceService {
  constructor(repository, { now = Date.now } = {}) {
    this.repository = repository;
    this.now = now;
  }

  heartbeat(id, { visitId, metadataOnly = false, nationality = null, ip = null, country = null } = {}) {
    if (typeof id !== "string" || !browserIdentifier.test(id)) throw new InvalidPresenceIdentifier();
    if ((visitId !== undefined && (typeof visitId !== "string" || !browserIdentifier.test(visitId))) ||
      typeof metadataOnly !== "boolean" || (metadataOnly && visitId === undefined)) throw new InvalidPresenceIdentifier();
    const now = this.now(), { asOf } = taipeiVisitDay(now);
    return { today: this.repository.recordVisit({ id, visitId: visitId ?? crypto.randomUUID(), metadataOnly, now, nationality, ip, country }), asOf };
  }

  count() {
    const now = this.now();
    const { asOf } = taipeiVisitDay(now);
    return { today: this.repository.countVisits(asOf), asOf };
  }
}
