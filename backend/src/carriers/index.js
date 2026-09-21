const fedex = require('./fedex.adapter');
const xpo = require('./xpo.adapter');
const dayross = require('./dayross.adapter');
const manitoulin = require('./manitoulin.adapter');
const polaris = require('./polaris.adapter');
const dhl = require('./dhl.adapter');
const csa = require('./csa.adapter');
const Carrier = require('../models/Carrier');

const carriers = { fedex, xpo, dayross, manitoulin, polaris, dhl, csa };

// The adapters above hold the (mocked) capability code — how to talk to each carrier.
// The Carrier collection holds policy — whether one is switched on right now. Keeping them
// separate means a carrier can be disabled in seconds via a data change, no code deploy.
async function getAllCarriers() {
  const enabledIds = new Set(
    (await Carrier.find({ enabled: true }).select('carrierId')).map(c => c.carrierId)
  );
  return Object.values(carriers).filter(c => enabledIds.has(c.id));
}

async function getCarrier(id) {
  const record = await Carrier.findOne({ carrierId: id, enabled: true });
  if (!record) return null;
  return carriers[id] || null;
}

module.exports = { carriers, getAllCarriers, getCarrier };
