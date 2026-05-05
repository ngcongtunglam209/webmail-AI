const { Router }      = require('express');
const express          = require('express');
const { simpleParser } = require('mailparser');
const crypto           = require('crypto');
const config           = require('./config');
const storage          = require('./storage');
const { extractOTP }   = require('./otp');

let onNewEmail = null;

function setInboundEmailHandler(handler) {
  onNewEmail = handler;
}

function verifySecret(provided) {
  const secret = process.env.INBOUND_SECRET;
  if (!secret || !provided) return false;
  try {
    const a = Buffer.from(secret);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const router = Router();

router.post(
  '/',
  express.raw({ type: '*/*', limit: `${Math.ceil(config.mail.maxSize / 1024 / 1024) + 1}mb` }),
  async (req, res) => {
    if (!process.env.INBOUND_SECRET) {
      return res.status(503).json({ error: 'Inbound endpoint not configured' });
    }

    if (!verifySecret(req.headers['x-inbound-secret'])) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'Empty body' });
    }

    let parsed;
    try {
      parsed = await simpleParser(req.body);
    } catch (err) {
      console.error('[Inbound/CF] Parse error:', err.message);
      return res.status(400).json({ error: 'Failed to parse email' });
    }

    // Prefer explicit To header sent by Worker (more reliable than parsed headers)
    const toHeader = req.headers['x-email-to'];
    const recipients = toHeader
      ? [toHeader.toLowerCase()]
      : (parsed.to?.value || []).map(a => a.address.toLowerCase());

    if (!recipients.length) {
      return res.status(400).json({ error: 'No recipients found' });
    }

    const accepted = recipients.filter(addr => {
      const domain = addr.split('@')[1];
      return config.domains.includes(domain);
    });

    if (!accepted.length) {
      return res.status(400).json({ error: 'No recipients in accepted domains' });
    }

    try {
      for (const to of accepted) {
        const ttl = await storage.getInboxTtl(to).catch(() => null);
        const id  = await storage.saveEmail(to, parsed, ttl || undefined);
        console.log(`[Inbound/CF] New email → ${to} (id: ${id})`);

        if (onNewEmail) {
          const otp = extractOTP(parsed.subject, parsed.text) || null;
          onNewEmail(to, {
            id,
            from:        parsed.from?.text || '',
            subject:     parsed.subject    || '(no subject)',
            date:        parsed.date?.toISOString() || new Date().toISOString(),
            receivedAt:  Date.now(),
            otp,
            attachments: (parsed.attachments || []).map((a, i) => ({
              index:       i,
              filename:    a.filename    || `file_${i}`,
              contentType: a.contentType || 'application/octet-stream',
              size:        a.size        || 0,
            })),
          });
        }
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('[Inbound/CF] Save error:', err.message);
      res.status(500).json({ error: 'Failed to save email' });
    }
  }
);

module.exports = { router, setInboundEmailHandler };
