const socket = io();
let currentAddress = null;
let currentEmailId = null;
let ttlSeconds = 3600;
let ttlTotal = 3600;
let ttlInterval = null;
let readIds = new Set();

// DOM refs
const emailAddressEl = document.getElementById('emailAddress');
const copyBtn        = document.getElementById('copyBtn');
const refreshBtn     = document.getElementById('refreshBtn');
const newBtn         = document.getElementById('newBtn');
const domainSelect   = document.getElementById('domainSelect');
const customUser     = document.getElementById('customUser');
const customBtn      = document.getElementById('customBtn');
const statusDot      = document.getElementById('statusDot');
const statusText     = document.getElementById('statusText');
const timerText      = document.getElementById('timerText');
const ttlFill        = document.getElementById('ttlFill');
const emailList      = document.getElementById('emailList');
const emailCount     = document.getElementById('emailCount');
const emailModal     = document.getElementById('emailModal');
const modalOverlay   = document.getElementById('modalOverlay');
const modalSubject   = document.getElementById('modalSubject');
const modalFrom      = document.getElementById('modalFrom');
const modalDate      = document.getElementById('modalDate');
const modalAvatar    = document.getElementById('modalAvatar');
const htmlFrame      = document.getElementById('htmlFrame');
const textContent    = document.getElementById('textContent');
const deleteEmailBtn = document.getElementById('deleteEmailBtn');
const closeModalBtn  = document.getElementById('closeModalBtn');
const toastContainer = document.getElementById('toastContainer');

// Init
(async () => {
  await loadDomains();
  await generateNewAddress();
})();

// Socket
socket.on('connect',    () => setStatus('Đã kết nối', 'connected'));
socket.on('disconnect', () => setStatus('Mất kết nối', 'error'));
socket.on('new_email',  (meta) => {
  prependEmailItem(meta, true);
  updateCount();
  showToast('📬 Email mới', `${meta.from} — ${meta.subject}`);
});

// Buttons
copyBtn.addEventListener('click', () => {
  if (!currentAddress) return;
  navigator.clipboard.writeText(currentAddress);
  copyBtn.innerHTML = '<span class="btn-icon">✓</span> Đã sao chép';
  setTimeout(() => { copyBtn.innerHTML = '<span class="btn-icon">⎘</span> Sao chép'; }, 2000);
});

refreshBtn.addEventListener('click', loadInbox);
newBtn.addEventListener('click', generateNewAddress);
customBtn.addEventListener('click', () => {
  const user = customUser.value.trim();
  if (!user) return;
  generateCustomAddress(user, domainSelect.value);
});
customUser.addEventListener('keydown', e => { if (e.key === 'Enter') customBtn.click(); });

closeModalBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

deleteEmailBtn.addEventListener('click', async () => {
  if (!currentEmailId || !currentAddress) return;
  await fetch(`/api/email/${currentEmailId}?address=${encodeURIComponent(currentAddress)}`, { method: 'DELETE' });
  document.querySelector(`.email-item[data-id="${currentEmailId}"]`)?.remove();
  updateCount();
  closeModal();
  showToast('🗑️ Đã xóa', 'Email đã được xóa khỏi inbox');
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

// Functions
async function loadDomains() {
  const res = await fetch('/api/domains');
  const { domains } = await res.json();
  domainSelect.innerHTML = domains.map(d => `<option value="${d}">${d}</option>`).join('');
}

async function generateNewAddress() {
  if (currentAddress) socket.emit('unwatch', currentAddress);
  const res = await fetch('/api/generate');
  const { address } = await res.json();
  setAddress(address);
  await loadInbox();
  resetTimer();
}

async function generateCustomAddress(user, domain) {
  if (currentAddress) socket.emit('unwatch', currentAddress);
  const res = await fetch(`/api/generate/${encodeURIComponent(user)}/${encodeURIComponent(domain)}`);
  if (!res.ok) { const { error } = await res.json(); showToast('❌ Lỗi', error, 'error'); return; }
  const { address } = await res.json();
  setAddress(address);
  customUser.value = '';
  await loadInbox();
  resetTimer();
}

function setAddress(address) {
  currentAddress = address;
  emailAddressEl.textContent = address;
  socket.emit('watch', address);
  readIds.clear();
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

  const item = document.createElement('div');
  item.className = `email-item${unread ? ' unread' : ''}`;
  item.dataset.id = email.id;

  const initials = getInitials(email.from);
  const color = getAvatarColor(email.from);

  item.innerHTML = `
    <div class="avatar" style="background:${color}">${initials}</div>
    <div class="email-info">
      <div class="email-from">${escHtml(email.from)}</div>
      <div class="email-subject">${escHtml(email.subject)}</div>
    </div>
    <div class="email-right">
      <div class="email-time">${relativeTime(email.receivedAt || email.date)}</div>
      <div class="unread-dot"></div>
    </div>
  `;

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
  modalFrom.textContent = `Từ: ${email.from}`;
  modalDate.textContent = new Date(email.date).toLocaleString('vi-VN');

  const initials = getInitials(email.from);
  const color = getAvatarColor(email.from);
  modalAvatar.textContent = initials;
  modalAvatar.style.background = color;

  const doc = htmlFrame.contentDocument || htmlFrame.contentWindow.document;
  doc.open();
  doc.write(email.html || `<div style="font-family:sans-serif;padding:24px;color:#333;line-height:1.6">${escHtml(email.text || '(không có nội dung)')}</div>`);
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

function updateCount() {
  const count = emailList.querySelectorAll('.email-item').length;
  emailCount.textContent = count;
}

function resetTimer() {
  ttlSeconds = 3600;
  ttlTotal = 3600;
  clearInterval(ttlInterval);
  ttlInterval = setInterval(() => {
    ttlSeconds = Math.max(0, ttlSeconds - 1);
    const pct = (ttlSeconds / ttlTotal) * 100;
    ttlFill.style.width = `${pct}%`;
    ttlFill.classList.toggle('low', pct < 20);
    timerText.textContent = formatDuration(ttlSeconds);
    if (ttlSeconds === 0) clearInterval(ttlInterval);
  }, 1000);
}

function setStatus(text, cls) {
  statusText.textContent = text;
  statusDot.className = `status-dot ${cls}`;
}

function showToast(title, desc, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-icon">${type === 'error' ? '❌' : '📬'}</div>
    <div class="toast-body">
      <div class="toast-title">${escHtml(title)}</div>
      <div class="toast-desc">${escHtml(desc)}</div>
    </div>
  `;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Helpers
function getInitials(from) {
  const name = from.replace(/<.*?>/, '').trim();
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
  if (diff < 60) return 'Vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return new Date(val).toLocaleDateString('vi-VN');
}

function formatDuration(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
