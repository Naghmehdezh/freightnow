const CarrierAdapter = require('./CarrierAdapter');
const { addBusinessDays, formatDate } = require('../utils/dateHelpers');
const { getBaseUrl, httpsGet, httpsPost } = require('../services/dhlApi.service');
const { carriers } = require('../config/env');

// DHL product code → friendly service name
const PRODUCT_NAME_MAP = {
  D: 'Express Worldwide (Docs)',
  P: 'Express Worldwide',
  T: 'Express 12:00',
  K: 'Express 9:00',
  M: 'Express 10:30',
  L: 'Express Easy',
  E: 'Express Envelope',
  Y: 'Express 12:00 (Docs)',
  N: 'Domestic Express',
  U: 'Express Worldwide (EU)',
};

class DHLAdapter extends CarrierAdapter {
  get id() { return 'dhl'; }
  get name() { return 'DHL Express'; }
  get isLive() { return !!process.env.DHL_USERNAME; }

  // ─── getRates ─────────────────────────────────────────────────

  async getRates(params) {
    if (!this.isLive) return [];
    try {
      return await this._getLiveRates(params);
    } catch (err) {
      console.error('[DHL-RATE] Live rates failed:', err.message);
      return [];
    }
  }

  async _getLiveRates(params) {
    const { shipmentType, origin, destination, weight, pieces, dimensions, pickupDate } = params;
    const accountNumber = carriers.dhl.accountNumber;

    const shipDate = pickupDate || new Date().toISOString().split('T')[0];
    const isIntl = (origin.country || 'CA') !== (destination.country || 'US');

    const queryParams = new URLSearchParams({
      accountNumber,
      originCountryCode: origin.country || 'CA',
      originCityName: origin.city || 'MONTREAL',
      destinationCountryCode: destination.country || 'US',
      destinationCityName: destination.city || 'NEW YORK',
      weight: String(weight || 1),
      plannedShippingDate: shipDate,
      isCustomsDeclarable: String(isIntl),
      unitOfMeasurement: 'imperial',
      numberOfPieces: String(pieces || 1),
    });

    if (origin.postalCode) queryParams.set('originPostalCode', origin.postalCode);
    if (destination.postalCode) queryParams.set('destinationPostalCode', destination.postalCode);

    // DHL requires dimensions — use provided or sensible defaults
    const dimL = (dimensions && dimensions.length) || 12;
    const dimW = (dimensions && dimensions.width) || 12;
    const dimH = (dimensions && dimensions.height) || 12;
    queryParams.set('length', String(Math.round(dimL)));
    queryParams.set('width', String(Math.round(dimW)));
    queryParams.set('height', String(Math.round(dimH)));

    const url = `${getBaseUrl()}/rates?${queryParams.toString()}`;
    const data = await httpsGet(url);
    return this._parseRateResponse(data, shipDate);
  }

  _parseRateResponse(data, shipDate) {
    const products = data.products || [];
    if (products.length === 0) {
      console.warn('[DHL-RATE] No products returned');
      return [];
    }

    const rates = [];
    for (const product of products) {
      const productCode = product.productCode || '';
      const serviceName = product.productName
        || PRODUCT_NAME_MAP[productCode]
        || productCode;

      // Get total price (prefer first currency match)
      const priceEntry = (product.totalPrice || [])[0];
      if (!priceEntry || priceEntry.price == null) continue;

      const rate = typeof priceEntry.price === 'number'
        ? priceEntry.price
        : parseFloat(priceEntry.price);
      if (isNaN(rate) || rate <= 0) continue; // skip $0 sandbox placeholders

      // Extract delivery date and transit time
      let deliveryDate = null;
      let transitDays = null;

      if (product.deliveryCapabilities?.estimatedDeliveryDateAndTime) {
        deliveryDate = product.deliveryCapabilities.estimatedDeliveryDateAndTime.split('T')[0];
      }

      if (product.deliveryCapabilities?.totalTransitDays) {
        transitDays = parseInt(product.deliveryCapabilities.totalTransitDays, 10);
      }

      if (!transitDays && deliveryDate) {
        const ship = new Date(shipDate + 'T00:00:00');
        const deliver = new Date(deliveryDate + 'T00:00:00');
        let count = 0;
        const d = new Date(ship);
        while (d < deliver) {
          d.setDate(d.getDate() + 1);
          const dow = d.getDay();
          if (dow !== 0 && dow !== 6) count++;
        }
        transitDays = Math.max(1, count);
      }

      if (!transitDays) transitDays = 3;
      if (!deliveryDate) {
        deliveryDate = formatDate(addBusinessDays(new Date(shipDate + 'T12:00:00'), transitDays));
      }

      rates.push({
        serviceName,
        serviceCode: productCode,
        rate: Math.round(rate * 100) / 100,
        transitDays,
        deliveryDate,
        isLive: true,
      });
    }

    rates.sort((a, b) => a.rate - b.rate);
    return rates;
  }

  // ─── getTracking ──────────────────────────────────────────────

  async getTracking(trackingNumber) {
    if (!this.isLive) throw new Error('DHL tracking is not available (no live credentials configured)');
    return this._liveGetTracking(trackingNumber);
  }

  async _liveGetTracking(trackingNumber) {
    const params = new URLSearchParams({
      shipmentTrackingNumber: trackingNumber,
      trackingView: 'all-checkpoints',
      levelOfDetail: 'all',
    });

    const url = `${getBaseUrl()}/tracking?${params.toString()}`;
    const data = await httpsGet(url);
    return this._parseTrackResponse(data);
  }

  _parseTrackResponse(data) {
    const shipments = data.shipments || [];
    if (shipments.length === 0) {
      throw new Error('No shipments in DHL tracking response');
    }

    const shipment = shipments[0];
    const dhlEvents = shipment.events || [];

    // Map DHL status to our status
    let status = 'pending';
    const latestEvent = dhlEvents[0];
    if (latestEvent) {
      const desc = (latestEvent.description || '').toLowerCase();
      if (desc.includes('delivered')) status = 'delivered';
      else if (desc.includes('transit') || desc.includes('departed') || desc.includes('arrived') || desc.includes('processed') || desc.includes('clearance')) status = 'in_transit';
    }

    const events = dhlEvents.map(e => ({
      event: e.description || e.status || '',
      location: [e.location?.address?.addressLocality, e.location?.address?.countryCode]
        .filter(Boolean).join(', '),
      timestamp: e.timestamp,
      description: e.statusCode || '',
    }));

    return {
      status,
      estimatedDelivery: shipment.estimatedDeliveryDate || null,
      actualDelivery: null,
      shipDate: null,
      latestStatus: latestEvent?.description || '',
      service: shipment.service || '',
      weight: shipment.totalWeight ? `${shipment.totalWeight} kg` : null,
      pieces: shipment.numberOfPieces || null,
      events,
      rawResponse: data,
    };
  }

  // ─── bookShipment ─────────────────────────────────────────────

  async bookShipment(details) {
    if (!this.isLive) throw new Error('DHL booking is not available (no live credentials configured)');
    return this._liveBookShipment(details);
  }

  // Convert carrier-agnostic address (FedEx-style) to DHL format
  _toDhlAddress(party) {
    if (!party) return { postalAddress: {}, contactInformation: {} };
    const addr = party.address || {};
    const contact = party.contact || {};
    const postalAddress = {
      postalCode: addr.postalCode || '00000',
      cityName: addr.city || '',
      countryCode: addr.countryCode || 'CA',
      addressLine1: (addr.streetLines || [])[0] || addr.city || 'N/A',
    };
    // DHL requires provinceCode to be at least 2 chars; omit if empty
    if (addr.stateOrProvinceCode && addr.stateOrProvinceCode.length >= 2) {
      postalAddress.provinceCode = addr.stateOrProvinceCode;
    }
    return {
      postalAddress,
      contactInformation: {
        phone: contact.phoneNumber || '0000000000',
        companyName: contact.companyName || contact.personName || 'N/A',
        fullName: contact.personName || 'N/A',
        email: contact.email || 'shipping@iffcargo.com',
      },
    };
  }

  async _liveBookShipment(details) {
    const accountNumber = carriers.dhl.accountNumber;
    const shipDate = details.shipDatestamp || new Date().toISOString().split('T')[0];

    // details.shipper / details.recipient come from _buildCarrierDetails in FedEx format;
    // convert to DHL's postalAddress + contactInformation format
    const shipperDhl = this._toDhlAddress(details.shipper);
    const receiverDhl = this._toDhlAddress(details.recipient);

    const originCountry = details.shipper?.address?.countryCode || 'CA';
    const destCountry = details.recipient?.address?.countryCode || 'US';
    const isIntl = originCountry !== destCountry;
    const contentDesc = details.commodity || details.customerReference || 'General merchandise';

    const body = {
      plannedShippingDateAndTime: `${shipDate}T10:00:00 GMT+00:00`,
      pickup: { isRequested: false },
      productCode: details.serviceType || details.productCode || 'P',
      accounts: [
        { typeCode: 'shipper', number: accountNumber },
        { typeCode: 'payer', number: accountNumber },
      ],
      customerDetails: {
        shipperDetails: shipperDhl,
        receiverDetails: receiverDhl,
      },
      content: {
        packages: [{
          weight: details.weight?.value || 1,
          dimensions: details.dimensions ? {
            length: Math.round(details.dimensions.length),
            width: Math.round(details.dimensions.width),
            height: Math.round(details.dimensions.height),
          } : { length: 12, width: 12, height: 12 },
          customerReferences: [{ value: details.customerReference || 'IFF-BOOKING', typeCode: 'CU' }],
          description: contentDesc,
        }],
        isCustomsDeclarable: isIntl,
        unitOfMeasurement: 'imperial',
        description: contentDesc,
        incoterm: 'DAP',
      },
      outputImageProperties: {
        printerDPI: 300,
        encodingFormat: 'pdf',
        imageOptions: [{ typeCode: 'waybillDoc', templateName: 'ARCH_8x4_A4_002' }],
      },
    };

    // International: add export declaration + declared value
    if (isIntl) {
      const declaredValue = details.customsClearanceDetail?.commodities?.[0]?.customsValue?.amount
        || details.declaredValue?.amount || 100;
      const currency = details.customsClearanceDetail?.commodities?.[0]?.customsValue?.currency
        || details.declaredValue?.currency || 'CAD';
      body.content.declaredValue = declaredValue;
      body.content.declaredValueCurrency = currency;
      body.content.exportDeclaration = {
        lineItems: [{
          number: 1,
          description: contentDesc,
          price: declaredValue,
          quantity: { value: details.totalPackageCount || 1, unitOfMeasurement: 'PCS' },
          manufacturerCountry: originCountry,
          weight: { netValue: details.weight?.value || 1, grossValue: details.weight?.value || 1 },
        }],
        invoice: { number: `INV-${Date.now()}`, date: shipDate },
        exportReason: 'permanent',
      };
    }

    const data = await httpsPost(
      `${getBaseUrl()}/shipments`,
      JSON.stringify(body),
    );

    const trackingNumber = data.shipmentTrackingNumber;
    let label = null;
    const docs = data.documents || [];
    if (docs.length > 0 && docs[0].content) {
      label = {
        encodedLabel: docs[0].content,
        url: null,
        docType: 'PDF', // We request PDF via encodingFormat; DHL returns typeCode='label'
        contentType: 'application/pdf',
      };
    }

    return {
      carrierTrackingNumber: trackingNumber,
      confirmationNumber: trackingNumber,
      status: 'confirmed',
      label,
      serviceType: data.productCode,
      rawResponse: data,
    };
  }

}

module.exports = new DHLAdapter();
