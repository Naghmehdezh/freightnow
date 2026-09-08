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
const { getToken, getBaseUrl, httpsPost } = require('../services/fedexAuth.service');

const OUT_DIR = path.resolve(__dirname, '../../../fedex_test_output');

async function run() {
  // Ensure output directory exists
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const accountNumber = process.env.FEDEX_ACCOUNT_NUMBER;
  if (!accountNumber) {
    console.error('FEDEX_ACCOUNT_NUMBER not set in .env');
    process.exit(1);
  }

  // Build the ship date — FedEx Rate API expects YYYY-MM-DD only
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const shipDateStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // ----- Exact IntegratorCA06 request body from the spreadsheet -----
  const requestBody = {
    accountNumber: { value: accountNumber },
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
            accountNumber: { value: accountNumber },
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

  // Get OAuth token and call FedEx Rate API
  console.log('Acquiring OAuth token...');
  const token = await getToken();
  console.log('Token acquired. Calling Rate API...');

  const url = `${getBaseUrl()}/rate/v1/rates/quotes`;
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
      throw err;
    }
  }

  // Save response
  const resPath = path.join(OUT_DIR, 'IntegratorCA06_response.json');
  fs.writeFileSync(resPath, JSON.stringify(response, null, 2));
  console.log(`✓ Response saved: ${resPath}`);

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
