#!/usr/bin/env node
/**
 * Estes Express — API Key Setup (test or production)
 *
 * Per Estes's setup email: the Client ID/Secret aren't used on normal API calls — they're used
 * once, as the Basic-auth username/password, to obtain (or retrieve) a lifetime API Key for the
 * company. Every other request then uses that API Key (plus the MyEstes login).
 *
 * Safety: tries GET first (retrieve a previously issued key) and only falls back to POST
 * (generate a new one) when none exists — POST is a one-time, lifetime-key action and its
 * response also rotates the Client Secret, so it must not be run speculatively. The key and any
 * rotated secret are written straight to backend/.env and never printed.
 *
 * Usage:  node src/scripts/estesApiKeySetup.js --env production
 *         node src/scripts/estesApiKeySetup.js --env test
 *
 * Reads:  ESTES_PROD_CLIENT_ID / ESTES_PROD_CLIENT_SECRET   (production)
 *         ESTES_TEST_CLIENT_ID / ESTES_TEST_CLIENT_SECRET   (test)
 * Writes: ESTES_PROD_API_KEY or ESTES_TEST_API_KEY — the names estesApi.service.js reads —
 *         and the rotated client secret, if Estes issued a new one.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const https = require('https');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(__dirname, '../../.env');
const ENVIRONMENTS = {
  production: { baseUrl: 'https://cloudapi.estes-express.com', prefix: 'ESTES_PROD' },
  test: { baseUrl: 'https://uat-cloudapi.estes-express.com', prefix: 'ESTES_TEST' },
};

function argEnv() {
  const i = process.argv.indexOf('--env');
  const name = i > -1 ? process.argv[i + 1] : null;
  if (!ENVIRONMENTS[name]) {
    console.error('Choose the environment: --env production  or  --env test');
    process.exit(1);
  }
  return name;
}

function request(method, url, authHeader) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { Accept: 'application/json', Authorization: authHeader },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('Estes did not answer within 30s')));
    req.on('error', reject);
    req.end();
  });
}

function updateEnvVar(key, value) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=.*$`, 'm').test(content)) {
    content = content.replace(new RegExp(`^${key}=.*$`, 'm'), line);
  } else {
    content = `${content.replace(/\n*$/, '')}\n${line}\n`;
  }
  fs.writeFileSync(ENV_PATH, content);
}

// Estes error bodies can echo request details — show only their message fields.
function describe(body) {
  try {
    const j = JSON.parse(body);
    const e = j.error || j;
    return [e.code, e.message, e.details].filter(Boolean).join(' — ') || '(no message)';
  } catch {
    return String(body).slice(0, 200);
  }
}

function extract(result) {
  const payload = result?.data || result || {};
  return {
    apiKey: payload.apiKey || payload.key || payload.api_key,
    newSecret: payload.apiClientSecret || payload.clientSecret || payload.client_secret,
  };
}

async function run() {
  const envName = argEnv();
  const { baseUrl, prefix } = ENVIRONMENTS[envName];
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    console.error(`${prefix}_CLIENT_ID / ${prefix}_CLIENT_SECRET are not set in backend/.env`);
    process.exit(1);
  }

  const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  console.log(`Estes ${envName} (${baseUrl})\n`);

  console.log('Step 1: retrieving a previously issued API key (GET) …');
  const getRes = await request('GET', `${baseUrl}/v1/api-key`, authHeader);
  console.log(`  HTTP ${getRes.status}`);

  let found = {};
  if (getRes.status >= 200 && getRes.status < 300) {
    let parsed = {};
    try { parsed = JSON.parse(getRes.body); } catch { /* not JSON */ }
    found = extract(parsed);
    if (!found.apiKey) {
      // A key may exist under an unexpected field — don't POST (that would rotate the secret).
      const fields = Object.keys(parsed?.data || parsed || {});
      console.error(`  Estes answered OK but no API key was recognised (fields: ${fields.join(', ') || 'none'}). Stopping without generating.`);
      process.exit(1);
    }
  }
  let generated = false;

  if (found.apiKey) {
    console.log('  An API key already exists — using it; nothing new is generated.');
  } else {
    if (getRes.status === 401 || getRes.status === 403) {
      console.error(`  Estes refused the client credentials: ${describe(getRes.body)}`);
      console.error('  Not generating a key. Check the client ID / secret in backend/.env.');
      process.exit(1);
    }
    console.log(`  No existing key (${describe(getRes.body)}).`);
    console.log('\nStep 2: generating the lifetime API key (POST, one-time) …');
    const postRes = await request('POST', `${baseUrl}/v1/api-key`, authHeader);
    console.log(`  HTTP ${postRes.status}`);
    if (postRes.status < 200 || postRes.status >= 300) {
      console.error(`\nFAILED to generate an API key: ${describe(postRes.body)}`);
      if (envName === 'test') console.error('Estes has to add the account to the test environment manually — ask Estes web support.');
      process.exit(1);
    }
    found = extract(JSON.parse(postRes.body));
    generated = true;
    if (!found.apiKey) {
      console.error('\nEstes answered without an API key in the expected field — nothing saved. Contact Estes web support.');
      process.exit(1);
    }
  }

  updateEnvVar(`${prefix}_API_KEY`, found.apiKey);
  console.log(`\nSaved ${prefix}_API_KEY to backend/.env (${generated ? 'newly generated' : 'retrieved'}; length ${found.apiKey.length}).`);
  if (found.newSecret && found.newSecret !== clientSecret) {
    updateEnvVar(`${prefix}_CLIENT_SECRET`, found.newSecret);
    console.log(`Estes issued a new client secret — saved it as ${prefix}_CLIENT_SECRET (the old one no longer works).`);
  }
  console.log('\nThe app uses this API key with the MyEstes login for every Estes request.');
}

run().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
