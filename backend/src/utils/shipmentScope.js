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

module.exports = { detectScope };
