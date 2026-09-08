const Shipment = require('../models/Shipment');
const TrackingEvent = require('../models/TrackingEvent');
const { getCarrier } = require('../carriers');
const { generateTrackingNumber } = require('../utils/trackingGenerator');
const { NotFoundError } = require('../utils/errors');

// Called from booking.service.js immediately after a Booking is confirmed. Synchronous today
// because carriers are mocked — this is the natural seam to make async once real carrier
// booking APIs exist (e.g. deferred to a queue/webhook waiting on carrier confirmation).
async function createShipmentForBooking(session, booking, quote, selectedRate) {
  const trackingNumber = await generateTrackingNumber();

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
      .populate('booking', 'bookingNumber sellRate')
      .lean(),
    Shipment.countDocuments(where),
  ]);

  return { shipments, pagination: { page, limit, total } };
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
async function bookWithCarrier(shipment, quote, selectedRate, company) {
  const carrier = await getCarrier(selectedRate.carrierId);
  if (!carrier) return null;

  // Build the details object the carrier adapter expects
  const details = _buildCarrierDetails(quote, selectedRate, company);

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
  if (result.label?.encodedLabel) {
    update.labelBase64 = result.label.encodedLabel;
    update.labelDocType = result.label.docType || 'PDF';
  }

  await Shipment.updateOne({ _id: shipment._id }, update);

  return {
    carrierTrackingNumber: result.carrierTrackingNumber,
    label: result.label || null,
    serviceType: result.serviceType,
  };
}

function _buildCarrierDetails(quote, selectedRate, company) {
  const shipDate = quote.pickupDate || new Date().toISOString().split('T')[0];
  const originCountry = (quote.originCountry || 'CA').toUpperCase();
  const destCountry = (quote.destCountry || 'US').toUpperCase();
  const isInternational = originCountry !== destCountry;

  // Shipper: use company address if available, fall back to quote origin
  const shipper = {
    contact: {
      personName: company?.name || 'Shipper',
      companyName: company?.name || '',
      phoneNumber: company?.phone || '0000000000',
    },
    address: {
      streetLines: [company?.street || quote.originCity || 'N/A'],
      city: company?.city || quote.originCity || '',
      stateOrProvinceCode: company?.province || quote.originProvince || _provinceFromPostal(quote.originPostal, originCountry),
      postalCode: company?.postalCode || quote.originPostal || '',
      countryCode: originCountry,
    },
  };

  // Recipient: use quote destination (street not available from quote flow)
  const recipient = {
    contact: {
      personName: 'Recipient',
      companyName: '',
      phoneNumber: '0000000000',
    },
    address: {
      streetLines: [quote.destCity || 'N/A'],
      city: quote.destCity || '',
      stateOrProvinceCode: quote.destProvince || _provinceFromPostal(quote.destPostal, destCountry),
      postalCode: quote.destPostal || '',
      countryCode: destCountry,
    },
  };

  const details = {
    shipDatestamp: shipDate,
    serviceType: selectedRate.serviceCode || null,
    packagingType: 'YOUR_PACKAGING',
    shipper,
    recipient,
    weight: { units: 'LB', value: quote.weight || 1 },
    labelSpecification: { imageType: 'PDF', labelStockType: 'PAPER_85X11_TOP_HALF_LABEL' },
    customerReference: quote.quoteNumber,
    totalPackageCount: quote.pieces || 1,
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

  // Map accessorials to special services
  if (quote.accessorials) {
    try {
      const accessorials = JSON.parse(quote.accessorials);
      if (accessorials.includes('saturday')) {
        details.specialServices = { specialServiceTypes: ['SATURDAY_DELIVERY'] };
      }
    } catch { /* ignore parse errors */ }
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

module.exports = { createShipmentForBooking, bookWithCarrier, getUserShipments, getShipmentById, getShipmentLabel };
