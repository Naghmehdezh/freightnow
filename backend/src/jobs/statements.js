const Company = require('../models/Company');
const accounts = require('../services/account.service');
const { refreshHold } = require('../services/adjustment.service');

// Hourly, in-process (no scheduler dependency): issue last month's statements once the month has
// ended (idempotent — one per company per period) and refresh account holds, so a statement that
// passes its due date puts the account on hold without anyone opening a page.
const HOUR = 60 * 60 * 1000;

async function runOnce() {
  try {
    const { period, created } = await accounts.generateStatements({ period: accounts.previousPeriod() });
    if (created.length) console.log(`[STATEMENTS] Issued ${created.length} statement(s) for ${period}: ${created.join(', ')}`);
    const monthly = await Company.find({ paymentTerms: 'monthly' }).select('_id');
    for (const c of monthly) await refreshHold(c._id);
  } catch (err) {
    console.error('[STATEMENTS] Job failed:', err.message);
  }
}

function startStatementsJob() {
  if ((process.env.STATEMENTS_JOB || '').toLowerCase() === 'off') return;
  setTimeout(runOnce, 30 * 1000); // shortly after start-up
  setInterval(runOnce, HOUR).unref();
}

module.exports = { startStatementsJob, runOnce };
