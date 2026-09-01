const { connectDB, mongoose } = require('./config/database');
const bcrypt = require('bcrypt');

const Company = require('./models/Company');
const User = require('./models/User');
const PaymentMethod = require('./models/PaymentMethod');
const Quote = require('./models/Quote');
const QuoteRate = require('./models/QuoteRate');
const Booking = require('./models/Booking');
const Shipment = require('./models/Shipment');
const TrackingEvent = require('./models/TrackingEvent');
const Claim = require('./models/Claim');
const Invoice = require('./models/Invoice');
const Carrier = require('./models/Carrier');
const MarkupRule = require('./models/MarkupRule');
const Address = require('./models/Address');
const Payment = require('./models/Payment');
const ClaimDocument = require('./models/ClaimDocument');

const bookingService = require('./services/booking.service');
const activityLogService = require('./services/activityLog.service');

async function main() {
  await connectDB();
  console.log('Seeding database...');

  // Carriers and markup rules must exist before any rate/booking logic runs.
  const carrierDefs = [
    { carrierId: 'fedex', name: 'FedEx', shipmentTypes: ['envelope', 'parcel', 'ltl'], credentialsRef: 'env:FEDEX_API_KEY' },
    { carrierId: 'xpo', name: 'XPO Logistics', shipmentTypes: ['ltl'], credentialsRef: 'env:XPO_API_KEY' },
    { carrierId: 'dayross', name: 'Day & Ross', shipmentTypes: ['ltl', 'parcel', 'envelope'], credentialsRef: 'env:DAYROSS_API_KEY' },
    { carrierId: 'manitoulin', name: 'Manitoulin', shipmentTypes: ['ltl'], credentialsRef: 'env:MANITOULIN_API_KEY' },
    { carrierId: 'polaris', name: 'Polaris', shipmentTypes: ['ltl'], credentialsRef: 'env:POLARIS_API_KEY' },
  ];
  for (const c of carrierDefs) {
    await Carrier.create({ ...c, enabled: true, providesLiveRates: false });
  }

  const now = new Date();
  const tiers = [
    { minAmount: 0, maxAmount: 100, markupMultiplier: 1.70 },
    { minAmount: 100, maxAmount: 250, markupMultiplier: 1.55 },
    { minAmount: 250, maxAmount: 500, markupMultiplier: 1.40 },
    { minAmount: 500, maxAmount: 1000, markupMultiplier: 1.30 },
    { minAmount: 1000, maxAmount: 2500, markupMultiplier: 1.20 },
    { minAmount: 2500, maxAmount: null, markupMultiplier: 1.15 },
  ];
  for (const t of tiers) {
    await MarkupRule.create({ ...t, effectiveFrom: now, isActive: true });
  }

  // Company
  const company = await Company.create({
    name: 'Acme Corp', street: '100 King St W', city: 'Toronto', province: 'Ontario', postalCode: 'M5V 3A8', country: 'CA',
    phone: '416 555 0100', taxNumber: '123456789RT0001', shippingType: 'LTL Freight',
  });

  // Users — one per role
  const passwordHash = await bcrypt.hash('demo1234', 12);
  const termsAccepted = new Date('2026-06-01T12:00:00Z');
  const user = await User.create({
    email: 'john@acmecorp.com', passwordHash, firstName: 'John', lastName: 'Smith', phone: '416 555 0100',
    role: 'customer', company: company._id,
    termsAcceptedAt: termsAccepted, termsAcceptedFromIp: '127.0.0.1',
    fedexTermsAcceptedAt: termsAccepted, fedexTermsAcceptedFromIp: '127.0.0.1',
  });

  const janeHash = await bcrypt.hash('demo1234', 12);
  const jane = await User.create({
    email: 'jane@acmecorp.com', passwordHash: janeHash, firstName: 'Jane', lastName: 'Smith', phone: '416 555 0101',
    role: 'company_admin', company: company._id,
    termsAcceptedAt: termsAccepted, termsAcceptedFromIp: '127.0.0.1',
    fedexTermsAcceptedAt: termsAccepted, fedexTermsAcceptedFromIp: '127.0.0.1',
  });

  const staffHash = await bcrypt.hash('staff1234', 12);
  await User.create({ email: 'staff@iffcargo.com', passwordHash: staffHash, firstName: 'Sam', lastName: 'Staff', role: 'iff_staff' });

  const adminHash = await bcrypt.hash('admin1234', 12);
  await User.create({ email: 'admin@iffcargo.com', passwordHash: adminHash, firstName: 'Admin', lastName: 'IFF', role: 'iff_admin' });

  // Saved company address
  await Address.create({
    company: company._id, createdBy: jane._id,
    contactName: 'Jane Smith', companyName: 'Acme Corp', phone: '416 555 0101',
    street: '100 King St W', city: 'Toronto', province: 'Ontario', postalCode: 'M5V 3A8', country: 'CA',
    isResidential: false, isVerified: true,
  });

  // Payment methods
  await PaymentMethod.create({ company: company._id, user: user._id, type: 'visa', last4: '4242', expiryMonth: 12, expiryYear: 2027, isDefault: true });
  await PaymentMethod.create({ company: company._id, user: user._id, type: 'mastercard', last4: '8888', expiryMonth: 6, expiryYear: 2028, isDefault: false });

  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  // A browsable, unbooked quote (5 carrier rates, none selected yet)
  const browsableQuote = await Quote.create({
    quoteNumber: 'Q-2026-0001', user: user._id, shipmentType: 'ltl',
    originCity: 'Toronto', originPostal: 'M5V3A8', originCountry: 'CA',
    destCity: 'Chicago', destPostal: '60601', destCountry: 'US',
    weight: 500, pieces: 2, dimL: 48, dimW: 40, dimH: 48, freightClass: '70', currency: 'CAD',
    pickupDate: '2026-07-10', expiresAt: endOfToday, status: 'active',
  });
  const browsableRates = [
    { carrierId: 'fedex', carrierName: 'FedEx', serviceName: 'Freight Economy', baseRate: 245.80, displayRate: 319.54, transitDays: 4, estimatedDelivery: '2026-07-16', isBestRate: true },
    { carrierId: 'dayross', carrierName: 'Day & Ross', serviceName: 'Standard LTL', baseRate: 268.50, displayRate: 349.05, transitDays: 5, estimatedDelivery: '2026-07-17' },
    { carrierId: 'manitoulin', carrierName: 'Manitoulin', serviceName: 'Direct Freight', baseRate: 282.30, displayRate: 367.00, transitDays: 4, estimatedDelivery: '2026-07-16' },
    { carrierId: 'xpo', carrierName: 'XPO Logistics', serviceName: 'LTL Standard', baseRate: 298.40, displayRate: 387.92, transitDays: 5, estimatedDelivery: '2026-07-17' },
    { carrierId: 'polaris', carrierName: 'Polaris', serviceName: 'Freight Standard', baseRate: 312.10, displayRate: 405.73, transitDays: 6, estimatedDelivery: '2026-07-18' },
  ];
  for (const r of browsableRates) {
    await QuoteRate.create({ quote: browsableQuote._id, isLiveRate: false, isBestRate: false, ...r });
  }

  // Booked shipments — each goes through a real Quote -> Booking -> Shipment chain.
  // Fixtures with a specific historical status (delivered/in_transit) are assembled directly
  // since the real booking flow can't yet produce backdated carrier-scan history on its own.
  const bookedDate = new Date('2026-06-25T10:00:00Z');

  async function createHistoricalFixture(quoteSeq, bookingSeq, f) {
    const quote = await Quote.create({
      quoteNumber: `Q-2026-${quoteSeq}`, user: user._id, shipmentType: f.type,
      originCity: f.origCity, originPostal: f.origPostal, originCountry: f.origCountry,
      destCity: f.destCity, destPostal: f.destPostal, destCountry: f.destCountry,
      weight: f.weight, pieces: f.pieces, currency: 'CAD', expiresAt: endOfToday, status: 'booked',
    });
    const rate = await QuoteRate.create({
      quote: quote._id, carrierId: f.carrier, carrierName: f.carrierName, serviceName: f.service,
      baseRate: f.baseRate, displayRate: f.displayRate, transitDays: 4, estimatedDelivery: f.estDelivery,
      isLiveRate: false, isBestRate: true,
    });

    const booking = await Booking.create({
      bookingNumber: `BK-2026-${bookingSeq}`, quote: quote._id, quoteRate: rate._id,
      user: user._id, company: company._id,
      carrierId: f.carrier, carrierName: f.carrierName, serviceName: f.service,
      costRate: f.baseRate, sellRate: f.displayRate, currency: 'CAD', status: 'confirmed',
    });

    const shipment = await Shipment.create({
      trackingNumber: f.tracking, user: user._id, company: company._id, booking: booking._id,
      carrierId: f.carrier, carrierName: f.carrierName, serviceName: f.service, shipmentType: f.type,
      originCity: f.origCity, originPostal: f.origPostal, originCountry: f.origCountry,
      destCity: f.destCity, destPostal: f.destPostal, destCountry: f.destCountry,
      weight: f.weight, pieces: f.pieces, currency: 'CAD', status: f.status,
      estimatedDelivery: f.estDelivery, actualDelivery: f.actualDelivery,
    });

    const events = [
      { event: 'Booked', location: f.origCity, timestamp: bookedDate, description: 'Shipment booked - awaiting carrier pickup' },
    ];
    if (f.status !== 'pending') {
      events.push({ event: 'Picked up', location: f.origCity, timestamp: new Date(bookedDate.getTime() + 86400000), description: 'Package picked up by carrier' });
      events.push({ event: 'In transit', location: 'Distribution Center', timestamp: new Date(bookedDate.getTime() + 172800000), description: 'Shipment in transit to destination' });
    }
    if (f.status === 'delivered') {
      events.push({ event: 'Out for delivery', location: f.destCity, timestamp: new Date(bookedDate.getTime() + 259200000), description: 'Out for delivery' });
      events.push({ event: 'Delivered', location: f.destCity, timestamp: new Date(bookedDate.getTime() + 345600000), description: 'Delivered - signed by receiver' });
    }
    for (const evt of events) {
      await TrackingEvent.create({ shipment: shipment._id, ...evt });
    }

    return { quote, booking, shipment };
  }

  await createHistoricalFixture('0002', '0001', { tracking: 'IFF-2026-00001', carrier: 'fedex', carrierName: 'FedEx', service: 'Freight Economy', type: 'ltl', origCity: 'Toronto', origPostal: 'M5V3A8', origCountry: 'CA', destCity: 'Chicago', destPostal: '60601', destCountry: 'US', weight: 500, pieces: 2, baseRate: 245.80, displayRate: 319.54, status: 'delivered', estDelivery: '2026-06-28', actualDelivery: '2026-06-27' });
  await createHistoricalFixture('0003', '0002', { tracking: 'IFF-2026-00002', carrier: 'dayross', carrierName: 'Day & Ross', service: 'Direct LTL', type: 'ltl', origCity: 'Montreal', origPostal: 'H2X1Y4', origCountry: 'CA', destCity: 'Vancouver', destPostal: 'V6B2W2', destCountry: 'CA', weight: 350, pieces: 1, baseRate: 412.50, displayRate: 536.25, status: 'delivered', estDelivery: '2026-06-30', actualDelivery: '2026-06-30' });
  await createHistoricalFixture('0004', '0003', { tracking: 'IFF-2026-00003', carrier: 'fedex', carrierName: 'FedEx', service: 'Ground', type: 'parcel', origCity: 'Toronto', origPostal: 'M5V3A8', origCountry: 'CA', destCity: 'New York', destPostal: '10001', destCountry: 'US', weight: 12, pieces: 1, baseRate: 45.20, displayRate: 76.84, status: 'in_transit', estDelivery: '2026-07-09', actualDelivery: null });
  await createHistoricalFixture('0005', '0004', { tracking: 'IFF-2026-00004', carrier: 'manitoulin', carrierName: 'Manitoulin', service: 'Consolidated LTL', type: 'ltl', origCity: 'Calgary', origPostal: 'T2P1J9', origCountry: 'CA', destCity: 'Toronto', destPostal: 'M5V3A8', destCountry: 'CA', weight: 820, pieces: 3, baseRate: 580.00, displayRate: 754.00, status: 'in_transit', estDelivery: '2026-07-11', actualDelivery: null });
  await createHistoricalFixture('0006', '0005', { tracking: 'IFF-2026-00005', carrier: 'polaris', carrierName: 'Polaris', service: 'Freight Select', type: 'ltl', origCity: 'Toronto', origPostal: 'M5V3A8', origCountry: 'CA', destCity: 'Edmonton', destPostal: 'T5J0N3', destCountry: 'CA', weight: 1200, pieces: 4, baseRate: 890.00, displayRate: 1157.00, status: 'in_transit', estDelivery: '2026-07-12', actualDelivery: null });

  // Real end-to-end booking flow — proves Quote -> Booking -> Shipment actually works.
  const xpoQuote = await Quote.create({
    quoteNumber: 'Q-2026-0007', user: user._id, shipmentType: 'ltl',
    originCity: 'Toronto', originPostal: 'M5V3A8', originCountry: 'CA',
    destCity: 'Los Angeles', destPostal: '90001', destCountry: 'US',
    weight: 650, pieces: 2, currency: 'CAD', expiresAt: endOfToday, status: 'active',
  });
  const xpoRate = await QuoteRate.create({
    quote: xpoQuote._id, carrierId: 'xpo', carrierName: 'XPO Logistics', serviceName: 'LTL Priority',
    baseRate: 720.00, displayRate: 936.00, transitDays: 5, estimatedDelivery: '2026-07-14',
    isLiveRate: false, isBestRate: true,
  });
  const { booking: xpoBooking } = await bookingService.createBooking(user._id.toString(), {
    quoteId: xpoQuote._id.toString(),
    quoteRateId: xpoRate._id.toString(),
  });

  await createHistoricalFixture('0008', '0007', { tracking: 'IFF-2026-00007', carrier: 'fedex', carrierName: 'FedEx', service: 'Express Saver', type: 'envelope', origCity: 'Toronto', origPostal: 'M5V3A8', origCountry: 'CA', destCity: 'Ottawa', destPostal: 'K1A0A9', destCountry: 'CA', weight: 0.5, pieces: 1, baseRate: 22.50, displayRate: 38.25, status: 'delivered', estDelivery: '2026-07-02', actualDelivery: '2026-07-02' });

  // Stub Payment off the real-flow booking — status succeeded but qbTransactionId explicitly
  // null (no real QuickBooks integration yet, not faking a real-looking reference).
  await Payment.create({ booking: xpoBooking._id, user: user._id, amount: xpoBooking.sellRate, currency: 'CAD', qbTransactionId: null, status: 'succeeded' });

  // Claims
  const claimsData = [
    { claimNumber: 'CLM-2026-0001', tracking: 'IFF-2026-00001', carrier: 'fedex', carrierName: 'FedEx', type: 'Damaged goods', amount: 1240, desc: 'Box crushed during transit, 3 items inside damaged', status: 'under_review' },
    { claimNumber: 'CLM-2026-0002', tracking: 'IFF-2026-00002', carrier: 'dayross', carrierName: 'Day & Ross', type: 'Shortage', amount: 380, desc: '2 of 4 boxes missing from pallet', status: 'approved' },
    { claimNumber: 'CLM-2026-0003', tracking: 'IFF-2026-00003', carrier: 'fedex', carrierName: 'FedEx', type: 'Lost shipment', amount: 2100, desc: 'Package never arrived, last scan was 10 days ago', status: 'under_review' },
    { claimNumber: 'CLM-2026-0004', tracking: 'IFF-2026-00004', carrier: 'manitoulin', carrierName: 'Manitoulin', type: 'Delay', amount: 500, desc: 'Delivery was 5 business days late, causing production delays', status: 'closed' },
  ];

  let firstClaim = null;
  for (const c of claimsData) {
    const claim = await Claim.create({
      claimNumber: c.claimNumber, user: user._id, trackingNumber: c.tracking,
      carrierId: c.carrier, carrierName: c.carrierName, claimType: c.type,
      amountClaimed: c.amount, currency: 'CAD', description: c.desc, status: c.status,
    });
    if (!firstClaim) firstClaim = claim;
  }

  // Stub ClaimDocument off the first claim — obviously placeholder storageKey, no real file.
  await ClaimDocument.create({
    claim: firstClaim._id, uploadedBy: user._id, documentType: 'photo',
    fileName: 'damage-photo-1.jpg', mimeType: 'image/jpeg', fileSizeBytes: 245678,
    storageKey: 'seed/placeholder.jpg',
  });

  // Invoices
  const invoicesData = [
    { number: 'INV-2026-0001', amount: 4218.00, status: 'paid', date: '2026-07-01' },
    { number: 'INV-2026-0002', amount: 3842.50, status: 'paid', date: '2026-06-01' },
    { number: 'INV-2026-0003', amount: 5120.75, status: 'paid', date: '2026-05-01' },
    { number: 'INV-2026-0004', amount: 2915.00, status: 'paid', date: '2026-04-01' },
    { number: 'INV-2026-0005', amount: 4680.25, status: 'paid', date: '2026-03-01' },
  ];

  for (const inv of invoicesData) {
    await Invoice.create({
      invoiceNumber: inv.number, company: company._id, user: user._id, totalAmount: inv.amount, currency: 'CAD', status: inv.status,
      issuedAt: new Date(inv.date), paidAt: inv.status === 'paid' ? new Date(new Date(inv.date).getTime() + 7 * 86400000) : null,
    });
  }

  // Exercise the real ActivityLog helper end-to-end.
  await activityLogService.logActivity(user._id, company._id, 'login', { seeded: true });

  console.log('Seed completed successfully!');
  console.log('Customer:      john@acmecorp.com / demo1234');
  console.log('Company admin: jane@acmecorp.com / demo1234');
  console.log('IFF staff:     staff@iffcargo.com / staff1234');
  console.log('IFF admin:     admin@iffcargo.com / admin1234');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
