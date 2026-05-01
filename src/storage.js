const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  lazyConnect: true,
});

redis.on('error', (err) => console.error('[Redis] Error:', err.message));
redis.on('connect', () => console.log('[Redis] Connected'));

// Key helpers
const inboxKey = (address) => `inbox:${address.toLowerCase()}`;
const emailKey = (id) => `email:${id}`;

async function connect() {
  await redis.connect();
}

/**
 * Lưu email vào inbox
 * @returns {string} email id
 */
async function saveEmail(to, parsed) {
  const address = to.toLowerCase();
  const id = uuidv4();
  const now = Date.now();

  const emailData = {
    id,
    to: address,
    from: parsed.from?.text || '',
    subject: parsed.subject || '(no subject)',
    text: parsed.text || '',
    html: parsed.html || '',
    date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
    receivedAt: now,
    attachments: JSON.stringify(
      (parsed.attachments || []).map(a => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
      }))
    ),
  };

  const pipeline = redis.pipeline();

  // Lưu nội dung email
  pipeline.hset(emailKey(id), emailData);
  pipeline.expire(emailKey(id), config.mail.ttl);

  // Thêm vào inbox list (sorted by receivedAt)
  pipeline.zadd(inboxKey(address), now, id);
  pipeline.expire(inboxKey(address), config.mail.ttl);

  await pipeline.exec();

  // Giới hạn số mail trong inbox
  const count = await redis.zcard(inboxKey(address));
  if (count > config.mail.maxPerBox) {
    const oldest = await redis.zrange(inboxKey(address), 0, count - config.mail.maxPerBox - 1);
    if (oldest.length) {
      await redis.zrem(inboxKey(address), ...oldest);
      await redis.del(...oldest.map(emailKey));
    }
  }

  return id;
}

/**
 * Lấy danh sách email trong inbox (mới nhất trước)
 */
async function getInbox(address) {
  const ids = await redis.zrevrange(inboxKey(address.toLowerCase()), 0, -1);
  if (!ids.length) return [];

  const emails = await Promise.all(
    ids.map(async (id) => {
      const data = await redis.hgetall(emailKey(id));
      if (!data || !data.id) return null;
      return {
        id: data.id,
        from: data.from,
        subject: data.subject,
        date: data.date,
        receivedAt: parseInt(data.receivedAt),
        hasHtml: !!data.html,
      };
    })
  );

  return emails.filter(Boolean);
}

/**
 * Lấy nội dung 1 email
 */
async function getEmail(id) {
  const data = await redis.hgetall(emailKey(id));
  if (!data || !data.id) return null;

  return {
    ...data,
    receivedAt: parseInt(data.receivedAt),
    attachments: JSON.parse(data.attachments || '[]'),
  };
}

/**
 * Xóa 1 email
 */
async function deleteEmail(id, address) {
  await redis.zrem(inboxKey(address.toLowerCase()), id);
  await redis.del(emailKey(id));
}

/**
 * Reset TTL khi người dùng còn active
 */
async function refreshInbox(address) {
  await redis.expire(inboxKey(address.toLowerCase()), config.mail.ttl);
}

module.exports = { connect, saveEmail, getInbox, getEmail, deleteEmail, refreshInbox };
