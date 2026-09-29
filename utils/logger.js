const runtimeSettings = require("./runtimeSettings");
const config = require("../config");

const LEVELS = ["debug", "info", "warn", "error"];
const STYLE = {
  debug: { color: "\x1b[90m", icon: "🔍" }, // gray
  info: { color: "\x1b[36m", icon: "ℹ️ " }, // cyan
  warn: { color: "\x1b[33m", icon: "⚠️ " }, // yellow
  error: { color: "\x1b[31m", icon: "❌" }, // red
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// Rolling buffer for the dashboard's live log view — mirrors exactly what
// actually gets printed (i.e. respects the current log level filter), so
// it matches what you'd see in Render's own console at any given moment.
// Capped size, oldest entries drop off first; not persisted anywhere.
const MAX_LOG_BUFFER = 300;
const logBuffer = [];

function stringifyArg(arg) {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function pushToBuffer(level, scope, args) {
  logBuffer.push({
    timestamp: Date.now(),
    level,
    scope: scope || "",
    message: args.map(stringifyArg).join(" "),
  });
  if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
}

/** Most recent buffered log entries, oldest first (like scrolling a
 * terminal). limit caps how many are returned, not how many are kept. */
function getRecentLogs(limit = MAX_LOG_BUFFER) {
  return logBuffer.slice(-limit);
}

function shouldLog(level) {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(runtimeSettings.getLogLevel());
}

function ts() {
  // "2026-09-21 08:45:13" — readable, still sortable, no ms clutter.
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function buildPrefix(level, scope) {
  const { color, icon } = STYLE[level];
  const levelTag = level.toUpperCase().padEnd(5);
  const scopeTag = scope ? `[${scope}]` : "";

  if (!config.logColor) {
    return `${icon}${ts()} ${levelTag} ${scopeTag}`.trim();
  }
  return `${color}${icon}${ts()} ${levelTag}${RESET} ${BOLD}${scopeTag}${RESET}`.trim();
}

/**
 * Every level function takes a "scope" first — a short tag like "webhook",
 * "command:ping", or an event id like "evt:a1b2c3" — so related log lines
 * can be told apart at a glance and grepped for. Pass "" if there's truly
 * no relevant scope.
 */
function make(level) {
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  return (scope, ...args) => {
    if (!shouldLog(level)) return;
    pushToBuffer(level, scope, args);
    out(buildPrefix(level, scope), ...args);
  };
}

/**
 * Short id to correlate every log line for one incoming message, e.g.
 * logger.info(`evt:${id}`, "..."). Makes it possible to follow a single
 * conversation through the logs even when several arrive close together.
 */
function newEventId() {
  return Math.random().toString(16).slice(2, 8);
}

module.exports = {
  debug: make("debug"),
  info: make("info"),
  warn: make("warn"),
  error: make("error"),
  newEventId,
  getRecentLogs,
};