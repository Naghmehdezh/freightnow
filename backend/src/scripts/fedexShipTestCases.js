#!/usr/bin/env node
/**
 * FedEx Integrator Validation — Ship Test Cases IntegratorCA01–CA05
 *
 * Runs the 5 CA ship test cases from the FedEx_Integrator_Test_Case_Baseline.xlsx
 * against the FedEx sandbox, saving request JSON, response JSON, and label files.
 *
 * Usage:
 *   node backend/src/scripts/fedexShipTestCases.js          # run all 5
 *   node backend/src/scripts/fedexShipTestCases.js CA03      # run single case
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const { getToken, getBaseUrl, httpsPost } = require('../services/fedexAuth.service');

const OUT_DIR = path.resolve(__dirname, '../../../fedex_test_output');
const ACCOUNT_NUMBER = process.env.FEDEX_ACCOUNT_NUMBER;

// ── Shared shipper for all CA test cases ────────────────────────────
const SHIPPER = {
  contact: { personName: 'Integrator', companyName: 'RTC', phoneNumber: '9052125456' },
  address: {
    streetLines: ['5985 EXPLORER DR'],
    city: 'Mississauga',
    stateOrProvinceCode: 'ON',
    postalCode: 'L4W5K6',
    countryCode: 'CA',
  },
};

// ── 5 Test Cases ────────────────────────────────────────────────────

const TEST_CASES = [
  {
    id: 'IntegratorCA01',
    description: 'CA Express Domestic — FEDEX_EXPRESS_SAVER, YOUR_PACKAGING, PDF label',
    serviceType: 'FEDEX_EXPRESS_SAVER',
    packagingType: 'YOUR_PACKAGING',
    recipient: {
      contact: { personName: 'FES-1001', companyName: 'Recipient Company', phoneNumber: '9052125251' },
      address: {
        streetLines: ['Recipient address Line 1'],
        city: 'Winnipeg',
        stateOrProvinceCode: 'MB',
        postalCode: 'R2G0A1',
        countryCode: 'CA',
      },
    },
    weight: { units: 'LB', value: 15 },
    dimensions: { length: 25, width: 25, height: 25, units: 'IN' },
    labelSpec: { imageType: 'PDF', labelStockType: 'PAPER_85X11_TOP_HALF_LABEL' },
    shippingPayment: { paymentType: 'SENDER' },
    blockInsightVisibility: false,
    rateRequestType: ['LIST'],
    customerReference: 'CUSTOMER_REFERENCE',
    totalPackageCount: 1,
  },
  {
    id: 'IntegratorCA02',
    description: 'CA Express Domestic — PRIORITY_OVERNIGHT, FEDEX_TUBE, PNG label',
    serviceType: 'PRIORITY_OVERNIGHT',
    packagingType: 'FEDEX_TUBE',
    recipient: {
      contact: { personName: 'PO-1007', companyName: 'Recipient Company', phoneNumber: '9012367890' },
      address: {
        streetLines: ['Recipient address Line 1'],
        city: 'St-Laurent',
        stateOrProvinceCode: 'PQ',
        postalCode: 'H4S1A1',
        countryCode: 'CA',
      },
    },
    weight: { units: 'LB', value: 15 },
    dimensions: null,
    labelSpec: { imageType: 'PNG', labelStockType: 'PAPER_4X6' },
    shippingPayment: { paymentType: 'SENDER' },
    blockInsightVisibility: false,
    rateRequestType: ['LIST'],
    customerReference: 'CUSTOMER_REFERENCE',
    totalPackageCount: 1,
  },
  {
    id: 'IntegratorCA03',
    description: 'CA Express Intl — FEDEX_INTERNATIONAL_PRIORITY, FEDEX_TUBE, Saturday, 3rd-party duties, PDF',
    serviceType: 'FEDEX_INTERNATIONAL_PRIORITY',
    packagingType: 'FEDEX_TUBE',
    recipient: {
      contact: { personName: 'IP-1007', companyName: 'Recipient Company', phoneNumber: '9012367890' },
      address: {
        streetLines: ['Intergrator Testing'],
        city: 'Lancaster',
        stateOrProvinceCode: 'PA',
        postalCode: '17601',
        countryCode: 'US',
      },
    },
    weight: { units: 'LB', value: 4 },
    dimensions: null,
    labelSpec: { imageType: 'PDF', labelStockType: 'PAPER_85X11_TOP_HALF_LABEL' },
    shippingPayment: { paymentType: 'SENDER' },
    specialServices: { specialServiceTypes: ['SATURDAY_DELIVERY'] },
    customs: {
      dutiesPayment: {
        paymentType: 'THIRD_PARTY',
        payor: {
          responsibleParty: {
            accountNumber: { value: '198823520' },
            contact: { personName: 'Integrator Testing' },
            address: { countryCode: 'CA' },
          },
        },
      },
      isDocumentOnly: true,
      totalCustomsValue: { currency: 'CAD', amount: 15 },
      commodities: [{
        numberOfPieces: 1,
        description: 'Dictionaries',
        countryOfManufacture: 'CA',
        weight: { units: 'LB', value: 4 },
        quantity: 1,
        quantityUnits: 'EA',
        unitPrice: { currency: 'CAD', amount: 15 },
        customsValue: { currency: 'CAD', amount: 15 },
      }],
    },
    blockInsightVisibility: false,
    rateRequestType: ['LIST'],
    customerReference: 'CUSTOMER_REFERENCE',
    totalPackageCount: 1,
  },
  {
    id: 'IntegratorCA04',
    description: 'CA Ground Intl — FEDEX_GROUND, YOUR_PACKAGING, 3rd-party billing, Signature Direct, PDF',
    serviceType: 'FEDEX_GROUND',
    packagingType: 'YOUR_PACKAGING',
    recipient: {
      contact: { personName: '2509', companyName: 'Recipient Company', phoneNumber: '8009887652' },
      address: {
        streetLines: ['Recipient Address Line 10'],
        city: 'Anchorage',
        stateOrProvinceCode: 'AK',
        postalCode: '99502',
        countryCode: 'US',
      },
    },
    weight: { units: 'LB', value: 60 },
    dimensions: { length: 25, width: 25, height: 25, units: 'IN' },
    labelSpec: { imageType: 'PDF', labelStockType: 'PAPER_85X11_TOP_HALF_LABEL' },
    shippingPayment: {
      paymentType: 'THIRD_PARTY',
      accountNumber: '150067600',
      contact: { personName: 'Integrator Testing' },
      countryCode: 'CA',
    },
    packageSpecialServices: {
      specialServiceTypes: ['SIGNATURE_OPTION'],
      signatureOptionDetail: { signatureReleaseNumber: '' },
      signatureOptionType: 'DIRECT',
    },
    customs: {
      dutiesPayment: {
        paymentType: 'THIRD_PARTY',
        payor: {
          responsibleParty: {
            accountNumber: { value: '150067600' },
            contact: { personName: 'Integrator Testing' },
            address: { countryCode: 'CA' },
          },
        },
      },
      isDocumentOnly: false,
      totalCustomsValue: { currency: 'CAD', amount: 100 },
      commodities: [{
        numberOfPieces: 1,
        description: 'Dictionaries',
        countryOfManufacture: 'CA',
        weight: { units: 'LB', value: 60 },
        quantity: 1,
        quantityUnits: 'EA',
        unitPrice: { currency: 'CAD', amount: 100 },
        customsValue: { currency: 'CAD', amount: 100 },
      }],
    },
    blockInsightVisibility: false,
    rateRequestType: ['LIST'],
    customerReference: 'CUSTOMER_REFERENCE',
    declaredValue: { currency: 'CAD', amount: 100 },
    totalPackageCount: 1,
  },
  {
    id: 'IntegratorCA05',
    description: 'CA Ground Domestic — FEDEX_GROUND, YOUR_PACKAGING, ZPL label',
    serviceType: 'FEDEX_GROUND',
    packagingType: 'YOUR_PACKAGING',
    recipient: {
      contact: { personName: '1502', companyName: 'Recipient Company', phoneNumber: '8889708898' },
      address: {
        streetLines: ['Recipient Address Line 1'],
        city: 'Burnaby',
        stateOrProvinceCode: 'BC',
        postalCode: 'V5H4K7',
        countryCode: 'CA',
      },
    },
    weight: { units: 'LB', value: 23 },
    dimensions: { length: 20, width: 20, height: 20, units: 'IN' },
    labelSpec: { imageType: 'ZPLII', labelStockType: 'STOCK_4X6' },
    shippingPayment: { paymentType: 'SENDER' },
    blockInsightVisibility: false,
    rateRequestType: ['LIST'],
    customerReference: 'CUSTOMER_REFERENCE',
    declaredValue: { currency: 'CAD', amount: 1200 },
    totalPackageCount: 1,
  },
];

// ── Build FedEx Ship API request body ───────────────────────────────

function buildShipRequest(tc) {
  const shipDate = new Date().toISOString().split('T')[0];

  const body = {
    labelResponseOptions: 'LABEL',
    accountNumber: { value: ACCOUNT_NUMBER },
    requestedShipment: {
      shipDatestamp: shipDate,
      serviceType: tc.serviceType,
      packagingType: tc.packagingType,
      pickupType: 'USE_SCHEDULED_PICKUP',
      shipper: SHIPPER,
      recipients: [tc.recipient],
      shippingChargesPayment: buildPayment(tc.shippingPayment),
      labelSpecification: {
        labelFormatType: 'COMMON2D',
        imageType: tc.labelSpec.imageType,
        labelStockType: tc.labelSpec.labelStockType,
      },
      requestedPackageLineItems: [buildPackageLineItem(tc)],
    },
  };

  if (tc.blockInsightVisibility !== undefined) {
    body.requestedShipment.blockInsightVisibility = tc.blockInsightVisibility;
  }

  if (tc.totalPackageCount) {
    body.requestedShipment.totalPackageCount = tc.totalPackageCount;
  }

  if (tc.rateRequestType) {
    body.requestedShipment.rateRequestType = tc.rateRequestType;
  }

  if (tc.specialServices) {
    body.requestedShipment.shipmentSpecialServices = tc.specialServices;
  }

  if (tc.customs) {
    body.requestedShipment.customsClearanceDetail = tc.customs;
  }

  return body;
}

function buildPayment(paymentConfig) {
  if (!paymentConfig || paymentConfig.paymentType === 'SENDER') {
    return {
      paymentType: 'SENDER',
      payor: {
        responsibleParty: {
          accountNumber: { value: ACCOUNT_NUMBER },
          contact: { personName: 'Integrator Testing' },
          address: { countryCode: 'CA' },
        },
      },
    };
  }
  return {
    paymentType: paymentConfig.paymentType,
    payor: {
      responsibleParty: {
        accountNumber: { value: paymentConfig.accountNumber || ACCOUNT_NUMBER },
        ...(paymentConfig.contact && { contact: paymentConfig.contact }),
        ...(paymentConfig.countryCode && { address: { countryCode: paymentConfig.countryCode } }),
      },
    },
  };
}

function buildPackageLineItem(tc) {
  const item = {
    weight: tc.weight,
  };
  if (tc.dimensions) {
    item.dimensions = {
      length: tc.dimensions.length,
      width: tc.dimensions.width,
      height: tc.dimensions.height,
      units: tc.dimensions.units || 'IN',
    };
  }
  if (tc.declaredValue) {
    item.declaredValue = tc.declaredValue;
  }
  if (tc.customerReference) {
    item.customerReferences = [{
      customerReferenceType: tc.customerReference,
      value: tc.customerReference,
    }];
  }
  // Package-level special services (e.g. SIGNATURE_OPTION goes here, not shipment level)
  if (tc.packageSpecialServices) {
    item.packageSpecialServices = tc.packageSpecialServices;
  }
  return item;
}

// ── Save label file from base64 ─────────────────────────────────────

function saveLabel(tcId, labelData, docType) {
  if (!labelData) {
    console.warn(`  ⚠ No label data for ${tcId}`);
    return null;
  }
  const extMap = { PDF: 'pdf', PNG: 'png', ZPLII: 'zpl' };
  const ext = extMap[docType] || 'bin';
  const filename = `${tcId}_label.${ext}`;
  const filePath = path.join(OUT_DIR, filename);
  const buffer = Buffer.from(labelData, 'base64');
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// ── Main ────────────────────────────────────────────────────────────

async function runTestCase(tc) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${tc.id}: ${tc.description}`);
  console.log('='.repeat(60));

  // Build and save request
  const requestBody = buildShipRequest(tc);
  const reqPath = path.join(OUT_DIR, `${tc.id}_request.json`);
  fs.writeFileSync(reqPath, JSON.stringify(requestBody, null, 2));
  console.log(`  ✓ Request saved: ${tc.id}_request.json`);

  // Get token and call Ship API
  const token = await getToken();
  const url = `${getBaseUrl()}/ship/v1/shipments`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-locale': 'en_CA',
  };
  const bodyStr = JSON.stringify(requestBody);

  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      data = await httpsPost(url, bodyStr, headers);
      break;
    } catch (err) {
      if ((err.message.includes('401') || err.message.includes('503')) && attempt < 2) {
        console.log(`  Attempt ${attempt + 1} failed (${err.message}), retrying...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      // Save error response if available
      const errPath = path.join(OUT_DIR, `${tc.id}_response_ERROR.json`);
      fs.writeFileSync(errPath, JSON.stringify({ error: err.message }, null, 2));
      console.error(`  ✗ FAILED: ${err.message}`);
      console.log(`  Error saved: ${tc.id}_response_ERROR.json`);
      return false;
    }
  }

  // Save response
  const resPath = path.join(OUT_DIR, `${tc.id}_response.json`);
  fs.writeFileSync(resPath, JSON.stringify(data, null, 2));
  console.log(`  ✓ Response saved: ${tc.id}_response.json`);

  // Extract tracking number
  const shipment = data.output?.transactionShipments?.[0];
  const trackingNumber = shipment?.masterTrackingNumber
    || shipment?.pieceResponses?.[0]?.trackingNumber
    || 'N/A';
  console.log(`  ✓ Tracking number: ${trackingNumber}`);

  // Extract and save label
  const doc = shipment?.pieceResponses?.[0]?.packageDocuments?.[0];
  if (doc?.encodedLabel) {
    const labelPath = saveLabel(tc.id, doc.encodedLabel, doc.docType || tc.labelSpec.imageType);
    if (labelPath) {
      const size = fs.statSync(labelPath).size;
      console.log(`  ✓ Label saved: ${path.basename(labelPath)} (${(size / 1024).toFixed(1)} KB)`);
    }
  } else if (doc?.url) {
    console.log(`  ✓ Label URL: ${doc.url}`);
  } else {
    console.warn(`  ⚠ No label found in response`);
  }

  // Log alerts if any
  if (data.output?.alerts?.length) {
    console.log(`  ⚠ Alerts: ${data.output.alerts.map(a => `${a.code}: ${a.message}`).join('; ')}`);
  }

  return true;
}

async function main() {
  if (!ACCOUNT_NUMBER) {
    console.error('FEDEX_ACCOUNT_NUMBER not set in .env');
    process.exit(1);
  }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Allow running a single test case via CLI arg
  const filter = process.argv[2]?.toUpperCase();
  const cases = filter
    ? TEST_CASES.filter(tc => tc.id.toUpperCase().includes(filter))
    : TEST_CASES;

  if (cases.length === 0) {
    console.error(`No test case matching "${filter}". Available: ${TEST_CASES.map(tc => tc.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`FedEx Ship API Test Cases — ${cases.length} case(s)`);
  console.log(`Sandbox: ${getBaseUrl()}`);
  console.log(`Account: ${ACCOUNT_NUMBER}`);
  console.log(`Output:  ${OUT_DIR}`);

  let passed = 0;
  let failed = 0;
  for (const tc of cases) {
    const ok = await runTestCase(tc);
    if (ok) passed++; else failed++;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${cases.length}`);
  console.log(`Files saved to: ${OUT_DIR}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
