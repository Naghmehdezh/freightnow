const Shipment = require('../models/Shipment');
const TrackingEvent = require('../models/TrackingEvent');
const { getCarrier } = require('../carriers');
const { NotFoundError } = require('../utils/errors');

async function getTracking(trackingNumber) {
  // Look up by IFF tracking number first, then by carrier tracking number
  let shipment = await Shipment.findOne({ trackingNumber });
  if (!shipment) {
    shipment = await Shipment.findOne({ carrierTrackingNumber: trackingNumber });
  }
  if (!shipment) {
    // Not booked through the portal — a FedEx tracking number (12–15 digits) can still be
    // tracked directly with FedEx (Basic Integrated Visibility / Track API).
    if (/^\d{12,15}$/.test(trackingNumber)) return _trackFedexDirect(trackingNumber);
    throw new NotFoundError('Shipment');
  }

  // Try live carrier tracking if we have a real carrier tracking number
  let carrierData = null;
  if (shipment.carrierTrackingNumber) {
    try {
      const carrier = await getCarrier(shipment.carrierId || 'fedex');
      if (carrier) {
        // Prefer carrierConfirmationNumber for carriers that need it (e.g. CSA orderId)
        const trackId = shipment.carrierConfirmationNumber || shipment.carrierTrackingNumber;
        carrierData = await carrier.getTracking(trackId);
      }
    } catch (err) {
      console.error('[TRACKING] Carrier tracking failed:', err.message);
    }
  }

  // Use carrier events if available, otherwise fall back to DB events
  let events;
  if (carrierData?.events?.length) {
    events = carrierData.events;
  } else {
    const dbEvents = await TrackingEvent.find({ shipment: shipment._id }).sort({ timestamp: -1 });
    events = dbEvents.map(e => ({
      event: e.event,
      location: e.location,
      timestamp: e.timestamp.toISOString(),
      description: e.description,
    }));
  }

  // Format events for the frontend (needs time, done, active)
  const now = new Date();
  const formattedEvents = events.map((e, i) => {
    const ts = e.timestamp ? new Date(e.timestamp) : null;
    const isPast = ts && ts <= now;
    return {
      event: e.event,
      location: e.location,
      time: ts ? _formatEventTime(ts) : '',
      done: isPast,
      active: !isPast && i === 0,
      description: e.description || '',
    };
  });

  const route = [shipment.originCity, shipment.destCity].filter(Boolean).join(' → ')
    || `${shipment.originPostal} → ${shipment.destPostal}`;

  // Use carrier-reported status if available
  const status = carrierData?.status || shipment.status;
  const delivery = carrierData?.estimatedDelivery || carrierData?.actualDelivery
    || shipment.estimatedDelivery;

  return {
    trackingNumber: shipment.trackingNumber,
    carrierTrackingNumber: shipment.carrierTrackingNumber || null,
    carrier: shipment.carrierName,
    route,
    status,
    estimatedDelivery: delivery,
    delivery: delivery ? _formatDeliveryDate(delivery) : '—',
    service: carrierData?.service || shipment.serviceName,
    weight: carrierData?.weight || (shipment.weight ? `${shipment.weight} lbs` : '—'),
    pieces: carrierData?.pieces || `${shipment.pieces || '—'}`,
    latestStatus: carrierData?.latestStatus || null,
    events: formattedEvents,
  };
}

async function _trackFedexDirect(trackingNumber) {
  const fedex = await getCarrier('fedex');
  if (!fedex) throw new NotFoundError('Shipment');
  let data;
  try {
    data = await fedex.getTracking(trackingNumber);
  } catch (err) {
    console.error('[TRACKING] FedEx direct lookup failed:', err.message);
    throw new NotFoundError('Shipment');
  }
  const now = new Date();
  const events = (data.events || []).map((e, i) => {
    const ts = e.timestamp ? new Date(e.timestamp) : null;
    return {
      event: e.event,
      location: e.location,
      time: ts ? _formatEventTime(ts) : '',
      done: !!(ts && ts <= now),
      active: i === 0,
      description: e.description || '',
    };
  });
  const delivery = data.actualDelivery || data.estimatedDelivery;
  return {
    trackingNumber,
    carrierTrackingNumber: trackingNumber,
    carrier: 'FedEx',
    route: data.route || '',
    status: data.status,
    estimatedDelivery: delivery,
    delivery: delivery ? _formatDeliveryDate(delivery) : '—',
    service: data.service || 'FedEx',
    weight: data.weight || '—',
    pieces: data.pieces || '—',
    latestStatus: data.latestStatus || null,
    events,
  };
}

function _formatEventTime(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }) + ' · ' + date.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

function _formatDeliveryDate(dateVal) {
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

module.exports = { getTracking };
