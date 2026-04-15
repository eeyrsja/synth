import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import Stripe from "stripe";

// ── Config ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || "development";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// JWT secret: enforce in production
if (NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is required in production");
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET || "wavecraft-dev-secret-do-not-use-in-production";
const TOKEN_EXPIRY = "30d";

// Email config (optional — password reset won't work without it)
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || "noreply@wavecraft.app";

let mailTransport = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  mailTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// ── Stripe config ───────────────────────────────────────────────────
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;

let stripe = null;
if (STRIPE_SECRET_KEY) {
  stripe = new Stripe(STRIPE_SECRET_KEY);
} else if (NODE_ENV === "production") {
  console.error("WARNING: STRIPE_SECRET_KEY not set — payment endpoints will be disabled");
}

// ── Database ────────────────────────────────────────────────────────
const db = new Database("wavecraft.db");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_payment_id TEXT,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'succeeded',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Schema migration (add columns if missing) ───────────────────────
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

if (!columnExists("users", "paid")) {
  db.exec(`ALTER TABLE users ADD COLUMN paid INTEGER NOT NULL DEFAULT 0`);
}
if (!columnExists("users", "paid_at")) {
  db.exec(`ALTER TABLE users ADD COLUMN paid_at TEXT`);
}
if (!columnExists("users", "stripe_customer_id")) {
  db.exec(`ALTER TABLE users ADD COLUMN stripe_customer_id TEXT`);
}
if (!columnExists("users", "stripe_payment_id")) {
  db.exec(`ALTER TABLE users ADD COLUMN stripe_payment_id TEXT`);
}
if (!columnExists("presets", "type")) {
  db.exec(`ALTER TABLE presets ADD COLUMN type TEXT NOT NULL DEFAULT 'synth'`);
}

// User state table for session persistence
db.exec(`
  CREATE TABLE IF NOT EXISTS user_state (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Prepared statements ─────────────────────────────────────────────
const stmts = {
  findUserByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  createUser: db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)"),
  findUserById: db.prepare("SELECT id, email, display_name, paid, created_at FROM users WHERE id = ?"),
  listPresets: db.prepare("SELECT id, name, created_at, updated_at FROM presets WHERE user_id = ? ORDER BY updated_at DESC"),
  getPreset: db.prepare("SELECT * FROM presets WHERE id = ? AND user_id = ?"),
  upsertPreset: db.prepare(`
    INSERT INTO presets (user_id, name, data)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, name) DO UPDATE SET data = excluded.data, updated_at = datetime('now')
  `),
  deletePreset: db.prepare("DELETE FROM presets WHERE id = ? AND user_id = ?"),
  // Password reset
  createResetToken: db.prepare("INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)"),
  findResetToken: db.prepare("SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0"),
  markResetTokenUsed: db.prepare("UPDATE password_reset_tokens SET used = 1 WHERE id = ?"),
  updatePassword: db.prepare("UPDATE users SET password_hash = ? WHERE id = ?"),
  countRecentResets: db.prepare("SELECT COUNT(*) as cnt FROM password_reset_tokens WHERE user_id = ? AND created_at > datetime('now', '-1 hour')"),
  // Payment/tier
  setUserPaid: db.prepare("UPDATE users SET paid = 1, paid_at = datetime('now'), stripe_customer_id = ?, stripe_payment_id = ? WHERE id = ?"),
  setUserUnpaid: db.prepare("UPDATE users SET paid = 0 WHERE stripe_payment_id = ?"),
  insertPayment: db.prepare("INSERT INTO payments (user_id, stripe_payment_id, amount_cents, currency, status) VALUES (?, ?, ?, ?, ?)"),
  updatePaymentStatus: db.prepare("UPDATE payments SET status = ? WHERE stripe_payment_id = ?"),
};

// ── Auth middleware ──────────────────────────────────────────────────
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId = payload.sub;
    req.userTier = payload.tier || "free";
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requirePaid(req, res, next) {
  if (req.userTier !== "paid") {
    return res.status(403).json({ error: "This feature requires a paid account" });
  }
  next();
}

function makeToken(userId, paid = false) {
  return jwt.sign({ sub: userId, tier: paid ? "paid" : "free" }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// ── Rate limiters ───────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset requests, please try again later" },
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many checkout attempts, please try again later" },
});

// ── App ─────────────────────────────────────────────────────────────
const app = express();

// CORS: restrict to known origin(s)
app.use(cors({
  origin: NODE_ENV === "production" ? FRONTEND_URL : true,
  credentials: true,
}));

// ── Stripe webhook (raw body, before express.json) ──────────────────
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: "Stripe not configured" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  console.log(`[Stripe] Webhook received: ${event.type} at ${new Date().toISOString()}`);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = parseInt(session.client_reference_id, 10);
    if (userId && Number.isFinite(userId)) {
      stmts.setUserPaid.run(session.customer || null, session.payment_intent || null, userId);
      stmts.insertPayment.run(userId, session.payment_intent || null, 200, "usd", "succeeded");
      console.log(`[Stripe] User ${userId} upgraded to paid`);
    }
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object;
    const paymentIntent = charge.payment_intent;
    if (paymentIntent) {
      stmts.setUserUnpaid.run(paymentIntent);
      stmts.updatePaymentStatus.run("refunded", paymentIntent);
      console.log(`[Stripe] Payment ${paymentIntent} refunded`);
    }
  }

  res.json({ received: true });
});

app.use(express.json({ limit: "2mb" }));

// ── Auth routes ─────────────────────────────────────────────────────
app.post("/api/signup", authLimiter, (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: "Email, password, and display name are required" });
  }
  if (typeof email !== "string" || !email.includes("@") || email.length > 254) {
    return res.status(400).json({ error: "Invalid email" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (typeof displayName !== "string" || displayName.trim().length < 1 || displayName.length > 50) {
    return res.status(400).json({ error: "Display name must be 1-50 characters" });
  }
  const existing = stmts.findUserByEmail.get(email);
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }
  const hash = bcrypt.hashSync(password, 10);
  const result = stmts.createUser.run(email, hash, displayName.trim());
  const token = makeToken(result.lastInsertRowid, false);
  res.status(201).json({
    token,
    user: { id: result.lastInsertRowid, email, displayName: displayName.trim(), tier: "free" },
  });
});

app.post("/api/login", authLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const user = stmts.findUserByEmail.get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const paid = !!user.paid;
  const token = makeToken(user.id, paid);
  res.json({
    token,
    user: { id: user.id, email: user.email, displayName: user.display_name, tier: paid ? "paid" : "free" },
  });
});

app.get("/api/me", authenticate, (req, res) => {
  const user = stmts.findUserById.get(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  const paid = !!user.paid;
  res.json({
    user: { id: user.id, email: user.email, displayName: user.display_name, tier: paid ? "paid" : "free" },
  });
});

// ── Password reset routes ───────────────────────────────────────────
app.post("/api/forgot-password", resetLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email is required" });
  }

  // Always return success to prevent email enumeration
  const successMsg = { message: "If an account with that email exists, a reset link has been sent" };

  const user = stmts.findUserByEmail.get(email);
  if (!user) return res.json(successMsg);

  // Per-user rate limit: max 3 reset tokens per hour
  const recent = stmts.countRecentResets.get(user.id);
  if (recent.cnt >= 3) return res.json(successMsg);

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  stmts.createResetToken.run(user.id, token, expiresAt);

  // Send email if transport is configured
  if (mailTransport) {
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;
    try {
      await mailTransport.sendMail({
        from: SMTP_FROM,
        to: user.email,
        subject: "WaveCraft — Password Reset",
        text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, ignore this email.`,
        html: `<p>Reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p><p>If you didn't request this, ignore this email.</p>`,
      });
    } catch (err) {
      console.error("Failed to send reset email:", err.message);
    }
  } else {
    console.log(`[DEV] Password reset token for ${email}: ${token}`);
  }

  res.json(successMsg);
});

app.post("/api/reset-password", (req, res) => {
  const { token, password } = req.body;
  if (!token || typeof token !== "string" || token.length !== 64) {
    return res.status(400).json({ error: "Invalid reset token" });
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const record = stmts.findResetToken.get(token);
  if (!record) {
    return res.status(400).json({ error: "Invalid or expired reset token" });
  }

  if (new Date(record.expires_at) < new Date()) {
    stmts.markResetTokenUsed.run(record.id);
    return res.status(400).json({ error: "Reset token has expired" });
  }

  const hash = bcrypt.hashSync(password, 10);
  stmts.updatePassword.run(hash, record.user_id);
  stmts.markResetTokenUsed.run(record.id);

  res.json({ message: "Password has been reset successfully" });
});

// ── Stripe checkout ─────────────────────────────────────────────────
app.post("/api/checkout", authenticate, checkoutLimiter, async (req, res) => {
  if (!stripe || !STRIPE_PRICE_ID) {
    return res.status(503).json({ error: "Payments not configured" });
  }

  const user = stmts.findUserById.get(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.paid) return res.status(400).json({ error: "Already upgraded" });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: String(req.userId),
      customer_email: user.email,
      success_url: `${FRONTEND_URL}?payment=success`,
      cancel_url: `${FRONTEND_URL}?payment=cancelled`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ── Refresh token ───────────────────────────────────────────────────
app.post("/api/refresh-token", authenticate, (req, res) => {
  const user = stmts.findUserById.get(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  const paid = !!user.paid;
  const token = makeToken(user.id, paid);
  res.json({
    token,
    user: { id: user.id, email: user.email, displayName: user.display_name, tier: paid ? "paid" : "free" },
  });
});

// ── Session state (auto-save / restore) ─────────────────────────────
app.get("/api/state", authenticate, (req, res) => {
  const row = db.prepare("SELECT data FROM user_state WHERE user_id = ?").get(req.userId);
  if (!row) return res.json({ state: null });
  try { res.json({ state: JSON.parse(row.data) }); } catch { res.json({ state: null }); }
});

app.put("/api/state", authenticate, (req, res) => {
  const { data } = req.body;
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "State data is required" });
  }
  db.prepare(
    "INSERT INTO user_state (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')"
  ).run(req.userId, JSON.stringify(data));
  res.json({ ok: true });
});

// ── Preset routes (auth required) ───────────────────────────────────
app.get("/api/presets", authenticate, (req, res) => {
  const type = req.query.type || "synth";
  const presets = db.prepare("SELECT id, name, type, created_at, updated_at FROM presets WHERE user_id = ? AND type = ? ORDER BY updated_at DESC").all(req.userId, type);
  res.json({ presets });
});

app.get("/api/presets/:id", authenticate, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: "Invalid preset ID" });
  }
  const preset = db.prepare("SELECT * FROM presets WHERE id = ? AND user_id = ?").get(id, req.userId);
  if (!preset) return res.status(404).json({ error: "Preset not found" });
  res.json({ preset: { ...preset, data: JSON.parse(preset.data) } });
});

app.post("/api/presets", authenticate, (req, res) => {
  const { name, data, type } = req.body;
  if (!name || typeof name !== "string" || name.trim().length < 1 || name.length > 100) {
    return res.status(400).json({ error: "Name must be 1-100 characters" });
  }
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "Preset data is required" });
  }
  const presetType = type === "drums" ? "drums" : "synth";
  const result = db.prepare(
    "INSERT INTO presets (user_id, name, data, type) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET data = excluded.data, type = excluded.type, updated_at = datetime('now')"
  ).run(req.userId, name.trim(), JSON.stringify(data), presetType);
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim() });
});

app.delete("/api/presets/:id", authenticate, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: "Invalid preset ID" });
  }
  const result = db.prepare("DELETE FROM presets WHERE id = ? AND user_id = ?").run(id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: "Preset not found" });
  res.json({ ok: true });
});

// ── Start ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`WaveCraft API server running on http://localhost:${PORT} [${NODE_ENV}]`);
});
