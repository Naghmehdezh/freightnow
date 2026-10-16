const { getToken, getBaseUrl, httpsPost } = require('./fedexAuth.service');
const { ValidationError } = require('../utils/errors');

// FedEx Location Search API — finds FedEx locations near the destination that accept
// Hold at Location, so the customer can pick where the shipment is held.
const GROUND_SERVICES = ['FEDEX_GROUND', 'GROUND_HOME_DELIVERY', 'FEDEX_INTERNATIONAL_GROUND', 'SMART_POST'];

const TYPE_LABELS = {
  FEDEX_OFFICE: 'FedEx Office®',
  FEDEX_ONSITE: 'FedEx OnSite®',
  FEDEX_EXPRESS_STATION: 'FedEx Ship Centre',
  FEDEX_AUTHORIZED_SHIP_CENTER: 'FedEx Authorized ShipCentre',
  FEDEX_SELF_SERVICE_LOCATION: 'FedEx Drop Box',
};

async function searchHoldLocations({ postalCode, countryCode, city, serviceCode }) {
  if (!postalCode || !countryCode) throw new ValidationError('postalCode and countryCode are required');
  // Ground / Home Delivery shipments can only be held at Ground locations, Express at Express ones.
  const carrierCode = GROUND_SERVICES.includes(serviceCode) ? 'FDXG' : 'FDXE';

  const token = await getToken();
  const body = {
    location: { address: { postalCode: String(postalCode).replace(/\s+/g, ''), countryCode, ...(city && { city }) } },
    locationsSummaryRequestControlParameters: { distance: { units: countryCode === 'US' ? 'MI' : 'KM', value: countryCode === 'US' ? 10 : 15 } },
  };
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-locale': 'en_US' };

  let data;
  for (let attempt = 1; ; attempt++) {
    try {
      data = await httpsPost(`${getBaseUrl()}/location/v1/locations`, JSON.stringify(body), headers);
      break;
    } catch (err) {
      if (![500, 502, 503, 504].includes(err.statusCode) || attempt >= 4) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  return (data.output?.locationDetailList || [])
    .filter(l => (l.locationCapabilities || []).some(c => c.transferOfPossessionType === 'HOLD_AT_LOCATION' && c.carrierCode === carrierCode))
    .slice(0, 10)
    .map(l => {
      const address = l.contactAndAddress?.address || {};
      return {
        locationId: l.locationId,
        locationType: l.locationType,
        name: l.contactAndAddress?.contact?.companyName || TYPE_LABELS[l.locationType] || 'FedEx location',
        typeLabel: TYPE_LABELS[l.locationType] || l.locationType,
        address: {
          streetLines: address.streetLines || [],
          city: address.city,
          stateOrProvinceCode: address.stateOrProvinceCode,
          postalCode: address.postalCode,
          countryCode: address.countryCode,
        },
        distance: l.distance ? `${l.distance.value} ${l.distance.units}` : null,
      };
    });
}

module.exports = { searchHoldLocations };
