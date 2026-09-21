// This file is only a bridge: it loads every command file in this folder
// and connects them to the message service. It has no command logic of its
// own — to add a command, create a new file here (see ping.js / help.js for
// the shape) and it'll be picked up automatically.
const fs = require("fs");
const path = require("path");

const PREFIX = "!";

const registry = {};
for (const file of fs.readdirSync(__dirname)) {
  if (file === "index.js" || !file.endsWith(".js")) continue;
  const command = require(path.join(__dirname, file));
  registry[command.name] = command;
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
async function runCommand(name, psid, args) {
  const command = registry[name];
  if (!command) return null;
  return command.handler(psid, args, registry);
}

module.exports = { PREFIX, parseCommand, runCommand, registry };