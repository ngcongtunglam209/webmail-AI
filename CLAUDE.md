# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # production
npm run dev        # development with nodemon (auto-restart)
node src/index.js  # run directly
```

No test framework is configured. No build step — plain Node.js.

## Architecture

Two servers start together inside `src/index.js`:
- **Express HTTP server** (default port 3000) — REST API + static files + Socket.IO
- **SMTP server** (default port 25) — receives incoming email via `smtp-server`

All data is stored in **Redis only** (ioredis). There is no SQL database.

### Request routing

| Path | Handler | Auth |
|------|---------|------|
| `/api/*` | `src/api.js` | None (public) |
| `/api/auth/*` | `src/authRoutes.js` | None / JWT cookie |
| `/v1/*` | `src/devapi.js` | `Authorization: Bearer tm_xxxx` |
| `/admin/api/*` | `src/adminRoutes.js` | `X-Admin-Secret` header |
| `/app`, `/docs`, `/admin` | Static HTML in `public/` | — |
| `*` | `public/index.html` | — |

### Storage layer (`src/storage.js`)

All Redis key patterns:

| Key | Type | Contents |
|-----|------|----------|
| `inbox:{address}` | sorted set | email IDs, score = receivedAt timestamp |
| `email:{id}` | hash | id, to, from, subject, text, html, date, receivedAt, otp, attachments (JSON) |
| `inbox:ttl:{address}` | string | TTL in seconds |
| `att:{id}:{i}` | hash | filename, contentType, content (base64) |
| `apikey:{key}` | hash | label, createdAt, requestCount, userId |
| `apikey:rl:{key}:{hour}` | string | rate limit counter (expires 2h) |
| `user:{id}` | hash | id, username, email, passwordHash, createdAt |
| `userByEmail:{email}` | string | userId (unique index) |
| `user:savedAddrs:{id}` | sorted set | saved addresses, score = timestamp |

User storage helpers live in `src/userStorage.js` (separate from `src/storage.js`).

### Auth system

- JWT signed with `JWT_SECRET`, stored in `tm_session` cookie (30-day expiry)
- `authMiddleware` exported from `src/authRoutes.js`, reused in `src/api.js`
- API keys: format `tm_` + 32 hex chars, rate-limited at 200 req/hour per key
- **Legacy API keys** (`userId = ''`, created before auth existed) are blocked in `src/keyauth.js` with error code `LEGACY_KEY`

### Real-time email flow

1. SMTP receives email → validates domain against `ALLOWED_DOMAINS` → parses with `mailparser`
2. `storage.saveEmail()` writes to Redis with TTL
3. `onNewEmail` callback fires → Socket.IO emits `new_email` to room `inbox:{address}`
4. Telegram notification sent via `src/telegram.js`

Browser clients join a room by emitting `watch` with an email address over Socket.IO.

### Admin panel (`/admin`)

- Served from `public/admin.html` (standalone SPA, no framework)
- All `/admin/api/*` endpoints require `X-Admin-Secret` header (timing-safe SHA-256 comparison)
- Provides: stats, API key management (list/delete/purge orphans), inbox viewer

## Environment variables

See `.env.example`. Key vars:

| Var | Required | Notes |
|-----|----------|-------|
| `ALLOWED_DOMAINS` | Yes | Comma-separated domains SMTP will accept |
| `JWT_SECRET` | Yes | User auth token signing |
| `ADMIN_SECRET` | Yes | `/admin` panel access (min 16 chars) |
| `REDIS_HOST/PORT/PASSWORD` | Yes | Redis connection |
| `TELEGRAM_BOT_TOKEN` | No | Optional notifications |
