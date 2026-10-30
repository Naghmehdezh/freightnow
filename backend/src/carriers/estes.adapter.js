const CarrierAdapter = require('./CarrierAdapter');
const { SUPPORT, ESTES_LIMITED_ACCESS, titleCase } = require('./accessorials');
const { addBusinessDays, formatDate } = require('../utils/dateHelpers');
const estesApi = require('../services/estesApi.service');
const { pickupWindow } = require('../utils/pickupWindow');

// eBOL option codes (they differ from the rate API's codes, e.g. LFTD vs LGATE).
// Pickup appointments (APTP) aren't accepted on an Estes BOL.
const ESTES_BOL_CODES = {
  liftgate_pickup: 'LFTP', liftgate_delivery: 'LFTD',
  residential_pickup: 'REP', residential: 'RES',
  inside_pickup: 'IPU', inside_delivery: 'IDL',
  limited_access_pickup: 'LTDAP', limited_access_delivery: 'LTDAD',
  appointment: 'APTD', call_before_delivery: 'MNC',
  oversize: 'OVR', in_bond: 'INBD', do_not_stack: 'DSDD',
};
// App limited-access site types → the BOL's limitedAccessType values.
const ESTES_BOL_SITE_TYPES = {
  school: 'School', secured: 'Secure', farm: 'Farm', mini_storage: 'Storage',
  worship: 'Church', seaport: 'Port', fair: 'Fair', construction: 'Construction',
};
// IFF as the third party Estes bills (account from the MyEstes login; office from the website).
const IFF_ESTES_BILL_TO = {
  name: 'International Freight Forwarders',
  address1: '286 Attwell Drive, Unit 16',
  city: 'Toronto',
  stateProvince: 'ON',
  postalCode: 'M9W5B2',
  country: 'CAN',
  contact: { phone: '4167984151', name: 'IFF Cargo' },
};

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
        // IFF pays as the third party (its account isn't the shipper's); with payor 'Shipper'
        // Estes refuses every quote ("unable to complete the LTL portion of your quote online").
        payor: 'Third Party',
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
        // One handling unit per group of identical pieces (weight = the group's total).
        handlingUnits: (params.lineItems?.length ? params.lineItems : [{
          pieces: numUnits, weight: weight / numUnits, freightClass, length: dimL, width: dimW, height: dimH,
        }]).map(i => ({
          weight: Math.round(i.weight * i.pieces),
          count: i.pieces,
          type: 'PT', // 2-char code, PT = Pallet (the field is strictly 2 chars — 'PLT' is invalid)
          weightUnit: 'Pounds',
          length: Math.round(i.length),
          width: Math.round(i.width),
          height: Math.round(i.height),
          dimensionsUnit: 'Inches',
          lineItems: [{
            weight: Math.round(i.weight * i.pieces),
            classification: i.freightClass ? String(i.freightClass) : '70',
          }],
        })),
      },
      accessorials: {
        codes: this._mapAccessorials(accessorials, params),
      },
    };

    const data = await estesApi.rateQuote(body);
    return this._parseRateResponse(data, pickupDate, body.accessorials.codes);
  }

  // App options → Estes accessorial codes (each confirmed against Estes's rate quote API).
  _mapAccessorials(accessorials, params = {}) {
    const codes = [];
    const add = c => { if (c && !codes.includes(c)) codes.push(c); };
    for (const option of accessorials) {
      if (option.startsWith('limited_access')) {
        // Estes charges limited access by type of site.
        const site = ESTES_LIMITED_ACCESS[params.limitedAccessType];
        if (site) add(option === 'limited_access_pickup' ? site.pickup : site.delivery);
      } else if (option === 'oversize') {
        // Nothing to send: Estes applies its overlength charge (LONG16, LONG20, …) itself from
        // the handling unit's length.
      } else {
        const code = SUPPORT.estes[option];
        if (/^[A-Z]+$/.test(code || '')) add(code);
      }
    }
    return codes;
  }

  _parseRateResponse(data, pickupDate, sentCodes = []) {
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

      // totalCharges already includes the requested accessorials; list their charges. Estes
      // adds HDSIG (residential appointment/signature) itself whenever HD is requested.
      const related = sentCodes.includes('HD') ? [...sentCodes, 'HDSIG'] : sentCodes;
      // Overlength (LONG…) is applied by Estes from the dimensions, so it's always listed.
      const accessorialCharges = (q.quoteRate?.ratedAccessorials || [])
        .filter(a => (related.includes(a.code) || /^LONG\d+$/.test(a.code)) && parseFloat(a.charge) > 0)
        .map(a => ({ code: a.code, label: titleCase(a.description || a.code), amount: parseFloat(a.charge) }));

      return {
        serviceName: q.serviceLevelText || 'Estes LTL',
        serviceCode: q.quoteId || null,
        rate: Math.round(totalCharge * 100) / 100,
        accessorialCharges,
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

  // eBOL (POST /v1/bol, Digital LTL Council BOL standard v2.0.1). Note: the BOL's
  // requestedPickupDate "does not serve as a Pickup Request" — the truck is ordered separately.
  async _liveBookShipment(details) {
    const body = this._buildBol(details);
    const data = await estesApi.createBol(body);
    const record = data?.data || data;
    const proNumber = record?.referenceNumbers?.pro || record?.pro || record?.proNumber;
    if (!proNumber) {
      throw new Error(record?.messageStatus?.message || record?.message || 'Estes BOL creation returned no PRO number');
    }

    const images = record?.images || record;
    const pdf = images?.bol || images?.bolDocument || images?.shippingLabels;
    const label = typeof pdf === 'string' && pdf.length > 100
      ? { encodedLabel: pdf, url: null, docType: 'PDF', contentType: 'application/pdf' }
      : null;

    // The BOL doesn't order the truck: request the pickup separately, in the customer's window.
    const pickup = details.requestPickup ? await this._requestPickup(details, proNumber) : undefined;

    return {
      carrierTrackingNumber: proNumber,
      confirmationNumber: pickup?.confirmationNumber || proNumber,
      status: 'confirmed',
      label,
      serviceType: 'LTL',
      ...(pickup && { pickup }),
      rawResponse: data,
    };
  }

  // POST /v1/pickup-requests. Values confirmed on Estes UAT: requestAction LL (live load),
  // paymentTerms PPD, whoRequested 3 (third party = IFF, account on the shipper block),
  // times as HHMM. A failed request doesn't undo the BOL.
  async _requestPickup(details, proNumber) {
    const addr = details.shipper?.address || {};
    const contact = details.shipper?.contact || {};
    const { ready, close } = pickupWindow(details);
    const phone = String(contact.phoneNumber || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').slice(0, 10);
    const [firstName, ...rest] = String(contact.personName || 'Shipping').trim().split(/\s+/);
    const lines = details.lineItems?.length ? details.lineItems : [{ pieces: details.totalPackageCount || 1, weight: (details.weight?.value || 1) / (details.totalPackageCount || 1) }];
    const units = lines.reduce((n, l) => n + l.pieces, 0);
    const body = {
      requestAction: 'LL',
      paymentTerms: 'PPD',
      whoRequested: '3',
      pickupDate: details.shipDatestamp || new Date().toISOString().split('T')[0],
      pickupStartTime: ready.replace(':', ''),
      pickupEndTime: close.replace(':', ''),
      totalPieces: String(units),
      totalWeight: String(Math.round(lines.reduce((n, l) => n + l.weight * l.pieces, 0))),
      totalHandlingUnits: String(units),
      hazmatFlag: 'N',
      shipper: {
        shipperName: (contact.companyName || contact.personName || 'Shipper').substring(0, 50),
        accountCode: process.env.ESTES_ACCOUNT_NUMBER || 'B229230',
        shipperAddress: {
          addressInfo: {
            addressLine1: (addr.streetLines || [])[0] || 'N/A',
            ...((addr.streetLines || [])[1] && { addressLine2: addr.streetLines[1] }),
            city: addr.city || '',
            stateProvince: addr.stateOrProvinceCode || '',
            postalCode: String(addr.postalCode || '').replace(/\s+/g, '').toUpperCase(),
            countryAbbrev: String(addr.countryCode || 'CA').toUpperCase(),
          },
        },
        shipperContacts: {
          shipperContact: [{
            contactInfo: {
              name: { firstName, lastName: rest.join(' ') || firstName },
              email: contact.emailAddress || 'shipping@iffcargo.com',
              phone: { areaCode: Number(phone.slice(0, 3)) || 416, number: Number(phone.slice(3)) || 7984151 },
              receiveNotifications: 'N',
              notificationMethod: 'E',
            },
          }],
        },
      },
      referenceNumbers: {
        referenceNumber: [{ referenceInfo: { type: 'PRO', value: String(proNumber).replace(/\D/g, ''), required: 'N', totalPieces: 0, totalWeight: 0 } }],
      },
    };
    try {
      const res = await estesApi.createPickup(body);
      const number = res?.data?.requestNumber;
      if (!number) throw new Error(res?.error?.message || 'no pickup request number returned');
      console.log(`[ESTES-PICKUP] ${number} for PRO ${proNumber}`);
      return { scheduled: true, confirmationNumber: String(number) };
    } catch (err) {
      const reason = err.body?.error?.validationFailures?.map(f => f.description).join('; ') || err.message;
      console.error('[ESTES-PICKUP] Pickup request failed:', reason);
      return { scheduled: false, message: `Estes couldn't schedule the pickup (${reason}). IFF will arrange it.` };
    }
  }

  _buildBol(details) {
    const shipDate = details.shipDatestamp || new Date().toISOString().split('T')[0];
    const accessorials = details.accessorials || [];
    const lines = details.lineItems?.length ? details.lineItems : [{
      pieces: details.totalPackageCount || 1,
      length: details.dimensions?.length || 48, width: details.dimensions?.width || 40, height: details.dimensions?.height || 48,
      weight: (details.weight?.value || 1) / (details.totalPackageCount || 1),
      freightClass: details.freightClass,
    }];
    const handlingUnits = lines.reduce((n, l) => n + l.pieces, 0);
    const description = (details.commodity || 'General freight').substring(0, 35);

    const codes = [];
    for (const option of accessorials) {
      const code = ESTES_BOL_CODES[option];
      if (code && !codes.includes(code)) codes.push(code);
    }
    const site = ESTES_BOL_SITE_TYPES[details.options?.limitedAccessType] || 'Other';

    return {
      version: 'v2.0.1',
      bol: {
        function: 'Create',
        isTest: process.env.ESTES_ENVIRONMENT !== 'production',
        requestorRole: 'Third Party', // IFF books on behalf of the shipper and pays the freight
        requestedPickupDate: `${shipDate}T00:00:00.000Z`,
        ...(accessorials.includes('oversize') && { specialInstructions: 'Over-length freight' }),
      },
      images: {
        includeBol: true,
        includeShippingLabels: true,
        shippingLabels: { format: 'Letter', quantity: Math.min(Math.max(handlingUnits, 1), 100) },
      },
      ...(details.customerReference && {
        referenceNumbers: { additionalReferences: [{ name: 'IFF reference', value: String(details.customerReference).substring(0, 25) }] },
      }),
      payment: { terms: 'Third Party' },
      origin: this._bolParty(details.shipper),
      destination: this._bolParty(details.recipient),
      billTo: {
        account: process.env.ESTES_ACCOUNT_NUMBER || 'B229230',
        ...IFF_ESTES_BILL_TO,
      },
      commodities: {
        lineItemLayout: 'Nested',
        handlingUnits: lines.map(l => ({
          count: l.pieces,
          type: 'PAT',
          weight: Math.round(l.weight * l.pieces),
          weightUnit: 'Pounds',
          length: Math.round(l.length),
          width: Math.round(l.width),
          height: Math.round(l.height),
          dimensionsUnit: 'Inches',
          stackable: !accessorials.includes('do_not_stack'),
          lineItems: [{
            description,
            weight: Math.round(l.weight * l.pieces),
            weightUnit: 'Pounds',
            pieces: l.pieces,
            packagingType: 'PCS',
            classification: l.freightClass ? String(l.freightClass) : '70',
            hazardous: false, // dangerous goods LTL bookings are completed by IFF staff
          }],
        })),
      },
      shipmentTotals: {
        handlingUnits,
        grossWeight: Math.round(lines.reduce((n, l) => n + l.weight * l.pieces, 0)),
        weightUnit: 'Pounds',
      },
      ...(codes.length && {
        accessorials: {
          codes,
          ...((codes.includes('LTDAP') || codes.includes('LTDAD')) && {
            limitedAccessType: {
              ...(codes.includes('LTDAP') && { origin: site }),
              ...(codes.includes('LTDAD') && { destination: site }),
            },
          }),
        },
      }),
    };
  }

  // Shipper / consignee in the BOL's party shape (3-letter country, 10-digit phone).
  _bolParty(party = {}) {
    const addr = party.address || {};
    const contact = party.contact || {};
    const country = String(addr.countryCode || 'CA').toUpperCase();
    const lines = addr.streetLines || [];
    return {
      name: (contact.companyName || contact.personName || 'N/A').substring(0, 50),
      address1: (lines[0] || 'N/A').substring(0, 100),
      ...(lines[1] && { address2: lines[1].substring(0, 100) }),
      city: (addr.city || '').substring(0, 50),
      stateProvince: addr.stateOrProvinceCode || '',
      postalCode: String(addr.postalCode || '').replace(/\s+/g, '').toUpperCase(),
      country: { US: 'USA', MX: 'MEX' }[country] || 'CAN',
      contact: {
        phone: String(contact.phoneNumber || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').slice(0, 10),
        ...(contact.personName && { name: contact.personName.substring(0, 50) }),
        ...(contact.emailAddress && { email: contact.emailAddress }),
      },
    };
  }
}

module.exports = new EstesAdapter();
