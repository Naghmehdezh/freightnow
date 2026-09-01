require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 4000,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/iffcargo?replicaSet=rs0',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
  auth0Domain: process.env.AUTH0_DOMAIN,
  auth0Audience: process.env.AUTH0_AUDIENCE,
  quickbooks: {
    clientId: process.env.QB_CLIENT_ID,
    clientSecret: process.env.QB_CLIENT_SECRET,
    redirectUri: process.env.QB_REDIRECT_URI || 'http://localhost:4000/api/quickbooks/callback',
    environment: process.env.QB_ENVIRONMENT || 'sandbox', // 'sandbox' or 'production'
  },
  carriers: {
    fedex: {
      apiKey: process.env.FEDEX_API_KEY,
      secretKey: process.env.FEDEX_SECRET_KEY,
      accountNumber: process.env.FEDEX_ACCOUNT_NUMBER,
    },
    xpo: { apiKey: process.env.XPO_API_KEY },
    dayross: {
      apiKey: process.env.DAYROSS_API_KEY,
      division: process.env.DAYROSS_DIVISION,
    },
    manitoulin: { apiKey: process.env.MANITOULIN_API_KEY },
    polaris: { apiKey: process.env.POLARIS_API_KEY },
  },
};
