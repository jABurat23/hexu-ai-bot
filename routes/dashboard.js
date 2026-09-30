const crypto = require("crypto");
const express = require("express");
const config = require("../config");
const commandLoader = require("../lib/commandLoader");
const { snapshot, topCommands } = require("../utils/metrics");
const contextCache = require("../utils/contextCache");
const runtimeSettings = require("../utils/runtimeSettings");
const keepAlive = require("../utils/keep-alive");
const { messageQueue } = require("./webhook");
const logger = require("../utils/logger");

if (!config.dashboardToken) {
  logger.warn(
    "dashboard",
    "DASHBOARD_TOKEN not set — /dashboard is open to anyone with the URL. Fine for now, set a token before sharing the link anywhere public."
  );
}

const router = express.Router();

// ---------------------------------------------------------------------
// Auth: token-in-URL exchanges for a short-lived session cookie
// ---------------------------------------------------------------------
//
// The first request into the dashboard carries ?token=... (that's how you
// log in). If it matches, a random session id is issued as an HttpOnly,
// SameSite=Strict cookie, and every request after that — including all
// the fetch() calls the page itself makes — is authenticated by the
// cookie instead. That keeps the actual token out of every XHR URL (and
// so out of access logs / browser history beyond the very first load),
// and SameSite=Strict means a cross-site page can't get the browser to
// send this cookie at all, which is what closes off classic CSRF here.
//
// Sessions are server-side only (an in-memory Map, not a signed/JWT
// cookie) so they can be revoked instantly — see /api/logout — and are
// lost on restart, which just means logging in again with the token.

const SESSION_COOKIE_NAME = "hexu_dash_session";
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000; // sliding: 2h of inactivity logs you out
const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000; // hard cap regardless of activity
const sessions = new Map(); // sessionId -> { expiresAt, absoluteExpiresAt }

// Basic brute-force throttle: too many wrong tokens from one IP within the
// window gets a 429 instead of continuing to check guesses.
const AUTH_WINDOW_MS = 5 * 60 * 1000;
const AUTH_MAX_FAILURES = 10;
const failuresByIp = new Map(); // ip -> { count, windowStart }

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function tokensMatch(provided, expected) {
  // Compare fixed-length digests, not the raw strings — this avoids
  // leaking both the token's value and its length through timing.
  return crypto.timingSafeEqual(hash(provided), hash(expected));
}

function isRateLimited(ip) {
  const entry = failuresByIp.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > AUTH_WINDOW_MS) {
    failuresByIp.delete(ip);
    return false;
  }
  return entry.count >= AUTH_MAX_FAILURES;
}

function recordAuthFailure(ip) {
  const entry = failuresByIp.get(ip);
  if (!entry || Date.now() - entry.windowStart > AUTH_WINDOW_MS) {
    failuresByIp.set(ip, { count: 1, windowStart: Date.now() });
  } else {
    entry.count += 1;
  }
}

// Express doesn't parse incoming cookies without the cookie-parser
// package, and we only ever need to read one — not worth a dependency.
function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function hasValidSession(req) {
  const sessionId = getCookie(req, SESSION_COOKIE_NAME);
  if (!sessionId) return false;
  const session = sessions.get(sessionId);
  if (!session) return false;

  const now = Date.now();
  if (now > session.expiresAt || now > session.absoluteExpiresAt) {
    sessions.delete(sessionId);
    return false;
  }
  // Sliding idle window, but never past the absolute cap.
  session.expiresAt = Math.min(now + SESSION_IDLE_MS, session.absoluteExpiresAt);
  return true;
}

function createSession(res) {
  const sessionId = crypto.randomBytes(32).toString("hex"); // 256 bits, unguessable
  const now = Date.now();
  sessions.set(sessionId, {
    expiresAt: now + SESSION_IDLE_MS,
    absoluteExpiresAt: now + SESSION_ABSOLUTE_MS,
  });
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true, // page JS (or any injected script) can never read it
    sameSite: "strict", // never sent on cross-site requests — blocks CSRF
    secure: config.nodeEnv === "production", // HTTPS-only on Render; plain http still works locally
    maxAge: SESSION_ABSOLUTE_MS,
  });
}

function destroySession(req, res) {
  const sessionId = getCookie(req, SESSION_COOKIE_NAME);
  if (sessionId) sessions.delete(sessionId);
  res.clearCookie(SESSION_COOKIE_NAME);
}

// Expired sessions are already rejected on use; this just keeps the Map
// from accumulating dead entries from browsers that never came back.
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now > session.expiresAt || now > session.absoluteExpiresAt) sessions.delete(id);
  }
}, 30 * 60 * 1000).unref();

function checkAuth(req, res, next) {
  if (!config.dashboardToken) return next();

  // A valid session cookie skips the token entirely, and deliberately
  // isn't subject to the brute-force limiter below — there's nothing
  // guessable here, a session id is 256 random bits.
  if (hasValidSession(req)) return next();

  if (isRateLimited(req.ip)) {
    logger.warn("dashboard", `Auth rate-limited for ${req.ip}.`);
    return res.status(429).type("text/plain").send("Too many failed attempts. Try again later.");
  }

  const provided = req.query.token || "";
  if (provided && tokensMatch(provided, config.dashboardToken)) {
    createSession(res);
    return next();
  }

  recordAuthFailure(req.ip);
  if (req.accepts("html") && (req.path === "/" || req.path === "")) {
    return res.status(401).type("text/html").send(renderLoginPage(provided ? "Invalid token." : ""));
  }
  res.status(401).type("text/plain").send("Unauthorized. Add ?token=YOUR_DASHBOARD_TOKEN to the URL.");
}

function formatUptime(totalSeconds) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

// Server-side cache: multiple open dashboard tabs (or a fast manual
// refresh) reuse the same snapshot instead of recomputing every hit.
const STATS_CACHE_TTL_MS = 10_000;
let cachedStats = null;
let cachedStatsAt = 0;

function computeStatus(queueAccepting, events, commandsFailed, aiFailures) {
  if (!queueAccepting) return "down";
  const totalEvents = events.completed + events.failed;
  const failureRate = totalEvents > 0 ? events.failed / totalEvents : 0;
  if (failureRate > 0.1 || commandsFailed > 0 || aiFailures > 0) return "degraded";
  return "healthy";
}

function getStats() {
  if (cachedStats && Date.now() - cachedStatsAt < STATS_CACHE_TTL_MS) {
    return cachedStats;
  }

  const m = snapshot();
  const cmd = commandLoader.getCacheStats();
  const queue = messageQueue.getStats();
  const events = {
    received: m.eventsReceived,
    completed: m.eventsCompleted,
    failed: m.eventsFailed,
    avgMs: m.averageEventDurationMs,
  };

  cachedStats = {
    status: computeStatus(queue.accepting, events, m.commandsFailed, m.aiFailures),
    uptime: formatUptime(m.uptimeSeconds),
    nodeEnv: config.nodeEnv,
    commands: {
      total: cmd.commandCount,
      categories: cmd.categoryCount,
      loadCount: cmd.loadCount,
    },
    topCommands: topCommands(5),
    events,
    commandRuns: { run: m.commandsRun, failed: m.commandsFailed },
    ai: { replies: m.aiReplies, failures: m.aiFailures },
    aiContext: contextCache.getStats(),
    queue,
    keepAlive: keepAlive.getStatus(),
  };
  cachedStatsAt = Date.now();
  return cachedStats;
}

function invalidateStatsCache() {
  cachedStats = null;
}

// ---------------------------------------------------------------------
// Stats (read-only)
// ---------------------------------------------------------------------

router.get("/api/stats", checkAuth, (req, res) => {
  logger.debug("dashboard", `GET /dashboard/api/stats from ${req.ip}`);
  res.set("Cache-Control", "no-store");
  res.json(getStats());
});

// Deliberately not cached like stats are — a "live" log view that serves a
// 10-second-old snapshot defeats its own purpose.
router.get("/api/logs", checkAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ logs: logger.getRecentLogs() });
});

// POST, not GET, like every other state-changing route here — otherwise a
// stray <img src=".../logout"> on any page could silently log you out.
router.post("/api/logout", checkAuth, (req, res) => {
  destroySession(req, res);
  logger.info("dashboard", `Session logged out (${req.ip}).`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Commands: hot reload, hide/unhide, disable/enable, soft-delete
// ---------------------------------------------------------------------

// Mutating action, so POST (not GET) — a GET-triggered reload could fire
// from a stray <img>/prefetch or show up in server/proxy access logs and
// browser history with the token attached. Same applies to every other
// mutating endpoint below.
router.post("/api/reload", checkAuth, (req, res) => {
  const force = req.body?.force === true;
  logger.info("dashboard", `POST /dashboard/api/reload from ${req.ip} (force=${force})`);
  const result = commandLoader.reloadCommands(force);
  invalidateStatsCache();
  res.json(result);
});

router.get("/api/commands", checkAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ commands: commandLoader.getAllCommandsForAdmin() });
});

router.post("/api/commands/:name/hide", checkAuth, async (req, res) => {
  const { name } = req.params;
  const hidden = req.body?.hidden !== false; // default true — POSTing here means "hide" unless told otherwise
  try {
    if (hidden) await commandLoader.hideCommand(name);
    else await commandLoader.unhideCommand(name);
    logger.info("dashboard", `${hidden ? "Hid" : "Unhid"} !${name} (${req.ip}).`);
    invalidateStatsCache();
    res.json({ ok: true, name, hidden });
  } catch (err) {
    // Distinguish "no such command" (client error) from a DB persist
    // failure (the change IS applied in-memory, just won't survive a
    // restart) — the dashboard should say so, not claim outright failure.
    if (err.message?.startsWith("No command named")) {
      res.status(404).json({ ok: false, error: err.message });
    } else {
      res.status(200).json({
        ok: true,
        name,
        hidden,
        warning: `Applied, but couldn't save to the database: ${err.message}. This will not survive a restart.`,
      });
    }
  }
});

router.post("/api/commands/:name/disable", checkAuth, async (req, res) => {
  const { name } = req.params;
  const disabled = req.body?.disabled !== false;
  try {
    if (disabled) await commandLoader.disableCommand(name);
    else await commandLoader.enableCommand(name);
    logger.info("dashboard", `${disabled ? "Disabled" : "Enabled"} !${name} (${req.ip}).`);
    invalidateStatsCache();
    res.json({ ok: true, name, disabled });
  } catch (err) {
    if (err.message?.startsWith("No command named")) {
      res.status(404).json({ ok: false, error: err.message });
    } else {
      res.status(200).json({
        ok: true,
        name,
        disabled,
        warning: `Applied, but couldn't save to the database: ${err.message}. This will not survive a restart.`,
      });
    }
  }
});

// ---------------------------------------------------------------------
// Settings: log level, AI persona, keep-alive interval
// ---------------------------------------------------------------------

router.get("/api/settings", checkAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ...runtimeSettings.getAll(),
    keepAlive: keepAlive.getStatus(),
  });
});

// Validation failures (bad level, empty persona, interval too low) mean
// nothing was applied — a real 400. Anything else here is a DB write that
// failed AFTER the setter already updated the in-memory value, so that's
// "saved with a caveat" (200 + warning), not an outright failure — same
// distinction already made for the command hide/disable routes above.
function respondSettingError(err, res, extra = {}) {
  if (err instanceof runtimeSettings.SettingValidationError) {
    return res.status(400).json({ ok: false, error: err.message });
  }
  return res.status(200).json({
    ok: true,
    ...extra,
    warning: `Applied, but couldn't save to the database: ${err.message}. This will not survive a restart.`,
  });
}

router.post("/api/settings/log-level", checkAuth, async (req, res) => {
  try {
    await runtimeSettings.setLogLevel(req.body?.level);
    logger.info("dashboard", `Log level set to ${req.body?.level} (${req.ip}).`);
    res.json({ ok: true, logLevel: runtimeSettings.getLogLevel() });
  } catch (err) {
    respondSettingError(err, res, { logLevel: runtimeSettings.getLogLevel() });
  }
});

router.post("/api/settings/persona", checkAuth, async (req, res) => {
  try {
    await runtimeSettings.setGeminiSystemPrompt(req.body?.prompt);
    logger.info("dashboard", `Persona updated (${req.ip}).`);
    res.json({ ok: true, geminiSystemPrompt: runtimeSettings.getGeminiSystemPrompt() });
  } catch (err) {
    respondSettingError(err, res, { geminiSystemPrompt: runtimeSettings.getGeminiSystemPrompt() });
  }
});

router.post("/api/settings/persona/reset", checkAuth, async (req, res) => {
  try {
    await runtimeSettings.resetGeminiSystemPrompt();
    logger.info("dashboard", `Persona reset to default (${req.ip}).`);
    res.json({ ok: true, geminiSystemPrompt: runtimeSettings.getGeminiSystemPrompt() });
  } catch (err) {
    respondSettingError(err, res, { geminiSystemPrompt: runtimeSettings.getGeminiSystemPrompt() });
  }
});

router.post("/api/settings/keep-alive-interval", checkAuth, async (req, res) => {
  try {
    const minutes = Number(req.body?.minutes);
    const result = await runtimeSettings.setKeepAliveIntervalMs(minutes * 60_000);
    keepAlive.restart(); // apply the new interval to the running timer right away
    logger.info("dashboard", `Keep-alive interval set to ${minutes} min (${req.ip}).`);
    invalidateStatsCache();
    res.json({ ok: true, status: keepAlive.getStatus(), warning: result.warning });
  } catch (err) {
    // A validation error (interval too low) never touched the value, so
    // there's nothing to restart. A DB-write failure DID already update
    // it in-memory, so the running timer needs to catch up.
    if (!(err instanceof runtimeSettings.SettingValidationError)) keepAlive.restart();
    respondSettingError(err, res, { status: keepAlive.getStatus() });
  }
});

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

router.get("/", checkAuth, (req, res) => {
  logger.debug("dashboard", `GET /dashboard from ${req.ip}`);
  res.set("Cache-Control", "no-store");
  res.type("text/html").send(renderPage());
});

function renderLoginPage(errorMsg = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hexu AI — Sign In</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace, sans-serif;
    background: #0d1117;
    color: #e6edf3;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1.5rem;
  }
  .login-card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 2rem;
    width: 100%;
    max-width: 360px;
  }
  h1 { font-size: 1.15rem; font-weight: 600; margin-bottom: 0.25rem; letter-spacing: -0.01em; }
  .sub { font-size: 0.8rem; color: #7d8590; margin-bottom: 1.5rem; }
  label { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: #7d8590; margin-bottom: 0.4rem; font-weight: 600; }
  input[type="password"] {
    width: 100%;
    padding: 0.5rem 0.7rem;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 5px;
    color: #e6edf3;
    font-size: 0.85rem;
    font-family: monospace;
    outline: none;
    margin-bottom: 1rem;
  }
  input:focus { border-color: #58a6ff; }
  button {
    width: 100%;
    padding: 0.55rem;
    background: #238636;
    border: 1px solid #2ea043;
    border-radius: 5px;
    color: #fff;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
  }
  button:hover { background: #2ea043; }
  .err { font-size: 0.78rem; color: #f85149; margin-top: 0.75rem; text-align: center; }
</style>
</head>
<body>
  <div class="login-card">
    <h1>Hexu AI</h1>
    <p class="sub">Dashboard Authentication</p>
    <form onsubmit="handleLogin(event)">
      <label for="tokenInput">Access Token</label>
      <input type="password" id="tokenInput" placeholder="Paste DASHBOARD_TOKEN" required autofocus />
      <button type="submit">Sign In</button>
      ${errorMsg ? `<div class="err">${errorMsg}</div>` : ""}
    </form>
  </div>
  <script>
    function handleLogin(e) {
      e.preventDefault();
      const token = document.getElementById("tokenInput").value.trim();
      if (!token) return;
      window.location.href = window.location.pathname + "?token=" + encodeURIComponent(token);
    }
  </script>
</body>
</html>`;
}

function renderPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hexu AI — Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0d1117;
    color: #e6edf3;
    font-size: 0.85rem;
    line-height: 1.5;
    padding-bottom: 3rem;
  }
  .container {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.5rem 1rem;
  }
  /* Top Header */
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 1rem;
    border-bottom: 1px solid #21262d;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .brand h1 {
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .badge {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    background: #161b22;
    border: 1px solid #30363d;
    color: #7d8590;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .badge-healthy { color: #3fb950; border-color: rgba(63, 185, 80, 0.3); }
  .badge-degraded { color: #d29922; border-color: rgba(210, 153, 34, 0.3); }
  .badge-down { color: #f85149; border-color: rgba(248, 81, 73, 0.3); }

  /* Navigation Bar */
  nav {
    display: flex;
    gap: 0.25rem;
    background: #161b22;
    padding: 0.2rem;
    border-radius: 6px;
    border: 1px solid #30363d;
  }
  nav button {
    background: transparent;
    border: none;
    color: #7d8590;
    font-size: 0.8rem;
    font-weight: 500;
    padding: 0.35rem 0.75rem;
    border-radius: 4px;
    cursor: pointer;
    transition: color 0.1s, background 0.1s;
  }
  nav button:hover { color: #e6edf3; }
  nav button.active {
    background: #21262d;
    color: #e6edf3;
    font-weight: 600;
  }

  /* Utility Actions */
  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  button.btn {
    font: inherit;
    font-size: 0.78rem;
    font-weight: 500;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 5px;
    padding: 0.35rem 0.65rem;
    color: #c9d1d9;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  button.btn:hover { background: #30363d; color: #fff; }
  button.btn-primary { background: #238636; border-color: #2ea043; color: #fff; }
  button.btn-primary:hover { background: #2ea043; }
  button.btn-danger { color: #f85149; }
  button.btn-danger:hover { background: rgba(248, 81, 73, 0.1); border-color: #f85149; }

  /* Tab Panels */
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }

  /* Metric KPI Grid */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }
  .card {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 6px;
    padding: 0.85rem 1rem;
  }
  .card-title {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #7d8590;
    margin-bottom: 0.4rem;
  }
  .card-metric {
    font-size: 1.25rem;
    font-weight: 600;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #e6edf3;
    margin-bottom: 0.35rem;
  }
  .card-rows {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.76rem;
    color: #7d8590;
  }
  .card-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .card-row span:last-child {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #c9d1d9;
  }
  .card-row .bad { color: #f85149; font-weight: 600; }

  /* Section Headers */
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 1.25rem 0 0.6rem 0;
  }
  .section-head h2 {
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #7d8590;
  }

  /* Tables */
  .table-wrap {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 6px;
    overflow-x: auto;
    margin-bottom: 1rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    text-align: left;
  }
  th {
    background: #1c2128;
    color: #7d8590;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid #30363d;
  }
  td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #21262d;
    color: #c9d1d9;
  }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255, 255, 255, 0.02); }
  .cmd-name {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-weight: 600;
    color: #58a6ff;
  }
  .tag {
    font-size: 0.68rem;
    font-weight: 600;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    margin-left: 0.35rem;
    display: inline-block;
  }
  .tag-hidden { background: rgba(88, 166, 255, 0.12); color: #58a6ff; }
  .tag-disabled { background: rgba(248, 81, 73, 0.12); color: #f85149; }
  .tag-role { background: #21262d; color: #7d8590; font-family: monospace; }
  .role-admin { color: #d29922; background: rgba(210, 153, 34, 0.12); }
  .role-owner { color: #f0883e; background: rgba(240, 136, 62, 0.12); }

  /* Forms & Settings */
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .panel {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 6px;
    padding: 1rem;
  }
  .panel h3 {
    font-size: 0.85rem;
    font-weight: 600;
    color: #e6edf3;
    margin-bottom: 0.25rem;
  }
  .panel-sub {
    font-size: 0.75rem;
    color: #7d8590;
    margin-bottom: 0.85rem;
  }
  .form-group {
    margin-bottom: 0.85rem;
  }
  .form-group label {
    display: block;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    color: #7d8590;
    margin-bottom: 0.35rem;
  }
  select, input[type="text"], input[type="number"], textarea {
    width: 100%;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 5px;
    color: #e6edf3;
    font: inherit;
    font-size: 0.82rem;
    padding: 0.45rem 0.65rem;
    outline: none;
  }
  select:focus, input:focus, textarea:focus { border-color: #58a6ff; }
  textarea {
    min-height: 90px;
    resize: vertical;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.78rem;
    line-height: 1.45;
  }
  .info-banner {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 0.65rem 0.85rem;
    font-size: 0.76rem;
    color: #7d8590;
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .info-banner svg { flex-shrink: 0; color: #58a6ff; }
  .result-msg {
    font-size: 0.75rem;
    color: #7d8590;
    margin-top: 0.4rem;
    min-height: 1.2em;
  }

  /* Logs Terminal */
  .log-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .log-filters {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .log-terminal {
    background: #090d13;
    border: 1px solid #21262d;
    border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.74rem;
    line-height: 1.45;
    padding: 0.75rem;
    height: 420px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .log-line { padding: 0.05rem 0; }
  .log-debug { color: #484f58; }
  .log-info { color: #c9d1d9; }
  .log-warn { color: #d29922; }
  .log-error { color: #f85149; }

  /* Footer meta */
  footer {
    margin-top: 1.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.72rem;
    color: #484f58;
    border-top: 1px solid #21262d;
    padding-top: 0.75rem;
  }
</style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header>
      <div class="brand">
        <h1>Hexu AI</h1>
        <span id="statusBadge" class="badge">Loading status…</span>
        <span id="envBadge" class="badge"></span>
      </div>

      <!-- Navigation Tabs -->
      <nav>
        <button class="active" onclick="switchTab('overview')">Overview</button>
        <button onclick="switchTab('commands')">Commands</button>
        <button onclick="switchTab('settings')">Settings</button>
        <button onclick="switchTab('logs')">Logs</button>
      </nav>

      <!-- Action Buttons -->
      <div class="header-actions">
        <button class="btn" onclick="refresh()" title="Refresh stats snapshot">⟳ Refresh</button>
        <button class="btn" onclick="reloadCommands(false)" title="Reload command files">↻ Reload</button>
        <button class="btn btn-danger" onclick="logout()" title="End session">Log out</button>
      </div>
    </header>

    <!-- TAB 1: OVERVIEW -->
    <div id="tab-overview" class="tab-panel active">
      <div class="metrics-grid" id="metricsGrid">
        <div class="card"><div class="card-title">System</div><div class="card-metric">…</div></div>
      </div>

      <div class="section-head">
        <h2>Top Command Activity</h2>
        <span id="topCmdCount" style="font-size: 0.75rem; color: #7d8590;"></span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Command</th>
              <th>Total Calls</th>
              <th>Successful</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody id="topCommandsBody">
            <tr><td colspan="4" style="color: #7d8590; text-align: center;">Loading activity…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 2: COMMANDS -->
    <div id="tab-commands" class="tab-panel">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
        <input type="text" id="cmdSearchInput" placeholder="Filter commands by name or role…" style="max-width: 320px;" oninput="filterCommandsTable()" />
        <div style="display: flex; gap: 0.4rem; align-items: center;">
          <button class="btn" onclick="reloadCommands(true)">Force Disk Reload</button>
          <span id="reloadResult" class="result-msg" style="margin-top: 0;"></span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Command</th>
              <th>Category</th>
              <th>Required Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="commandsTableBody">
            <tr><td colspan="4" style="color: #7d8590; text-align: center;">Loading commands…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: SETTINGS -->
    <div id="tab-settings" class="tab-panel">
      <div class="info-banner">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm6.5-.25A.75.75 0 017.25 7h1.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-2.75h-.75a.75.75 0 01-.75-.75zM8 4a1 1 0 100 2 1 1 0 000-2z"></path></svg>
        <span>Runtime settings persist to Supabase (<code>bot_settings</code>) and survive restarts. Changes apply live immediately.</span>
      </div>

      <div class="settings-grid">
        <!-- Runtime Controls -->
        <div class="panel">
          <h3>Runtime Controls</h3>
          <p class="panel-sub">Adjust server verbosity and Render keep-alive frequency.</p>

          <div class="form-group">
            <label for="logLevelSelect">Log Level <span id="logLevelTag" style="font-weight: normal; color: #58a6ff;"></span></label>
            <select id="logLevelSelect" onchange="setLogLevel(this.value)">
              <option value="debug">debug (verbose, logs all events)</option>
              <option value="info">info (recommended)</option>
              <option value="warn">warn (warnings & errors only)</option>
              <option value="error">error (critical failures only)</option>
            </select>
          </div>

          <div class="form-group">
            <label for="keepAliveInput">Keep-Alive Ping Interval (Minutes)</label>
            <div style="display: flex; gap: 0.4rem;">
              <input type="number" id="keepAliveInput" min="1" max="60" step="1" />
              <button class="btn" onclick="setKeepAliveInterval()" style="flex-shrink: 0;">Save</button>
            </div>
            <p style="font-size: 0.7rem; color: #7d8590; margin-top: 0.25rem;">Render free tier spins down after 15 min of idle time. Default is 5 min.</p>
          </div>

          <div id="settingsResult" class="result-msg"></div>
        </div>

        <!-- AI Persona -->
        <div class="panel">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <h3>Gemini AI Persona</h3>
            <span id="personaCharCount" style="font-size: 0.7rem; color: #7d8590;"></span>
          </div>
          <p class="panel-sub">Custom system prompt for the <code>!ai</code> command.</p>

          <div class="form-group">
            <textarea id="personaInput" maxlength="2000" oninput="updatePersonaCount()"></textarea>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.4rem;">
            <div style="display: flex; gap: 0.4rem;">
              <button class="btn btn-primary" onclick="savePersona()">Save Persona</button>
              <button class="btn" onclick="resetPersona()">Reset Default</button>
            </div>
            <span id="personaDefaultTag" style="font-size: 0.72rem; color: #7d8590;"></span>
          </div>
          <div id="personaResult" class="result-msg"></div>
        </div>
      </div>
    </div>

    <!-- TAB 4: LOGS -->
    <div id="tab-logs" class="tab-panel">
      <div class="log-controls">
        <div class="log-filters">
          <select id="logLevelFilter" onchange="renderLogs()" style="width: auto; padding: 0.3rem 0.5rem; font-size: 0.78rem;">
            <option value="all">All Levels</option>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
          <input type="text" id="logSearchInput" placeholder="Filter log text…" style="width: 220px; padding: 0.3rem 0.5rem; font-size: 0.78rem;" oninput="renderLogs()" />
        </div>
        <div style="display: flex; gap: 0.4rem; align-items: center;">
          <label style="font-size: 0.75rem; color: #7d8590; display: inline-flex; align-items: center; gap: 0.25rem; cursor: pointer;">
            <input type="checkbox" id="autoScrollCheck" checked /> Auto-scroll
          </label>
          <button class="btn" onclick="loadLogs()">⟳ Refresh</button>
          <button class="btn" onclick="clearLogsView()">Clear View</button>
        </div>
      </div>
      <div class="log-terminal" id="logsContainer">Loading logs…</div>
    </div>

    <!-- Footer -->
    <footer>
      <span id="lastUpdated">Updated just now</span>
      <span>Auto-refresh: 15s (Stats) / 5s (Logs)</span>
    </footer>
  </div>

  <script>
    const apiUrl = "/dashboard/api/stats";
    const reloadUrl = "/dashboard/api/reload";
    const settingsUrl = "/dashboard/api/settings";
    const commandsUrl = "/dashboard/api/commands";
    const logsUrl = "/dashboard/api/logs";

    let cachedCommands = [];
    let cachedLogs = [];

    // Tab Navigation
    function switchTab(tabId) {
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
      const target = document.getElementById("tab-" + tabId);
      if (target) target.classList.add("active");
      const btn = Array.from(document.querySelectorAll("nav button")).find(b => b.textContent.toLowerCase() === tabId);
      if (btn) btn.classList.add("active");

      // Auto-load tab data on first switch
      if (tabId === "commands" && !cachedCommands.length) loadCommandsTable();
      if (tabId === "settings") loadSettings();
      if (tabId === "logs") loadLogs();
    }

    async function postJson(url, body) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
      return data;
    }

    function setStatusBadge(status, env) {
      const el = document.getElementById("statusBadge");
      const map = {
        healthy: ["badge-healthy", "● Healthy"],
        degraded: ["badge-degraded", "● Degraded"],
        down: ["badge-down", "● Down"],
      };
      const [cls, label] = map[status] || map.degraded;
      el.className = "badge " + cls;
      el.textContent = label;

      if (env) {
        document.getElementById("envBadge").textContent = env.toUpperCase();
      }
    }

    function metricCard(title, mainVal, rows) {
      const rowsHtml = rows
        .map(([k, v]) => '<div class="card-row"><span>' + k + '</span><span>' + v + '</span></div>')
        .join("");
      return '<div class="card"><div class="card-title">' + title + '</div><div class="card-metric">' + mainVal + '</div><div class="card-rows">' + rowsHtml + '</div></div>';
    }

    async function refresh() {
      try {
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const s = await res.json();

        setStatusBadge(s.status, s.nodeEnv);

        const grid = document.getElementById("metricsGrid");
        const cards = [
          metricCard("System", s.uptime, [
            ["Node Env", s.nodeEnv],
            ["Host", s.keepAlive.externalUrl ? "Render / Public" : "Localhost"],
          ]),
          metricCard("Messages", s.events.completed, [
            ["Received", s.events.received],
            ["Failed", s.events.failed > 0 ? '<span class="bad">' + s.events.failed + '</span>' : "0"],
            ["Avg Latency", Math.round(s.events.avgMs) + "ms"],
          ]),
          metricCard("Commands Run", s.commandRuns.run, [
            ["Registered", s.commands.total],
            ["Categories", s.commands.categories],
            ["Failed", s.commandRuns.failed > 0 ? '<span class="bad">' + s.commandRuns.failed + '</span>' : "0"],
          ]),
          metricCard("Gemini AI", s.ai.replies, [
            ["Failures", s.ai.failures > 0 ? '<span class="bad">' + s.ai.failures + '</span>' : "0"],
            ["Command", "!ai"],
          ]),
          metricCard("AI Context Cache", s.aiContext.cachedUsers + " / " + s.aiContext.maxUsers, [
            ["Calls (1 min)", s.aiContext.recentCallsLastMinute],
            ["Capacity", Math.round((s.aiContext.cachedUsers / s.aiContext.maxUsers) * 100) + "%"],
          ]),
          metricCard("Queue & Ping", s.queue.active + " active", [
            ["Queued", s.queue.queued],
            ["Keep-Alive", s.keepAlive.running ? s.keepAlive.intervalMinutes + "m ping" : "Disabled"],
          ]),
        ];
        grid.innerHTML = cards.join("");

        // Top Commands Table
        const tbody = document.getElementById("topCommandsBody");
        if (!s.topCommands || !s.topCommands.length) {
          tbody.innerHTML = '<tr><td colspan="4" style="color: #7d8590; text-align: center;">No command usage recorded yet.</td></tr>';
        } else {
          tbody.innerHTML = s.topCommands.map(c => 
            '<tr>' +
            '<td class="cmd-name">!' + c.name + '</td>' +
            '<td>' + c.total + '</td>' +
            '<td>' + c.run + '</td>' +
            '<td>' + (c.failed > 0 ? '<span class="bad">' + c.failed + '</span>' : '0') + '</td>' +
            '</tr>'
          ).join("");
        }

        document.getElementById("lastUpdated").textContent = "Updated " + new Date().toLocaleTimeString();
      } catch (err) {
        document.getElementById("lastUpdated").textContent = "Failed to update: " + err.message;
      }
    }

    // Commands Management
    async function loadCommandsTable() {
      const tbody = document.getElementById("commandsTableBody");
      try {
        const res = await fetch(commandsUrl);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        cachedCommands = data.commands || [];
        renderCommandsTable(cachedCommands);
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="4" style="color: #f85149; text-align: center;">Failed to load commands: ' + err.message + '</td></tr>';
      }
    }

    function renderCommandsTable(commands) {
      const tbody = document.getElementById("commandsTableBody");
      if (!commands.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="color: #7d8590; text-align: center;">No matching commands found.</td></tr>';
        return;
      }
      tbody.innerHTML = commands.map(c => {
        const tags = (c.hidden ? '<span class="tag tag-hidden">hidden</span>' : "") +
                     (c.disabled ? '<span class="tag tag-disabled">disabled</span>' : "");
        const roleCls = c.requiredRole === "OWNER" ? "role-owner" : c.requiredRole === "ADMIN" ? "role-admin" : "";
        return '<tr>' +
          '<td><span class="cmd-name">!' + c.name + '</span>' + tags + '</td>' +
          '<td>' + c.category + '</td>' +
          '<td><span class="tag tag-role ' + roleCls + '">' + c.requiredRole + '</span></td>' +
          '<td>' +
            '<button class="btn" style="padding: 0.2rem 0.5rem; font-size: 0.72rem; margin-right: 0.3rem;" onclick="toggleHide(\\'' + c.name + '\\', ' + !c.hidden + ')">' + (c.hidden ? "Unhide" : "Hide") + '</button>' +
            '<button class="btn" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;" onclick="toggleDisable(\\'' + c.name + '\\', ' + !c.disabled + ')">' + (c.disabled ? "Enable" : "Disable") + '</button>' +
          '</td>' +
        '</tr>';
      }).join("");
    }

    function filterCommandsTable() {
      const q = document.getElementById("cmdSearchInput").value.trim().toLowerCase();
      if (!q) {
        renderCommandsTable(cachedCommands);
        return;
      }
      const filtered = cachedCommands.filter(c => 
        c.name.toLowerCase().includes(q) || 
        c.category.toLowerCase().includes(q) || 
        c.requiredRole.toLowerCase().includes(q)
      );
      renderCommandsTable(filtered);
    }

    async function toggleHide(name, hidden) {
      try {
        await postJson("/dashboard/api/commands/" + encodeURIComponent(name) + "/hide", { hidden });
        loadCommandsTable();
      } catch (err) {
        alert("Failed: " + err.message);
      }
    }

    async function toggleDisable(name, disabled) {
      try {
        await postJson("/dashboard/api/commands/" + encodeURIComponent(name) + "/disable", { disabled });
        loadCommandsTable();
        refresh();
      } catch (err) {
        alert("Failed: " + err.message);
      }
    }

    async function reloadCommands(force) {
      const resEl = document.getElementById("reloadResult");
      resEl.textContent = "Reloading…";
      try {
        const r = await postJson(reloadUrl, { force });
        resEl.textContent = r.changed ? "Reloaded " + r.loaded + " command(s)." : "No changes detected on disk.";
        loadCommandsTable();
        refresh();
      } catch (err) {
        resEl.textContent = "Failed: " + err.message;
      }
    }

    // Settings
    function updatePersonaCount() {
      const len = document.getElementById("personaInput").value.length;
      document.getElementById("personaCharCount").textContent = len + " / 2000 chars";
    }

    async function loadSettings() {
      try {
        const res = await fetch(settingsUrl);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const s = await res.json();

        document.getElementById("logLevelSelect").value = s.logLevel;
        document.getElementById("logLevelTag").textContent = s.logLevelIsDefault ? "" : "(custom)";

        document.getElementById("personaInput").value = s.geminiSystemPrompt;
        document.getElementById("personaDefaultTag").textContent = s.geminiSystemPromptIsDefault ? "" : "(modified)";
        updatePersonaCount();

        document.getElementById("keepAliveInput").value = s.keepAlive.intervalMinutes;
      } catch (err) {
        document.getElementById("settingsResult").textContent = "Failed to load settings: " + err.message;
      }
    }

    async function setLogLevel(level) {
      const resEl = document.getElementById("settingsResult");
      try {
        await postJson("/dashboard/api/settings/log-level", { level });
        resEl.textContent = "Log level updated to " + level + ".";
        loadSettings();
      } catch (err) {
        resEl.textContent = "Failed: " + err.message;
      }
    }

    async function setKeepAliveInterval() {
      const resEl = document.getElementById("settingsResult");
      const minutes = Number(document.getElementById("keepAliveInput").value);
      try {
        const r = await postJson("/dashboard/api/settings/keep-alive-interval", { minutes });
        resEl.textContent = r.warning ? "Saved: " + r.warning : "Keep-alive interval set to " + minutes + " min.";
        refresh();
        loadSettings();
      } catch (err) {
        resEl.textContent = "Failed: " + err.message;
      }
    }

    async function savePersona() {
      const resEl = document.getElementById("personaResult");
      const prompt = document.getElementById("personaInput").value;
      try {
        await postJson("/dashboard/api/settings/persona", { prompt });
        resEl.textContent = "Persona saved.";
        loadSettings();
      } catch (err) {
        resEl.textContent = "Failed: " + err.message;
      }
    }

    async function resetPersona() {
      const resEl = document.getElementById("personaResult");
      try {
        await postJson("/dashboard/api/settings/persona/reset", {});
        resEl.textContent = "Persona reset to default.";
        loadSettings();
      } catch (err) {
        resEl.textContent = "Failed: " + err.message;
      }
    }

    // Logs
    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    async function loadLogs() {
      try {
        const res = await fetch(logsUrl);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        cachedLogs = data.logs || [];
        renderLogs();
      } catch (err) {
        document.getElementById("logsContainer").textContent = "Failed to load logs: " + err.message;
      }
    }

    function renderLogs() {
      const container = document.getElementById("logsContainer");
      const filter = document.getElementById("logLevelFilter").value;
      const search = document.getElementById("logSearchInput").value.trim().toLowerCase();

      let visible = cachedLogs;
      if (filter !== "all") visible = visible.filter(l => l.level === filter);
      if (search) visible = visible.filter(l => (l.message + " " + l.scope).toLowerCase().includes(search));

      if (!visible.length) {
        container.innerHTML = '<div style="color: #7d8590;">No log entries match the current filter.</div>';
        return;
      }

      container.innerHTML = visible.map(l => {
        const time = new Date(l.timestamp).toLocaleTimeString();
        const scope = l.scope ? "[" + l.scope + "] " : "";
        return '<div class="log-line log-' + l.level + '">' +
          escapeHtml(time + " " + l.level.toUpperCase().padEnd(5) + " " + scope + l.message) +
        '</div>';
      }).join("");

      if (document.getElementById("autoScrollCheck").checked) {
        container.scrollTop = container.scrollHeight;
      }
    }

    function clearLogsView() {
      cachedLogs = [];
      renderLogs();
    }

    async function logout() {
      try {
        await postJson("/dashboard/api/logout", {});
      } catch {}
      window.location.href = "/dashboard";
    }

    // Initial boot
    refresh();
    setInterval(refresh, 15000);
    setInterval(() => {
      const logsActive = document.getElementById("tab-logs").classList.contains("active");
      if (logsActive) loadLogs();
    }, 5000);
  </script>
</body>
</html>`;
}

module.exports = router;