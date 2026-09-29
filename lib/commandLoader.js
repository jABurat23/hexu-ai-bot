const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const { hasPermission } = require("./roles");
const { getSetting, setSetting } = require("../lib/supabase");

const COMMANDS_DIR = path.join(__dirname, "..", "commands");
const PROJECT_ROOT = path.join(__dirname, "..");
const IGNORED_TOP_LEVEL_FILES = new Set(["index.js"]);

// --- in-memory cache state (rebuilt on every load/reload) ---
let registry = {}; // name/alias (string) -> command object
let uniqueCommands = []; // deduplicated, sorted by name
let categories = {}; // category (string) -> command[]
let fileMeta = new Map(); // absolute file path -> { mtimeMs }
let commandFilePaths = new Map(); // canonical command name -> absolute file path
let lastLoadedAt = null;
let loadCount = 0;

// --- dashboard-managed state (persists ACROSS loads/reloads — a reload
// re-scans files, it doesn't reset admin choices made from /dashboard).
// Also persisted to Supabase's bot_settings table (see hydrateFromDb()
// and the persist* helpers below) so these survive a restart/redeploy.
const disabledCommands = new Set(); // canonical names — blocked from running, hidden from listings
const hiddenCommands = new Set(); // canonical names — still runnable, just hidden from listings

/**
 * Recursively finds every .js file under `dir`. Subfolders inside
 * commands/ are supported (e.g. commands/moderation/warn.js) — only the
 * top-level index.js (this bridge's own loader-facing file) is ignored.
 */
function findCommandFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findCommandFiles(fullPath));
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    if (dir === COMMANDS_DIR && IGNORED_TOP_LEVEL_FILES.has(entry.name)) continue;
    results.push(fullPath);
  }
  return results;
}

function isValidCommand(command) {
  return (
    command &&
    typeof command === "object" &&
    typeof command.name === "string" &&
    command.name.trim().length > 0 &&
    typeof command.handler === "function"
  );
}

/**
 * Loads (or reloads) every command file from disk into the cache.
 * force=true clears require.cache first so edited files are actually
 * re-read rather than served from Node's own module cache.
 * A single bad command file (syntax error, throws on require, missing
 * name/handler) is logged and skipped — it never takes down the others.
 */
function loadCommands(force = false) {
  const files = findCommandFiles(COMMANDS_DIR);
  const newRegistry = {};
  const newUnique = [];
  const newCategories = {};
  const newFileMeta = new Map();
  const newCommandFilePaths = new Map();
  let errors = 0;

  for (const filePath of files) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      logger.error("commandLoader", `Couldn't stat ${filePath}:`, err.message);
      errors++;
      continue;
    }

    if (force) {
      try {
        delete require.cache[require.resolve(filePath)];
      } catch {
        // not previously required — nothing to clear
      }
    }

    const relPath = path.relative(COMMANDS_DIR, filePath);
    let command;
    try {
      command = require(filePath);
    } catch (err) {
      logger.error("commandLoader", `Failed to load ${relPath}:`, err.message);
      errors++;
      continue;
    }

    if (!isValidCommand(command)) {
      logger.error(
        "commandLoader",
        `Skipped ${relPath}: must export an object with a non-empty "name" string and a "handler" function.`
      );
      errors++;
      continue;
    }

    newRegistry[command.name] = command;
    for (const alias of command.aliases || []) {
      newRegistry[alias] = command;
    }
    newUnique.push(command);

    const category = command.category || "General";
    if (!newCategories[category]) newCategories[category] = [];
    newCategories[category].push(command);

    newFileMeta.set(filePath, { mtimeMs: stat.mtimeMs });
    newCommandFilePaths.set(command.name, filePath);
  }

  registry = newRegistry;
  uniqueCommands = newUnique.sort((a, b) => a.name.localeCompare(b.name));
  categories = newCategories;
  fileMeta = newFileMeta;
  commandFilePaths = newCommandFilePaths;
  lastLoadedAt = new Date();
  loadCount += 1;

  // Prune disabled/hidden entries for commands that no longer exist (e.g.
  // deleted) — otherwise these two Sets would grow stale forever.
  const currentNames = new Set(uniqueCommands.map((c) => c.name));
  for (const name of disabledCommands) if (!currentNames.has(name)) disabledCommands.delete(name);
  for (const name of hiddenCommands) if (!currentNames.has(name)) hiddenCommands.delete(name);

  logger.info(
    "commandLoader",
    `Loaded ${uniqueCommands.length} command(s) from ${files.length} file(s)` +
      (errors ? `, ${errors} error(s) — see above.` : ".")
  );

  return { loaded: uniqueCommands.length, errors };
}

/**
 * Re-scans only if something on disk actually changed (a file's mtime
 * moved, or a file was added/removed) since the last load — so calling
 * this often (e.g. from !reload) is cheap when nothing changed. Pass
 * force=true to reload unconditionally.
 */
function reloadCommands(force = false) {
  if (!force) {
    const files = findCommandFiles(COMMANDS_DIR);
    const changed =
      files.length !== fileMeta.size ||
      files.some((f) => {
        const prev = fileMeta.get(f);
        if (!prev) return true;
        try {
          return fs.statSync(f).mtimeMs !== prev.mtimeMs;
        } catch {
          return true;
        }
      });

    if (!changed) {
      logger.debug("commandLoader", "Reload skipped — no command files changed.");
      return { loaded: uniqueCommands.length, errors: 0, changed: false };
    }
  }

  const result = loadCommands(true);
  return { ...result, changed: true };
}

/** Looks up a command by its exact name or one of its aliases, regardless
 * of disabled/hidden state — callers that need to run it should check
 * isDisabled() separately so they can give a clear message. */
function getCommand(nameOrAlias) {
  if (!nameOrAlias) return null;
  return registry[nameOrAlias] || registry[nameOrAlias.toLowerCase()] || null;
}

/** The live name/alias -> command map. Mutates on every reload. */
function getRegistry() {
  return registry;
}

/** Every command a given role is allowed to see/run — excludes disabled
 * and hidden commands, sorted by name. */
function getCommandsByRole(userRole) {
  return uniqueCommands.filter(
    (c) =>
      hasPermission(userRole, c.requiredRole || "USER") &&
      !disabledCommands.has(c.name) &&
      !hiddenCommands.has(c.name)
  );
}

/** Categories visible to a role, each holding only that role's non-hidden,
 * non-disabled commands. */
function getCategories(userRole) {
  const result = {};
  for (const [category, commands] of Object.entries(categories)) {
    const visible = commands.filter(
      (c) =>
        hasPermission(userRole, c.requiredRole || "USER") &&
        !disabledCommands.has(c.name) &&
        !hiddenCommands.has(c.name)
    );
    if (visible.length) result[category] = visible;
  }
  return result;
}

function getCacheStats() {
  return {
    commandCount: uniqueCommands.length,
    fileCount: fileMeta.size,
    categoryCount: Object.keys(categories).length,
    lastLoadedAt,
    loadCount,
  };
}

function commandExists(name) {
  return uniqueCommands.some((c) => c.name === name);
}

function isDisabled(name) {
  return disabledCommands.has(name);
}

function isHidden(name) {
  return hiddenCommands.has(name);
}

async function persistDisabledCommands() {
  await setSetting("disabledCommands", [...disabledCommands]);
}

async function persistHiddenCommands() {
  await setSetting("hiddenCommands", [...hiddenCommands]);
}

async function disableCommand(name) {
  if (!commandExists(name)) throw new Error(`No command named "${name}".`);
  disabledCommands.add(name);
  await persistDisabledCommands();
}

async function enableCommand(name) {
  disabledCommands.delete(name);
  await persistDisabledCommands();
}

async function hideCommand(name) {
  if (!commandExists(name)) throw new Error(`No command named "${name}".`);
  hiddenCommands.add(name);
  await persistHiddenCommands();
}

async function unhideCommand(name) {
  hiddenCommands.delete(name);
  await persistHiddenCommands();
}

/**
 * Loads persisted disabled/hidden command names from Supabase, called
 * once at startup (see index.js) after the initial loadCommands(true) has
 * already run, so commandExists() has something to check names against.
 * Stale names (a command that's since been removed from the codebase) are
 * silently skipped rather than re-added.
 */
async function hydrateFromDb() {
  try {
    const [savedDisabled, savedHidden] = await Promise.all([
      getSetting("disabledCommands"),
      getSetting("hiddenCommands"),
    ]);

    if (Array.isArray(savedDisabled)) {
      for (const name of savedDisabled) if (commandExists(name)) disabledCommands.add(name);
    }
    if (Array.isArray(savedHidden)) {
      for (const name of savedHidden) if (commandExists(name)) hiddenCommands.add(name);
    }

    logger.info(
      "commandLoader",
      `Hydrated ${disabledCommands.size} disabled + ${hiddenCommands.size} hidden command(s) from Supabase.`
    );
  } catch (err) {
    logger.warn("commandLoader", "Couldn't load disabled/hidden commands from Supabase:", err.message);
  }
}

/** Full command list regardless of role — for the dashboard's management
 * table, which needs to see (and toggle) everything, not a Messenger
 * user's filtered view. */
function getAllCommandsForAdmin() {
  return uniqueCommands.map((c) => ({
    name: c.name,
    category: c.category || "General",
    requiredRole: c.requiredRole || "USER",
    aliases: c.aliases || [],
    description: c.description || "",
    disabled: disabledCommands.has(c.name),
    hidden: hiddenCommands.has(c.name),
    filePath: path.relative(PROJECT_ROOT, commandFilePaths.get(c.name) || ""),
  }));
}

module.exports = {
  loadCommands,
  reloadCommands,
  hydrateFromDb,
  getCommand,
  getRegistry,
  getCommandsByRole,
  getCategories,
  getCacheStats,
  isDisabled,
  isHidden,
  disableCommand,
  enableCommand,
  hideCommand,
  unhideCommand,
  getAllCommandsForAdmin,
};

// Initial load happens after module.exports is set (not before) — a
// command file is free to require("../lib/commandLoader") itself (e.g.
// commands/reload.js, for admin metrics) without getting back an
// incomplete module mid-initialization.
loadCommands(true);