const Shipment = require('../models/Shipment');
const Booking = require('../models/Booking');
const TrackingEvent = require('../models/TrackingEvent');
const { getCarrier } = require('../carriers');
const { generateTrackingNumber } = require('../utils/trackingGenerator');
const { NotFoundError } = require('../utils/errors');

// Called from booking.service.js immediately after a Booking is confirmed. Synchronous today
// because carriers are mocked — this is the natural seam to make async once real carrier
// booking APIs exist (e.g. deferred to a queue/webhook waiting on carrier confirmation).
async function createShipmentForBooking(session, booking, quote, selectedRate, input = {}, company = null) {
  const trackingNumber = await generateTrackingNumber();
  const shipper = _shipperParty(input.shipper, company, quote);
  const recipient = input.recipient;

  const [shipment] = await Shipment.create([{
    trackingNumber,
    user: booking.user,
    company: booking.company,
    booking: booking._id,
    carrierId: booking.carrierId,
    carrierName: booking.carrierName,
    serviceName: booking.serviceName,
    shipmentType: quote.shipmentType,
    originCity: quote.originCity,
    originProvince: quote.originProvince,
    originPostal: quote.originPostal,
    originCountry: quote.originCountry,
    destCity: quote.destCity,
    destProvince: quote.destProvince,
    destPostal: quote.destPostal,
    destCountry: quote.destCountry,
    weight: quote.weight,
    pieces: quote.pieces,
    dimL: quote.dimL,
    dimW: quote.dimW,
    dimH: quote.dimH,
    freightClass: quote.freightClass,
    currency: quote.currency,
    declaredValue: quote.declaredValue,
    commodity: quote.commodity,
    accessorials: quote.accessorials,
    shipperContact: { name: shipper.contact.personName, company: shipper.contact.companyName, phone: shipper.contact.phoneNumber },
    originStreet: shipper.address.streetLines,
    ...(recipient && {
      recipientContact: { name: recipient.contactName, company: recipient.companyName, phone: recipient.phone, email: recipient.email },
      destStreet: [recipient.street1, recipient.street2].filter(Boolean),
    }),
    ...(input.holdAtLocation && { holdAtLocation: input.holdAtLocation }),
    ...(input.dangerousGoods && { dangerousGoods: input.dangerousGoods }),
    status: 'pending',
    estimatedDelivery: selectedRate.estimatedDelivery,
  }], { session });

  await TrackingEvent.create([{
    shipment: shipment._id,
    event: 'Booked',
    location: quote.originCity || quote.originPostal,
    timestamp: new Date(),
    description: 'Shipment booked - awaiting carrier pickup',
  }], { session });

  return shipment;
}

async function getUserShipments(userId, { status, page = 1, limit = 10, search } = {}) {
  const skip = (page - 1) * limit;
  const where = { user: userId };

  if (status && status !== 'all') {
    where.status = status;
  }
  if (search) {
    const regex = new RegExp(search, 'i');
    where.$or = [
      { trackingNumber: regex },
      { carrierName: regex },
      { originCity: regex },
      { destCity: regex },
    ];
  }

  const [shipments, total] = await Promise.all([
    Shipment.find(where)
      .select('-labelBase64')
      .sort({ bookedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('booking', 'bookingNumber sellRate currency')
      .lean(),
    Shipment.countDocuments(where),
  ]);

  await _refreshStale(shipments);
  return { shipments, pagination: { page, limit, total } };
}

// Bring the listed shipments' statuses up to date with the carriers: only shipments not yet
// delivered, not checked in the last 30 minutes, at most 10 per page and 8 seconds in total
// (the page shows the saved status for any the carriers don't answer in time).
const REFRESH_AFTER_MS = 30 * 60 * 1000;
const REFRESH_MAX = 10;
const REFRESH_BUDGET_MS = 8000;

async function _refreshStale(shipments) {
  const { refreshFromCarrier } = require('./tracking.service');
  const stale = shipments.filter(s => s.carrierTrackingNumber && s.status !== 'delivered'
    && (!s.lastTrackedAt || Date.now() - new Date(s.lastTrackedAt) > REFRESH_AFTER_MS)).slice(0, REFRESH_MAX);
  if (!stale.length) return;
  await Promise.race([
    Promise.allSettled(stale.map(s => refreshFromCarrier(s))), // updates each listed shipment in place
    new Promise(resolve => setTimeout(resolve, REFRESH_BUDGET_MS)),
  ]);
}

async function getShipmentById(shipmentId, userId) {
  const shipment = await Shipment.findOne({ _id: shipmentId, user: userId }).populate('booking');
  if (!shipment) throw new NotFoundError('Shipment');

  const trackingEvents = await TrackingEvent.find({ shipment: shipment._id }).sort({ timestamp: -1 });
  const obj = shipment.toObject({ virtuals: true });
  obj.trackingEvents = trackingEvents;
  return obj;
}

// Called AFTER the booking transaction commits. Attempts a real carrier booking
// and updates the Shipment with the carrier's tracking number + label.
// If the carrier API fails, the shipment keeps its IFF tracking number (graceful degradation).
async function bookWithCarrier(shipment, quote, selectedRate, company, input = {}) {
  const carrier = await getCarrier(selectedRate.carrierId);
  if (!carrier) return null;

  // Fully regulated dangerous goods (and the small quantity exception) on a parcel need a
  // DG-approved carrier account and a signed shipper's declaration, so IFF staff finish the
  // carrier booking. Lithium batteries (Section II) are booked automatically.
  const accessorials = _bookedAccessorials(quote, selectedRate);
  if (['parcel', 'envelope'].includes(quote.shipmentType) && accessorials.includes('hazmat')
      && quote.options?.dgType !== 'BATTERY') {
    const manualCarrierBooking = {
      required: true,
      reason: 'Dangerous goods: IFF will complete the carrier booking and send the label once the shipment is reviewed.',
    };
    await Shipment.updateOne({ _id: shipment._id }, { manualCarrierBooking });
    await TrackingEvent.create({
      shipment: shipment._id,
      event: 'Awaiting IFF review',
      location: quote.originCity || quote.originPostal,
      timestamp: new Date(),
      description: 'Dangerous goods shipment — carrier booking will be completed by IFF',
    });
    console.log(`[SHIPMENT] ${shipment.trackingNumber}: dangerous goods — carrier booking left for IFF staff`);
    return { manualCarrierBooking };
  }

  // Build the details object the carrier adapter expects
  const details = _buildCarrierDetails(quote, selectedRate, company, input);

  let result;
  try {
    result = await carrier.bookShipment(details);
  } catch (err) {
    console.error(`[SHIPMENT] Carrier booking failed for ${selectedRate.carrierId}:`, err.message);
    return null;
  }

  if (!result || !result.carrierTrackingNumber) return null;

  // Update shipment with carrier response
  const update = { carrierTrackingNumber: result.carrierTrackingNumber };
  if (result.confirmationNumber) {
    update.carrierConfirmationNumber = result.confirmationNumber;
  }
  if (result.label?.encodedLabel) {
    update.labelBase64 = result.label.encodedLabel;
    update.labelDocType = result.label.docType || 'PDF';
  }

  await Shipment.updateOne({ _id: shipment._id }, update);

  // Pickup booked with the carrier: keep its confirmation on the booking. When the carrier
  // couldn't schedule it, staff see why in the tracking history and arrange it themselves.
  const pickup = result.pickup || null;
  if (pickup) await Shipment.updateOne({ _id: shipment._id }, { pickupStatus: pickup.scheduled ? 'scheduled' : 'to_arrange' });
  if (pickup?.scheduled && shipment.booking) {
    await Booking.updateOne({ _id: shipment.booking }, { pickupConfirmationNumber: pickup.confirmationNumber, pickupConfirmedAt: new Date() });
  } else if (pickup && !pickup.scheduled) {
    await TrackingEvent.create({
      shipment: shipment._id,
      event: 'Pickup to be arranged',
      location: quote.originCity || quote.originPostal,
      timestamp: new Date(),
      description: pickup.message,
    });
  }

  return {
    carrierTrackingNumber: result.carrierTrackingNumber,
    label: result.label || null,
    serviceType: result.serviceType,
    pickup,
  };
}

// Shipper contact + street: what the customer entered when booking, else the company profile.
// City/postal code always come from the quote — that's what was priced.
function _shipperParty(input, company, quote) {
  const originCountry = (quote.originCountry || 'CA').toUpperCase();
  return {
    contact: {
      personName: input?.contactName || company?.name || 'Shipper',
      companyName: input?.companyName || company?.name || '',
      phoneNumber: _digits(input?.phone || company?.phone) || '0000000000',
    },
    address: {
      streetLines: input?.street1
        ? [input.street1, input.street2].filter(Boolean)
        : [company?.street || quote.originCity || 'N/A'],
      city: quote.originCity || company?.city || '',
      stateOrProvinceCode: quote.originProvince || _provinceFromPostal(quote.originPostal, originCountry),
      postalCode: quote.originPostal || company?.postalCode || '',
      countryCode: originCountry,
    },
  };
}

function _digits(phone) {
  return phone ? String(phone).replace(/\D/g, '') : '';
}

function _parseAccessorials(raw) {
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

// The quote's options minus any the booked carrier couldn't include in its price.
function _bookedAccessorials(quote, selectedRate) {
  const notIncluded = selectedRate?.notIncludedOptions || [];
  return _parseAccessorials(quote.accessorials).filter(a => !notIncluded.includes(a));
}

function _buildCarrierDetails(quote, selectedRate, company, input = {}) {
  const shipDate = quote.pickupDate || new Date().toISOString().split('T')[0];
  const originCountry = (quote.originCountry || 'CA').toUpperCase();
  const destCountry = (quote.destCountry || 'US').toUpperCase();
  const isInternational = originCountry !== destCountry;
  const accessorials = _bookedAccessorials(quote, selectedRate);

  const shipper = _shipperParty(input.shipper, company, quote);

  // Recipient: contact + street from the booking form; city/postal code from the quote.
  const r = input.recipient || {};
  const recipient = {
    contact: {
      personName: r.contactName || 'Recipient',
      companyName: r.companyName || '',
      phoneNumber: _digits(r.phone) || '0000000000',
      ...(r.email && { emailAddress: r.email }),
    },
    address: {
      streetLines: r.street1 ? [r.street1, r.street2].filter(Boolean) : [quote.destCity || 'N/A'],
      city: quote.destCity || '',
      stateOrProvinceCode: quote.destProvince || _provinceFromPostal(quote.destPostal, destCountry),
      postalCode: quote.destPostal || '',
      countryCode: destCountry,
    },
  };

  const details = {
    shipDatestamp: shipDate,
    // Ask the carrier to collect it: always for LTL; for parcels and envelopes only with the
    // Pickup option (otherwise it's dropped off or goes with a regular pickup). Test scripts
    // build their own details and leave this off.
    requestPickup: quote.shipmentType === 'ltl' || accessorials.includes('pickup'),
    pickupReadyTime: quote.pickupReadyTime,
    pickupCloseTime: quote.pickupCloseTime,
    serviceType: selectedRate.serviceCode || null,
    packagingType: quote.options?.fedexPackaging || 'YOUR_PACKAGING',
    // The options the customer was quoted for — each carrier adapter maps them to its own codes.
    accessorials,
    options: {
      fedexOneRate: !!quote.options?.fedexOneRate,
      dgType: quote.options?.dgType,
      battery: quote.options?.battery?.material ? quote.options.battery : undefined,
      homeDeliveryDate: quote.options?.homeDeliveryDate,
      limitedAccessType: quote.options?.limitedAccessType,
    },
    ...(input.holdAtLocation && { holdAtLocation: input.holdAtLocation }),
    shipper,
    recipient,
    weight: { units: 'LB', value: quote.weight || 1 },
    labelSpecification: { imageType: 'PDF', labelStockType: 'PAPER_85X11_TOP_HALF_LABEL' },
    customerReference: quote.quoteNumber,
    totalPackageCount: quote.pieces || 1,
    commodity: quote.commodity || null,
    // LTL: groups of identical pieces (in, lb per piece, freight class) for per-line BOLs.
    ...(quote.lineItems?.length && { lineItems: quote.lineItems.map(i => ({ pieces: i.pieces, length: i.length, width: i.width, height: i.height, weight: i.weight, freightClass: i.freightClass })) }),
    freightClass: quote.freightClass || null,
  };

  if (quote.dimL && quote.dimW && quote.dimH) {
    details.dimensions = {
      length: Math.round(quote.dimL),
      width: Math.round(quote.dimW),
      height: Math.round(quote.dimH),
      units: 'IN',
    };
  }

  if (quote.declaredValue) {
    details.declaredValue = { currency: quote.currency || 'CAD', amount: quote.declaredValue };
  }

  // International shipments need customs clearance
  if (isInternational) {
    const customsValue = quote.declaredValue || 100;
    details.customsClearanceDetail = {
      dutiesPayment: { paymentType: 'SENDER' },
      commodities: [{
        numberOfPieces: quote.pieces || 1,
        description: quote.commodity || 'Printed materials and documents',
        countryOfManufacture: originCountry,
        weight: { units: 'LB', value: quote.weight || 1 },
        quantity: quote.pieces || 1,
        quantityUnits: 'EA',
        unitPrice: { currency: quote.currency || 'CAD', amount: customsValue },
        customsValue: { currency: quote.currency || 'CAD', amount: customsValue },
      }],
    };
  }

  return details;
}

// Best-effort province/state from postal code (Canadian first letter → province)
function _provinceFromPostal(postal, countryCode) {
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

async function getShipmentLabel(shipmentId, userId) {
  const shipment = await Shipment.findOne({ _id: shipmentId, user: userId })
    .select('labelBase64 labelDocType carrierTrackingNumber trackingNumber');
  if (!shipment) throw new NotFoundError('Shipment');
  if (!shipment.labelBase64) return null;
  return {
    encodedLabel: shipment.labelBase64,
    docType: shipment.labelDocType || 'PDF',
    trackingNumber: shipment.carrierTrackingNumber || shipment.trackingNumber,
  };
}

module.exports = { createShipmentForBooking, bookWithCarrier, getUserShipments, getShipmentById, getShipmentLabel, _buildCarrierDetails };
