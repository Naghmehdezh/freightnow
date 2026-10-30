const CarrierAdapter = require('./CarrierAdapter');
const { addBusinessDays, formatDate } = require('../utils/dateHelpers');
const { pickupWindow } = require('../utils/pickupWindow');
const { timeZoneFor, utcOffset } = require('../utils/timeZones');
const { getBaseUrl, httpsGet, httpsPost } = require('../services/dhlApi.service');
const { carriers } = require('../config/env');
const { SUPPORT, OptionUnavailableError, titleCase, labelFor } = require('./accessorials');

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
      if (err instanceof OptionUnavailableError) throw err;
      console.error('[DHL-RATE] Live rates failed:', err.message);
      return [];
    }
  }

  // App options → DHL value-added service codes (from IFF's account's service list).
  _valueAddedServices(params) {
    const accessorials = params.accessorials || [];
    const codes = [];
    for (const option of accessorials) {
      if (option === 'pickup') continue; // requested with the booking, not priced as a service
      if (option === 'hazmat') codes.push(this._dgCode(params));
      else if (SUPPORT.dhl[option]) codes.push(SUPPORT.dhl[option]);
    }
    const vas = [...new Set(codes.filter(Boolean))].map(serviceCode => ({ serviceCode }));
    // Declared value → DHL shipment insurance (Shipment Value Protection).
    if (params.declaredValue > 0) {
      vas.push({ serviceCode: 'II', value: params.declaredValue, currency: params.currency || 'CAD' });
    }
    return vas;
  }

  // App option ids behind DHL codes (declared value isn't an option — it's dropped separately).
  _optionsFor(codes, params) {
    const ids = [];
    for (const code of codes) {
      if (code === this._dgCode(params)) ids.push('hazmat');
      else ids.push(...Object.keys(SUPPORT.dhl).filter(o => SUPPORT.dhl[o] === code));
    }
    return ids;
  }

  _optionLabel(code, params) {
    if (code === 'II') return 'Declared value';
    if (code === this._dgCode(params)) return 'Dangerous goods';
    const option = Object.keys(SUPPORT.dhl).find(o => SUPPORT.dhl[o] === code);
    return option ? labelFor(option) : code;
  }

  _dgCode({ dgType, battery }) {
    if (dgType === 'BATTERY') {
      const metal = battery?.material === 'LITHIUM_METAL';
      const packed = battery?.packing === 'PACKED_WITH_EQUIPMENT';
      // IATA Section II packing instructions: ion PI966/PI967, metal PI969/PI970.
      return metal ? (packed ? 'HM' : 'HW') : (packed ? 'HD' : 'HV');
    }
    if (dgType === 'SMALL_QUANTITY_EXCEPTION') return 'HH'; // excepted quantities
    return 'HE'; // fully regulated dangerous goods
  }

  async _getLiveRates(params) {
    const { origin, destination, weight, pieces, dimensions, pickupDate } = params;
    const accountNumber = carriers.dhl.accountNumber;

    const shipDate = pickupDate || new Date().toISOString().split('T')[0];
    const isIntl = (origin.country || 'CA') !== (destination.country || 'US');
    const valueAddedServices = this._valueAddedServices(params);

    // POST /rates (not GET) so the selected options can be priced as value-added services.
    const party = (p, fallbackCity) => ({
      ...(p.postalCode && { postalCode: String(p.postalCode).replace(/\s+/g, '') }),
      cityName: p.city || fallbackCity,
      countryCode: p.country || 'CA',
    });
    const body = {
      customerDetails: { shipperDetails: party(origin, 'MONTREAL'), receiverDetails: party(destination, 'NEW YORK') },
      accounts: [{ typeCode: 'shipper', number: accountNumber }],
      plannedShippingDateAndTime: `${shipDate}T${pickupWindow(params).ready}:00GMT${utcOffset(timeZoneFor(origin.country, origin.province), shipDate)}`,
      unitOfMeasurement: 'imperial',
      isCustomsDeclarable: isIntl,
      ...(isIntl && { monetaryAmount: [{ typeCode: 'declaredValue', value: params.declaredValue || 100, currency: params.currency || 'CAD' }] }),
      ...(valueAddedServices.length && { valueAddedServices }),
      nextBusinessDay: true,
      // DHL requires dimensions — use provided or sensible defaults
      packages: Array.from({ length: Math.min(pieces || 1, 50) }, () => ({
        weight: (weight || 1) / (pieces || 1),
        dimensions: {
          length: Math.round(dimensions?.length || 12),
          width: Math.round(dimensions?.width || 12),
          height: Math.round(dimensions?.height || 12),
        },
      })),
    };

    const data = await httpsPost(`${getBaseUrl()}/rates`, JSON.stringify(body));
    const requested = valueAddedServices.map(v => v.serviceCode);
    const rates = this._parseRateResponse(data, shipDate, requested);
    if (requested.length && !rates.length && (data.products || []).length) {
      // Name the options no DHL product on this lane offers.
      const offered = new Set((data.products || []).flatMap(p => (p.detailedPriceBreakdown || []).flatMap(b => (b.breakdown || []).map(i => i.serviceCode))));
      const missingCodes = requested.filter(c => !offered.has(c));
      const labels = [...new Set(missingCodes.map(c => this._optionLabel(c, params)))];
      const options = missingCodes.length ? this._optionsFor(missingCodes, params) : null;
      throw new OptionUnavailableError(`DHL doesn't offer ${labels.length ? labels.join(', ') : 'the selected options'} on this lane.`, options);
    }
    return rates;
  }

  _parseRateResponse(data, shipDate, requested = []) {
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

      // Total in the billing currency (BILLC) when DHL gives several.
      const priceEntry = (product.totalPrice || []).find(p => p.currencyType === 'BILLC') || (product.totalPrice || [])[0];
      if (!priceEntry || priceEntry.price == null) continue;

      const rate = typeof priceEntry.price === 'number'
        ? priceEntry.price
        : parseFloat(priceEntry.price);
      if (isNaN(rate) || rate <= 0) continue; // skip $0 sandbox placeholders

      // DHL leaves a requested service off a product that can't do it (rather than refusing),
      // so only keep products whose breakdown includes every requested service.
      const breakdown = ((product.detailedPriceBreakdown || []).find(b => b.currencyType === priceEntry.currencyType)
        || (product.detailedPriceBreakdown || [])[0])?.breakdown || [];
      const included = new Set(breakdown.map(i => i.serviceCode).filter(Boolean));
      if (!requested.every(code => included.has(code))) continue;
      const accessorialCharges = breakdown
        .filter(i => requested.includes(i.serviceCode) && Number(i.price) > 0)
        .map(i => ({ code: i.serviceCode, label: titleCase(i.name || i.serviceCode), amount: Number(i.price) }));

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
        accessorialCharges,
        // DHL states the currency of each price; carried through so it's never mislabelled.
        ...(priceEntry.priceCurrency && { currency: priceEntry.priceCurrency }),
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

    // Ready time at the pickup address, in its own UTC offset (DHL: "...T09:00:00GMT-05:00").
    const { ready, close } = pickupWindow(details);
    const offset = utcOffset(timeZoneFor(originCountry, details.shipper?.address?.stateOrProvinceCode), shipDate);
    const body = {
      plannedShippingDateAndTime: `${shipDate}T${ready}:00GMT${offset}`,
      // App bookings ask DHL to collect it in the customer's window (scripts only create labels).
      pickup: details.requestPickup
        ? { isRequested: true, closeTime: close, location: 'reception' }
        : { isRequested: false },
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

    // The pickup's dispatch confirmation (e.g. "AME261103000164"); also cancelPickupUrl.
    const dispatch = data.dispatchConfirmationNumber || data.dispatchConfirmationNumbers?.[0];
    if (details.requestPickup) console.log(`[DHL-PICKUP] ${dispatch || 'no dispatch number returned'} for ${trackingNumber}`);

    return {
      carrierTrackingNumber: trackingNumber,
      confirmationNumber: dispatch || trackingNumber,
      status: 'confirmed',
      label,
      serviceType: data.productCode,
      ...(details.requestPickup && {
        pickup: dispatch
          ? { scheduled: true, confirmationNumber: dispatch }
          : { scheduled: false, message: "DHL didn't confirm a pickup for this shipment. IFF will arrange it." },
      }),
      rawResponse: data,
    };
  }

}

module.exports = new DHLAdapter();
