const { freightClass } = require('../services/pricingEngine.service');

// LTL shipments are described as line items: groups of identical pieces, each with its own
// dimensions (in), weight per piece (lb) and freight class. A quote sent with one set of
// dimensions becomes a single line item, so every carrier adapter works from the same list.

function round1(n) { return Math.round(n * 10) / 10; }

// Freight class from the group's density (lb per cubic foot) — same NMFC table as the engine.
function classFor(item) {
  const cubicFt = (item.length * item.width * item.height) / 1728;
  return cubicFt > 0 && item.weight > 0 ? String(freightClass(item.weight / cubicFt)) : null;
}

// Fills params.lineItems (always, for LTL) and the shipment totals derived from it:
// weight (total lb), pieces, dimensions (of the first group) and freightClass (of the
// heaviest group — for carriers that take a single class).
function normalizeLineItems(params) {
  let items = (params.lineItems || [])
    .map(i => ({
      pieces: Math.max(1, parseInt(i.pieces) || 1),
      length: Number(i.length), width: Number(i.width), height: Number(i.height),
      weight: Number(i.weight), // per piece
      freightClass: i.freightClass ? String(i.freightClass) : null,
    }))
    .filter(i => i.length > 0 && i.width > 0 && i.height > 0 && i.weight > 0);

  if (!items.length && params.dimensions?.length && params.dimensions?.width && params.dimensions?.height && params.weight > 0) {
    const pieces = params.pieces || 1;
    items = [{
      pieces,
      length: params.dimensions.length, width: params.dimensions.width, height: params.dimensions.height,
      weight: params.weight / pieces,
      freightClass: params.freightClass ? String(params.freightClass) : null,
    }];
  }
  if (!items.length) return params;

  items = items.map(i => ({ ...i, freightClass: i.freightClass || classFor(i) || '70' }));
  const heaviest = [...items].sort((a, b) => b.weight * b.pieces - a.weight * a.pieces)[0];

  params.lineItems = items;
  params.weight = round1(items.reduce((s, i) => s + i.weight * i.pieces, 0));
  params.pieces = items.reduce((s, i) => s + i.pieces, 0);
  params.dimensions = { length: items[0].length, width: items[0].width, height: items[0].height };
  params.freightClass = heaviest.freightClass;
  return params;
}

// One entry per physical piece (for carriers that want each skid separately), up to `max`.
function expandUnits(items, max = Infinity) {
  const units = [];
  for (const i of items || []) {
    for (let n = 0; n < i.pieces && units.length < max; n++) {
      units.push({ length: i.length, width: i.width, height: i.height, weight: i.weight, freightClass: i.freightClass });
    }
  }
  return units;
}

module.exports = { normalizeLineItems, expandUnits, classFor };
