const commandLoader = require("../lib/commandLoader");

module.exports = {
  name: "reload",
  category: "Admin",
  usage: "!reload [force]",
  cooldownSeconds: 5,
  requiredRole: "ADMIN",
  description: "Hot-reload command files from disk without restarting the bot.",
  handler: async (_user, args) => {
    const force = (args[0] || "").toLowerCase() === "force";
    const before = commandLoader.getCacheStats().commandCount;
    const result = commandLoader.reloadCommands(force);
    const after = commandLoader.getCacheStats().commandCount;

    if (!result.changed) {
      return [
        "╭── RELOAD ──⭓",
        "│ No command files changed on disk.",
        `│ ${after} command(s) currently loaded.`,
        "│ Tip: !reload force to reload anyway.",
        "╰────────⭓",
      ].join("\n");
    }

    return [
      "╭── RELOAD ──⭓",
      `│ Reloaded ${after} command(s) (was ${before}).`,
      result.errors
        ? `│ ⚠️ ${result.errors} file(s) failed to load — check the logs.`
        : "│ No errors.",
      "╰────────⭓",
    ].join("\n");
  },
};