const { auth } = require('express-oauth2-jwt-bearer');
const { auth0Domain, auth0Audience } = require('../config/env');
const User = require('../models/User');
const { AuthenticationError } = require('../utils/errors');

// Auth0 JWT validation middleware
const checkJwt = auth({
  issuerBaseURL: `https://${auth0Domain}`,
  audience: auth0Audience,
});

// Fetch user profile from Auth0's /userinfo endpoint
async function fetchAuth0UserInfo(accessToken) {
  const res = await fetch(`https://${auth0Domain}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// After token validation, find or create the user in our database
async function loadUser(req, res, next) {
  try {
    const auth0Id = req.auth.payload.sub;
    const accessToken = req.headers.authorization.split(' ')[1];

    // Try to find existing user by auth0Id
    let user = await User.findOne({ auth0Id });

    if (!user) {
      // New user — fetch profile from Auth0 /userinfo endpoint
      const userInfo = await fetchAuth0UserInfo(accessToken);
      const email = userInfo?.email || req.auth.payload.email || '';
      const name = userInfo?.name || userInfo?.nickname || email.split('@')[0] || 'User';

      if (email) {
        // Check if user exists by email (handles migration from old auth)
        user = await User.findOne({ email });
        if (user) {
          user.auth0Id = auth0Id;
          await user.save();
        }
      }

      if (!user) {
        const [firstName, ...lastParts] = name.split(' ');
        user = await User.create({
          auth0Id,
          email: email || `${auth0Id}@auth0.local`,
          firstName: firstName || 'User',
          lastName: lastParts.join(' ') || 'User',
          role: 'customer',
        });
      }
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      companyId: user.company ? user.company.toString() : null,
    };
    next();
  } catch (err) {
    console.error('[LOAD-USER] Error:', err.message, err);
    next(new AuthenticationError('Failed to load user profile'));
  }
}

// Combined middleware: validate token + load user
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      console.log('[AUTH] Token iss:', payload.iss, '| aud:', payload.aud);
    } catch (e) {
      console.log('[AUTH] Token is not a valid JWT');
    }
  } else {
    console.log('[AUTH] No token received');
  }
  checkJwt(req, res, (err) => {
    if (err) {
      console.error('[AUTH] Validation failed:', err.message);
      return next(new AuthenticationError(err.message || 'Invalid or expired token'));
    }
    loadUser(req, res, next);
  });
}

// Optional auth — tries to authenticate but doesn't fail if no token
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    console.log('[OPT-AUTH] No token, continuing as guest');
    return next();
  }
  authenticate(req, res, (err) => {
    if (err) {
      console.log('[OPT-AUTH] Auth failed, continuing as guest:', err.message);
      return next();
    }
    console.log('[OPT-AUTH] Authenticated as:', req.user?.email, '| id:', req.user?.id);
    next();
  });
}

module.exports = { authenticate, optionalAuth };
