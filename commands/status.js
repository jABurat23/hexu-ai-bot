const ping = require("./ping");
const { snapshot } = require("../utils/metrics");

module.exports = {
  name: "status",
  category: "System",
  usage: "!status",
  cooldownSeconds: 5,
  description: "Check Messenger API and database availability.",
  handler: async (user) => {
    const health = await ping.handler(user);
    const metrics = snapshot();
    return [
      health,
      "",
      `Events: ${metrics.eventsCompleted} completed / ${metrics.eventsFailed} failed`,
      `Commands: ${metrics.commandsRun} run / ${metrics.commandsFailed} failed`,
      `AI: ${metrics.aiReplies} replies / ${metrics.aiFailures} failures`,
      `Average event time: ${metrics.averageEventDurationMs}ms`,
    ].join("\n");
  },
};
