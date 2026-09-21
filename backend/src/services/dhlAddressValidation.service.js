const { getBaseUrl, httpsGet } = require('./dhlApi.service');

/**
 * DHL Express Address Validation — checks if DHL has pickup/delivery
 * capability at the given location.
 *
 * Endpoint: GET /address-validate
 * Params: type, countryCode, postalCode, cityName (optional)
 *
 * Returns the same shape as fedexAddressValidation.service.js so the
 * route / booking service can use them interchangeably.
 */

async function validateAddress({ streetLines, city, stateOrProvinceCode, postalCode, countryCode }) {
  // DHL credentials not configured — skip gracefully
  if (!process.env.DHL_USERNAME) {
    return { valid: null, error: 'DHL address validation unavailable', fallback: true, source: 'dhl' };
  }

  const params = new URLSearchParams({
    type: 'delivery',
    countryCode: countryCode || 'CA',
    postalCode: (postalCode || '').replace(/\s/g, ''),
  });
  if (city) params.set('cityName', city);

  const url = `${getBaseUrl()}/address-validate?${params.toString()}`;

  try {
    const data = await httpsGet(url);
    return parseValidationResponse(data, { city, postalCode, countryCode });
  } catch (err) {
    console.error('[DHL-ADDR] Request failed:', err.message);
    // If DHL is unreachable, never block the user
    return { valid: null, error: 'DHL address validation unavailable', fallback: true, source: 'dhl' };
  }
}

function parseValidationResponse(data, original) {
  const addresses = data.address || [];

  if (!addresses.length) {
    return {
      valid: false,
      classification: 'UNKNOWN',
      effectiveAddress: null,
      changes: [],
      attributes: { matched: false, countrySupported: true },
      source: 'dhl',
    };
  }

  // DHL returns an array of matching addresses — take the first (best match)
  const best = addresses[0];
  const effectiveAddress = {
    streetLines: [],
    city: best.cityName || '',
    stateOrProvinceCode: best.countyName || '',
    postalCode: best.postalCode || '',
    countryCode: best.countryCode || '',
  };

  // Detect what DHL corrected
  const changes = [];
  if (original.city && effectiveAddress.city && original.city.toUpperCase() !== effectiveAddress.city.toUpperCase()) {
    changes.push('CITY');
  }
  if (original.postalCode && effectiveAddress.postalCode) {
    const inputPostal = original.postalCode.replace(/\s/g, '').toUpperCase();
    const resolvedPostal = effectiveAddress.postalCode.replace(/\s/g, '').toUpperCase();
    if (inputPostal !== resolvedPostal) changes.push('POSTAL_CODE');
  }

  // Check for warnings
  const warnings = data.warnings || [];
  const hasWarnings = warnings.length > 0;

  return {
    valid: true,
    classification: 'UNKNOWN', // DHL doesn't classify business/residential
    effectiveAddress,
    changes,
    attributes: {
      matched: true,
      countrySupported: true,
      serviceArea: best.serviceArea || null,
    },
    warnings: hasWarnings ? warnings : undefined,
    source: 'dhl',
  };
}

module.exports = { validateAddress };
