require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const VIDEOS_DIR = path.join(UPLOADS_DIR, "videos");
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

app.use("/uploads", express.static(UPLOADS_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "") || ".jpg";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const SEED_FEED = [
  
];

const AIVA_AUDIO = "aiva original";
const RUNWAY_API_BASE = "https://api.dev.runwayml.com";
const RUNWAY_VERSION = "2024-11-06";
const RUNWAY_MODEL = process.env.RUNWAY_MODEL || "gen4_turbo";
const RUNWAY_ALLOWED_RATIOS = [
  "1280:720",
  "720:1280",
  "1104:832",
  "832:1104",
  "960:960",
  "1584:672",
];
const RUNWAY_RATIO = RUNWAY_ALLOWED_RATIOS.includes(process.env.RUNWAY_RATIO)
  ? process.env.RUNWAY_RATIO
  : "720:1280";
const RUNWAY_DURATION = Number(process.env.RUNWAY_DURATION || 10);
const RUNWAY_MULTI_IMAGE_ENABLED = process.env.RUNWAY_MULTI_IMAGE_ENABLED === "true";
const AIVA_PROMPT_IMAGE_URL = process.env.AIVA_PROMPT_IMAGE_URL;
const AIVA_PROMPT_TEXT =
  process.env.AIVA_PROMPT_TEXT ||
  "A cinematic, futuristic neon city skyline at dusk, dramatic lighting";
const AUTH_OTP_TTL_MS = Number(process.env.AUTH_OTP_TTL_MS || 5 * 60 * 1000);
const AUTH_SESSION_TTL_MS = Number(
  process.env.AUTH_SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000
);

function normalizePhone(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "").trim();
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  return `+${digits}`;
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(String(secret), salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifySecret(secret, storedValue) {
  const [salt, digest] = String(storedValue || "").split(":");
  if (!salt || !digest) return false;
  const computed = crypto.scryptSync(String(secret), salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(computed));
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpCode(phone, code) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (sid && token && from) {
    requireFetch();
    const body = new URLSearchParams({
      To: phone,
      From: from,
      Body: `Your AIVA verification code is ${code}`,
    });
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to send OTP SMS: ${response.status} ${text}`);
    }
    return { delivery: "sms" };
  }

  console.log(`[AUTH] OTP for ${phone}: ${code}`);
  return { delivery: "dev-log", devOtp: code };
}

async function createAuthChallenge({
  phone,
  purpose,
  userId = null,
  passwordHash = null,
}) {
  const id = crypto.randomUUID();
  const code = generateOtpCode();
  const codeHash = hashValue(code);
  const expiresAt = new Date(Date.now() + AUTH_OTP_TTL_MS);

  await pool.query(
    `
      INSERT INTO auth_challenges (id, phone, purpose, user_id, password_hash, code_hash, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [id, phone, purpose, userId, passwordHash, codeHash, expiresAt]
  );

  const delivery = await sendOtpCode(phone, code);
  return { challengeId: id, ...delivery };
}

async function consumeLatestAuthChallenge({ phone, purpose, code }) {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM auth_challenges
      WHERE phone = $1
        AND purpose = $2
        AND consumed_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [phone, purpose]
  );
  const challenge = rows[0];
  if (!challenge) {
    return null;
  }
  if (challenge.code_hash !== hashValue(code)) {
    return false;
  }
  await pool.query(
    "UPDATE auth_challenges SET consumed_at = NOW() WHERE id = $1",
    [challenge.id]
  );
  return challenge;
}

async function issueAuthSession(userId) {
  const rawToken = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashValue(rawToken);
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_MS);
  await pool.query(
    `
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
      VALUES ($1, $2, $3, $4)
    `,
    [crypto.randomUUID(), userId, tokenHash, expiresAt]
  );
  return rawToken;
}

function getBearerToken(req) {
  const header = String(req.get("authorization") || "");
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim();
}

async function getUserForToken(token) {
  if (!token) return null;
  const tokenHash = hashValue(token);
  const { rows } = await pool.query(
    `
      SELECT u.id, u.username, u.phone
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
      LIMIT 1
    `,
    [tokenHash]
  );
  return rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const user = await getUserForToken(token);
    if (!user) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    req.authUser = user;
    req.authToken = token;
    return next();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Auth check failed" });
  }
}

function isPublicHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "::1"].includes(host)) return false;
    if (host.startsWith("10.")) return false;
    if (host.startsWith("192.168.")) return false;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function requireFetch() {
  if (typeof fetch !== "function") {
    throw new Error(
      "Global fetch is not available. Use Node 18+ or add a fetch polyfill."
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequestBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function getPublicBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || getRequestBaseUrl(req);
}

function toAbsoluteAssetUrl(value, baseUrl) {
  const text = String(value || "");
  if (!text) return text;
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith("/")) return `${baseUrl}${text}`;
  return text;
}

function inferVideoExtFromUrl(rawUrl) {
  try {
    const pathname = new URL(rawUrl).pathname.toLowerCase();
    const ext = path.extname(pathname);
    if ([".mp4", ".mov", ".webm", ".m4v"].includes(ext)) return ext;
    return ".mp4";
  } catch {
    return ".mp4";
  }
}

async function downloadVideoToLocal(sourceUrl) {
  requireFetch();
  const source = String(sourceUrl || "").trim();
  if (!/^https?:\/\//i.test(source)) {
    return source;
  }

  const hash = crypto.createHash("sha256").update(source).digest("hex");
  const extFromUrl = inferVideoExtFromUrl(source);
  const fileName = `${hash}${extFromUrl}`;
  const absPath = path.join(VIDEOS_DIR, fileName);
  const relPath = `/uploads/videos/${fileName}`;

  if (fs.existsSync(absPath)) {
    return relPath;
  }

  const resp = await fetch(source);
  if (!resp.ok) {
    throw new Error(`Video download failed: ${resp.status} ${source}`);
  }

  const bytes = await resp.arrayBuffer();
  await fs.promises.writeFile(absPath, Buffer.from(bytes));
  return relPath;
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      aiva_video_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS aiva_video_count INTEGER NOT NULL DEFAULT 0;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    DROP COLUMN IF EXISTS aiva_video_generated;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique
    ON users (LOWER(username));
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
    ON users (phone)
    WHERE phone IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      purpose TEXT NOT NULL,
      user_id TEXT,
      password_hash TEXT,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aiva_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feed_items (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT NOT NULL,
      caption TEXT NOT NULL,
      audio TEXT NOT NULL,
      uri TEXT NOT NULL,
      poster TEXT NOT NULL,
      likes INTEGER NOT NULL DEFAULT 0,
      comments_count INTEGER NOT NULL DEFAULT 0,
      comments JSONB NOT NULL DEFAULT '[]',
      is_aiva BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function seedFeedIfEmpty() {
  for (const item of SEED_FEED) {
    await pool.query(
      `
        INSERT INTO feed_items
          (id, user_id, username, caption, audio, uri, poster, likes, comments_count, comments, is_aiva)
        VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, FALSE)
        ON CONFLICT (id) DO UPDATE
        SET
          username = EXCLUDED.username,
          caption = EXCLUDED.caption,
          audio = EXCLUDED.audio,
          uri = EXCLUDED.uri,
          poster = EXCLUDED.poster,
          likes = EXCLUDED.likes,
          comments_count = EXCLUDED.comments_count,
          comments = EXCLUDED.comments,
          is_aiva = EXCLUDED.is_aiva
      `,
      [
        item.id,
        item.username,
        item.caption,
        item.audio,
        item.uri,
        item.poster,
        item.likes,
        item.commentsCount ?? item.comments?.length ?? 0,
        JSON.stringify(item.comments ?? []),
      ]
    );
  }
}

function mapFeedRow(row, baseUrl) {
  return {
    id: row.id,
    username: row.username,
    caption: row.caption,
    audio: row.audio,
    uri: toAbsoluteAssetUrl(row.uri, baseUrl),
    poster: toAbsoluteAssetUrl(row.poster, baseUrl),
    likes: row.likes,
    comments: row.comments ?? [],
    commentsCount: row.comments_count ?? 0,
  };
}

async function createRunwayVideo({
  promptText,
  promptImageUrl,
  promptImageUrls,
  duration,
} = {}) {
  requireFetch();
  if (!process.env.RUNWAY_API_KEY) {
    throw new Error("RUNWAY_API_KEY is not set");
  }
  const resolvedPromptImageUrl =
    promptImageUrl || AIVA_PROMPT_IMAGE_URL || null;
  const resolvedPromptImageUrls = Array.isArray(promptImageUrls)
    ? promptImageUrls.filter(Boolean)
    : [];
  const chosenDuration = duration ?? RUNWAY_DURATION;

  if (
    !resolvedPromptImageUrl &&
    (!resolvedPromptImageUrls || resolvedPromptImageUrls.length === 0)
  ) {
    throw new Error("promptImageUrl is required");
  }

  const imageUrlsToUse =
    resolvedPromptImageUrls.length > 0
      ? resolvedPromptImageUrls
      : [resolvedPromptImageUrl].filter(Boolean);

  if (!imageUrlsToUse.every(isPublicHttpUrl)) {
    throw new Error(
      "All prompt images must be public http(s) URLs (not localhost/LAN)."
    );
  }

  if (!RUNWAY_ALLOWED_RATIOS.includes(RUNWAY_RATIO)) {
    throw new Error(
      `RUNWAY_RATIO must be one of: ${RUNWAY_ALLOWED_RATIOS.join(", ")}`
    );
  }
  if (![5, 10].includes(Number(chosenDuration))) {
    throw new Error("duration must be 5 or 10 seconds for this model");
  }

  for (const url of imageUrlsToUse) {
    await ensurePromptImageAccessible(url);
  }

  if (imageUrlsToUse.length > 1 && !RUNWAY_MULTI_IMAGE_ENABLED) {
    console.log(
      `[AIVA] Received ${imageUrlsToUse.length} prompt images; using first image only for Runway`
    );
  }

  const promptImagePayload =
    imageUrlsToUse.length > 1 && RUNWAY_MULTI_IMAGE_ENABLED
      ? [
          { uri: imageUrlsToUse[0], position: "first" },
          { uri: imageUrlsToUse[imageUrlsToUse.length - 1], position: "last" },
        ]
      : imageUrlsToUse[0];

  const createResp = await fetch(`${RUNWAY_API_BASE}/v1/image_to_video`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
      "Content-Type": "application/json",
      "X-Runway-Version": RUNWAY_VERSION,
    },
    body: JSON.stringify({
      model: RUNWAY_MODEL,
      promptImage: promptImagePayload,
      promptText: promptText || AIVA_PROMPT_TEXT,
      ratio: RUNWAY_RATIO,
      duration: Number(chosenDuration),
    }),
  });

  if (!createResp.ok) {
    const body = await createResp.text();
    throw new Error(`Runway create failed: ${createResp.status} ${body}`);
  }

  const { id } = await createResp.json();
  if (!id) {
    throw new Error("Runway create did not return a task id");
  }

  const timeoutMs = Number(process.env.RUNWAY_TIMEOUT_MS || 180000);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const taskResp = await fetch(`${RUNWAY_API_BASE}/v1/tasks/${id}`, {
      headers: {
        Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
        "X-Runway-Version": RUNWAY_VERSION,
      },
    });

    if (!taskResp.ok) {
      const body = await taskResp.text();
      throw new Error(`Runway task failed: ${taskResp.status} ${body}`);
    }

    const task = await taskResp.json();
    if (task.status === "SUCCEEDED") {
      const outputUrl = Array.isArray(task.output) ? task.output[0] : null;
      if (!outputUrl) {
        throw new Error("Runway task succeeded but output is empty");
      }
      return {
        videoUrl: outputUrl,
        posterUrl: imageUrlsToUse[0],
      };
    }

    if (task.status === "FAILED" || task.status === "CANCELED") {
      const details =
        task.error ||
        task.failureReason ||
        task.reason ||
        task.message ||
        JSON.stringify(task, null, 2);
      throw new Error(`Runway task ${task.status}: ${details}`);
    }

    await sleep(5000);
  }

  throw new Error("Runway task timed out");
}

async function ensurePromptImageAccessible(url) {
  requireFetch();
  let resp;
  try {
    resp = await fetch(url, { method: "HEAD" });
    if (!resp.ok) {
      resp = await fetch(url, { method: "GET" });
    }
  } catch (error) {
    throw new Error(`Prompt image URL fetch failed: ${error?.message ?? error}`);
  }
  if (!resp.ok) {
    throw new Error(
      `Prompt image URL is not accessible. HTTP ${resp.status} for ${url}`
    );
  }
}

async function ensureAivaVideoForUser(userId, options = {}) {
  const requestedTitle =
    typeof options.title === "string" ? options.title.trim() : "";
  const caption = requestedTitle || "Untitled AIVA video";

  const { rows } = await pool.query(
    "SELECT username, aiva_video_count FROM users WHERE id = $1",
    [userId]
  );
  if (!rows[0]) {
    throw new Error("User not found. Please login first.");
  }
  const username = rows[0].username;
  const count = rows[0]?.aiva_video_count ?? 0;
  if (count >= 3) {
    return { alreadyGenerated: true, remaining: 0, count };
  }

  const { videoUrl, posterUrl } = await createRunwayVideo(options);
  const localVideoUri = await downloadVideoToLocal(videoUrl);
  const id = crypto.randomUUID();

  await pool.query(
    `
      INSERT INTO feed_items
        (id, user_id, username, caption, audio, uri, poster, likes, comments_count, comments, is_aiva)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, '[]'::jsonb, TRUE)
    `,
    [id, userId, username, caption, AIVA_AUDIO, localVideoUri, posterUrl]
  );

  await pool.query(
    "UPDATE users SET aiva_video_count = aiva_video_count + 1 WHERE id = $1",
    [userId]
  );

  return {
    alreadyGenerated: false,
    remaining: Math.max(0, 2 - count),
    count: count + 1,
  };
}

async function getActiveJobForUser(userId) {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM aiva_jobs
      WHERE user_id = $1
        AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}

async function updateJobStatus(jobId, status, error = null) {
  await pool.query(
    `
      UPDATE aiva_jobs
      SET status = $2, error = $3, updated_at = NOW()
      WHERE id = $1
    `,
    [jobId, status, error]
  );
}

async function startAivaJob({
  jobId,
  userId,
  title,
  promptText,
  imageUrls,
  duration,
}) {
  try {
    console.log(`[AIVA] job ${jobId} starting for user ${userId}`);
    await updateJobStatus(jobId, "running");
    const result = await ensureAivaVideoForUser(userId, {
      title,
      promptText,
      promptImageUrls: imageUrls,
      duration,
    });
    if (result.alreadyGenerated) {
      await updateJobStatus(jobId, "blocked", "AIVA limit reached");
      return;
    }
    await updateJobStatus(jobId, "succeeded");
    console.log(`[AIVA] job ${jobId} succeeded`);
  } catch (error) {
    console.error(
      `[AIVA] job ${jobId} failed before/while calling Runway:`,
      error
    );
    await updateJobStatus(
      jobId,
      "failed",
      error?.message ? String(error.message) : String(error)
    );
  }
}

async function localizeRemoteFeedVideos() {
  const { rows } = await pool.query(`
    SELECT id, uri
    FROM feed_items
    WHERE uri ~ '^https?://'
  `);

  for (const row of rows) {
    try {
      const localUri = await downloadVideoToLocal(row.uri);
      if (localUri && localUri !== row.uri) {
        await pool.query("UPDATE feed_items SET uri = $2 WHERE id = $1", [
          row.id,
          localUri,
        ]);
      }
    } catch (error) {
      console.error(`[AIVA] failed to localize video for feed item ${row.id}:`, error);
    }
  }
}

app.post("/login", async (req, res) => {
  const { userId, username } = req.body || {};
  if (!userId || !username) {
    return res.status(400).json({
      error: "userId and username are required",
    });
  }

  try {
    await pool.query(
      `
        INSERT INTO users (id, username)
        VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
      `,
      [userId, username]
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Login failed" });
  }
});

app.post("/auth/register/start", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const password = String(req.body?.password || "");
  if (!phone || password.length < 8) {
    return res.status(400).json({
      error: "phone and password (min 8 chars) are required",
    });
  }

  try {
    const existing = await pool.query(
      "SELECT id FROM users WHERE phone = $1 LIMIT 1",
      [phone]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ error: "Phone already registered" });
    }

    const challenge = await createAuthChallenge({
      phone,
      purpose: "register",
      passwordHash: hashSecret(password),
    });

    return res.json({ ok: true, ...challenge });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to start registration" });
  }
});

app.post("/auth/register/verify", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || "").trim();
  const username = String(req.body?.username || "").trim();
  if (!phone || !code || !username) {
    return res
      .status(400)
      .json({ error: "phone, code, and username are required" });
  }

  try {
    const usernameExists = await pool.query(
      "SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1",
      [username]
    );
    if (usernameExists.rows[0]) {
      return res.status(409).json({ error: "Username is already taken" });
    }

    const challenge = await consumeLatestAuthChallenge({
      phone,
      purpose: "register",
      code,
    });
    if (challenge === false) {
      return res.status(401).json({ error: "Invalid verification code" });
    }
    if (!challenge) {
      return res.status(400).json({ error: "No active verification code" });
    }

    const userId = crypto.randomUUID();
    await pool.query(
      `
        INSERT INTO users (id, username, phone, password_hash)
        VALUES ($1, $2, $3, $4)
      `,
      [userId, username, phone, challenge.password_hash]
    );
    const token = await issueAuthSession(userId);

    return res.json({
      ok: true,
      token,
      user: { id: userId, username, phone },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to complete registration" });
  }
});

app.post("/auth/login/start", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const password = String(req.body?.password || "");
  if (!phone || !password) {
    return res.status(400).json({ error: "phone and password are required" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT id, password_hash FROM users WHERE phone = $1 LIMIT 1",
      [phone]
    );
    const user = rows[0];
    if (!user || !user.password_hash || !verifySecret(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid phone or password" });
    }

    const challenge = await createAuthChallenge({
      phone,
      purpose: "login",
      userId: user.id,
    });

    return res.json({ ok: true, ...challenge });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to start login" });
  }
});

app.post("/auth/login/verify", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || "").trim();
  if (!phone || !code) {
    return res.status(400).json({ error: "phone and code are required" });
  }

  try {
    const challenge = await consumeLatestAuthChallenge({
      phone,
      purpose: "login",
      code,
    });
    if (challenge === false) {
      return res.status(401).json({ error: "Invalid verification code" });
    }
    if (!challenge) {
      return res.status(400).json({ error: "No active verification code" });
    }

    const { rows } = await pool.query(
      "SELECT id, username, phone FROM users WHERE id = $1 LIMIT 1",
      [challenge.user_id]
    );
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const token = await issueAuthSession(user.id);
    return res.json({ ok: true, token, user });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to verify login" });
  }
});

app.get("/auth/me", requireAuth, async (req, res) => {
  return res.json({ ok: true, user: req.authUser });
});

app.post("/auth/logout", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM auth_sessions WHERE token_hash = $1",
      [hashValue(req.authToken)]
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to logout" });
  }
});

app.post("/aiva/prompt-image", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "image file is required" });
  }

  const baseUrl = getPublicBaseUrl(req);

  return res.json({
    imageUrl: `${baseUrl}/uploads/${req.file.filename}`,
  });
});

app.post("/aiva/generate", requireAuth, async (req, res) => {
  const { title, promptText, imageUrl, imageUrls, duration } =
    req.body || {};
  const userId = req.authUser.id;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  if (!String(title || "").trim()) {
    return res.status(400).json({ error: "title is required" });
  }
  const resolvedUrls = Array.isArray(imageUrls)
    ? imageUrls.filter(Boolean)
    : [];
  if (!imageUrl && resolvedUrls.length === 0) {
    return res.status(400).json({ error: "imageUrl(s) are required" });
  }
  const providedUrls = resolvedUrls.length ? resolvedUrls : [imageUrl];
  if (providedUrls.length !== 1) {
    return res.status(400).json({
      error: "Exactly one image is required for generation",
    });
  }
  const invalidUrl = providedUrls.find((url) => !isPublicHttpUrl(url));
  if (invalidUrl) {
    return res.status(400).json({
      error:
        "All imageUrl(s) must be public http(s) URLs accessible from the internet (not localhost/LAN).",
      invalidUrl,
    });
  }

  try {
    const activeJob = await getActiveJobForUser(userId);
    if (activeJob) {
      return res.status(409).json({
        ok: false,
        error: "AIVA generation already in progress",
        jobId: activeJob.id,
        status: activeJob.status,
      });
    }

    const { rows } = await pool.query(
      "SELECT aiva_video_count FROM users WHERE id = $1",
      [userId]
    );
    const count = rows[0]?.aiva_video_count ?? 0;
    if (count >= 3) {
      return res.status(403).json({
        ok: false,
        error: "AIVA limit reached",
        count,
        remaining: 0,
      });
    }

    const jobId = crypto.randomUUID();
    await pool.query(
      `
        INSERT INTO aiva_jobs (id, user_id, status)
        VALUES ($1, $2, 'queued')
      `,
      [jobId, userId]
    );

    void startAivaJob({
      jobId,
      userId,
      title,
      promptText,
      imageUrls: providedUrls,
      duration,
    });

    return res.status(202).json({ ok: true, jobId, status: "queued" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "AIVA generation failed" });
  }
});

app.get("/aiva/status", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    const [{ rows: users }, { rows: jobs }] = await Promise.all([
      pool.query("SELECT aiva_video_count FROM users WHERE id = $1", [userId]),
      pool.query(
        `
          SELECT *
          FROM aiva_jobs
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [userId]
      ),
    ]);

    return res.json({
      ok: true,
      count: users[0]?.aiva_video_count ?? 0,
      job: jobs[0] || null,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to load status" });
  }
});

app.post("/aiva/reset-upload-count", requireAuth, async (req, res) => {
  const requesterUserId = req.authUser.id;
  if (!requesterUserId) {
    return res.status(400).json({ error: "userId is required" });
  }
  if (req.authUser.username !== "andrew") {
    return res.status(403).json({ error: "Only andrew can reset upload count" });
  }

  try {
    const result = await pool.query(
      `
        UPDATE users
        SET aiva_video_count = 0
        WHERE id = $1
        RETURNING id, username, aiva_video_count
      `,
      [requesterUserId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({
      ok: true,
      userId: result.rows[0].id,
      username: result.rows[0].username,
      count: result.rows[0].aiva_video_count,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to reset upload count" });
  }
});

app.get("/feed", async (req, res) => {
  const userId = req.query.userId ? String(req.query.userId) : null;

  try {
    let query = "";
    let params = [];

    if (userId) {
      query = `
        SELECT *
        FROM feed_items
        ORDER BY
          CASE WHEN user_id = $1 THEN 0 ELSE 1 END,
          created_at DESC
      `;
      params = [userId];
    } else {
      query = `
        SELECT *
        FROM feed_items
        WHERE user_id IS NULL
        ORDER BY created_at DESC
      `;
    }

    const { rows } = await pool.query(query, params);
    const baseUrl = getRequestBaseUrl(req);
    res.json(rows.map((row) => mapFeedRow(row, baseUrl)));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load feed" });
  }
});

const PORT = process.env.PORT || 3001;
initDb()
  .then(seedFeedIfEmpty)
  .then(localizeRemoteFeedVideos)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Feed server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
