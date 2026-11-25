const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const { connectDB } = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');
const { getAllCarriers } = require('./carriers');

const app = express();

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

// Health check
app.get('/health', async (req, res, next) => {
  try {
    const carriers = {};
    for (const carrier of await getAllCarriers()) {
      carriers[carrier.id] = true;
    }
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      carriers,
    });
  } catch (err) { next(err); }
});

// API routes
app.use('/api', routes);

// Error handler
app.use(errorHandler);

async function start() {
  await connectDB();
  require('./jobs/statements').startStatementsJob(); // monthly statements + account holds
  require('./jobs/linkPayments').startLinkPaymentsJob(); // QuickBooks pay-link bookings
  app.listen(config.port, () => {
    console.log(`IFF Cargo backend running on port ${config.port}`);
  });
}

start();

module.exports = app;
