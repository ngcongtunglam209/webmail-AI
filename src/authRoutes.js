/**
 * Auth routes — /api/auth/*
 * JWT lưu trong httpOnly cookie `tm_session`
 */
const express     = require('express');
const jwt         = require('jsonwebtoken');
const crypto      = require('crypto');
const userStorage = require('./userStorage');

const router = express.Router();

const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[Auth] FATAL: JWT_SECRET phải được cấu hình trong môi trường production.');
  }
  console.warn('[Auth] ⚠️  JWT_SECRET chưa cấu hình — dùng secret ngẫu nhiên (chỉ dùng cho dev).');
  return crypto.randomBytes(32).toString('hex');
})();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge:   30 * 24 * 60 * 60 * 1000, // 30 ngày
  secure:   process.env.NODE_ENV === 'production',
};

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '30d' });
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.tm_session
    || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    res.clearCookie('tm_session');
    res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' });
  }
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Thiếu thông tin' });
  if (!/^[\p{L}\p{N} ._-]{2,30}$/u.test(username))
    return res.status(400).json({ error: 'Tên tài khoản 2–30 ký tự, không chứa ký tự đặc biệt' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Email không hợp lệ' });
  if (password.length < 8 || password.length > 128)
    return res.status(400).json({ error: 'Mật khẩu 8–128 ký tự' });

  try {
    const user  = await userStorage.createUser(username, email, password);
    const token = signToken(user.id);
    res.cookie('tm_session', token, COOKIE_OPTS);
    res.status(201).json({ user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    if (err.message === 'EMAIL_TAKEN')
      return res.status(409).json({ error: 'Email đã được sử dụng' });
    console.error('[Auth] register:', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Thiếu thông tin' });

  try {
    const user  = await userStorage.findUserByEmail(email);
    const valid = user && await userStorage.verifyPassword(user, password);
    if (!valid)
      return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });

    const token = signToken(user.id);
    res.cookie('tm_session', token, COOKIE_OPTS);
    res.json({ user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    console.error('[Auth] login:', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('tm_session');
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await userStorage.getUserById(req.userId);
    if (!user) {
      res.clearCookie('tm_session');
      return res.status(401).json({ error: 'Tài khoản không tồn tại' });
    }
    res.json({ user: { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt } });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi hệ thống' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Thiếu thông tin' });
  if (newPassword.length < 8 || newPassword.length > 128)
    return res.status(400).json({ error: 'Mật khẩu mới 8–128 ký tự' });

  try {
    const user  = await userStorage.getUserById(req.userId);
    const valid = await userStorage.verifyPassword(user, currentPassword);
    if (!valid) return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
    await userStorage.changePassword(req.userId, newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi hệ thống' });
  }
});

// GET /api/auth/addresses
router.get('/addresses', authMiddleware, async (req, res) => {
  try {
    const addresses = await userStorage.getSavedAddresses(req.userId);
    res.json({ addresses });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi hệ thống' });
  }
});

// POST /api/auth/addresses
router.post('/addresses', authMiddleware, async (req, res) => {
  const { address } = req.body || {};
  if (!address || typeof address !== 'string' || address.length > 200)
    return res.status(400).json({ error: 'Địa chỉ không hợp lệ' });
  try {
    await userStorage.saveAddress(req.userId, address);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi hệ thống' });
  }
});

// DELETE /api/auth/addresses/:address
router.delete('/addresses/:address', authMiddleware, async (req, res) => {
  try {
    await userStorage.removeSavedAddress(req.userId, decodeURIComponent(req.params.address));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi hệ thống' });
  }
});

module.exports = { router, authMiddleware };
