const https = require('https');
const { carriers } = require('../config/env');

const TEST_BASE = 'https://test.api.polaristransport.com:1984/restgateway/services';
const PROD_BASE = 'https://api.polaristransport.com:1984/restgateway/services';

function getBaseUrl() {
  return carriers.polaris.environment === 'production' ? PROD_BASE : TEST_BASE;
}

// Polaris auth is a single APIKey query-string param on every request — no login step, no
// token to cache (unlike CSA's username/password->JWT or Day & Ross's OAuth).
function withApiKey(path, extraQuery = {}) {
  const key = carriers.polaris.apiKey;
  if (!key) throw new Error('Polaris API credentials not configured (POLARIS_API_KEY)');
  const params = new URLSearchParams({ APIKey: key, ...extraQuery });
  return `${getBaseUrl()}${path}?${params.toString()}`;
}

const REQUEST_TIMEOUT_MS = 20000;

function _request(method, url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'User-Agent': 'IFFCargo/1.0',
        Accept: 'application/json',
      },
    };

    let bodyBuf;
    if (body) {
      bodyBuf = Buffer.from(JSON.stringify(body));
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = bodyBuf.length;
    }

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(text)); } catch { resolve(text); }
        } else {
          console.error(`[POLARIS-HTTP] ${method} ${url} failed: ${res.statusCode}`, text.substring(0, 500));
          const err = new Error(`Polaris API error (${res.statusCode})`);
          err.statusCode = res.statusCode;
          try { err.body = JSON.parse(text); } catch { err.body = text; }
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Polaris API request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function rate(body) {
  return _request('POST', withApiKey('/RateAPI/Rate'), body);
}

function trace(probill) {
  return _request('GET', withApiKey('/TraceAPI/Trace', { Probill: probill }));
}

function createOrder(body) {
  return _request('POST', withApiKey('/OE_API/OE'), body);
}

module.exports = { getBaseUrl, rate, trace, createOrder };
