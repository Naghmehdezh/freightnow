const CarrierAdapter = require('./CarrierAdapter');
const { addBusinessDays, formatDate } = require('../utils/dateHelpers');
const estesApi = require('../services/estesApi.service');

// Estes is LTL-only (freight carrier — no envelope/parcel service in their API catalog, per
// developer.estes-express.com's product list: RouteGuides, Reserve PRO, Rate Quote, BOL, Pickup,
// Shipment Tracking, Images, Subscription — all freight-shipment-oriented).
//
// isLive here depends on THREE credential layers, not the usual two: Client ID/Secret were used
// once, out of band (see scripts/estesApiKeySetup.js), to generate ESTES_API_KEY. That key alone
// isn't enough to call anything else — /authenticate additionally requires a MyEstes.com portal
// username/password, which this integration doesn't have yet. Until ESTES_MYESTES_USERNAME/
// ESTES_MYESTES_PASSWORD are set, this adapter correctly reports itself as not live.
class EstesAdapter extends CarrierAdapter {
  get id() { return 'estes'; }
  get name() { return 'Estes Express'; }
  get isLive() { return estesApi.isConfigured(); }

  // ─── getRates ─────────────────────────────────────────────────

  async getRates(params) {
    if (params.shipmentType !== 'ltl') return [];
    if (!this.isLive) return [];

    try {
      return await this._getLiveRates(params);
    } catch (err) {
      console.error('[ESTES-RATE] Live rates failed:', err.message);
      return [];
    }
  }

  async _getLiveRates(params) {
    const { origin, destination, weight, pieces, dimensions, freightClass, pickupDate, accessorials = [] } = params;

    const numUnits = pieces || 1;
    const dimL = (dimensions && dimensions.length) || 48;
    const dimW = (dimensions && dimensions.width) || 40;
    const dimH = (dimensions && dimensions.height) || 40;

    // Per the real OpenAPI schema (confirmed against the dev portal, not the rendered-page
    // reconstruction this was originally built from): payment/origin/destination/commodity/
    // accessorials are top-level siblings of quoteRequest, NOT nested inside it. That nesting
    // bug was the actual cause of every earlier "missing" validation error — the validator never
    // saw any of these fields at all, regardless of what was changed inside the wrong location.
    const body = {
      quoteRequest: {
        shipDate: pickupDate || new Date().toISOString().split('T')[0],
        serviceLevels: ['LTL'],
      },
      payment: {
        // The MyEstes login's own JWT carries this as "accountCode" — that's the account
        // this API key/login is actually provisioned under, confirmed via a live 401->200
        // auth test, distinct from any account number XPO/Estes onboarding emails mention.
        account: process.env.ESTES_ACCOUNT_NUMBER || 'B229230',
        payor: 'Shipper',
        terms: 'Prepaid',
      },
      origin: {
        address: {
          city: origin.city,
          stateProvince: origin.province,
          postalCode: origin.postalCode,
          country: origin.country,
        },
      },
      destination: {
        address: {
          city: destination.city,
          stateProvince: destination.province,
          postalCode: destination.postalCode,
          country: destination.country,
        },
      },
      commodity: {
        handlingUnits: [{
          weight,
          count: numUnits,
          type: 'PT', // 2-char code, PT = Pallet (the field is strictly 2 chars — 'PLT' is invalid)
          weightUnit: 'Pounds',
          length: Math.round(dimL),
          width: Math.round(dimW),
          height: Math.round(dimH),
          dimensionsUnit: 'Inches',
          lineItems: [{
            weight,
            classification: freightClass ? String(freightClass) : '70',
          }],
        }],
      },
      accessorials: {
        codes: this._mapAccessorials(accessorials),
      },
    };

    const data = await estesApi.rateQuote(body);
    return this._parseRateResponse(data, pickupDate);
  }

  // Only accessorials with a direct Estes equivalent are mapped — Estes's own accessorial code
  // list wasn't available from the public docs (behind the same MyEstes-gated pages), so this
  // starts conservative and empty rather than guessing codes that could silently misprice a
  // quote once live testing becomes possible.
  _mapAccessorials(accessorials) {
    return [];
  }

  _parseRateResponse(data, pickupDate) {
    const quotes = data?.data || [];
    if (quotes.length === 0) return [];

    const baseDate = pickupDate ? new Date(pickupDate + 'T12:00:00') : new Date();

    return quotes.map((q) => {
      if (q.rateFound === false) return null;
      const totalCharge = parseFloat(q.quoteRate?.totalCharges);
      if (!totalCharge) return null;

      const transitDays = q.transitDetails?.transitDays || 5;
      // Confirmed against a real response: dates.transitDeliveryDate is a real carrier-computed
      // date, more accurate than estimating from transitDays ourselves — prefer it when present.
      const deliveryDate = q.dates?.transitDeliveryDate || formatDate(addBusinessDays(baseDate, transitDays));

      return {
        serviceName: q.serviceLevelText || 'Estes LTL',
        serviceCode: q.quoteId || null,
        rate: Math.round(totalCharge * 100) / 100,
        // Estes's rate response carries no currency field; Estes Express Lines prices and
        // bills in USD (the account's "Customer Pricing" is a USD tariff).
        currency: 'USD',
        transitDays,
        deliveryDate,
        isLive: true,
        quoteReference: q.quoteId || null,
      };
    }).filter(Boolean);
  }

  // ─── getTracking ──────────────────────────────────────────────

  async getTracking(trackingNumber) {
    if (!this.isLive) throw new Error('Estes tracking is not available (no live credentials configured)');
    return this._liveGetTracking(trackingNumber);
  }

  async _liveGetTracking(trackingNumber) {
    const data = await estesApi.trackShipment(trackingNumber);
    const record = data?.data;
    if (!record) throw new Error('No Estes tracking record found');

    return {
      status: this._mapStatus(record.status || record.currentStatus),
      estimatedDelivery: record.estimatedDeliveryDate || null,
      actualDelivery: record.actualDeliveryDate || null,
      shipDate: record.shipDate || null,
      latestStatus: record.status || record.currentStatus || '',
      service: 'Estes LTL',
      weight: record.weight || null,
      pieces: record.pieces || null,
      events: (record.movementHistory || []).map(e => ({
        event: e.description || e.status || '',
        location: [e.city, e.stateProvince].filter(Boolean).join(', '),
        timestamp: e.dateTime || e.date || null,
        description: e.description || '',
      })),
      rawResponse: data,
    };
  }

  _mapStatus(status) {
    const s = (status || '').toUpperCase();
    if (s.includes('DELIVER')) return 'delivered';
    if (s.includes('TRANSIT') || s.includes('PICK') || s.includes('DISPATCH')) return 'in_transit';
    return 'pending';
  }

  // ─── bookShipment ─────────────────────────────────────────────

  async bookShipment(details) {
    if (!this.isLive) throw new Error('Estes booking is not available (no live credentials configured)');
    return this._liveBookShipment(details);
  }

  async _liveBookShipment(details) {
    const shipperAddr = details.shipper?.address || {};
    const shipperContact = details.shipper?.contact || {};
    const recipientAddr = details.recipient?.address || {};
    const recipientContact = details.recipient?.contact || {};

    const body = {
      bol: {
        requestedPickupDate: details.shipDatestamp || new Date().toISOString().split('T')[0],
        function: 'Create',
        isTest: process.env.ESTES_ENVIRONMENT !== 'production',
        requestorRole: 'Shipper',
        specialInstructions: details.commodity || 'General freight',
        includeBol: true,
        includeShippingLabels: true,
        shipper: {
          name: (shipperContact.companyName || shipperContact.personName || 'Shipper').substring(0, 40),
          address: {
            addressLine1: (shipperAddr.streetLines || [])[0] || 'N/A',
            city: shipperAddr.city || '',
            stateProvince: shipperAddr.stateOrProvinceCode || '',
            postalCode: shipperAddr.postalCode || '',
          },
          contact: shipperContact.personName || '',
          phone: shipperContact.phoneNumber || '',
        },
        consignee: {
          name: (recipientContact.companyName || recipientContact.personName || 'Consignee').substring(0, 40),
          address: {
            addressLine1: (recipientAddr.streetLines || [])[0] || 'N/A',
            city: recipientAddr.city || '',
            stateProvince: recipientAddr.stateOrProvinceCode || '',
            postalCode: recipientAddr.postalCode || '',
          },
          contact: recipientContact.personName || '',
          phone: recipientContact.phoneNumber || '',
        },
        commodity: {
          handlingUnits: [{
            weight: details.weight?.value || 0,
            count: details.totalPackageCount || 1,
            type: 'PLT',
            length: Math.round(details.dimensions?.length || 48),
            width: Math.round(details.dimensions?.width || 40),
            height: Math.round(details.dimensions?.height || 40),
            lineItems: [{
              classification: details.freightClass ? String(details.freightClass) : '70',
              description: details.commodity || 'General freight',
            }],
          }],
        },
      },
    };

    const data = await estesApi.createBol(body);
    const record = data?.data || data;
    const proNumber = record?.pro || record?.proNumber;
    if (!proNumber) {
      throw new Error(record?.message || 'Estes BOL creation returned no PRO number');
    }

    let label = null;
    if (record.bolDocument || record.shippingLabels) {
      label = {
        encodedLabel: record.shippingLabels?.[0] || record.bolDocument,
        url: null,
        docType: 'PDF',
        contentType: 'application/pdf',
      };
    }

    return {
      carrierTrackingNumber: proNumber,
      confirmationNumber: proNumber,
      status: 'confirmed',
      label,
      serviceType: 'LTL',
      rawResponse: data,
    };
  }
}

module.exports = new EstesAdapter();
