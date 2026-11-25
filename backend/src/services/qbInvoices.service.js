const Company = require('../models/Company');
const { qbRequest, getConnectionStatus, ENVIRONMENT } = require('./quickbooks.service');
const { ValidationError } = require('../utils/errors');
const { convert } = require('../utils/currency');

// QuickBooks Online invoices with Intuit's hosted "Pay now" link (customer pays on Intuit's page;
// IFF never sees the card). Used for "Pay with QuickBooks link" bookings.
//
// Sandbox caveats (verified Nov 2026): invoices and links are created, but the link opens a
// placeholder page and emailing the invoice fails — use simulatePayment() to test the flow.

const MINOR = 'minorversion=75';
let cachedItemId = null;
let cachedPrefs = null;

async function realmPath() {
  const status = await getConnectionStatus();
  if (!status.connected) throw new ValidationError('QuickBooks is not connected, so payment links are unavailable. Please pay by card.');
  return `/v3/company/${status.realmId}`;
}

const escape = s => String(s).replace(/'/g, "\\'");

async function query(base, sql) {
  const res = await qbRequest('GET', `${base}/query?query=${encodeURIComponent(sql)}&${MINOR}`);
  return res.QueryResponse || {};
}

// The QuickBooks company's home currency and whether it can invoice in other currencies.
async function currencyPrefs(base) {
  if (cachedPrefs) return cachedPrefs;
  const prefs = (await qbRequest('GET', `${base}/preferences?${MINOR}`)).Preferences || {};
  cachedPrefs = {
    home: prefs.CurrencyPrefs?.HomeCurrency?.value || 'USD',
    multi: !!prefs.CurrencyPrefs?.MultiCurrencyEnabled,
  };
  return cachedPrefs;
}

// A "Freight services" service item to put on invoices (created once if missing).
async function ensureFreightItem(base) {
  if (cachedItemId) return cachedItemId;
  const found = (await query(base, "select Id from Item where Name = 'Freight services'")).Item?.[0];
  if (found) { cachedItemId = found.Id; return cachedItemId; }
  const income = (await query(base, "select Id from Account where AccountType = 'Income' maxresults 1")).Account?.[0];
  if (!income) throw new Error('QuickBooks has no income account to post freight sales to');
  const item = (await qbRequest('POST', `${base}/item?${MINOR}`, {
    Name: 'Freight services', Type: 'Service', IncomeAccountRef: { value: income.Id },
  })).Item;
  cachedItemId = item.Id;
  return cachedItemId;
}

// The QuickBooks customer for an IFF company (created once; id kept on the company).
async function ensureCustomer(base, company, user) {
  if (company.qbCustomerId) return company.qbCustomerId;
  const name = company.name || `${user.firstName} ${user.lastName}`;
  let customer = (await query(base, `select Id from Customer where DisplayName = '${escape(name)}'`)).Customer?.[0];
  if (!customer) {
    customer = (await qbRequest('POST', `${base}/customer?${MINOR}`, {
      DisplayName: name,
      CompanyName: company.name,
      ...(user?.email && { PrimaryEmailAddr: { Address: user.email } }),
    })).Customer;
  }
  await Company.updateOne({ _id: company._id }, { qbCustomerId: customer.Id });
  return customer.Id;
}

// Invoice with online card/bank payment allowed, plus its Pay-now link.
async function createInvoice({ company, user, amount, currency, description, bookingNumber, dueDate, usdToCad }) {
  const base = await realmPath();
  const prefs = await currencyPrefs(base);
  // Sandbox only: a test company that can't bill in this currency gets the same amount in its own
  // currency (the booking keeps the customer's currency). Live invoices are never converted.
  if (ENVIRONMENT === 'sandbox' && currency !== prefs.home && !prefs.multi) {
    const converted = convert(amount, currency, prefs.home, usdToCad);
    console.log(`[QB SANDBOX] Test company bills in ${prefs.home}: invoicing ${converted} ${prefs.home} for ${Number(amount).toFixed(2)} ${currency}`);
    description = `${description} [sandbox: ${Number(amount).toFixed(2)} ${currency} billed as ${prefs.home}]`;
    amount = converted;
    currency = prefs.home;
  }
  if (currency !== prefs.home && !prefs.multi) {
    throw new ValidationError(`IFF's QuickBooks company bills in ${prefs.home}, so a ${currency} payment link can't be created. Please pay by card.`);
  }
  const [customerId, itemId] = await Promise.all([ensureCustomer(base, company, user), ensureFreightItem(base)]);
  const invoice = (await qbRequest('POST', `${base}/invoice?${MINOR}`, {
    CustomerRef: { value: customerId },
    ...(user?.email && { BillEmail: { Address: user.email } }),
    ...(currency !== prefs.home && { CurrencyRef: { value: currency } }),
    AllowOnlineCreditCardPayment: true,
    AllowOnlineACHPayment: true,
    ...(dueDate && { DueDate: dueDate.toISOString().split('T')[0] }),
    PrivateNote: `IFF booking ${bookingNumber}`,
    Line: [{
      Amount: Number(amount.toFixed(2)),
      DetailType: 'SalesItemLineDetail',
      Description: description,
      SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: Number(amount.toFixed(2)) },
    }],
  })).Invoice;
  const withLink = (await qbRequest('GET', `${base}/invoice/${invoice.Id}?include=invoiceLink&${MINOR}`)).Invoice;
  return { qbInvoiceId: invoice.Id, docNumber: invoice.DocNumber, invoiceLink: withLink.InvoiceLink || null };
}

async function getInvoice(qbInvoiceId) {
  const base = await realmPath();
  return (await qbRequest('GET', `${base}/invoice/${qbInvoiceId}?${MINOR}`)).Invoice;
}

// Balance still owed on the invoice (0 = paid).
async function getInvoiceBalance(qbInvoiceId) {
  const inv = await getInvoice(qbInvoiceId);
  return { balance: Number(inv.Balance), total: Number(inv.TotalAmt) };
}

async function voidInvoice(qbInvoiceId) {
  const base = await realmPath();
  const inv = await getInvoice(qbInvoiceId);
  await qbRequest('POST', `${base}/invoice?operation=void&${MINOR}`, { Id: inv.Id, SyncToken: inv.SyncToken });
}

// Sandbox only: record a payment against the invoice, standing in for the customer paying on the
// (placeholder) sandbox link.
async function simulatePayment(qbInvoiceId) {
  if (ENVIRONMENT !== 'sandbox') throw new ValidationError('Simulated payments are only available in the sandbox');
  const base = await realmPath();
  const inv = await getInvoice(qbInvoiceId);
  await qbRequest('POST', `${base}/payment?${MINOR}`, {
    CustomerRef: { value: inv.CustomerRef.value },
    TotalAmt: Number(inv.Balance),
    Line: [{ Amount: Number(inv.Balance), LinkedTxn: [{ TxnId: inv.Id, TxnType: 'Invoice' }] }],
  });
}

// The connected QuickBooks company's home currency ('USD' for a US company, 'CAD' for a Canadian one).
async function homeCurrency() {
  return (await currencyPrefs(await realmPath())).home;
}

module.exports = { homeCurrency, createInvoice, getInvoiceBalance, voidInvoice, simulatePayment };
