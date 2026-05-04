const express = require('express');
const crypto  = require('crypto');
const storage = require('./storage');

const router = express.Router();

function adminAuth(req, res, next) {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
  if (!ADMIN_SECRET) {
    return res.status(503).json({ error: 'ADMIN_SECRET chưa được cấu hình' });
  }
  const provided = req.headers['x-admin-secret'] || '';
  const hash1 = crypto.createHash('sha256').update(provided).digest();
  const hash2 = crypto.createHash('sha256').update(ADMIN_SECRET).digest();
  if (!crypto.timingSafeEqual(hash1, hash2)) {
    return res.status(401).json({ error: 'Sai admin secret' });
  }
  next();
}

// Stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const stats = await storage.adminGetStats();
    res.json(stats);
  } catch (err) {
    console.error('[Admin] stats:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// List API keys
router.get('/keys', adminAuth, async (req, res) => {
  const type = ['all', 'orphan', 'owned'].includes(req.query.type) ? req.query.type : 'all';
  try {
    const keys = await storage.adminListApiKeys(type);
    res.json({ keys, total: keys.length });
  } catch (err) {
    console.error('[Admin] listKeys:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Purge all orphan keys — must be defined before /:key
router.delete('/keys/purge-orphans', adminAuth, async (req, res) => {
  try {
    const deleted = await storage.adminDeleteOrphanKeys();
    res.json({ deleted });
  } catch (err) {
    console.error('[Admin] purgeOrphans:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Delete single key
router.delete('/keys/:key', adminAuth, async (req, res) => {
  const { key } = req.params;
  if (!key.startsWith('tm_')) {
    return res.status(400).json({ error: 'Key không hợp lệ' });
  }
  try {
    const existing = await storage.getApiKey(key);
    if (!existing) return res.status(404).json({ error: 'Key không tồn tại' });
    await storage.deleteApiKey(key);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[Admin] deleteKey:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// List inboxes
router.get('/inboxes', adminAuth, async (req, res) => {
  try {
    const inboxes = await storage.adminListInboxes();
    res.json({ inboxes, total: inboxes.length });
  } catch (err) {
    console.error('[Admin] listInboxes:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Get emails in a specific inbox
router.get('/inboxes/:address', adminAuth, async (req, res) => {
  try {
    const emails = await storage.adminGetInboxEmails(req.params.address);
    res.json({ emails, total: emails.length });
  } catch (err) {
    console.error('[Admin] getInbox:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Delete inbox + all emails
router.delete('/inboxes/:address', adminAuth, async (req, res) => {
  try {
    await storage.adminDeleteInbox(req.params.address);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[Admin] deleteInbox:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = { router };
