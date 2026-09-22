// This file is only a bridge: command discovery, caching, and hot-reload
// all live in lib/commandLoader.js. This file just exposes the same
// PREFIX / parseCommand / runCommand / registry API as before, so nothing
// that already imports from "../commands" needs to change.
const commandLoader = require("../lib/commandLoader");
const { hasPermission, getRoleString } = require("../lib/roles");
const { recordCommand } = require("../utils/metrics");

const PREFIX = "!";
const cooldowns = new Map();

// `registry` stays a live view onto the loader's current command map (via
// a Proxy) rather than a one-time snapshot, so code that destructured
// `{ registry }` at require-time still sees commands added or changed by
// a later !reload, instead of a stale copy from startup.
const registry = new Proxy(
  {},
  {
    get: (_target, prop) => commandLoader.getRegistry()[prop],
    has: (_target, prop) => prop in commandLoader.getRegistry(),
    ownKeys: () => Reflect.ownKeys(commandLoader.getRegistry()),
    getOwnPropertyDescriptor: (_target, prop) =>
      Object.getOwnPropertyDescriptor(commandLoader.getRegistry(), prop),
  }
);

/**
 * Returns { isCommand, name, args } for a given raw message text.
 */
function parseCommand(text) {
  if (!text || !text.startsWith(PREFIX)) return { isCommand: false };
  const [name, ...args] = text.slice(PREFIX.length).trim().split(/\s+/);
  return { isCommand: true, name: name.toLowerCase(), args };
}

/**
 * Runs a command if it exists. Returns null if the command name is unknown
 * (caller decides how to handle that — currently: reply with an error).
 */
async function runCommand(name, user, args) {
  const command = commandLoader.getCommand(name);
  if (!command) return null;

  if (command.requiredRole) {
    if (!hasPermission(user.access_role, command.requiredRole)) {
      return [
        "╭── ACCESS DENIED ──⭓",
        `│ This command requires ${getRoleString(command.requiredRole)} access.`,
        `│ Your current role is ${getRoleString(user.access_role)}.`,
        "╰────────⭓",
      ].join("\n");
    }
  }

  const cooldownSeconds = Number(command.cooldownSeconds) || 0;
  const cooldownKey = `${command.name}:${user.psid}`;
  const lastRun = cooldowns.get(cooldownKey);
  if (cooldownSeconds > 0 && lastRun) {
    const remaining = cooldownSeconds * 1000 - (Date.now() - lastRun);
    if (remaining > 0) {
      return `Please wait ${Math.ceil(remaining / 1000)}s before using !${command.name} again.`;
    }
  }

  try {
    const result = await command.handler(user, args, registry);
    if (cooldownSeconds > 0) cooldowns.set(cooldownKey, Date.now());
    recordCommand();
    return result;
  } catch (error) {
    recordCommand(true);
    throw error;
  }
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, timestamp] of cooldowns) {
    if (timestamp < cutoff) cooldowns.delete(key);
  }
}, 60 * 1000).unref();

module.exports = {
  PREFIX,
  parseCommand,
  runCommand,
  registry,
  // New: exposed for the !reload admin command and for metrics/debugging.
  reloadCommands: commandLoader.reloadCommands,
  commandLoader,
};