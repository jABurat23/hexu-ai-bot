require("dotenv").config();

const required = [
  "PAGE_ACCESS_TOKEN",
  "WEBHOOK_VERIFY_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const nodeEnv = process.env.NODE_ENV || "development";
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env and fill these in.");
  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  console.warn(
    "GEMINI_API_KEY not set — commands will work, but !ai will fail until it's added."
  );
}

if (!process.env.APP_SECRET && nodeEnv === "production") {
  console.error("APP_SECRET is required when NODE_ENV=production.");
  process.exit(1);
}

if (!process.env.APP_SECRET) {
  console.warn(
    "APP_SECRET not set — webhook signature verification is DISABLED. Fine for early local testing, not for production."
  );
}

module.exports = {
  pageAccessToken: process.env.PAGE_ACCESS_TOKEN,
  webhookVerifyToken: process.env.WEBHOOK_VERIFY_TOKEN,
  appSecret: process.env.APP_SECRET || null,
  nodeEnv,
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  geminiSystemPrompt:
    process.env.GEMINI_SYSTEM_PROMPT ||
    "You are Hexu AI, a friendly, concise assistant chatting over Facebook Messenger. Keep replies short and conversational.",
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  port: process.env.PORT || 3000,
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS) || 10000,
  queueMaxSize: Number(process.env.QUEUE_MAX_SIZE) || 100,
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY) || 3,
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS) || 30000,
  // LOG_LEVEL: debug | info | warn | error (default info — set to debug
  // locally when you need to see every message's text/branch decision).
  logLevel: process.env.LOG_LEVEL || "info",
  // Set LOG_COLOR=false if your log viewer doesn't render ANSI colors well.
  logColor: process.env.LOG_COLOR !== "false",
  ownerPsid: process.env.OWNER_PSID || null,
  // Keep-alive: periodic self-ping to avoid Render free-tier spin-down.
  // RENDER_EXTERNAL_URL is set automatically by Render for every web
  // service — EXTERNAL_URL is a manual override for other hosts. Default
  // interval is 5 min, comfortably under Render's 15-min idle window.
  keepAliveEnabled: process.env.KEEP_ALIVE !== "false",
  keepAliveIntervalMs: Number(process.env.KEEP_ALIVE_INTERVAL_MS) || 5 * 60 * 1000,
  externalUrl: process.env.RENDER_EXTERNAL_URL || process.env.EXTERNAL_URL || null,
  // Optional: if set, /dashboard requires ?token=<this value>. If unset,
  // the dashboard is open to anyone with the URL — fine for a private
  // bot, worth setting once the URL might leak anywhere public.
  dashboardToken: process.env.DASHBOARD_TOKEN || null,
};