import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// ── Config ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const TOKEN_EXPIRY = "30d";

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
`);

// ── Prepared statements ─────────────────────────────────────────────
const stmts = {
  findUserByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  createUser: db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)"),
  findUserById: db.prepare("SELECT id, email, display_name, created_at FROM users WHERE id = ?"),
  listPresets: db.prepare("SELECT id, name, created_at, updated_at FROM presets WHERE user_id = ? ORDER BY updated_at DESC"),
  getPreset: db.prepare("SELECT * FROM presets WHERE id = ? AND user_id = ?"),
  upsertPreset: db.prepare(`
    INSERT INTO presets (user_id, name, data)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, name) DO UPDATE SET data = excluded.data, updated_at = datetime('now')
  `),
  deletePreset: db.prepare("DELETE FROM presets WHERE id = ? AND user_id = ?"),
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
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function makeToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// ── App ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ── Auth routes ─────────────────────────────────────────────────────
app.post("/api/signup", (req, res) => {
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
  const token = makeToken(result.lastInsertRowid);
  res.status(201).json({
    token,
    user: { id: result.lastInsertRowid, email, displayName: displayName.trim() },
  });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const user = stmts.findUserByEmail.get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = makeToken(user.id);
  res.json({
    token,
    user: { id: user.id, email: user.email, displayName: user.display_name },
  });
});

app.get("/api/me", authenticate, (req, res) => {
  const user = stmts.findUserById.get(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: { id: user.id, email: user.email, displayName: user.display_name } });
});

// ── Preset routes ───────────────────────────────────────────────────
app.get("/api/presets", authenticate, (req, res) => {
  const presets = stmts.listPresets.all(req.userId);
  res.json({ presets });
});

app.get("/api/presets/:id", authenticate, (req, res) => {
  const preset = stmts.getPreset.get(req.params.id, req.userId);
  if (!preset) return res.status(404).json({ error: "Preset not found" });
  res.json({ preset: { ...preset, data: JSON.parse(preset.data) } });
});

app.post("/api/presets", authenticate, (req, res) => {
  const { name, data } = req.body;
  if (!name || typeof name !== "string" || name.trim().length < 1 || name.length > 100) {
    return res.status(400).json({ error: "Name must be 1-100 characters" });
  }
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "Preset data is required" });
  }
  const result = stmts.upsertPreset.run(req.userId, name.trim(), JSON.stringify(data));
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim() });
});

app.delete("/api/presets/:id", authenticate, (req, res) => {
  const result = stmts.deletePreset.run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: "Preset not found" });
  res.json({ ok: true });
});

// ── Start ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`WaveCraft API server running on http://localhost:${PORT}`);
});
