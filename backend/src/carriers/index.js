const fedex = require('./fedex.adapter');
const xpo = require('./xpo.adapter');
const dayross = require('./dayross.adapter');
const manitoulin = require('./manitoulin.adapter');
const polaris = require('./polaris.adapter');
const dhl = require('./dhl.adapter');
const csa = require('./csa.adapter');
const estes = require('./estes.adapter');
const Carrier = require('../models/Carrier');
const { detectLane } = require('../utils/shipmentScope');

const carriers = { fedex, xpo, dayross, manitoulin, polaris, dhl, csa, estes };

// The adapters above hold the (mocked) capability code — how to talk to each carrier.
// The Carrier collection holds policy — whether one is switched on right now. Keeping them
// separate means a carrier can be disabled in seconds via a data change, no code deploy.
async function getAllCarriers() {
  const enabledIds = new Set(
    (await Carrier.find({ enabled: true }).select('carrierId')).map(c => c.carrierId)
  );
  return Object.values(carriers).filter(c => enabledIds.has(c.id));
}

// Enabled carriers whose coverage (from Carrier_Mapping.md) includes this shipment's type and
// lane. Carriers outside it are never called, so an unsupported lane (e.g. Day & Ross to the
// US) costs nothing instead of three timed-out retries.
async function getCarriersForShipment({ shipmentType, origin, destination }) {
  const lane = detectLane(origin?.country, destination?.country);
  const records = await Carrier.find({ enabled: true, shipmentTypes: shipmentType, lanes: lane }).select('carrierId');
  const ids = new Set(records.map(c => c.carrierId));
  return Object.values(carriers).filter(c => ids.has(c.id));
}

async function supportsShipment(id, { shipmentType, origin, destination }) {
  const lane = detectLane(origin?.country, destination?.country);
  return !!(await Carrier.exists({ carrierId: id, enabled: true, shipmentTypes: shipmentType, lanes: lane }));
}

async function getCarrier(id) {
  const record = await Carrier.findOne({ carrierId: id, enabled: true });
  if (!record) return null;
  return carriers[id] || null;
}

module.exports = { carriers, getAllCarriers, getCarriersForShipment, supportsShipment, getCarrier };
