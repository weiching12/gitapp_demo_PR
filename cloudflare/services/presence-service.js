const browserIdentifier = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const countryCodes = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT ' +
  'JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));

export function normalizeCountry(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return countryCodes.has(code) ? code : null;
}

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

  heartbeat(id, { visitId, metadataOnly = false, ip = null, country = null } = {}) {
    if (typeof id !== "string" || !browserIdentifier.test(id)) throw new InvalidPresenceIdentifier();
    if ((visitId !== undefined && (typeof visitId !== "string" || !browserIdentifier.test(visitId))) ||
      typeof metadataOnly !== "boolean" || (metadataOnly && visitId === undefined)) throw new InvalidPresenceIdentifier();
    const now = this.now(), { asOf } = taipeiVisitDay(now);
    return { today: this.repository.recordVisit({ id, visitId: visitId ?? crypto.randomUUID(), metadataOnly, now, ip, country: normalizeCountry(country) }), asOf };
  }

  count() {
    const now = this.now();
    const { asOf } = taipeiVisitDay(now);
    return { today: this.repository.countVisits(asOf), asOf };
  }
}
