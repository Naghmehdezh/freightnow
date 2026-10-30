class CarrierAdapter {
  constructor() {
    if (new.target === CarrierAdapter) {
      throw new Error('CarrierAdapter is abstract');
    }
  }

  get id() { throw new Error('Must implement id'); }
  get name() { throw new Error('Must implement name'); }
  get isLive() { return false; }

  // Whether this adapter quotes this shipment at all (beyond the Carrier DB coverage) — used to
  // decide which carriers get a "not available with …" message for unsupported options.
  canQuote(params) { return true; }

  async getRates(params) {
    throw new Error('Must implement getRates()');
  }

  async getTracking(trackingNumber) {
    throw new Error('Must implement getTracking()');
  }

  async bookShipment(details) {
    throw new Error('Must implement bookShipment()');
  }
}

module.exports = CarrierAdapter;
