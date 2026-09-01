const mongoose = require('mongoose');
const { Schema } = mongoose;

// Stores the QuickBooks OAuth2 tokens for the connected company account.
// Only one active connection at a time (the IFF Cargo QuickBooks account).
const qbTokenSchema = new Schema({
  realmId: { type: String, required: true, unique: true },
  accessToken: { type: String, required: true },
  refreshToken: { type: String, required: true },
  accessTokenExpiresAt: { type: Date, required: true },
  refreshTokenExpiresAt: { type: Date, required: true },
  connectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('QBToken', qbTokenSchema);
