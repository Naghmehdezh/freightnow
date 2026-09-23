const { ValidationError } = require('../utils/errors');

// Ported from the standalone "Pricing Engine" reference (Postgres/Supabase `price_quote()` —
// see Pricing Engine/files/iff-pricing-schema.sql and migration-7b-lcl-currency.sql for the
// original). Pure calculation, no DB access: the caller fetches the active rule set once and
// passes it in, so this stays unit-testable and a single Mongo read serves an entire
// multi-carrier rate request instead of one query per carrier.
//
// Chargeable weight differs by mode:
//  - courier: per-piece greater-of(actual, volumetric), summed across pieces. Splitting one
//    bulky box into two often helps; splitting a heavy one does not.
//  - ltl: the scale weight. There is no volumetric substitution — density drives the NMFC
//    freight class instead, which is what actually moves the rate.
//  - lcl: W/M — the greater of cubic metres and metric tonnes (the ocean equivalent of dim
//    weight). Supported here even though no current freightnow shipment type invokes it yet
//    (LTL/air/ocean spot-rate requests are staff-priced, not part of this automated path) —
//    the engine is written generally enough to power that flow later with no changes here.

const FREIGHT_CLASS_TABLE = [
  [50, 50], [35, 55], [30, 60], [22.5, 65], [15, 70], [13.5, 77.5], [12, 85], [10.5, 92.5],
  [9, 100], [8, 110], [7, 125], [6, 150], [5, 175], [4, 200], [3, 250], [2, 300], [1, 400],
];

function freightClass(pcf) {
  for (const [min, cls] of FREIGHT_CLASS_TABLE) {
    if (pcf >= min) return cls;
  }
  return 500;
}

function priceQuote({ cost, scope, mode, packaging, lines, currency = 'CAD', fx = null }, ruleSet) {
  if (cost == null || cost <= 0) {
    throw new ValidationError('carrier cost is required');
  }
  if (currency !== 'CAD' && currency !== 'USD') {
    throw new ValidationError('currency must be CAD or USD');
  }
  if (!ruleSet) {
    throw new ValidationError('no active pricing rules');
  }
  if (mode === 'lcl') {
    if (packaging !== 'LCL') throw new ValidationError('LCL shipments use LCL packaging');
  } else if ((mode === 'ltl') !== (packaging === 'Skid')) {
    throw new ValidationError(`packaging ${packaging} is not valid for mode ${mode}`);
  }

  const fxRate = fx ?? ruleSet.usdToCadRate ?? 1.40;
  const costCad = currency === 'USD' ? cost * fxRate : cost;

  let pieces = 0;
  let actual = 0;   // total actual weight, lb
  let cube = 0;     // total cube, ft3
  let chargeable = 0;
  let anyDim = false;

  for (const line of lines) {
    const qty = Math.max(1, line.qty || 1);
    const l = line.l || 0, w = line.w || 0, h = line.h || 0, wt = line.wt || 0;
    const cuin = (l > 0 && w > 0 && h > 0) ? l * w * h : 0;
    const dimWt = cuin > 0 ? cuin / ruleSet.dim_divisor : 0;

    pieces += qty;
    actual += wt * qty;
    cube += (cuin / 1728.0) * qty;

    if (mode === 'courier') {
      chargeable += Math.max(wt, dimWt) * qty;
      if (dimWt > wt) anyDim = true;
    }
  }

  const cbm = cube / 35.3147;
  const tonnes = actual / 2204.62;
  const density = cube > 0 ? actual / cube : null;

  let cls = null;
  let wmBasis = null;
  if (mode === 'ltl') {
    // Scale weight only — no volumetric substitution. Density drives the class instead.
    chargeable = actual;
    cls = density != null ? freightClass(density) : null;
  } else if (mode === 'lcl') {
    const wm = Math.max(cbm, tonnes);
    wmBasis = tonnes > cbm ? 'weight' : 'measure';
    chargeable = Math.round(wm * 1000) / 1000;
  }

  // Band lookup: first band (ascending by max) whose ceiling covers the cost; else the highest band.
  let baseMk = ruleSet.bands.find(b => costCad <= b.max)?.mk;
  if (baseMk == null) baseMk = ruleSet.bands[ruleSet.bands.length - 1].mk;

  let adj = 0;
  if (mode === 'lcl') {
    // LCL is international by definition and its cost already reflects volume, so the
    // density/multi-piece adjusters (which exist to catch things a flat rate would miss) don't apply.
    adj += ruleSet.adjusters.intl;
  } else {
    if (scope === 'xb') adj += ruleSet.adjusters.xb;
    if (scope === 'intl') adj += ruleSet.adjusters.intl;
    if (density != null && density < 6) adj += ruleSet.adjusters.low_density;
    if (pieces >= 4) adj += ruleSet.adjusters.multi;
  }

  let sellCad = costCad * (1 + (baseMk + adj) / 100.0);

  const floorAmt = Math.max(ruleSet.floors[packaging] || 0, costCad + ruleSet.floors.min_gp);
  let floored = false;
  if (sellCad < floorAmt) { sellCad = floorAmt; floored = true; }

  let sell = currency === 'USD' ? sellCad / fxRate : sellCad;
  const round = ruleSet.floors.round || 1;
  // The epsilon nudge guards against binary-floating-point edge cases if `round` is ever set
  // to a non-integer value (e.g. 0.1) — harmless when round is an integer, as seeded today.
  sell = Math.ceil(sell / round - 1e-9) * round;

  const flags = [];
  if (cube === 0) {
    flags.push('No dimensions entered — density, class and dim weight cannot be checked.');
  }
  if (anyDim) {
    flags.push('Dim weight governs. The carrier bills on volume, not scale weight.');
  }
  if (mode !== 'lcl' && density != null && density < 6) {
    flags.push(`Density ${density.toFixed(1)} pcf — light and bulky. Reclass risk is real.`);
  }
  if (mode === 'ltl' && cube > 350 && density != null && density < 6) {
    flags.push(`Large and light: ${Math.round(cube)} ft3 at ${density.toFixed(1)} pcf. Many carriers apply a cubic capacity rule around this point, which reprices the shipment. Confirm against your carrier tariff.`);
  }
  if (mode === 'ltl' && cube > 750) {
    flags.push(`Shipment occupies ${Math.round(cube)} ft3. Carrier cubic capacity rules commonly start near 750 ft3 - verify before quoting.`);
  }
  if (mode === 'ltl' && density != null && freightClass(density * 0.9) !== freightClass(density * 1.1)) {
    flags.push(`Density sits near a class boundary — a 10% measurement error moves this between class ${freightClass(density * 1.1)} and ${freightClass(density * 0.9)}.`);
  }
  if (pieces >= 4 && mode !== 'lcl') {
    flags.push(`Multi-piece — confirm the carrier quoted all ${pieces} pieces.`);
  }
  if (floored) {
    flags.push('Floored. Band markup landed below the minimum, so the floor set the price.');
  }
  if (mode === 'lcl') {
    flags.push(`W/M basis: ${wmBasis}. ${cbm.toFixed(3)} CBM against ${tonnes.toFixed(3)} tonnes, so the carrier bills ${chargeable.toFixed(3)} revenue tons.`);
    if (Math.max(cbm, tonnes) < 1) flags.push('Under 1 CBM. Most consolidators apply a 1 CBM minimum - check the cost covers it.');
    if (tonnes > cbm) flags.push('Weight governs rather than volume. Dense cargo - confirm the rate basis on the booking.');
    flags.push('Ocean LCL - destination charges, THC and customs quote as separate lines.');
  } else if (scope === 'intl') {
    flags.push('International — duties, taxes and destination charges quote as separate lines.');
  } else if (scope === 'xb') {
    flags.push('Cross-border — customs entry and disbursement quote as separate lines.');
  }
  if (currency === 'USD') {
    flags.push(`Priced in USD at ${fxRate}. Margin bands were applied on the CAD equivalent of $${costCad.toFixed(2)}.`);
  }

  return {
    sell,
    cost,
    currency,
    fxRate,
    costCad: Math.round(costCad * 100) / 100,
    sellCad: Math.round(sellCad * 100) / 100,
    grossMargin: Math.round((sell - cost) * 100) / 100,
    markupPct: Math.round(((sell / cost - 1) * 100) * 10) / 10,
    pieces,
    actualWt: Math.round(actual * 10) / 10,
    chargeableWt: mode === 'lcl' ? chargeable : Math.round(chargeable * 10) / 10,
    cubeFt3: Math.round(cube * 100) / 100,
    cbm: Math.round(cbm * 1000) / 1000,
    tonnes: Math.round(tonnes * 1000) / 1000,
    wmBasis,
    densityPcf: density != null ? Math.round(density * 10) / 10 : null,
    estClass: cls,
    dimGoverns: anyDim,
    rulesVersion: ruleSet.version,
    flags,
  };
}

module.exports = { priceQuote, freightClass };
