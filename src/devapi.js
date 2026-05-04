/**
 * Developer API — /v1/*
 * Tất cả route cần Authorization: Bearer tm_xxxx
 */
const express   = require('express');
const config    = require('./config');
const storage   = require('./storage');
const { apiKeyAuth } = require('./keyauth');

const router = express.Router();
router.use(apiKeyAuth);

const VALID_TTLS = [600, 1800, 3600, 21600, 86400];

function ok(res, data)              { res.json({ ok: true, data }); }
function fail(res, status, msg, code) { res.status(status).json({ ok: false, error: msg, code }); }

function isValidAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const parts = address.split('@');
  if (parts.length !== 2) return false;
  return config.domains.includes(parts[1].toLowerCase());
}

/**
 * GET /v1/me
 * Trả về thông tin API key hiện tại
 */
router.get('/me', (req, res) => {
  ok(res, {
    key:          req.apiKey.key,
    label:        req.apiKey.label,
    createdAt:    req.apiKey.createdAt,
    requestCount: req.apiKey.requestCount,
    rateLimit: {
      limit:     200,
      remaining: parseInt(res.getHeader('X-RateLimit-Remaining')),
      resetAt:   parseInt(res.getHeader('X-RateLimit-Reset')),
    },
  });
});

/**
 * GET /v1/address?ttl=3600
 * Tạo địa chỉ email tạm thời mới
 */
router.get('/address', async (req, res) => {
  if (!config.domains.length) return fail(res, 503, 'No domains configured', 'NO_DOMAINS');
  try {
    const ttlParam = parseInt(req.query.ttl) || 3600;
    const ttl      = VALID_TTLS.includes(ttlParam) ? ttlParam : 3600;
    const rand     = Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
    const domain   = config.domains[Math.floor(Math.random() * config.domains.length)];
    const address  = `${rand}@${domain}`;
    await storage.refreshInbox(address);
    ok(res, {
      address,
      ttl,
      domain,
      expiresAt: Math.floor(Date.now() / 1000) + ttl,
    });
  } catch (e) {
    fail(res, 500, 'Failed to create address', 'INTERNAL');
  }
});

/**
 * GET /v1/inbox/:address
 * Lấy danh sách email trong inbox
 */
router.get('/inbox/:address', async (req, res) => {
  const { address } = req.params;
  if (!isValidAddress(address)) return fail(res, 400, 'Invalid or unsupported email address', 'INVALID_ADDRESS');
  try {
    await storage.refreshInbox(address);
    const emails = await storage.getInbox(address);
    ok(res, {
      address,
      count: emails.length,
      emails: emails.map(e => ({
        id:         e.id,
        from:       e.from,
        subject:    e.subject,
        date:       e.date,
        receivedAt: e.receivedAt,
        hasHtml:    e.hasHtml,
        otp:        e.otp || null,
        attachments: e.attachments || [],
      })),
    });
  } catch (e) {
    fail(res, 500, 'Failed to fetch inbox', 'INTERNAL');
  }
});

/**
 * GET /v1/email/:id?address=
 * Lấy nội dung đầy đủ của một email
 */
router.get('/email/:id', async (req, res) => {
  const { address } = req.query;
  if (!address || !isValidAddress(address)) {
    return fail(res, 400, 'Missing or invalid ?address= query param', 'INVALID_ADDRESS');
  }
  try {
    const email = await storage.getEmail(req.params.id);
    if (!email)                      return fail(res, 404, 'Email not found', 'NOT_FOUND');
    if (email.to !== address.toLowerCase()) return fail(res, 403, 'Access denied', 'FORBIDDEN');
    ok(res, {
      email: {
        id:          email.id,
        from:        email.from,
        to:          email.to,
        subject:     email.subject,
        date:        email.date,
        receivedAt:  email.receivedAt,
        text:        email.text || '',
        html:        email.html || '',
        otp:         email.otp || null,
        attachments: email.attachments || [],
      },
    });
  } catch (e) {
    fail(res, 500, 'Failed to fetch email', 'INTERNAL');
  }
});

/**
 * DELETE /v1/email/:id?address=
 * Xóa email
 */
router.delete('/email/:id', async (req, res) => {
  const { address } = req.query;
  if (!address || !isValidAddress(address)) {
    return fail(res, 400, 'Missing or invalid ?address= query param', 'INVALID_ADDRESS');
  }
  try {
    const email = await storage.getEmail(req.params.id);
    if (!email)                      return fail(res, 404, 'Email not found', 'NOT_FOUND');
    if (email.to !== address.toLowerCase()) return fail(res, 403, 'Access denied', 'FORBIDDEN');
    await storage.deleteEmail(req.params.id, address);
    ok(res, { deleted: true, id: req.params.id });
  } catch (e) {
    fail(res, 500, 'Failed to delete email', 'INTERNAL');
  }
});

module.exports = router;
