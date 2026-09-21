#!/usr/bin/env node
/**
 * DHL Express Certification — Shipment Creation & Rating Test Cases
 *
 * Runs all 15 ship+rate test cases against the DHL sandbox and saves
 * JSON request/response files + waybill PDFs + commercial invoices
 * for certification submission.
 *
 * From certification spreadsheet Tab 1 ("ShipmentCreation & Quote"):
 *   Cases 1-9:   Outbound (account 971410088, origin YUL/Montreal)
 *   Cases 10-12: Paperless Trade outbound
 *   Cases 13-15: Inbound (account 960124794, various origins)
 *
 * Usage:
 *   node backend/src/scripts/dhlShipAndRateTestCases.js            # all 15
 *   node backend/src/scripts/dhlShipAndRateTestCases.js CA-CH      # substring match
 *   node backend/src/scripts/dhlShipAndRateTestCases.js 6          # by number
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const { getBaseUrl, httpsGet, httpsPost } = require('../services/dhlApi.service');

const OUT_DIR = path.resolve(__dirname, '../../../dhl_test_output');

const OUTBOUND_ACCOUNT = process.env.DHL_ACCOUNT_NUMBER || '971410088';
const INBOUND_ACCOUNT = process.env.DHL_IMPORT_ACCOUNT || '960124794';

// Shipper address for outbound (Montreal / YUL)
const SHIPPER_YUL = {
  postalAddress: {
    postalCode: 'H2Y 1C6',
    cityName: 'MONTREAL',
    countryCode: 'CA',
    provinceCode: 'QC',
    addressLine1: '400 Rue Notre-Dame O',
  },
  contactInformation: {
    phone: '+15141234567',
    companyName: 'International Freight Forwarders',
    fullName: 'IFF Cargo Test',
    email: 'test@iffcargo.com',
  },
};

// Receiver address for inbound to Canada (Brampton / IFF office)
const RECEIVER_CA = {
  postalAddress: {
    postalCode: 'L6T 5M1',
    cityName: 'BRAMPTON',
    countryCode: 'CA',
    provinceCode: 'ON',
    addressLine1: '18 Parkshore Drive',
  },
  contactInformation: {
    phone: '+19051234567',
    companyName: 'International Freight Forwarders',
    fullName: 'IFF Cargo Test',
    email: 'test@iffcargo.com',
  },
};

// ── Helper to get next Friday for Saturday delivery test ──────────
function getNextFriday() {
  const d = new Date();
  const day = d.getDay();
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilFriday);
  return d.toISOString().split('T')[0];
}

function getNextBusinessDay() {
  const d = new Date();
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return d.toISOString().split('T')[0];
}

// ── Test case definitions ─────────────────────────────────────────

const TEST_CASES = [
  // ── Outbound (1-9) ──────────────────────────────────────────────
  {
    num: 1,
    id: 'AM-CA-CH-DOX',
    description: 'Canada → Switzerland, Documents',
    productCode: 'D',
    accountNumber: OUTBOUND_ACCOUNT,
    isCustomsDeclarable: false,
    shipper: SHIPPER_YUL,
    receiver: {
      postalAddress: { postalCode: '3011', cityName: 'BERN', countryCode: 'CH', addressLine1: 'Bundesplatz 1' },
      contactInformation: { phone: '+41311234567', companyName: 'Test Receiver CH', fullName: 'Swiss Test', email: 'test@example.ch' },
    },
    packages: [{ weight: 0.5, dimensions: { length: 5, width: 5, height: 5 }, unitOfMeasurement: 'imperial' }],
    contentDescription: 'DOCUMENTS',
  },
  {
    num: 2,
    id: 'AM-CA-CN-WPX',
    description: 'Canada → China, Audio CDs, Paperless Trade',
    productCode: 'P',
    accountNumber: OUTBOUND_ACCOUNT,
    isCustomsDeclarable: true,
    shipper: SHIPPER_YUL,
    receiver: {
      postalAddress: { postalCode: '213375', cityName: 'LIYANG', countryCode: 'CN', addressLine1: '123 Test Road' },
      contactInformation: { phone: '+8612345678901', companyName: 'Test Receiver CN', fullName: 'China Test', email: 'test@example.cn' },
    },
    packages: [{ weight: 2, dimensions: { length: 10, width: 10, height: 10 }, unitOfMeasurement: 'metric' }],
    contentDescription: 'AUDIO CD\'S',
    exportDeclaration: {
      lineItems: [{
        number: 1,
        description: 'AUDIO CD\'S',
        quantity: { value: 2, unitOfMeasurement: 'PCS' },
        manufacturerCountry: 'CA',
        weight: { netValue: 2, grossValue: 2 },
        exportReasonType: 'permanent',
      }],
      exportReason: 'permanent',
      invoice: { number: 'INV-2026-002', date: getNextBusinessDay() },
      declaredValue: 100,
      declaredValueCurrency: 'CAD',
    },
    customerReferences: [{ value: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789', typeCode: 'CU' }],
    valueAddedServices: [{ serviceCode: 'WY' }],
    incoterm: 'DAP',
  },
  {
    num: 3,
    id: 'AM-CA-GB-TDT',
    description: 'Canada → UK, Passport, 12:00 Express',
    productCode: 'T',
    accountNumber: OUTBOUND_ACCOUNT,
    isCustomsDeclarable: false,
    shipper: SHIPPER_YUL,
    receiver: {
      postalAddress: { postalCode: 'EC4A 1EN', cityName: 'LONDON', countryCode: 'GB', addressLine1: '1 Fleet Street' },
      contactInformation: { phone: '+442071234567', companyName: 'Test Receiver GB', fullName: 'UK Test', email: 'test@example.co.uk' },
    },
    packages: [{ weight: 0.5, dimensions: { length: 9, width: 9, height: 1 }, unitOfMeasurement: 'imperial' }],
    contentDescription: 'PASSPORT',
  },
  {
    num: 4,
    id: 'AM-CA-NG-WPX',
    description: 'Canada → Nigeria, Dutiable, No postal code',
    productCode: 'P',
    accountNumber: OUTBOUND_ACCOUNT,
    isCustomsDeclarable: true,
    shipper: SHIPPER_YUL,
    receiver: {
      postalAddress: { postalCode: '00000', cityName: 'WUDIL', countryCode: 'NG', addressLine1: '1 Market Road' },
      contactInformation: { phone: '+2341234567890', companyName: 'Test Receiver NG', fullName: 'Nigeria Test', email: 'test@example.ng' },
    },
    packages: [{ weight: 1, dimensions: { length: 15, width: 10, height: 5 }, unitOfMeasurement: 'imperial' }],
    contentDescription: 'ANY',
    exportDeclaration: {
      lineItems: [{
        number: 1,
        description: 'ANY',
        quantity: { value: 1, unitOfMeasurement: 'PCS' },
        manufacturerCountry: 'CA',
        weight: { netValue: 1, grossValue: 1 },
        exportReasonType: 'permanent',
      }],
      exportReason: 'permanent',
      invoice: { number: 'INV-2026-004', date: getNextBusinessDay() },
      declaredValue: 50,
      declaredValueCurrency: 'CAD',
    },
    incoterm: 'DAP',
  },
  {
    num: 5,
    id: 'AM-CA-FR-TDK',
    description: 'Canada → France, Photos, 9:00 Express',
    productCode: 'K',
    accountNumber: OUTBOUND_ACCOUNT,
    isCustomsDeclarable: false,
    shipper: SHIPPER_YUL,
    receiver: {
      postalAddress: { postalCode: '75001', cityName: 'PARIS', countryCode: 'FR', addressLine1: '1 Rue de Rivoli' },
      contactInformation: { phone: '+33112345678', companyName: 'Test Receiver FR', fullName: 'France Test', email: 'test@example.fr' },
    },
    packages: [{ weight: 0.5, dimensions: { length: 13, width: 8, height: 1 }, unitOfMeasurement: 'imperial' }],
    contentDescription: 'PHOTOS',
  },
  {
    num: 6,
    id: 'AM-CA-US-TDM',
    description: 'Canada → US, Auto Parts DDP, 3-piece, Insurance + PLT',
    productCode: 'M',
    accountNumber: OUTBOUND_ACCOUNT,
    isCustomsDeclarable: true,
    shipper: SHIPPER_YUL,
    receiver: {
      postalAddress: { postalCode: '91902', cityName: 'BONITA', countryCode: 'US', provinceCode: 'CA', addressLine1: '123 Bonita Road' },
      contactInformation: { phone: '+16191234567', companyName: 'Test Receiver US', fullName: 'US Test', email: 'test@example.com' },
    },
    packages: [
      { weight: 20, dimensions: { length: 18, width: 18, height: 18 }, unitOfMeasurement: 'imperial' },
      { weight: 20, dimensions: { length: 18, width: 18, height: 18 }, unitOfMeasurement: 'imperial' },
      { weight: 20, dimensions: { length: 18, width: 18, height: 18 }, unitOfMeasurement: 'imperial' },
    ],
    contentDescription: 'AUTO PARTS',
    exportDeclaration: {
      lineItems: [{
        number: 1,
        description: 'AUTO PARTS',
        quantity: { value: 3, unitOfMeasurement: 'PCS' },
        manufacturerCountry: 'CN',
        weight: { netValue: 27, grossValue: 27 },
        exportReasonType: 'permanent',
      }],
      exportReason: 'permanent',
      invoice: { number: 'INV-2026-006', date: getNextBusinessDay() },
      declaredValue: 1500,
      declaredValueCurrency: 'CAD',
    },
    valueAddedServices: [
      { serviceCode: 'II', value: 1500, currency: 'CAD' },
      { serviceCode: 'WY' },
    ],
    incoterm: 'DDP',
    dutiesTaxesAccount: OUTBOUND_ACCOUNT,
  },
  {
    num: 7,
    id: 'AM-CA-US-WPX',
    description: 'Canada → US, Samples Return, Neutral Delivery + Data Staging',
    productCode: 'P',
    accountNumber: OUTBOUND_ACCOUNT,
    isCustomsDeclarable: true,
    shipper: SHIPPER_YUL,
    receiver: {
      postalAddress: { postalCode: '84601', cityName: 'PROVO', countryCode: 'US', provinceCode: 'UT', addressLine1: '500 E Center St' },
      contactInformation: { phone: '+18011234567', companyName: 'Test Receiver US', fullName: 'US Test', email: 'test@example.com' },
    },
    packages: [{ weight: 185, dimensions: { length: 42, width: 42, height: 12 }, unitOfMeasurement: 'imperial' }],
    contentDescription: 'SAMPLES',
    exportDeclaration: {
      lineItems: [{
        number: 1,
        description: 'SAMPLES',
        quantity: { value: 3, unitOfMeasurement: 'PCS' },
        manufacturerCountry: 'TW',
        weight: { netValue: 84, grossValue: 84 },
        exportReasonType: 'return',
      }],
      exportReason: 'return',
      invoice: { number: 'INV-2026-007', date: getNextBusinessDay() },
      declaredValue: 600,
      declaredValueCurrency: 'CAD',
    },
    valueAddedServices: [
      { serviceCode: 'NN' },
      { serviceCode: 'PT' },
    ],
    incoterm: 'DAP',
  },
  {
    num: 8,
    id: 'AM-CA-US-TDL',
    description: 'Canada → US, Brochures, 2-piece, Express Easy',
    productCode: 'L',
    accountNumber: OUTBOUND_ACCOUNT,
    isCustomsDeclarable: false,
    shipper: SHIPPER_YUL,
    receiver: {
      postalAddress: { postalCode: '45236', cityName: 'CINCINNATI', countryCode: 'US', provinceCode: 'OH', addressLine1: '123 Main St' },
      contactInformation: { phone: '+15131234567', companyName: 'Test Receiver US', fullName: 'US Test', email: 'test@example.com' },
    },
    packages: [
      { weight: 2, dimensions: { length: 10, width: 10, height: 1 }, unitOfMeasurement: 'imperial' },
      { weight: 3, dimensions: { length: 12, width: 5, height: 2 }, unitOfMeasurement: 'imperial' },
    ],
    contentDescription: 'BROCHURES',
  },
  {
    num: 9,
    id: 'AM-CA-AU-TDE',
    description: 'Canada → Australia, Express Envelope, Dutiable',
    productCode: 'E',
    accountNumber: OUTBOUND_ACCOUNT,
    isCustomsDeclarable: true,
    shipper: SHIPPER_YUL,
    receiver: {
      postalAddress: { postalCode: '2000', cityName: 'SYDNEY', countryCode: 'AU', provinceCode: 'NSW', addressLine1: '1 George St' },
      contactInformation: { phone: '+61212345678', companyName: 'Test Receiver AU', fullName: 'Australia Test', email: 'test@example.au' },
    },
    packages: [{ weight: 3, dimensions: { length: 30, width: 5, height: 8 }, unitOfMeasurement: 'imperial' }],
    contentDescription: 'ANY',
    exportDeclaration: {
      lineItems: [{
        number: 1,
        description: 'ANY',
        quantity: { value: 2, unitOfMeasurement: 'PCS' },
        manufacturerCountry: 'CA',
        weight: { netValue: 1.4, grossValue: 1.4 },
        exportReasonType: 'permanent',
      }],
      exportReason: 'permanent',
      invoice: { number: 'INV-2026-009', date: getNextBusinessDay() },
      declaredValue: 100,
      declaredValueCurrency: 'CAD',
    },
    incoterm: 'DAP',
  },

  // ── Paperless Trade (10-12) ─────────────────────────────────────
  {
    num: 10,
    id: 'AM-CA-MX-WPX',
    description: 'Canada → Mexico, Clothing, Paperless Trade',
    productCode: 'P',
    accountNumber: OUTBOUND_ACCOUNT,
    isCustomsDeclarable: true,
    shipper: SHIPPER_YUL,
    receiver: {
      postalAddress: { postalCode: '44100', cityName: 'GUADALAJARA', countryCode: 'MX', addressLine1: '1 Avenida Hidalgo' },
      contactInformation: { phone: '+523312345678', companyName: 'Test Receiver MX', fullName: 'Mexico Test', email: 'test@example.mx' },
    },
    packages: [{ weight: 0.5, dimensions: { length: 5, width: 5, height: 5 }, unitOfMeasurement: 'imperial' }],
    contentDescription: 'CLOTHING',
    exportDeclaration: {
      lineItems: [{
        number: 1,
        description: 'CLOTHING',
        quantity: { value: 1, unitOfMeasurement: 'PCS' },
        manufacturerCountry: 'CN',
        weight: { netValue: 0.2, grossValue: 0.2 },
        exportReasonType: 'permanent',
      }],
      exportReason: 'permanent',
      invoice: { number: 'INV-2026-010', date: getNextBusinessDay() },
      declaredValue: 500,
      declaredValueCurrency: 'CAD',
    },
    valueAddedServices: [{ serviceCode: 'WY' }],
    incoterm: 'DAP',
  },
  {
    num: 11,
    id: 'AM-CA-US-TDY',
    description: 'Canada → US, Dresses, 2-piece, Paperless Trade',
    productCode: 'Y',
    accountNumber: OUTBOUND_ACCOUNT,
    isCustomsDeclarable: true,
    shipper: SHIPPER_YUL,
    receiver: {
      postalAddress: { postalCode: '10000', cityName: 'NEW YORK', countryCode: 'US', provinceCode: 'NY', addressLine1: '1 Times Square' },
      contactInformation: { phone: '+12121234567', companyName: 'Test Receiver US', fullName: 'US Test', email: 'test@example.com' },
    },
    packages: [
      { weight: 5, dimensions: { length: 9, width: 9, height: 1 }, unitOfMeasurement: 'imperial' },
      { weight: 2, dimensions: { length: 10, width: 5, height: 5 }, unitOfMeasurement: 'imperial' },
    ],
    contentDescription: 'DRESSES',
    exportDeclaration: {
      lineItems: [{
        number: 1,
        description: 'DRESSES',
        quantity: { value: 4, unitOfMeasurement: 'PCS' },
        manufacturerCountry: 'DE',
        weight: { netValue: 3.2, grossValue: 3.2 },
        exportReasonType: 'permanent',
      }],
      exportReason: 'permanent',
      invoice: { number: 'INV-2026-011', date: getNextBusinessDay() },
      declaredValue: 1000,
      declaredValueCurrency: 'CAD',
    },
    valueAddedServices: [{ serviceCode: 'WY' }],
    incoterm: 'DAP',
  },
  {
    num: 12,
    id: 'AM-CA-BR-WPX',
    description: 'Canada → Brazil, DDP, Paperless Trade',
    productCode: 'P',
    accountNumber: OUTBOUND_ACCOUNT,
    isCustomsDeclarable: true,
    shipper: SHIPPER_YUL,
    receiver: {
      postalAddress: { postalCode: '01003', cityName: 'SAO PAULO', countryCode: 'BR', addressLine1: '1 Avenida Paulista' },
      contactInformation: { phone: '+551112345678', companyName: 'Test Receiver BR', fullName: 'Brazil Test', email: 'test@example.br' },
    },
    packages: [{ weight: 1, dimensions: { length: 15, width: 10, height: 5 }, unitOfMeasurement: 'imperial' }],
    contentDescription: 'ANY',
    exportDeclaration: {
      lineItems: [{
        number: 1,
        description: 'ANY',
        quantity: { value: 1, unitOfMeasurement: 'PCS' },
        manufacturerCountry: 'CA',
        weight: { netValue: 0.9, grossValue: 0.9 },
        exportReasonType: 'permanent',
      }],
      exportReason: 'permanent',
      invoice: { number: 'INV-2026-012', date: getNextBusinessDay() },
      declaredValue: 50,
      declaredValueCurrency: 'CAD',
    },
    valueAddedServices: [{ serviceCode: 'WY' }],
    incoterm: 'DDP',
    dutiesTaxesAccount: OUTBOUND_ACCOUNT,
  },

  // ── Inbound (13-15) ─────────────────────────────────────────────
  {
    num: 13,
    id: 'AM-US-CA-DOX',
    description: 'US → Canada, Reports, Documents',
    productCode: 'D',
    accountNumber: INBOUND_ACCOUNT,
    isCustomsDeclarable: false,
    shipper: {
      postalAddress: { postalCode: '10000', cityName: 'NEW YORK', countryCode: 'US', provinceCode: 'NY', addressLine1: '123 Broadway' },
      contactInformation: { phone: '+12121234567', companyName: 'Test Shipper US', fullName: 'US Shipper', email: 'shipper@example.com' },
    },
    receiver: RECEIVER_CA,
    packages: [{ weight: 0.5, dimensions: { length: 5, width: 5, height: 2 }, unitOfMeasurement: 'imperial' }],
    contentDescription: 'REPORTS',
  },
  {
    num: 14,
    id: 'EU-DE-AG-WPX',
    description: 'Germany → Antigua, Electronic Components, DDP',
    productCode: 'P',
    accountNumber: INBOUND_ACCOUNT,
    isCustomsDeclarable: true,
    shipper: {
      postalAddress: { postalCode: '10082', cityName: 'BERLIN', countryCode: 'DE', addressLine1: '1 Friedrichstrasse' },
      contactInformation: { phone: '+493012345678', companyName: 'Test Shipper DE', fullName: 'DE Shipper', email: 'shipper@example.de' },
    },
    receiver: {
      postalAddress: { postalCode: '00000', cityName: 'SAINT JOHN\'S', countryCode: 'AG', addressLine1: 'High Street' },
      contactInformation: { phone: '+12681234567', companyName: 'Test Receiver AG', fullName: 'AG Test', email: 'test@example.ag' },
    },
    packages: [{ weight: 1, dimensions: { length: 2, width: 3, height: 4 }, unitOfMeasurement: 'metric' }],
    contentDescription: 'ELECTRONIC COMPONENTS',
    exportDeclaration: {
      lineItems: [{
        number: 1,
        description: 'ELECTRONIC COMPONENTS',
        quantity: { value: 3, unitOfMeasurement: 'PCS' },
        manufacturerCountry: 'US',
        weight: { netValue: 1, grossValue: 1 },
        exportReasonType: 'permanent',
      }],
      exportReason: 'permanent',
      invoice: { number: 'INV-2026-014', date: getNextBusinessDay() },
      declaredValue: 150,
      declaredValueCurrency: 'CAD',
    },
    incoterm: 'DDP',
    dutiesTaxesAccount: INBOUND_ACCOUNT,
  },
  {
    num: 15,
    id: 'EU-NO-NL-WPX',
    description: 'Norway → Netherlands, Personal Computer, Saturday Delivery',
    productCode: 'P',
    accountNumber: INBOUND_ACCOUNT,
    isCustomsDeclarable: true,
    shipper: {
      postalAddress: { postalCode: '0001', cityName: 'OSLO', countryCode: 'NO', addressLine1: '1 Karl Johans gate' },
      contactInformation: { phone: '+4721234567', companyName: 'Test Shipper NO', fullName: 'NO Shipper', email: 'shipper@example.no' },
    },
    receiver: {
      postalAddress: { postalCode: '1011', cityName: 'AMSTERDAM', countryCode: 'NL', addressLine1: '1 Dam Square' },
      contactInformation: { phone: '+31201234567', companyName: 'Test Receiver NL', fullName: 'NL Test', email: 'test@example.nl' },
    },
    packages: [{ weight: 2, dimensions: { length: 40, width: 30, height: 20 }, unitOfMeasurement: 'metric' }],
    contentDescription: 'PERSONAL COMPUTER',
    exportDeclaration: {
      lineItems: [{
        number: 1,
        description: 'PERSONAL COMPUTER',
        quantity: { value: 1, unitOfMeasurement: 'PCS' },
        manufacturerCountry: 'NO',
        weight: { netValue: 2, grossValue: 2 },
        exportReasonType: 'temporary',
      }],
      exportReason: 'temporary',
      invoice: { number: 'INV-2026-015', date: getNextFriday() },
      declaredValue: 400,
      declaredValueCurrency: 'CAD',
    },
    valueAddedServices: [{ serviceCode: 'AA' }],
    incoterm: 'DAP',
    shipOnFriday: true,
  },
];

// ── Helpers ────────────────────────────────────────────────────────

function ensureOutDir() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
}

function saveJSON(filename, data) {
  const filePath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  const kb = (Buffer.byteLength(JSON.stringify(data, null, 2)) / 1024).toFixed(1);
  console.log(`  ✓ Saved ${filename} (${kb} KB)`);
}

function saveBinary(filename, base64Data) {
  const filePath = path.join(OUT_DIR, filename);
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filePath, buffer);
  console.log(`  ✓ Saved ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
}

// ── Build DHL Rate request (GET query params) ─────────────────────

function buildRateUrl(tc) {
  const shipper = tc.shipper.postalAddress;
  const receiver = tc.receiver.postalAddress;

  // Total weight across all packages
  const totalWeight = tc.packages.reduce((sum, p) => sum + p.weight, 0);
  const firstPkg = tc.packages[0];
  const isMetric = firstPkg.unitOfMeasurement === 'metric';

  const params = new URLSearchParams({
    accountNumber: tc.accountNumber,
    originCountryCode: shipper.countryCode,
    originCityName: shipper.cityName,
    destinationCountryCode: receiver.countryCode,
    destinationCityName: receiver.cityName,
    weight: String(totalWeight),
    length: String(firstPkg.dimensions.length),
    width: String(firstPkg.dimensions.width),
    height: String(firstPkg.dimensions.height),
    plannedShippingDate: tc.shipOnFriday ? getNextFriday() : getNextBusinessDay(),
    isCustomsDeclarable: String(tc.isCustomsDeclarable),
    unitOfMeasurement: isMetric ? 'metric' : 'imperial',
  });

  if (shipper.postalCode) params.set('originPostalCode', shipper.postalCode);
  if (receiver.postalCode) params.set('destinationPostalCode', receiver.postalCode);

  // Request specific product
  params.set('productCode', tc.productCode);
  params.set('numberOfPieces', String(tc.packages.length));

  return `${getBaseUrl()}/rates?${params.toString()}`;
}

// ── Build DHL Shipment request body ───────────────────────────────

function buildShipRequest(tc) {
  const shipDate = tc.shipOnFriday ? getNextFriday() : getNextBusinessDay();
  const isMetric = tc.packages[0].unitOfMeasurement === 'metric';

  // Accounts array
  const accounts = [
    { typeCode: 'shipper', number: tc.accountNumber },
    { typeCode: 'payer', number: tc.accountNumber },
  ];
  if (tc.dutiesTaxesAccount) {
    accounts.push({ typeCode: 'duties-taxes', number: tc.dutiesTaxesAccount });
  }

  // Packages
  // DHL requires at least 1 customerReference per package
  const defaultRef = [{ value: `IFF-${tc.id}`, typeCode: 'CU' }];
  const refs = tc.customerReferences || defaultRef;

  const packages = tc.packages.map((pkg, i) => ({
    weight: pkg.weight,
    dimensions: {
      length: pkg.dimensions.length,
      width: pkg.dimensions.width,
      height: pkg.dimensions.height,
    },
    customerReferences: refs,
    description: tc.contentDescription,
  }));

  // Content
  const content = {
    packages,
    isCustomsDeclarable: tc.isCustomsDeclarable,
    declaredValue: tc.exportDeclaration?.declaredValue || 0,
    declaredValueCurrency: tc.exportDeclaration?.declaredValueCurrency || 'CAD',
    unitOfMeasurement: isMetric ? 'metric' : 'imperial',
    description: tc.contentDescription,
  };

  // Export declaration for dutiable shipments
  if (tc.isCustomsDeclarable && tc.exportDeclaration) {
    content.exportDeclaration = {
      lineItems: tc.exportDeclaration.lineItems.map(li => ({
        number: li.number,
        description: li.description,
        quantity: li.quantity,
        manufacturerCountry: li.manufacturerCountry,
        weight: li.weight,
        price: tc.exportDeclaration.declaredValue / (tc.exportDeclaration.lineItems.length),
      })),
      invoice: tc.exportDeclaration.invoice,
      exportReason: tc.exportDeclaration.exportReason,
    };
    if (tc.incoterm) {
      content.incoterm = tc.incoterm;
    }
  }

  // Value-added services
  const valueAddedServices = (tc.valueAddedServices || []).map(vas => {
    const svc = { serviceCode: vas.serviceCode };
    if (vas.value) svc.value = vas.value;
    if (vas.currency) svc.currency = vas.currency;
    return svc;
  });

  const body = {
    plannedShippingDateAndTime: `${shipDate}T10:00:00 GMT+00:00`,
    pickup: { isRequested: false },
    productCode: tc.productCode,
    accounts,
    customerDetails: {
      shipperDetails: tc.shipper,
      receiverDetails: tc.receiver,
    },
    content,
    outputImageProperties: {
      printerDPI: 300,
      encodingFormat: 'pdf',
      imageOptions: [
        { typeCode: 'waybillDoc', templateName: 'ARCH_8x4_A4_002' },
      ],
    },
    getRateEstimates: false,
    getTransliteratedResponse: false,
  };

  if (valueAddedServices.length > 0) {
    body.valueAddedServices = valueAddedServices;
  }

  // Add commercial invoice request for dutiable shipments
  if (tc.isCustomsDeclarable) {
    body.outputImageProperties.imageOptions.push({
      typeCode: 'invoice',
      templateName: 'COMMERCIAL_INVOICE_P_10',
      isRequested: true,
    });
  }

  return body;
}

// ── Run a single test case (rate + ship) ──────────────────────────

async function runTestCase(tc) {
  console.log(`\n━━━ #${tc.num} ${tc.id}: ${tc.description} ━━━`);

  let rateOk = false;
  let shipOk = false;

  // ── Step 1: Rate ────────────────────────────────────────────────
  console.log('  Step 1: Rating...');
  const rateUrl = buildRateUrl(tc);
  const rateRequestInfo = { method: 'GET', url: rateUrl };

  try {
    const rateResponse = await httpsGet(rateUrl);
    saveJSON(`${tc.id}_rate_request.json`, rateRequestInfo);
    saveJSON(`${tc.id}_rate_response.json`, rateResponse);

    const products = rateResponse.products || [];
    if (products.length > 0) {
      for (const p of products.slice(0, 3)) {
        const price = p.totalPrice?.[0];
        console.log(`  → ${p.productName || p.productCode}: ${price?.price || 'N/A'} ${price?.priceCurrency || ''}`);
      }
      if (products.length > 3) console.log(`  → ... and ${products.length - 3} more products`);
    } else {
      console.log('  → Rate response received (check JSON)');
    }
    rateOk = true;
  } catch (err) {
    console.error(`  ✗ Rate failed: ${err.message}`);
    saveJSON(`${tc.id}_rate_request.json`, rateRequestInfo);
    saveJSON(`${tc.id}_rate_error.json`, { error: err.message, statusCode: err.statusCode, body: err.body });
  }

  // ── Step 2: Ship ────────────────────────────────────────────────
  console.log('  Step 2: Shipment creation...');
  const shipRequest = buildShipRequest(tc);

  try {
    const shipResponse = await httpsPost(
      `${getBaseUrl()}/shipments`,
      JSON.stringify(shipRequest),
    );
    saveJSON(`${tc.id}_ship_request.json`, shipRequest);
    saveJSON(`${tc.id}_ship_response.json`, shipResponse);

    // Extract tracking number
    const trackingNumber = shipResponse.shipmentTrackingNumber;
    if (trackingNumber) {
      console.log(`  → Tracking: ${trackingNumber}`);
    }

    // Extract and save documents (waybill, commercial invoice)
    const documents = shipResponse.documents || [];
    for (const doc of documents) {
      if (doc.content) {
        const ext = (doc.imageFormat || 'pdf').toLowerCase();
        const typeLabel = (doc.typeCode || 'document').toLowerCase();
        saveBinary(`${tc.id}_${typeLabel}.${ext}`, doc.content);
      }
    }

    // Also check shipmentDetails for label content
    const packages = shipResponse.packages || [];
    for (let i = 0; i < packages.length; i++) {
      const docs = packages[i].documents || [];
      for (const doc of docs) {
        if (doc.content) {
          const ext = (doc.imageFormat || 'pdf').toLowerCase();
          const typeLabel = (doc.typeCode || 'label').toLowerCase();
          const suffix = packages.length > 1 ? `_pkg${i + 1}` : '';
          saveBinary(`${tc.id}_${typeLabel}${suffix}.${ext}`, doc.content);
        }
      }
    }

    shipOk = true;
  } catch (err) {
    console.error(`  ✗ Ship failed: ${err.message}`);
    saveJSON(`${tc.id}_ship_request.json`, shipRequest);
    saveJSON(`${tc.id}_ship_error.json`, { error: err.message, statusCode: err.statusCode, body: err.body });
  }

  return { rateOk, shipOk };
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('DHL Express — Ship & Rate Certification Test Cases');
  console.log('='.repeat(55));
  console.log(`Base URL: ${getBaseUrl()}`);
  console.log(`Outbound Account: ${OUTBOUND_ACCOUNT}`);
  console.log(`Inbound Account: ${INBOUND_ACCOUNT}`);

  ensureOutDir();

  // Parse CLI arguments
  const filter = process.argv[2];
  let cases = [...TEST_CASES];
  if (filter) {
    cases = cases.filter(tc =>
      tc.id.includes(filter.toUpperCase()) ||
      String(tc.num) === filter ||
      tc.description.toLowerCase().includes(filter.toLowerCase())
    );
    if (cases.length === 0) {
      console.error(`No test cases matching "${filter}". Available:`);
      TEST_CASES.forEach(tc => console.error(`  ${tc.num}. ${tc.id} — ${tc.description}`));
      process.exit(1);
    }
  }

  console.log(`\nRunning ${cases.length} test case(s)...`);

  const results = [];
  for (const tc of cases) {
    const { rateOk, shipOk } = await runTestCase(tc);
    results.push({ num: tc.num, id: tc.id, description: tc.description, rateOk, shipOk });
  }

  // Summary
  console.log('\n' + '='.repeat(55));
  console.log('Summary:');
  console.log('  #  ID                  Rate  Ship');
  console.log('  ' + '-'.repeat(50));
  for (const r of results) {
    const rateIcon = r.rateOk ? '✓' : '✗';
    const shipIcon = r.shipOk ? '✓' : '✗';
    console.log(`  ${String(r.num).padStart(2)}  ${r.id.padEnd(18)}  ${rateIcon}     ${shipIcon}`);
  }

  const ratesPassed = results.filter(r => r.rateOk).length;
  const shipsPassed = results.filter(r => r.shipOk).length;
  console.log(`\nRates: ${ratesPassed}/${results.length} passed`);
  console.log(`Ships: ${shipsPassed}/${results.length} passed`);

  // List output files
  console.log('\nOutput files:');
  const files = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('AM-') || f.startsWith('EU-')).sort();
  for (const f of files) {
    const stat = fs.statSync(path.join(OUT_DIR, f));
    console.log(`  ${f} (${(stat.size / 1024).toFixed(1)} KB)`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
