const { getRecentAiHistory } = require("../lib/supabase");

const MAX_DISPLAY = 5;
const MAX_CONTENT_LENGTH = 180;

function formatRole(role) {
  return role === "assistant" ? "🤖" : "👤";
}

module.exports = {
  name: "history",
  category: "User",
  usage: "!history [1-5]",
  cooldownSeconds: 3,
  description: "View your five most recent !ai exchanges.",
  handler: async (user, args) => {
    const requestedLimit = args[0] ? Number(args[0]) : MAX_DISPLAY;
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_DISPLAY)
      : MAX_DISPLAY;
    const history = await getRecentAiHistory(user.psid, limit);

    if (!history.length) {
      return "No !ai conversation history is saved yet.";
    }

    const lines = ["╭── RECENT HISTORY ──⭓"];
    for (const message of history) {
      const content =
        message.content.length > MAX_CONTENT_LENGTH
          ? `${message.content.slice(0, MAX_CONTENT_LENGTH - 3)}...`
          : message.content;
      lines.push(`│ ${formatRole(message.role)} ${content.replace(/\r?\n/g, " ")}`);
    }
    lines.push("╰────────⭓");
    return lines.join("\n");
  },
};