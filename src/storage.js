const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const { extractOTP } = require('./otp');

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 10) return null; // dừng retry sau 10 lần
    return Math.min(times * 200, 2000); // back-off tối đa 2s
  },
});

redis.on('error', (err) => console.error('[Redis] Error:', err.message));
redis.on('connect', () => console.log('[Redis] Connected'));

const inboxKey  = (addr) => `inbox:${addr.toLowerCase()}`;
const emailKey  = (id)   => `email:${id}`;
const ttlKey    = (addr) => `inbox:ttl:${addr.toLowerCase()}`;
const attKey    = (id, i)=> `att:${id}:${i}`;

async function connect() {
  await redis.connect();
}

async function saveEmail(to, parsed, ttl = config.mail.ttl) {
  const address = to.toLowerCase();
  const id      = uuidv4();
  const now     = Date.now();

  const attachmentsMeta = (parsed.attachments || []).map((a, i) => ({
    index: i,
    filename:    a.filename    || `file_${i}`,
    contentType: a.contentType || 'application/octet-stream',
    size:        a.size        || 0,
  }));

  const otp = extractOTP(parsed.subject, parsed.text) || '';

  const emailData = {
    id,
    to:          address,
    from:        parsed.from?.text || '',
    subject:     parsed.subject    || '(no subject)',
    text:        parsed.text       || '',
    html:        parsed.html       || '',
    date:        parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
    receivedAt:  now,
    otp,
    attachments: JSON.stringify(attachmentsMeta),
  };

  const pipeline = redis.pipeline();

  pipeline.hset(emailKey(id), emailData);
  pipeline.expire(emailKey(id), ttl);

  pipeline.zadd(inboxKey(address), now, id);
  pipeline.expire(inboxKey(address), ttl);

  // Lưu TTL của inbox để dùng khi refresh
  pipeline.set(ttlKey(address), ttl);
  pipeline.expire(ttlKey(address), ttl);

  // Lưu nội dung attachment
  (parsed.attachments || []).forEach((a, i) => {
    const content = a.content ? a.content.toString('base64') : '';
    pipeline.hset(attKey(id, i), {
      filename:    a.filename    || `file_${i}`,
      contentType: a.contentType || 'application/octet-stream',
      content,
    });
    pipeline.expire(attKey(id, i), ttl);
  });

  await pipeline.exec();

  // Giới hạn số mail trong inbox
  const count = await redis.zcard(inboxKey(address));
  if (count > config.mail.maxPerBox) {
    const oldest = await redis.zrange(inboxKey(address), 0, count - config.mail.maxPerBox - 1);
    if (oldest.length) {
      const trimPl = redis.pipeline();
      trimPl.zrem(inboxKey(address), ...oldest);
      oldest.forEach(oid => trimPl.del(emailKey(oid)));
      await trimPl.exec();
    }
  }

  return id;
}

async function getInbox(address) {
  const ids = await redis.zrevrange(inboxKey(address.toLowerCase()), 0, -1);
  if (!ids.length) return [];

  const pipeline = redis.pipeline();
  ids.forEach((id) => pipeline.hgetall(emailKey(id)));
  const results = await pipeline.exec(); // [[err, val], ...]

  const emails = results.map(([err, data]) => {
    if (err || !data || !data.id) return null;
    return {
      id:          data.id,
      from:        data.from,
      subject:     data.subject,
      date:        data.date,
      receivedAt:  parseInt(data.receivedAt),
      hasHtml:     !!data.html,
      otp:         data.otp || null,
      attachments: JSON.parse(data.attachments || '[]'),
    };
  });

  return emails.filter(Boolean);
}

async function getEmail(id) {
  const data = await redis.hgetall(emailKey(id));
  if (!data || !data.id) return null;
  return {
    ...data,
    receivedAt:  parseInt(data.receivedAt),
    attachments: JSON.parse(data.attachments || '[]'),
  };
}

async function getAttachment(emailId, index) {
  const data = await redis.hgetall(attKey(emailId, index));
  if (!data || !data.content) return null;
  return data;
}

async function deleteEmail(id, address) {
  const email = await getEmail(id);
  const atts  = Array.isArray(email?.attachments) ? email.attachments : [];
  const pl    = redis.pipeline();
  pl.zrem(inboxKey(address.toLowerCase()), id);
  pl.del(emailKey(id));
  atts.forEach((_, i) => pl.del(attKey(id, i)));
  await pl.exec();
}

async function disconnect() {
  await redis.quit();
}

async function refreshInbox(address) {
  const addr = address.toLowerCase();
  const stored = await redis.get(ttlKey(addr));
  const ttl = parseInt(stored) || config.mail.ttl;
  await redis.expire(inboxKey(addr), ttl);
}

async function getInboxTtl(address) {
  const stored = await redis.get(ttlKey(address.toLowerCase()));
  return parseInt(stored) || config.mail.ttl;
}

function _redis() { return redis; }

module.exports = {
  connect, disconnect, saveEmail, getInbox, getEmail,
  getAttachment, deleteEmail, refreshInbox, getInboxTtl,
  _redis,
};
