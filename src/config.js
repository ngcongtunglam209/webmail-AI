require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT) || 3000,
  smtpPort: parseInt(process.env.SMTP_PORT) || 25,

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  mail: {
    ttl: parseInt(process.env.MAIL_TTL) || 3600,
    maxPerBox: parseInt(process.env.MAX_EMAILS_PER_BOX) || 50,
    maxSize: parseInt(process.env.MAX_EMAIL_SIZE) || 5 * 1024 * 1024,
  },

  domains: (process.env.ALLOWED_DOMAINS || '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean),
};
