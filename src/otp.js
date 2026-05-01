// Trích xuất OTP/mã xác nhận từ nội dung email

const KEYWORDS = /otp|code|mã|pin|passcode|verification|verify|xác\s*nhận|token|one.time|senha|código|كود|رمز|einmal|codice/i;

// Pattern 1: keyword + bất kỳ ký tự nào trên cùng dòng + số
// [^\n]{0,80}? → lazy match, không vượt qua newline
const INLINE = /(?:otp|code|mã|pin|passcode|verification\s*code|verify\s*code|xác\s*nhận|token|one.time)[^\n]{0,80}?([0-9]{4,8})\b/gi;

// Pattern 2: keyword + dấu : + xuống dòng + số (ChatGPT, nhiều dịch vụ dùng kiểu này)
const AFTER_COLON = /(?:otp|code|mã|pin|passcode|verification|verify|xác\s*nhận|token)[^:\n]{0,60}:\s*\n[\s\n]*([0-9]{4,8})\b/gi;

// Pattern 3: số TRƯỚC keyword ("123456 is your code / là mã của bạn")
const BEFORE_KW = /\b([0-9]{4,8})\b[^a-z0-9]{0,20}(?:is\s+your|là\s+mã|ist\s+dein|est\s+votre)/gi;

// Subject chỉ là số thuần
const SUBJECT_ONLY = /^\s*([0-9]{4,8})\s*$/;

function extractOTP(subject, text) {
  // Subject chỉ là số
  if (subject) {
    const m = SUBJECT_ONLY.exec(subject.trim());
    if (m && !isNoise(m[1])) return m[1];
  }

  const src  = `${subject || ''}\n${(text || '').slice(0, 4000)}`;
  const hasKeyword = KEYWORDS.test(src);

  // Strategy A: số đứng 1 mình trên dòng riêng khi email có keyword OTP
  // (ChatGPT, Stripe, nhiều dịch vụ lớn dùng cách này)
  if (hasKeyword) {
    for (const line of src.split('\n')) {
      const trimmed = line.trim();
      if (/^[0-9]{4,8}$/.test(trimmed) && !isNoise(trimmed)) {
        return trimmed;
      }
    }
  }

  // Strategy B: keyword + colon + newline + số
  AFTER_COLON.lastIndex = 0;
  let m = AFTER_COLON.exec(src);
  if (m && !isNoise(m[1])) return m[1];

  // Strategy C: keyword trực tiếp trước số (cùng dòng)
  INLINE.lastIndex = 0;
  m = INLINE.exec(src);
  if (m && !isNoise(m[1])) return m[1];

  // Strategy D: số trước keyword
  BEFORE_KW.lastIndex = 0;
  m = BEFORE_KW.exec(src);
  if (m && !isNoise(m[1])) return m[1];

  return null;
}

function isNoise(num) {
  const n = parseInt(num);
  // Bỏ qua năm (1900–2099)
  if (num.length === 4 && n >= 1900 && n <= 2099) return true;
  return false;
}

module.exports = { extractOTP };
