const express = require('express');
const { v4: uuidv4 } = require('uuid');
const config  = require('./config');
const storage = require('./storage');

const router = express.Router();

const VALID_TTLS = [600, 1800, 3600, 21600, 86400]; // 10m, 30m, 1h, 6h, 24h

function parseTtl(val) {
  const n = parseInt(val);
  return VALID_TTLS.includes(n) ? n : config.mail.ttl;
}

function isValidAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const parts = address.split('@');
  if (parts.length !== 2) return false;
  return config.domains.includes(parts[1].toLowerCase());
}

// Tạo địa chỉ ngẫu nhiên
router.get('/generate', (req, res) => {
  if (!config.domains.length) {
    return res.status(500).json({ error: 'No domains configured' });
  }
  const domain     = config.domains[Math.floor(Math.random() * config.domains.length)];
  const randomUser = uuidv4().replace(/-/g, '').slice(0, 10);
  const address    = `${randomUser}@${domain}`;
  const ttl        = parseTtl(req.query.ttl);
  res.json({ address, ttl });
});

// Tạo địa chỉ tùy chỉnh
router.get('/generate/:username/:domain', (req, res) => {
  const { username, domain } = req.params;
  if (!config.domains.includes(domain.toLowerCase())) {
    return res.status(400).json({ error: 'Domain không được phép' });
  }
  if (!/^[a-zA-Z0-9._+-]{1,50}$/.test(username)) {
    return res.status(400).json({ error: 'Username không hợp lệ' });
  }
  const address = `${username.toLowerCase()}@${domain.toLowerCase()}`;
  const ttl     = parseTtl(req.query.ttl);
  res.json({ address, ttl });
});

// Danh sách domain
router.get('/domains', (req, res) => {
  res.json({ domains: config.domains });
});

// Inbox
router.get('/inbox/:address', async (req, res) => {
  const { address } = req.params;
  if (!isValidAddress(address)) {
    return res.status(400).json({ error: 'Địa chỉ không hợp lệ' });
  }
  try {
    await storage.refreshInbox(address);
    const emails = await storage.getInbox(address);
    const ttl    = await storage.getInboxTtl(address);
    res.json({ emails, ttl });
  } catch (err) {
    console.error('[API] getInbox:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Nội dung email
router.get('/email/:id', async (req, res) => {
  try {
    const email = await storage.getEmail(req.params.id);
    if (!email) return res.status(404).json({ error: 'Không tìm thấy email' });
    res.json({ email });
  } catch (err) {
    console.error('[API] getEmail:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Download attachment
router.get('/attachment/:emailId/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0) {
      return res.status(400).json({ error: 'Index không hợp lệ' });
    }
    const att = await storage.getAttachment(req.params.emailId, index);
    if (!att) return res.status(404).json({ error: 'Attachment không tồn tại' });

    const buf = Buffer.from(att.content, 'base64');
    res.setHeader('Content-Type', att.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.filename)}"`);
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  } catch (err) {
    console.error('[API] getAttachment:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Xóa email
router.delete('/email/:id', async (req, res) => {
  const { address } = req.query;
  if (!address || !isValidAddress(address)) {
    return res.status(400).json({ error: 'Địa chỉ không hợp lệ' });
  }
  try {
    await storage.deleteEmail(req.params.id, address);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] deleteEmail:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
