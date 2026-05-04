const storage = require('./storage');

/**
 * Middleware: xác thực API key từ Authorization: Bearer tm_xxxx
 * Attach req.apiKey = { key, label, createdAt, requestCount }
 */
async function apiKeyAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Missing Authorization header', code: 'UNAUTHORIZED' });
  }

  const key = auth.slice(7).trim();
  if (!key.startsWith('tm_') || key.length !== 35) {
    return res.status(401).json({ ok: false, error: 'Invalid API key format', code: 'INVALID_KEY' });
  }

  let keyData;
  try {
    keyData = await storage.getApiKey(key);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Storage error', code: 'INTERNAL' });
  }

  if (!keyData) {
    return res.status(401).json({ ok: false, error: 'API key not found or revoked', code: 'INVALID_KEY' });
  }

  if (!keyData.userId) {
    return res.status(401).json({
      ok: false,
      error: 'API key này được tạo trước hệ thống tài khoản. Vui lòng đăng ký tại /app và tạo key mới.',
      code: 'LEGACY_KEY',
    });
  }

  let rl;
  try {
    rl = await storage.checkAndIncrementRateLimit(key);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Rate limit check failed', code: 'INTERNAL' });
  }

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit',     rl.limit);
  res.setHeader('X-RateLimit-Remaining', rl.remaining);
  res.setHeader('X-RateLimit-Reset',     rl.resetAt);

  if (!rl.allowed) {
    return res.status(429).json({
      ok: false,
      error: `Rate limit exceeded. Max ${rl.limit} requests/hour.`,
      code: 'RATE_LIMITED',
      resetAt: rl.resetAt,
    });
  }

  req.apiKey = keyData;
  next();
}

module.exports = { apiKeyAuth };
