const socket = io();

let currentAddress = null;
let currentEmailId = null;
let currentTtl     = 3600;
let ttlRemaining   = 3600;
let ttlInterval    = null;
let pollInterval   = null;
let readIds        = new Set();

// DOM refs
const emailAddressEl = document.getElementById('emailAddress');
const copyBtn        = document.getElementById('copyBtn');
const qrBtn          = document.getElementById('qrBtn');
const refreshBtn     = document.getElementById('refreshBtn');
const newBtn         = document.getElementById('newBtn');
const ttlSelect      = document.getElementById('ttlSelect');
const ttlFill        = document.getElementById('ttlFill');
const timerText      = document.getElementById('timerText');
const domainSelect   = document.getElementById('domainSelect');
const customUser     = document.getElementById('customUser');
const customBtn      = document.getElementById('customBtn');
const historySection = document.getElementById('historySection');
const historyList    = document.getElementById('historyList');
const statusDot      = document.getElementById('statusDot');
const statusText     = document.getElementById('statusText');
const notifBtn       = document.getElementById('notifBtn');
const donateBtn      = document.getElementById('donateBtn');
const emailList      = document.getElementById('emailList');
const emailCount     = document.getElementById('emailCount');
const toastContainer = document.getElementById('toastContainer');

// Email modal
const emailModal     = document.getElementById('emailModal');
const modalOverlay   = document.getElementById('modalOverlay');
const modalSubject   = document.getElementById('modalSubject');
const modalFrom      = document.getElementById('modalFrom');
const modalDate      = document.getElementById('modalDate');
const modalAvatar    = document.getElementById('modalAvatar');
const attachmentsBar = document.getElementById('attachmentsBar');
const htmlFrame      = document.getElementById('htmlFrame');
const textContent    = document.getElementById('textContent');
const deleteEmailBtn = document.getElementById('deleteEmailBtn');
const closeModalBtn  = document.getElementById('closeModalBtn');

// QR modal
const qrModal        = document.getElementById('qrModal');
const qrOverlay      = document.getElementById('qrOverlay');
const closeQrBtn     = document.getElementById('closeQrBtn');
const qrCodeImg      = document.getElementById('qrCodeImg');
const qrAddress      = document.getElementById('qrAddress');

// Donate modal
const donateModal    = document.getElementById('donateModal');
const donateOverlay  = document.getElementById('donateOverlay');
const closeDonateBtn = document.getElementById('closeDonateBtn');
const copyStkBtn     = document.getElementById('copyStkBtn');

// ── Init ──
(async () => {
  await loadDomains();
  await generateNewAddress();
  renderHistory();
  updateNotifBtn();
})();

// ── Socket ──
socket.on('connect', () => {
  setStatus('Đã kết nối', 'connected');
  stopPolling();
  if (currentAddress) loadInbox(); // sync lại sau khi reconnect
});

socket.on('disconnect', () => {
  setStatus('Mất kết nối — đang dùng chế độ dự phòng', 'error');
  startPolling();
});

socket.on('new_email',  (meta) => {
  prependEmailItem(meta, true);
  updateCount();
  showToast('📬 Email mới', `${meta.from} — ${meta.subject}`);
  sendBrowserNotification('📬 Email mới', `${meta.from}: ${meta.subject}`);
});

// ── Button events ──
copyBtn.addEventListener('click', () => {
  if (!currentAddress) return;
  navigator.clipboard.writeText(currentAddress);
  copyBtn.innerHTML = '<span class="btn-icon">✓</span> Đã sao chép';
  setTimeout(() => { copyBtn.innerHTML = '<span class="btn-icon">⎘</span> Sao chép'; }, 2000);
});

qrBtn.addEventListener('click', () => {
  if (!currentAddress) return;
  qrCodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(currentAddress)}&bgcolor=ffffff&color=000000&margin=10`;
  qrAddress.textContent = currentAddress;
  qrModal.classList.remove('hidden');
  qrOverlay.classList.remove('hidden');
});

refreshBtn.addEventListener('click', loadInbox);

newBtn.addEventListener('click', generateNewAddress);

ttlSelect.addEventListener('change', () => {
  if (currentAddress) generateNewAddress();
});

customBtn.addEventListener('click', () => {
  const user = customUser.value.trim();
  if (!user) return;
  generateCustomAddress(user, domainSelect.value);
});
customUser.addEventListener('keydown', e => { if (e.key === 'Enter') customBtn.click(); });

notifBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') return;
  await Notification.requestPermission();
  updateNotifBtn();
});

donateBtn.addEventListener('click', () => {
  donateModal.classList.remove('hidden');
  donateOverlay.classList.remove('hidden');
});

closeQrBtn.addEventListener('click', () => {
  qrModal.classList.add('hidden');
  qrOverlay.classList.add('hidden');
});
qrOverlay.addEventListener('click', () => {
  qrModal.classList.add('hidden');
  qrOverlay.classList.add('hidden');
});

closeDonateBtn.addEventListener('click', closeDonate);
donateOverlay.addEventListener('click', closeDonate);
copyStkBtn.addEventListener('click', () => {
  navigator.clipboard.writeText('0842879198');
  copyStkBtn.textContent = 'Đã sao chép!';
  setTimeout(() => { copyStkBtn.textContent = 'Sao chép'; }, 2000);
});

closeModalBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', closeModal);

deleteEmailBtn.addEventListener('click', async () => {
  if (!currentEmailId || !currentAddress) return;
  await fetch(`/api/email/${currentEmailId}?address=${encodeURIComponent(currentAddress)}`, { method: 'DELETE' });
  document.querySelector(`.email-item[data-id="${currentEmailId}"]`)?.remove();
  updateCount();
  closeModal();
  showToast('🗑️ Đã xóa', 'Email đã được xóa');
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    htmlFrame.classList.toggle('hidden', tab !== 'html');
    textContent.classList.toggle('hidden', tab !== 'text');
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeDonate(); closeQr(); }
});

// ── Core functions ──
async function loadDomains() {
  const res = await fetch('/api/domains');
  const { domains } = await res.json();
  domainSelect.innerHTML = domains.map(d => `<option value="${d}">${d}</option>`).join('');
}

async function generateNewAddress() {
  if (currentAddress) socket.emit('unwatch', currentAddress);
  const ttl = parseInt(ttlSelect.value) || 3600;
  const res = await fetch(`/api/generate?ttl=${ttl}`);
  const data = await res.json();
  setAddress(data.address, data.ttl || ttl);
  await loadInbox();
}

async function generateCustomAddress(user, domain) {
  if (currentAddress) socket.emit('unwatch', currentAddress);
  const ttl = parseInt(ttlSelect.value) || 3600;
  const res = await fetch(`/api/generate/${encodeURIComponent(user)}/${encodeURIComponent(domain)}?ttl=${ttl}`);
  if (!res.ok) { const { error } = await res.json(); showToast('❌ Lỗi', error); return; }
  const data = await res.json();
  setAddress(data.address, data.ttl || ttl);
  customUser.value = '';
  await loadInbox();
}

function setAddress(address, ttl = 3600) {
  currentAddress = address;
  currentTtl     = ttl;
  emailAddressEl.textContent = address;
  socket.emit('watch', address);
  readIds.clear();
  saveToHistory(address);
  renderHistory();
  resetTimer(ttl);
}

async function loadInbox() {
  if (!currentAddress) return;
  const res = await fetch(`/api/inbox/${encodeURIComponent(currentAddress)}`);
  if (!res.ok) return;
  const { emails } = await res.json();

  emailList.innerHTML = '';
  if (!emails.length) {
    emailList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-title">Chưa có email nào</div>
        <div class="empty-desc">Sao chép địa chỉ và dùng để đăng ký dịch vụ.<br/>Email sẽ xuất hiện ở đây trong vài giây.</div>
      </div>`;
  } else {
    emails.forEach(e => prependEmailItem(e, !readIds.has(e.id)));
  }
  updateCount();
}

function prependEmailItem(email, unread = false) {
  const empty = emailList.querySelector('.empty-state');
  if (empty) empty.remove();
  if (document.querySelector(`.email-item[data-id="${email.id}"]`)) return;

  const item    = document.createElement('div');
  item.className = `email-item${unread ? ' unread' : ''}`;
  item.dataset.id = email.id;

  const initials = getInitials(email.from);
  const color    = getAvatarColor(email.from);
  const hasAtts  = (email.attachments || []).length > 0;

  const ts = email.receivedAt || new Date(email.date).getTime();

  item.innerHTML = `
    <div class="avatar" style="background:${color}">${initials}</div>
    <div class="email-info">
      <div class="email-from">${escHtml(email.from)}</div>
      <div class="email-subject">${escHtml(email.subject)}${hasAtts ? ' 📎' : ''}</div>
      ${email.otp ? `<div class="otp-badge" data-otp="${escHtml(email.otp)}" title="Click để sao chép">🔐 ${escHtml(email.otp)}</div>` : ''}
    </div>
    <div class="email-right">
      <div class="email-time" data-ts="${ts}">${relativeTime(ts)}</div>
      <div class="unread-dot"></div>
    </div>
  `;

  // Click OTP badge copy ngay, không mở modal
  const otpBadge = item.querySelector('.otp-badge');
  if (otpBadge) {
    otpBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(otpBadge.dataset.otp);
      otpBadge.textContent = '✓ Đã sao chép!';
      setTimeout(() => { otpBadge.innerHTML = `🔐 ${escHtml(otpBadge.dataset.otp)}`; }, 2000);
    });
  }

  item.addEventListener('click', () => openEmail(email.id, item));
  emailList.prepend(item);
}

async function openEmail(id, item) {
  const res = await fetch(`/api/email/${id}`);
  if (!res.ok) return;
  const { email } = await res.json();

  currentEmailId = id;
  readIds.add(id);
  item?.classList.remove('unread');

  modalSubject.textContent = email.subject;
  modalFrom.textContent    = `Từ: ${email.from}`;
  modalDate.textContent    = new Date(email.date).toLocaleString('vi-VN');

  const initials = getInitials(email.from);
  const color    = getAvatarColor(email.from);
  modalAvatar.textContent  = initials;
  modalAvatar.style.background = color;

  // OTP trong modal
  const otpBar = document.getElementById('otpBar');
  if (email.otp) {
    otpBar.classList.remove('hidden');
    otpBar.innerHTML = `
      <span class="otp-label">🔐 Mã OTP:</span>
      <span class="otp-code">${escHtml(email.otp)}</span>
      <button class="otp-copy" id="otpCopyBtn">Sao chép</button>
    `;
    document.getElementById('otpCopyBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(email.otp);
      document.getElementById('otpCopyBtn').textContent = '✓ Đã sao chép!';
      setTimeout(() => { document.getElementById('otpCopyBtn').textContent = 'Sao chép'; }, 2000);
    });
  } else {
    otpBar.classList.add('hidden');
    otpBar.innerHTML = '';
  }

  // Attachments
  const atts = JSON.parse(typeof email.attachments === 'string' ? email.attachments : JSON.stringify(email.attachments || []));
  if (atts.length) {
    attachmentsBar.classList.remove('hidden');
    attachmentsBar.innerHTML = atts.map(a => `
      <a href="/api/attachment/${id}/${a.index}" download="${escHtml(a.filename)}" class="attachment-chip">
        <span class="attachment-chip-icon">${getFileIcon(a.contentType)}</span>
        <span>${escHtml(a.filename)}</span>
        <span class="attachment-size">${formatSize(a.size)}</span>
      </a>
    `).join('');
  } else {
    attachmentsBar.classList.add('hidden');
    attachmentsBar.innerHTML = '';
  }

  // Email content
  const doc = htmlFrame.contentDocument || htmlFrame.contentWindow.document;
  doc.open();
  doc.write(email.html || `<div style="font-family:sans-serif;padding:24px;color:#333;line-height:1.7">${escHtml(email.text || '(không có nội dung)')}</div>`);
  doc.close();

  textContent.textContent = email.text || '(không có nội dung text)';

  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelector('.tab[data-tab="html"]').classList.add('active');
  htmlFrame.classList.remove('hidden');
  textContent.classList.add('hidden');

  emailModal.classList.remove('hidden');
  modalOverlay.classList.remove('hidden');
}

function closeModal() {
  emailModal.classList.add('hidden');
  modalOverlay.classList.add('hidden');
  currentEmailId = null;
}

function closeDonate() {
  donateModal.classList.add('hidden');
  donateOverlay.classList.add('hidden');
}

function closeQr() {
  qrModal.classList.add('hidden');
  qrOverlay.classList.add('hidden');
}

function updateCount() {
  const count = emailList.querySelectorAll('.email-item').length;
  emailCount.textContent = count;
}

// ── TTL timer ──
function resetTimer(ttl = 3600) {
  ttlRemaining = ttl;
  clearInterval(ttlInterval);
  ttlInterval = setInterval(() => {
    ttlRemaining = Math.max(0, ttlRemaining - 1);
    const pct = (ttlRemaining / currentTtl) * 100;
    ttlFill.style.width = `${pct}%`;
    ttlFill.classList.toggle('low', pct < 20);
    timerText.textContent = formatDuration(ttlRemaining);
    if (ttlRemaining === 0) clearInterval(ttlInterval);
  }, 1000);
  ttlFill.style.width = '100%';
  timerText.textContent = formatDuration(ttl);
}

// ── Address history ──
function saveToHistory(address) {
  let history = getHistory();
  history = [address, ...history.filter(a => a !== address)].slice(0, 5);
  localStorage.setItem('tm_history', JSON.stringify(history));
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem('tm_history') || '[]'); } catch { return []; }
}

function removeFromHistory(address) {
  const history = getHistory().filter(a => a !== address);
  localStorage.setItem('tm_history', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const history = getHistory();
  if (history.length <= 1) {
    historySection.style.display = 'none';
    return;
  }
  historySection.style.display = 'flex';
  historyList.innerHTML = history.map(addr => `
    <div class="history-item${addr === currentAddress ? ' active' : ''}" data-addr="${escHtml(addr)}">
      <span class="history-addr">${escHtml(addr)}</span>
      <button class="history-del" data-del="${escHtml(addr)}" title="Xóa">×</button>
    </div>
  `).join('');

  historyList.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.history-del')) return;
      const addr = item.dataset.addr;
      if (addr !== currentAddress) switchToAddress(addr);
    });
  });

  historyList.querySelectorAll('.history-del').forEach(btn => {
    btn.addEventListener('click', () => removeFromHistory(btn.dataset.del));
  });
}

async function switchToAddress(address) {
  if (currentAddress) socket.emit('unwatch', currentAddress);
  currentAddress = address;
  emailAddressEl.textContent = address;
  socket.emit('watch', address);
  readIds.clear();
  renderHistory();
  await loadInbox();
}

// ── Browser notifications ──
function updateNotifBtn() {
  if (!('Notification' in window)) { notifBtn.style.display = 'none'; return; }
  const granted = Notification.permission === 'granted';
  notifBtn.classList.toggle('active', granted);
  notifBtn.title = granted ? 'Thông báo đã bật' : 'Bật thông báo';
}

function sendBrowserNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return; // chỉ hiện khi tab bị ẩn
  new Notification(title, { body, icon: '/favicon.ico' });
}

// ── Cập nhật timestamp mỗi 60 giây ──
setInterval(() => {
  document.querySelectorAll('.email-time[data-ts]').forEach(el => {
    el.textContent = relativeTime(parseInt(el.dataset.ts));
  });
}, 60000);

// ── Auto-refresh fallback ──
function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(() => {
    if (currentAddress) loadInbox();
  }, 30000);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// ── Status ──
function setStatus(text, cls) {
  statusText.textContent = text;
  statusDot.className = `status-dot ${cls}`;
}

// ── Toast ──
function showToast(title, desc) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-icon">📬</div>
    <div class="toast-body">
      <div class="toast-title">${escHtml(title)}</div>
      <div class="toast-desc">${escHtml(desc)}</div>
    </div>
  `;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ── Helpers ──
function getInitials(from) {
  const name  = from.replace(/<.*?>/g, '').trim();
  const words = name.split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (name[0] || '?').toUpperCase();
}

const AVATAR_COLORS = [
  '#3b82f6','#8b5cf6','#ec4899','#f59e0b',
  '#10b981','#06b6d4','#f97316','#6366f1',
];

function getAvatarColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function relativeTime(val) {
  const diff = (Date.now() - (typeof val === 'number' ? val : new Date(val).getTime())) / 1000;
  if (diff < 60)    return 'Vừa xong';
  if (diff < 3600)  return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return new Date(val).toLocaleDateString('vi-VN');
}

function formatDuration(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes/1024).toFixed(1)}KB`;
  return `${(bytes/1048576).toFixed(1)}MB`;
}

function getFileIcon(contentType) {
  if (!contentType) return '📄';
  if (contentType.startsWith('image/'))       return '🖼️';
  if (contentType.startsWith('video/'))       return '🎬';
  if (contentType.startsWith('audio/'))       return '🎵';
  if (contentType.includes('pdf'))            return '📕';
  if (contentType.includes('zip') || contentType.includes('rar') || contentType.includes('compress')) return '🗜️';
  if (contentType.includes('word') || contentType.includes('document')) return '📝';
  if (contentType.includes('sheet') || contentType.includes('excel'))   return '📊';
  return '📎';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
