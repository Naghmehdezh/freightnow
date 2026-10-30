const CarrierAdapter = require('./CarrierAdapter');
const { addBusinessDays, formatDate } = require('../utils/dateHelpers');
const { getToken, getBaseUrl, httpsPost, invalidateToken } = require('../services/fedexAuth.service');
const { carriers } = require('../config/env');
const validationMode = require('../services/fedexValidationMode');
const { OptionUnavailableError, labelFor } = require('./accessorials');
const { pickupWindow } = require('../utils/pickupWindow');
const { localTimestamp } = require('../utils/timeZones');

// Official FedEx service names with their registered marks, exactly as FedEx requires them to be
// displayed (Integrator validation: e.g. "FedEx Ground®", "FedEx International Priority® Express").
const FEDEX_SERVICE_NAMES = {
  FEDEX_GROUND: 'FedEx Ground®',
  GROUND_HOME_DELIVERY: 'FedEx Home Delivery®',
  SMART_POST: 'FedEx Ground® Economy',
  FEDEX_EXPRESS_SAVER: 'FedEx Express Saver®',
  FEDEX_ECONOMY: 'FedEx Economy®',
  FEDEX_2_DAY: 'FedEx 2Day®',
  FEDEX_2_DAY_AM: 'FedEx 2Day® A.M.',
  STANDARD_OVERNIGHT: 'FedEx Standard Overnight®',
  PRIORITY_OVERNIGHT: 'FedEx Priority Overnight®',
  FIRST_OVERNIGHT: 'FedEx First Overnight®',
  FEDEX_1_DAY_FREIGHT: 'FedEx 1Day® Freight',
  FEDEX_2_DAY_FREIGHT: 'FedEx 2Day® Freight',
  FEDEX_3_DAY_FREIGHT: 'FedEx 3Day® Freight',
  FEDEX_FIRST_FREIGHT: 'FedEx First Overnight® Freight',
  FEDEX_FREIGHT_ECONOMY: 'FedEx Freight® Economy',
  FEDEX_FREIGHT_PRIORITY: 'FedEx Freight® Priority',
  FEDEX_INTERNATIONAL_PRIORITY: 'FedEx International Priority®',
  INTERNATIONAL_PRIORITY: 'FedEx International Priority®',
  FEDEX_INTERNATIONAL_PRIORITY_EXPRESS: 'FedEx International Priority® Express',
  INTERNATIONAL_ECONOMY: 'FedEx International Economy®',
  FEDEX_INTERNATIONAL_ECONOMY: 'FedEx International Economy®',
  INTERNATIONAL_FIRST: 'FedEx International First®',
  FEDEX_INTERNATIONAL_GROUND: 'FedEx International Ground®',
  INTERNATIONAL_PRIORITY_FREIGHT: 'FedEx International Priority® Freight',
  INTERNATIONAL_ECONOMY_FREIGHT: 'FedEx International Economy® Freight',
  FEDEX_INTERNATIONAL_CONNECT_PLUS: 'FedEx® International Connect Plus',
  FEDEX_REGIONAL_ECONOMY: 'FedEx® Regional Economy',
  FEDEX_REGIONAL_ECONOMY_FREIGHT: 'FedEx® Regional Economy Freight',
  FEDEX_INTERNATIONAL_DEFERRED_FREIGHT: 'FedEx® International Deferred Freight',
  FEDEX_FIRST: 'FedEx First®',
  FEDEX_PRIORITY: 'FedEx® Priority',
  FEDEX_PRIORITY_EXPRESS: 'FedEx® Priority Express',
  FEDEX_PRIORITY_EXPRESS_FREIGHT: 'FedEx® Priority Express Freight',
  FEDEX_PRIORITY_FREIGHT: 'FedEx® Priority Freight',
  FEDEX_DEFERRED_FREIGHT: 'FedEx® Deferred Freight',
  INTERNATIONAL_PRIORITY_DISTRIBUTION: 'FedEx International Priority DirectDistribution®',
};

// Services IFF declared in its FedEx Product Information Worksheet (PIW) — only these are
// offered. Not declared (so never shown): the DirectDistribution / consolidation services,
// FedEx Ground® Economy bound printed matter and media mail.
const PIW_SERVICES = new Set([
  'FEDEX_1_DAY_FREIGHT', 'FEDEX_2_DAY_AM', 'FEDEX_2_DAY', 'FEDEX_2_DAY_FREIGHT', 'FEDEX_3_DAY_FREIGHT',
  'FEDEX_DEFERRED_FREIGHT', 'FEDEX_ECONOMY', 'FEDEX_ECONOMY_SELECT', 'FEDEX_EXPRESS_SAVER', 'FEDEX_FIRST',
  'FIRST_OVERNIGHT', 'FEDEX_FIRST_FREIGHT', 'FEDEX_GROUND', 'SMART_POST', 'FEDEX_GROUND_ECONOMY',
  'GROUND_HOME_DELIVERY', 'FEDEX_PRIORITY', 'FEDEX_PRIORITY_EXPRESS', 'FEDEX_PRIORITY_EXPRESS_FREIGHT',
  'FEDEX_PRIORITY_FREIGHT', 'PRIORITY_OVERNIGHT', 'STANDARD_OVERNIGHT',
  'FEDEX_FREIGHT_ECONOMY', 'FEDEX_FREIGHT_PRIORITY',
  'FEDEX_INTERNATIONAL_CONNECT_PLUS', 'FEDEX_INTERNATIONAL_DEFERRED_FREIGHT', 'INTERNATIONAL_ECONOMY',
  'FEDEX_INTERNATIONAL_ECONOMY', 'INTERNATIONAL_ECONOMY_FREIGHT', 'INTERNATIONAL_FIRST',
  'FEDEX_INTERNATIONAL_GROUND', 'INTERNATIONAL_GROUND', 'FEDEX_INTERNATIONAL_PRIORITY', 'INTERNATIONAL_PRIORITY',
  'FEDEX_INTERNATIONAL_PRIORITY_EXPRESS', 'INTERNATIONAL_PRIORITY_FREIGHT',
  'FEDEX_REGIONAL_ECONOMY', 'FEDEX_REGIONAL_ECONOMY_FREIGHT',
]);
const LTL_SERVICES = new Set(['FEDEX_FREIGHT_ECONOMY', 'FEDEX_FREIGHT_PRIORITY']);
const GROUND_SERVICES = new Set(['FEDEX_GROUND', 'GROUND_HOME_DELIVERY', 'SMART_POST', 'FEDEX_GROUND_ECONOMY',
  'FEDEX_INTERNATIONAL_GROUND', 'INTERNATIONAL_GROUND']);

// Labels for the FedEx surcharges shown as accessorial lines on a rate.
const FEDEX_SURCHARGE_LABELS = {
  RESIDENTIAL_DELIVERY: 'Residential Delivery',
  SIGNATURE_OPTION: 'Signature',
  DANGEROUS_GOODS: 'Dangerous goods',
  SATURDAY_DELIVERY: 'Saturday delivery',
  SATURDAY_PICKUP: 'Saturday pickup',
  HOLD_AT_LOCATION: 'Hold at location',
  HOME_DELIVERY_APPOINTMENT: 'FedEx Appointment Home Delivery®',
  HOME_DELIVERY_EVENING: 'FedEx Evening Home Delivery®',
  HOME_DELIVERY_DATE_CERTAIN: 'FedEx Date Certain Home Delivery®',
  INSURED_VALUE: 'Declared value',
  DECLARED_VALUE: 'Declared value',
};

// Plain names FedEx sometimes returns (e.g. Track's "FedEx Ground") → trademarked form.
const PLAIN_TO_MARKED = Object.fromEntries(
  Object.values(FEDEX_SERVICE_NAMES).map(n => [n.replace(/®/g, '').replace(/\s+/g, ' ').trim().toLowerCase(), n])
);

function fedexServiceName(code, description) {
  if (code && FEDEX_SERVICE_NAMES[code]) return FEDEX_SERVICE_NAMES[code];
  if (description) {
    if (description.includes('®')) return description;
    return PLAIN_TO_MARKED[description.replace(/\s+/g, ' ').trim().toLowerCase()] || description;
  }
  return code ? code.replace(/_/g, ' ') : '';
}

class FedExAdapter extends CarrierAdapter {
  get id() { return 'fedex'; }
  get name() { return 'FedEx'; }
  get isLive() { return !!process.env.FEDEX_API_KEY; }

  async getRates(params) {
    if (!this.isLive) return [];
    try {
      return await this._getLiveRates(params);
    } catch (err) {
      if (err instanceof OptionUnavailableError) throw err;
      // FedEx rejects the whole request when it can't combine the selected options with any
      // service/packaging (SERVICE.PACKAGECOMBINATION.INVALID, …SPECIALSERVICE…).
      const codes = (err.body?.errors || []).map(e => e.code).join(' ');
      if (params.accessorials?.length && err.statusCode === 400 && /PACKAGECOMBINATION|SPECIALSERVICE/i.test(codes)) {
        // FedEx Home Delivery® is residential-only: FedEx rejects it to business-only ZIP codes
        // (e.g. 10118, the Empire State Building) — leave out just that option and say why.
        const homeDelivery = params.accessorials.filter(a => ['appointment', 'evening_delivery', 'date_certain'].includes(a));
        if (homeDelivery.length) {
          throw new OptionUnavailableError("FedEx Home Delivery® isn't available to this destination ZIP code (residential addresses only).", homeDelivery);
        }
        throw new OptionUnavailableError("FedEx can't combine the selected options on this shipment.", null);
      }
      console.error('[FEDEX-RATE] Live rates failed:', err.message);
      return [];
    }
  }

  async _getLiveRates(params) {
    const { shipmentType, origin, destination, weight, pieces, dimensions, pickupDate, accessorials = [] } = params;
    // Validation mode (temporary): rate under FedEx's test account for the origin country,
    // with that account's own token, so the UI matches FedEx's test-case responses.
    const testAccount = validationMode.isOn() ? validationMode.testAccountFor(origin.country) : null;
    const token = testAccount ? await validationMode.tokenFor(testAccount) : await getToken();
    const accountNumber = testAccount || carriers.fedex.accountNumber;
    console.log(`[FEDEX-RATE] Rating with account ${accountNumber}${testAccount ? ' (FedEx test account — validation mode, own CSP token)' : ''}, packaging ${params.fedexPackaging || 'YOUR_PACKAGING'}`);

    const shipDate = pickupDate || new Date().toISOString().split('T')[0];

    // Use YOUR_PACKAGING for all shipment types — FEDEX_ENVELOPE restricts which
    // services FedEx will return and causes SERVICE.PACKAGECOMBINATION.INVALID errors
    // when no specific serviceType is requested (we ask FedEx for all available services).
    // Customer packaging unless a FedEx-branded package was chosen (e.g. FEDEX_TUBE,
    // FEDEX_MEDIUM_BOX — FedEx prices these differently, and One Rate requires them).
    const packagingType = params.fedexPackaging || 'YOUR_PACKAGING';

    // Build requested service types based on shipment type
    const serviceTypes = this._getFedExServiceTypes(shipmentType);

    const usDomestic = (origin.country || '').toUpperCase() === 'US' && (destination.country || '').toUpperCase() === 'US';

    // Build special services from accessorials. null = FedEx can't do what the customer asked
    // for on this shipment, so FedEx is left out of the results rather than quoted without it.
    const special = this._mapAccessorialsToFedEx(accessorials, {
      usDomestic, shipDate,
      dgType: params.dgType,
      battery: params.battery,
      homeDeliveryDate: params.homeDeliveryDate,
    });
    const specialServiceTypes = special.shipmentTypes;
    // FedEx One Rate® is US-domestic only and needs FedEx packaging — sending it on any other
    // shipment makes FedEx reject the whole request (SERVICE.PACKAGECOMBINATION.INVALID).
    if (params.fedexOneRate && packagingType !== 'YOUR_PACKAGING' && usDomestic) specialServiceTypes.push('FEDEX_ONE_RATE');

    // Build the package line item
    const packageLineItem = {
      weight: { units: 'LB', value: weight || 1 },
      ...(special.packageSpecialServices && { packageSpecialServices: special.packageSpecialServices }),
      // Declared value (extended liability) — FedEx adds its declared-value charge above the
      // standard liability limit.
      ...(params.declaredValue > 0 && {
        declaredValue: {
          amount: params.declaredValue,
          currency: params.currency || ((origin.country || '').toUpperCase() === 'US' ? 'USD' : 'CAD'),
        },
      }),
    };
    // FedEx-branded packaging has fixed dimensions — only send them for customer packaging.
    if (packagingType === 'YOUR_PACKAGING' && dimensions && dimensions.length && dimensions.width && dimensions.height) {
      packageLineItem.dimensions = {
        length: Math.round(dimensions.length),
        width: Math.round(dimensions.width),
        height: Math.round(dimensions.height),
        units: 'IN',
      };
    }

    // Build the rate request body
    const body = {
      accountNumber: { value: accountNumber },
      rateRequestControlParameters: {
        returnTransitTimes: true,
        servicesNeededOnRateFailure: true,
      },
      requestedShipment: {
        shipper: {
          // Shipper + payor carry the same account: Comprehensive Rates rejects a SENDER-paid
          // request with ACCOUNT.NUMBER.MISMATCH unless both match.
          accountNumber: { value: accountNumber },
          address: {
            postalCode: origin.postalCode || '',
            countryCode: origin.country || 'CA',
            ...(origin.city && { city: origin.city }),
          },
        },
        recipient: {
          address: {
            postalCode: destination.postalCode || '',
            countryCode: destination.country || 'US',
            ...(destination.city && { city: destination.city }),
            // FedEx adds its residential surcharge (and offers FedEx Home Delivery®) from this flag.
            ...(special.residential && { residential: true }),
          },
        },
        shippingChargesPayment: {
          paymentType: 'SENDER',
          payor: { responsibleParty: { accountNumber: { value: accountNumber } } },
        },
        // Pickup option: FedEx will be asked to collect it; otherwise the shipper's regular pickup.
        pickupType: accessorials.includes('pickup') ? 'CONTACT_FEDEX_TO_SCHEDULE' : 'USE_SCHEDULED_PICKUP',
        packagingType,
        rateRequestType: ['LIST', 'ACCOUNT'],
        shipDateStamp: shipDate,
        requestedPackageLineItems: [packageLineItem],
        totalPackageCount: pieces || 1,
      },
    };

    if (specialServiceTypes.length > 0) {
      body.requestedShipment.shipmentSpecialServices = {
        specialServiceTypes,
        ...(special.homeDeliveryPremiumDetail && { homeDeliveryPremiumDetail: special.homeDeliveryPremiumDetail }),
      };
    }

    // International shipments require customs clearance details
    const originCountry = (origin.country || 'CA').toUpperCase();
    const destCountry = (destination.country || 'US').toUpperCase();
    if (originCountry !== destCountry) {
      body.requestedShipment.customsClearanceDetail = {
        dutiesPayment: { paymentType: 'SENDER' },
        commodities: [{
          description: params.commodity || 'General merchandise',
          countryOfManufacture: originCountry,
          quantity: pieces || 1,
          quantityUnits: 'PCS',
          weight: { units: 'LB', value: weight || 1 },
          customsValue: { amount: params.declaredValue || 100, currency: 'CAD' },
        }],
      };
    }

    // FedEx requires Integrators to use Comprehensive Rates and Transit Times (confirmed with
    // FedEx support) — the plain Rate API returns 403 for this project.
    const url = `${getBaseUrl()}/rate/v1/comprehensiverates/quotes`;
    const rateHeaders = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_CA',
    };
    const bodyStr = JSON.stringify(body);

    // FedEx's sandbox regularly returns transient 500/503 errors (and 401 while tokens propagate
    // across gateway nodes). Retry with a growing delay; refresh the parent token on 401.
    const MAX_ATTEMPTS = 6;
    let data;
    for (let attempt = 1; ; attempt++) {
      try {
        data = await httpsPost(url, bodyStr, rateHeaders);
        break;
      } catch (err) {
        const transient = [401, 500, 502, 503, 504].includes(err.statusCode);
        if (!transient || attempt >= MAX_ATTEMPTS) throw err;
        if (err.statusCode === 401 && !testAccount) {
          invalidateToken();
          rateHeaders.Authorization = `Bearer ${await getToken()}`;
        }
        console.log(`[FEDEX-RATE] FedEx returned ${err.statusCode}; retry ${attempt}/${MAX_ATTEMPTS - 1}…`);
        await new Promise(r => setTimeout(r, Math.min(1000 * attempt, 4000)));
      }
    }
    const rates = this._parseRateResponse(data, shipmentType, shipDate, {
      saturday: special.saturday,
      chargeTypes: this._surchargeTypesFor(accessorials, params),
      // The signature line is named after the option chosen (e.g. "Adult Signature Required").
      signatureLabel: labelFor(accessorials.find(a => a.startsWith('signature_'))),
    });
    if (special.saturday && !rates.length) {
      throw new OptionUnavailableError('FedEx has no Saturday delivery for this pickup date (it delivers on Saturday for Thursday/Friday shipments).', ['saturday']);
    }
    return rates;
  }

  // FedEx surcharge types that belong to the options the customer selected.
  _surchargeTypesFor(accessorials, params) {
    const has = a => accessorials.includes(a);
    const types = [];
    if (has('residential') || has('appointment') || has('evening_delivery') || has('date_certain')) types.push('RESIDENTIAL_DELIVERY');
    if (accessorials.some(a => a.startsWith('signature'))) types.push('SIGNATURE_OPTION');
    if (has('hazmat')) types.push('DANGEROUS_GOODS');
    if (has('saturday')) types.push('SATURDAY_DELIVERY');
    if (has('saturday_pickup')) types.push('SATURDAY_PICKUP');
    if (has('hold_at_location')) types.push('HOLD_AT_LOCATION');
    if (has('appointment')) types.push('HOME_DELIVERY_APPOINTMENT');
    if (has('evening_delivery')) types.push('HOME_DELIVERY_EVENING');
    if (has('date_certain')) types.push('HOME_DELIVERY_DATE_CERTAIN');
    if (params.declaredValue > 0) types.push('INSURED_VALUE', 'DECLARED_VALUE');
    return types;
  }

  _parseRateResponse(data, shipmentType, shipDate, { saturday = false, chargeTypes = [], signatureLabel = null } = {}) {
    const rateDetails = data.output?.rateReplyDetails || [];
    if (rateDetails.length === 0) {
      console.warn('[FEDEX-RATE] No rate details returned');
      return [];
    }


    const rates = [];
    for (const detail of rateDetails) {
      const serviceType = detail.serviceType || '';
      // When the ship date allows it, FedEx returns each service twice — normal and with
      // Saturday delivery. Keep only the Saturday ones when the customer asked for it.
      if (Boolean(detail.commit?.saturdayDelivery) !== saturday) continue;
      // FedEx returns the official, trademarked name (e.g. "FedEx International Economy®") —
      // required verbatim for Integrator validation, so it's preferred over any local mapping.
      // Use FedEx's own name when it carries the ® marks; otherwise our trademarked list
      // (the sandbox sometimes returns plain names, e.g. "FedEx Economy").
      const serviceName = detail.serviceName?.includes('®')
        ? detail.serviceName
        : fedexServiceName(serviceType, detail.serviceName);

      // Get the best available rate (prefer ACCOUNT, fall back to LIST)
      const ratedShipmentDetails = detail.ratedShipmentDetails || [];
      let bestRate = null;
      let currency = null;
      let surcharges = [];
      for (const rsd of ratedShipmentDetails) {
        const total = rsd.totalNetCharge;
        if (total != null) {
          bestRate = typeof total === 'number' ? total : parseFloat(total);
          currency = rsd.currency || null;
          surcharges = rsd.shipmentRateDetail?.surCharges || [];
          break;
        }
      }
      // FedEx's charge for each selected option (already in totalNetCharge).
      const accessorialCharges = surcharges
        .filter(c => chargeTypes.includes(c.type) && Number(c.amount) > 0)
        .map(c => ({ code: c.type, label: (c.type === 'SIGNATURE_OPTION' && signatureLabel) || FEDEX_SURCHARGE_LABELS[c.type] || c.description || c.type, amount: Number(c.amount) }));

      if (bestRate == null || isNaN(bestRate)) continue;

      // Extract delivery date and transit time
      let transitDays = null;
      let deliveryDate = null;

      // Get delivery date from commit detail
      if (detail.commit?.dateDetail?.dayFormat) {
        deliveryDate = detail.commit.dateDetail.dayFormat.split('T')[0];
      } else if (detail.operationalDetail?.deliveryDate) {
        deliveryDate = detail.operationalDetail.deliveryDate.split('T')[0];
      }

      // Get transit days: check explicit transitDays/transitTime, else calculate from dates
      const transitObj = detail.commit?.transitDays || detail.operationalDetail?.transitTime;
      if (transitObj) {
        // Can be an object like {minimumTransitTime: "ONE_DAY"} or a string like "ONE_DAY"
        const timeStr = typeof transitObj === 'object' ? transitObj.minimumTransitTime : String(transitObj);
        const wordMap = { 'ONE_DAY': 1, 'TWO_DAYS': 2, 'THREE_DAYS': 3, 'FOUR_DAYS': 4, 'FIVE_DAYS': 5, 'SIX_DAYS': 6, 'SEVEN_DAYS': 7 };
        transitDays = wordMap[timeStr] || null;
        if (!transitDays) {
          const numMatch = String(timeStr).match(/(\d+)/);
          if (numMatch) transitDays = parseInt(numMatch[1], 10);
        }
      }
      if (!transitDays && deliveryDate) {
        // Calculate business days from ship date to delivery date
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

      // Estimate transit days from service type if no data available
      if (!transitDays) {
        const defaultTransit = {
          'FIRST_OVERNIGHT': 1, 'PRIORITY_OVERNIGHT': 1, 'STANDARD_OVERNIGHT': 1,
          'FEDEX_2_DAY': 2, 'FEDEX_2_DAY_AM': 2, 'FEDEX_EXPRESS_SAVER': 3,
          'FEDEX_GROUND': 5, 'GROUND_HOME_DELIVERY': 5, 'FEDEX_INTERNATIONAL_GROUND': 7,
          'FEDEX_INTERNATIONAL_PRIORITY': 3, 'FEDEX_INTERNATIONAL_PRIORITY_EXPRESS': 2,
          'FEDEX_INTERNATIONAL_ECONOMY': 5, 'INTERNATIONAL_ECONOMY': 5,
          'INTERNATIONAL_FIRST': 1, 'SMART_POST': 7,
          'FEDEX_FREIGHT_ECONOMY': 5, 'FEDEX_FREIGHT_PRIORITY': 3,
        };
        transitDays = defaultTransit[serviceType] || 3;
      }

      if (!deliveryDate && transitDays) {
        deliveryDate = formatDate(addBusinessDays(new Date(shipDate + 'T12:00:00'), transitDays));
      }

      // Filter: only include services relevant to the shipment type
      if (!this._isServiceRelevant(serviceType, shipmentType)) continue;

      rates.push({
        serviceName,
        serviceCode: serviceType,
        rate: Math.round(bestRate * 100) / 100,
        accessorialCharges,
        // FedEx can bill in USD even for Canadian origins; rate.service converts to the quote currency.
        ...(currency && { currency }),
        transitDays: transitDays || 0,
        deliveryDate: deliveryDate || '',
        isLive: true,
      });
    }

    // Deduplicate by service name (keep lowest rate per service)
    const deduped = new Map();
    for (const r of rates) {
      const existing = deduped.get(r.serviceName);
      if (!existing || r.rate < existing.rate) {
        deduped.set(r.serviceName, r);
      }
    }

    // Sort by rate
    const result = [...deduped.values()];
    result.sort((a, b) => a.rate - b.rate);
    return result;
  }

  _getFedExServiceTypes(shipmentType) {
    // Don't filter — let FedEx return all available services for the lane
    return [];
  }

  _isServiceRelevant(serviceType, shipmentType) {
    if (!PIW_SERVICES.has(serviceType)) return false;
    // FedEx Freight® LTL services belong to LTL quotes only.
    if (shipmentType === 'ltl') return LTL_SERVICES.has(serviceType);
    if (LTL_SERVICES.has(serviceType)) return false;
    // Envelopes: express (air) services only, no freight.
    if (shipmentType === 'envelope') return !GROUND_SERVICES.has(serviceType) && !serviceType.includes('FREIGHT');
    // Parcels: everything declared, including Express Freight (the only services FedEx returns
    // for heavy parcels, e.g. 200 lb → FedEx 1Day® Freight).
    return true;
  }

  // Turns the quote form's accessorials into FedEx rate/ship request pieces (each shape verified
  // against the sandbox). Throws OptionUnavailableError when FedEx can't provide a selected option
  // on this shipment — sending it anyway makes FedEx reject the whole request.
  _mapAccessorialsToFedEx(accessorials, { usDomestic = false, shipDate, dgType, battery, homeDeliveryDate } = {}) {
    const has = a => accessorials.includes(a);

    // Liftgate and inside delivery are FedEx Freight® services; FedEx parcel services don't offer them.
    if (['liftgate_pickup', 'liftgate_delivery', 'inside_delivery'].some(has)) {
      throw new OptionUnavailableError('Liftgate and inside delivery are FedEx Freight® services, not offered for parcels.', ['liftgate_pickup', 'liftgate_delivery', 'inside_delivery'].filter(has));
    }

    const out = { shipmentTypes: [], residential: has('residential'), saturday: has('saturday') };
    const packageTypes = [];
    const packageSpecialServices = {};

    // Saturday pickup: only on a Saturday ship date (FedEx rejects it on any other day).
    if (has('saturday_pickup')) {
      if (!shipDate || new Date(`${shipDate}T12:00:00`).getDay() !== 6) {
        throw new OptionUnavailableError('FedEx Saturday pickup needs a Saturday pickup date.', ['saturday_pickup']);
      }
      out.shipmentTypes.push('SATURDAY_PICKUP');
    }

    // Hold at a FedEx location: no extra charge; the location itself is picked when booking.
    if (has('hold_at_location')) out.shipmentTypes.push('HOLD_AT_LOCATION');

    // Signature is a package-level service and FedEx requires the type.
    const signature = { signature_none: 'NO_SIGNATURE_REQUIRED', signature_indirect: 'INDIRECT', signature_direct: 'DIRECT', signature_adult: 'ADULT', signature: 'DIRECT' };
    const sigKey = Object.keys(signature).find(has);
    if (sigKey) {
      packageTypes.push('SIGNATURE_OPTION');
      packageSpecialServices.signatureOptionType = signature[sigKey];
    }

    // Dangerous goods (package-level). The class/UN details are only needed when the shipment
    // is created, not for a quote.
    //   ACCESSIBLE / INACCESSIBLE — fully regulated DG (FedEx prices accessible DG higher)
    //   SMALL_QUANTITY_EXCEPTION  — DG in small quantities
    //   BATTERY                   — lithium batteries, IATA Section II (no DG surcharge)
    if (has('hazmat')) {
      packageTypes.push('DANGEROUS_GOODS');
      if (dgType === 'BATTERY') {
        packageSpecialServices.dangerousGoodsDetail = { options: ['BATTERY'] };
        packageSpecialServices.batteryDetails = [{
          batteryMaterialType: battery?.material === 'LITHIUM_METAL' ? 'LITHIUM_METAL' : 'LITHIUM_ION',
          batteryPackingType: battery?.packing === 'PACKED_WITH_EQUIPMENT' ? 'PACKED_WITH_EQUIPMENT' : 'CONTAINED_IN_EQUIPMENT',
          batteryRegulatoryType: 'IATA_SECTION_II',
        }];
      } else {
        packageSpecialServices.dangerousGoodsDetail = {
          accessibility: dgType === 'INACCESSIBLE' ? 'INACCESSIBLE' : 'ACCESSIBLE',
          options: [dgType === 'SMALL_QUANTITY_EXCEPTION' ? 'SMALL_QUANTITY_EXCEPTION' : 'HAZARDOUS_MATERIALS'],
        };
      }
    }

    // FedEx Home Delivery® options (residential, US domestic only): appointment, evening, or a
    // chosen delivery date. Only one can be sent.
    const homeDelivery = has('appointment') ? 'APPOINTMENT'
      : has('evening_delivery') ? 'EVENING'
      : has('date_certain') ? 'DATE_CERTAIN' : null;
    if (homeDelivery) {
      if (!usDomestic) {
        throw new OptionUnavailableError('FedEx Home Delivery® options are only offered for US deliveries.', ['appointment', 'evening_delivery', 'date_certain'].filter(has));
      }
      out.residential = true;
      out.shipmentTypes.push('HOME_DELIVERY_PREMIUM');
      out.homeDeliveryPremiumDetail = {
        homedeliveryPremiumType: homeDelivery,
        ...(homeDelivery === 'DATE_CERTAIN' && homeDeliveryDate && { deliveryDate: homeDeliveryDate }),
      };
    }

    if (packageTypes.length) out.packageSpecialServices = { specialServiceTypes: packageTypes, ...packageSpecialServices };
    return out;
  }

  async getTracking(trackingNumber) {
    if (!this.isLive) throw new Error('FedEx tracking is not available (no live credentials configured)');
    return this._liveGetTracking(trackingNumber);
  }

  async _liveGetTracking(trackingNumber) {
    const token = await getToken();
    const body = {
      trackingInfo: [{
        trackingNumberInfo: { trackingNumber },
      }],
      includeDetailedScans: true,
    };
    const url = `${getBaseUrl()}/track/v1/trackingnumbers`;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_CA',
    };

    let data;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        data = await httpsPost(url, JSON.stringify(body), headers);
        break;
      } catch (err) {
        if ((err.message.includes('401') || err.message.includes('503')) && attempt < 2) {
          console.log(`[FEDEX-TRACK] Attempt ${attempt + 1} failed (${err.message}), retrying...`);
          if (err.message.includes('401')) {
            invalidateToken();
            const freshToken = await getToken();
            headers.Authorization = `Bearer ${freshToken}`;
          }
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        throw err;
      }
    }
    return this._parseTrackResponse(data);
  }

  _parseTrackResponse(data) {
    const trackResult = data.output?.completeTrackResults?.[0]?.trackResults?.[0];
    if (!trackResult) {
      throw new Error('No track results in FedEx response');
    }

    // Map FedEx derivedCode to our status
    const statusCode = trackResult.latestStatusDetail?.derivedCode
      || trackResult.latestStatusDetail?.code || '';
    let status = 'pending';
    const deliveredCodes = ['DL'];
    const transitCodes = ['IT', 'OD', 'DP', 'AR', 'PU', 'AF', 'CC', 'CD', 'OF', 'TR', 'HL'];
    if (deliveredCodes.includes(statusCode)) status = 'delivered';
    else if (transitCodes.includes(statusCode)) status = 'in_transit';

    // Extract key dates
    const dates = trackResult.dateAndTimes || [];
    const estDelivery = dates.find(d => d.type === 'ESTIMATED_DELIVERY')?.dateTime;
    const actualDelivery = dates.find(d => d.type === 'ACTUAL_DELIVERY')?.dateTime;
    const shipDate = dates.find(d => d.type === 'SHIP')?.dateTime;

    // Extract scan events
    const scanEvents = trackResult.scanEvents || [];
    const events = scanEvents.map(scan => ({
      event: scan.eventDescription || scan.eventType || '',
      location: [scan.scanLocation?.city, scan.scanLocation?.stateOrProvinceCode]
        .filter(Boolean).join(', '),
      timestamp: scan.date,
      description: scan.exceptionDescription || '',
    }));

    return {
      status,
      estimatedDelivery: estDelivery || null,
      actualDelivery: actualDelivery || null,
      shipDate: shipDate || null,
      latestStatus: trackResult.latestStatusDetail?.statusByLocale
        || trackResult.latestStatusDetail?.description || '',
      service: fedexServiceName(trackResult.serviceDetail?.type, trackResult.serviceDetail?.description),
      weight: trackResult.packageDetails?.weightAndDimensions?.weight?.[0]
        ? `${trackResult.packageDetails.weightAndDimensions.weight[0].value} ${trackResult.packageDetails.weightAndDimensions.weight[0].unit || 'LB'}`
        : null,
      pieces: trackResult.packageDetails?.count || null,
      events,
      rawResponse: data,
    };
  }

  async bookShipment(details) {
    if (!this.isLive) throw new Error('FedEx booking is not available (no live credentials configured)');
    const result = await this._liveBookShipment(details);
    // App bookings also ask FedEx to come and collect it (test scripts only create labels).
    if (details.requestPickup) result.pickup = await this._requestPickup(details, result);
    return result;
  }

  // FedEx Pickup Request API: the Ship API's USE_SCHEDULED_PICKUP sends no driver, so ask for
  // one in the customer's window. A failed pickup doesn't undo the label: the booking stands
  // and the result says the pickup still has to be arranged.
  async _requestPickup(details, shipResult) {
    const shipper = details.shipper || {};
    const country = shipper.address?.countryCode || 'CA';
    const region = shipper.address?.stateOrProvinceCode;
    const date = details.shipDatestamp || new Date().toISOString().split('T')[0];
    const { ready, close } = pickupWindow(details);
    const today = new Date().toISOString().split('T')[0];
    const body = {
      associatedAccountNumber: { value: carriers.fedex.accountNumber },
      originDetail: {
        pickupLocation: { contact: shipper.contact, address: shipper.address },
        readyDateTimestamp: localTimestamp(date, ready, country, region),
        customerCloseTime: `${close}:00`,
        pickupDateType: date > today ? 'FUTURE_DAY' : 'SAME_DAY',
        packageLocation: 'FRONT',
      },
      totalWeight: { units: 'LB', value: details.weight?.value || 1 },
      packageCount: details.totalPackageCount || 1,
      // FedEx Ground pickups are FDXG in the US only; in Canada FedEx Express collects Ground too.
      carrierCode: country === 'US' && GROUND_SERVICES.has(shipResult.serviceType || details.serviceType) ? 'FDXG' : 'FDXE',
      countryRelationships: country === (details.recipient?.address?.countryCode || country) ? 'DOMESTIC' : 'INTERNATIONAL',
      ...(shipResult.carrierTrackingNumber && { trackingNumber: shipResult.carrierTrackingNumber }),
      remarks: details.customerReference ? `IFF ref ${details.customerReference}` : undefined,
    };
    try {
      const data = await httpsPost(`${getBaseUrl()}/pickup/v1/pickups`, JSON.stringify(body), {
        Authorization: `Bearer ${await getToken()}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_CA',
      });
      const code = data.output?.pickupConfirmationCode;
      if (!code) throw new Error('FedEx returned no pickup confirmation');
      const location = data.output?.location;
      console.log(`[FEDEX-PICKUP] ${code}${location ? ` (${location})` : ''} for ${shipResult.carrierTrackingNumber}`);
      return { scheduled: true, confirmationNumber: location ? `${location}-${code}` : code };
    } catch (err) {
      const fedexError = err.body?.errors?.[0] || {};
      console.error('[FEDEX-PICKUP] Pickup request failed:', fedexError.code || err.message, fedexError.message || '');
      // FedEx takes pickup requests only a business day or so ahead.
      if (fedexError.code === 'PICKUPDATE.TOO.FAR') {
        return { scheduled: false, message: 'FedEx only accepts pickup requests about one business day ahead. IFF will request the pickup closer to the pickup date.' };
      }
      return { scheduled: false, message: `FedEx couldn't schedule the pickup${fedexError.message ? ` (${fedexError.message.replace(/\.$/, '')})` : ''}. IFF will arrange it.` };
    }
  }

  async _liveBookShipment(details) {
    if (!details.serviceType) {
      throw new Error('serviceType is required for live FedEx shipment booking');
    }
    const token = await getToken();
    const body = this._buildShipRequest(details);
    const url = `${getBaseUrl()}/ship/v1/shipments`;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_CA',
    };
    const bodyStr = JSON.stringify(body);

    let data;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        data = await httpsPost(url, bodyStr, headers);
        break;
      } catch (err) {
        if ((err.message.includes('401') || err.message.includes('503')) && attempt < 2) {
          console.log(`[FEDEX-SHIP] Attempt ${attempt + 1} failed (${err.message}), retrying...`);
          if (err.message.includes('401')) {
            invalidateToken();
            const freshToken = await getToken();
            headers.Authorization = `Bearer ${freshToken}`;
          }
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        throw err;
      }
    }
    return this._parseShipResponse(data);
  }

  _buildShipRequest(details) {
    const accountNumber = carriers.fedex.accountNumber;
    const packagingType = details.packagingType || 'YOUR_PACKAGING';
    const shipDate = details.shipDatestamp || new Date().toISOString().split('T')[0];
    const usDomestic = details.shipper?.address?.countryCode === 'US' && details.recipient?.address?.countryCode === 'US';

    // The same options the customer was quoted for (see _mapAccessorialsToFedEx).
    const special = this._mapAccessorialsToFedEx(details.accessorials || [], {
      usDomestic, shipDate,
      dgType: details.options?.dgType,
      battery: details.options?.battery,
      homeDeliveryDate: details.options?.homeDeliveryDate,
    });

    const recipient = special.residential
      ? { ...details.recipient, address: { ...details.recipient.address, residential: true } }
      : details.recipient;

    const shipmentTypes = [...special.shipmentTypes];
    // Rating finds Saturday delivery from the ship date; shipping must ask for it explicitly.
    if (special.saturday) shipmentTypes.push('SATURDAY_DELIVERY');
    if (details.options?.fedexOneRate && packagingType !== 'YOUR_PACKAGING' && usDomestic) shipmentTypes.push('FEDEX_ONE_RATE');
    const shipmentSpecialServices = shipmentTypes.length ? { specialServiceTypes: shipmentTypes } : null;

    if (shipmentTypes.includes('HOLD_AT_LOCATION')) {
      const hal = details.holdAtLocation;
      if (!hal?.locationId) throw new Error('A FedEx hold location is required for Hold at Location');
      shipmentSpecialServices.holdAtLocationDetail = {
        locationId: hal.locationId,
        locationType: hal.locationType,
        locationContactAndAddress: { address: hal.address },
      };
    }
    if (special.homeDeliveryPremiumDetail) {
      const type = special.homeDeliveryPremiumDetail.homedeliveryPremiumType;
      // FedEx calls the recipient to arrange appointment / date certain deliveries.
      const phone = (details.recipient?.contact?.phoneNumber || '').replace(/\D/g, '').slice(-10);
      shipmentSpecialServices.homeDeliveryPremiumDetail = {
        ...special.homeDeliveryPremiumDetail,
        ...(type !== 'EVENING' && phone.length === 10 && { phoneNumber: { areaCode: phone.slice(0, 3), localNumber: phone.slice(3) } }),
      };
    }

    const body = {
      labelResponseOptions: 'LABEL',
      accountNumber: { value: accountNumber },
      requestedShipment: {
        shipDatestamp: shipDate,
        serviceType: details.serviceType,
        packagingType,
        pickupType: details.requestPickup ? 'CONTACT_FEDEX_TO_SCHEDULE' : 'USE_SCHEDULED_PICKUP',
        shipper: details.shipper,
        // Ship API uses "recipients" (plural array), unlike Rate API's singular "recipient"
        recipients: [recipient],
        shippingChargesPayment: this._buildShipPayment(details.shippingChargesPayment, accountNumber),
        labelSpecification: {
          imageType: details.labelSpecification?.imageType || 'PDF',
          labelStockType: details.labelSpecification?.labelStockType || 'PAPER_85X11_TOP_HALF_LABEL',
        },
        requestedPackageLineItems: [{
          weight: details.weight,
          ...(special.packageSpecialServices && { packageSpecialServices: special.packageSpecialServices }),
          ...(details.declaredValue?.amount > 0 && { declaredValue: details.declaredValue }),
          // FedEx-branded packaging has fixed dimensions.
          ...(packagingType === 'YOUR_PACKAGING' && details.dimensions && details.dimensions.length && {
            dimensions: {
              length: details.dimensions.length,
              width: details.dimensions.width,
              height: details.dimensions.height,
              units: details.dimensions.units || 'IN',
            },
          }),
          ...(details.customerReference && {
            customerReferences: [{
              customerReferenceType: 'CUSTOMER_REFERENCE',
              value: details.customerReference,
            }],
          }),
        }],
      },
    };

    if (shipmentSpecialServices) body.requestedShipment.shipmentSpecialServices = shipmentSpecialServices;
    // Explicit special services passed by test scripts override the mapped ones.
    if (details.specialServices) {
      body.requestedShipment.shipmentSpecialServices = details.specialServices;
    }

    // International customs clearance
    if (details.customsClearanceDetail) {
      body.requestedShipment.customsClearanceDetail = details.customsClearanceDetail;
    }

    // Block insight visibility (some test cases set this)
    if (details.blockInsightVisibility !== undefined) {
      body.requestedShipment.blockInsightVisibility = details.blockInsightVisibility;
    }

    // Rate request type (some test cases include this)
    if (details.rateRequestType) {
      body.requestedShipment.rateRequestType = details.rateRequestType;
    }

    // Total package count
    if (details.totalPackageCount) {
      body.requestedShipment.totalPackageCount = details.totalPackageCount;
    }

    return body;
  }

  _buildShipPayment(paymentConfig, fallbackAccountNumber) {
    if (!paymentConfig || paymentConfig.paymentType === 'SENDER') {
      return { paymentType: 'SENDER' };
    }
    return {
      paymentType: paymentConfig.paymentType,
      payor: {
        responsibleParty: {
          accountNumber: { value: paymentConfig.accountNumber || fallbackAccountNumber },
          ...(paymentConfig.contact && { contact: paymentConfig.contact }),
          ...(paymentConfig.countryCode && { address: { countryCode: paymentConfig.countryCode } }),
        },
      },
    };
  }

  _parseShipResponse(data) {
    const shipment = data.output?.transactionShipments?.[0];
    if (!shipment) {
      throw new Error('No transactionShipments in FedEx Ship response');
    }

    const trackingNumber = shipment.masterTrackingNumber
      || shipment.pieceResponses?.[0]?.trackingNumber
      || null;

    // Extract label from pieceResponses
    let label = null;
    const doc = shipment.pieceResponses?.[0]?.packageDocuments?.[0];
    if (doc) {
      label = {
        encodedLabel: doc.encodedLabel || null,
        url: doc.url || null,
        docType: doc.docType,
        contentType: doc.contentType,
      };
    }

    // Log any alerts
    if (data.output?.alerts?.length) {
      console.warn('[FEDEX-SHIP] Alerts:', data.output.alerts.map(a => `${a.code}: ${a.message}`).join('; '));
    }

    return {
      carrierTrackingNumber: trackingNumber,
      confirmationNumber: trackingNumber,
      status: 'confirmed',
      label,
      serviceType: shipment.serviceType,
      serviceName: shipment.serviceName,
      shipDatestamp: shipment.shipDatestamp,
      rawResponse: data,
    };
  }
}

module.exports = new FedExAdapter();
