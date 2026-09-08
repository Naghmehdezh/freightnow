const mongoose = require('mongoose');
const { getAllCarriers, getCarrier } = require('../carriers');
const { applyMarkup } = require('./markup.service');
const Quote = require('../models/Quote');
const QuoteRate = require('../models/QuoteRate');
const { generateQuoteNumber } = require('../utils/trackingGenerator');
const { endOfDay } = require('../utils/dateHelpers');

async function getAllRates(params, userId) {
  const carriers = await getAllCarriers();

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

  // Apply markup and sort
  const processedRates = await Promise.all(allRates.map(async (r) => ({
    ...r,
    baseRate: r.rate,
    displayRate: await applyMarkup(r.rate),
  })));
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
    })),
  };
}

async function getSingleCarrierRate(carrierId, params) {
  const carrier = await getCarrier(carrierId);
  if (!carrier) return null;

  const rates = await carrier.getRates(params);
  return Promise.all(rates.map(async (r) => ({
    rate: await applyMarkup(r.rate),
    serviceName: r.serviceName,
    transitDays: r.transitDays,
    deliveryDate: r.deliveryDate,
  })));
}

module.exports = { getAllRates, getSingleCarrierRate };
