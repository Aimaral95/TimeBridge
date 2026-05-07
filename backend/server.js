require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const crypto  = require("crypto");
const pool    = require("./db");
const bcrypt  = require("bcrypt");
const jwt     = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const authMiddleware = require("./authMiddleware");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5050;
const SECRET = process.env.JWT_SECRET || "secretkey";
const APP_URL = process.env.APP_URL || "http://localhost:5173"; // Vite dev URL by default
const RESET_TOKEN_TTL_MIN = 30; // minutes

/* ── helpers ─────────────────────────────── */
function generateCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function scheduleBlockKey(block, tzid) {
  const title = String(block?.title || "").trim().toLowerCase();
  const days = Array.isArray(block?.days)
    ? [...new Set(block.days)].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)).join(",")
    : "";
  return [
    title,
    days,
    block?.start_time || "",
    block?.end_time || "",
    tzid || block?.tzid || "",
  ].join("|");
}

/* ── rate limiter ──────────────────────────
   Lightweight, in-memory fixed-window rate limiter.

   Why not the popular `express-rate-limit` package? For a single-process
   educational deployment we don't need its store abstraction or redis
   support — a plain Map keyed by IP is enough, and writing it ourselves
   makes the security story easy to discuss in the report.

   Behaviour: each (key, route) bucket allows `max` requests per `windowMs`.
   When exhausted we return HTTP 429 with the standard Retry-After header.
   The bucket Map is pruned opportunistically on each call to keep it small.
*/
function rateLimit({ windowMs, max, label }) {
  const buckets = new Map(); // key -> { count, resetAt }
  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    // Express puts the client IP in req.ip; fall back to a constant so the
    // limiter still works behind a proxy that doesn't set X-Forwarded-For.
    const key = `${label}:${req.ip || "unknown"}`;

    // Opportunistic prune (cheap; bounded by buckets.size).
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: `Too many requests. Try again in ${retryAfter} seconds.`,
      });
    }
    next();
  };
}

// Tighter limit on auth endpoints to slow down brute-force attempts.
const loginLimiter   = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, label: "login"   });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max:  5, label: "register" });
const forgotLimiter  = rateLimit({ windowMs: 60 * 60 * 1000, max:  5, label: "forgot"  });

/* ── nodemailer transporter ─────────────────
   Configure via .env:
     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=587
     SMTP_USER=you@gmail.com
     SMTP_PASS=your-app-password   (gmail app password, not your real pwd)
     MAIL_FROM="TimeBridge <you@gmail.com>"
*/
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

async function sendResetEmail(to, link) {
  const t = getTransporter();
  if (!t) {
    // SMTP not configured — print to console so the demo still works.
    console.log("------ PASSWORD RESET (no SMTP configured) ------");
    console.log(`To: ${to}`);
    console.log(`Link: ${link}`);
    console.log("-------------------------------------------------");
    return;
  }
  await t.sendMail({
    from: process.env.MAIL_FROM || `TimeBridge <${process.env.SMTP_USER}>`,
    to,
    subject: "Reset your TimeBridge password",
    text:
`Hi,

Someone (hopefully you) asked to reset the password for your TimeBridge account.

Open this link to choose a new password (valid for ${RESET_TOKEN_TTL_MIN} minutes):
${link}

If you didn't request this, you can safely ignore this email.

— TimeBridge`,
    html:
`<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #eee;border-radius:8px">
  <h2 style="margin-top:0">Reset your TimeBridge password</h2>
  <p>Someone (hopefully you) asked to reset the password for your TimeBridge account.</p>
  <p style="margin:24px 0">
    <a href="${link}" style="background:#238636;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">
      Choose a new password
    </a>
  </p>
  <p style="font-size:12px;color:#666">This link is valid for ${RESET_TOKEN_TTL_MIN} minutes.</p>
  <p style="font-size:12px;color:#666">If you didn't request this, you can ignore this email.</p>
</div>`,
  });
}

/* ── ensure tables we depend on ──────────── */
async function ensureSchema() {
  // Best-effort: create the tables we need if they don't exist. This lets a
  // brand-new hosted Postgres database boot without a separate migration step.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      timezone      TEXT NOT NULL,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS connections (
      id                SERIAL PRIMARY KEY,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connected_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      invite_code       TEXT UNIQUE,
      status            TEXT NOT NULL DEFAULT 'pending',
      accepted_at       TIMESTAMP,
      created_at        TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS availability (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_time TIMESTAMP NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT    NOT NULL UNIQUE,
      expires_at  TIMESTAMP NOT NULL,
      used        BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_blocks (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT    NOT NULL,
      type       TEXT    NOT NULL DEFAULT 'other',
      color      TEXT,
      days       TEXT[]  NOT NULL,           -- e.g. ['Mon','Tue','Thu']
      start_time TIME    NOT NULL,
      end_time   TIME    NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  // For databases that already had schedule_blocks before these columns existed.
  await pool.query(`
    ALTER TABLE schedule_blocks
      ADD COLUMN IF NOT EXISTS color TEXT
  `);
  // tzid: IANA timezone the block is anchored to. Defaults to the creator's
  // current timezone at insert time. Stored so a block authored as "9 AM in
  // America/Los_Angeles" continues to mean exactly that even if the user
  // later moves to Europe/Paris (the previous wall-clock-only design would
  // have re-interpreted "09:00" as Paris-local time, which is wrong).
  await pool.query(`
    ALTER TABLE schedule_blocks
      ADD COLUMN IF NOT EXISTS tzid TEXT
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS city    TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT`);

  // 2FA columns. Stored on users; secret is the base32-encoded TOTP shared
  // secret. We deliberately don't enforce 2fa_enabled at login yet — see
  // "POST /2fa/verify" for the rationale.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_secret  TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_enabled BOOLEAN NOT NULL DEFAULT false`);

  // privacy_settings: one row per (user_id, contact_id). contact_id NULL means
  // "global default". `settings` is opaque JSON — the frontend owns the schema.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS privacy_settings (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id  INTEGER          REFERENCES users(id) ON DELETE CASCADE,
      settings    JSONB   NOT NULL,
      updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, contact_id)
    )
  `);

  // notes: small one-way messages between connected users. Sender writes,
  // recipient reads. read_at flips to NOW() the first time the recipient
  // pulls the inbox in a way that includes the note. Soft-deletable from
  // either side. Body capped at 500 chars by the POST handler.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id            SERIAL PRIMARY KEY,
      from_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body          TEXT    NOT NULL,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      read_at       TIMESTAMP
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notes_to_user ON notes (to_user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notes_from_user ON notes (from_user_id, created_at DESC)`);

  // integrations: third-party tokens (Google Calendar today; Outlook later).
  // We store both the access token (short-lived) and refresh token, so the
  // import endpoint can transparently refresh when calling the Calendar API.
  // Tokens are NOT encrypted at rest in v1 — see README known-limitations.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integrations (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider      TEXT    NOT NULL,
      access_token  TEXT    NOT NULL,
      refresh_token TEXT,
      expires_at    TIMESTAMP,
      scope         TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, provider)
    )
  `);
}
ensureSchema().catch(e => console.error("Schema init error:", e.message));

/* ── root ────────────────────────────────── */
app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ message: "TimeBridge backend is running", time: result.rows[0] });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Database connection failed" });
  }
});

/* ── auth ────────────────────────────────── */
app.post("/register", registerLimiter, async (req, res) => {
  try {
    const { name, email, password, timezone, city, country } = req.body;
    if (!name || !email || !password || !timezone)
      return res.status(400).json({ error: "All fields are required" });

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0)
      return res.status(400).json({ error: "Email already exists" });

    const hash = await bcrypt.hash(password, 10);
    // city / country are optional. Cap defensively at 80 chars each.
    const cleanCity    = (typeof city    === "string" && city.trim())    ? city.trim().slice(0, 80)    : null;
    const cleanCountry = (typeof country === "string" && country.trim()) ? country.trim().slice(0, 80) : null;

    const user = await pool.query(
      `INSERT INTO users (name, email, password_hash, timezone, city, country)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, timezone, city, country, created_at`,
      [name, email, hash, timezone, cleanCity, cleanCountry]
    );
    res.json({ message: "User registered", user: user.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password, twofa_code } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0)
      return res.status(401).json({ error: "Invalid email or password" });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: "Invalid email or password" });

    // 2FA gate: if the user enabled it, the password alone is not enough.
    // We respond 200 OK with twofa_required:true so the client can show a
    // code input and re-submit. We deliberately don't issue a JWT yet — the
    // user is only "half-authenticated" until the TOTP succeeds.
    //
    // Note: _verifyTotp is defined further down the file but hoisted via
    // function declaration, so it's callable here.
    if (user.twofa_enabled && user.twofa_secret) {
      if (!twofa_code) {
        return res.status(200).json({ twofa_required: true });
      }
      if (!_verifyTotp(user.twofa_secret, twofa_code)) {
        return res.status(401).json({ error: "Invalid 2FA code" });
      }
    }

    const token = jwt.sign({ userId: user.id }, SECRET, { expiresIn: "7d" });
    res.json({
      token,
      // Include city + country so the Dashboard weather hero has somewhere to
      // pull location from on the very first render after login (instead of
      // waiting for /me to round-trip).
      user: {
        id: user.id, name: user.name, email: user.email,
        timezone: user.timezone, city: user.city, country: user.country,
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── password reset ──────────────────────── */
app.post("/forgot-password", forgotLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });

    const u = await pool.query("SELECT id, email FROM users WHERE email = $1", [email]);
    // Always respond the same so we don't leak which emails exist.
    if (u.rows.length > 0) {
      const user = u.rows[0];
      const rawToken  = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expires   = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000);

      await pool.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, tokenHash, expires]
      );

      const link = `${APP_URL}/reset-password/${rawToken}`;
      try {
        await sendResetEmail(user.email, link);
      } catch (mailErr) {
        console.error("sendResetEmail failed:", mailErr.message);
      }
    }

    res.json({
      message:
        "If an account with that email exists, a reset link has been sent. Check your inbox.",
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password)
      return res.status(400).json({ error: "Token and password are required" });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const r = await pool.query(
      `SELECT * FROM password_resets
       WHERE token_hash = $1 AND used = false AND expires_at > NOW()`,
      [tokenHash]
    );
    if (r.rows.length === 0)
      return res.status(400).json({ error: "Invalid or expired reset link" });

    const reset = r.rows[0];
    const newHash = await bcrypt.hash(password, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, reset.user_id]);
    await pool.query("UPDATE password_resets SET used = true WHERE id = $1", [reset.id]);

    res.json({ message: "Password reset. You can now sign in." });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── profile ─────────────────────────────── */
app.get("/me", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, name, email, timezone, city, country, created_at FROM users WHERE id = $1",
      [req.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json({ user: r.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/me", authMiddleware, async (req, res) => {
  try {
    const { name, timezone, city, country } = req.body;
    if (!name || !timezone)
      return res.status(400).json({ error: "Name and timezone are required" });

    // city / country are optional; pass null to clear, omit to leave unchanged.
    // We use COALESCE so undefined client-side fields don't blow away saved values.
    const cleanCity    = city    === undefined ? undefined :
                         (typeof city    === "string" && city.trim())    ? city.trim().slice(0, 80)    : null;
    const cleanCountry = country === undefined ? undefined :
                         (typeof country === "string" && country.trim()) ? country.trim().slice(0, 80) : null;

    const r = await pool.query(
      `UPDATE users
          SET name     = $1,
              timezone = $2,
              city     = COALESCE($3, city),
              country  = COALESCE($4, country)
        WHERE id = $5
        RETURNING id, name, email, timezone, city, country, created_at`,
      [name, timezone, cleanCity, cleanCountry, req.userId]
    );
    res.json({ message: "Profile updated", user: r.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/me", authMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM availability WHERE user_id = $1", [req.userId]);
    await pool.query(
      "DELETE FROM connections WHERE user_id = $1 OR connected_user_id = $1",
      [req.userId]
    );
    await pool.query("DELETE FROM users WHERE id = $1", [req.userId]);
    res.json({ message: "Account deleted" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── change password (authed, no email round-trip) ────────────
   Distinct from /reset-password (which needs an emailed token).
   Verifies the current password before allowing the change. */
app.post("/change-password", authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password)
      return res.status(400).json({ error: "current_password and new_password are required" });
    if (new_password.length < 6)
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    if (current_password === new_password)
      return res.status(400).json({ error: "New password must differ from current password" });

    const u = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.userId]);
    if (u.rows.length === 0) return res.status(404).json({ error: "User not found" });

    const ok = await bcrypt.compare(current_password, u.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    const newHash = await bcrypt.hash(new_password, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, req.userId]);
    res.json({ message: "Password updated" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── data export ───────────────────────────
   Returns one JSON document with everything the user owns. The frontend
   triggers a file download from this endpoint. Useful for GDPR-style
   "give me my data" requests, and a small but visible feature for the demo. */
app.get("/me/export", authMiddleware, async (req, res) => {
  try {
    const [me, blocks, slots, conns, privacy] = await Promise.all([
      pool.query(
        "SELECT id, name, email, timezone, city, country, created_at FROM users WHERE id = $1",
        [req.userId]
      ),
      pool.query(
        `SELECT id, title, type, color, days, tzid,
                to_char(start_time,'HH24:MI') AS start_time,
                to_char(end_time,'HH24:MI')   AS end_time,
                created_at
           FROM schedule_blocks WHERE user_id = $1`,
        [req.userId]
      ),
      pool.query(
        "SELECT start_time FROM availability WHERE user_id = $1 ORDER BY start_time",
        [req.userId]
      ),
      pool.query(
        `SELECT id, user_id, connected_user_id, invite_code, status, accepted_at
           FROM connections
          WHERE user_id = $1 OR connected_user_id = $1`,
        [req.userId]
      ),
      pool.query(
        "SELECT contact_id, settings, updated_at FROM privacy_settings WHERE user_id = $1",
        [req.userId]
      ),
    ]);

    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Content-Disposition",
      `attachment; filename="timebridge-export-${new Date().toISOString().slice(0,10)}.json"`);
    res.json({
      exported_at: new Date().toISOString(),
      app:         "TimeBridge",
      version:     "1.0.0",
      profile:     me.rows[0] || null,
      schedule_blocks: blocks.rows,
      availability:    slots.rows.map(r => r.start_time),
      connections:     conns.rows,
      privacy_settings: privacy.rows,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── privacy settings ──────────────────────
   Schema choice: one (user_id, contact_id) row holds an opaque JSONB blob.
   contact_id NULL means the user's global default; non-null means an
   override for one specific connection. The frontend owns the JSON shape
   so we don't have to migrate the DB every time the UI grows a new
   toggle. */
app.get("/privacy", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT contact_id, settings FROM privacy_settings WHERE user_id = $1",
      [req.userId]
    );
    // Reshape into { global: {...}, perContact: { [id]: {...} } } for the UI.
    let global = null;
    const perContact = {};
    for (const row of r.rows) {
      if (row.contact_id == null) global = row.settings;
      else perContact[row.contact_id] = row.settings;
    }
    res.json({ global, perContact });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/privacy", authMiddleware, async (req, res) => {
  try {
    const { contact_id, settings } = req.body || {};
    if (settings == null || typeof settings !== "object")
      return res.status(400).json({ error: "settings (object) is required" });

    // contact_id may be null (global default) or a positive integer (override).
    const cid = contact_id == null ? null : Number(contact_id);
    if (cid != null && (!Number.isInteger(cid) || cid <= 0))
      return res.status(400).json({ error: "contact_id must be a positive integer or null" });

    // Upsert. We store JSONB so PG can validate the shape.
    await pool.query(
      `INSERT INTO privacy_settings (user_id, contact_id, settings, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (user_id, contact_id)
         DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
      [req.userId, cid, JSON.stringify(settings)]
    );
    res.json({ message: "Saved" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── 2FA (TOTP / RFC 6238) ─────────────────
   Hand-rolled TOTP rather than a library, so the report can show the
   exact mechanism. Behaviour:
     POST /2fa/setup   → generates a fresh secret + otpauth:// URL
                          (does NOT enable 2FA yet — must verify first)
     POST /2fa/verify  → user supplies the 6-digit code from their app;
                          on success twofa_enabled flips to true
     DELETE /2fa       → disable + erase the secret (requires current password)

   IMPORTANT — *not enforced at login*: the login endpoint above does NOT
   yet require the second factor. Enrollment + storage works end-to-end
   and is callable from the UI for the demo, but the actual login-time
   challenge is intentionally deferred to v1.1 so we don't risk breaking
   the demo flow on submission day. The backend column twofa_enabled is
   in place for the v1.1 enforcement to plug into without a migration. */
function _b32encode(buf) {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function _b32decode(s) {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  s = s.toUpperCase().replace(/=+$/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function _hotp(secretBuf, counter) {
  // RFC 4226 — HMAC-SHA1, dynamic truncation.
  const buf = Buffer.alloc(8);
  // counter is < 2^53; write as big-endian 64-bit.
  for (let i = 7; i >= 0; i--) { buf[i] = counter & 0xff; counter = Math.floor(counter / 256); }
  const hmac = crypto.createHmac("sha1", secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) <<  8) |
    ( hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}
function _verifyTotp(secretB32, code, { window = 1, step = 30, t0 = 0 } = {}) {
  if (!/^\d{6}$/.test(String(code))) return false;
  const counter = Math.floor((Date.now() / 1000 - t0) / step);
  const buf = _b32decode(secretB32);
  for (let w = -window; w <= window; w++) {
    if (_hotp(buf, counter + w) === String(code)) return true;
  }
  return false;
}

app.post("/2fa/setup", authMiddleware, async (req, res) => {
  try {
    // Fresh 20-byte secret (RFC 4226 minimum is 16; 20 = SHA1 block size).
    const secretBuf = crypto.randomBytes(20);
    const secret    = _b32encode(secretBuf);

    // Don't enable yet — only after the user verifies a code from their app.
    await pool.query(
      "UPDATE users SET twofa_secret = $1, twofa_enabled = false WHERE id = $2",
      [secret, req.userId]
    );
    const u = await pool.query("SELECT email FROM users WHERE id = $1", [req.userId]);
    const label = encodeURIComponent(`TimeBridge:${u.rows[0]?.email || "user"}`);
    const issuer = encodeURIComponent("TimeBridge");
    const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
    res.json({ secret, otpauth });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/2fa/verify", authMiddleware, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "code is required" });
    const u = await pool.query("SELECT twofa_secret FROM users WHERE id = $1", [req.userId]);
    const secret = u.rows[0]?.twofa_secret;
    if (!secret) return res.status(400).json({ error: "Run /2fa/setup first" });
    if (!_verifyTotp(secret, code)) return res.status(400).json({ error: "Invalid code" });
    await pool.query("UPDATE users SET twofa_enabled = true WHERE id = $1", [req.userId]);
    res.json({ message: "2FA enabled" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/2fa", authMiddleware, async (req, res) => {
  try {
    const { current_password } = req.body || {};
    if (!current_password) return res.status(400).json({ error: "current_password is required" });
    const u = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.userId]);
    const ok = u.rows[0] && await bcrypt.compare(current_password, u.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });
    await pool.query("UPDATE users SET twofa_secret = NULL, twofa_enabled = false WHERE id = $1", [req.userId]);
    res.json({ message: "2FA disabled" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── Google Calendar integration (OAuth 2.0) ─────────────────────────
   Implements one-shot read-only import of a Google account's primary
   calendar into TimeBridge as recurring weekly schedule_blocks.

   Setup (per the README): the operator must
     1. Create a Google Cloud Project
     2. Enable the Google Calendar API
     3. Create OAuth 2.0 client (Web application)
     4. Add http://localhost:5050/integrations/google/callback as a redirect URI
     5. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI in .env

   When env vars are missing, /integrations/google/connect returns
   { configured: false, ... } so the UI can show a clear "Setup required"
   state instead of attempting a broken redirect.

   Token storage: we keep both the access token (short-lived) and the
   refresh token so /integrations/google/import can renew transparently.
   v1 does NOT encrypt tokens at rest — documented in known-limitations.

   Note: Node 18+ has built-in `fetch`, so no extra npm dep is needed. */

const GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_API_BASE  = "https://www.googleapis.com/calendar/v3";
const GOOGLE_SCOPE     = "https://www.googleapis.com/auth/calendar.readonly";

function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

function googleAuthUrl(stateToken) {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id",     process.env.GOOGLE_CLIENT_ID);
  u.searchParams.set("redirect_uri",  process.env.GOOGLE_REDIRECT_URI);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope",         GOOGLE_SCOPE);
  u.searchParams.set("access_type",   "offline");
  u.searchParams.set("prompt",        "consent");
  u.searchParams.set("state",         stateToken);
  return u.toString();
}

/* Exchange an authorization code for tokens. */
async function googleExchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
    grant_type:    "authorization_code",
  });
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Google token exchange failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/* Refresh an expired access token. */
async function googleRefresh(refreshToken) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type:    "refresh_token",
  });
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Google token refresh failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/* Step 1 — frontend asks "where do I send the user?" */
app.get("/integrations/google/connect", authMiddleware, (req, res) => {
  if (!googleConfigured()) {
    return res.json({
      configured: false,
      message:
        "Google Calendar OAuth not configured. The operator must set " +
        "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env. " +
        "See README → Integrations.",
    });
  }
  // The state param is signed with our JWT secret so the callback can verify
  // it came from a TimeBridge-initiated request and identify which user.
  const state = jwt.sign({ uid: req.userId, t: Date.now() }, SECRET, { expiresIn: "10m" });
  res.json({ configured: true, url: googleAuthUrl(state) });
});

/* Step 2 — Google redirects the browser back here with ?code=...&state=... */
app.get("/integrations/google/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query || {};
    if (error) {
      return res.redirect(`${APP_URL}/settings?google=denied`);
    }
    if (!code || !state) return res.status(400).send("Missing code or state");
    let payload;
    try { payload = jwt.verify(state, SECRET); }
    catch { return res.status(400).send("Invalid or expired state"); }
    const userId = payload.uid;

    const tokens = await googleExchangeCode(code);
    // tokens = { access_token, refresh_token, scope, token_type, expires_in, id_token }
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + Number(tokens.expires_in) * 1000)
      : null;
    await pool.query(
      `INSERT INTO integrations (user_id, provider, access_token, refresh_token, expires_at, scope)
       VALUES ($1, 'google', $2, $3, $4, $5)
       ON CONFLICT (user_id, provider)
         DO UPDATE SET access_token = EXCLUDED.access_token,
                       refresh_token = COALESCE(EXCLUDED.refresh_token, integrations.refresh_token),
                       expires_at    = EXCLUDED.expires_at,
                       scope         = EXCLUDED.scope`,
      [userId, tokens.access_token, tokens.refresh_token || null, expiresAt, tokens.scope || GOOGLE_SCOPE]
    );
    // Bounce back to the settings screen with a success flag.
    res.redirect(`${APP_URL}/settings?google=connected`);
  } catch (err) {
    console.error("google callback error:", err.message);
    res.redirect(`${APP_URL}/settings?google=error&msg=${encodeURIComponent(err.message)}`);
  }
});

/* Read the user's stored Google integration row, refreshing if needed. */
async function getValidGoogleAccessToken(userId) {
  const r = await pool.query(
    "SELECT access_token, refresh_token, expires_at FROM integrations WHERE user_id = $1 AND provider = 'google'",
    [userId]
  );
  if (r.rows.length === 0) throw new Error("Google not connected");
  const row = r.rows[0];
  const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now() + 30_000; // 30s slack
  if (!expired) return row.access_token;
  if (!row.refresh_token) throw new Error("Access token expired and no refresh token on file. Reconnect Google.");
  const t = await googleRefresh(row.refresh_token);
  const expiresAt = t.expires_in ? new Date(Date.now() + Number(t.expires_in) * 1000) : null;
  await pool.query(
    "UPDATE integrations SET access_token = $1, expires_at = $2 WHERE user_id = $3 AND provider = 'google'",
    [t.access_token, expiresAt, userId]
  );
  return t.access_token;
}

/* Step 3 — frontend asks the backend to fetch events and convert them to
   schedule_blocks. We import only events from the next 30 days, only timed
   events (no all-day), and group identical title+time events into a single
   weekly recurring block. This mirrors what the .ics importer does. */
app.post("/integrations/google/import", authMiddleware, async (req, res) => {
  try {
    if (!googleConfigured()) {
      return res.status(400).json({ error: "Google integration not configured on this server." });
    }
    const accessToken = await getValidGoogleAccessToken(req.userId);

    const now = new Date();
    const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const url = new URL(`${GOOGLE_API_BASE}/calendars/primary/events`);
    url.searchParams.set("timeMin",      now.toISOString());
    url.searchParams.set("timeMax",      horizon.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy",      "startTime");
    url.searchParams.set("maxResults",   "250");

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({ error: `Google Calendar API: ${r.status} ${text.slice(0, 200)}` });
    }
    const data = await r.json();

    // Get the user's tzid for anchoring blocks.
    const u = await pool.query("SELECT timezone FROM users WHERE id = $1", [req.userId]);
    const userTz = u.rows[0]?.timezone || "UTC";
    const existingRows = await pool.query(
      `SELECT title, days, tzid,
              to_char(start_time,'HH24:MI') AS start_time,
              to_char(end_time,'HH24:MI')   AS end_time
         FROM schedule_blocks
        WHERE user_id = $1`,
      [req.userId]
    );
    const existingKeys = new Set(
      existingRows.rows.map(row => scheduleBlockKey(row, row.tzid || userTz))
    );

    // Group events by (title, start_HHmm, end_HHmm); each unique key becomes
    // ONE recurring block whose `days` is the union of weekdays seen.
    const dayKey = (d) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
    const grouped = new Map();
    for (const ev of (data.items || [])) {
      // Skip all-day events (date-only, no dateTime).
      if (!ev.start?.dateTime || !ev.end?.dateTime) continue;
      const s = new Date(ev.start.dateTime);
      const e = new Date(ev.end.dateTime);
      const hh = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      const startStr = hh(s);
      const endStr   = hh(e);
      // Skip events that span midnight — we only model intra-day blocks.
      if (s.toDateString() !== e.toDateString()) continue;
      const title = (ev.summary || 'Imported event').slice(0, 100);
      const key = `${title}|${startStr}|${endStr}`;
      if (!grouped.has(key)) grouped.set(key, { title, start_time: startStr, end_time: endStr, daySet: new Set() });
      grouped.get(key).daySet.add(dayKey(s));
    }

    let imported = 0;
    let skipped_duplicates = 0;
    for (const v of grouped.values()) {
      const days = Array.from(v.daySet);
      const key = scheduleBlockKey({
        title: v.title,
        days,
        start_time: v.start_time,
        end_time: v.end_time,
      }, userTz);
      if (existingKeys.has(key)) {
        skipped_duplicates += 1;
        continue;
      }

      await pool.query(
        `INSERT INTO schedule_blocks (user_id, title, type, color, days, start_time, end_time, tzid)
         VALUES ($1, $2, 'imported', '#58a6ff', $3, $4, $5, $6)`,
        [req.userId, v.title, days, v.start_time, v.end_time, userTz]
      );
      existingKeys.add(key);
      imported += 1;
    }
    res.json({ imported, skipped_duplicates, total_events: (data.items || []).length });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

/* Status — does this user have Google connected? */
app.get("/integrations/google/status", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT created_at FROM integrations WHERE user_id = $1 AND provider = 'google'",
      [req.userId]
    );
    res.json({
      configured: googleConfigured(),
      connected: r.rows.length > 0,
      connected_at: r.rows[0]?.created_at || null,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* Disconnect — drop the stored tokens. */
app.delete("/integrations/google", authMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM integrations WHERE user_id = $1 AND provider = 'google'", [req.userId]);
    res.json({ message: "Google disconnected" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── notes (small messages between connected users) ──────────────────
   Design choices:
     - One-way (send / receive) not threaded — the demo's call-to-action
       is "leave Mom a note" not "have a chat" (use Slack for that).
     - Recipient must already be an *accepted* connection (no cold-DM).
     - Body capped at 500 chars to keep the UX brief and the column small.
     - read_at is set on the first inbox fetch that returns the note, so
       we don't need a separate "open this note" call. */

const NOTE_MAX_LEN = 500;

/* Helper: are users a and b accepted-connected, in either direction? */
async function _areConnected(a, b) {
  const r = await pool.query(
    `SELECT 1 FROM connections
       WHERE status = 'accepted'
         AND ((user_id = $1 AND connected_user_id = $2)
           OR (user_id = $2 AND connected_user_id = $1))
       LIMIT 1`,
    [a, b]
  );
  return r.rows.length > 0;
}

/* POST /notes  — body: { to_user_id, body } */
app.post("/notes", authMiddleware, async (req, res) => {
  try {
    const to = Number(req.body?.to_user_id);
    const body = (req.body?.body ?? "").toString().trim();
    if (!Number.isInteger(to) || to <= 0) return res.status(400).json({ error: "to_user_id is required" });
    if (to === req.userId)                  return res.status(400).json({ error: "Cannot send a note to yourself" });
    if (!body)                              return res.status(400).json({ error: "Note body cannot be empty" });
    if (body.length > NOTE_MAX_LEN)         return res.status(400).json({ error: `Note must be ${NOTE_MAX_LEN} characters or fewer` });

    const ok = await _areConnected(req.userId, to);
    if (!ok) return res.status(403).json({ error: "You are not connected with that user" });

    const r = await pool.query(
      `INSERT INTO notes (from_user_id, to_user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, from_user_id, to_user_id, body, created_at, read_at`,
      [req.userId, to, body]
    );
    res.json({ message: "Note sent", note: r.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* GET /notes — returns { inbox: [...], sent: [...] } and marks all
   currently-unread inbox notes as read in the same call. The frontend
   relies on this to clear the unread badge as soon as the page renders. */
app.get("/notes", authMiddleware, async (req, res) => {
  try {
    const inbox = await pool.query(
      `SELECT n.id, n.from_user_id, n.to_user_id, n.body, n.created_at, n.read_at,
              u.name AS from_name, u.email AS from_email
         FROM notes n
         JOIN users u ON u.id = n.from_user_id
        WHERE n.to_user_id = $1
        ORDER BY n.created_at DESC
        LIMIT 100`,
      [req.userId]
    );
    const sent = await pool.query(
      `SELECT n.id, n.from_user_id, n.to_user_id, n.body, n.created_at, n.read_at,
              u.name AS to_name, u.email AS to_email
         FROM notes n
         JOIN users u ON u.id = n.to_user_id
        WHERE n.from_user_id = $1
        ORDER BY n.created_at DESC
        LIMIT 100`,
      [req.userId]
    );

    // Auto-mark unread inbox notes as read so the badge clears. We capture
    // the previous unread count first so the response can tell the UI how
    // many were "new this fetch" — useful for a "1 new note" toast.
    const unread_before = inbox.rows.filter(n => n.read_at == null).length;
    if (unread_before > 0) {
      await pool.query(
        "UPDATE notes SET read_at = NOW() WHERE to_user_id = $1 AND read_at IS NULL",
        [req.userId]
      );
    }

    res.json({ inbox: inbox.rows, sent: sent.rows, unread_before });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* GET /notes/unread-count — cheap call for the sidebar badge. */
app.get("/notes/unread-count", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT COUNT(*)::int AS n FROM notes WHERE to_user_id = $1 AND read_at IS NULL",
      [req.userId]
    );
    res.json({ count: r.rows[0]?.n || 0 });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* DELETE /notes/:id — sender or recipient may delete. */
app.delete("/notes/:id", authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Bad id" });
    const r = await pool.query(
      `DELETE FROM notes
         WHERE id = $1
           AND (from_user_id = $2 OR to_user_id = $2)`,
      [id, req.userId]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "Note not found" });
    res.json({ message: "Note deleted" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── connections ─────────────────────────── */
app.post("/connections/invite", authMiddleware, async (req, res) => {
  try {
    const code = generateCode();
    const r = await pool.query(
      `INSERT INTO connections (user_id, invite_code, status)
       VALUES ($1, $2, 'pending') RETURNING *`,
      [req.userId, code]
    );
    res.json({ message: "Invite created", connection: r.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/connections/join", authMiddleware, async (req, res) => {
  try {
    const { invite_code } = req.body;
    if (!invite_code) return res.status(400).json({ error: "Invite code is required" });

    // Normalise the code so leading/trailing whitespace and case differences
    // (a common copy-paste failure) don't yield a false "Invalid invite code".
    const code = String(invite_code).trim().toUpperCase();

    const cr = await pool.query("SELECT * FROM connections WHERE invite_code = $1", [code]);
    if (cr.rows.length === 0) return res.status(404).json({ error: "Invalid invite code" });

    const conn = cr.rows[0];
    if (conn.status === "accepted") return res.status(400).json({ error: "This code has already been used" });
    if (conn.user_id === req.userId) return res.status(400).json({ error: "Cannot join your own invite" });

    // Already connected? If a previous accepted row exists between these two
    // users (e.g. they removed-and-re-invited), don't create a duplicate.
    // Instead, delete the new pending row and return the existing connection.
    // This is what the user expected when they reported "deleted then couldn't
    // reconnect" — the prior delete had failed silently somewhere upstream
    // and the new join was bouncing off duplicate-row weirdness.
    const existing = await pool.query(
      `SELECT * FROM connections
         WHERE status = 'accepted'
           AND ((user_id = $1 AND connected_user_id = $2)
             OR (user_id = $2 AND connected_user_id = $1))
         LIMIT 1`,
      [req.userId, conn.user_id]
    );
    if (existing.rows.length > 0) {
      await pool.query("DELETE FROM connections WHERE id = $1", [conn.id]);
      return res.json({
        message: "Already connected — the new code was discarded.",
        connection: existing.rows[0],
        already_connected: true,
      });
    }

    const upd = await pool.query(
      `UPDATE connections
       SET connected_user_id = $1, status = 'accepted', accepted_at = NOW()
       WHERE invite_code = $2 RETURNING *`,
      [req.userId, code]
    );
    res.json({ message: "Connected successfully", connection: upd.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* Delete a connection.
   - For pending invites you created: revokes the code so it can no longer be joined.
   - For accepted connections: removes the link on both sides.
   Either user in an accepted connection can remove it. */
app.delete("/connections/:id", authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid connection id" });

    const r = await pool.query("SELECT * FROM connections WHERE id = $1", [id]);
    if (r.rows.length === 0)
      return res.status(404).json({ error: "Connection not found" });

    const c = r.rows[0];

    if (c.status === "pending") {
      // Only the inviter can revoke their own pending code.
      if (c.user_id !== req.userId)
        return res.status(403).json({ error: "Only the inviter can revoke this code" });
    } else {
      // Either side can remove an accepted connection.
      if (c.user_id !== req.userId && c.connected_user_id !== req.userId)
        return res.status(403).json({ error: "Not your connection" });
    }

    await pool.query("DELETE FROM connections WHERE id = $1", [id]);
    res.json({ message: "Connection removed", id });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/connections", authMiddleware, async (req, res) => {
  try {
    // Return connections AND the other user's basic profile so the frontend
    // can show names without an extra round-trip.
    const r = await pool.query(
      `SELECT c.*,
              u.id   AS other_id,
              u.name AS other_name,
              u.email AS other_email,
              u.timezone AS other_timezone,
              u.city     AS other_city,
              u.country  AS other_country
         FROM connections c
         LEFT JOIN users u
           ON u.id = CASE
                       WHEN c.user_id = $1 THEN c.connected_user_id
                       ELSE c.user_id
                     END
        WHERE c.user_id = $1 OR c.connected_user_id = $1`,
      [req.userId]
    );
    res.json({ connections: r.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* Fetch a connected user's availability slots. Only allowed if you have
   an accepted connection with that user. */
app.get("/connections/:otherId/availability", authMiddleware, async (req, res) => {
  try {
    const otherId = Number(req.params.otherId);
    if (!otherId) return res.status(400).json({ error: "Invalid user id" });

    const conn = await pool.query(
      `SELECT 1 FROM connections
        WHERE status = 'accepted'
          AND ((user_id = $1 AND connected_user_id = $2)
            OR (user_id = $2 AND connected_user_id = $1))
        LIMIT 1`,
      [req.userId, otherId]
    );
    if (conn.rows.length === 0)
      return res.status(403).json({ error: "Not connected with that user" });

    const a = await pool.query(
      "SELECT start_time FROM availability WHERE user_id = $1 ORDER BY start_time",
      [otherId]
    );
    res.json({
      user_id: otherId,
      slots: a.rows.map(r => new Date(r.start_time).toISOString()),
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── availability ────────────────────────── */
app.post("/availability", authMiddleware, async (req, res) => {
  try {
    const { slots } = req.body;
    if (!slots || !Array.isArray(slots))
      return res.status(400).json({ error: "Slots array required" });

    await pool.query("DELETE FROM availability WHERE user_id = $1", [req.userId]);
    for (const slot of slots) {
      await pool.query(
        "INSERT INTO availability (user_id, start_time) VALUES ($1, $2)",
        [req.userId, slot]
      );
    }
    res.json({ message: "Availability updated", count: slots.length });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/availability", authMiddleware, async (req, res) => {
  try {
    const a = await pool.query(
      "SELECT start_time FROM availability WHERE user_id = $1 ORDER BY start_time",
      [req.userId]
    );
    res.json({ slots: a.rows.map(r => new Date(r.start_time).toISOString()) });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/availability/overlap", authMiddleware, async (req, res) => {
  try {
    // Accept ?with=otherUserId to scope overlap to one specific connection.
    // Without it, return per-connection overlaps for every accepted connection.
    const withParam = req.query.with ? Number(req.query.with) : null;

    // Pull all accepted connections + the other user's basic info.
    const connR = await pool.query(
      `SELECT
          CASE WHEN c.user_id = $1 THEN c.connected_user_id ELSE c.user_id END AS other_id,
          u.name AS other_name, u.timezone AS other_timezone
         FROM connections c
         JOIN users u
           ON u.id = CASE WHEN c.user_id = $1 THEN c.connected_user_id ELSE c.user_id END
        WHERE (c.user_id = $1 OR c.connected_user_id = $1)
          AND c.status = 'accepted'`,
      [req.userId]
    );

    if (connR.rows.length === 0)
      return res.status(404).json({ error: "No accepted connection found" });

    const mine = await pool.query(
      "SELECT start_time FROM availability WHERE user_id = $1 ORDER BY start_time",
      [req.userId]
    );
    const mySlots = mine.rows.map(r => new Date(r.start_time).toISOString());
    const mySet = new Set(mySlots);

    // If a specific user is requested, compute overlap only with them.
    if (withParam) {
      const target = connR.rows.find(r => Number(r.other_id) === withParam);
      if (!target) return res.status(404).json({ error: "Not connected to that user" });

      const other = await pool.query(
        "SELECT start_time FROM availability WHERE user_id = $1 ORDER BY start_time",
        [withParam]
      );
      const otherSlots = new Set(other.rows.map(r => new Date(r.start_time).toISOString()));
      const overlaps = mySlots.filter(s => otherSlots.has(s));

      // Backwards compatible shape (top-level `overlaps`) + richer per-connection block.
      return res.json({
        overlaps,
        with: {
          id: target.other_id,
          name: target.other_name,
          timezone: target.other_timezone,
          overlaps,
        },
      });
    }

    // No `with` filter — fan out across every accepted connection.
    const perConnection = [];
    const everyoneFreeCount = new Map(mySlots.map(s => [s, 1])); // me always counted

    for (const row of connR.rows) {
      const other = await pool.query(
        "SELECT start_time FROM availability WHERE user_id = $1 ORDER BY start_time",
        [row.other_id]
      );
      const otherSlots = new Set(other.rows.map(r => new Date(r.start_time).toISOString()));
      const overlaps = mySlots.filter(s => otherSlots.has(s));
      for (const s of overlaps) {
        everyoneFreeCount.set(s, (everyoneFreeCount.get(s) || 0) + 1);
      }
      perConnection.push({
        id: row.other_id,
        name: row.other_name,
        timezone: row.other_timezone,
        overlaps,
      });
    }

    // Slots where me + every connection is free.
    const fullCount = connR.rows.length + 1;
    const overlapsAll = mySlots.filter(s => everyoneFreeCount.get(s) === fullCount);

    // Backwards compat: top-level `overlaps` is the union of all pairwise overlaps,
    // matching the old "any family member can join" semantics the frontend used.
    const anyOverlap = mySlots.filter(s => (everyoneFreeCount.get(s) || 0) > 1);

    res.json({
      overlaps: anyOverlap,
      overlapsAll,
      perConnection,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── schedule (recurring weekly blocks) ──── */
app.get("/schedule", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, title, type, color, days, tzid,
              to_char(start_time,'HH24:MI') AS start_time,
              to_char(end_time,'HH24:MI')   AS end_time
         FROM schedule_blocks
        WHERE user_id = $1
        ORDER BY start_time`,
      [req.userId]
    );
    res.json({ blocks: r.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/schedule", authMiddleware, async (req, res) => {
  try {
    const { title, type, color, days, start_time, end_time, tzid } = req.body || {};
    if (!title || !Array.isArray(days) || days.length === 0 || !start_time || !end_time)
      return res.status(400).json({ error: "title, days[], start_time, end_time are required" });

    // type is now an arbitrary user-supplied label (e.g. "Yoga", "Tutoring").
    // color is an optional hex string from the palette picker.
    const cleanType  = (typeof type  === "string" && type.trim())  ? type.trim().slice(0, 40)  : "other";
    const cleanColor = (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) ? color : null;

    // tzid: prefer the value the client explicitly sent; otherwise fall back
    // to the user's saved timezone. Capped defensively at 64 chars (longest
    // legitimate IANA name is ~32 chars; anything bigger is suspicious).
    let cleanTzid = (typeof tzid === "string" && tzid.trim()) ? tzid.trim().slice(0, 64) : null;
    if (!cleanTzid) {
      const u = await pool.query("SELECT timezone FROM users WHERE id = $1", [req.userId]);
      cleanTzid = u.rows[0]?.timezone || "UTC";
    }

    const r = await pool.query(
      `INSERT INTO schedule_blocks (user_id, title, type, color, days, start_time, end_time, tzid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, type, color, days, tzid,
                 to_char(start_time,'HH24:MI') AS start_time,
                 to_char(end_time,'HH24:MI')   AS end_time`,
      [req.userId, title, cleanType, cleanColor, days, start_time, end_time, cleanTzid]
    );
    res.json({ message: "Block added", block: r.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/schedule/:id", authMiddleware, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM schedule_blocks WHERE id = $1 AND user_id = $2",
      [req.params.id, req.userId]
    );
    res.json({ message: "Block removed" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── nudge (stub — extend with WebSockets/FCM) ── */
app.post("/nudge", authMiddleware, async (req, res) => {
  try {
    const { to, msg } = req.body;
    // In production: look up recipient, send push notification via FCM
    console.log(`Nudge from user ${req.userId} to ${to}: ${msg}`);
    res.json({ message: "Nudge sent", to, msg });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`TimeBridge running on port ${PORT}`);
  if (process.env.SMTP_HOST) {
    console.log(
      `📧 SMTP configured: host=${process.env.SMTP_HOST} port=${process.env.SMTP_PORT || 587} user=${process.env.SMTP_USER || "(none)"}`
    );
    // Verify the SMTP connection at boot so wrong creds show up immediately.
    const t = getTransporter();
    if (t) {
      t.verify((err, ok) => {
        if (err) console.error("❌ SMTP verify FAILED:", err.message);
        else console.log("✅ SMTP verify OK — emails should send.");
      });
    }
  } else {
    console.log("⚠️  SMTP_HOST not set — reset links will print to this terminal instead of being emailed.");
  }
});
