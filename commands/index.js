// This file is only a bridge: it loads every command file in this folder
// and connects them to the message service. It has no command logic of its
// own — to add a command, create a new file here (see ping.js / help.js for
// the shape) and it'll be picked up automatically.
const fs = require("fs");
const path = require("path");
const { hasPermission, getRoleString } = require("../lib/roles");
const { recordCommand } = require("../utils/metrics");

const PREFIX = "!";

const registry = {};
const cooldowns = new Map();
for (const file of fs.readdirSync(__dirname)) {
  if (file === "index.js" || !file.endsWith(".js")) continue;
  const command = require(path.join(__dirname, file));
  registry[command.name] = command;
  for (const alias of command.aliases || []) {
    registry[alias] = command;
  }
}

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
  const command = registry[name];
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

module.exports = { PREFIX, parseCommand, runCommand, registry };