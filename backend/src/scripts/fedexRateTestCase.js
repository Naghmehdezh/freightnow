#!/usr/bin/env node
/**
 * FedEx Integrator Validation — Rate Test Case IntegratorCA06
 *
 * Fires the exact rate request specified in the FedEx_Integrator_Test_Case_Baseline.xlsx
 * (Americas_CA_Test cases → Rate Test Case row) against the FedEx sandbox, then saves:
 *   - IntegratorCA06_request.json   (the request body)
 *   - IntegratorCA06_response.json  (the raw FedEx response)
 *
 * Usage:  node backend/src/scripts/fedexRateTestCase.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const { getBaseUrl, httpsPost } = require('../services/fedexAuth.service');
const { getTestAccountToken } = require('./fedexTestAccountToken');

const OUT_DIR = path.resolve(__dirname, '../../../fedex_test_output');

async function run() {
  // Ensure output directory exists
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  if (!process.env.FEDEX_API_KEY) {
    console.error('FEDEX_API_KEY not set in .env');
    process.exit(1);
  }

  // Per the baseline's "Test Account Numbers" tab, IntegratorCA06 explicitly specifies the
  // CA Test Account (614365501) in both the top-level accountNumber and the payor's
  // responsibleParty.accountNumber — NOT the account in FEDEX_ACCOUNT_NUMBER, which the same
  // tab separately labels the "Ground Economy Outbound Account" (a different, narrower-purpose
  // account, used for the Ship test cases' third-party billing test only).
  const CA_TEST_ACCOUNT = '614365501';

  // Build the ship date — FedEx Rate API expects YYYY-MM-DD only
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const shipDateStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // ----- Exact IntegratorCA06 request body from the spreadsheet -----
  const requestBody = {
    accountNumber: { value: CA_TEST_ACCOUNT },
    rateRequestControlParameters: {
      returnTransitTimes: false,
      servicesNeededOnRateFailure: true,
      rateSortOrder: 'SERVICENAMETRADITIONAL',
    },
    requestedShipment: {
      shipDateStamp,
      pickupType: 'USE_SCHEDULED_PICKUP',
      serviceType: 'INTERNATIONAL_ECONOMY',
      packagingType: 'FEDEX_TUBE',
      shipper: {
        address: {
          city: 'Mississauga',
          stateOrProvinceCode: 'ON',
          postalCode: 'L4W5K6',
          countryCode: 'CA',
          residential: false,
        },
      },
      recipient: {
        address: {
          city: 'Marion',
          stateOrProvinceCode: 'OH',
          postalCode: '43301',
          countryCode: 'US',
          residential: false,
        },
      },
      shippingChargesPayment: {
        paymentType: 'SENDER',
        payor: {
          responsibleParty: {
            accountNumber: { value: CA_TEST_ACCOUNT },
            address: {
              stateOrProvinceCode: 'ON',
              postalCode: 'L4W5K6',
              city: 'Mississauga',
              countryCode: 'CA',
              residential: false,
            },
          },
        },
      },
      customsClearanceDetail: {
        commodities: [{
          harmonizedCode: '1234567891',
          name: 'DescriptionLine1',
          description: 'Dictionaries',
          countryOfManufacture: 'CA',
          weight: { units: 'KG', value: 0.68 },
          quantity: 2,
          quantityUnits: 'EA',
          unitPrice: { currency: 'CAD', amount: 600 },
          customsValue: { currency: 'CAD', amount: 1200 },
        }],
        dutiesPayment: { paymentType: 'SENDER' },
      },
      rateRequestType: ['ACCOUNT', 'LIST'],
      totalPackageCount: 1,
      requestedPackageLineItems: [{
        weight: { units: 'KG', value: 0.68 },
      }],
    },
  };

  // Save request
  const reqPath = path.join(OUT_DIR, 'IntegratorCA06_request.json');
  fs.writeFileSync(reqPath, JSON.stringify(requestBody, null, 2));
  console.log(`✓ Request saved: ${reqPath}`);

  // The CA test account must be registered first; rate calls then use its own CSP token
  // (the project's parent token gets ACCOUNT.NUMBER.MISMATCH for a test account).
  const reg = await getTestAccountToken(CA_TEST_ACCOUNT);
  const token = reg.accessToken;
  console.log(`Registered test account ${CA_TEST_ACCOUNT} (registration txn ${reg.registrationTxn}). Calling Comprehensive Rates...`);

  // FedEx requires Integrators to use Comprehensive Rates and Transit Times; the plain Rate
  // API (/rate/v1/rates/quotes) returns 403 for this project.
  const url = `${getBaseUrl()}/rate/v1/comprehensiverates/quotes`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-locale': 'en_CA',
  };

  let response;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await httpsPost(url, JSON.stringify(requestBody), headers);
      break;
    } catch (err) {
      lastErr = err;
      if ((err.message.includes('401') || err.message.includes('503')) && attempt < 2) {
        console.log(`  Attempt ${attempt + 1} got ${err.message}, retrying...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      fs.writeFileSync(path.join(OUT_DIR, 'IntegratorCA06_response_ERROR.json'), JSON.stringify(err.body || { error: err.message }, null, 2));
      const reasons = err.body?.errors?.map(e => `${e.code}: ${e.message}`).join('; ');
      throw new Error(`${err.message}${reasons ? ` — ${reasons}` : ''} (transactionId ${err.body?.transactionId || 'n/a'})`);
    }
  }

  // Remove an error file left by an earlier failed run.
  const staleErr = path.join(OUT_DIR, 'IntegratorCA06_response_ERROR.json');
  if (fs.existsSync(staleErr)) fs.unlinkSync(staleErr);

  // Save response
  const resPath = path.join(OUT_DIR, 'IntegratorCA06_response.json');
  fs.writeFileSync(resPath, JSON.stringify(response, null, 2));
  console.log(`✓ Response saved: ${resPath}`);
  console.log(`✓ transactionId: ${response.transactionId}`);

  // Print summary
  const details = response.output?.rateReplyDetails || [];
  console.log(`\n=== IntegratorCA06 Rate Results (${details.length} service(s)) ===`);
  for (const d of details) {
    const svc = d.serviceType || '?';
    const name = d.serviceName || svc;
    const rated = d.ratedShipmentDetails || [];
    const charges = rated.map(r => `${r.rateType}: $${r.totalNetCharge}`).join(', ');
    console.log(`  ${name} (${svc}) — ${charges}`);
  }
  console.log('\nDone. Files saved to:', OUT_DIR);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
