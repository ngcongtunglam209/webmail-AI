const socket = io();
let currentAddress = null;
let currentEmailId = null;
let ttlInterval = null;
let ttlSeconds = 3600;
let readIds = new Set();

// DOM refs
const emailAddressInput = document.getElementById('emailAddress');
const copyBtn = document.getElementById('copyBtn');
const refreshBtn = document.getElementById('refreshBtn');
const newBtn = document.getElementById('newBtn');
const domainSelect = document.getElementById('domainSelect');
const customUser = document.getElementById('customUser');
const customBtn = document.getElementById('customBtn');
const statusText = document.getElementById('statusText');
const timerText = document.getElementById('timerText');
const emailList = document.getElementById('emailList');
const emailCount = document.getElementById('emailCount');
const emailModal = document.getElementById('emailModal');
const modalOverlay = document.getElementById('modalOverlay');
const modalSubject = document.getElementById('modalSubject');
const modalFrom = document.getElementById('modalFrom');
const modalDate = document.getElementById('modalDate');
const htmlFrame = document.getElementById('htmlFrame');
const textContent = document.getElementById('textContent');
const deleteEmailBtn = document.getElementById('deleteEmailBtn');
const closeModalBtn = document.getElementById('closeModalBtn');

// Init
(async () => {
  await loadDomains();
  await generateNewAddress();
})();

// Socket events
socket.on('connect', () => setStatus('Đã kết nối', 'connected'));
socket.on('disconnect', () => setStatus('Mất kết nối', 'error'));
socket.on('new_email', (meta) => {
  prependEmailItem(meta, true);
  updateCount();
});

// Button events
copyBtn.addEventListener('click', () => {
  if (!currentAddress) return;
  navigator.clipboard.writeText(currentAddress);
  copyBtn.textContent = 'Đã copy!';
  setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
});

refreshBtn.addEventListener('click', () => loadInbox());

newBtn.addEventListener('click', () => generateNewAddress());

customBtn.addEventListener('click', () => {
  const user = customUser.value.trim();
  const domain = domainSelect.value;
  if (!user) return;
  generateCustomAddress(user, domain);
});

customUser.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') customBtn.click();
});

closeModalBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', closeModal);

deleteEmailBtn.addEventListener('click', async () => {
  if (!currentEmailId || !currentAddress) return;
  await fetch(`/api/email/${currentEmailId}?address=${encodeURIComponent(currentAddress)}`, {
    method: 'DELETE',
  });
  document.querySelector(`.email-item[data-id="${currentEmailId}"]`)?.remove();
  updateCount();
  closeModal();
});

// Tab switching
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
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
  if (currentAddress) {
    socket.emit('unwatch', currentAddress);
  }
  const res = await fetch('/api/generate');
  const { address } = await res.json();
  setAddress(address);
  await loadInbox();
  resetTimer();
}

async function generateCustomAddress(user, domain) {
  if (currentAddress) socket.emit('unwatch', currentAddress);

  const res = await fetch(`/api/generate/${encodeURIComponent(user)}/${encodeURIComponent(domain)}`);
  if (!res.ok) {
    const { error } = await res.json();
    alert(error);
    return;
  }
  const { address } = await res.json();
  setAddress(address);
  customUser.value = '';
  await loadInbox();
  resetTimer();
}

function setAddress(address) {
  currentAddress = address;
  emailAddressInput.value = address;
  socket.emit('watch', address);
  readIds.clear();
}

async function loadInbox() {
  if (!currentAddress) return;
  setStatus('Đang tải...', '');

  const res = await fetch(`/api/inbox/${encodeURIComponent(currentAddress)}`);
  if (!res.ok) { setStatus('Lỗi tải inbox', 'error'); return; }

  const { emails } = await res.json();

  emailList.innerHTML = '';
  if (!emails.length) {
    emailList.innerHTML = '<div class="empty-state">Chưa có email nào. Đang chờ...</div>';
  } else {
    emails.forEach(e => prependEmailItem(e, !readIds.has(e.id)));
  }
  updateCount();
  setStatus('Đã kết nối', 'connected');
}

function prependEmailItem(email, unread = false) {
  // Xóa empty state nếu có
  const empty = emailList.querySelector('.empty-state');
  if (empty) empty.remove();

  // Tránh duplicate
  if (document.querySelector(`.email-item[data-id="${email.id}"]`)) return;

  const item = document.createElement('div');
  item.className = `email-item${unread ? ' unread' : ''}`;
  item.dataset.id = email.id;

  item.innerHTML = `
    <div class="email-dot"></div>
    <div class="email-info">
      <div class="email-from">${escHtml(email.from)}</div>
      <div class="email-subject">${escHtml(email.subject)}</div>
    </div>
    <div class="email-time">${formatTime(email.receivedAt || email.date)}</div>
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

  // Render HTML tab
  const doc = htmlFrame.contentDocument || htmlFrame.contentWindow.document;
  doc.open();
  doc.write(email.html || `<pre style="font-family:sans-serif;padding:20px">${escHtml(email.text || '')}</pre>`);
  doc.close();

  textContent.textContent = email.text || '(không có nội dung text)';

  // Reset tabs
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="html"]').classList.add('active');
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
  emailCount.textContent = `(${count})`;
}

function resetTimer() {
  ttlSeconds = 3600;
  clearInterval(ttlInterval);
  ttlInterval = setInterval(() => {
    ttlSeconds--;
    if (ttlSeconds <= 0) {
      clearInterval(ttlInterval);
      timerText.textContent = 'Hết hạn';
    } else {
      timerText.textContent = `Hết hạn sau: ${formatDuration(ttlSeconds)}`;
    }
  }, 1000);
}

function setStatus(text, cls) {
  statusText.textContent = text;
  statusText.className = cls;
}

function formatTime(val) {
  const d = typeof val === 'number' ? new Date(val) : new Date(val);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
