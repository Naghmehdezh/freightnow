const mongoose = require('mongoose');
const Company = require('../models/Company');
const Invoice = require('../models/Invoice');
const Statement = require('../models/Statement');
const Booking = require('../models/Booking');
const { getActiveRuleSet } = require('./pricingRules.service');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { logActivity } = require('./activityLog.service');
const email = require('./email.service');

// Monthly-terms accounts ("pay on account"): an IFF admin sets a credit limit (CAD); each booking
// is invoiced and uses part of it; on the 1st, last month's unpaid invoices go on one statement,
// due Net N days (default 30). Paying the statement frees the credit. Over the limit, or with an
// overdue statement, new bookings are blocked.

const round2 = n => Math.round(n * 100) / 100;

async function usdToCad() {
  try { return (await getActiveRuleSet()).usdToCadRate || 1.4; } catch { return 1.4; }
}
const toCad = (amount, currency, fx) => round2((Number(amount) || 0) * (currency === 'USD' ? fx : 1));

// Credit used = unpaid invoices (bookings + price adjustments), less what's already been settled on
// open statements (payments received + store credit taken off).
async function creditSummary(companyId) {
  const company = await Company.findById(companyId);
  if (!company) throw new NotFoundError('Company');
  const fx = await usdToCad();
  const [pending, open] = await Promise.all([
    Invoice.find({ company: companyId, status: 'pending' }).select('totalAmount currency').lean(),
    Statement.find({ company: companyId, status: { $in: ['open', 'partially_paid'] } }).select('amountDue paidAmount creditApplied dueDate').lean(),
  ]);
  const invoiced = pending.reduce((n, i) => n + toCad(i.totalAmount, i.currency, fx), 0);
  const settled = open.reduce((n, s) => n + (s.paidAmount || 0) + (s.creditApplied || 0), 0);
  const used = round2(Math.max(0, invoiced - settled));
  const now = new Date();
  return {
    paymentTerms: company.paymentTerms,
    creditLimit: company.creditLimit || 0,
    used,
    available: round2((company.creditLimit || 0) - used),
    statementTermsDays: company.statementTermsDays || 30,
    openStatementBalance: round2(open.reduce((n, s) => n + (s.amountDue - (s.paidAmount || 0)), 0)),
    overdueStatements: open.filter(s => s.dueDate && new Date(s.dueDate) < now).length,
    accountHold: company.accountHold || { active: false },
    fxRate: fx,
  };
}

// Blocks a monthly-terms booking that would go over the credit limit.
async function checkCredit(company, amount, currency) {
  if (!company || company.paymentTerms !== 'monthly') return;
  const summary = await creditSummary(company._id);
  const needed = toCad(amount, currency, summary.fxRate);
  if (!(summary.creditLimit > 0)) {
    throw new ValidationError('Your account has no credit limit set yet. Please contact IFF to book on account.');
  }
  if (needed > summary.available) {
    const money = n => `C$${n.toFixed(2)}`;
    throw new ValidationError(`Not enough credit: this booking is ${money(needed)} and your available credit is ${money(Math.max(0, summary.available))}. Pay your statement or contact IFF to raise your limit.`);
  }
}

// ─── Statements ────────────────────────────────────────────────────

// 'YYYY-MM' of the previous calendar month (server time).
function previousPeriod(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodBounds(period) {
  const [y, m] = period.split('-').map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

async function nextStatementNumber(period) {
  const { nextNumber } = require('../utils/trackingGenerator');
  return nextNumber(Statement, 'statementNumber', `STM-${period.replace('-', '')}-`, 4);
}

// One statement per monthly company for the period: every unpaid invoice issued before the period
// ends that isn't on a statement yet (so anything missed earlier carries forward). Store credit is
// taken off. Re-running for the same period does nothing.
async function generateStatements({ period = previousPeriod(), companyId } = {}) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ValidationError('Period must look like 2026-11');
  const { start, end } = periodBounds(period);
  if (end > new Date()) throw new ValidationError(`The ${period} period hasn't ended yet`);
  const companies = await Company.find({ paymentTerms: 'monthly', ...(companyId && { _id: companyId }) });
  const created = [];
  for (const company of companies) {
    if (await Statement.exists({ company: company._id, period })) continue;
    const statement = await issueStatement(company, { period, start, end });
    if (statement) created.push(statement.statementNumber);
  }
  return { period, created };
}

// "Create statement now": everything unpaid and not yet on a statement, up to this moment. Labelled
// with today's date (e.g. 2026-11-13) so the regular month-end statement still runs afterwards and
// picks up anything invoiced later.
async function createStatementNow(staffUserId, companyId) {
  if (!mongoose.isValidObjectId(companyId)) throw new NotFoundError('Company');
  const company = await Company.findById(companyId);
  if (!company) throw new NotFoundError('Company');
  if (company.paymentTerms !== 'monthly') throw new ValidationError('Statements are for monthly-terms accounts');
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (await Statement.exists({ company: company._id, period })) throw new ValidationError(`A statement was already created today (${period}) for ${company.name}`);
  const statement = await issueStatement(company, { period, start: null, end: now });
  if (!statement) throw new ValidationError(`${company.name} has no unpaid invoices that aren't already on a statement`);
  logActivity(staffUserId, company._id, 'statement_created_now', { statementNumber: statement.statementNumber });
  return statement.toObject();
}

// One statement for a company: unpaid invoices issued before `end` and not on a statement yet
// (anything missed earlier carries forward), less store credit. Returns null when there's nothing.
async function issueStatement(company, { period, start, end }) {
  const fx = await usdToCad();
  const { takeCredit } = require('./adjustment.service');
  const invoices = await Invoice.find({ company: company._id, status: 'pending', statement: { $exists: false }, issuedAt: { $lt: end } })
    .sort({ issuedAt: 1 }).lean();
  if (!invoices.length) return null;

  const bookingIds = invoices.flatMap(i => i.items.map(it => it.booking)).filter(Boolean);
  const bookings = new Map((await Booking.find({ _id: { $in: bookingIds } }).select('bookingNumber').lean()).map(b => [String(b._id), b.bookingNumber]));
  const lines = invoices.map(i => ({
    invoice: i._id,
    invoiceNumber: i.invoiceNumber,
    bookingNumber: bookings.get(String(i.items[0]?.booking)) || undefined,
    description: i.items.map(it => it.description).join('; '),
    issuedAt: i.issuedAt,
    amount: i.totalAmount,
    currency: i.currency === 'USD' ? 'USD' : 'CAD',
  }));
  const totals = { CAD: 0, USD: 0 };
  for (const l of lines) totals[l.currency] = round2(totals[l.currency] + l.amount);
  const totalCad = round2(totals.CAD + toCad(totals.USD, 'USD', fx));

  // Store credit (e.g. from a carrier undercharge) comes off the statement.
  const cadCredit = await takeCredit(company._id, 'CAD', totals.CAD);
  const usdCredit = await takeCredit(company._id, 'USD', totals.USD);
  const creditApplied = round2(cadCredit + toCad(usdCredit, 'USD', fx));
  const amountDue = round2(Math.max(0, totalCad - creditApplied));
  const dueDate = new Date(Date.now() + (company.statementTermsDays || 30) * 86400000);
  const paidInFull = amountDue <= 0;
  const monthKey = period.slice(0, 7);

  const statement = await Statement.create({
    statementNumber: await nextStatementNumber(monthKey),
    company: company._id,
    period,
    periodStart: start || lines[0].issuedAt,
    periodEnd: new Date(end.getTime() - 1),
    lines,
    totals,
    fxRate: fx,
    totalCad,
    creditApplied,
    amountDue,
    dueDate,
    status: paidInFull ? 'paid' : 'open',
    ...(paidInFull && { paidAt: new Date() }),
  });
  await Invoice.updateMany(
    { _id: { $in: invoices.map(i => i._id) } },
    { statement: statement._id, dueDate, ...(paidInFull && { status: 'paid', paidAt: new Date() }) },
  );
  logActivity(null, company._id, 'statement_issued', { statementNumber: statement.statementNumber, period, amountDue });
  email.sendStatementIssued(statement, company);
  return statement;
}

// Record money received against a statement (cheque / EFT / ...). Full payment marks every invoice
// on it paid, which frees the credit; partial payments also count toward available credit.
async function recordPayment(staffUserId, statementId, { amount, method = 'eft', reference }) {
  if (!mongoose.isValidObjectId(statementId)) throw new NotFoundError('Statement');
  const statement = await Statement.findById(statementId);
  if (!statement) throw new NotFoundError('Statement');
  if (!['open', 'partially_paid'].includes(statement.status)) throw new ValidationError(`This statement is ${statement.status}`);
  const remaining = round2(statement.amountDue - (statement.paidAmount || 0));
  const value = round2(Number(amount));
  if (!(value > 0)) throw new ValidationError('Enter the amount received');
  if (value > remaining + 0.005) throw new ValidationError(`That's more than the balance of C$${remaining.toFixed(2)}`);

  statement.payments.push({ amount: value, method, reference, recordedBy: staffUserId });
  statement.paidAmount = round2((statement.paidAmount || 0) + value);
  if (statement.paidAmount >= statement.amountDue - 0.005) {
    statement.status = 'paid';
    statement.paidAt = new Date();
    await Invoice.updateMany({ statement: statement._id, status: 'pending' }, { status: 'paid', paidAt: new Date() });
  } else {
    statement.status = 'partially_paid';
  }
  await statement.save();
  const { refreshHold } = require('./adjustment.service');
  await refreshHold(statement.company);
  logActivity(staffUserId, statement.company, 'statement_payment', { statementNumber: statement.statementNumber, amount: value, method, status: statement.status });
  email.sendStatementPayment(statement, value);
  return statement.toObject();
}

// ─── Admin ─────────────────────────────────────────────────────────

async function listAccounts() {
  const companies = await Company.find({}).sort({ name: 1 }).lean();
  return Promise.all(companies.map(async c => ({
    id: String(c._id),
    name: c.name,
    city: c.city,
    country: c.country,
    ...(await creditSummary(c._id)),
    credit: c.credit || { CAD: 0, USD: 0 },
  })));
}

async function setAccountTerms(adminUserId, companyId, { paymentTerms, creditLimit, statementTermsDays }) {
  if (!mongoose.isValidObjectId(companyId)) throw new NotFoundError('Company');
  const company = await Company.findById(companyId);
  if (!company) throw new NotFoundError('Company');
  const before = { paymentTerms: company.paymentTerms, creditLimit: company.creditLimit, statementTermsDays: company.statementTermsDays };
  if (paymentTerms) company.paymentTerms = paymentTerms;
  if (creditLimit !== undefined) company.creditLimit = creditLimit;
  if (statementTermsDays !== undefined) company.statementTermsDays = statementTermsDays;
  await company.save();
  logActivity(adminUserId, company._id, 'account_terms_changed', { before, after: { paymentTerms: company.paymentTerms, creditLimit: company.creditLimit, statementTermsDays: company.statementTermsDays } });
  return { id: String(company._id), ...(await creditSummary(company._id)) };
}

async function statementsForCompany(companyId) {
  const rows = await Statement.find({ company: companyId }).sort({ period: -1 }).limit(36).lean();
  const now = new Date();
  return rows.map(s => ({
    ...s,
    id: String(s._id),
    _id: undefined,
    balance: round2(s.amountDue - (s.paidAmount || 0)),
    overdue: ['open', 'partially_paid'].includes(s.status) && s.dueDate && new Date(s.dueDate) < now,
  }));
}

async function statementForCompany(companyId, statementId) {
  if (!mongoose.isValidObjectId(statementId)) throw new NotFoundError('Statement');
  const s = await Statement.findOne({ _id: statementId, company: companyId }).lean();
  if (!s) throw new NotFoundError('Statement');
  return { ...s, id: String(s._id), _id: undefined, balance: round2(s.amountDue - (s.paidAmount || 0)) };
}

// Customer view: credit summary + statements.
async function accountForCompany(companyId) {
  if (!companyId) return null;
  const { refreshHold } = require('./adjustment.service');
  await refreshHold(companyId);
  const [summary, statements] = await Promise.all([creditSummary(companyId), statementsForCompany(companyId)]);
  return { ...summary, statements };
}

module.exports = {
  creditSummary, checkCredit, generateStatements, createStatementNow, recordPayment, previousPeriod,
  listAccounts, setAccountTerms, statementsForCompany, statementForCompany, accountForCompany,
};
