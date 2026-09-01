const User = require('../models/User');
const Company = require('../models/Company');
const Quote = require('../models/Quote');
const QuoteRate = require('../models/QuoteRate');
const Shipment = require('../models/Shipment');
const TrackingEvent = require('../models/TrackingEvent');
const Booking = require('../models/Booking');
const Claim = require('../models/Claim');
const PaymentMethod = require('../models/PaymentMethod');
const Invoice = require('../models/Invoice');
const SpotRateRequest = require('../models/SpotRateRequest');
const { NotFoundError } = require('../utils/errors');

async function getProfile(userId) {
  const user = await User.findById(userId).populate('company');
  if (!user) throw new NotFoundError('User');

  const obj = user.toObject({ virtuals: true });
  delete obj.passwordHash;
  return obj;
}

async function updateProfile(userId, data) {
  const user = await User.findByIdAndUpdate(
    userId,
    { firstName: data.firstName, lastName: data.lastName, phone: data.phone },
    { new: true }
  );
  if (!user) throw new NotFoundError('User');
  const obj = user.toObject({ virtuals: true });
  delete obj.passwordHash;
  return obj;
}

async function updateCompany(userId, data) {
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError('User');

  const fields = {
    name: data.name, street: data.street, city: data.city, province: data.province,
    postalCode: data.postalCode, country: data.country, phone: data.phone, taxNumber: data.taxNumber,
  };

  if (user.company) {
    return Company.findByIdAndUpdate(user.company, fields, { new: true });
  }

  const company = await Company.create(fields);
  user.company = company._id;
  await user.save();
  return company;
}

async function updateNotifications(userId, data) {
  const user = await User.findByIdAndUpdate(
    userId,
    { notifications: data },
    { new: true }
  );
  if (!user) throw new NotFoundError('User');
  return user.notifications;
}

async function deleteAccount(userId) {
  const quotes = await Quote.find({ user: userId }).select('_id');
  const quoteIds = quotes.map(q => q._id);
  const shipments = await Shipment.find({ user: userId }).select('_id');
  const shipmentIds = shipments.map(s => s._id);

  await QuoteRate.deleteMany({ quote: { $in: quoteIds } });
  await TrackingEvent.deleteMany({ shipment: { $in: shipmentIds } });
  await Booking.deleteMany({ user: userId });
  await Quote.deleteMany({ user: userId });
  await Shipment.deleteMany({ user: userId });
  await Claim.deleteMany({ user: userId });
  await PaymentMethod.deleteMany({ user: userId });
  await Invoice.deleteMany({ user: userId });
  await SpotRateRequest.deleteMany({ user: userId });
  await User.deleteOne({ _id: userId });
}

module.exports = { getProfile, updateProfile, updateCompany, updateNotifications, deleteAccount };
