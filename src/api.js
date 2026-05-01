const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const storage = require('./storage');

const router = express.Router();

// Tạo địa chỉ email ngẫu nhiên
router.get('/generate', (req, res) => {
  const domains = config.domains;

  if (!domains.length) {
    return res.status(500).json({ error: 'No domains configured' });
  }

  const randomDomain = domains[Math.floor(Math.random() * domains.length)];
  const randomUser = uuidv4().replace(/-/g, '').slice(0, 10);
  const address = `${randomUser}@${randomDomain}`;

  res.json({ address });
});

// Tạo địa chỉ email tùy chỉnh
router.get('/generate/:username/:domain', (req, res) => {
  const { username, domain } = req.params;

  if (!config.domains.includes(domain.toLowerCase())) {
    return res.status(400).json({ error: 'Domain not allowed' });
  }

  // Validate username
  if (!/^[a-zA-Z0-9._+-]{1,50}$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  const address = `${username.toLowerCase()}@${domain.toLowerCase()}`;
  res.json({ address });
});

// Lấy danh sách domain
router.get('/domains', (req, res) => {
  res.json({ domains: config.domains });
});

// Lấy inbox
router.get('/inbox/:address', async (req, res) => {
  const { address } = req.params;

  if (!isValidAddress(address)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    await storage.refreshInbox(address);
    const emails = await storage.getInbox(address);
    res.json({ emails });
  } catch (err) {
    console.error('[API] getInbox error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Lấy nội dung email
router.get('/email/:id', async (req, res) => {
  try {
    const email = await storage.getEmail(req.params.id);

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    res.json({ email });
  } catch (err) {
    console.error('[API] getEmail error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Xóa email
router.delete('/email/:id', async (req, res) => {
  const { address } = req.query;

  if (!address || !isValidAddress(address)) {
    return res.status(400).json({ error: 'Invalid address' });
  }

  try {
    await storage.deleteEmail(req.params.id, address);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] deleteEmail error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

function isValidAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const parts = address.split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1].toLowerCase();
  return config.domains.includes(domain);
}

module.exports = router;
