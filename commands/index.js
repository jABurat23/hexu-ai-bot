// Each command: key is the typed word (without prefix), value is an async
// handler (psid, args) => string reply.
// Add new commands here as you build integrations.
const PREFIX = "!";

const commands = {
  help: async () => {
    const list = Object.keys(commands)
      .map((c) => `${PREFIX}${c}`)
      .join(", ");
    return `Here's what I can do: ${list}\nAnything else you type, I'll just chat with you about.`;
  },

  ping: async () => "pong 🏓",

  // Example placeholder for an API integration — replace with a real call.
  // weather: async (psid, args) => {
  //   const city = args.join(" ") || "Manila";
  //   const data = await fetchWeather(city);
  //   return `It's ${data.tempC}°C and ${data.condition} in ${city}.`;
  // },
};

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
 * (caller can decide how to handle that — e.g. fall through to AI, or reply
 * with an error).
 */
async function runCommand(name, psid, args) {
  const handler = commands[name];
  if (!handler) return null;
  return handler(psid, args);
}

module.exports = { PREFIX, parseCommand, runCommand, commands };
