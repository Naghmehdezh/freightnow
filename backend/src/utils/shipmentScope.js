// Whether a shipment is domestic, cross-border (CA<->US), or international. This is a real
// concept the carrier adapters and shipment.service.js already compute ad hoc under three
// different local names (isCrossBorder, isIntl, isInternational) — this is the one shared,
// named version for the pricing engine specifically.
//
// `intl` is reachable today purely because rate.routes.js's Zod schema doesn't restrict
// `country` to an enum — no carrier currently services non-CA/US destinations, but that's
// pre-existing looseness in the input validation, not something this helper needs to guard
// against.
const NORTH_AMERICA_TRADE_ZONE = ['CA', 'US'];

function detectScope(originCountry, destCountry) {
  const o = (originCountry || '').toUpperCase();
  const d = (destCountry || '').toUpperCase();
  if (o === d) return 'dom';
  if (NORTH_AMERICA_TRADE_ZONE.includes(o) && NORTH_AMERICA_TRADE_ZONE.includes(d)) return 'xb';
  return 'intl';
}

// Lane names used by carrier coverage (Carrier.lanes / Carrier_Mapping.md columns).
// Anything that isn't CA->CA, US->US or CA<->US counts as international — including a
// domestic move inside another country, which none of the mapped carriers cover domestically.
function detectLane(originCountry, destCountry) {
  const o = (originCountry || '').toUpperCase();
  const d = (destCountry || '').toUpperCase();
  if (o === 'CA' && d === 'CA') return 'domestic_ca';
  if (o === 'US' && d === 'US') return 'domestic_us';
  if (NORTH_AMERICA_TRADE_ZONE.includes(o) && NORTH_AMERICA_TRADE_ZONE.includes(d)) return 'cross_border';
  return 'international';
}

module.exports = { detectScope, detectLane };
