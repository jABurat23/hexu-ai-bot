// Runtime-adjustable settings — deliberately separate from config.js.
// config.js is env-var-derived and fixed for the process's life; the
// values here are meant to be changed live from /dashboard and persisted
// to Supabase's bot_settings table so they survive a restart/redeploy.
//
// Note: this file intentionally uses plain console.warn/console.log
// instead of utils/logger.js — logger.js reads its own level from here
// (getLogLevel()), so requiring logger.js back would create a circular
// dependency. Config.js has the same exception for the same reason.

const config = require("../config");
const { getSetting, setSetting, getAllSettings } = require("../lib/supabase");

const LOG_LEVELS = ["debug", "info", "warn", "error"];
const MAX_PERSONA_LENGTH = 2000;
const MIN_KEEP_ALIVE_INTERVAL_MS = 30_000; // hard floor — avoids accidentally hammering the URL
const RENDER_IDLE_WINDOW_MS = 15 * 60 * 1000;

/** Thrown for invalid input (bad level, empty persona, interval too low).
 * Lets callers tell "you sent something wrong" (a 400) apart from "the
 * value applied but the database write failed" (applied, with a warning). */
class SettingValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SettingValidationError";
  }
}

const state = {
  logLevel: config.logLevel,
  geminiSystemPrompt: config.geminiSystemPrompt,
  keepAliveIntervalMs: config.keepAliveIntervalMs,
};

let hydrated = false;

/**
 * Loads persisted overrides from Supabase, called once at startup (see
 * index.js) before the server starts accepting traffic. Falls back to
 * config.js's .env-derived defaults for anything not yet in the DB, or if
 * Supabase itself is unreachable — the bot must still boot either way.
 */
async function hydrateFromDb() {
  try {
    const saved = await getAllSettings();

    if (typeof saved.logLevel === "string" && LOG_LEVELS.includes(saved.logLevel)) {
      state.logLevel = saved.logLevel;
    }
    if (typeof saved.geminiSystemPrompt === "string" && saved.geminiSystemPrompt.trim()) {
      state.geminiSystemPrompt = saved.geminiSystemPrompt;
    }
    if (
      typeof saved.keepAliveIntervalMs === "number" &&
      saved.keepAliveIntervalMs >= MIN_KEEP_ALIVE_INTERVAL_MS
    ) {
      state.keepAliveIntervalMs = saved.keepAliveIntervalMs;
    }

    hydrated = true;
    console.log(
      `[runtimeSettings] Hydrated from Supabase (${Object.keys(saved).length} setting(s) found).`
    );
  } catch (err) {
    console.warn(
      `[runtimeSettings] Couldn't load settings from Supabase, using .env defaults: ${err.message}`
    );
  }
}

function isHydrated() {
  return hydrated;
}

function getLogLevel() {
  return state.logLevel;
}

async function setLogLevel(level) {
  if (!LOG_LEVELS.includes(level)) {
    throw new SettingValidationError(`Invalid log level "${level}". Must be one of: ${LOG_LEVELS.join(", ")}.`);
  }
  state.logLevel = level; // applied immediately, regardless of DB outcome below
  await setSetting("logLevel", level); // throws on failure — caller reports that to the admin
}

function getGeminiSystemPrompt() {
  return state.geminiSystemPrompt;
}

async function setGeminiSystemPrompt(prompt) {
  const trimmed = String(prompt ?? "").trim();
  if (!trimmed) {
    throw new SettingValidationError("Persona/system prompt can't be empty.");
  }
  if (trimmed.length > MAX_PERSONA_LENGTH) {
    throw new SettingValidationError(`Persona/system prompt is too long (max ${MAX_PERSONA_LENGTH} characters).`);
  }
  state.geminiSystemPrompt = trimmed;
  await setSetting("geminiSystemPrompt", trimmed);
}

async function resetGeminiSystemPrompt() {
  state.geminiSystemPrompt = config.geminiSystemPrompt;
  await setSetting("geminiSystemPrompt", config.geminiSystemPrompt);
}

function getKeepAliveIntervalMs() {
  return state.keepAliveIntervalMs;
}

/**
 * Validates and persists a new keep-alive interval. Does NOT restart the
 * running timer itself — utils/keep-alive.js owns that mechanic, so the
 * caller (routes/dashboard.js) calls keepAlive.restart() right after this
 * resolves. Keeping that step at the call site avoids a circular require
 * between this file and keep-alive.js.
 */
async function setKeepAliveIntervalMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < MIN_KEEP_ALIVE_INTERVAL_MS) {
    throw new SettingValidationError(`Interval must be at least ${MIN_KEEP_ALIVE_INTERVAL_MS / 1000}s.`);
  }
  const warning =
    value >= RENDER_IDLE_WINDOW_MS
      ? `${Math.round(value / 60000)} min is at or above Render's 15-min idle window — may not prevent spin-down.`
      : null;

  state.keepAliveIntervalMs = value;
  await setSetting("keepAliveIntervalMs", value);
  return { warning };
}

/** For the dashboard: current values plus whether each was changed from
 * the .env-derived default (so the UI can show "modified" clearly). */
function getAll() {
  return {
    logLevel: state.logLevel,
    logLevelIsDefault: state.logLevel === config.logLevel,
    geminiSystemPrompt: state.geminiSystemPrompt,
    geminiSystemPromptIsDefault: state.geminiSystemPrompt === config.geminiSystemPrompt,
    keepAliveIntervalMs: state.keepAliveIntervalMs,
    keepAliveIntervalIsDefault: state.keepAliveIntervalMs === config.keepAliveIntervalMs,
  };
}

module.exports = {
  SettingValidationError,
  LOG_LEVELS,
  MAX_PERSONA_LENGTH,
  MIN_KEEP_ALIVE_INTERVAL_MS,
  RENDER_IDLE_WINDOW_MS,
  hydrateFromDb,
  isHydrated,
  getLogLevel,
  setLogLevel,
  getGeminiSystemPrompt,
  setGeminiSystemPrompt,
  resetGeminiSystemPrompt,
  getKeepAliveIntervalMs,
  setKeepAliveIntervalMs,
  getAll,
};