const CarrierAdapter = require('./CarrierAdapter');
const { addBusinessDays, formatDate } = require('../utils/dateHelpers');
const { getToken, getBaseUrl, httpsPost, invalidateToken } = require('../services/fedexAuth.service');
const { carriers } = require('../config/env');

class FedExAdapter extends CarrierAdapter {
  get id() { return 'fedex'; }
  get name() { return 'FedEx'; }
  get isLive() { return !!process.env.FEDEX_API_KEY; }

  async getRates(params) {
    if (!this.isLive) return [];
    try {
      return await this._getLiveRates(params);
    } catch (err) {
      console.error('[FEDEX-RATE] Live rates failed:', err.message);
      return [];
    }
  }

  async _getLiveRates(params) {
    const { shipmentType, origin, destination, weight, pieces, dimensions, pickupDate, accessorials = [] } = params;
    const token = await getToken();
    const accountNumber = carriers.fedex.accountNumber;

    const shipDate = pickupDate || new Date().toISOString().split('T')[0];

    // Use YOUR_PACKAGING for all shipment types — FEDEX_ENVELOPE restricts which
    // services FedEx will return and causes SERVICE.PACKAGECOMBINATION.INVALID errors
    // when no specific serviceType is requested (we ask FedEx for all available services).
    const packagingType = 'YOUR_PACKAGING';

    // Build requested service types based on shipment type
    const serviceTypes = this._getFedExServiceTypes(shipmentType);

    // Build special services from accessorials
    const specialServiceTypes = this._mapAccessorialsToFedEx(accessorials);

    // Build the package line item
    const packageLineItem = {
      weight: { units: 'LB', value: weight || 1 },
    };
    if (dimensions && dimensions.length && dimensions.width && dimensions.height) {
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
          },
        },
        pickupType: 'USE_SCHEDULED_PICKUP',
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

    const url = `${getBaseUrl()}/rate/v1/rates/quotes`;
    const rateHeaders = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_CA',
    };
    const bodyStr = JSON.stringify(body);

    // FedEx sandbox sometimes rejects requests with 401/503 while tokens
    // propagate across gateway nodes — retry up to 2 times with a brief delay.
    // On 401, invalidate the cached token and re-authenticate before retrying.
    let data;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        data = await httpsPost(url, bodyStr, rateHeaders);
        break;
      } catch (err) {
        lastErr = err;
        if ((err.message.includes('401') || err.message.includes('503')) && attempt < 2) {
          if (err.message.includes('401')) {
            invalidateToken();
            const freshToken = await getToken();
            rateHeaders.Authorization = `Bearer ${freshToken}`;
          }
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        throw err;
      }
    }
    return this._parseRateResponse(data, shipmentType, shipDate);
  }

  _parseRateResponse(data, shipmentType, shipDate) {
    const rateDetails = data.output?.rateReplyDetails || [];
    if (rateDetails.length === 0) {
      console.warn('[FEDEX-RATE] No rate details returned');
      return [];
    }

    // Map FedEx service type codes to friendly names
    const serviceNameMap = {
      'FEDEX_EXPRESS_SAVER': 'Express Saver',
      'FEDEX_GROUND': 'Ground',
      'FEDEX_2_DAY': '2Day',
      'FEDEX_2_DAY_AM': '2Day AM',
      'PRIORITY_OVERNIGHT': 'Priority Overnight',
      'STANDARD_OVERNIGHT': 'Standard Overnight',
      'FIRST_OVERNIGHT': 'First Overnight',
      'FEDEX_FREIGHT_ECONOMY': 'Freight Economy',
      'FEDEX_FREIGHT_PRIORITY': 'Freight Priority',
      'FEDEX_INTERNATIONAL_PRIORITY': 'International Priority',
      'FEDEX_INTERNATIONAL_ECONOMY': 'International Economy',
      'INTERNATIONAL_ECONOMY': 'International Economy',
      'INTERNATIONAL_FIRST': 'International First',
      'FEDEX_INTERNATIONAL_PRIORITY_EXPRESS': 'International Priority Express',
      'GROUND_HOME_DELIVERY': 'Home Delivery',
      'SMART_POST': 'Ground Economy',
      'FEDEX_INTERNATIONAL_GROUND': 'International Ground',
      'FEDEX_FIRST_FREIGHT': 'First Freight',
    };

    const rates = [];
    for (const detail of rateDetails) {
      const serviceType = detail.serviceType || '';
      const serviceName = serviceNameMap[serviceType] || serviceType.replace(/_/g, ' ').replace(/FEDEX /i, '');

      // Get the best available rate (prefer ACCOUNT, fall back to LIST)
      const ratedShipmentDetails = detail.ratedShipmentDetails || [];
      let bestRate = null;
      for (const rsd of ratedShipmentDetails) {
        const total = rsd.totalNetCharge;
        if (total != null) {
          bestRate = typeof total === 'number' ? total : parseFloat(total);
          break;
        }
      }

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
    const freightServices = ['FEDEX_FREIGHT_ECONOMY', 'FEDEX_FREIGHT_PRIORITY', 'FEDEX_FIRST_FREIGHT'];
    const expressServices = ['FEDEX_EXPRESS_SAVER', 'PRIORITY_OVERNIGHT', 'STANDARD_OVERNIGHT', 'FIRST_OVERNIGHT',
      'FEDEX_2_DAY', 'FEDEX_2_DAY_AM', 'FEDEX_INTERNATIONAL_PRIORITY', 'FEDEX_INTERNATIONAL_ECONOMY',
      'INTERNATIONAL_ECONOMY', 'INTERNATIONAL_FIRST', 'FEDEX_INTERNATIONAL_PRIORITY_EXPRESS'];
    const groundServices = ['FEDEX_GROUND', 'GROUND_HOME_DELIVERY', 'SMART_POST', 'FEDEX_INTERNATIONAL_GROUND'];

    if (shipmentType === 'ltl') {
      return freightServices.includes(serviceType);
    }
    if (shipmentType === 'envelope') {
      return expressServices.includes(serviceType);
    }
    // Parcel: show both express and ground
    return expressServices.includes(serviceType) || groundServices.includes(serviceType);
  }

  _mapAccessorialsToFedEx(accessorials) {
    const map = {
      'residential': 'HOME_DELIVERY_PREMIUM',
      'saturday': 'SATURDAY_DELIVERY',
      'signature': 'SIGNATURE_OPTION',
      'hazmat': 'DANGEROUS_GOODS',
      'inside_delivery': 'INSIDE_DELIVERY',
      'appointment': 'APPOINTMENT_DELIVERY',
      'liftgate_pickup': 'LIFTGATE_PICK_UP',
      'liftgate_delivery': 'LIFTGATE_DELIVERY',
    };
    return accessorials.filter(a => map[a]).map(a => map[a]);
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
      service: trackResult.serviceDetail?.description || '',
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
    return this._liveBookShipment(details);
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

    const body = {
      labelResponseOptions: 'LABEL',
      accountNumber: { value: accountNumber },
      requestedShipment: {
        shipDatestamp: details.shipDatestamp || new Date().toISOString().split('T')[0],
        serviceType: details.serviceType,
        packagingType: details.packagingType || 'YOUR_PACKAGING',
        pickupType: 'USE_SCHEDULED_PICKUP',
        shipper: details.shipper,
        // Ship API uses "recipients" (plural array), unlike Rate API's singular "recipient"
        recipients: [details.recipient],
        shippingChargesPayment: this._buildShipPayment(details.shippingChargesPayment, accountNumber),
        labelSpecification: {
          imageType: details.labelSpecification?.imageType || 'PDF',
          labelStockType: details.labelSpecification?.labelStockType || 'PAPER_85X11_TOP_HALF_LABEL',
        },
        requestedPackageLineItems: [{
          weight: details.weight,
          ...(details.dimensions && details.dimensions.length && {
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

    // Special services (Saturday delivery, signature option, etc.)
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
