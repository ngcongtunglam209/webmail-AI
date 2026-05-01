const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const config = require('./config');
const storage = require('./storage');
const apiRouter = require('./api');
const { startSMTP, setNewEmailHandler } = require('./smtp');

async function main() {
  // Kết nối Redis
  await storage.connect();

  // Express app
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));

  // API routes
  app.use('/api', apiRouter);

  // Fallback về index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  // HTTP server + Socket.io
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  // Socket.io: client subscribe theo địa chỉ email
  io.on('connection', (socket) => {
    socket.on('watch', (address) => {
      if (typeof address === 'string') {
        socket.join(`inbox:${address.toLowerCase()}`);
      }
    });

    socket.on('unwatch', (address) => {
      if (typeof address === 'string') {
        socket.leave(`inbox:${address.toLowerCase()}`);
      }
    });
  });

  // Khi có email mới → push đến client đang watch
  setNewEmailHandler((to, emailMeta) => {
    io.to(`inbox:${to}`).emit('new_email', emailMeta);
  });

  // Start HTTP server
  httpServer.listen(config.port, () => {
    console.log(`[HTTP] Listening on port ${config.port}`);
  });

  // Start SMTP server
  startSMTP();

  console.log(`[App] Domains: ${config.domains.join(', ') || 'none configured'}`);
}

main().catch((err) => {
  console.error('[App] Fatal error:', err);
  process.exit(1);
});
