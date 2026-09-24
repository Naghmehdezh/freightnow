const mongoose = require('mongoose');
const { getAllCarriers, getCarrier } = require('../carriers');
const { priceQuote } = require('./pricingEngine.service');
const { getActiveRuleSet } = require('./pricingRules.service');
const { detectScope } = require('../utils/shipmentScope');
const Quote = require('../models/Quote');
const QuoteRate = require('../models/QuoteRate');
const { generateQuoteNumber } = require('../utils/trackingGenerator');
const { endOfDay } = require('../utils/dateHelpers');

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
  const lines = [{
    qty: pieces,
    l: params.dimensions?.length || 0,
    w: params.dimensions?.width || 0,
    h: params.dimensions?.height || 0,
    wt: params.weight / pieces,
  }];
  return { cost: null, scope, mode, packaging, lines, currency: params.currency || 'CAD', ruleSet };
}

function priceRate(rate, inputs) {
  const { ruleSet, ...engineInput } = inputs;
  return priceQuote({ ...engineInput, cost: rate }, ruleSet);
}

async function getAllRates(params, userId) {
  const [carriers, ruleSet] = await Promise.all([getAllCarriers(), getActiveRuleSet()]);
  const inputs = buildPricingInputs(params, ruleSet);

  const results = await Promise.allSettled(
    carriers.map(async (carrier) => {
      const rates = await carrier.getRates(params);
      return rates.map(r => ({
        carrierId: carrier.id,
        carrierName: carrier.name,
        ...r,
      }));
    })
  );

  // Collect successful results
  const allRates = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allRates.push(...result.value);
    }
  }

  // Price each rate through the engine and sort
  const processedRates = allRates.map((r) => {
    const priced = priceRate(r.rate, inputs);
    return { ...r, baseRate: r.rate, displayRate: priced.sell, pricingResult: priced };
  });
  processedRates.sort((a, b) => a.displayRate - b.displayRate);

  // Mark best rate
  if (processedRates.length > 0) {
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
          freightClass: params.freightClass,
          currency: params.currency || 'CAD',
          pickupDate: params.pickupDate,
          declaredValue: params.declaredValue,
          commodity: params.commodity,
          accessorials: params.accessorials ? JSON.stringify(params.accessorials) : null,
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
          baseRate: r.baseRate,
          displayRate: r.displayRate,
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
      baseRate: r.baseRate,
      displayRate: r.displayRate,
      transitDays: r.transitDays,
      estimatedDelivery: r.deliveryDate,
      isLiveRate: r.isLive || false,
      isBestRate: r.isBestRate || false,
      flags: r.pricingResult.flags,
    })),
  };
}

async function getSingleCarrierRate(carrierId, params) {
  const carrier = await getCarrier(carrierId);
  if (!carrier) return null;

  const ruleSet = await getActiveRuleSet();
  const inputs = buildPricingInputs(params, ruleSet);

  try {
    const rates = await carrier.getRates(params);
    return rates.map((r) => {
      const priced = priceRate(r.rate, inputs);
      return {
        rate: priced.sell,
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

module.exports = { getAllRates, getSingleCarrierRate };
