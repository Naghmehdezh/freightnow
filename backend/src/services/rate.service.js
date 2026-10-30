const mongoose = require('mongoose');
const { getCarriersForShipment, supportsShipment, getCarrier } = require('../carriers');
const { unavailableOptions, unavailableMessage, labelFor, OptionUnavailableError } = require('../carriers/accessorials');
const { priceQuote, freightClass } = require('./pricingEngine.service');
const { getActiveRuleSet } = require('./pricingRules.service');
const fedexValidationMode = require('./fedexValidationMode');
const { detectScope } = require('../utils/shipmentScope');
const Quote = require('../models/Quote');
const QuoteRate = require('../models/QuoteRate');
const { generateQuoteNumber } = require('../utils/trackingGenerator');
const { endOfDay } = require('../utils/dateHelpers');
const { normalizeLineItems } = require('../utils/lineItems');

// envelope/parcel -> courier mode (per-piece dim-weight); ltl -> ltl mode (scale weight,
// density drives freight class). FTL/air/ocean are a separate staff-priced spot-rate flow and
// never reach this function.
const SHIPMENT_TYPE_TO_MODE = {
  envelope: { mode: 'courier', packaging: 'Envelope' },
  parcel: { mode: 'courier', packaging: 'Package' },
  ltl: { mode: 'ltl', packaging: 'Skid' },
};

// Builds the pricing engine's inputs from a rate request. `weight` is the TOTAL shipment
// weight, but the engine needs PER-PIECE weight for its dim-weight math — dividing here
// reconstructs the correct per-piece figure without changing what "weight" means anywhere
// else Quote/Shipment/Booking already consume it (as a total). This treats all pieces as
// identical, since freightnow's quote form collects one L/W/H triple rather than a true
// per-piece manifest — a pre-existing input-shape limit, not something this introduces.
function buildPricingInputs(params, ruleSet) {
  const { mode, packaging } = SHIPMENT_TYPE_TO_MODE[params.shipmentType] || SHIPMENT_TYPE_TO_MODE.ltl;
  const scope = detectScope(params.origin.country, params.destination.country);
  const pieces = params.pieces || 1;
  // LTL: one engine line per group of identical pieces (weight per piece).
  const lines = params.lineItems?.length
    ? params.lineItems.map(i => ({ qty: i.pieces, l: i.length, w: i.width, h: i.height, wt: i.weight }))
    : [{
      qty: pieces,
      l: params.dimensions?.length || 0,
      w: params.dimensions?.width || 0,
      h: params.dimensions?.height || 0,
      wt: params.weight / pieces,
    }];
  return { cost: null, scope, mode, packaging, lines, currency: params.currency || 'CAD', ruleSet };
}

// Each rate is priced and shown in the currency the carrier quoted it in — no conversion of the
// price. Adapters report their currency (FedEx, XPO); those that don't are CAD carriers.
// The engine still bands a USD cost on its CAD equivalent internally (bands/floors are defined
// in CAD), but the sell price it returns is in the carrier's currency.
function carrierCurrency(r) {
  if (r.currency && !['CAD', 'USD'].includes(r.currency)) {
    console.warn(`[RATE] ${r.carrierId} quoted in unsupported currency ${r.currency}; treating as CAD`);
  }
  return r.currency === 'USD' ? 'USD' : 'CAD';
}

function priceRate(rate, currency, inputs) {
  const { ruleSet, ...engineInput } = inputs;
  return priceQuote({ ...engineInput, cost: rate, currency }, ruleSet);
}

// Markup applies to the freight only: the carrier's accessorial charges (r.accessorialCharges,
// in the rate's currency) are passed through at cost on top of the marked-up freight.
function priceWithAccessorials(r, currency, inputs) {
  const accTotal = Math.round((r.accessorialCharges || []).reduce((sum, c) => sum + (c.amount || 0), 0) * 100) / 100;
  const freight = accTotal > 0 && r.rate - accTotal > 0 ? r.rate - accTotal : r.rate;
  const passThrough = freight === r.rate ? 0 : accTotal;
  const priced = priceRate(freight, currency, inputs);
  if (!passThrough) return priced;
  const fx = currency === 'USD' ? priced.fxRate : 1;
  const sell = Math.round((priced.sell + passThrough) * 100) / 100;
  return {
    ...priced,
    sell,
    cost: r.rate,
    costCad: Math.round(r.rate * fx * 100) / 100,
    sellCad: Math.round((priced.sellCad + passThrough * fx) * 100) / 100,
    grossMargin: Math.round((sell - r.rate) * 100) / 100,
    markupPct: Math.round(((sell / r.rate - 1) * 100) * 10) / 10,
    accessorialTotal: passThrough,
  };
}

// LTL freight class from density (lb per cubic foot) — same NMFC density table the pricing
// engine uses. Weight is the shipment total; dimensions are per piece.
function estimateFreightClass({ weight, pieces, dimensions }) {
  const { length: l, width: w, height: h } = dimensions || {};
  if (!(weight > 0 && l > 0 && w > 0 && h > 0)) return null;
  const cubicFeet = (l * w * h * (pieces || 1)) / 1728;
  return String(freightClass(weight / cubicFeet));
}

async function getAllRates(params, userId) {
  // LTL: line items (groups of pieces) with a freight class each; sets the shipment totals.
  if (params.shipmentType === 'ltl') normalizeLineItems(params);
  const [coverage, ruleSet] = await Promise.all([getCarriersForShipment(params), getActiveRuleSet()]);
  const inputs = buildPricingInputs(params, ruleSet);

  // Every carrier is quoted. Options a carrier can't provide are left out of its request, and its
  // rates say so (notIncluded) — the customer can still book them.
  const requested = params.accessorials || [];
  const carriers = coverage.filter(c => c.canQuote(params));
  const results = await Promise.allSettled(carriers.map(async (carrier) => {
    const missing = unavailableOptions(carrier.id, requested, params);
    let excluded = missing.map(m => m.option);
    const notes = missing.length ? [unavailableMessage(missing)] : [];
    let attempt = { ...params, accessorials: requested.filter(a => !excluded.includes(a)) };
    let rates;
    try {
      rates = await carrier.getRates(attempt);
    } catch (err) {
      if (!(err instanceof OptionUnavailableError)) throw err;
      // Found only at quote time (e.g. FedEx Home Delivery® outside the US): quote once more
      // without those options (all of them when the carrier couldn't say which).
      const drop = err.options?.length ? err.options : attempt.accessorials;
      excluded = [...excluded, ...drop];
      notes.push(err.message);
      attempt = { ...attempt, accessorials: attempt.accessorials.filter(a => !drop.includes(a)) };
      rates = await carrier.getRates(attempt);
    }
    const notIncluded = excluded.length
      ? { options: [...new Set(excluded)], labels: [...new Set(excluded)].map(o => labelFor(o, params.shipmentType)), message: notes.join(' ') }
      : null;
    return rates.map(r => ({ carrierId: carrier.id, carrierName: carrier.name, ...r, ...(notIncluded && { notIncluded }) }));
  }));

  const allRates = [];
  const unavailable = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') allRates.push(...result.value);
    else if (result.reason instanceof OptionUnavailableError) {
      unavailable.push({ carrierId: carriers[i].id, carrierName: carriers[i].name, message: result.reason.message });
    }
  });

  // Price each rate through the engine and sort
  const processedRates = allRates.map((r) => {
    const currency = carrierCurrency(r);
    const priced = priceWithAccessorials(r, currency, inputs);
    // TEMPORARY (FedEx validation screenshots): show FedEx's exact rate, no markup.
    if (r.carrierId === 'fedex' && fedexValidationMode.isOn()) {
      const fx = inputs.ruleSet.usdToCadRate || 1.40;
      Object.assign(priced, { sell: r.rate, markupPct: 0, grossMargin: 0, sellCad: currency === 'USD' ? r.rate * fx : r.rate });
    }
    return { ...r, currency, baseRate: r.rate, displayRate: priced.sell, pricingResult: priced };
  });
  // Rates can be in different currencies, so "cheapest" is decided on the engine's CAD
  // equivalent of the sell price — ordering only; every displayed price stays in its own currency.
  // Rates that include every selected option come first, so "best rate" is never one missing a
  // requested service.
  processedRates.sort((a, b) => (!!a.notIncluded - !!b.notIncluded) || (a.pricingResult.sellCad - b.pricingResult.sellCad));

  // Mark best rate
  if (processedRates.length > 0 && !processedRates[0].notIncluded) {
    processedRates[0].isBestRate = true;
  }

  // Save as quote if user is authenticated
  let quoteId = null;
  let quoteNumber = null;
  let expiresAt = null;

  if (userId) {
    quoteNumber = await generateQuoteNumber();
    expiresAt = endOfDay(new Date());

    const session = await mongoose.startSession();
    try {
      let createdQuote;
      await session.withTransaction(async () => {
        [createdQuote] = await Quote.create([{
          quoteNumber,
          user: userId,
          shipmentType: params.shipmentType,
          originCity: params.origin.city,
          originProvince: params.origin.province || '',
          originPostal: params.origin.postalCode || '',
          originCountry: params.origin.country,
          destCity: params.destination.city,
          destProvince: params.destination.province || '',
          destPostal: params.destination.postalCode || '',
          destCountry: params.destination.country,
          weight: params.weight,
          pieces: params.pieces || 1,
          dimL: params.dimensions?.length,
          dimW: params.dimensions?.width,
          dimH: params.dimensions?.height,
          lineItems: params.lineItems,
          freightClass: params.freightClass,
          currency: params.currency || 'CAD',
          pickupDate: params.pickupDate,
          pickupReadyTime: params.pickupReadyTime,
          pickupCloseTime: params.pickupCloseTime,
          declaredValue: params.declaredValue,
          commodity: params.commodity,
          accessorials: params.accessorials ? JSON.stringify(params.accessorials) : null,
          options: {
            fedexPackaging: params.fedexPackaging,
            fedexOneRate: params.fedexOneRate,
            dgType: params.dgType,
            battery: params.battery,
            homeDeliveryDate: params.homeDeliveryDate,
            limitedAccessType: params.limitedAccessType,
          },
          expiresAt,
        }], { session });

        // Created individually (rather than one nested write) so each QuoteRate's id can be
        // captured and returned to the client — needed to book a specific rate via POST /api/bookings.
        const createdRates = await Promise.all(processedRates.map(r => QuoteRate.create([{
          quote: createdQuote._id,
          carrierId: r.carrierId,
          carrierName: r.carrierName,
          serviceName: r.serviceName,
          serviceCode: r.serviceCode || null,
          currency: r.currency,
          baseRate: r.baseRate,
          displayRate: r.displayRate,
          engineRate: r.displayRate,
          accessorialCharges: r.accessorialCharges || [],
          notIncludedOptions: r.notIncluded?.options || [],
          notIncludedMessage: r.notIncluded?.message,
          transitDays: r.transitDays,
          estimatedDelivery: r.deliveryDate,
          isLiveRate: r.isLive || false,
          isBestRate: r.isBestRate || false,
          rulesVersion: r.pricingResult.rulesVersion,
          markupPct: r.pricingResult.markupPct,
          grossMargin: r.pricingResult.grossMargin,
          costCad: r.pricingResult.costCad,
          sellCad: r.pricingResult.sellCad,
          fxRate: r.pricingResult.fxRate,
          chargeableWt: r.pricingResult.chargeableWt,
          densityPcf: r.pricingResult.densityPcf,
          estClass: r.pricingResult.estClass,
          dimGoverns: r.pricingResult.dimGoverns,
          flags: r.pricingResult.flags,
        }], { session }).then(([doc]) => doc)));

        processedRates.forEach((r, i) => { r.quoteRateId = createdRates[i].id; });
      });
      quoteId = createdQuote.id;
    } finally {
      session.endSession();
    }
  }

  return {
    quoteId,
    quoteNumber,
    expiresAt: expiresAt?.toISOString(),
    rates: processedRates.map(r => ({
      quoteId,
      quoteRateId: r.quoteRateId || null,
      carrierId: r.carrierId,
      carrierName: r.carrierName,
      serviceName: r.serviceName,
      displayRate: r.displayRate,
      currency: r.currency,
      transitDays: r.transitDays,
      estimatedDelivery: r.deliveryDate,
      isLiveRate: r.isLive || false,
      isBestRate: r.isBestRate || false,
      flags: r.pricingResult.flags,
      // Selected options this carrier couldn't include in its price (the rate is still bookable).
      notIncluded: r.notIncluded || null,
    })),
    unavailable,
  };
}

async function getSingleCarrierRate(carrierId, params) {
  const carrier = await getCarrier(carrierId);
  if (!carrier) return null;
  if (!(await supportsShipment(carrierId, params))) return [];

  const ruleSet = await getActiveRuleSet();
  const inputs = buildPricingInputs(params, ruleSet);

  try {
    const rates = await carrier.getRates(params);
    return rates.map((r) => {
      const currency = carrierCurrency(r);
      const priced = priceRate(r.rate, currency, inputs);
      return {
        rate: priced.sell,
        currency,
        serviceName: r.serviceName,
        transitDays: r.transitDays,
        deliveryDate: r.deliveryDate,
        flags: priced.flags,
      };
    });
  } catch (err) {
    console.error(`[RATE] ${carrierId} failed:`, err.message);
    return [];
  }
}

module.exports = { getAllRates, getSingleCarrierRate, estimateFreightClass };
