const { getToken, getBaseUrl } = require('./fedexAuth.service');

async function validateAddress({ streetLines, city, stateOrProvinceCode, postalCode, countryCode }) {
  let token;
  try {
    token = await getToken();
  } catch (err) {
    console.error('[FEDEX-ADDR] Auth failed:', err.message);
    return { valid: null, error: 'FedEx address validation unavailable', fallback: true };
  }

  const body = {
    addressesToValidate: [
      {
        address: {
          streetLines: streetLines || [],
          city: city || undefined,
          stateOrProvinceCode: stateOrProvinceCode || undefined,
          postalCode: postalCode || undefined,
          countryCode: countryCode || 'CA',
        },
      },
    ],
  };

  try {
    const res = await fetch(`${getBaseUrl()}/address/v1/addresses/resolve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_CA',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[FEDEX-ADDR] API error:', res.status, errText);
      return { valid: null, error: `FedEx API error (${res.status})`, fallback: true };
    }

    const data = await res.json();
    return parseValidationResponse(data, { city, postalCode, countryCode });
  } catch (err) {
    console.error('[FEDEX-ADDR] Request failed:', err.message);
    return { valid: null, error: 'FedEx address validation unavailable', fallback: true };
  }
}

function parseValidationResponse(data, original) {
  const resolved = data.output?.resolvedAddresses?.[0];
  if (!resolved) {
    return { valid: false, error: 'Address could not be resolved', effectiveAddress: null, changes: [] };
  }

  const classification = resolved.classification || 'UNKNOWN';
  const attributes = resolved.attributes || {};
  const effectiveAddress = {
    streetLines: resolved.streetLinesToken || [],
    city: resolved.city || '',
    stateOrProvinceCode: resolved.stateOrProvinceCode || '',
    postalCode: resolved.postalCode || '',
    countryCode: resolved.countryCode || '',
  };

  // Determine what FedEx changed
  const changes = [];
  if (original.city && effectiveAddress.city && original.city.toUpperCase() !== effectiveAddress.city.toUpperCase()) {
    changes.push('CITY');
  }
  if (original.postalCode && effectiveAddress.postalCode) {
    const inputPostal = original.postalCode.replace(/\s/g, '').toUpperCase();
    const resolvedPostal = effectiveAddress.postalCode.replace(/\s/g, '').toUpperCase();
    if (inputPostal !== resolvedPostal) changes.push('POSTAL_CODE');
  }

  // Use FedEx's own validation attributes:
  // - Matched: FedEx found a matching address in postal data
  // - ValidlyFormed: the address structure is valid
  // - CountrySupported: the country is supported for validation
  const matched = attributes.Matched !== false;
  const validlyFormed = attributes.ValidlyFormed !== false;
  const countrySupported = attributes.CountrySupported !== false;

  // Consider valid if FedEx matched it and the structure is valid
  const valid = matched && validlyFormed && countrySupported;

  return {
    valid,
    classification,
    effectiveAddress,
    changes,
    attributes: {
      matched: !!attributes.Matched,
      validlyFormed: !!attributes.ValidlyFormed,
      countrySupported: !!attributes.CountrySupported,
      addressType: attributes.AddressType || null,
      addressPrecision: attributes.AddressPrecision || null,
    },
  };
}

module.exports = { validateAddress };
