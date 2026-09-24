const CarrierAdapter = require('./CarrierAdapter');

// No live API integration exists yet for XPO — no account/credentials configured. Rather than
// fabricate an estimate, this carrier simply has nothing to offer until it's actually
// integrated: getRates() returns no results, and getTracking()/bookShipment() are unreachable
// in practice since a carrier with no rates never gets selected for either.
//
// TODO: once XPO API access exists, add a _getLiveRates/_liveGetTracking/_liveBookShipment
// implementation here, following the pattern already used in dhl.adapter.js/csa.adapter.js.
class XPOAdapter extends CarrierAdapter {
  get id() { return 'xpo'; }
  get name() { return 'XPO Logistics'; }
  get isLive() { return !!process.env.XPO_API_KEY; }

  async getRates(params) {
    return [];
  }

  async getTracking(trackingNumber) {
    throw new Error('XPO tracking is not available (not yet integrated)');
  }

  async bookShipment(details) {
    throw new Error('XPO booking is not available (not yet integrated)');
  }
}

module.exports = new XPOAdapter();
