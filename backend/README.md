# TimeBridge — Backend

REST API for **TimeBridge**, a web application that helps family members find
suitable times to communicate by sharing and comparing their schedules.

> Senior Design Project · Computer Science
> Author: **Aimaral Khaumyetbyek** · Repository for academic submission.

The companion frontend lives at [`../timebridge-frontend`](../timebridge-frontend).

---

## Tech stack

| Layer        | Choice                                |
| ------------ | ------------------------------------- |
| Runtime      | Node.js 18+                           |
| Framework    | Express 5                             |
| Database     | PostgreSQL 14+                        |
| Auth         | JWT (`jsonwebtoken`) + bcrypt hashing |
| Email        | Nodemailer (optional, for password reset) |
| Rate limit   | Hand-rolled in-memory limiter (see `server.js`) |

No ORM — queries are written as parameterised SQL against the `pg` driver.

---

## Quick start

```bash
git clone <repo>
cd timebridge-backend
npm install

# 1. Create the Postgres database
createdb TimeBridge
psql TimeBridge -f schema.sql      # if a schema dump is provided
                                   # (otherwise see "Database schema" below)

# 2. Configure environment
cp .env.example .env
$EDITOR .env                       # fill in PG password and JWT_SECRET

# 3. Run the server
node server.js                     # http://localhost:5050
```

The server prints `TimeBridge backend is running` and listens on `PORT`
(default `5050`).

### Hot-reload during development

Express does not hot-reload. For development, install nodemon once:

```bash
npm install -D nodemon
npx nodemon server.js
```

---

## Environment variables

All configuration goes through `.env` (loaded by `dotenv`). The full list lives
in `.env.example`. The most important entries:

| Variable           | Purpose                                           |
| ------------------ | ------------------------------------------------- |
| `PORT`             | HTTP port (default 5050)                          |
| `JWT_SECRET`       | Secret used to sign auth tokens — **change this** |
| `APP_URL`          | Where the frontend is served (used in reset-password emails) |
| `PGUSER`/`PGPASSWORD`/`PGHOST`/`PGPORT`/`PGDATABASE` | Postgres connection |
| `DATABASE_URL`     | Optional. If set, takes precedence over the PG\* vars |
| `DATABASE_SSL`     | `"true"` to use SSL (e.g. for hosted Postgres)    |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM` | Optional. If unset, password-reset links are printed to the server console instead of emailed. |

`.env` is in `.gitignore` and **must never be committed**.

---

## REST API

All `/me`, `/connections/*`, `/availability/*` and `/schedule*` routes require
an `Authorization: Bearer <jwt>` header.

| Method | Path                                  | Description |
| ------ | ------------------------------------- | ----------- |
| POST   | `/register`                           | Create account. Body: `name, email, password, timezone`. |
| POST   | `/login`                              | Returns `{ token, user }`. Rate-limited (10 / 15 min / IP). |
| POST   | `/forgot-password`                    | Sends (or logs) a reset link. Rate-limited (5 / hour / IP). |
| POST   | `/reset-password`                     | Body: `{ token, password }`. |
| GET    | `/me`                                 | Current user profile. |
| PUT    | `/me`                                 | Update profile (name, timezone). |
| DELETE | `/me`                                 | Delete account + all owned data. |
| POST   | `/change-password`                    | Change password (verifies current via bcrypt). |
| GET    | `/me/export`                          | Download your full data as one JSON file. |
| GET    | `/privacy`                            | Privacy settings (global + per-contact JSONB). |
| PUT    | `/privacy`                            | Upsert one privacy row. Body: `{ contact_id, settings }`. |
| POST   | `/2fa/setup`                          | Issues a fresh TOTP secret + `otpauth://` URL. |
| POST   | `/2fa/verify`                         | Verifies the user's first 6-digit code; sets `twofa_enabled`. |
| DELETE | `/2fa`                                | Disables 2FA. Body: `{ current_password }`. |
| GET    | `/integrations/google/status`         | Whether Google OAuth is configured + whether this user is connected. |
| GET    | `/integrations/google/connect`        | Returns `{ url }` to send the user to Google's consent screen. |
| GET    | `/integrations/google/callback`       | OAuth redirect target. Exchanges `code` for tokens. |
| POST   | `/integrations/google/import`         | Pulls the next 30 days of timed events into `schedule_blocks`. |
| DELETE | `/integrations/google`                | Removes stored Google tokens. |
| POST   | `/notes`                              | Send a note. Body: `{ to_user_id, body }`. Recipient must be a connection. |
| GET    | `/notes`                              | Inbox + sent. Marks unread inbox notes as read in the same call. |
| GET    | `/notes/unread-count`                 | Cheap count for the sidebar badge. |
| DELETE | `/notes/:id`                          | Delete a note. Sender or recipient. |
| POST   | `/connections/invite`                 | Generate a fresh 8-char invite code. |
| POST   | `/connections/join`                   | Accept an invite. Body: `{ invite_code }`. |
| GET    | `/connections`                        | List your connections (pending + accepted). |
| DELETE | `/connections/:id`                    | Revoke a pending invite, or unlink an accepted one. |
| GET    | `/connections/:otherId/availability`  | Other user's availability slots (if connected). |
| POST   | `/availability`                       | Replace your slots. Body: `{ slots: [iso, …] }`. |
| GET    | `/availability`                       | Your own slots. |
| GET    | `/availability/overlap`               | Slots where you and at least one connection are free. |
| GET    | `/availability/overlap?with=ID`       | Slots where you and *that specific* connection are free. |
| GET    | `/schedule`                           | Recurring weekly blocks. |
| POST   | `/schedule`                           | Add a block. |
| DELETE | `/schedule/:id`                       | Remove a block. |

All responses are JSON. Errors look like `{ "error": "<message>" }` with an
appropriate HTTP status.

---

## Database schema

Three core tables (DDL omitted for brevity — see migration files or use the
following sketch):

- **`users`** — `id, name, email UNIQUE, password_hash, timezone, city, country, created_at`
- **`connections`** — `id, user_id, connected_user_id NULL, invite_code UNIQUE,
  status ('pending' | 'accepted'), accepted_at NULL`
- **`availability`** — `id, user_id, start_time TIMESTAMPTZ` (one row per
  one-hour slot, stored as UTC ISO timestamps)
- **`schedule_blocks`** — `id, user_id, title, type, color, days TEXT[],
  start_time TIME, end_time TIME` (recurring weekly blocks; `days` are
  three-letter codes like `'Mon'`)
- **`password_resets`** — `id, user_id, token_hash, expires_at, used`
- **`privacy_settings`** — `id, user_id, contact_id NULL, settings JSONB,
  updated_at`. `contact_id NULL` = global default; non-null = override
  for that connection. Unique on `(user_id, contact_id)`.
- **`integrations`** — `id, user_id, provider, access_token, refresh_token,
  expires_at, scope, created_at`. Unique on `(user_id, provider)`. Stores
  third-party OAuth tokens (Google Calendar today). Tokens are stored in
  plain text in v1 — encryption-at-rest is on the v1.1 roadmap.
- **`notes`** — `id, from_user_id, to_user_id, body, created_at, read_at`.
  One-way short messages between accepted connections. Body capped at
  500 chars by the POST handler. Indexed by `(to_user_id, created_at DESC)`
  for the inbox query and by `(from_user_id, created_at DESC)` for sent.

The `users` table also gained `twofa_secret` (base32 string) and
`twofa_enabled` (boolean) for the TOTP enrollment flow.

---

## Security notes

- **Passwords** are hashed with bcrypt (cost 10).
- **Reset tokens** are random 32-byte hex; only the SHA-256 hash is stored.
- **Auth endpoints** (`/login`, `/register`, `/forgot-password`) are rate-limited
  per-IP via a small in-memory token bucket (see `rateLimit()` in `server.js`).
  This is sufficient for a single-process deployment; for horizontal scaling
  you would back the limiter by Redis.
- The forgot-password endpoint deliberately returns the same response whether
  or not the email exists, to avoid account enumeration.
- CORS is enabled with default settings (any origin) — fine for the demo,
  tighten for production.

---

## Known limitations

These are openly documented as future work:

1. ~~**Wall-clock schedule blocks.**~~ **Fixed in v1** — blocks are anchored
   to a `tzid` column; the front-end's `wallClockInTz` helper projects the
   current UTC instant into that zone for the active-block check.
2. **No email-send for invites.** The "Generate code" flow produces a code
   the user must share manually. (See report §Future Work for an SMTP-based
   delivery design.)
3. **CORS is wide-open** for development.
4. **No DB migrations tool** (e.g. Knex) — schema changes are manual but
   safe (every `ALTER TABLE` uses `ADD COLUMN IF NOT EXISTS`).
5. **No automated integration tests.** Unit tests exist on the frontend; a
   Supertest-based suite for the API is on the roadmap.
6. ~~**2FA enrollment ships, login challenge does not.**~~ **Fixed in v1** —
   `/login` now responds `{ twofa_required: true }` when the user has 2FA
   enabled, and the frontend re-submits with the code.
7. **Google Calendar two-way sync** — v1 ships *read-only* OAuth import
   (Settings → Integrations → Connect Google Calendar). Writing
   `schedule_blocks` back to Google is a different threat model and is
   deferred. Operator must set `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI`
   in `.env` to enable; until then the row reads "Setup required".
8. **Apple Calendar (CalDAV)** — deliberately not built. The only realistic
   path is asking users for their Apple ID app-specific password (poor
   security UX). The `.ics` export from Calendar.app already covers the
   common one-shot case and is documented inline in Settings.
9. **OAuth tokens stored in plain text** — `integrations.access_token` and
   `refresh_token` are not encrypted at rest in v1. Encryption-at-rest
   (with a key from `.env`) is on the v1.1 roadmap.
