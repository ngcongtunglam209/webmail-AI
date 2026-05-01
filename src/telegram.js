const TelegramBot  = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const storage        = require('./storage');
const { extractOTP } = require('./otp');
const config         = require('./config');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;

const tgAddrKey  = (chatId)  => `tg:addr:${chatId}`;
const tgWatchKey = (address) => `tg:watch:${address.toLowerCase()}`;

async function redis() { return storage._redis(); }

// ── Keyboards ──────────────────────────────────────────────

// Menu chính (giống sidebar web) — hiện cố định ở đáy chat
function mainMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '📥 Inbox' },          { text: '🔐 OTP mới nhất' }],
        [{ text: '📧 Địa chỉ của tôi' }, { text: '🆕 Địa chỉ mới'  }],
        [{ text: '⏱ Đổi thời hạn' },    { text: '❓ Hướng dẫn'     }],
        [{ text: '☕ Ủng hộ tác giả' }],
      ],
      resize_keyboard:  true,
      persistent:       true,
      one_time_keyboard: false,
    },
    parse_mode: 'MarkdownV2',
  };
}

// Inline buttons cho từng email trong inbox
function emailInlineKeyboard(emailId, address, idx) {
  return {
    inline_keyboard: [[
      { text: '📖 Đọc',       callback_data: `read:${idx}:${address}` },
      { text: '🗑️ Xóa',      callback_data: `del:${emailId}:${address}` },
    ]],
  };
}

// Inline chọn TTL
function ttlKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '10 phút',  callback_data: 'ttl:600'   },
        { text: '30 phút',  callback_data: 'ttl:1800'  },
        { text: '1 giờ',    callback_data: 'ttl:3600'  },
      ],
      [
        { text: '6 giờ',    callback_data: 'ttl:21600' },
        { text: '24 giờ',   callback_data: 'ttl:86400' },
      ],
    ],
  };
}

// ── Start bot ──────────────────────────────────────────────
function startTelegramBot() {
  if (!TOKEN) {
    console.log('[Telegram] BOT_TOKEN chưa cấu hình, bỏ qua.');
    return null;
  }

  bot = new TelegramBot(TOKEN, { polling: true });

  // Đăng ký commands menu hiện trong "/"
  bot.setMyCommands([
    { command: 'start',  description: '🚀 Bắt đầu / Mở menu' },
    { command: 'inbox',  description: '📥 Xem hộp thư' },
    { command: 'otp',    description: '🔐 Lấy OTP mới nhất' },
    { command: 'addr',   description: '📧 Xem địa chỉ hiện tại' },
    { command: 'new',    description: '🆕 Tạo địa chỉ mới' },
    { command: 'ttl',    description: '⏱ Đổi thời hạn' },
    { command: 'help',   description: '❓ Hướng dẫn sử dụng' },
    { command: 'donate', description: '☕ Ủng hộ tác giả' },
  ]).catch(() => {});

  bot.on('polling_error', err => console.error('[Telegram] Polling:', err.message));

  // ── Xử lý text (cả lệnh và nút menu) ──
  bot.on('message', async (msg) => {
    if (!msg.text) return;
    const chatId = msg.chat.id;
    const text   = msg.text.trim();

    // Map nút menu → handler
    if (text === '📥 Inbox'          || text === '/inbox') return handleInbox(chatId);
    if (text === '🔐 OTP mới nhất'   || text === '/otp')   return handleOTP(chatId);
    if (text === '📧 Địa chỉ của tôi'|| text === '/addr')  return handleAddr(chatId);
    if (text === '🆕 Địa chỉ mới'    || text === '/new')   return handleNew(chatId);
    if (text === '⏱ Đổi thời hạn'   || text === '/ttl')    return handleTTL(chatId);
    if (text === '❓ Hướng dẫn'      || text === '/help')   return handleHelp(chatId);
    if (text === '☕ Ủng hộ tác giả' || text === '/donate') return handleDonate(chatId);

    if (text === '/start') return handleStart(chatId, msg.from?.first_name);

    // /read <n> và /del <n>
    const readMatch = text.match(/^\/read(?:\s+(\d+))?/);
    if (readMatch) return handleRead(chatId, parseInt(readMatch[1]) || 1);

    const delMatch = text.match(/^\/del(?:\s+(\d+))?/);
    if (delMatch) return handleDel(chatId, parseInt(delMatch[1]) || 1);
  });

  // ── Inline keyboard callbacks ──
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const msgId  = query.message.message_id;
    const data   = query.data;

    if (data.startsWith('read:')) {
      const [, idx, address] = data.split(':');
      await handleRead(chatId, parseInt(idx));
    }

    if (data.startsWith('readid:')) {
      const emailId = data.slice(7);
      await handleReadById(chatId, emailId);
    }

    if (data.startsWith('del:')) {
      const [, emailId, address] = data.split(':');
      await storage.deleteEmail(emailId, address);
      await bot.editMessageText('🗑️ Đã xóa email\\.', {
        chat_id: chatId, message_id: msgId,
        parse_mode: 'MarkdownV2',
      }).catch(() => {});
    }

    if (data.startsWith('ttl:')) {
      const ttl     = parseInt(data.split(':')[1]);
      const address = await getAddress(chatId);
      if (address) {
        const r = await redis();
        await r.set(tgAddrKey(chatId) + ':ttl', ttl, 'EX', 86400);
        const label = formatTTL(ttl);
        await bot.editMessageText(
          `✅ Đã đặt thời hạn: *${escMd(label)}*\nÁp dụng cho địa chỉ tiếp theo\\.`,
          { chat_id: chatId, message_id: msgId, parse_mode: 'MarkdownV2' }
        ).catch(() => {});
      }
    }

    await bot.answerCallbackQuery(query.id).catch(() => {});
  });

  console.log('[Telegram] Bot started ✓');
  return bot;
}

// ── Handlers ───────────────────────────────────────────────

async function handleStart(chatId, firstName = '') {
  const address = await getAddress(chatId);
  const name    = firstName ? escMd(firstName) : 'bạn';

  if (address) {
    await send(chatId,
      `👋 Chào mừng trở lại, ${name}\\!\n\n` +
      `📧 Địa chỉ hiện tại:\n\`${escMd(address)}\`\n\n` +
      `_Chọn một tùy chọn từ menu bên dưới_ 👇`,
      mainMenu()
    );
  } else {
    const addr = await createAddress(chatId);
    await send(chatId,
      `🎉 Chào mừng đến với *TempMail*, ${name}\\!\n\n` +
      `📧 Địa chỉ email của bạn:\n\`${escMd(addr)}\`\n\n` +
      `⏱ Hiệu lực: *1 giờ*\n` +
      `🔔 Bạn sẽ nhận thông báo ngay khi có email mới\\!\n\n` +
      `_Chọn một tùy chọn từ menu bên dưới_ 👇`,
      mainMenu()
    );
  }
}

async function handleInbox(chatId) {
  const address = await getAddress(chatId);
  if (!address) return sendNoAddress(chatId);

  const emails = await storage.getInbox(address);

  if (!emails.length) {
    return send(chatId,
      `📭 *Inbox trống*\n\n📧 \`${escMd(address)}\`\n\n_Đang chờ email đến\\.\\.\\._`,
      mainMenu()
    );
  }

  // Gửi header
  await send(chatId,
    `📥 *Inbox* \\(${emails.length} email\\)\n📧 \`${escMd(address)}\``,
    mainMenu()
  );

  // Gửi từng email dưới dạng card riêng
  for (let i = 0; i < Math.min(emails.length, 10); i++) {
    const e   = emails[i];
    const otp = e.otp || null;

    let text = `*${i + 1}\\.* 📋 ${escMd(e.subject)}\n`;
    text += `👤 ${escMd(trimSender(e.from))}\n`;
    text += `🕐 ${relativeTime(e.receivedAt)}`;
    if (otp) text += `\n🔐 OTP: \`${escMd(otp)}\``;

    await bot.sendMessage(chatId, text, {
      parse_mode: 'MarkdownV2',
      reply_markup: emailInlineKeyboard(e.id, address, i + 1),
    }).catch(() => {});
  }
}

async function handleOTP(chatId) {
  const address = await getAddress(chatId);
  if (!address) return sendNoAddress(chatId);

  const emails = await storage.getInbox(address);
  if (!emails.length) return send(chatId, '📭 Inbox trống\\.', mainMenu());

  for (const e of emails) {
    const full = await storage.getEmail(e.id);
    const otp  = e.otp || full?.otp || extractOTP(e.subject, full?.text);
    if (otp) {
      return send(chatId,
        `🔐 *OTP tìm thấy\\!*\n\n` +
        `Mã xác nhận:\n\`${escMd(otp)}\`\n\n` +
        `📋 ${escMd(e.subject)}\n` +
        `👤 ${escMd(trimSender(e.from))}`,
        mainMenu()
      );
    }
  }

  await send(chatId, '❓ Không tìm thấy OTP trong inbox\\.', mainMenu());
}

async function handleAddr(chatId) {
  const address = await getAddress(chatId);
  if (!address) return sendNoAddress(chatId);
  await send(chatId,
    `📧 *Địa chỉ của bạn:*\n\`${escMd(address)}\`\n\n_Nhấn để sao chép_`,
    mainMenu()
  );
}

async function handleNew(chatId) {
  const addr = await createAddress(chatId);
  await send(chatId,
    `✅ *Địa chỉ mới đã tạo\\!*\n\n📧 \`${escMd(addr)}\`\n\n⏱ Hiệu lực: *1 giờ*`,
    mainMenu()
  );
}

async function handleTTL(chatId) {
  await bot.sendMessage(chatId,
    '⏱ *Chọn thời hạn cho địa chỉ tiếp theo:*',
    { parse_mode: 'MarkdownV2', reply_markup: ttlKeyboard() }
  );
}

async function handleRead(chatId, num) {
  const address = await getAddress(chatId);
  if (!address) return sendNoAddress(chatId);

  const emails = await storage.getInbox(address);
  if (!emails.length) return send(chatId, '📭 Inbox trống\\.', mainMenu());

  const email = emails[num - 1];
  if (!email) return send(chatId, `❌ Không có email số *${num}*\\.`, mainMenu());

  const full = await storage.getEmail(email.id);
  const otp  = email.otp || full?.otp || extractOTP(email.subject, full?.text);

  let text = `📧 *${escMd(email.subject)}*\n`;
  text += `${'─'.repeat(28)}\n`;
  text += `👤 Từ: ${escMd(email.from)}\n`;
  text += `🕐 ${relativeTime(email.receivedAt)}\n`;
  if (otp) text += `🔐 OTP: \`${escMd(otp)}\`\n`;
  text += `${'─'.repeat(28)}\n`;

  const body = (full?.text || '').slice(0, 2000).trim();
  text += body ? escMd(body) : '_\\(không có nội dung text\\)_';
  if ((full?.text || '').length > 2000) text += '\n_\\.\\.\\. bị cắt bớt_';

  await bot.sendMessage(chatId, text, {
    parse_mode: 'MarkdownV2',
    reply_markup: {
      ...emailInlineKeyboard(email.id, address, num),
      ...mainMenu().reply_markup,
    },
  }).catch(() => send(chatId, `❌ Không thể hiển thị email này\\.`));
}

async function handleDel(chatId, num) {
  const address = await getAddress(chatId);
  if (!address) return sendNoAddress(chatId);

  const emails = await storage.getInbox(address);
  if (!emails.length) return send(chatId, '📭 Inbox trống\\.', mainMenu());

  const email = emails[num - 1];
  if (!email) return send(chatId, `❌ Không có email số *${num}*\\.`, mainMenu());

  await storage.deleteEmail(email.id, address);
  await send(chatId, `🗑️ Đã xóa: _${escMd(email.subject)}_`, mainMenu());
}

async function handleHelp(chatId) {
  await send(chatId,
    `❓ *Hướng dẫn TempMail Bot*\n\n` +
    `Dùng menu bên dưới hoặc các lệnh:\n\n` +
    `📥 *Inbox* — Xem danh sách email\n` +
    `🔐 *OTP* — Lấy mã OTP mới nhất\n` +
    `📧 *Địa chỉ* — Xem địa chỉ hiện tại\n` +
    `🆕 *Địa chỉ mới* — Tạo địa chỉ khác\n` +
    `⏱ *Đổi thời hạn* — Chọn TTL cho địa chỉ\n\n` +
    `Lệnh nâng cao:\n` +
    `/read 2 — Đọc email thứ 2\n` +
    `/del 2 — Xóa email thứ 2`,
    mainMenu()
  );
}

async function handleReadById(chatId, emailId) {
  const email = await storage.getEmail(emailId);
  if (!email) return send(chatId, '❌ Email không còn tồn tại\\.', mainMenu());

  const otp = email.otp || extractOTP(email.subject, email.text);

  let text = `📧 *${escMd(email.subject)}*\n`;
  text += `${'─'.repeat(28)}\n`;
  text += `👤 Từ: ${escMd(email.from)}\n`;
  text += `🕐 ${relativeTime(email.receivedAt)}\n`;
  if (otp) text += `🔐 OTP: \`${escMd(otp)}\`\n`;
  text += `${'─'.repeat(28)}\n`;

  const body = (email.text || '').slice(0, 2000).trim();
  text += body ? escMd(body) : '_\\(không có nội dung text\\)_';
  if ((email.text || '').length > 2000) text += '\n_\\.\\.\\. bị cắt bớt_';

  await bot.sendMessage(chatId, text, {
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: [[
        { text: '🗑️ Xóa email này', callback_data: `del:${emailId}:${email.to}` },
      ]],
    },
  }).catch(() => send(chatId, '❌ Không thể hiển thị email này\\.'));
}

async function handleDonate(chatId) {
  const qrUrl =
    'https://img.vietqr.io/image/ICB-0842879198-compact_2.png'

  const caption =
    `☕ *Ủng hộ tác giả TempMail*\n\n` +
    `🏦 Ngân hàng: *VietinBank*\n` +
    `💳 STK: \`0842879198\`\n` +
    `👤 CTK: NGUYEN CONG TUNG LAM\n` +
    `📝 Nội dung: \`Ung ho TempMail\`\n\n` +
    `_Mọi khoản ủng hộ dù nhỏ đều giúp duy trì server\\. Cảm ơn bạn\\! 🙏_`;

  await bot.sendPhoto(chatId, qrUrl, {
    caption,
    parse_mode: 'MarkdownV2',
    reply_markup: mainMenu().reply_markup,
  }).catch(() => {
    // Fallback nếu không gửi được ảnh
    send(chatId, caption, mainMenu());
  });
}

function sendNoAddress(chatId) {
  return send(chatId,
    '❌ Bạn chưa có địa chỉ email\\. Nhấn *🆕 Địa chỉ mới* để tạo\\.',
    mainMenu()
  );
}

// ── Notification khi có email mới ─────────────────────────
async function notifyTelegram(to, emailMeta) {
  if (!bot) return;
  try {
    const r      = await redis();
    const chatId = await r.get(tgWatchKey(to));
    if (!chatId) return;

    const otp = emailMeta.otp || null;

    let text = `📬 *Email mới\\!*\n\n`;
    text += `📧 \`${escMd(to)}\`\n`;
    text += `👤 ${escMd(trimSender(emailMeta.from))}\n`;
    text += `📋 ${escMd(emailMeta.subject)}`;
    if (otp) text += `\n\n🔐 OTP: \`${escMd(otp)}\``;

    await bot.sendMessage(chatId, text, {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[
          { text: '📖 Xem toàn bộ email', callback_data: `readid:${emailMeta.id}` },
          { text: '🗑️ Xóa',              callback_data: `del:${emailMeta.id}:${to}` },
        ]],
      },
    }).catch(() => send(chatId, text, mainMenu()));
  } catch (err) {
    console.error('[Telegram] notifyTelegram:', err.message);
  }
}

// ── Helpers ────────────────────────────────────────────────
async function createAddress(chatId) {
  const r       = await redis();
  const domains = config.domains;
  if (!domains.length) return null;

  // Đọc TTL đã chọn (mặc định 3600)
  const savedTtl = await r.get(tgAddrKey(chatId) + ':ttl');
  const ttl      = parseInt(savedTtl) || 3600;

  const domain  = domains[Math.floor(Math.random() * domains.length)];
  const user    = uuidv4().replace(/-/g, '').slice(0, 10);
  const address = `${user}@${domain}`;

  await r.set(tgAddrKey(chatId), address, 'EX', ttl + 300);
  await r.set(tgWatchKey(address), chatId, 'EX', ttl + 300);
  return address;
}

async function getAddress(chatId) {
  const r = await redis();
  return r.get(tgAddrKey(chatId));
}

function send(chatId, text, options = {}) {
  const opts = { parse_mode: 'MarkdownV2', ...options };
  return bot.sendMessage(chatId, text, opts).catch(err => {
    console.error('[Telegram] sendMessage:', err.message);
  });
}

function trimSender(from) {
  return (from || '').replace(/<.*?>/g, '').trim() || from;
}

function escMd(str) {
  return String(str || '').replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
}

function formatTTL(seconds) {
  if (seconds < 3600) return `${seconds / 60} phút`;
  if (seconds < 86400) return `${seconds / 3600} giờ`;
  return `${seconds / 86400} ngày`;
}

function relativeTime(val) {
  const diff = (Date.now() - (typeof val === 'number' ? val : new Date(val).getTime())) / 1000;
  if (diff < 60)    return 'Vừa xong';
  if (diff < 3600)  return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return new Date(val).toLocaleDateString('vi-VN');
}

module.exports = { startTelegramBot, notifyTelegram };
