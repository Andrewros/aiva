if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json());
app.get("/health", (_req, res) => res.send("ok"));

function readPositiveIntEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: readPositiveIntEnv("PG_POOL_MAX", 10),
  idleTimeoutMillis: readPositiveIntEnv("PG_IDLE_TIMEOUT_MS", 30000),
  connectionTimeoutMillis: readPositiveIntEnv("PG_CONNECTION_TIMEOUT_MS", 15000),
  keepAlive: true,
  keepAliveInitialDelayMillis: readPositiveIntEnv(
    "PG_KEEPALIVE_INITIAL_DELAY_MS",
    10000
  ),
});
pool.on("error", (error) => {
  console.error("Postgres pool idle client error:", error);
});

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const VIDEOS_DIR = path.join(UPLOADS_DIR, "videos");
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}
const TMP_DIR = path.join(UPLOADS_DIR, "tmp");
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
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

const execFileAsync = promisify(execFile);
const AIVA_AUDIO = "ElevenLabs voiceover";
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
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const AIVA_SCENE_COUNT = Math.max(
  1,
  Math.min(4, Number(process.env.AIVA_SCENE_COUNT || 2))
);
const ELEVENLABS_API_BASE =
  process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io/v1";
const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";
const AIVA_MAX_IMAGES = Math.max(
  1,
  Math.min(12, Number(process.env.AIVA_MAX_IMAGES || 12))
);
const AIVA_SECONDS_PER_IMAGE = Math.max(
  1,
  Math.min(10, Number(process.env.AIVA_SECONDS_PER_IMAGE || 5))
);
const AIVA_NARRATION_TARGET_RATIO = Math.max(
  0.6,
  Math.min(0.98, Number(process.env.AIVA_NARRATION_TARGET_RATIO || 0.88))
);
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_BINARY || "ffmpeg",
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
];
let RESOLVED_FFMPEG_BINARY = null;
const AIVA_PROMPT_IMAGE_URL = process.env.AIVA_PROMPT_IMAGE_URL;
const AIVA_PROMPT_TEXT =
  process.env.AIVA_PROMPT_TEXT ||
  "A cinematic, futuristic neon city skyline at dusk, dramatic lighting";
const AIVA_BASE_VIDEO_LIMIT = 3;
const AIVA_MAX_VIDEO_LIMIT = 100;
const AIVA_ADS_PER_REWARDED_VIDEO = 10;
const AUTH_OTP_TTL_MS = Number(process.env.AUTH_OTP_TTL_MS || 5 * 60 * 1000);
const AUTH_SESSION_TTL_MS = Number(
  process.env.AUTH_SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000
);

function resolveAivaVideoLimit(row) {
  const bonus = Number(row?.aiva_bonus_videos ?? 0);
  const safeBonus = Number.isFinite(bonus) ? Math.max(0, Math.floor(bonus)) : 0;
  return Math.min(AIVA_MAX_VIDEO_LIMIT, AIVA_BASE_VIDEO_LIMIT + safeBonus);
}

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
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const from = process.env.TWILIO_FROM_NUMBER;
  const auth = sid && token ? Buffer.from(`${sid}:${token}`).toString("base64") : null;

  if (sid && token && verifyServiceSid) {
    requireFetch();
    const body = new URLSearchParams({
      To: phone,
      Channel: "sms",
    });
    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${verifyServiceSid}/Verifications`,
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
      throw new Error(`Failed to send OTP via Twilio Verify: ${response.status} ${text}`);
    }
    return { delivery: "sms" };
  }

  if (sid && token && from) {
    requireFetch();
    const body = new URLSearchParams({
      To: phone,
      From: from,
      Body: `Your AIVA verification code is ${code}`,
    });
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

  throw new Error(
    "Twilio is not fully configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID."
  );
}

async function verifyOtpCodeWithTwilio(phone, code) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid || !token || !verifyServiceSid) {
    return null;
  }
  requireFetch();
  const body = new URLSearchParams({
    To: phone,
    Code: String(code || "").trim(),
  });
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${verifyServiceSid}/VerificationCheck`,
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
    throw new Error(`Twilio Verify check failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return String(data?.status || "").toLowerCase() === "approved";
}

async function createAuthChallenge({
  phone,
  purpose,
  userId = null,
  passwordHash = null,
  meta = null,
}) {
  const id = crypto.randomUUID();
  const code = generateOtpCode();
  const codeHash = hashValue(code);
  const expiresAt = new Date(Date.now() + AUTH_OTP_TTL_MS);

  await pool.query(
    `
      INSERT INTO auth_challenges (id, phone, purpose, user_id, password_hash, code_hash, expires_at, meta)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      id,
      phone,
      purpose,
      userId,
      passwordHash,
      codeHash,
      expiresAt,
      meta ? JSON.stringify(meta) : null,
    ]
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

  const twilioApproved = await verifyOtpCodeWithTwilio(phone, code);
  if (twilioApproved === false) {
    return false;
  }
  if (twilioApproved === null && challenge.code_hash !== hashValue(code)) {
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

async function revokeAllSessionsForUser(userId) {
  await pool.query("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
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
      SELECT u.id, u.username, u.phone, u.profile_picture AS "profilePicture"
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
  if (/^https?:\/\//i.test(text)) {
    try {
      const parsed = new URL(text);
      if (parsed.pathname.startsWith("/uploads/")) {
        return `${baseUrl}${parsed.pathname}`;
      }
    } catch {
      // Keep original value when URL parsing fails.
    }
    return text;
  }
  if (text.startsWith("/")) return `${baseUrl}${text}`;
  return text;
}

function mapUserRow(row, baseUrl) {
  return {
    id: row.id,
    username: row.username,
    phone: row.phone ?? null,
    profilePicture: toAbsoluteAssetUrl(row.profilePicture ?? row.profile_picture ?? "", baseUrl),
  };
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

function inferImageExtFromUrl(rawUrl) {
  try {
    const pathname = new URL(rawUrl).pathname.toLowerCase();
    const ext = path.extname(pathname);
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return ext;
    return ".jpg";
  } catch {
    return ".jpg";
  }
}

function parseRatioToDimensions(value) {
  const text = String(value || "").trim();
  const parts = text.split(":").map((x) => Number(x));
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
    return {
      width: Math.max(64, Math.round(parts[0])),
      height: Math.max(64, Math.round(parts[1])),
    };
  }
  return { width: 720, height: 1280 };
}

function toLocalUploadsAbsPath(inputUrl) {
  const raw = String(inputUrl || "").trim();
  if (!raw) return null;
  if (raw.startsWith("/uploads/")) {
    return path.join(__dirname, raw.replace(/^\/+/, ""));
  }
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (parsed.pathname.startsWith("/uploads/")) {
      return path.join(__dirname, parsed.pathname.replace(/^\/+/, ""));
    }
  } catch {
    return null;
  }
  return null;
}

async function downloadBinaryToPath(url, absPath) {
  requireFetch();
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`File download failed: ${resp.status} ${url}`);
  }
  const bytes = await resp.arrayBuffer();
  await fs.promises.writeFile(absPath, Buffer.from(bytes));
}

async function resolveImageToTempPath(inputUrl, runId, index) {
  const localUploadPath = toLocalUploadsAbsPath(inputUrl);
  if (localUploadPath && fs.existsSync(localUploadPath)) {
    return localUploadPath;
  }

  const source = String(inputUrl || "").trim();
  if (!/^https?:\/\//i.test(source)) {
    throw new Error(`Unsupported image URL: ${source}`);
  }
  const ext = inferImageExtFromUrl(source);
  const absPath = path.join(TMP_DIR, `${runId}-image-${index}${ext}`);
  await downloadBinaryToPath(source, absPath);
  return absPath;
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

  await downloadBinaryToPath(source, absPath);
  return relPath;
}

function extractJsonObject(text) {
  const input = String(text || "").trim();
  if (!input) return "{}";
  const first = input.indexOf("{");
  const last = input.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return "{}";
  return input.slice(first, last + 1);
}

function getOpenAiMessageText(choice) {
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((chunk) =>
        typeof chunk?.text === "string"
          ? chunk.text
          : typeof chunk === "string"
            ? chunk
            : ""
      )
      .join("\n");
  }
  return "";
}

function normalizeScenes(rawScenes, fallbackScript) {
  const source = Array.isArray(rawScenes) ? rawScenes : [];
  const out = source
    .map((scene, idx) => {
      const visualPrompt = String(
        scene?.visualPrompt || scene?.prompt || scene?.visual || ""
      ).trim();
      const narration = String(
        scene?.narration || scene?.voiceover || scene?.script || ""
      ).trim();
      if (!visualPrompt || !narration) return null;
      return {
        id: idx + 1,
        visualPrompt,
        narration,
      };
    })
    .filter(Boolean);

  if (out.length > 0) return out.slice(0, AIVA_SCENE_COUNT);

  return [
    {
      id: 1,
      visualPrompt:
        String(fallbackScript || "").trim() ||
        "A cinematic, futuristic neon city skyline at dusk, dramatic lighting",
      narration:
        String(fallbackScript || "").trim() ||
        "A cinematic moment in a futuristic neon city at dusk.",
    },
  ];
}

async function generateScenesWithGpt({ title, promptText, duration }) {
  requireFetch();
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const sceneDuration = Number(duration) || RUNWAY_DURATION;
  const userPrompt = `
Create a short storyboard for a video titled "${title || "Untitled"}".
Creative direction: ${promptText || AIVA_PROMPT_TEXT}
Return STRICT JSON only, matching:
{
  "scenes": [
    {
      "visualPrompt": "text prompt for video generation",
      "narration": "spoken voiceover line"
    }
  ]
}
Constraints:
- Exactly ${AIVA_SCENE_COUNT} scene(s)
- Each narration should be concise and fit about ${sceneDuration} seconds of speech
- Keep visual prompts cinematic and coherent as one story
`.trim();

  const resp = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You are a screenplay assistant that outputs valid JSON only with concise cinematic scenes.",
        },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OpenAI scene generation failed: ${resp.status} ${body}`);
  }

  const data = await resp.json();
  const text = getOpenAiMessageText(data?.choices?.[0]);
  const jsonText = extractJsonObject(text);

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = {};
  }
  return normalizeScenes(parsed?.scenes, promptText);
}

async function rewriteNarrationWithGpt({ title, promptText, targetSeconds }) {
  requireFetch();
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const seconds = Math.max(5, Number(targetSeconds) || 60);
  const narrationSeconds = Math.max(4, Math.floor(seconds * AIVA_NARRATION_TARGET_RATIO));
  // Use a conservative speaking rate so TTS is less likely to run long.
  const targetWords = Math.max(16, Math.round(narrationSeconds * 2.1));
  const basePrompt = String(promptText || "").trim();
  if (!basePrompt) {
    throw new Error("Script text is required");
  }

  const userPrompt = `
Rewrite and expand this story into a spoken narration for approximately ${narrationSeconds} seconds.
Target about ${targetWords} words.
Keep names and key plot beats intact.
Output plain narration text only, no labels or headings.

Title: ${title || "Untitled AIVA video"}
Source script:
${basePrompt}
`.trim();

  const resp = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You are a narration writer. Return only the final narration text.",
        },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OpenAI narration rewrite failed: ${resp.status} ${body}`);
  }

  const data = await resp.json();
  const rewritten = String(getOpenAiMessageText(data?.choices?.[0]) || "").trim();
  if (!rewritten) {
    throw new Error("OpenAI narration rewrite returned empty text");
  }
  return rewritten;
}

async function ensureFfmpegInstalled() {
  if (RESOLVED_FFMPEG_BINARY) return RESOLVED_FFMPEG_BINARY;

  for (const candidate of FFMPEG_CANDIDATES) {
    if (!candidate) continue;
    try {
      await execFileAsync(candidate, ["-version"]);
      RESOLVED_FFMPEG_BINARY = candidate;
      return RESOLVED_FFMPEG_BINARY;
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `ffmpeg is required for AIVA MVP pipeline and was not found. Checked: ${FFMPEG_CANDIDATES.filter(Boolean).join(", ")}`
  );
}

async function runFfmpeg(args) {
  const ffmpegBin = await ensureFfmpegInstalled();
  try {
    await execFileAsync(ffmpegBin, args);
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).slice(0, 1200) : "";
    throw new Error(`ffmpeg failed. ${stderr}`);
  }
}

async function synthesizeWithElevenLabs({ text, outputAbsPath }) {
  requireFetch();
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY is not set");
  }
  if (!ELEVENLABS_VOICE_ID) {
    throw new Error("ELEVENLABS_VOICE_ID is not set");
  }
  const input = String(text || "").trim();
  if (!input) {
    throw new Error("Voiceover text is required");
  }

  const resp = await fetch(
    `${ELEVENLABS_API_BASE}/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: ELEVENLABS_MODEL_ID,
        text: input,
      }),
    }
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`ElevenLabs TTS failed: ${resp.status} ${body}`);
  }

  const bytes = await resp.arrayBuffer();
  await fs.promises.writeFile(outputAbsPath, Buffer.from(bytes));
}

async function muxVideoAndAudio({ videoAbsPath, audioAbsPath, outputAbsPath }) {
  await runFfmpeg([
    "-y",
    "-i",
    videoAbsPath,
    "-i",
    audioAbsPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    outputAbsPath,
  ]);
}

async function createVideoSegmentFromImage({
  imageAbsPath,
  outputAbsPath,
  seconds = AIVA_SECONDS_PER_IMAGE,
}) {
  const { width, height } = parseRatioToDimensions(RUNWAY_RATIO);
  await runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-t",
    String(seconds),
    "-i",
    imageAbsPath,
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    outputAbsPath,
  ]);
}

async function muxVideoWithNarration({
  videoAbsPath,
  narrationAbsPath,
  outputAbsPath,
  durationSeconds,
}) {
  await runFfmpeg([
    "-y",
    "-i",
    videoAbsPath,
    "-i",
    narrationAbsPath,
    "-filter_complex",
    `[1:a]apad,atrim=0:${Number(durationSeconds)}[a]`,
    "-map",
    "0:v:0",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    outputAbsPath,
  ]);
}

async function concatVideoSegments({ inputAbsPaths, outputAbsPath }) {
  if (!Array.isArray(inputAbsPaths) || inputAbsPaths.length === 0) {
    throw new Error("No video segments provided for concat");
  }
  if (inputAbsPaths.length === 1) {
    await fs.promises.copyFile(inputAbsPaths[0], outputAbsPath);
    return;
  }

  const listPath = path.join(TMP_DIR, `${crypto.randomUUID()}-concat.txt`);
  const listContent = inputAbsPaths
    .map((p) => `file '${String(p).replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fs.promises.writeFile(listPath, `${listContent}\n`, "utf8");

  try {
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outputAbsPath,
    ]);
  } finally {
    await fs.promises.unlink(listPath).catch(() => {});
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      aiva_video_count INTEGER NOT NULL DEFAULT 0,
      aiva_bonus_videos INTEGER NOT NULL DEFAULT 0,
      aiva_reward_ad_views INTEGER NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS aiva_video_count INTEGER NOT NULL DEFAULT 0;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS aiva_bonus_videos INTEGER NOT NULL DEFAULT 0;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS aiva_reward_ad_views INTEGER NOT NULL DEFAULT 0;
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
    ADD COLUMN IF NOT EXISTS profile_picture TEXT;
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
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE auth_challenges
    ADD COLUMN IF NOT EXISTS meta JSONB;
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feed_item_likes (
      feed_item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (feed_item_id, user_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS feed_item_likes_user_idx
    ON feed_item_likes (user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feed_item_views (
      feed_item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      view_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (feed_item_id, user_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS feed_item_views_user_idx
    ON feed_item_views (user_id, last_viewed_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_following (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, username)
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_following_user_username_lower_unique
    ON user_following (user_id, LOWER(username));
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
    createdAt: row.created_at,
    uri: toAbsoluteAssetUrl(row.uri, baseUrl),
    poster: toAbsoluteAssetUrl(row.poster, baseUrl),
    likes: row.likes,
    comments: row.comments ?? [],
    commentsCount: row.comments_count ?? 0,
    isLiked: Boolean(row.is_liked),
    hasSeen: Boolean(row.has_seen),
    userViewCount: Number(row.user_view_count || 0),
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

async function createAivaMvpVideo({
  title,
  promptText,
  promptImageUrl,
  promptImageUrls,
} = {}) {
  await ensureFfmpegInstalled();
  const resolvedPromptImageUrl =
    promptImageUrl || AIVA_PROMPT_IMAGE_URL || null;
  const resolvedPromptImageUrls = Array.isArray(promptImageUrls)
    ? promptImageUrls.filter(Boolean)
    : [];
  const imageUrlsToUse =
    resolvedPromptImageUrls.length > 0
      ? resolvedPromptImageUrls
      : [resolvedPromptImageUrl].filter(Boolean);

  if (imageUrlsToUse.length === 0) {
    throw new Error("At least one image is required");
  }
  if (imageUrlsToUse.length > AIVA_MAX_IMAGES) {
    throw new Error(`You can upload up to ${AIVA_MAX_IMAGES} images`);
  }
  const sourceScript = String(promptText || "").trim();
  if (!sourceScript) {
    throw new Error("Script text is required");
  }
  const totalDurationSeconds = imageUrlsToUse.length * AIVA_SECONDS_PER_IMAGE;
  const narrationScript = await rewriteNarrationWithGpt({
    title,
    promptText: sourceScript,
    targetSeconds: totalDurationSeconds,
  });

  const runId = crypto.randomUUID();
  const segmentPaths = [];
  const tempPaths = [];
  const downloadedImagePaths = [];

  try {
    for (let i = 0; i < imageUrlsToUse.length; i += 1) {
      const imageAbsPath = await resolveImageToTempPath(
        imageUrlsToUse[i],
        runId,
        i + 1
      );
      if (imageAbsPath.startsWith(TMP_DIR)) {
        downloadedImagePaths.push(imageAbsPath);
      }
      const segmentPath = path.join(TMP_DIR, `${runId}-segment-${i + 1}.mp4`);
      tempPaths.push(segmentPath);
      await createVideoSegmentFromImage({
        imageAbsPath,
        outputAbsPath: segmentPath,
      });
      segmentPaths.push(segmentPath);
    }

    const slideshowPath = path.join(TMP_DIR, `${runId}-slideshow.mp4`);
    const narrationPath = path.join(TMP_DIR, `${runId}-narration.mp3`);
    tempPaths.push(slideshowPath, narrationPath);

    await concatVideoSegments({
      inputAbsPaths: segmentPaths,
      outputAbsPath: slideshowPath,
    });

    await synthesizeWithElevenLabs({
      text: narrationScript,
      outputAbsPath: narrationPath,
    });

    const finalFileName = `${runId}.mp4`;
    const finalAbsPath = path.join(VIDEOS_DIR, finalFileName);
    await muxVideoWithNarration({
      videoAbsPath: slideshowPath,
      narrationAbsPath: narrationPath,
      outputAbsPath: finalAbsPath,
      durationSeconds: totalDurationSeconds,
    });

    return {
      videoUri: `/uploads/videos/${finalFileName}`,
      posterUrl: imageUrlsToUse[0],
      audioLabel: ELEVENLABS_VOICE_ID ? `ElevenLabs ${ELEVENLABS_VOICE_ID}` : AIVA_AUDIO,
    };
  } finally {
    await Promise.all(
      [...tempPaths, ...downloadedImagePaths].map((p) =>
        fs.promises.unlink(p).catch(() => {})
      )
    );
  }
}

async function ensureAivaVideoForUser(userId, options = {}) {
  const requestedTitle =
    typeof options.title === "string" ? options.title.trim() : "";
  const caption = requestedTitle || "Untitled AIVA video";

  const { rows } = await pool.query(
    "SELECT username, aiva_video_count, aiva_bonus_videos FROM users WHERE id = $1",
    [userId]
  );
  if (!rows[0]) {
    throw new Error("User not found. Please login first.");
  }
  const username = rows[0].username;
  const count = rows[0]?.aiva_video_count ?? 0;
  const limit = resolveAivaVideoLimit(rows[0]);
  if (count >= limit) {
    return { alreadyGenerated: true, remaining: 0, count };
  }

  const { videoUri, posterUrl, audioLabel } = await createAivaMvpVideo({
    title: caption,
    promptText: options.promptText,
    promptImageUrl: options.promptImageUrl,
    promptImageUrls: options.promptImageUrls,
  });
  const localVideoUri = /^https?:\/\//i.test(videoUri)
    ? await downloadVideoToLocal(videoUri)
    : videoUri;
  const id = crypto.randomUUID();

  await pool.query(
    `
      INSERT INTO feed_items
        (id, user_id, username, caption, audio, uri, poster, likes, comments_count, comments, is_aiva)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, '[]'::jsonb, TRUE)
    `,
    [id, userId, username, caption, audioLabel || AIVA_AUDIO, localVideoUri, posterUrl]
  );

  await pool.query(
    "UPDATE users SET aiva_video_count = aiva_video_count + 1 WHERE id = $1",
    [userId]
  );

  return {
    alreadyGenerated: false,
    remaining: Math.max(0, limit - (count + 1)),
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
}) {
  try {
    console.log(`[AIVA] job ${jobId} starting for user ${userId}`);
    await updateJobStatus(jobId, "running");
    const result = await ensureAivaVideoForUser(userId, {
      title,
      promptText,
      promptImageUrls: imageUrls,
    });
    if (result.alreadyGenerated) {
      await updateJobStatus(jobId, "blocked", "AIVA limit reached");
      return;
    }
    await updateJobStatus(jobId, "succeeded");
    console.log(`[AIVA] job ${jobId} succeeded`);
  } catch (error) {
    console.error(
      `[AIVA] job ${jobId} failed during MVP generation pipeline:`,
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
      user: mapUserRow({ id: userId, username, phone, profilePicture: "" }, getRequestBaseUrl(req)),
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
      `SELECT id, username, phone, profile_picture AS "profilePicture"
       FROM users WHERE id = $1 LIMIT 1`,
      [challenge.user_id]
    );
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const token = await issueAuthSession(user.id);
    return res.json({
      ok: true,
      token,
      user: mapUserRow(user, getRequestBaseUrl(req)),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to verify login" });
  }
});

app.post("/auth/change-password/start", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  const phone = normalizePhone(req.authUser.phone);
  const newPassword = String(req.body?.newPassword || "");
  if (!phone) {
    return res.status(400).json({ error: "Current account phone is required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "newPassword must be at least 8 characters" });
  }

  try {
    const challenge = await createAuthChallenge({
      phone,
      purpose: "change_password",
      userId,
      passwordHash: hashSecret(newPassword),
    });
    return res.json({ ok: true, ...challenge });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to start password change" });
  }
});

app.post("/auth/change-password/verify", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  const phone = normalizePhone(req.authUser.phone);
  const code = String(req.body?.code || "").trim();
  if (!phone || !code) {
    return res.status(400).json({ error: "phone and code are required" });
  }

  try {
    const challenge = await consumeLatestAuthChallenge({
      phone,
      purpose: "change_password",
      code,
    });
    if (challenge === false) {
      return res.status(401).json({ error: "Invalid verification code" });
    }
    if (!challenge || challenge.user_id !== userId || !challenge.password_hash) {
      return res.status(400).json({ error: "No active verification code" });
    }

    await pool.query("UPDATE users SET password_hash = $2 WHERE id = $1", [
      userId,
      challenge.password_hash,
    ]);
    await revokeAllSessionsForUser(userId);
    return res.json({ ok: true, loggedOut: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to verify password change" });
  }
});

app.post("/auth/change-phone/start", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  const currentPhone = normalizePhone(req.authUser.phone);
  const newPhone = normalizePhone(req.body?.newPhone);
  if (!currentPhone) {
    return res.status(400).json({ error: "Current account phone is required" });
  }
  if (!newPhone) {
    return res.status(400).json({ error: "newPhone is required" });
  }
  if (newPhone === currentPhone) {
    return res.status(400).json({ error: "newPhone must be different from current phone" });
  }

  try {
    const existing = await pool.query(
      "SELECT id FROM users WHERE phone = $1 AND id <> $2 LIMIT 1",
      [newPhone, userId]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ error: "Phone already registered" });
    }

    const challenge = await createAuthChallenge({
      phone: currentPhone,
      purpose: "change_phone",
      userId,
      meta: { newPhone },
    });
    return res.json({ ok: true, ...challenge });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to start phone change" });
  }
});

app.post("/auth/change-phone/verify", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  const currentPhone = normalizePhone(req.authUser.phone);
  const code = String(req.body?.code || "").trim();
  if (!currentPhone || !code) {
    return res.status(400).json({ error: "phone and code are required" });
  }

  try {
    const challenge = await consumeLatestAuthChallenge({
      phone: currentPhone,
      purpose: "change_phone",
      code,
    });
    if (challenge === false) {
      return res.status(401).json({ error: "Invalid verification code" });
    }
    if (!challenge || challenge.user_id !== userId) {
      return res.status(400).json({ error: "No active verification code" });
    }

    const nextPhone = normalizePhone(challenge?.meta?.newPhone);
    if (!nextPhone) {
      return res.status(400).json({ error: "No new phone is pending verification" });
    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE phone = $1 AND id <> $2 LIMIT 1",
      [nextPhone, userId]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ error: "Phone already registered" });
    }

    await pool.query("UPDATE users SET phone = $2 WHERE id = $1", [
      userId,
      nextPhone,
    ]);
    await revokeAllSessionsForUser(userId);
    return res.json({ ok: true, loggedOut: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to verify phone change" });
  }
});

app.get("/auth/me", requireAuth, async (req, res) => {
  return res.json({
    ok: true,
    user: mapUserRow(req.authUser, getRequestBaseUrl(req)),
  });
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

app.post("/auth/profile-photo", requireAuth, upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "image file is required" });
  }
  const userId = req.authUser.id;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    const profilePicture = `/uploads/${req.file.filename}`;
    const { rows } = await pool.query(
      `
        UPDATE users
        SET profile_picture = $2
        WHERE id = $1
        RETURNING id, username, phone, profile_picture AS "profilePicture"
      `,
      [userId, profilePicture]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({ ok: true, user: mapUserRow(rows[0], getRequestBaseUrl(req)) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to upload profile photo" });
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
  const { title, promptText, imageUrl, imageUrls } =
    req.body || {};
  const userId = req.authUser.id;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  if (!String(title || "").trim()) {
    return res.status(400).json({ error: "title is required" });
  }
  if (!String(promptText || "").trim()) {
    return res.status(400).json({ error: "script is required" });
  }
  const resolvedUrls = Array.isArray(imageUrls)
    ? imageUrls.filter(Boolean)
    : [];
  if (!imageUrl && resolvedUrls.length === 0) {
    return res.status(400).json({ error: "imageUrl(s) are required" });
  }
  const providedUrls = resolvedUrls.length ? resolvedUrls : [imageUrl];
  if (providedUrls.length < 1 || providedUrls.length > AIVA_MAX_IMAGES) {
    return res.status(400).json({
      error: `Provide between 1 and ${AIVA_MAX_IMAGES} images`,
    });
  }
  const invalidUrl = providedUrls.find((url) => {
    const text = String(url || "").trim();
    return !text || (!/^https?:\/\//i.test(text) && !text.startsWith("/uploads/"));
  });
  if (invalidUrl) {
    return res.status(400).json({
      error: "Each imageUrl must be http(s) or /uploads/<file>",
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
      "SELECT aiva_video_count, aiva_bonus_videos FROM users WHERE id = $1",
      [userId]
    );
    const count = rows[0]?.aiva_video_count ?? 0;
    const limit = resolveAivaVideoLimit(rows[0]);
    if (count >= limit) {
      return res.status(403).json({
        ok: false,
        error: "AIVA limit reached",
        count,
        limit,
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
      pool.query(
        "SELECT aiva_video_count, aiva_bonus_videos, aiva_reward_ad_views FROM users WHERE id = $1",
        [userId]
      ),
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

    const count = Number(users[0]?.aiva_video_count ?? 0);
    const limit = resolveAivaVideoLimit(users[0]);
    const rewardAdViews = Number(users[0]?.aiva_reward_ad_views ?? 0);
    const safeRewardAdViews = Number.isFinite(rewardAdViews)
      ? Math.max(0, Math.floor(rewardAdViews))
      : 0;
    const adsTowardNextReward = safeRewardAdViews % AIVA_ADS_PER_REWARDED_VIDEO;
    const adsRemainingForReward =
      AIVA_ADS_PER_REWARDED_VIDEO - adsTowardNextReward;

    return res.json({
      ok: true,
      count,
      limit,
      remaining: Math.max(0, limit - count),
      rewardAdViews: safeRewardAdViews,
      adsTowardNextReward,
      adsRemainingForReward,
      job: jobs[0] || null,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to load status" });
  }
});

app.post("/aiva/reward-ad-view", requireAuth, async (req, res) => {
  const userId = req.authUser.id;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
        SELECT
          aiva_video_count,
          aiva_bonus_videos,
          aiva_reward_ad_views
        FROM users
        WHERE id = $1
        FOR UPDATE
      `,
      [userId]
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }

    const currentAdViews = Number(rows[0]?.aiva_reward_ad_views ?? 0);
    const nextAdViews = Math.max(0, Math.floor(currentAdViews)) + 1;
    const currentBonus = Number(rows[0]?.aiva_bonus_videos ?? 0);
    let nextBonus = Math.max(0, Math.floor(Number.isFinite(currentBonus) ? currentBonus : 0));
    let grantedVideo = false;

    const currentLimit = resolveAivaVideoLimit(rows[0]);
    if (
      nextAdViews % AIVA_ADS_PER_REWARDED_VIDEO === 0 &&
      currentLimit < AIVA_MAX_VIDEO_LIMIT
    ) {
      nextBonus += 1;
      grantedVideo = true;
    }

    const update = await client.query(
      `
        UPDATE users
        SET
          aiva_reward_ad_views = $2,
          aiva_bonus_videos = $3
        WHERE id = $1
        RETURNING aiva_video_count, aiva_bonus_videos, aiva_reward_ad_views
      `,
      [userId, nextAdViews, nextBonus]
    );

    await client.query("COMMIT");

    const row = update.rows[0] || {};
    const count = Number(row?.aiva_video_count ?? 0);
    const limit = resolveAivaVideoLimit(row);
    const rewardAdViews = Number(row?.aiva_reward_ad_views ?? 0);
    const safeRewardAdViews = Number.isFinite(rewardAdViews)
      ? Math.max(0, Math.floor(rewardAdViews))
      : 0;
    const adsTowardNextReward = safeRewardAdViews % AIVA_ADS_PER_REWARDED_VIDEO;
    const adsRemainingForReward =
      AIVA_ADS_PER_REWARDED_VIDEO - adsTowardNextReward;

    return res.json({
      ok: true,
      grantedVideo,
      count,
      limit,
      remaining: Math.max(0, limit - count),
      rewardAdViews: safeRewardAdViews,
      adsTowardNextReward,
      adsRemainingForReward,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(error);
    return res.status(500).json({ error: "Failed to reward ad view" });
  } finally {
    client.release();
  }
});

app.post("/aiva/reset-upload-count", requireAuth, async (req, res) => {
  const requesterUserId = req.authUser.id;
  if (!requesterUserId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    const requesterPhone = normalizePhone(req.authUser.phone);
    if (!requesterPhone) {
      return res.status(403).json({
        error: "Only the phone number associated with andrewr can reset upload count",
      });
    }

    const { rows: andrewRows } = await pool.query(
      "SELECT phone FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1",
      ["andrewr"]
    );
    const andrewPhone = normalizePhone(andrewRows[0]?.phone);
    if (!andrewPhone || andrewPhone !== requesterPhone) {
      return res.status(403).json({
        error: "Only the phone number associated with andrewr can reset upload count",
      });
    }

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

app.get("/following", requireAuth, async (req, res) => {
  const userId = String(req.authUser?.id || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT username
        FROM user_following
        WHERE user_id = $1
        ORDER BY LOWER(username) ASC
      `,
      [userId]
    );
    return res.json({
      ok: true,
      usernames: rows
        .map((row) => String(row.username || "").trim())
        .filter(Boolean),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to load following" });
  }
});

app.post("/following/:username", requireAuth, async (req, res) => {
  const userId = String(req.authUser?.id || "").trim();
  const requesterUsername = String(req.authUser?.username || "").trim();
  const targetUsername = String(req.params?.username || "").trim();
  const following = Boolean(req.body?.following);

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  if (!targetUsername) {
    return res.status(400).json({ error: "username is required" });
  }
  if (requesterUsername && requesterUsername.toLowerCase() === targetUsername.toLowerCase()) {
    return res.status(400).json({ error: "Cannot follow yourself" });
  }

  try {
    if (following) {
      await pool.query(
        `
          INSERT INTO user_following (user_id, username)
          SELECT $1, $2
          WHERE NOT EXISTS (
            SELECT 1
            FROM user_following
            WHERE user_id = $1
              AND LOWER(username) = LOWER($2)
          )
        `,
        [userId, targetUsername]
      );
    } else {
      await pool.query(
        `
          DELETE FROM user_following
          WHERE user_id = $1
            AND LOWER(username) = LOWER($2)
        `,
        [userId, targetUsername]
      );
    }

    const { rows } = await pool.query(
      `
        SELECT username
        FROM user_following
        WHERE user_id = $1
        ORDER BY LOWER(username) ASC
      `,
      [userId]
    );

    return res.json({
      ok: true,
      following,
      usernames: rows
        .map((row) => String(row.username || "").trim())
        .filter(Boolean),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to update following" });
  }
});

app.post("/feed/:id/like", requireAuth, async (req, res) => {
  const postId = String(req.params?.id || "").trim();
  const userId = req.authUser?.id;
  const liked = Boolean(req.body?.liked);

  if (!postId) {
    return res.status(400).json({ error: "post id is required" });
  }
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const itemCheck = await client.query(
      "SELECT id FROM feed_items WHERE id = $1 FOR UPDATE",
      [postId]
    );
    if (!itemCheck.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Feed item not found" });
    }

    let delta = 0;
    if (liked) {
      const insertResult = await client.query(
        `
          INSERT INTO feed_item_likes (feed_item_id, user_id)
          VALUES ($1, $2)
          ON CONFLICT (feed_item_id, user_id) DO NOTHING
        `,
        [postId, userId]
      );
      delta = insertResult.rowCount > 0 ? 1 : 0;
    } else {
      const deleteResult = await client.query(
        `
          DELETE FROM feed_item_likes
          WHERE feed_item_id = $1 AND user_id = $2
        `,
        [postId, userId]
      );
      delta = deleteResult.rowCount > 0 ? -1 : 0;
    }

    const update = await client.query(
      `
        UPDATE feed_items
        SET likes = GREATEST(0, likes + $2)
        WHERE id = $1
        RETURNING likes
      `,
      [postId, delta]
    );
    await client.query("COMMIT");

    return res.json({
      ok: true,
      id: postId,
      isLiked: liked,
      likes: update.rows[0]?.likes ?? 0,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(error);
    return res.status(500).json({ error: "Failed to update like" });
  } finally {
    client.release();
  }
});

app.post("/feed/:id/comments", requireAuth, async (req, res) => {
  const postId = String(req.params?.id || "").trim();
  const user = String(req.authUser?.username || "").trim();
  const text = String(req.body?.text || "").trim();

  if (!postId) {
    return res.status(400).json({ error: "post id is required" });
  }
  if (!text) {
    return res.status(400).json({ error: "comment text is required" });
  }
  if (text.length > 500) {
    return res.status(400).json({ error: "comment text must be <= 500 chars" });
  }

  const comment = {
    id: crypto.randomUUID(),
    user: user || "unknown",
    text,
    likes: 0,
    createdAt: new Date().toISOString(),
  };

  try {
    const result = await pool.query(
      `
        UPDATE feed_items
        SET
          comments = jsonb_build_array($2::jsonb) || comments,
          comments_count = comments_count + 1
        WHERE id = $1
        RETURNING comments_count
      `,
      [postId, JSON.stringify(comment)]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Feed item not found" });
    }

    return res.json({
      ok: true,
      id: postId,
      comment,
      commentsCount: result.rows[0].comments_count ?? 0,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to add comment" });
  }
});

app.post("/feed/:id/view", requireAuth, async (req, res) => {
  const postId = String(req.params?.id || "").trim();
  const userId = req.authUser?.id;

  if (!postId) {
    return res.status(400).json({ error: "post id is required" });
  }
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    const itemCheck = await pool.query(
      "SELECT id FROM feed_items WHERE id = $1 LIMIT 1",
      [postId]
    );
    if (!itemCheck.rows[0]) {
      return res.status(404).json({ error: "Feed item not found" });
    }

    const result = await pool.query(
      `
        INSERT INTO feed_item_views (feed_item_id, user_id, view_count, last_viewed_at)
        VALUES ($1, $2, 1, NOW())
        ON CONFLICT (feed_item_id, user_id) DO UPDATE
          SET view_count = feed_item_views.view_count + 1,
              last_viewed_at = NOW()
        RETURNING view_count, last_viewed_at
      `,
      [postId, userId]
    );

    return res.json({
      ok: true,
      id: postId,
      hasSeen: true,
      userViewCount: Number(result.rows[0]?.view_count || 0),
      lastViewedAt: result.rows[0]?.last_viewed_at || null,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to record view" });
  }
});

app.delete("/feed/:id", requireAuth, async (req, res) => {
  const postId = String(req.params?.id || "").trim();
  const requesterUserId = String(req.authUser?.id || "").trim();
  const requesterUsername = String(req.authUser?.username || "").trim().toLowerCase();

  if (!postId) {
    return res.status(400).json({ error: "post id is required" });
  }
  if (!requesterUserId || !requesterUsername) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const itemResult = await pool.query(
      `
        SELECT id, user_id, username, uri
        FROM feed_items
        WHERE id = $1
        LIMIT 1
      `,
      [postId]
    );
    const item = itemResult.rows[0];
    if (!item) {
      return res.status(404).json({ error: "Feed item not found" });
    }

    const ownerUserId = String(item.user_id || "").trim();
    const ownerUsername = String(item.username || "").trim().toLowerCase();
    const canDelete =
      requesterUsername === "andrewr" ||
      (ownerUserId && ownerUserId === requesterUserId) ||
      ownerUsername === requesterUsername;
    if (!canDelete) {
      return res.status(403).json({ error: "Not allowed to delete this video" });
    }

    await pool.query("DELETE FROM feed_items WHERE id = $1", [postId]);

    const uri = String(item.uri || "").trim();
    if (uri.startsWith("/uploads/videos/")) {
      const rel = uri.replace(/^\/+/, "");
      const abs = path.join(__dirname, rel);
      if (abs.startsWith(VIDEOS_DIR)) {
        await fs.promises.unlink(abs).catch(() => {});
      }
    }

    return res.json({ ok: true, id: postId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to delete feed item" });
  }
});

app.delete("/channels/:username", requireAuth, async (req, res) => {
  const requesterUsername = String(req.authUser?.username || "").trim().toLowerCase();
  const targetUsername = String(req.params?.username || "").trim();
  if (!targetUsername) {
    return res.status(400).json({ error: "username is required" });
  }
  if (requesterUsername !== "andrewr") {
    return res.status(403).json({ error: "Only andrewr can delete a channel" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const targetResult = await client.query(
      `
        SELECT id, username
        FROM users
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1
      `,
      [targetUsername]
    );
    const target = targetResult.rows[0];
    if (!target) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Channel not found" });
    }

    const deletedVideosResult = await client.query(
      `
        DELETE FROM feed_items
        WHERE user_id = $1 OR LOWER(username) = LOWER($2)
        RETURNING uri
      `,
      [target.id, target.username]
    );

    await client.query("DELETE FROM auth_sessions WHERE user_id = $1", [target.id]);
    await client.query("DELETE FROM auth_challenges WHERE user_id = $1", [target.id]);
    await client.query("DELETE FROM aiva_jobs WHERE user_id = $1", [target.id]);
    await client.query("DELETE FROM users WHERE id = $1", [target.id]);
    await client.query("COMMIT");

    const uris = deletedVideosResult.rows.map((row) => String(row.uri || "").trim());
    for (const uri of uris) {
      if (!uri.startsWith("/uploads/videos/")) continue;
      const rel = uri.replace(/^\/+/, "");
      const abs = path.join(__dirname, rel);
      if (!abs.startsWith(VIDEOS_DIR)) continue;
      await fs.promises.unlink(abs).catch(() => {});
    }

    return res.json({
      ok: true,
      username: target.username,
      deletedVideos: deletedVideosResult.rowCount || 0,
      deletedChannel: true,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(error);
    return res.status(500).json({ error: "Failed to delete channel" });
  } finally {
    client.release();
  }
});

app.get("/feed", async (req, res) => {
  const userId = req.query.userId ? String(req.query.userId) : null;

  try {
    let query = "";
    let params = [];

    if (userId) {
      query = `
        SELECT
          f.*,
          (fil.user_id IS NOT NULL) AS is_liked,
          (fiv.user_id IS NOT NULL) AS has_seen,
          COALESCE(fiv.view_count, 0) AS user_view_count
        FROM feed_items f
        LEFT JOIN feed_item_likes fil
          ON fil.feed_item_id = f.id
          AND fil.user_id = $1
        LEFT JOIN feed_item_views fiv
          ON fiv.feed_item_id = f.id
          AND fiv.user_id = $1
        ORDER BY
          CASE WHEN f.user_id = $1 THEN 0 ELSE 1 END,
          f.created_at DESC
      `;
      params = [userId];
    } else {
      query = `
        SELECT
          f.*,
          FALSE AS is_liked,
          FALSE AS has_seen,
          0 AS user_view_count
        FROM feed_items f
        WHERE f.user_id IS NULL
        ORDER BY f.created_at DESC
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
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Feed server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
