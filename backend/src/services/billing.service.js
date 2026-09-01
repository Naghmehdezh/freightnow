const PaymentMethod = require('../models/PaymentMethod');
const Invoice = require('../models/Invoice');
const Booking = require('../models/Booking');
const { NotFoundError } = require('../utils/errors');

async function getPaymentMethods(companyId) {
  return PaymentMethod.find({ company: companyId }).sort({ createdAt: -1 });
}

async function addPaymentMethod(companyId, userId, data) {
  if (data.isDefault) {
    await PaymentMethod.updateMany({ company: companyId, isDefault: true }, { isDefault: false });
  }

  return PaymentMethod.create({
    company: companyId,
    user: userId,
    type: data.type,
    last4: data.last4,
    expiryMonth: data.expiryMonth,
    expiryYear: data.expiryYear,
    isDefault: data.isDefault || false,
  });
}

async function setDefault(paymentMethodId, companyId) {
  const method = await PaymentMethod.findOne({ _id: paymentMethodId, company: companyId });
  if (!method) throw new NotFoundError('Payment method');

  await PaymentMethod.updateMany({ company: companyId, isDefault: true }, { isDefault: false });

  method.isDefault = true;
  await method.save();
  return method;
}

async function deletePaymentMethod(paymentMethodId, companyId) {
  const method = await PaymentMethod.findOne({ _id: paymentMethodId, company: companyId });
  if (!method) throw new NotFoundError('Payment method');
  await PaymentMethod.deleteOne({ _id: method._id });
}

async function getInvoices(companyId, { page = 1, limit = 10 } = {}) {
  const skip = (page - 1) * limit;

  const [invoices, total] = await Promise.all([
    Invoice.find({ company: companyId }).sort({ issuedAt: -1 }).skip(skip).limit(limit),
    Invoice.countDocuments({ company: companyId }),
  ]);

  return { invoices, pagination: { page, limit, total } };
}

async function getInvoiceById(invoiceId, companyId) {
  const invoice = await Invoice.findOne({ _id: invoiceId, company: companyId });
  if (!invoice) throw new NotFoundError('Invoice');
  return invoice;
}

async function getBillingStats(companyId) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const [monthInvoices, yearInvoices, outstanding] = await Promise.all([
    Invoice.find({ company: companyId, issuedAt: { $gte: startOfMonth } }).select('totalAmount').lean(),
    Invoice.find({ company: companyId, issuedAt: { $gte: startOfYear } }).select('totalAmount').lean(),
    Invoice.find({ company: companyId, status: 'pending' }).select('totalAmount').lean(),
  ]);

  const spentThisMonth = monthInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
  const spentThisYear = yearInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
  const outstandingAmount = outstanding.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

  return {
    spentThisMonth: Math.round(spentThisMonth * 100) / 100,
    spentThisYear: Math.round(spentThisYear * 100) / 100,
    outstanding: Math.round(outstandingAmount * 100) / 100,
  };
}

module.exports = { getPaymentMethods, addPaymentMethod, setDefault, deletePaymentMethod, getInvoices, getInvoiceById, getBillingStats };
