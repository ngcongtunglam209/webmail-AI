// Trích xuất OTP/mã xác nhận từ nội dung email

const PATTERNS = [
  // keyword TRƯỚC số: "OTP: 123456", "mã xác nhận: 123456", "code is 123456"
  /(?:otp|code|mã|pin|passcode|verification\s*code|verify\s*code|xác\s*nhận|token|one.time|senha|código|كود|رمز)[^a-z0-9]*([0-9]{4,8})/gi,
  // số TRƯỚC keyword: "123456 is your code", "123456 là mã"
  /\b([0-9]{4,8})\b[^a-z0-9]*(?:is\s+your|là\s+mã|ist\s+dein|est\s+votre)/gi,
  // Dòng chứa số 6 chữ số kèm từ khóa gần đó (trong 60 ký tự)
  /(?:otp|code|mã|pin|verify|xác\s*nhận).{0,60}?\b([0-9]{5,8})\b/gi,
];

// Subject chỉ là số thuần (nhiều dịch vụ gửi OTP làm subject)
const SUBJECT_ONLY = /^\s*([0-9]{4,8})\s*$/;

function extractOTP(subject, text) {
  // Ưu tiên tìm trong subject trước
  if (subject) {
    const m = SUBJECT_ONLY.exec(subject.trim());
    if (m) return m[1];
  }

  const sources = [
    subject || '',
    (text || '').slice(0, 3000),
  ];

  for (const src of sources) {
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      const m = pattern.exec(src);
      if (m) {
        const otp = m[1];
        // Lọc bỏ số trông giống năm hoặc số điện thoại
        if (otp.length >= 4 && otp.length <= 8 && !isNoise(otp)) {
          return otp;
        }
      }
    }
  }

  return null;
}

function isNoise(num) {
  // Bỏ qua năm (1900-2099)
  const n = parseInt(num);
  if (num.length === 4 && n >= 1900 && n <= 2099) return true;
  return false;
}

module.exports = { extractOTP };
