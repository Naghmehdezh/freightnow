const CarrierAdapter = require('./CarrierAdapter');
const { addBusinessDays, formatDate } = require('../utils/dateHelpers');
const { getBaseUrl, getUserCredentials, httpsPost } = require('../services/dayrossApi.service');

// Day & Ross status descriptions → IFF status mapping
const STATUS_MAP = {
  'pickup completed': 'in_transit',
  'in transit': 'in_transit',
  'out for delivery': 'in_transit',
  'at terminal': 'in_transit',
  'on dock': 'in_transit',
  'loaded': 'in_transit',
  'departed': 'in_transit',
  'arrived': 'in_transit',
  'delivery completed': 'delivered',
  'delivered': 'delivered',
  'cancelled': 'cancelled',
};

class DayRossAdapter extends CarrierAdapter {
  get id() { return 'dayross'; }
  get name() { return 'Day & Ross'; }
  get isLive() { return !!process.env.DAYROSS_EMAIL; }

  // ─── getRates ─────────────────────────────────────────────────

  async getRates(params) {
    if (this.isLive) {
      try {
        return await this._getLiveRates(params);
      } catch (err) {
        console.error('[DAYROSS-RATE] Live rates failed, falling back to mock:', err.message);
        return this._getMockRates(params);
      }
    }
    return this._getMockRates(params);
  }

  async _getLiveRates(params) {
    const { origin, destination, weight, pieces, dimensions, pickupDate, freightClass, commodity, accessorials, shipmentType } = params;

    // Day & Ross live API only supports LTL — fall back to mock for envelope/parcel
    if (shipmentType === 'envelope' || shipmentType === 'parcel') {
      return this._getMockRates(params);
    }

    // Day & Ross requires pickupBy to be a future date — ensure at least next business day
    let shipDate = pickupDate || new Date().toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    if (shipDate <= today) {
      shipDate = formatDate(addBusinessDays(new Date(), 1));
    }
    const originCountry = (origin.country || 'CA').toUpperCase();
    const destCountry = (destination.country || 'CA').toUpperCase();
    const isCrossBorder = originCountry !== destCountry;

    // Determine service levels to request rates for
    const serviceLevels = isCrossBorder ? ['CBLTL'] : ['LTL'];

    // Build detail entries
    const numPieces = pieces || 1;
    const dimL = (dimensions && dimensions.length) || 48;
    const dimW = (dimensions && dimensions.width) || 48;
    const dimH = (dimensions && dimensions.height) || 48;
    const totalWeight = weight || 500;
    const perPieceWeight = Math.round(totalWeight / numPieces);

    const detailEntries = [];
    for (let i = 0; i < Math.min(numPieces, 20); i++) {
      const entry = {
        description: commodity || 'General merchandise',
        length: Math.round(dimL),
        lengthUnits: 'IN',
        width: Math.round(dimW),
        widthUnits: 'IN',
        height: Math.round(dimH),
        heightUnits: 'IN',
        weight: i === 0 ? Math.round(totalWeight - perPieceWeight * (numPieces - 1)) : perPieceWeight,
        weightUnits: 'LB',
        pieces: 1,
        piecesUnits: 'PC',
        pallets: 1,
        palletUnits: 'PLT',
        dangerousGoods: 'False',
      };

      // Cross-border: commodity (freight class code) is mandatory
      if (isCrossBorder && freightClass) {
        entry.commodity = `CLASS${freightClass}`;
      } else if (isCrossBorder) {
        entry.commodity = 'CLASS70'; // default
      }

      detailEntries.push(entry);
    }

    const creds = getUserCredentials();
    const body = {
      ...creds,
      serviceLevels,
      shipmentDetails: {
        billTo: 'C',
        serviceLevel: serviceLevels[0],
        pickUpBy: `${shipDate}T08:00:00`,
        pickUpByEnd: `${shipDate}T17:00:00`,
        shipper: {
          city: origin.city || '',
          postalCode: origin.postalCode || '',
          province: origin.province || this._provinceFromPostal(origin.postalCode, originCountry),
          country: originCountry,
        },
        consignee: {
          city: destination.city || '',
          postalCode: destination.postalCode || '',
          province: destination.province || this._provinceFromPostal(destination.postalCode, destCountry),
          country: destCountry,
        },
        caller: {
          name: 'IFF Cargo',
          phone: '416-798-4151',
          clientId: process.env.DAYROSS_ACCOUNT || '',
        },
        details: detailEntries,
      },
    };

    // Map accessorials
    if (accessorials && accessorials.length > 0) {
      const aCharges = this._mapAccessorials(accessorials);
      if (aCharges.length > 0) body.shipmentDetails.aCharges = aCharges;
    }

    const url = `${getBaseUrl()}/GetRate`;
    const raw = await httpsPost(url, JSON.stringify(body));
    return this._parseRateResponse(raw, shipDate);
  }

  _parseRateResponse(raw, shipDate) {
    // Day & Ross wraps responses: { GetRateResponse: [ {...} ] }
    const rateItems = raw.GetRateResponse || [raw];
    const items = Array.isArray(rateItems) ? rateItems : [rateItems];
    const rates = [];

    for (const item of items) {
      const charges = item.charges || 0;
      if (charges <= 0) continue; // charges=0 means unable to rate

      const transitDays = item.slmDaysSum || 5;
      const serviceLevel = item.serviceLevel || 'LTL';
      const serviceName = this._serviceLabel(serviceLevel);

      const baseDate = new Date(shipDate + 'T12:00:00');
      const deliveryDate = item.estimatedDeliveryDate
        ? item.estimatedDeliveryDate.split('T')[0]
        : formatDate(addBusinessDays(baseDate, transitDays));

      rates.push({
        serviceName,
        serviceCode: serviceLevel,
        rate: Math.round(charges * 100) / 100,
        transitDays,
        deliveryDate,
        isLive: true,
        totalCharges: item.totalCharges || charges,
        tax1: item.tax1 || 0,
        tax2: item.tax2 || 0,
      });
    }

    return rates;
  }

  _serviceLabel(code) {
    const map = {
      LTL: 'Day & Ross LTL',
      CBLTL: 'Day & Ross Cross-Border LTL',
      R1NS: 'Day & Ross Residential (1 person)',
      R1T: 'Day & Ross Residential Threshold',
      R2T: 'Day & Ross Residential 2-Person',
      R2R: 'Day & Ross Residential Room of Choice',
      R2D: 'Day & Ross Residential + Debris',
    };
    return map[code] || `Day & Ross ${code}`;
  }

  _getMockRates(params) {
    const { shipmentType, origin, destination, weight, freightClass, pickupDate, accessorials = [] } = params;
    const seed = this._makeSeed(this.id + (origin.postalCode || origin.city) + (destination.postalCode || destination.city) + shipmentType);
    const rng = this._seededRandom(seed);
    const rng2 = this._seededRandom2(seed);

    let base;
    if (shipmentType === 'envelope') base = 18 + rng * 35;
    else if (shipmentType === 'parcel') base = 22 + rng * 55 + (weight / 10) * (7 + rng2 * 6);
    else {
      const classMultiplier = this._getClassMultiplier(freightClass);
      base = (55 + rng * 85) * (weight / 100) * classMultiplier;
    }

    base = this._applyMockAccessorials(base, accessorials, rng2);

    const transitDays = shipmentType === 'envelope' ? Math.ceil(1 + rng2 * 2) : shipmentType === 'parcel' ? Math.ceil(1 + rng2 * 3) : Math.ceil(2 + rng2 * 4);
    const services = { envelope: ['Sameday Express', 'Next Day', 'Economy'], parcel: ['Ground Plus', 'Express', 'Standard'], ltl: ['Direct LTL', 'Intermodal', 'Standard LTL'] };
    const svcList = services[shipmentType] || services.ltl;
    const serviceName = svcList[Math.floor(rng * svcList.length)];
    const rate = Math.max(Math.round((base + (rng - 0.5) * 8) * 100) / 100, shipmentType === 'envelope' ? 12 : shipmentType === 'parcel' ? 15 : 110);

    const baseDate = pickupDate ? new Date(pickupDate + 'T12:00:00') : new Date();
    const deliveryDate = formatDate(addBusinessDays(baseDate, transitDays));

    return [{ serviceName, rate, transitDays, deliveryDate, isLive: false }];
  }

  // ─── bookShipment (CreateShipment) ────────────────────────────

  async bookShipment(details) {
    if (this.isLive) {
      try {
        return await this._liveBookShipment(details);
      } catch (err) {
        console.error('[DAYROSS-SHIP] Live booking failed, falling back to mock:', err.message);
        return this._mockBookShipment(err.message);
      }
    }
    return this._mockBookShipment();
  }

  async _liveBookShipment(details) {
    // Day & Ross requires pickupBy to be a future date
    let shipDate = details.shipDatestamp || new Date().toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    if (shipDate <= today) {
      shipDate = formatDate(addBusinessDays(new Date(), 1));
    }
    const originCountry = details.shipper?.address?.countryCode || 'CA';
    const destCountry = details.recipient?.address?.countryCode || 'CA';
    const isCrossBorder = originCountry !== destCountry;

    const shipperAddr = details.shipper?.address || {};
    const shipperContact = details.shipper?.contact || {};
    const recipientAddr = details.recipient?.address || {};
    const recipientContact = details.recipient?.contact || {};

    // Build detail entries
    const numPieces = details.totalPackageCount || 1;
    const totalWeight = details.weight?.value || 500;
    const perPieceWeight = Math.round(totalWeight / numPieces);
    const dimL = details.dimensions?.length || 48;
    const dimW = details.dimensions?.width || 48;
    const dimH = details.dimensions?.height || 48;

    const detailEntries = [];
    for (let i = 0; i < Math.min(numPieces, 20); i++) {
      const entry = {
        description: details.commodity || details.customerReference || 'General merchandise',
        length: Math.round(dimL),
        lengthUnits: 'IN',
        width: Math.round(dimW),
        widthUnits: 'IN',
        height: Math.round(dimH),
        heightUnits: 'IN',
        weight: i === 0 ? totalWeight - perPieceWeight * (numPieces - 1) : perPieceWeight,
        weightUnits: 'LB',
        pieces: 1,
        piecesUnits: 'PC',
        pallets: 1,
        palletUnits: 'PLT',
        dangerousGoods: 'False',
      };

      if (isCrossBorder) {
        entry.commodity = 'CLASS70'; // default freight class for cross-border
      }

      detailEntries.push(entry);
    }

    const creds = getUserCredentials();
    const serviceLevel = isCrossBorder ? 'CBLTL' : 'LTL';

    const body = {
      ...creds,
      shipmentDetails: {
        billTo: 'C',
        serviceLevel,
        pickUpBy: `${shipDate}T08:00:00`,
        pickUpByEnd: `${shipDate}T17:00:00`,
        shipper: {
          name: (shipperContact.companyName || shipperContact.personName || 'Shipper').substring(0, 40),
          address1: ((shipperAddr.streetLines || [])[0] || shipperAddr.city || 'N/A').substring(0, 40),
          city: shipperAddr.city || '',
          province: shipperAddr.stateOrProvinceCode || '',
          postalCode: shipperAddr.postalCode || '',
          country: originCountry,
          contact: (shipperContact.personName || 'Contact').substring(0, 34),
          phone: shipperContact.phoneNumber || '416-798-4151',
          email: shipperContact.email || 'shipping@iffcargo.com',
        },
        consignee: {
          name: (recipientContact.companyName || recipientContact.personName || 'Consignee').substring(0, 40),
          address1: ((recipientAddr.streetLines || [])[0] || recipientAddr.city || 'N/A').substring(0, 40),
          city: recipientAddr.city || '',
          province: recipientAddr.stateOrProvinceCode || '',
          postalCode: recipientAddr.postalCode || '',
          country: destCountry,
          contact: (recipientContact.personName || 'Contact').substring(0, 34),
          phone: recipientContact.phoneNumber || '416-798-4151',
          email: recipientContact.email || 'shipping@iffcargo.com',
        },
        caller: {
          name: 'IFF Cargo',
          phone: '416-798-4151',
          clientId: process.env.DAYROSS_ACCOUNT || '',
        },
        details: detailEntries,
      },
    };

    // PO / reference numbers
    if (details.customerReference) {
      body.shipmentDetails.traceNumbers = [{ traceType: 'P', traceNumber: details.customerReference }];
    }

    // Declared value
    if (details.declaredValue?.amount) {
      body.shipmentDetails.declaredValue = details.declaredValue.amount;
    }

    const url = `${getBaseUrl()}/CreateShipment`;
    const raw = await httpsPost(url, JSON.stringify(body));

    // Day & Ross wraps: { CreateShipmentResponse: {...}, pdf_bol, pdf_labels, zpl_labels }
    const data = raw.CreateShipmentResponse || raw;
    const billNumber = data.billNumber || null;
    if (!billNumber) throw new Error('Day & Ross CreateShipment returned no billNumber');

    // Extract label — Day & Ross returns pdf_bol, pdf_labels, zpl_labels at top level
    let label = null;
    const labelB64 = raw.pdf_labels || raw.pdf_bol;
    if (labelB64) {
      label = {
        encodedLabel: labelB64,
        docType: 'PDF',
      };
    }

    return {
      carrierTrackingNumber: billNumber,
      confirmationNumber: billNumber,
      status: 'confirmed',
      label,
      serviceType: data.serviceLevel || 'LTL',
      charges: data.charges,
      totalCharges: data.totalCharges,
      rawResponse: data,
    };
  }

  _mockBookShipment(errorMessage) {
    return {
      carrierTrackingNumber: `DR${Date.now()}`,
      confirmationNumber: `DR-CONF-${Date.now()}`,
      status: 'confirmed',
      label: null,
      ...(errorMessage && { error: errorMessage }),
    };
  }

  // ─── getTracking (GetShipmentStatus) ──────────────────────────

  async getTracking(trackingNumber) {
    if (this.isLive) {
      try {
        return await this._liveGetTracking(trackingNumber);
      } catch (err) {
        console.error('[DAYROSS-TRACK] Live tracking failed, falling back to mock:', err.message);
        return this._mockGetTracking();
      }
    }
    return this._mockGetTracking();
  }

  async _liveGetTracking(trackingNumber) {
    const creds = getUserCredentials();
    const body = {
      ...creds,
      shipmentNumber: trackingNumber,
    };

    const url = `${getBaseUrl()}/GetShipmentStatus`;
    const raw = await httpsPost(url, JSON.stringify(body));
    // Day & Ross wraps: { GetShipmentStatusResponse: [{...}] } (array)
    const arr = raw.GetShipmentStatusResponse || [];
    const data = Array.isArray(arr) ? arr[0] || {} : arr;
    return this._parseTrackResponse(data);
  }

  _parseTrackResponse(data) {
    const history = data.statusHistory || [];

    // Determine latest status from statusCode
    let status = 'pending';
    if (history.length > 0) {
      const latest = history[history.length - 1];
      const desc = (latest.statusDescription || '').toLowerCase();
      // Check mapped statuses, fall back to statusCode-based logic
      if (STATUS_MAP[desc]) {
        status = STATUS_MAP[desc];
      } else if (latest.statusCode === 'AVAIL' || latest.statusCode === 'CONFQ') {
        status = 'pending';
      } else if (latest.statusCode === 'DELVD') {
        status = 'delivered';
      } else if (history.length > 1) {
        status = 'in_transit';
      }
    }

    const events = history.map(e => ({
      event: e.statusDescription || e.statusCode || '',
      location: e.locComment || e.zoneId || '',
      timestamp: e.changed || null,
      description: e.statComment || e.reason || '',
    })).reverse(); // most recent first

    // Extract weight/pieces from details array
    const details = data.details || [];
    const totalWeight = details.reduce((sum, d) => sum + (d.weight || 0), 0) || null;
    const totalPieces = details.reduce((sum, d) => sum + (d.pieces || 0), 0) || null;

    return {
      status,
      estimatedDelivery: data.estimatedDeliveryDate || null,
      actualDelivery: null,
      shipDate: null,
      latestStatus: events.length > 0 ? events[0].event : '',
      service: 'Day & Ross LTL',
      weight: totalWeight ? `${totalWeight} lbs` : null,
      pieces: totalPieces ? String(totalPieces) : null,
      events,
      rawResponse: data,
    };
  }

  _mockGetTracking() {
    return { status: 'in_transit', events: [] };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  _getClassMultiplier(cls) {
    const map = { '50': 1, '55': 1.05, '60': 1.1, '65': 1.15, '70': 1.2, '77.5': 1.3, '85': 1.4, '92.5': 1.5, '100': 1.65, '110': 1.8, '125': 2, '150': 2.3, '175': 2.6, '200': 3, '250': 3.5, '300': 4 };
    return map[String(cls)] || 1;
  }

  _applyMockAccessorials(base, accessorials, rng2) {
    for (const a of accessorials) {
      if (a === 'liftgate_pickup' || a === 'liftgate_delivery') base += 55 + rng2 * 30;
      if (a === 'residential') base += 22 + rng2 * 12;
      if (a === 'appointment') base += 38 + rng2 * 10;
      if (a === 'inside_delivery') base += 75 + rng2 * 20;
      if (a === 'hazmat') base += 145 + rng2 * 55;
      if (a === 'saturday') base += 32 + rng2 * 15;
      if (a === 'signature') base += 7 + rng2 * 4;
    }
    return base;
  }

  // Map IFF accessorial codes to Day & Ross aCharge codes
  _mapAccessorials(accessorials) {
    const map = {
      tailgate_pickup: 'TLGPU',
      tailgate_delivery: 'TLGDL',
      liftgate_pickup: 'TLGPU',       // IFF "liftgate" = Day & Ross "tailgate"
      liftgate_delivery: 'TLGDL',
      residential_pickup: 'PRESPU',
      residential_delivery: 'PRESDL',
      residential: 'PRESDL',
      appointment_pickup: 'APPTPU',
      appointment_delivery: 'APPTDL',
      appointment: 'APPTDL',
      inside_pickup: 'INSDPU',
      inside_delivery: 'INSDDL',
      limited_access_pickup: 'LTDAPU',
      limited_access_delivery: 'LTDADL',
      hazmat: 'HAZMAT',
      signature: 'CHAIN',             // chain of signature
      saturday: null,                  // no direct Day & Ross equivalent
    };

    const charges = [];
    for (const acc of accessorials) {
      const code = map[acc.toLowerCase()];
      if (code && !charges.some(c => c.aChargeCode === code)) {
        charges.push({ aChargeCode: code });
      }
    }
    return charges;
  }

  // Best-effort province from postal code
  _provinceFromPostal(postal, countryCode) {
    if (!postal) return '';
    if (countryCode === 'CA') {
      const map = {
        A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC',
        K: 'ON', L: 'ON', M: 'ON', N: 'ON', P: 'ON', R: 'MB', S: 'SK',
        T: 'AB', V: 'BC', X: 'NT', Y: 'YT',
      };
      return map[postal[0].toUpperCase()] || '';
    }
    return '';
  }
}

module.exports = new DayRossAdapter();
