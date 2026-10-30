const https = require('https');
const zlib = require('zlib');
const { ValidationError } = require('../utils/errors');

// Address autocomplete via Google Places API (New). Called from the backend so the API key
// never reaches the browser. Requires GOOGLE_PLACES_API_KEY with "Places API (New)" enabled.
// The frontend passes a session token (one per address being typed) so Google bills the
// keystroke suggestions + the final place lookup as a single session.
const BASE = 'https://places.googleapis.com/v1';

function isConfigured() {
  return !!process.env.GOOGLE_PLACES_API_KEY;
}

function request(method, url, body, fieldMask) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const buf = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        'Accept-Encoding': 'gzip, identity',
        ...(fieldMask && { 'X-Goog-FieldMask': fieldMask }),
        ...(buf && { 'Content-Type': 'application/json', 'Content-Length': buf.length }),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let raw = Buffer.concat(chunks);
        if (res.headers['content-encoding'] === 'gzip') raw = zlib.gunzipSync(raw);
        let data; try { data = JSON.parse(raw.toString()); } catch { data = {}; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data);
        console.error(`[PLACES] ${method} ${u.pathname} failed: ${res.statusCode}`, data.error?.message || '');
        reject(new Error(`Address lookup failed (${res.statusCode})`));
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('Address lookup timed out')));
    if (buf) req.write(buf);
    req.end();
  });
}

async function autocomplete(input, sessionToken) {
  if (!isConfigured()) return [];
  const text = String(input || '').trim();
  if (text.length < 3) return [];
  const data = await request('POST', `${BASE}/places:autocomplete`, {
    input: text,
    ...(sessionToken && { sessionToken }),
    languageCode: 'en',
    // Limits suggestions to these countries (default Canada + US). Widen via GOOGLE_PLACES_REGIONS.
    includedRegionCodes: (process.env.GOOGLE_PLACES_REGIONS || 'ca,us').split(',').map(r => r.trim()).filter(Boolean),
  });
  return (data.suggestions || [])
    .map(sug => sug.placePrediction)
    .filter(Boolean)
    .map(p => ({
      placeId: p.placeId,
      text: p.text?.text || '',
      mainText: p.structuredFormat?.mainText?.text || p.text?.text || '',
      secondaryText: p.structuredFormat?.secondaryText?.text || '',
    }));
}

// Turns Google's address components into the fields the quote form uses.
function parseComponents(components = []) {
  const get = (type, short = false) => {
    const c = components.find(x => x.types?.includes(type));
    return c ? (short ? c.shortText : c.longText) : '';
  };
  const street = [get('street_number'), get('route')].filter(Boolean).join(' ');
  return {
    street,
    unit: get('subpremise'), // e.g. "1115" in "17 Anndale Dr #1115"
    city: get('locality') || get('postal_town') || get('sublocality') || get('administrative_area_level_3') || get('administrative_area_level_2'),
    province: get('administrative_area_level_1', true),
    postalCode: [get('postal_code'), get('postal_code_suffix')].filter(Boolean).join('-'),
    country: get('country', true),
  };
}

async function placeDetails(placeId, sessionToken) {
  if (!isConfigured()) throw new ValidationError('Address autocomplete is not configured');
  if (!/^[A-Za-z0-9_-]+$/.test(placeId || '')) throw new ValidationError('Invalid place id');
  const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
  const data = await request('GET', `${BASE}/places/${placeId}${qs}`, null, 'formattedAddress,addressComponents');
  return { ...parseComponents(data.addressComponents), formatted: data.formattedAddress || '' };
}

module.exports = { isConfigured, autocomplete, placeDetails, parseComponents };
