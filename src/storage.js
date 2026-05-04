const Redis  = require('ioredis');
const crypto = require('crypto');
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

  // Lấy danh sách cũ cần xóa trước khi add (để xóa email key sau)
  const maxBox = config.mail.maxPerBox;
  const oldIds = await redis.zrange(inboxKey(address), 0, -(maxBox + 1));

  await pipeline.exec();

  // Xóa email cũ vượt giới hạn (1 pipeline, không cần zcard)
  if (oldIds.length) {
    const trimPl = redis.pipeline();
    trimPl.zremrangebyrank(inboxKey(address), 0, -(maxBox + 1));
    oldIds.forEach(oid => trimPl.del(emailKey(oid)));
    await trimPl.exec();
  }

  return id;
}

async function getInbox(address) {
  const ids = await redis.zrevrange(inboxKey(address.toLowerCase()), 0, -1);
  if (!ids.length) return [];

  const pipeline = redis.pipeline();
  ids.forEach((id) => pipeline.hgetall(emailKey(id)));
  const results = await pipeline.exec();

  return results.map(([err, data]) => {
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
  }).filter(Boolean);
}

// Gom getInboxTtl + refreshInbox + getInbox vào 2 RTT thay vì 3 await tuần tự
async function getInboxWithMeta(address) {
  const addr = address.toLowerCase();

  // RTT 1: lấy TTL + danh sách IDs cùng lúc
  const pl1 = redis.pipeline();
  pl1.get(ttlKey(addr));
  pl1.zrevrange(inboxKey(addr), 0, -1);
  const [[, storedTtl], [, ids]] = await pl1.exec();

  const ttl = parseInt(storedTtl) || config.mail.ttl;

  // Refresh TTL fire-and-forget (không block response)
  redis.expire(inboxKey(addr), ttl).catch(() => {});

  if (!ids || !ids.length) return { emails: [], ttl };

  // RTT 2: fetch nội dung tất cả email
  const pl2 = redis.pipeline();
  ids.forEach(id => pl2.hgetall(emailKey(id)));
  const results = await pl2.exec();

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
  }).filter(Boolean);

  return { emails, ttl };
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

// ── API Key management ──
const AK_LIMIT = 200; // req/hour per key

async function createApiKey(label = '', userId = '') {
  const key = 'tm_' + crypto.randomBytes(16).toString('hex');
  await redis.hset(`apikey:${key}`, {
    label:        label.toString().slice(0, 60),
    createdAt:    Date.now().toString(),
    requestCount: '0',
    userId:       userId.toString(),
  });
  return key;
}

async function getApiKey(key) {
  const data = await redis.hgetall(`apikey:${key}`);
  if (!data || !data.createdAt) return null;
  return {
    key,
    label:        data.label || '',
    createdAt:    parseInt(data.createdAt),
    requestCount: parseInt(data.requestCount) || 0,
    userId:       data.userId || '',
  };
}

async function deleteApiKey(key) {
  await redis.del(`apikey:${key}`);
}

async function checkAndIncrementRateLimit(key) {
  const hour  = Math.floor(Date.now() / 3_600_000);
  const rlKey = `apikey:rl:${key}:${hour}`;
  const pl    = redis.pipeline();
  pl.incr(rlKey);
  pl.expire(rlKey, 7200);
  const results = await pl.exec();
  const count   = results[0][1];
  // increment total usage (fire-and-forget)
  redis.hincrby(`apikey:${key}`, 'requestCount', 1).catch(() => {});
  return {
    allowed:   count <= AK_LIMIT,
    count,
    remaining: Math.max(0, AK_LIMIT - count),
    resetAt:   (hour + 1) * 3600,
    limit:     AK_LIMIT,
  };
}

function _redis() { return redis; }

module.exports = {
  connect, disconnect, saveEmail, getInbox, getInboxWithMeta, getEmail,
  getAttachment, deleteEmail, refreshInbox, getInboxTtl,
  createApiKey, getApiKey, deleteApiKey, checkAndIncrementRateLimit,
  _redis,
};
