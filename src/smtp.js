const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const config  = require('./config');
const storage = require('./storage');

let onNewEmail = null;

function setNewEmailHandler(handler) {
  onNewEmail = handler;
}

function createSMTPServer() {
  const server = new SMTPServer({
    authOptional:     true,
    disabledCommands: ['AUTH'],
    size:             config.mail.maxSize,

    onMailFrom(address, session, callback) {
      return callback();
    },

    onRcptTo(address, session, callback) {
      const domain = address.address.split('@')[1]?.toLowerCase();
      if (!config.domains.length || config.domains.includes(domain)) {
        return callback();
      }
      return callback(new Error(`Domain ${domain} not accepted`));
    },

    onData(stream, session, callback) {
      const recipients = session.envelope.rcptTo.map(r => r.address.toLowerCase());

      simpleParser(stream, {}, async (err, parsed) => {
        if (err) {
          console.error('[SMTP] Parse error:', err.message);
          return callback(err);
        }

        try {
          for (const to of recipients) {
            const ttl = await storage.getInboxTtl(to).catch(() => null);
            const id  = await storage.saveEmail(to, parsed, ttl || undefined);
            console.log(`[SMTP] New email → ${to} (id: ${id})`);

            if (onNewEmail) {
              onNewEmail(to, {
                id,
                from:        parsed.from?.text || '',
                subject:     parsed.subject    || '(no subject)',
                date:        parsed.date?.toISOString() || new Date().toISOString(),
                receivedAt:  Date.now(),
                attachments: (parsed.attachments || []).map((a, i) => ({
                  index:       i,
                  filename:    a.filename    || `file_${i}`,
                  contentType: a.contentType || 'application/octet-stream',
                  size:        a.size        || 0,
                })),
              });
            }
          }
          callback();
        } catch (saveErr) {
          console.error('[SMTP] Save error:', saveErr.message);
          callback(saveErr);
        }
      });
    },

    onError(err) {
      console.error('[SMTP] Server error:', err.message);
    },
  });

  return server;
}

function startSMTP() {
  const server = createSMTPServer();
  server.listen(config.smtpPort, '0.0.0.0', () => {
    console.log(`[SMTP] Listening on port ${config.smtpPort}`);
  });
  return server;
}

module.exports = { startSMTP, setNewEmailHandler };
