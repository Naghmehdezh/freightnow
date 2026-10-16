#!/usr/bin/env node
/**
 * FedEx Integrator Validation — Americas_US_Test cases tab of FedEx_Integrator_Test_Case_Baseline.xlsx
 *
 * Ship: IntegratorUS01–US07 (POST /ship/v1/shipments)
 * Rate: IntegratorUS11       (POST /rate/v1/comprehensiverates/quotes)
 * Track: every shipment created above (POST /track/v1/trackingnumbers)
 *
 * Shipper account is the US Test Account 700257037 (US07 uses the Ground Economy account
 * 740561073, as the spreadsheet specifies). Each account is registered first and every call
 * is made with that account's own CSP token — see fedexTestAccountToken.js.
 *
 * Values marked "Current date" / "Friday" / "1 week post" in the sheet are computed at run time.
 *
 * Usage:
 *   node src/scripts/fedexUsTestCases.js          # all cases
 *   node src/scripts/fedexUsTestCases.js US04     # one case
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const { getBaseUrl, httpsPost } = require('../services/fedexAuth.service');
const { getTestAccountToken } = require('./fedexTestAccountToken');

const https = require('https');
const zlib = require('zlib');

const OUT_DIR = path.resolve(__dirname, '../../../fedex_test_output/us');
// Trade Documents Upload API lives on its own host (not apis-sandbox.fedex.com).
const DOC_API = 'https://documentapitest.prod.fedex.com/sandbox/documents/v1';
const ETD_SAMPLES = path.join(__dirname, 'fedex_etd_samples');
const US_TEST_ACCOUNT = '700257037';
const GROUND_ECONOMY_ACCOUNT = '740561073';

const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => fmt(new Date());
const nextFriday = () => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); return fmt(d); };
const oneWeekOut = () => { const d = new Date(); d.setDate(d.getDate() + 7); return fmt(d); };

// Shipper used by US01–US06 (spreadsheet: James Weston, 1751 THOMPSON ST, AURORA OH 44202).
const AURORA_SHIPPER = (companyName = 'RTC') => ({
  contact: { personName: 'James Weston', companyName, phoneNumber: '9012633035' },
  address: { streetLines: ['1751 THOMPSON ST'], city: 'AURORA', stateOrProvinceCode: 'OH', postalCode: '44202', countryCode: 'US' },
});

// SENDER-paid: "Please use shipper account number".
const senderPays = (account, personName) => ({
  paymentType: 'SENDER',
  payor: { responsibleParty: { accountNumber: { value: account }, contact: { personName }, address: { countryCode: 'US' } } },
});

const SHIP_CASES = [
  {
    id: 'IntegratorUS01',
    description: 'Express Saver, Your Packaging, Alcohol',
    account: US_TEST_ACCOUNT,
    body: () => ({
      labelResponseOptions: 'LABEL',
      accountNumber: { value: US_TEST_ACCOUNT },
      requestedShipment: {
        shipDatestamp: today(),
        pickupType: 'USE_SCHEDULED_PICKUP',
        serviceType: 'FEDEX_EXPRESS_SAVER',
        packagingType: 'YOUR_PACKAGING',
        totalWeight: 36,
        shipper: AURORA_SHIPPER(),
        recipients: [{
          contact: { companyName: 'Integrator', personName: '323401', phoneNumber: '9012633035' },
          address: { streetLines: ['110 Fedex parkway'], city: 'NEW ORLEANS', stateOrProvinceCode: 'LA', postalCode: '70119', countryCode: 'US' },
        }],
        shippingChargesPayment: senderPays(US_TEST_ACCOUNT, 'IntegratorUS01'),
        rateRequestType: ['LIST'],
        totalPackageCount: 1,
        labelSpecification: { labelFormatType: 'COMMON2D', imageType: 'PDF', labelStockType: 'PAPER_85X11_TOP_HALF_LABEL' },
        requestedPackageLineItems: [{
          declaredValue: { amount: 250, currency: 'USD' },
          weight: { units: 'LB', value: 18 },
          dimensions: { length: 20, width: 15, height: 20, units: 'IN' },
          packageSpecialServices: {
            specialServiceTypes: ['ALCOHOL'],
            alcoholDetail: { alcoholRecipientType: 'LICENSEE' },
          },
        }],
      },
    }),
  },
  {
    id: 'IntegratorUS02',
    description: 'Priority Overnight, Your Packaging, Email Notification, Saturday Delivery',
    account: US_TEST_ACCOUNT,
    body: () => ({
      labelResponseOptions: 'LABEL',
      accountNumber: { value: US_TEST_ACCOUNT },
      requestedShipment: {
        shipDatestamp: nextFriday(), // Saturday delivery requires a Friday ship date
        pickupType: 'USE_SCHEDULED_PICKUP',
        serviceType: 'PRIORITY_OVERNIGHT',
        packagingType: 'YOUR_PACKAGING',
        blockInsightVisibility: false,
        shipper: AURORA_SHIPPER(),
        recipients: [{
          contact: { companyName: 'Integrator', personName: '323248', phoneNumber: '9012633035' },
          address: { streetLines: ['20 FedEx Pkwy'], city: 'COLLIERVILLE', stateOrProvinceCode: 'TN', postalCode: '38017', countryCode: 'US' },
        }],
        shippingChargesPayment: senderPays(US_TEST_ACCOUNT, 'IntegratorUS02'),
        shipmentSpecialServices: { specialServiceTypes: ['EVENT_NOTIFICATION', 'SATURDAY_DELIVERY'] },
        emailNotificationDetail: {
          aggregationType: 'PER_PACKAGE',
          personalMessage: 'your personal message here',
          emailNotificationRecipients: [{
            name: 'joe smith',
            emailNotificationRecipientType: 'RECIPIENT',
            emailAddress: 'test001@fedex.com',
            notificationFormatType: 'TEXT',
            notificationType: 'EMAIL',
            locale: 'en_US',
            notificationEventType: ['ON_PICKUP_DRIVER_ARRIVED', 'ON_SHIPMENT'],
          }],
        },
        labelSpecification: { labelFormatType: 'COMMON2D', imageType: 'ZPLII', labelStockType: 'STOCK_4X6' },
        requestedPackageLineItems: [{
          weight: { units: 'LB', value: 20 },
          dimensions: { length: 10, width: 10, height: 10, units: 'IN' },
        }],
      },
    }),
  },
  {
    id: 'IntegratorUS03',
    description: 'FedEx International Priority, Your Packaging',
    account: US_TEST_ACCOUNT,
    body: () => ({
      labelResponseOptions: 'LABEL',
      accountNumber: { value: US_TEST_ACCOUNT },
      requestedShipment: {
        shipDatestamp: today(),
        pickupType: 'USE_SCHEDULED_PICKUP',
        serviceType: 'FEDEX_INTERNATIONAL_PRIORITY',
        packagingType: 'YOUR_PACKAGING',
        totalWeight: 30,
        shipper: { ...AURORA_SHIPPER(), tins: [{ tinType: 'PERSONAL_STATE', number: '123456789' }] },
        recipients: [{
          contact: { companyName: 'Integrator', personName: '413250', phoneNumber: '9012633035' },
          address: { streetLines: ['14 TOTTENHAM COURT ROAD'], city: 'LONDON', postalCode: 'W1T1JY', countryCode: 'GB' },
        }],
        shippingChargesPayment: senderPays(US_TEST_ACCOUNT, 'IntegratorUS03'),
        customsClearanceDetail: {
          dutiesPayment: {
            paymentType: 'SENDER',
            payor: { responsibleParty: { accountNumber: { value: US_TEST_ACCOUNT }, contact: { personName: 'Integrator' }, address: { countryCode: 'US' } } },
          },
          isDocumentOnly: false,
          totalCustomsValue: { currency: 'USD', amount: 55 },
          insuranceCharge: { currency: 'USD', amount: 50 },
          commercialInvoice: {
            comments: ['FEDEX BUSINESS'],
            taxesOrMiscellaneousCharge: { currency: 'USD', amount: 25 },
            taxesOrMiscellaneousChargeType: 'OTHER',
            shipmentPurpose: 'SAMPLE',
            customerReferences: [{ customerReferenceType: 'CUSTOMER_REFERENCE', value: '123456789' }],
          },
          commodities: [{
            numberOfPieces: 1,
            description: 'Dictionaries',
            countryOfManufacture: 'US',
            weight: { units: 'LB', value: 30 },
            quantity: 1,
            quantityUnits: 'EA',
            unitPrice: { currency: 'USD', amount: 100 },
            customsValue: { currency: 'USD', amount: 55 },
          }],
          exportDetail: { b13AFilingOption: 'NOT_REQUIRED', exportComplianceStatement: 'NO EEI 30.37(f)' },
        },
        labelSpecification: { labelFormatType: 'COMMON2D', imageType: 'PDF', labelStockType: 'PAPER_85X11_TOP_HALF_LABEL' },
        rateRequestType: ['LIST'],
        totalPackageCount: 1,
        requestedPackageLineItems: [{
          declaredValue: { currency: 'USD', amount: 55 },
          weight: { units: 'LB', value: 30 },
          dimensions: { length: 20, width: 20, height: 20, units: 'IN' },
          customerReferences: [{ customerReferenceType: 'CUSTOMER_REFERENCE', value: 'Integrator' }],
        }],
      },
    }),
  },
  {
    id: 'IntegratorUS04',
    description: 'Home Delivery, Prepaid, Evening',
    account: US_TEST_ACCOUNT,
    body: () => ({
      labelResponseOptions: 'LABEL',
      accountNumber: { value: US_TEST_ACCOUNT },
      requestedShipment: {
        shipDatestamp: today(),
        pickupType: 'USE_SCHEDULED_PICKUP',
        packagingType: 'YOUR_PACKAGING',
        serviceType: 'GROUND_HOME_DELIVERY',
        totalWeight: 30,
        shipper: AURORA_SHIPPER('Integrator'),
        recipients: [{
          contact: { personName: '814', companyName: 'Integrator', phoneNumber: '9012633035' },
          address: { streetLines: ['109 FEDEX PRKWY'], city: 'Collierville', stateOrProvinceCode: 'TN', postalCode: '38017', countryCode: 'US', residential: true },
        }],
        shippingChargesPayment: senderPays(US_TEST_ACCOUNT, 'IntegratorUS04'),
        shipmentSpecialServices: {
          specialServiceTypes: ['HOME_DELIVERY_PREMIUM'],
          homeDeliveryPremiumDetail: {
            // Exactly as the sheet gives it — a shortened localNumber makes FedEx return INTERNAL.SERVER.ERROR.
            phoneNumber: { areaCode: '901', localNumber: '2633035857', extension: '200' },
            homedeliveryPremiumType: 'EVENING',
            deliveryDate: oneWeekOut(),
          },
        },
        customsClearanceDetail: {
          commercialInvoice: { customerReferences: [{ customerReferenceType: 'CUSTOMER_REFERENCE', value: 'Integrator' }] },
          totalCustomsValue: { currency: 'USD', amount: 25 },
        },
        totalPackageCount: 1,
        labelSpecification: { labelFormatType: 'COMMON2D', imageType: 'PNG', labelStockType: 'PAPER_4X6' },
        rateRequestType: ['LIST'],
        requestedPackageLineItems: [{
          weight: { units: 'LB', value: 30 },
          dimensions: { length: 20, width: 15, height: 20, units: 'IN' },
          declaredValue: { currency: 'USD', amount: 300 },
          packageSpecialServices: { specialServiceTypes: ['NON_STANDARD_CONTAINER'] },
        }],
      },
    }),
  },
  {
    id: 'IntegratorUS05',
    description: 'Ground, Recipient, MPS (2 packages)',
    account: US_TEST_ACCOUNT,
    body: () => ({
      labelResponseOptions: 'LABEL',
      accountNumber: { value: US_TEST_ACCOUNT },
      requestedShipment: {
        shipDatestamp: today(),
        pickupType: 'USE_SCHEDULED_PICKUP',
        packagingType: 'YOUR_PACKAGING',
        serviceType: 'FEDEX_GROUND',
        blockInsightVisibility: false,
        totalWeight: 20,
        shipper: AURORA_SHIPPER('Integrator'),
        recipients: [{
          contact: { personName: '422', companyName: 'Integrator', phoneNumber: '9012633035' },
          address: { streetLines: ['80 FEDEX PRKWY'], city: 'Los Angeles', stateOrProvinceCode: 'CA', postalCode: '90013', countryCode: 'US' },
        }],
        shippingChargesPayment: {
          paymentType: 'RECIPIENT',
          payor: { responsibleParty: { accountNumber: { value: '222327008' }, contact: { personName: 'IntegratorUS05' }, address: { countryCode: 'US' } } },
        },
        totalPackageCount: 2,
        labelSpecification: { labelFormatType: 'COMMON2D', imageType: 'PDF', labelStockType: 'PAPER_85X11_TOP_HALF_LABEL' },
        rateRequestType: ['LIST'],
        requestedPackageLineItems: [1, 2].map(seq => ({
          sequenceNumber: seq,
          weight: { units: 'LB', value: 20 },
          dimensions: { length: 20, width: 15, height: 20, units: 'IN' },
          declaredValue: { currency: 'USD', amount: 100 },
        })),
      },
    }),
  },
  {
    id: 'IntegratorUS06',
    description: 'International Ground, Prepaid, Return Manager Printed Label',
    account: US_TEST_ACCOUNT,
    body: () => ({
      labelResponseOptions: 'LABEL',
      accountNumber: { value: US_TEST_ACCOUNT },
      requestedShipment: {
        shipDatestamp: today(),
        pickupType: 'USE_SCHEDULED_PICKUP',
        packagingType: 'YOUR_PACKAGING',
        serviceType: 'FEDEX_GROUND',
        blockInsightVisibility: false,
        shipper: AURORA_SHIPPER('Integrator'),
        recipients: [{
          contact: { personName: '141', companyName: 'Integrator', phoneNumber: '9012633035' },
          address: { streetLines: ['80 FEDEX PRKWY'], city: 'Mississauga', stateOrProvinceCode: 'ON', postalCode: 'L4W5K6', countryCode: 'CA', residential: true },
        }],
        shippingChargesPayment: senderPays(US_TEST_ACCOUNT, 'IntegratorUS06'),
        shipmentSpecialServices: {
          specialServiceTypes: ['RETURN_SHIPMENT'],
          returnShipmentDetail: { returnType: 'PRINT_RETURN_LABEL' },
        },
        customsClearanceDetail: {
          dutiesPayment: { paymentType: 'SENDER' },
          commercialInvoice: { specialInstructions: 'GSNE.  IOR equals Duties/Taxes payer', shipmentPurpose: 'SAMPLE' },
          customsOption: { type: 'EXHIBITION_TRADE_SHOW' },
          commodities: [{
            description: 'Dictionaries',
            countryOfManufacture: 'US',
            weight: { units: 'LB', value: 10 },
            quantity: 1,
            quantityUnits: 'PC',
            unitPrice: { currency: 'USD', amount: 0 },
            customsValue: { currency: 'USD', amount: 0 },
          }],
        },
        labelSpecification: { labelFormatType: 'COMMON2D', imageType: 'PDF', labelStockType: 'PAPER_85X11_TOP_HALF_LABEL' },
        requestedPackageLineItems: [{ weight: { units: 'LB', value: 10 } }],
      },
    }),
  },
  {
    id: 'IntegratorUS07',
    description: 'FedEx Ground Economy (SMART_POST)',
    account: GROUND_ECONOMY_ACCOUNT,
    body: () => ({
      labelResponseOptions: 'LABEL',
      accountNumber: { value: GROUND_ECONOMY_ACCOUNT },
      requestedShipment: {
        shipDatestamp: today(),
        pickupType: 'USE_SCHEDULED_PICKUP',
        packagingType: 'YOUR_PACKAGING',
        serviceType: 'SMART_POST',
        shipper: {
          contact: { personName: 'ANTHONY JAMES', companyName: 'RTC', phoneNumber: '9012633035' },
          address: { streetLines: ['10 FedEx Pkwy'], city: 'Collierville', stateOrProvinceCode: 'TN', postalCode: '38017', countryCode: 'US' },
        },
        recipients: [{
          contact: { companyName: 'IntegratorUS08', personName: 'ANTHONY JAMES', phoneNumber: '9012633035' },
          address: { streetLines: ['62 Ford St'], city: 'Brulington', stateOrProvinceCode: 'CT', postalCode: '06013', countryCode: 'US' },
        }],
        shippingChargesPayment: {
          paymentType: 'SENDER',
          payor: { responsibleParty: { accountNumber: { value: GROUND_ECONOMY_ACCOUNT }, address: { countryCode: 'US' } } },
        },
        labelSpecification: { labelFormatType: 'COMMON2D', imageType: 'PDF', labelStockType: 'PAPER_85X11_TOP_HALF_LABEL' },
        totalPackageCount: 1,
        smartPostInfoDetail: { indicia: 'PARCEL_SELECT', hubId: '5531' },
        requestedPackageLineItems: [{ weight: { units: 'LB', value: 2.3 } }],
      },
    }),
  },
];

const RATE_CASE = {
  id: 'IntegratorUS11',
  description: 'Rate: PRIORITY_OVERNIGHT, FEDEX_MEDIUM_BOX, One Rate, Hold at Location',
  account: US_TEST_ACCOUNT,
  body: () => ({
    accountNumber: { value: US_TEST_ACCOUNT },
    rateRequestControlParameters: { returnTransitTimes: false },
    requestedShipment: {
      shipDateStamp: today(),
      pickupType: 'USE_SCHEDULED_PICKUP',
      serviceType: 'PRIORITY_OVERNIGHT',
      packagingType: 'FEDEX_MEDIUM_BOX',
      shipper: { address: { city: 'FORT LAUDERDALE', stateOrProvinceCode: 'FL', postalCode: '33301', countryCode: 'US' } },
      recipient: { address: { city: 'FAIRBANKS', stateOrProvinceCode: 'AK', postalCode: '99701', countryCode: 'US' } },
      shippingChargesPayment: { paymentType: 'SENDER' },
      shipmentSpecialServices: { specialServiceTypes: ['FEDEX_ONE_RATE', 'HOLD_AT_LOCATION'] },
      rateRequestType: ['ACCOUNT', 'LIST'],
      requestedPackageLineItems: [{ weight: { units: 'LB', value: 10 } }],
    },
  }),
};


// ─── IntegratorUS09: Electronic Trade Documents ──────────────────────
// Two variants from the sheet: (A) FedEx generates the commercial invoice using uploaded
// letterhead + signature images; (B) we upload our own commercial invoice PDF and attach it.

function uploadMultipart(url, token, documentJson, filePath, contentType) {
  return new Promise((resolve) => {
    const boundary = `----IFFCargo${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(documentJson)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="${path.basename(filePath)}"\r\nContent-Type: ${contentType}\r\n\r\n`),
      fs.readFileSync(filePath),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, 'Accept-Encoding': 'gzip, identity' },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        if (res.headers['content-encoding'] === 'gzip') buf = zlib.gunzipSync(buf);
        let json; try { json = JSON.parse(buf.toString()); } catch { json = { raw: buf.toString() }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    req.write(body);
    req.end();
  });
}

async function upload(id, kind, documentJson, file, contentType) {
  const url = `${DOC_API}/${kind === 'image' ? 'lhsimages' : 'etds'}/upload`;
  const res = await uploadMultipart(url, await tokenFor(US_TEST_ACCOUNT), documentJson, path.join(ETD_SAMPLES, file), contentType);
  fs.writeFileSync(path.join(OUT_DIR, `${id}_request.json`), JSON.stringify({ endpoint: `POST ${url}`, document: documentJson, attachment: file }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `${id}_response.json`), JSON.stringify(res.body, null, 2));
  const ok = res.status >= 200 && res.status < 300 && res.body.output;
  console.log(`  ${ok ? '✓' : '✗'} ${id.padEnd(30)} HTTP ${res.status}${ok ? '' : ` ${JSON.stringify(res.body).slice(0, 200)}`}`);
  if (!ok) throw new Error(`${id} upload failed`);
  return res.body.output;
}

const etdShipment = (recipientName, specialServices, docSpec) => ({
  labelResponseOptions: 'LABEL',
  accountNumber: { value: US_TEST_ACCOUNT },
  requestedShipment: {
    shipDatestamp: today(),
    pickupType: 'USE_SCHEDULED_PICKUP',
    serviceType: 'FEDEX_INTERNATIONAL_PRIORITY',
    packagingType: 'YOUR_PACKAGING',
    totalWeight: 10,
    shipper: {
      contact: { personName: 'PERSONAL_STATE', companyName: 'Integrator', phoneNumber: '9015551234' },
      address: { streetLines: ['1751 THOMPSON ST'], city: 'AURORA', stateOrProvinceCode: 'OH', postalCode: '44202', countryCode: 'US' },
    },
    recipients: [{
      contact: { personName: recipientName, companyName: 'ABC Widget Co', phoneNumber: '9561324887' },
      address: { streetLines: ['80 Fedex Prkwy'], city: 'London', postalCode: 'W1T1JY', countryCode: 'GB' },
    }],
    origin: {
      contact: { personName: 'PERSONAL_STATE', companyName: 'Integrator', phoneNumber: '9015551234' },
      address: { streetLines: ['1751 THOMPSON ST'], city: 'AURORA', stateOrProvinceCode: 'OH', postalCode: '44202', countryCode: 'US' },
    },
    shippingChargesPayment: { paymentType: 'SENDER', payor: { responsibleParty: { accountNumber: { value: US_TEST_ACCOUNT } } } },
    shipmentSpecialServices: specialServices,
    customsClearanceDetail: {
      dutiesPayment: {
        paymentType: 'SENDER',
        payor: { responsibleParty: {
          accountNumber: { value: US_TEST_ACCOUNT },
          address: { streetLines: ['15 W 18TH ST FL 7'], city: 'NEW YORK', stateOrProvinceCode: 'NY', postalCode: '10011-4624', countryCode: 'US' },
        } },
      },
      isDocumentOnly: false,
      commercialInvoice: { termsOfSale: 'DDP', originatorName: 'originatorName' },
      totalCustomsValue: { currency: 'USD', amount: 25 },
      commodities: [{
        numberOfPieces: 1, description: 'Computer Keyboard', countryOfManufacture: 'US',
        weight: { units: 'LB', value: 10 }, quantity: 1, quantityUnits: 'pcs',
        unitPrice: { currency: 'USD', amount: 25 }, customsValue: { currency: 'USD', amount: 25 },
      }],
    },
    labelSpecification: { labelFormatType: 'COMMON2D', imageType: 'PDF', labelStockType: 'PAPER_85X11_TOP_HALF_LABEL' },
    shippingDocumentSpecification: docSpec,
    rateRequestType: ['LIST'],
    preferredCurrency: 'USD',
    totalPackageCount: 1,
    requestedPackageLineItems: [{
      sequenceNumber: 1,
      weight: { units: 'LB', value: 10 },
      dimensions: { length: 5, width: 5, height: 5, units: 'IN' },
      customerReferences: [{ customerReferenceType: 'CUSTOMER_REFERENCE', value: 'ref1234' }],
    }],
  },
});

const ETD_CASES = [
  {
    id: 'IntegratorUS09_A_ETD_Image',
    description: 'International Priority, ETD — invoice generated with uploaded letterhead + signature',
    account: US_TEST_ACCOUNT,
    prepare: async () => {
      await upload('IntegratorUS09_A_upload_letterhead', 'image',
        { document: { referenceId: '1234', name: 'signature3.png', contentType: 'image/png', meta: { imageType: 'LETTERHEAD', imageIndex: 'IMAGE_1' } }, rules: { workflowName: 'LetterheadSignature' } },
        'signature3.png', 'image/png');
      await upload('IntegratorUS09_A_upload_signature', 'image',
        { document: { referenceId: '1234', name: 'signature2.png', contentType: 'image/png', meta: { imageType: 'SIGNATURE', imageIndex: 'IMAGE_2' } }, rules: { workflowName: 'LetterheadSignature' } },
        'signature2.png', 'image/png');
    },
    body: () => etdShipment('IntegratorUS09',
      { specialServiceTypes: ['ELECTRONIC_TRADE_DOCUMENTS'], etdDetail: { requestedDocumentTypes: ['COMMERCIAL_INVOICE'] } },
      {
        shippingDocumentTypes: ['COMMERCIAL_INVOICE'],
        commercialInvoiceDetail: {
          customerImageUsages: [{ id: 'IMAGE_1', type: 'LETTER_HEAD' }, { id: 'IMAGE_2', type: 'SIGNATURE' }],
          documentFormat: { docType: 'PDF', stockType: 'PAPER_LETTER' },
        },
      }),
  },
  {
    id: 'IntegratorUS09_B_ETD_Document',
    description: 'International Priority, ETD — uploaded commercial invoice PDF attached by document ID',
    account: US_TEST_ACCOUNT,
    prepare: async () => {
      const out = await upload('IntegratorUS09_B_upload_invoice', 'document',
        { workflowName: 'ETDPreshipment', name: 'CommercialInvoice.pdf', contentType: 'application/pdf', meta: { shipDocumentType: 'COMMERCIAL_INVOICE', originCountryCode: 'US', destinationCountryCode: 'IT' } },
        'CommercialInvoice.pdf', 'application/pdf');
      return { docId: out.meta?.docId };
    },
    body: ctx => etdShipment('IntegratorUS13',
      {
        specialServiceTypes: ['ELECTRONIC_TRADE_DOCUMENTS'],
        etdDetail: { attachedDocuments: [{ documentType: 'COMMERCIAL_INVOICE', documentId: ctx.docId, description: 'CommercialInvoice' }] },
      },
      { shippingDocumentTypes: ['COMMERCIAL_INVOICE'], commercialInvoiceDetail: { documentFormat: { docType: 'PDF', stockType: 'PAPER_LETTER' } } }),
  },
];


// ─── IntegratorUS10: International Priority Distribution consolidation ───
// FedEx "virtual" test: account 123456789, consolidation index 794904933293 and the 2024 dates
// are fixed values the sandbox answers with canned responses, so they're sent exactly as given.
const VIRTUAL_ACCOUNT = '123456789';
const CONSOLIDATION_KEY = { type: 'INTERNATIONAL_PRIORITY_DISTRIBUTION', index: '794904933293', date: '2024-01-03' };
const TORONTO_IOR = {
  address: { residential: false, city: 'TORONTO', countryCode: 'CA', postalCode: 'M1M1M1', streetLines: ['MORELOS 417 COL CENTRO', 'Suite 101'], stateOrProvinceCode: 'ON' },
  contact: { personName: 'SHPC-440836-CL2203C8', phoneNumber: '9012633035', companyName: 'GRT' },
};
const MEMPHIS_GRT = {
  address: { residential: false, city: 'MEMPHIS', countryCode: 'US', stateOrProvinceCode: 'TN', postalCode: '38125', streetLines: ['GRT TEST ACCOUNT- DO NOT TOUCH', 'DONG SAN HUAN BEI ROAD'] },
  contact: { personName: 'XIAO LI', phoneNumber: '12124567890', companyName: 'ABC COMPANY' },
};
const thirdPartyVirtual = { paymentType: 'THIRD_PARTY', payor: { responsibleParty: { accountNumber: { value: VIRTUAL_ACCOUNT }, address: { countryCode: 'US' } } } };

const CONSOLIDATION_STEPS = [
  {
    id: 'IntegratorUS10_1_CreateConsolidation',
    path: '/ship/v1/consolidations',
    body: () => ({
      accountNumber: { value: VIRTUAL_ACCOUNT },
      requestedConsolidation: {
        consolidationType: 'INTERNATIONAL_PRIORITY_DISTRIBUTION',
        specialServicesRequested: {
          specialServiceTypes: ['INTERNATIONAL_CONTROLLED_EXPORT_SERVICE'],
          internationalControlledExportDetail: { licenseOrPermitExpirationDate: '2024-12-18', licenseOrPermitNumber: '123', type: 'DEA_486' },
        },
        shipper: { ...MEMPHIS_GRT, tins: [{ number: '59165821389', tinType: 'PERSONAL_NATIONAL' }] },
        consolidationDataSources: [{ consolidationDataType: 'TOTAL_FREIGHT_CHARGES', consolidationDataSourceType: 'ACCUMULATED' }],
        consolidationDocumentSpecification: {
          consolidationDocumentTypes: ['CONSOLIDATED_COMMERCIAL_INVOICE'],
          consolidatedCommercialInvoiceDetail: { format: { stockType: 'PAPER_LETTER', docType: 'PDF' } },
        },
        soldTo: { ...TORONTO_IOR, accountNumber: { value: VIRTUAL_ACCOUNT } },
        labelSpecification: { labelFormatType: 'COMMON2D', labelStockType: 'PAPER_4X6', imageType: 'PNG' },
        customsClearanceDetail: {
          importerOfRecord: TORONTO_IOR,
          customsValue: { amount: 200, currency: 'USD' },
          dutiesPayment: { ...thirdPartyVirtual, billingDetails: { accountNumber: VIRTUAL_ACCOUNT } },
          documentContent: 'NON_DOCUMENTS',
          recipientCustomsId: { type: 'COMPANY', value: '125' },
        },
        origin: MEMPHIS_GRT,
        internationalDistributionDetail: {
          declarationCurrencies: [{ currency: 'USD', value: 'CUSTOMS_VALUE' }],
          totalDimensions: { length: 10, width: 10, height: 10, units: 'IN' },
          clearanceFacilityLocationId: 'YWGI',
          dropOffType: 'REGULAR_PICKUP',
          totalInsuredValue: { amount: 200, currency: 'USD' },
          unitSystem: 'ENGLISH',
        },
        shippingChargesPayment: thirdPartyVirtual,
      },
    }),
  },
  ...[1, 2, 3, 4, 5, 6].map(n => ({
    id: `IntegratorUS10_2_AddShipment${n}`,
    path: '/ship/v1/consolidations/shipments',
    body: () => ({
      accountNumber: { value: VIRTUAL_ACCOUNT },
      labelResponseOptions: 'LABEL',
      openShipmentAction: 'CONFIRM',
      consolidationKey: CONSOLIDATION_KEY,
      requestedShipment: {
        serviceType: 'INTERNATIONAL_PRIORITY_DISTRIBUTION',
        packagingType: 'YOUR_PACKAGING',
        pickupType: 'USE_SCHEDULED_PICKUP',
        shipTimestamp: '2024-01-03T01:30:00-05:00',
        shipper: {
          address: { residential: false, city: 'MEMPHIS', countryCode: 'US', postalCode: '38125', streetLines: ['80 FedEx Parkway', 'Suite 101'] },
          contact: { personName: 'Shipper name', phoneNumber: '12124567890', companyName: 'Shipper company' },
        },
        origin: {
          address: { residential: false, city: 'MEMPHIS', countryCode: 'US', postalCode: '38125', streetLines: ['80 FedEx Parkway', 'Suite 101'] },
          contact: { personName: 'Origin name', phoneNumber: '12124567890', companyName: 'Origin COMPANY' },
        },
        recipients: [{
          address: { residential: false, streetLines: ['RTC', '4011 MALDEN RD'], city: 'TORONTO', countryCode: 'CA', postalCode: 'M1M1M1', stateOrProvinceCode: 'ON' },
          contact: { personName: 'TEst name', phoneNumber: '19512390523', companyName: 'Test company' },
        }],
        labelSpecification: {
          labelFormatType: 'COMMON2D', labelStockType: 'PAPER_4X6', imageType: 'PNG',
          printedLabelOrigin: {
            address: { streetLines: ['RTC', '4011 MALDEN RD'], city: 'TORONTO', countryCode: 'CA', postalCode: 'M1M1M1', stateOrProvinceCode: 'ON' },
            contact: { personName: 'TestAutomation', emailAddress: 'abc123456@fedex.com', phoneNumber: '19512390523', phoneExtension: '10', companyName: 'COMPANYA' },
          },
        },
        customerReferences: [
          { customerReferenceType: 'CUSTOMER_REFERENCE', value: 'i-f89999-tc0203-c1' },
          { customerReferenceType: 'INVOICE_NUMBER', value: 'i-f89999-tc0203-c1' },
        ],
        customsClearanceDetail: {
          dutiesPayment: { ...thirdPartyVirtual, billingDetails: { accountNumber: VIRTUAL_ACCOUNT } },
          totalCustomsValue: { amount: 500, currency: 'USD' },
          isDocumentOnly: false,
        },
        specialServicesRequested: {
          specialServiceTypes: ['INTERNATIONAL_CONTROLLED_EXPORT_SERVICE'],
          internationalControlledExportDetail: { licenseOrPermitExpirationDate: '2024-12-18', licenseOrPermitNumber: '123', type: 'DEA_486' },
        },
        shippingChargesPayment: thirdPartyVirtual,
        processingOption: { options: ['PACKAGE_LEVEL_COMMODITIES'] },
        requestedPackageLineItems: [{
          groupPackageCount: 35,
          declaredValue: { amount: 14.28, currency: 'USD' },
          weight: { units: 'LB', value: 120 },
          commodities: [{
            unitPrice: { amount: 500, currency: 'USD' }, numberOfPieces: 1, quantity: 1, quantityUnits: 'EA',
            customsValue: { amount: 500, currency: 'USD' }, countryOfManufacture: 'CA', harmonizedCode: '4901990010',
            description: 'Textbooks', weight: { units: 'LB', value: 100 },
          }],
        }],
      },
    }),
  })),
  {
    id: 'IntegratorUS10_3_ConfirmConsolidation',
    path: '/ship/v1/consolidations/confirmations',
    body: () => ({
      accountNumber: { value: VIRTUAL_ACCOUNT },
      consolidationKey: CONSOLIDATION_KEY,
      labelSpecification: { labelFormatType: 'COMMON2D', labelStockType: 'PAPER_4X6', imageType: 'PDF' },
      processingOptionType: 'ALLOW_ASYNCHRONOUS',
      edtRequestType: 'ALL',
    }),
  },
  {
    id: 'IntegratorUS10_4_ConfirmResults',
    path: '/ship/v1/consolidations/confirmationresults',
    body: () => ({ accountNumber: { value: VIRTUAL_ACCOUNT }, jobId: '41u120371133650224874999733' }),
  },
];

async function runConsolidation() {
  const results = [];
  for (const step of CONSOLIDATION_STEPS) {
    clearOld(step.id);
    const body = step.body();
    fs.writeFileSync(path.join(OUT_DIR, `${step.id}_request.json`), JSON.stringify(body, null, 2));
    const res = await call(step.path, body, US_TEST_ACCOUNT);
    fs.writeFileSync(path.join(OUT_DIR, `${step.id}_response${res.ok ? '' : '_ERROR'}.json`), JSON.stringify(res.data, null, 2));
    const txn = res.data.transactionId || '—';
    const reasons = res.ok ? '' : (res.data.errors?.map(e => `${e.code}: ${e.message}`).join('; ') || res.message);
    console.log(`  ${res.ok ? '✓' : '✗'} ${step.id.padEnd(38)} txn ${txn}${reasons ? `\n      ${reasons}` : ''}`);
    results.push({ id: step.id, ok: res.ok, txn, reason: reasons || undefined });
  }
  return results;
}

// ─── runner ───────────────────────────────────────────────────────────

const tokens = {};
async function tokenFor(account) {
  if (!tokens[account]) {
    const reg = await getTestAccountToken(account);
    tokens[account] = reg.accessToken;
    console.log(`Registered test account ${account} (registration txn ${reg.registrationTxn})`);
  }
  return tokens[account];
}

function clearOld(id) {
  for (const f of fs.readdirSync(OUT_DIR)) if (f.startsWith(`${id}_`)) fs.unlinkSync(path.join(OUT_DIR, f));
}

async function call(urlPath, body, account) {
  const headers = { Authorization: `Bearer ${await tokenFor(account)}`, 'Content-Type': 'application/json', 'X-locale': 'en_US' };
  try {
    return { ok: true, data: await httpsPost(`${getBaseUrl()}${urlPath}`, JSON.stringify(body), headers) };
  } catch (err) {
    return { ok: false, data: err.body || { error: err.message }, message: err.message };
  }
}

const EXT = { PDF: 'pdf', PNG: 'png', ZPLII: 'zpl', EPL2: 'epl' };

async function runShip(tc) {
  clearOld(tc.id);
  let ctx = {};
  if (tc.prepare) {
    try { ctx = (await tc.prepare()) || {}; } catch (err) {
      console.log(`  ✗ ${tc.id.padEnd(15)} ${err.message}`);
      return { id: tc.id, ok: false, txn: '—', reason: err.message };
    }
  }
  const body = tc.body(ctx);
  fs.writeFileSync(path.join(OUT_DIR, `${tc.id}_request.json`), JSON.stringify(body, null, 2));
  const res = await call('/ship/v1/shipments', body, tc.account);
  const txn = res.data.transactionId || '—';
  if (!res.ok) {
    fs.writeFileSync(path.join(OUT_DIR, `${tc.id}_response_ERROR.json`), JSON.stringify(res.data, null, 2));
    const reasons = res.data.errors?.map(e => `${e.code}: ${e.message}`).join('; ') || res.message;
    console.log(`  ✗ ${tc.id.padEnd(15)} ${tc.description}\n      ${reasons}\n      txn ${txn}`);
    return { id: tc.id, ok: false, txn, reason: reasons };
  }
  fs.writeFileSync(path.join(OUT_DIR, `${tc.id}_response.json`), JSON.stringify(res.data, null, 2));
  const shipment = res.data.output?.transactionShipments?.[0];
  const tracking = [];
  let labels = 0;
  for (const [i, piece] of (shipment?.pieceResponses || []).entries()) {
    if (piece.trackingNumber) tracking.push(piece.trackingNumber);
    for (const [j, doc] of (piece.packageDocuments || []).entries()) {
      if (!doc.encodedLabel) continue;
      const ext = EXT[(doc.docType || body.requestedShipment.labelSpecification.imageType).toUpperCase()] || 'bin';
      const suffix = (shipment.pieceResponses.length > 1 ? `_pkg${i + 1}` : '') + (j > 0 ? `_${j + 1}` : '');
      const buf = Buffer.from(doc.encodedLabel, 'base64');
      fs.writeFileSync(path.join(OUT_DIR, `${tc.id}_label${suffix}.${ext}`), ext === 'zpl' ? buf.toString() : buf);
      labels++;
    }
  }
  // Shipment-level documents FedEx generates (e.g. the ETD commercial invoice).
  for (const [k, doc] of (shipment?.shipmentDocuments || []).entries()) {
    if (!doc.encodedLabel) continue;
    const ext = EXT[(doc.docType || 'PDF').toUpperCase()] || 'pdf';
    const type = (doc.contentType || 'DOCUMENT').toLowerCase();
    fs.writeFileSync(path.join(OUT_DIR, `${tc.id}_${type}${k ? `_${k + 1}` : ''}.${ext}`), Buffer.from(doc.encodedLabel, 'base64'));
  }
  const alerts = res.data.output?.alerts?.map(a => a.code).join(', ');
  console.log(`  ✓ ${tc.id.padEnd(15)} ${tc.description}\n      tracking ${tracking.join(', ') || '—'} | labels ${labels} | txn ${txn}${alerts ? ` | alerts: ${alerts}` : ''}`);
  return { id: tc.id, ok: true, txn, tracking, account: tc.account };
}

async function runRate(tc) {
  clearOld(tc.id);
  const body = tc.body();
  fs.writeFileSync(path.join(OUT_DIR, `${tc.id}_request.json`), JSON.stringify(body, null, 2));
  const res = await call('/rate/v1/comprehensiverates/quotes', body, tc.account);
  const txn = res.data.transactionId || '—';
  fs.writeFileSync(path.join(OUT_DIR, `${tc.id}_response${res.ok ? '' : '_ERROR'}.json`), JSON.stringify(res.data, null, 2));
  if (!res.ok) {
    const reasons = res.data.errors?.map(e => `${e.code}: ${e.message}`).join('; ') || res.message;
    console.log(`  ✗ ${tc.id.padEnd(15)} ${tc.description}\n      ${reasons}\n      txn ${txn}`);
    return { id: tc.id, ok: false, txn, reason: reasons };
  }
  const svc = (res.data.output?.rateReplyDetails || []).map(d => `${d.serviceType} ${d.ratedShipmentDetails?.[0]?.totalNetCharge} ${d.ratedShipmentDetails?.[0]?.currency || ''}`);
  console.log(`  ✓ ${tc.id.padEnd(15)} ${tc.description}\n      ${svc.join('; ')} | txn ${txn}`);
  return { id: tc.id, ok: true, txn };
}

async function runTrack(shipResult) {
  const out = [];
  for (const trk of shipResult.tracking) {
    const body = { includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber: trk } }] };
    const name = `${shipResult.id}_track${shipResult.tracking.length > 1 ? `_${trk}` : ''}`;
    fs.writeFileSync(path.join(OUT_DIR, `${name}_request.json`), JSON.stringify(body, null, 2));
    const res = await call('/track/v1/trackingnumbers', body, shipResult.account);
    fs.writeFileSync(path.join(OUT_DIR, `${name}_response${res.ok ? '' : '_ERROR'}.json`), JSON.stringify(res.data, null, 2));
    const status = res.data.output?.completeTrackResults?.[0]?.trackResults?.[0]?.latestStatusDetail?.description;
    out.push({ trk, ok: res.ok, status, txn: res.data.transactionId });
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filter = process.argv[2]?.toUpperCase();
  const pick = list => list.filter(tc => !filter || tc.id.toUpperCase().includes(filter));
  console.log(`FedEx US test cases — sandbox ${getBaseUrl()}\nOutput: ${OUT_DIR}\n`);

  const results = [];
  console.log('Ship');
  for (const tc of pick(SHIP_CASES)) results.push(await runShip(tc));
  console.log('\nElectronic Trade Documents (US09)');
  for (const tc of pick(ETD_CASES)) results.push(await runShip(tc));
  if (!filter || 'INTEGRATORUS10'.includes(filter) || filter.includes('US10')) {
    console.log('\nConsolidation (US10)');
    results.push(...await runConsolidation());
  }
  console.log('\nRate');
  for (const tc of pick([RATE_CASE])) results.push(await runRate(tc));

  const shipped = results.filter(r => r.ok && r.tracking?.length);
  if (shipped.length) {
    console.log('\nTrack');
    for (const r of shipped) {
      for (const t of await runTrack(r)) console.log(`  ${t.ok ? '✓' : '✗'} ${r.id.padEnd(15)} ${t.trk} — ${t.status || 'no status'}`);
    }
  }

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} ship/rate cases passed.`);
  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
