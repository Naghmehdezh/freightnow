const CarrierAdapter = require('./CarrierAdapter');
const { addBusinessDays, formatDate } = require('../utils/dateHelpers');
const { detectScope } = require('../utils/shipmentScope');
const { trace: polarisTrace, rate: polarisRate, createOrder: polarisCreateOrder } = require('../services/polarisApi.service');

// Polaris's real Rate/ClassRate APIs "only support cross border rates... between the US and
// Canada, or Canada and the US. It does not accommodate domestic shipping rates." That's a
// permanent limitation of their API, not a build choice — a domestic or non-LTL request simply
// has no rate to offer, never a fabricated estimate standing in for one.
class PolarisAdapter extends CarrierAdapter {
  get id() { return 'polaris'; }
  get name() { return 'Polaris'; }
  get isLive() { return !!process.env.POLARIS_API_KEY; }

  // ─── getRates ─────────────────────────────────────────────────

  async getRates(params) {
    // Polaris is LTL-only, and only cross-border (CA<->US) for live rating.
    if (params.shipmentType !== 'ltl') return [];
    const scope = detectScope(params.origin.country, params.destination.country);
    if (scope !== 'xb') return [];
    if (!this.isLive) return [];

    try {
      return await this._getLiveRates(params);
    } catch (err) {
      console.error('[POLARIS-RATE] Live rates failed:', err.message);
      return [];
    }
  }

  async _getLiveRates(params) {
    const { origin, destination, weight, pieces, dimensions, freightClass, pickupDate, accessorials = [] } = params;

    const numSkids = pieces || 1;
    const dimL = (dimensions && dimensions.length) || 48;
    const dimW = (dimensions && dimensions.width) || 48;
    const dimH = (dimensions && dimensions.height) || 48;

    const body = {
      RATE_API: {
        From_PC_ZIP: origin.postalCode || origin.city,
        To_PC_ZIP: destination.postalCode || destination.city,
        Total_Weight_lbs: weight,
        Number_of_Skids: numSkids,
        ...(freightClass && { Class: String(freightClass) }),
        ...(pickupDate && { Pickup_Date: pickupDate }),
        ShipInstructions: this._mapAccessorials(accessorials),
        SkidDimensions: [{ Skid: 1, Length: Math.round(dimL), Width: Math.round(dimW), Height: Math.round(dimH) }],
      },
    };

    const data = await polarisRate(body);
    return this._parseRateResponse(data, pickupDate);
  }

  _mapAccessorials(accessorials) {
    // Only accessorials with a direct Polaris ShipInstructions field are represented — the
    // rest (hazmat/saturday/signature) have no equivalent on this endpoint.
    const has = (code) => accessorials.includes(code) ? 'Y' : 'N';
    return {
      Inside_Pickup: 'N',
      Residential_Pickup: 'N',
      Lifgate_Pickup: has('liftgate_pickup'),
      Inside_Delivery: has('inside_delivery'),
      Residential_Delivery: has('residential'),
      Lifgate_Delivery: has('liftgate_delivery'),
      Appointment_Delivery: has('appointment'),
      OverSizeFreight: 'N',
      Do_Not_Stack: 'N',
      In_Bond: 'N',
      Limited_Access_Pickup: 'N',
      Limited_Access_Delivery: 'N',
    };
  }

  _parseRateResponse(data, pickupDate) {
    const resp = data.Rate_API_Response || data;
    if (!resp || resp.Error === 'Y') {
      console.warn('[POLARIS-RATE] Carrier returned an error:', resp && resp.Message);
      return [];
    }

    const totalCharge = parseFloat(resp.Total_Charge);
    if (!totalCharge) return [];

    const baseDate = pickupDate ? new Date(pickupDate + 'T12:00:00') : new Date();
    let transitDays = 5;
    let deliveryDate = resp.Delivery_Date ? resp.Delivery_Date.split('T')[0] : null;
    if (resp.Pickup_Date && resp.Delivery_Date) {
      const days = Math.round((new Date(resp.Delivery_Date) - new Date(resp.Pickup_Date)) / 86400000);
      if (days > 0) transitDays = days;
    }
    if (!deliveryDate) deliveryDate = formatDate(addBusinessDays(baseDate, transitDays));

    return [{
      serviceName: 'Polaris Cross-Border LTL',
      serviceCode: 'CBLTL',
      rate: Math.round(totalCharge * 100) / 100,
      transitDays,
      deliveryDate,
      isLive: true,
      totalCharges: totalCharge,
      quoteReference: resp.Bill_Number || null,
    }];
  }

  // ─── getTracking ──────────────────────────────────────────────

  async getTracking(trackingNumber) {
    if (!this.isLive) throw new Error('Polaris tracking is not available (no live credentials configured)');
    return this._liveGetTracking(trackingNumber);
  }

  async _liveGetTracking(trackingNumber) {
    const data = await polarisTrace(trackingNumber);
    const resp = data.TRACE_API_Response || data;
    if (!resp || !resp.Probill_Number) {
      throw new Error((resp && resp.Message) || 'No Polaris trace record found');
    }

    // Polaris's Trace API returns a single current-state snapshot, not an event history —
    // events stays empty, and the real value is in status/estimatedDelivery (same limitation
    // Day & Ross's live tracking has today).
    return {
      status: this._mapTraceStatus(resp.Current_Status),
      estimatedDelivery: resp.Deliver_by || null,
      actualDelivery: resp.Actual_Delivery || null,
      shipDate: resp.Actual_Pickup || null,
      latestStatus: resp.Current_Status || '',
      service: 'Polaris Cross-Border LTL',
      weight: resp.Weight_LBS ? parseFloat(resp.Weight_LBS) : null,
      pieces: resp.Pallets ? parseFloat(resp.Pallets) : null,
      events: [],
      rawResponse: data,
    };
  }

  _mapTraceStatus(status) {
    const s = (status || '').toUpperCase();
    if (s.includes('DELIVER')) return 'delivered';
    if (s.includes('TRANSIT') || s.includes('PICK')) return 'in_transit';
    return 'pending';
  }

  // ─── bookShipment ─────────────────────────────────────────────

  async bookShipment(details) {
    if (!this.isLive) throw new Error('Polaris booking is not available (no live credentials configured)');
    return this._liveBookShipment(details);
  }

  async _liveBookShipment(details) {
    const shipperAddr = details.shipper?.address || {};
    const shipperContact = details.shipper?.contact || {};
    const recipientAddr = details.recipient?.address || {};
    const recipientContact = details.recipient?.contact || {};

    const now = new Date();
    const pickupFrom = details.shipDatestamp || now.toISOString();
    const pickupTo = pickupFrom;

    const body = {
      OrderSubmittion: {
        Shipment_id: details.customerReference || `IFF-${Date.now()}`,
        Contact_name: shipperContact.personName || 'Shipping',
        Contact_email: shipperContact.email || 'shipping@iffcargo.com',
        Contact_phone: shipperContact.phoneNumber || null,
        Pickup_FromTime: pickupFrom,
        Pickup_ToTime: pickupTo,
        Deliver_FromTime: pickupFrom,
        Deliver_ToTime: pickupTo,
        Shipper: {
          name: (shipperContact.companyName || shipperContact.personName || 'Shipper').substring(0, 40),
          street1: (shipperAddr.streetLines || [])[0] || 'N/A',
          city: shipperAddr.city || '',
          province: shipperAddr.stateOrProvinceCode || '',
          postalcode: shipperAddr.postalCode || '',
          country: shipperAddr.countryCode || 'CA',
          contact: shipperContact.personName || '',
          phone: shipperContact.phoneNumber || '',
          email: shipperContact.email || '',
        },
        Consignee: {
          name: (recipientContact.companyName || recipientContact.personName || 'Consignee').substring(0, 40),
          street1: (recipientAddr.streetLines || [])[0] || 'N/A',
          city: recipientAddr.city || '',
          province: recipientAddr.stateOrProvinceCode || '',
          postalcode: recipientAddr.postalCode || '',
          country: recipientAddr.countryCode || 'US',
          contact: recipientContact.personName || '',
          phone: recipientContact.phoneNumber || '',
          email: recipientContact.email || '',
        },
        ShipInstructions: this._mapAccessorials([]),
        DetailLines: [{
          Seq: 1,
          Description: details.commodity || 'General freight',
          Pallets: details.totalPackageCount || 1,
          TotalWeight: details.weight?.value || 0,
          Class: details.freightClass ? String(details.freightClass) : undefined,
          Skid_Dimension1: {
            Length: Math.round(details.dimensions?.length || 48),
            Width: Math.round(details.dimensions?.width || 48),
            Height: Math.round(details.dimensions?.height || 48),
          },
        }],
      },
    };

    const data = await polarisCreateOrder(body);
    const resp = data.OE_Response || data;
    if (!resp || resp.Error === 'Y' || !resp.Order_Number) {
      throw new Error((resp && resp.Message) || 'Polaris order submission returned no order number');
    }

    return {
      carrierTrackingNumber: resp.Order_Number,
      confirmationNumber: resp.Order_Number,
      status: 'confirmed',
      // Polaris's OE_Response does not include a BOL/label field at all (confirmed against
      // real test bookings, not just the docs) — unlike DHL, there's nothing here to surface.
      // If this ever changes, the shape must match shipment.service.js's expectation
      // (label.encodedLabel) the same way dhl.adapter.js's label already does.
      label: null,
      serviceType: 'CBLTL',
      totalCharges: resp.Total_Charge,
      rawResponse: data,
    };
  }
}

module.exports = new PolarisAdapter();
