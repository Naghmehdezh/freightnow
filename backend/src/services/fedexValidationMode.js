// TEMPORARY — FedEx Integrator validation screenshots.
//
// FedEx requires the rate shown in the UI to equal the Rate API response for their test cases.
// With FEDEX_VALIDATION_MODE=true in backend/.env:
//   - FedEx rates are requested under FedEx's test account for the origin country (registered
//     first, using that account's own CSP token — see scripts/fedexTestAccountToken.js);
//   - FedEx rates are shown at FedEx's exact price (no IFF markup).
// Turn it off (remove the line / set false) once the screenshots are taken.
const { getTestAccountToken } = require('../scripts/fedexTestAccountToken');

const TEST_ACCOUNT_BY_COUNTRY = { CA: '614365501', US: '700257037' };
const TOKEN_TTL_MS = 50 * 60 * 1000;
const cache = {};

function isOn() {
  return String(process.env.FEDEX_VALIDATION_MODE || '').trim().toLowerCase() === 'true';
}

function testAccountFor(originCountry) {
  return TEST_ACCOUNT_BY_COUNTRY[(originCountry || '').toUpperCase()] || null;
}

async function tokenFor(accountNumber) {
  const hit = cache[accountNumber];
  if (hit && Date.now() < hit.expiresAt) return hit.token;
  const { accessToken } = await getTestAccountToken(accountNumber);
  cache[accountNumber] = { token: accessToken, expiresAt: Date.now() + TOKEN_TTL_MS };
  return accessToken;
}

module.exports = { isOn, testAccountFor, tokenFor };
