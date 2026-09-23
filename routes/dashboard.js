const express = require("express");
const config = require("../config");
const commandLoader = require("../lib/commandLoader");
const { snapshot } = require("../utils/metrics");
const { messageQueue } = require("./webhook");
const logger = require("../utils/logger");

if (!config.dashboardToken) {
  logger.warn(
    "dashboard",
    "DASHBOARD_TOKEN not set — /dashboard is open to anyone with the URL. Fine for now, set a token before sharing the link anywhere public."
  );
}

const router = express.Router();

function checkToken(req, res, next) {
  if (!config.dashboardToken) return next();
  if (req.query.token === config.dashboardToken) return next();
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

function getStats() {
  const m = snapshot();
  const cmd = commandLoader.getCacheStats();
  return {
    uptime: formatUptime(m.uptimeSeconds),
    nodeEnv: config.nodeEnv,
    commands: {
      total: cmd.commandCount,
      categories: cmd.categoryCount,
      loadCount: cmd.loadCount,
    },
    events: {
      received: m.eventsReceived,
      completed: m.eventsCompleted,
      failed: m.eventsFailed,
      avgMs: m.averageEventDurationMs,
    },
    commandRuns: { run: m.commandsRun, failed: m.commandsFailed },
    ai: { replies: m.aiReplies, failures: m.aiFailures },
    queue: messageQueue.getStats(),
    keepAlive: {
      enabled: config.keepAliveEnabled && !!config.externalUrl,
      intervalMinutes: Math.round(config.keepAliveIntervalMs / 60000),
    },
  };
}

router.get("/api/stats", checkToken, (req, res) => {
  logger.debug("dashboard", `GET /dashboard/api/stats from ${req.ip}`);
  res.set("Cache-Control", "no-store");
  res.json(getStats());
});

router.get("/", checkToken, (req, res) => {
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
</style>
</head>
<body>
  <h1>Hexu AI Dashboard</h1>
  <div class="sub">Live status — refreshes every 5s.</div>
  <div class="grid" id="grid"></div>
  <div id="updated"></div>

  <script>
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const apiUrl = "/dashboard/api/stats" + (token ? "?token=" + encodeURIComponent(token) : "");

    function card(title, rows) {
      const rowsHtml = rows
        .map(([k, v]) => "<div class=row><span>" + k + "</span><span>" + v + "</span></div>")
        .join("");
      return "<div class=card><h2>" + title + "</h2>" + rowsHtml + "</div>";
    }

    async function refresh() {
      try {
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const s = await res.json();

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
          card("Messages", [
            ["Received", s.events.received],
            ["Completed", s.events.completed],
            ["Failed", s.events.failed],
            ["Avg time", s.events.avgMs + "ms"],
          ]),
          card("Commands Run", [
            ["Successful", s.commandRuns.run],
            ["Failed", s.commandRuns.failed],
          ]),
          card("AI Fallback", [
            ["Replies", s.ai.replies],
            ["Failures", s.ai.failures],
          ]),
          card("Queue", [
            ["Queued", s.queue.queued],
            ["Active", s.queue.active],
            ["Concurrency", s.queue.concurrency],
            ["Accepting", s.queue.accepting ? "yes" : "no"],
          ]),
          card("Keep-Alive", [
            ["Enabled", s.keepAlive.enabled ? "yes" : "no"],
            ["Interval", s.keepAlive.intervalMinutes + " min"],
          ]),
        ];

        document.getElementById("grid").innerHTML = cards.join("");
        document.getElementById("updated").textContent = "Updated " + new Date().toLocaleTimeString();
      } catch (err) {
        document.getElementById("updated").textContent = "Failed to load stats: " + err.message;
      }
    }

    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
}

module.exports = router;