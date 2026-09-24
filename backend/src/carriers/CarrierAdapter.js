class CarrierAdapter {
  constructor() {
    if (new.target === CarrierAdapter) {
      throw new Error('CarrierAdapter is abstract');
    }
  }

  get id() { throw new Error('Must implement id'); }
  get name() { throw new Error('Must implement name'); }
  get isLive() { return false; }

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
