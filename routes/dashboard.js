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

function renderPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hexu AI — Dashboard</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f7f7f8;
    color: #111;
    margin: 0;
    padding: 2rem;
  }
  h1 { font-size: 1.3rem; margin: 0 0 0.2rem 0; }
  h3 { font-size: 0.95rem; margin: 2rem 0 0.6rem 0; }
  .sub { color: #666; margin-bottom: 1.5rem; font-size: 0.85rem; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 0.9rem;
  }
  .card {
    background: #fff;
    border: 1px solid #e3e3e3;
    border-radius: 6px;
    padding: 0.9rem 1rem;
  }
  .card h2 {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #888;
    margin: 0 0 0.5rem 0;
    font-weight: 600;
  }
  .row { display: flex; justify-content: space-between; padding: 0.15rem 0; font-size: 0.88rem; }
  .row span:first-child { color: #555; }
  .row span:last-child { font-weight: 600; }
  #updated { color: #999; font-size: 0.75rem; margin-top: 1.5rem; }
  .sub-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 0.5rem; }
  button {
    font: inherit;
    font-size: 0.8rem;
    background: #fff;
    border: 1px solid #d8d8d8;
    border-radius: 5px;
    padding: 0.35rem 0.7rem;
    cursor: pointer;
    color: #333;
  }
  button:hover { background: #f0f0f0; }
  #statusBadge { font-weight: 600; font-size: 0.85rem; }
  .bad { color: #cf222e; }
  .loading-msg { color: #999; font-size: 0.85rem; padding: 0.5rem 0; }
  #reloadResult { color: #666; font-size: 0.78rem; margin-top: 0.4rem; min-height: 1em; }
  .persist-warning {
    background: #eefbf0;
    border: 1px solid #b8e6c1;
    border-radius: 6px;
    padding: 0.6rem 0.8rem;
    font-size: 0.8rem;
    color: #1a5c2a;
    margin-bottom: 1rem;
  }
  .settings-card {
    background: #fff;
    border: 1px solid #e3e3e3;
    border-radius: 6px;
    padding: 1rem;
    margin-bottom: 1rem;
  }
  .settings-card label { display: block; font-size: 0.78rem; color: #555; margin-bottom: 0.3rem; }
  .settings-card select, .settings-card textarea, .settings-card input[type=number] {
    font: inherit;
    font-size: 0.85rem;
    width: 100%;
    border: 1px solid #d8d8d8;
    border-radius: 5px;
    padding: 0.4rem 0.5rem;
    margin-bottom: 0.5rem;
  }
  .settings-card textarea { min-height: 70px; resize: vertical; }
  .settings-row { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
  .settings-row > div { flex: 1; min-width: 200px; }
  .result-msg { font-size: 0.78rem; color: #666; margin-top: 0.3rem; min-height: 1em; }
  .default-tag { color: #999; font-size: 0.72rem; margin-left: 0.4rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; background: #fff; border: 1px solid #e3e3e3; border-radius: 6px; overflow: hidden; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid #eee; }
  th { background: #fafafa; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; color: #888; }
  tr:last-child td { border-bottom: none; }
  .tag { font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 4px; margin-right: 0.25rem; }
  .tag.hidden-tag { background: #eef; color: #446; }
  .tag.disabled-tag { background: #fee; color: #922; }
  .cmd-actions button { font-size: 0.72rem; padding: 0.2rem 0.45rem; margin-right: 0.25rem; }
  #logsContainer {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.74rem;
    line-height: 1.45;
    background: #fafafa;
    border: 1px solid #e3e3e3;
    border-radius: 5px;
    padding: 0.5rem 0.6rem;
    height: 320px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .log-line { padding: 0.05rem 0; }
  .log-debug { color: #888; }
  .log-info { color: #222; }
  .log-warn { color: #9a6700; }
  .log-error { color: #cf222e; }
</style>
</head>
<body>
  <div class="sub-row" style="margin-bottom: 0.2rem;">
    <h1>Hexu AI Dashboard</h1>
    <span id="statusBadge"></span>
  </div>
  <div class="sub-row">
    <div class="sub">Live status — auto-refreshes every 15s.</div>
    <div>
      <button onclick="refresh()">Refresh now</button>
      <button onclick="reloadCommands(false)">Reload commands</button>
      <button onclick="reloadCommands(true)">Force reload</button>
      <button onclick="logout()">Log out</button>
    </div>
  </div>
  <div id="reloadResult"></div>
  <div class="grid" id="grid"><div class="loading-msg">Loading stats…</div></div>
  <div id="updated"></div>

  <h3>Settings</h3>
  <div class="persist-warning">
    ✅ Log level, persona, keep-alive interval, and hidden/disabled commands are saved to Supabase and survive a restart or redeploy. If a save ever fails (e.g. a Supabase hiccup), the change still applies immediately here, but a warning will say it won't persist.
  </div>

  <div class="settings-card">
    <div class="settings-row">
      <div>
        <label for="logLevelSelect">Log level<span id="logLevelDefaultTag" class="default-tag"></span></label>
        <select id="logLevelSelect" onchange="setLogLevel(this.value)">
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
      </div>
      <div>
        <label for="keepAliveInput">Keep-alive interval (minutes)</label>
        <div style="display:flex; gap:0.4rem;">
          <input type="number" id="keepAliveInput" min="1" step="1" style="margin-bottom:0;" />
          <button onclick="setKeepAliveInterval()">Save</button>
        </div>
      </div>
    </div>
    <div id="settingsResult" class="result-msg"></div>
  </div>

  <div class="settings-card">
    <label for="personaInput">Bot persona / system prompt<span id="personaDefaultTag" class="default-tag"></span></label>
    <textarea id="personaInput" maxlength="2000"></textarea>
    <div>
      <button onclick="savePersona()">Save persona</button>
      <button onclick="resetPersona()">Reset to default</button>
    </div>
    <div id="personaResult" class="result-msg"></div>
  </div>

  <h3>Manage Commands</h3>
  <div id="commandsTableWrap"><div class="loading-msg">Loading commands…</div></div>

  <h3>Logs</h3>
  <div class="settings-card">
    <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; margin-bottom:0.6rem;">
      <label for="logLevelFilter" style="margin:0;">Show</label>
      <select id="logLevelFilter" onchange="loadLogs()" style="width:auto; margin:0;">
        <option value="all">all levels</option>
        <option value="debug">debug</option>
        <option value="info">info</option>
        <option value="warn">warn</option>
        <option value="error">error</option>
      </select>
      <button onclick="loadLogs()">Refresh logs</button>
      <span class="result-msg" style="margin:0;">Auto-refreshes every 5s. Only shows what the current log level lets through.</span>
    </div>
    <div id="logsContainer"><div class="loading-msg">Loading logs…</div></div>
  </div>

  <script>
    // No token handling here on purpose: the ?token=... you logged in with is
    // exchanged server-side for an HttpOnly session cookie on the very first
    // page load, and the browser attaches that cookie to every fetch below
    // automatically. The token never appears in any of these request URLs.
    const apiUrl = "/dashboard/api/stats";
    const reloadUrl = "/dashboard/api/reload";
    const settingsUrl = "/dashboard/api/settings";
    const commandsUrl = "/dashboard/api/commands";
    const logsUrl = "/dashboard/api/logs";

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

    async function reloadCommands(force) {
      const resultEl = document.getElementById("reloadResult");
      resultEl.textContent = "Reloading…";
      try {
        const r = await postJson(reloadUrl, { force });
        resultEl.textContent = r.changed
          ? "Reloaded " + r.loaded + " command(s)" + (r.errors ? " — " + r.errors + " error(s), check server logs" : "") + "."
          : "No changes on disk — nothing to reload.";
        refresh();
        loadCommandsTable();
      } catch (err) {
        resultEl.textContent = "Reload failed: " + err.message;
      }
    }

    function card(title, rows) {
      const rowsHtml = rows
        .map(([k, v]) => "<div class=row><span>" + k + "</span><span>" + v + "</span></div>")
        .join("");
      return "<div class=card><h2>" + title + "</h2>" + rowsHtml + "</div>";
    }

    function badVal(n) {
      return n > 0 ? '<span class="bad">' + n + "</span>" : String(n);
    }

    function setStatusBadge(status) {
      const map = {
        healthy: ["🟢", "Healthy"],
        degraded: ["🟡", "Degraded"],
        down: ["🔴", "Down"],
      };
      const [icon, label] = map[status] || map.degraded;
      document.getElementById("statusBadge").textContent = icon + " " + label;
    }

    async function refresh() {
      try {
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const s = await res.json();

        setStatusBadge(s.status);

        const topCommandsRows = s.topCommands.length
          ? s.topCommands.map((c) => ["!" + c.name, c.total + (c.failed ? " (" + c.failed + " failed)" : "")])
          : [["No usage yet", ""]];

        const cards = [
          card("Status", [
            ["Uptime", s.uptime],
            ["Environment", s.nodeEnv],
          ]),
          card("Commands", [
            ["Loaded", s.commands.total],
            ["Categories", s.commands.categories],
            ["Reloads", s.commands.loadCount],
          ]),
          card("Top Commands", topCommandsRows),
          card("Messages", [
            ["Received", s.events.received],
            ["Completed", s.events.completed],
            ["Failed", badVal(s.events.failed)],
            ["Avg time", s.events.avgMs + "ms"],
          ]),
          card("Commands Run", [
            ["Successful", s.commandRuns.run],
            ["Failed", badVal(s.commandRuns.failed)],
          ]),
          card("AI (!ai command)", [
            ["Replies", s.ai.replies],
            ["Failures", badVal(s.ai.failures)],
          ]),
          card("AI Context Cache", [
            ["Cached users", s.aiContext.cachedUsers + " / " + s.aiContext.maxUsers],
            ["Calls (last min)", s.aiContext.recentCallsLastMinute],
          ]),
          card("Queue", [
            ["Queued", s.queue.queued],
            ["Active", s.queue.active],
            ["Concurrency", s.queue.concurrency],
            ["Accepting", s.queue.accepting ? "yes" : "no"],
          ]),
          card("Keep-Alive", [
            ["Running", s.keepAlive.running ? "yes" : "no"],
            ["Interval", s.keepAlive.intervalMinutes + " min"],
          ]),
        ];

        document.getElementById("grid").innerHTML = cards.join("");
        document.getElementById("updated").textContent = "Updated " + new Date().toLocaleTimeString();
      } catch (err) {
        document.getElementById("updated").textContent = "Failed to load stats: " + err.message;
      }
    }

    async function loadSettings() {
      try {
        const res = await fetch(settingsUrl);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const s = await res.json();

        document.getElementById("logLevelSelect").value = s.logLevel;
        document.getElementById("logLevelDefaultTag").textContent = s.logLevelIsDefault ? "" : "(modified)";

        document.getElementById("personaInput").value = s.geminiSystemPrompt;
        document.getElementById("personaDefaultTag").textContent = s.geminiSystemPromptIsDefault ? "" : "(modified)";

        document.getElementById("keepAliveInput").value = s.keepAlive.intervalMinutes;
      } catch (err) {
        document.getElementById("settingsResult").textContent = "Failed to load settings: " + err.message;
      }
    }

    async function setLogLevel(level) {
      const resultEl = document.getElementById("settingsResult");
      try {
        await postJson("/dashboard/api/settings/log-level", { level });
        resultEl.textContent = "Log level set to " + level + ".";
        loadSettings();
      } catch (err) {
        resultEl.textContent = "Failed: " + err.message;
      }
    }

    async function setKeepAliveInterval() {
      const resultEl = document.getElementById("settingsResult");
      const minutes = Number(document.getElementById("keepAliveInput").value);
      try {
        const r = await postJson("/dashboard/api/settings/keep-alive-interval", { minutes });
        resultEl.textContent = r.warning
          ? "Set to " + minutes + " min. \u26a0\ufe0f " + r.warning
          : "Keep-alive interval set to " + minutes + " min.";
        refresh();
        loadSettings();
      } catch (err) {
        resultEl.textContent = "Failed: " + err.message;
      }
    }

    async function savePersona() {
      const resultEl = document.getElementById("personaResult");
      const prompt = document.getElementById("personaInput").value;
      try {
        await postJson("/dashboard/api/settings/persona", { prompt });
        resultEl.textContent = "Persona saved.";
        loadSettings();
      } catch (err) {
        resultEl.textContent = "Failed: " + err.message;
      }
    }

    async function resetPersona() {
      const resultEl = document.getElementById("personaResult");
      try {
        await postJson("/dashboard/api/settings/persona/reset", {});
        resultEl.textContent = "Persona reset to default.";
        loadSettings();
      } catch (err) {
        resultEl.textContent = "Failed: " + err.message;
      }
    }

    async function loadCommandsTable() {
      const wrap = document.getElementById("commandsTableWrap");
      try {
        const res = await fetch(commandsUrl);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const { commands } = await res.json();

        const rows = commands
          .map((c) => {
            const tags =
              (c.hidden ? '<span class="tag hidden-tag">hidden</span>' : "") +
              (c.disabled ? '<span class="tag disabled-tag">disabled</span>' : "");
            return (
              "<tr>" +
              "<td>!" + c.name + tags + "</td>" +
              "<td>" + c.category + "</td>" +
              "<td>" + c.requiredRole + "</td>" +
              '<td class="cmd-actions">' +
              '<button onclick="toggleHide(\\'' + c.name + "', " + !c.hidden + ')">' + (c.hidden ? "Unhide" : "Hide") + "</button>" +
              '<button onclick="toggleDisable(\\'' + c.name + "', " + !c.disabled + ')">' + (c.disabled ? "Enable" : "Disable") + "</button>" +
              "</td>" +
              "</tr>"
            );
          })
          .join("");

        wrap.innerHTML =
          "<table><thead><tr><th>Command</th><th>Category</th><th>Role</th><th>Actions</th></tr></thead><tbody>" +
          rows +
          "</tbody></table>";
      } catch (err) {
        wrap.innerHTML = '<div class="loading-msg">Failed to load commands: ' + err.message + "</div>";
      }
    }

    async function toggleHide(name, hidden) {
      try {
        const r = await postJson("/dashboard/api/commands/" + encodeURIComponent(name) + "/hide", { hidden });
        if (r.warning) alert(r.warning);
        loadCommandsTable();
      } catch (err) {
        alert("Failed: " + err.message);
      }
    }

    async function toggleDisable(name, disabled) {
      try {
        const r = await postJson("/dashboard/api/commands/" + encodeURIComponent(name) + "/disable", { disabled });
        if (r.warning) alert(r.warning);
        loadCommandsTable();
        refresh();
      } catch (err) {
        alert("Failed: " + err.message);
      }
    }

    // Log messages can contain arbitrary text (a user's message at debug
    // level, an error string, ...) — always escape before putting it in
    // innerHTML so it can never be interpreted as markup.
    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function renderLogLine(entry) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const scope = entry.scope ? "[" + entry.scope + "] " : "";
      return (
        '<div class="log-line log-' + entry.level + '">' +
        escapeHtml(time + " " + entry.level.toUpperCase() + " " + scope + entry.message) +
        "</div>"
      );
    }

    // "tail -f" behavior: only jump to the newest line if you were already
    // at the bottom — if you've scrolled up to read something, a refresh
    // shouldn't yank you away from it.
    function isNearBottom(el) {
      return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    }

    async function loadLogs() {
      const container = document.getElementById("logsContainer");
      const wasAtBottom = isNearBottom(container);
      try {
        const res = await fetch(logsUrl);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const { logs } = await res.json();
        const filter = document.getElementById("logLevelFilter").value;
        const visible = filter === "all" ? logs : logs.filter((l) => l.level === filter);
        container.innerHTML = visible.length
          ? visible.map(renderLogLine).join("")
          : '<div class="loading-msg">No log entries to show.</div>';
        if (wasAtBottom) container.scrollTop = container.scrollHeight;
      } catch (err) {
        container.innerHTML = '<div class="loading-msg">Failed to load logs: ' + escapeHtml(err.message) + "</div>";
      }
    }

    async function logout() {
      try {
        await postJson("/dashboard/api/logout", {});
      } catch (err) {
        // Even if this fails, fall through to the reload — worst case the
        // session cookie is still valid and the page just loads again.
      }
      window.location.href = "/dashboard";
    }

    refresh();
    loadSettings();
    loadCommandsTable();
    loadLogs();
    setInterval(refresh, 15000);
    setInterval(loadLogs, 5000);
  </script>
</body>
</html>`;
}

module.exports = router;