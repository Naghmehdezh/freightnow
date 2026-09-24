const CarrierAdapter = require('./CarrierAdapter');
const { addBusinessDays, formatDate } = require('../utils/dateHelpers');
const { getBaseUrl, httpsGet, httpsPost } = require('../services/csaApi.service');

// CSA status → IFF status mapping
const STATUS_MAP = {
  CONFQUEUE: 'pending',
  CONFSENT: 'pending',
  AVAIL: 'pending',
  ASSIGN: 'in_transit',
  DISP: 'in_transit',
  PICKED: 'in_transit',
  DOCKED: 'in_transit',
  'DOCK NOTE': 'in_transit',
  ALERT: 'in_transit',
  ATTEMPT: 'in_transit',
  HOLD: 'in_transit',
  DELVD: 'delivered',
  COMPLETE: 'delivered',
  BILLD: 'delivered',
};

class CSAAdapter extends CarrierAdapter {
  get id() { return 'csa'; }
  get name() { return 'CSA Transportation'; }
  get isLive() { return !!process.env.CSA_USERNAME; }

  // ─── getRates ─────────────────────────────────────────────────

  async getRates(params) {
    // CSA is LTL only — skip for envelope/parcel
    if (params.shipmentType === 'envelope' || params.shipmentType === 'parcel') {
      return [];
    }
    if (!this.isLive) return [];

    try {
      return await this._getLiveRates(params);
    } catch (err) {
      console.error('[CSA-RATE] Live rates failed:', err.message);
      return [];
    }
  }

  async _getLiveRates(params) {
    const { origin, destination, weight, pieces, dimensions, pickupDate, commodity, accessorials } = params;

    const shipDate = pickupDate || new Date().toISOString().split('T')[0];
    const originCountry = (origin.country || 'CA').toUpperCase();
    const destCountry = (destination.country || 'US').toUpperCase();
    const isCrossBorder = originCountry !== destCountry;

    // Build detail entries — one per handling unit (CSA requires pieces:1 each)
    const numPieces = pieces || 1;
    const dimL = (dimensions && dimensions.length) || 48;
    const dimW = (dimensions && dimensions.width) || 48;
    const dimH = (dimensions && dimensions.height) || 48;
    const perPieceWeight = Math.round(weight / numPieces) || 500;

    const detailEntries = [];
    for (let i = 0; i < Math.min(numPieces, 10); i++) {
      detailEntries.push({
        commodity: 'COM',
        description: commodity || 'General merchandise',
        length: Math.round(dimL),
        lengthUnits: 'IN',
        width: Math.round(dimW),
        widthUnits: 'IN',
        height: Math.round(dimH),
        heightUnits: 'IN',
        weight: i === 0 ? Math.round(weight - perPieceWeight * (numPieces - 1)) : perPieceWeight,
        weightUnits: 'LB',
        pieces: 1,
        piecesUnits: 'SKD',
        requestedEquipment: 'LTL',
      });
    }

    // Ensure Canadian postals have a space (e.g. "M8W1Z7" → "M8W 1Z7")
    const startZone = this._formatPostal(origin.postalCode || '', originCountry);
    const endZone = this._formatPostal(destination.postalCode || '', destCountry);

    const order = {
      caller: {},
      details: detailEntries,
      serviceLevel: 'CONSOLIDAT',
      siteId: 'SITE1',
      startZone,
      endZone,
      pickUpBy: `${shipDate}T08:00:00`,
      pickUpByEnd: `${shipDate}T16:00:00`,
      deliverBy: `${shipDate}T09:00:00`,
      deliverByEnd: `${shipDate}T17:00:00`,
      declaredValue: 0,
    };

    // Cross-border: add broker name
    if (isCrossBorder) {
      order.userFields = { user1: 'UPSSCS' };
    }

    // Map accessorials to CSA aCharge codes
    if (accessorials && accessorials.length > 0) {
      const suffix = isCrossBorder ? '-US' : '-C';
      const aCharges = this._mapAccessorials(accessorials, suffix);
      if (aCharges.length > 0) order.aCharges = aCharges;
    }

    const body = { orders: [order] };
    const url = `${getBaseUrl()}/orders?type=Q`;
    const data = await httpsPost(url, JSON.stringify(body));
    return this._parseQuoteResponse(data, shipDate);
  }

  _parseQuoteResponse(data, shipDate) {
    const orders = data.orders || [];
    if (orders.length === 0) {
      console.warn('[CSA-RATE] No orders in quote response');
      return [];
    }

    const order = orders[0];

    // charges === 0 means the shipment did not auto-rate
    if (!order.charges || order.charges === 0) {
      console.warn('[CSA-RATE] charges=0 — shipment did not auto-rate');
      return [];
    }

    // userFieldInt2 (transit days) is on each detail entry, not the order level
    const firstDetail = (order.details || [])[0];
    const transitDays = order.userFieldInt2 || (firstDetail && firstDetail.userFieldInt2) || null;
    let deliveryDate = order.estimatedDeliveryDate
      ? order.estimatedDeliveryDate.split('T')[0]
      : null;

    if (!deliveryDate && transitDays) {
      deliveryDate = formatDate(addBusinessDays(new Date(shipDate + 'T12:00:00'), transitDays));
    }
    if (!deliveryDate) {
      deliveryDate = formatDate(addBusinessDays(new Date(shipDate + 'T12:00:00'), 5));
    }

    return [{
      serviceName: 'CSA LTL Consolidated',
      serviceCode: 'CONSOLIDAT',
      rate: Math.round(order.charges * 100) / 100,
      transitDays: transitDays || 5,
      deliveryDate,
      isLive: true,
      totalCharges: order.totalCharges || order.charges,
      tax1: order.tax1 || 0,
      tax2: order.tax2 || 0,
    }];
  }

  // ─── getTracking ──────────────────────────────────────────────

  async getTracking(trackingNumber) {
    if (!this.isLive) throw new Error('CSA tracking is not available (no live credentials configured)');
    return this._liveGetTracking(trackingNumber);
  }

  async _liveGetTracking(trackingNumber) {
    // trackingNumber may be an orderId (numeric) or billNumber (e.g. "C1301680")
    let orderId = trackingNumber;

    // If it looks like a billNumber (starts with letter), look up the orderId via oData filter
    if (isNaN(trackingNumber)) {
      const filterUrl = `${getBaseUrl()}/orders?$filter=billNumber eq '${trackingNumber}'`;
      const filterData = await httpsGet(filterUrl);
      const orders = Array.isArray(filterData) ? filterData : (filterData.orders || []);
      if (orders.length === 0) {
        throw new Error(`No CSA order found for billNumber ${trackingNumber}`);
      }
      orderId = orders[0].orderId;
    }

    const url = `${getBaseUrl()}/orders/${orderId}/statusHistory`;
    const data = await httpsGet(url);
    return this._parseTrackResponse(data, orderId);
  }

  _parseTrackResponse(data, orderId) {
    const events = Array.isArray(data) ? data : (data.statusHistory || data.events || []);

    // Determine latest status — last entry in the array is the most recent
    let status = 'pending';
    if (events.length > 0) {
      const latest = events[events.length - 1];
      const statusCode = (latest.statusCode || '').toUpperCase();
      status = STATUS_MAP[statusCode] || 'pending';
    }

    const mappedEvents = events.map(e => ({
      event: e.statusDescription || e.statusCode || '',
      location: e.zoneId || '',
      timestamp: e.changed || e.insDate || null,
      description: e.statComment || '',
    })).reverse(); // most recent first

    return {
      status,
      estimatedDelivery: null,
      actualDelivery: null,
      shipDate: null,
      latestStatus: events.length > 0 ? (events[events.length - 1].statusDescription || events[events.length - 1].statusCode || '') : '',
      service: 'CSA LTL Consolidated',
      weight: null,
      pieces: null,
      events: mappedEvents,
      rawResponse: data,
    };
  }

  // ─── bookShipment ─────────────────────────────────────────────

  async bookShipment(details) {
    if (!this.isLive) throw new Error('CSA booking is not available (no live credentials configured)');
    return this._liveBookShipment(details);
  }

  async _liveBookShipment(details) {
    const shipDate = details.shipDatestamp || new Date().toISOString().split('T')[0];
    const originCountry = details.shipper?.address?.countryCode || 'CA';
    const destCountry = details.recipient?.address?.countryCode || 'US';
    const isCrossBorder = originCountry !== destCountry;

    const shipperAddr = details.shipper?.address || {};
    const shipperContact = details.shipper?.contact || {};
    const recipientAddr = details.recipient?.address || {};
    const recipientContact = details.recipient?.contact || {};

    // Build detail entries
    const numPieces = details.totalPackageCount || 1;
    const totalWeight = details.weight?.value || 1000;
    const perPieceWeight = Math.round(totalWeight / numPieces);
    const dimL = details.dimensions?.length || 48;
    const dimW = details.dimensions?.width || 48;
    const dimH = details.dimensions?.height || 48;

    const detailEntries = [];
    for (let i = 0; i < Math.min(numPieces, 10); i++) {
      detailEntries.push({
        commodity: 'COM',
        description: details.commodity || details.customerReference || 'General merchandise',
        length: Math.round(dimL), lengthUnits: 'IN',
        width: Math.round(dimW), widthUnits: 'IN',
        height: Math.round(dimH), heightUnits: 'IN',
        weight: i === 0 ? totalWeight - perPieceWeight * (numPieces - 1) : perPieceWeight,
        weightUnits: 'LB',
        pieces: 1,
        piecesUnits: 'SKD',
        requestedEquipment: 'LTL',
      });
    }

    const startZone = this._formatPostal(shipperAddr.postalCode || '', originCountry);
    const endZone = this._formatPostal(recipientAddr.postalCode || '', destCountry);

    const order = {
      caller: {},
      shipper: {
        name: (shipperContact.companyName || shipperContact.personName || 'Shipper').substring(0, 40),
        address1: '',
        address2: ((shipperAddr.streetLines || [])[0] || shipperAddr.city || 'N/A').substring(0, 40),
        city: shipperAddr.city || '',
        province: shipperAddr.stateOrProvinceCode || '',
        postalCode: startZone,
        contact: (shipperContact.personName || 'Contact').substring(0, 34),
        phone: shipperContact.phoneNumber || '0000000000',
        phoneExt: '',
        email: shipperContact.email || 'shipping@iffcargo.com',
      },
      consignee: {
        name: (recipientContact.companyName || recipientContact.personName || 'Consignee').substring(0, 40),
        address1: '',
        address2: ((recipientAddr.streetLines || [])[0] || recipientAddr.city || 'N/A').substring(0, 40),
        city: recipientAddr.city || '',
        province: recipientAddr.stateOrProvinceCode || '',
        postalCode: endZone,
        contact: (recipientContact.personName || 'Contact').substring(0, 34),
        phone: recipientContact.phoneNumber || '0000000000',
        phoneExt: '',
        email: recipientContact.email || 'shipping@iffcargo.com',
      },
      details: detailEntries,
      serviceLevel: 'CONSOLIDAT',
      siteId: 'SITE1',
      startZone,
      endZone,
      pickUpBy: `${shipDate}T08:00:00`,
      pickUpByEnd: `${shipDate}T17:00:00`,
      deliverBy: `${shipDate}T09:00:00`,
      deliverByEnd: `${shipDate}T17:00:00`,
      declaredValue: details.declaredValue?.amount || 0,
    };

    // Cross-border: add broker + optional currency
    if (isCrossBorder) {
      order.userFields = { user1: 'UPSSCS' };
    }

    // Trace numbers (PO reference)
    if (details.customerReference) {
      order.traceNumbers = [{ traceType: 'P', traceNumber: details.customerReference }];
    }

    const body = { orders: [order] };
    const url = `${getBaseUrl()}/orders?type=T`;
    const data = await httpsPost(url, JSON.stringify(body));

    const orders = data.orders || [];
    const booked = orders[0];
    if (!booked) throw new Error('CSA order response contained no orders');

    return {
      carrierTrackingNumber: booked.billNumber || null,
      confirmationNumber: String(booked.orderId),
      status: 'confirmed',
      label: null, // CSA doesn't return labels via API
      serviceType: 'CONSOLIDAT',
      charges: booked.charges,
      totalCharges: booked.totalCharges,
      rawResponse: data,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  // Ensure Canadian postal codes have a space (CSA requires it)
  _formatPostal(postal, country) {
    if (!postal) return '';
    const clean = postal.replace(/\s+/g, '').toUpperCase();
    // Canadian postal: A1A1A1 → A1A 1A1
    if ((country === 'CA') && /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(clean)) {
      return clean.substring(0, 3) + ' ' + clean.substring(3);
    }
    return postal;
  }

  // Map IFF accessorial codes to CSA aCharge codes
  _mapAccessorials(accessorials, suffix) {
    const map = {
      tailgate_pickup: 'TAIL',
      tailgate_delivery: 'TAILC',
      liftgate_pickup: 'TAIL',     // IFF uses "liftgate" — same as CSA "tailgate"
      liftgate_delivery: 'TAILC',
      residential_pickup: 'CURBP',
      residential_delivery: 'CURB',
      residential: 'CURB',         // generic "residential" maps to delivery
      appointment_pickup: 'APPTFEEP',
      appointment_delivery: 'APPTFEE',
      appointment: 'APPTFEE',      // generic "appointment" maps to delivery
      call_ahead_pickup: 'NOTIFY',
      call_ahead_delivery: 'NOT',
      limited_access_pickup: 'LIMITED',
      limited_access_delivery: 'LIMITEDD',
      inside_delivery: null,        // CSA doesn't support inside delivery
      hazmat: null,                 // CSA doesn't support hazmat
      signature: null,              // CSA doesn't support signature
      saturday: null,               // CSA doesn't support saturday delivery
    };

    // For US funds, the suffix codes differ slightly
    const usSuffixMap = {
      TAIL: 'TAIL-US',
      TAILC: 'TAILC-US',
      CURBP: 'CURBP-US',
      CURB: 'CURB-US',
      APPTFEEP: 'APPTFEEP-U',
      APPTFEE: 'APPTFEE-U',
      NOTIFY: 'NOTIFY-US',
      NOT: 'NOT-US',
      LIMITED: 'LIMITED-US',
      LIMITEDD: 'LIMITEDDUS',
    };

    const cadSuffixMap = {
      TAIL: 'TAIL-C',
      TAILC: 'TAILC-C',
      CURBP: 'CURBP',
      CURB: 'CURB',
      APPTFEEP: 'APPTFEEP',
      APPTFEE: 'APPTFEE',
      NOTIFY: 'NOTIFY',
      NOT: 'NOT',
      LIMITED: 'LIMITED',
      LIMITEDD: 'LIMITEDD',
    };

    const isUS = suffix === '-US';
    const lookup = isUS ? usSuffixMap : cadSuffixMap;
    const charges = [];

    for (const acc of accessorials) {
      const baseCode = map[acc.toLowerCase()];
      if (baseCode && lookup[baseCode]) {
        // Avoid duplicate charges (e.g. liftgate_pickup = tailgate_pickup)
        const code = lookup[baseCode];
        if (!charges.some(c => c.aChargeCode === code)) {
          charges.push({ aChargeCode: code });
        }
      }
    }

    return charges;
  }
}

module.exports = new CSAAdapter();
