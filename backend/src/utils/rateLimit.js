const { ValidationError } = require('./errors');

// Small in-memory, per-IP rate limiter for public (no login) endpoints. Counts reset when the
// backend restarts; good enough to stop casual abuse without an extra dependency.
function rateLimit({ windowMs, max, message }) {
  const hitsByIp = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const hits = (hitsByIp.get(ip) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) return next(new ValidationError(message));
    hits.push(now);
    hitsByIp.set(ip, hits);
    if (hitsByIp.size > 5000) hitsByIp.clear(); // keep memory bounded
    next();
  };
}

module.exports = { rateLimit };
