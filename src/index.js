const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const config    = require('./config');
const storage   = require('./storage');
const apiRouter = require('./api');
const { startSMTP, setNewEmailHandler }      = require('./smtp');
const { startTelegramBot, notifyTelegram }   = require('./telegram');

async function main() {
  await storage.connect();

  const app = express();

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'"],
        styleSrc:    ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
        imgSrc:      ["'self'", 'data:', 'https://img.vietqr.io', 'https://api.qrserver.com'],
        connectSrc:  ["'self'", 'ws:', 'wss:'],
        frameSrc:    ["'self'"],
      },
    },
  }));

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.set('trust proxy', 1);

  // Rate limiting
  app.use('/api/', rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Quá nhiều request, thử lại sau.' },
  }));

  app.use('/api/generate', rateLimit({
    windowMs: 60 * 1000, // 1 phút
    max: 15,
    message: { error: 'Tạo quá nhiều địa chỉ, thử lại sau.' },
  }));

  app.use('/api/inbox', rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'Quá nhiều request inbox.' },
  }));

  app.use('/api/email', rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Quá nhiều request, thử lại sau.' },
  }));

  app.use(express.static(path.join(__dirname, '../public')));
  app.use('/api', apiRouter);

  app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/app.html'));
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: process.env.APP_ORIGIN || `http://localhost:${config.port}` },
    perMessageDeflate: false,
  });

  io.on('connection', (socket) => {
    socket.on('watch', (address) => {
      if (typeof address === 'string' && address.length < 200) {
        socket.join(`inbox:${address.toLowerCase()}`);
      }
    });
    socket.on('unwatch', (address) => {
      if (typeof address === 'string') {
        socket.leave(`inbox:${address.toLowerCase()}`);
      }
    });
  });

  setNewEmailHandler((to, emailMeta) => {
    io.to(`inbox:${to}`).emit('new_email', emailMeta);
    notifyTelegram(to, emailMeta);
  });

  startTelegramBot();

  httpServer.listen(config.port, () => {
    console.log(`[HTTP] Listening on port ${config.port}`);
  });

  const smtpServer = startSMTP();

  if (!config.domains.length) {
    console.warn('[App] ⚠️  WARNING: ALLOWED_DOMAINS is not configured. SMTP server will reject all incoming mail.');
  }
  console.log(`[App] Domains: ${config.domains.join(', ') || 'none configured'}`);

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`[App] ${signal} received — shutting down gracefully...`);
    await new Promise(resolve => httpServer.close(resolve));
    await new Promise((resolve, reject) =>
      smtpServer.close(err => (err ? reject(err) : resolve()))
    );
    await storage.disconnect();
    console.log('[App] Goodbye.');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[App] Fatal error:', err);
  process.exit(1);
});
