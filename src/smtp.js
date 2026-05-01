const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const config = require('./config');
const storage = require('./storage');

let onNewEmail = null;

function setNewEmailHandler(handler) {
  onNewEmail = handler;
}

function createSMTPServer() {
  const server = new SMTPServer({
    // Không cần auth vì chỉ nhận từ internet
    authOptional: true,
    disabledCommands: ['AUTH'],

    // Giới hạn kích thước
    size: config.mail.maxSize,

    // Chấp nhận bất kỳ địa chỉ gửi nào
    onMailFrom(address, session, callback) {
      return callback();
    },

    // Chỉ nhận mail đến các domain được phép
    onRcptTo(address, session, callback) {
      const domain = address.address.split('@')[1]?.toLowerCase();

      if (!config.domains.length || config.domains.includes(domain)) {
        return callback();
      }

      return callback(new Error(`Domain ${domain} not accepted`));
    },

    // Xử lý nội dung email
    onData(stream, session, callback) {
      const recipients = session.envelope.rcptTo.map(r => r.address.toLowerCase());

      simpleParser(stream, {}, async (err, parsed) => {
        if (err) {
          console.error('[SMTP] Parse error:', err.message);
          return callback(err);
        }

        try {
          for (const to of recipients) {
            const id = await storage.saveEmail(to, parsed);
            console.log(`[SMTP] New email → ${to} (id: ${id})`);

            if (onNewEmail) {
              onNewEmail(to, {
                id,
                from: parsed.from?.text || '',
                subject: parsed.subject || '(no subject)',
                date: parsed.date?.toISOString() || new Date().toISOString(),
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
