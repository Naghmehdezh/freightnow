const CarrierAdapter = require('./CarrierAdapter');
const { addBusinessDays, formatDate } = require('../utils/dateHelpers');
const { pickupWindow } = require('../utils/pickupWindow');
const { localTimestamp } = require('../utils/timeZones');
const xpoApi = require('../services/xpoApi.service');
const { SUPPORT, titleCase } = require('./accessorials');

// XPO LTL — rating, tracking and booking are live via XPO's LTL APIs (see services/xpoApi.service.js).
// Booking creates a Bill of Lading with a pickup request. It runs in XPO's test mode (no real
// pickup) unless XPO_BOL_TEST_MODE=N is set in backend/.env.

// IFF's XPO bill-to (from XPO's API setup email): XPO bills IFF for every BOL we create. XPO
// matches the bill-to by name and address; sending the account id fails ("Membership service").
const IFF_BILL_TO = {
  name: 'International Freight Fwrdrs',
  addressLine1: '452 Plaza Dr Ste A',
  cityName: 'Atlanta',
  stateCd: 'GA',
  countryCd: 'US',
  postalCd: '30349',
};

// Options the BOL accepts as additional services (XPO_API_BOL_Guide.pdf, accsrlCode list).
// Hazmat goes on the commodity line instead; excessive length and in-bond have no BOL code.
const BOL_SERVICE_CODES = ['APT', 'DID', 'DLA', 'DLG', 'DNC', 'DSH', 'OIP', 'OLA', 'OLG', 'RSD', 'RSO'];
const PRO_LOOKUP_TRIES = 3;
const PRO_LOOKUP_DELAY_MS = 1500;
class XPOAdapter extends CarrierAdapter {
  get id() { return 'xpo'; }
  get name() { return 'XPO Logistics'; }
  get isLive() { return xpoApi.isConfigured(); }

  // ─── getRates ─────────────────────────────────────────────────

  async getRates(params) {
    if (params.shipmentType !== 'ltl') return [];
    if (!this.isLive) return [];

    try {
      return await this._getLiveRates(params);
    } catch (err) {
      console.error('[XPO-RATE] Live rates failed:', err.message);
      return [];
    }
  }

  async _getLiveRates(params) {
    const { origin, destination, weight, pieces, dimensions, freightClass, pickupDate, accessorials = [] } = params;
    const xpoAccessorials = this._mapAccessorials(accessorials, dimensions);
    const count = pieces || 1;

    const body = {
      shipmentInfo: {
        paymentTermCd: 'P', // prepaid, billed to IFF's Bill-To account below
        accessorials: xpoAccessorials,
        // One commodity line per group of identical pieces.
        commodity: (params.lineItems?.length ? params.lineItems : [{
          pieces: count, weight: weight / count, freightClass,
          length: dimensions?.length || 48, width: dimensions?.width || 40, height: dimensions?.height || 40,
        }]).map(i => ({
          grossWeight: { weight: Math.round(i.weight * i.pieces), weightUom: 'LBS' },
          nmfcClass: i.freightClass ? String(i.freightClass) : '70',
          hazmatInd: accessorials.includes('hazmat'),
          pieceCnt: i.pieces,
          dimensions: {
            length: Math.round(i.length),
            width: Math.round(i.width),
            height: Math.round(i.height),
            dimensionsUom: 'INCH',
          },
        })),
        shipper: { address: { postalCd: this._postal(origin) } },
        consignee: { address: { postalCd: this._postal(destination) } },
        // Only one party may carry an account number per request — XPO rejects a shipper
        // account and a bill-to account together, so origin stays address-only.
        bill2Party: { acctInstId: process.env.XPO_BILL_ACCOUNT },
        shipmentDate: `${this._shipDate(pickupDate)}T${pickupWindow(params).ready}:00.000-0500`,
        palletCnt: count,
        linealFt: 0,
      },
    };

    const data = await xpoApi.rateQuote(body);
    return this._parseRateResponse(data, pickupDate, xpoAccessorials.map(a => a.accessorialCd));
  }

  // App options → XPO accessorial codes (confirmed via XPO's accessorial list endpoint).
  _mapAccessorials(accessorials, dimensions) {
    const out = [];
    for (const option of accessorials) {
      const code = SUPPORT.xpo[option];
      if (!code || out.some(a => a.accessorialCd === code)) continue;
      // Excessive length is charged by length, in inches.
      if (code === 'ELS') out.push({ accessorialCd: 'ELS', quantity: Math.round(dimensions?.length || 96), quantityUom: 'Inch' });
      else out.push({ accessorialCd: code });
    }
    return out;
  }

  // XPO wants Canadian postal codes without the space and US ZIPs as 5 digits.
  _postal(loc) {
    const raw = String(loc?.postalCode || '').replace(/\s+/g, '').toUpperCase();
    return loc?.country === 'US' ? raw.slice(0, 5) : raw;
  }

  // XPO rates for the requested pickup date; fall back to the next business day when none
  // is given or it's already in the past.
  _shipDate(pickupDate) {
    const today = new Date().toISOString().split('T')[0];
    if (pickupDate && pickupDate >= today) return pickupDate;
    return formatDate(addBusinessDays(new Date(), 1));
  }

  _parseRateResponse(data, pickupDate, sentCodes = []) {
    const rq = data?.data?.rateQuote;
    const charge = rq?.totCharge?.[0];
    const amount = parseFloat(charge?.amt);
    if (!amount) return [];

    const transit = data.data.transitTime || {};
    const transitDays = Number(transit.transitDays) || 5;
    const baseDate = pickupDate ? new Date(`${pickupDate}T12:00:00`) : new Date();
    const deliveryDate = transit.estdDlvrDate
      ? new Date(transit.estdDlvrDate).toISOString().split('T')[0]
      : formatDate(addBusinessDays(baseDate, transitDays));

    // totCharge already includes the requested accessorials (and tax); list their charges.
    // XPO labels each line's currency inconsistently, but the amounts add up in totCharge's currency.
    const accessorialCharges = (rq.shipmentInfo?.accessorials || [])
      .filter(a => sentCodes.includes(a.accessorialCd) && parseFloat(a.chargeAmt?.amt) > 0)
      .map(a => ({
        code: a.accessorialCd,
        // XPO's ELS description carries the dimensions ("EXCESS LN 200.0X00.00X00.00").
        label: a.accessorialCd === 'ELS' ? 'Excessive Length' : titleCase(a.accessorialDesc || a.accessorialCd),
        amount: parseFloat(a.chargeAmt.amt),
      }));

    return [{
      serviceName: 'LTL Standard',
      serviceCode: rq.confirmationNbr || null,
      rate: Math.round(amount * 100) / 100,
      accessorialCharges,
      // XPO quotes in USD; rate.service converts to the quote's currency before pricing.
      currency: charge.currencyCd || 'USD',
      transitDays,
      deliveryDate,
      isLive: true,
      quoteReference: rq.confirmationNbr || null,
    }];
  }

  // ─── getTracking ──────────────────────────────────────────────

  async getTracking(trackingNumber) {
    if (!this.isLive) throw new Error('XPO tracking is not available (no live credentials configured)');

    const [statusRes, eventsRes] = await Promise.all([
      xpoApi.getShipmentStatus(trackingNumber),
      xpoApi.listTrackingEvents(trackingNumber).catch((err) => {
        console.error('[XPO-TRACK] Event history failed:', err.message);
        return null;
      }),
    ]);

    const record = statusRes?.data?.shipmentStatusDtls?.[0];
    if (!record) throw new Error('No XPO tracking record found for this PRO number');

    const status = record.shipmentStatus || {};
    const toDate = ms => (ms ? new Date(ms).toISOString() : null);
    const events = (eventsRes?.data?.shipmentTrackingEvent || []).map((e) => {
      const hdr = e.eventHdr || e.evtHdr || {};
      const loc = e.eventOccrdLoc || {};
      return {
        event: hdr.eventDesc || hdr.evtDesc || '',
        location: [loc.cityName, loc.stateCd].filter(Boolean).join(', '),
        timestamp: toDate(hdr.eventTmst || hdr.evtTmst),
        description: hdr.eventDesc || hdr.evtDesc || '',
      };
    });

    return {
      status: this._mapStatus(status.statusCd),
      estimatedDelivery: toDate(record.estdDlvrDate),
      actualDelivery: toDate(record.finalDlvrDate),
      shipDate: toDate(record.pkupDate),
      latestStatus: (status.description || status.reason || '').trim(),
      service: 'XPO LTL',
      weight: record.totWeight?.weight || null,
      pieces: record.totPiecesCnt || null,
      events,
      rawResponse: { status: statusRes, events: eventsRes },
    };
  }

  // Status codes from the XPO Shipment Tracking guide, appendix 6.1.
  _mapStatus(code) {
    const c = String(code || '');
    if (['23', '20', '28'].includes(c)) return 'delivered'; // delivered / part short / pending review
    if (['32', '26', ''].includes(c)) return 'pending';     // only recorded, or cancelled
    return 'in_transit';
  }

  // ─── bookShipment ─────────────────────────────────────────────

  async bookShipment(details) {
    if (!this.isLive) throw new Error('XPO booking is not available (no live credentials configured)');
    return this._liveBookShipment(details);
  }

  async _liveBookShipment(details) {
    const body = this._buildBol(details);
    const testMode = xpoApi.bolTestMode() === 'Y';
    const created = await xpoApi.createBol(body);
    const info = created?.data?.bolInfo || {};
    if (!info.bolInstId) throw new Error('XPO BOL creation returned no BOL id');

    // The PRO number (the tracking number) usually comes back with the BOL; otherwise ask again.
    let proNbr = info.proNbr || null;
    for (let i = 0; i < PRO_LOOKUP_TRIES && !proNbr; i++) {
      await new Promise(r => setTimeout(r, PRO_LOOKUP_DELAY_MS));
      try {
        const bol = (await xpoApi.getBol(info.bolInstId))?.data?.billOfLading;
        proNbr = bol?.proNbr || null;
      } catch (err) {
        console.error('[XPO] BOL lookup failed:', err.message);
      }
    }

    let label = null;
    try {
      const pdf = (await xpoApi.getBolPdf(info.bolInstId))?.data?.bolpdf;
      if (typeof pdf?.contentType === 'string' && pdf.contentType.length > 100) {
        label = { encodedLabel: pdf.contentType, url: null, docType: 'PDF', contentType: 'application/pdf' };
      }
    } catch (err) {
      console.error('[XPO] BOL PDF failed:', err.message);
    }

    console.log(`[XPO] BOL ${info.bolInstId}${proNbr ? ` PRO ${proNbr}` : ''}${testMode ? ' (test mode, no pickup dispatched)' : ''}`
      + `${info.pkupConfNbr ? `, pickup ${info.pkupConfNbr} at ${info.pkupTrmnlSic || '?'}` : ''}`);

    return {
      // Without a PRO yet, the BOL id is the reference until XPO assigns one.
      carrierTrackingNumber: proNbr || info.bolInstId,
      confirmationNumber: info.pkupConfNbr || info.pkupInstId || info.bolInstId,
      bolInstId: info.bolInstId,
      status: 'confirmed',
      label,
      serviceType: 'LTL',
      testMode,
      pickup: info.pkupConfNbr
        ? { scheduled: true, confirmationNumber: info.pkupConfNbr }
        : { scheduled: false, message: "XPO didn't confirm a pickup for this BOL. IFF will arrange it." },
      rawResponse: created,
    };
  }

  _buildBol(details) {
    const shipper = details.shipper || {};
    const recipient = details.recipient || {};
    const originCountry = shipper.address?.countryCode || 'CA';
    const destCountry = recipient.address?.countryCode || 'US';
    const pickupDate = this._shipDate(details.shipDatestamp);
    const { ready, close } = pickupWindow(details);
    const accessorials = details.accessorials || [];
    const hazmat = accessorials.includes('hazmat');

    const services = this._mapAccessorials(accessorials, details.dimensions)
      .map(a => a.accessorialCd)
      .filter(code => BOL_SERVICE_CODES.includes(code))
      .map(accsrlCode => ({ accsrlCode, prepaidOrCollect: 'P' }));

    const remarks = [
      details.customerReference && `IFF ref ${details.customerReference}`,
      accessorials.includes('oversize') && 'Excessive length freight',
      accessorials.includes('in_bond') && 'In-bond shipment',
    ].filter(Boolean).join('. ');

    const lines = details.lineItems?.length ? details.lineItems : [{
      pieces: details.totalPackageCount || 1,
      length: details.dimensions?.length, width: details.dimensions?.width, height: details.dimensions?.height,
      weight: (details.weight?.value || 1) / (details.totalPackageCount || 1),
      freightClass: details.freightClass,
    }];

    return {
      bol: {
        requester: { role: '3' }, // IFF books as the third party paying the freight
        chargeToCd: 'P',
        shipper: this._bolParty(shipper),
        consignee: this._bolParty(recipient),
        billToCust: {
          address: { addressLine1: IFF_BILL_TO.addressLine1, cityName: IFF_BILL_TO.cityName, stateCd: IFF_BILL_TO.stateCd, countryCd: IFF_BILL_TO.countryCd, postalCd: IFF_BILL_TO.postalCd },
          contactInfo: { companyName: IFF_BILL_TO.name },
        },
        commodityLine: lines.map(l => ({
          pieceCnt: l.pieces,
          packaging: {
            packageCd: 'PLT',
            ...(l.length && l.width && l.height && {
              packageDimensions: { length: Math.round(l.length), width: Math.round(l.width), height: Math.round(l.height), dimensionsUom: 'INCH' },
            }),
          },
          grossWeight: { weight: Math.round(l.weight * l.pieces), weightUom: 'LBS' },
          desc: (details.commodity || 'General freight').substring(0, 60),
          nmfcClass: l.freightClass ? String(l.freightClass) : '70',
          hazmatInd: hazmat,
        })),
        ...(services.length && { additionalService: services }),
        ...(remarks && { remarks }),
        ...(details.declaredValue?.amount && {
          declaredValueAmount: { amt: details.declaredValue.amount, currencyCd: details.declaredValue.currency || 'CAD' },
        }),
        pickupInfo: {
          pkupDate: localTimestamp(pickupDate, ready, originCountry, shipper.address?.stateOrProvinceCode),
          pkupTime: localTimestamp(pickupDate, ready, originCountry, shipper.address?.stateOrProvinceCode),
          dockCloseTime: localTimestamp(pickupDate, close, originCountry, shipper.address?.stateOrProvinceCode),
          contact: {
            companyName: (shipper.contact?.companyName || shipper.contact?.personName || 'Shipper').substring(0, 40),
            fullName: shipper.contact?.personName || 'Shipping',
            phone: { phoneNbr: this._phone(shipper.contact?.phoneNumber) },
          },
        },
      },
      autoAssignPro: true,
    };
  }

  // Shipper / consignee in XPO's address + contactInfo shape.
  _bolParty(party) {
    const addr = party.address || {};
    const contact = party.contact || {};
    const lines = addr.streetLines || [];
    return {
      address: {
        addressLine1: (lines[0] || 'N/A').substring(0, 40),
        ...(lines[1] && { addressLine2: lines[1].substring(0, 40) }),
        cityName: addr.city || '',
        stateCd: addr.stateOrProvinceCode || '',
        countryCd: this._country(addr.countryCode),
        postalCd: this._postalCode(addr.postalCode, addr.countryCode),
      },
      contactInfo: {
        companyName: (contact.companyName || contact.personName || 'N/A').substring(0, 40),
        ...(contact.personName && { fullName: contact.personName }),
        ...(contact.emailAddress && { email: { emailAddr: contact.emailAddress } }),
        phone: { phoneNbr: this._phone(contact.phoneNumber) },
      },
    };
  }

  // XPO's BOL wants "NNN-NNNNNNN" (area code, then the number).
  _phone(value) {
    const d = String(value || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3)}` : '000-0000000';
  }

  // XPO's BOL country codes: US, or CN for Canada.
  _country(code) {
    return String(code || 'CA').toUpperCase() === 'US' ? 'US' : 'CN';
  }

  // Canadian postal codes as "A1A 1A1"; US ZIP codes as given.
  _postalCode(value, country) {
    const v = String(value || '').replace(/\s+/g, '').toUpperCase();
    return String(country || 'CA').toUpperCase() !== 'US' && v.length === 6 ? `${v.slice(0, 3)} ${v.slice(3)}` : v;
  }

  // Cancels the BOL and its pickup request (not possible for BOLs made in test mode).
  async cancelShipment(bolInstId) {
    if (!this.isLive) throw new Error('XPO cancel is not available (no live credentials configured)');
    return xpoApi.cancelBol(bolInstId);
  }
}

module.exports = new XPOAdapter();
