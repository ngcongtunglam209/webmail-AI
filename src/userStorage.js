const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const storage = require('./storage');

const r = () => storage._redis();

const userKey   = (id)    => `user:${id}`;
const emailIdx  = (email) => `userByEmail:${email.toLowerCase()}`;
const savedKey  = (id)    => `user:savedAddrs:${id}`;
const SAVED_TTL = 30 * 86400; // 30 ngày

async function createUser(username, email, password) {
  const redis     = r();
  const normEmail = email.toLowerCase();

  // Hash trước khi lock để tránh giữ slot quá lâu
  const passwordHash = await bcrypt.hash(password, 10);

  const id = uuidv4();
  // Atomic: chỉ set nếu chưa tồn tại — tránh race condition
  const claimed = await redis.set(emailIdx(normEmail), id, 'NX');
  if (!claimed) throw new Error('EMAIL_TAKEN');

  const createdAt = Date.now();
  await redis.hset(userKey(id), {
    id,
    username:     username.slice(0, 30),
    email:        normEmail,
    passwordHash,
    createdAt:    createdAt.toString(),
  });

  return { id, username: username.slice(0, 30), email: normEmail, createdAt };
}

async function findUserByEmail(email) {
  const id = await r().get(emailIdx(email.toLowerCase()));
  if (!id) return null;
  return getUserById(id);
}

async function getUserById(id) {
  const data = await r().hgetall(userKey(id));
  if (!data || !data.id) return null;
  return {
    id:           data.id,
    username:     data.username,
    email:        data.email,
    passwordHash: data.passwordHash,
    createdAt:    parseInt(data.createdAt),
  };
}

async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.passwordHash);
}

async function changePassword(userId, newPassword) {
  const hash = await bcrypt.hash(newPassword, 10);
  await r().hset(userKey(userId), 'passwordHash', hash);
}

async function saveAddress(userId, address) {
  const key = savedKey(userId);
  const pl  = r().pipeline();
  pl.zadd(key, Date.now(), address.toLowerCase());
  pl.expire(key, SAVED_TTL);
  pl.zremrangebyrank(key, 0, -(20 + 1)); // no-op nếu count <= 20
  await pl.exec();
}

async function getSavedAddresses(userId) {
  return r().zrevrange(savedKey(userId), 0, 19);
}

async function removeSavedAddress(userId, address) {
  await r().zrem(savedKey(userId), address.toLowerCase());
}

module.exports = {
  createUser, findUserByEmail, getUserById,
  verifyPassword, changePassword,
  saveAddress, getSavedAddresses, removeSavedAddress,
};
