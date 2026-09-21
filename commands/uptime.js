const os = require("os");

function formatDuration(totalSeconds) {
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
}

module.exports = {
  name: "uptime",
  category: "System",
  usage: "!uptime",
  cooldownSeconds: 5,
  description: "View bot uptime and runtime memory usage.",
  handler: async () => {
    const memory = process.memoryUsage();
    return [
      "╭── SYSTEM STATUS ──⭓",
      `│ ⏱️ Uptime: ${formatDuration(process.uptime())}`,
      `│ 🧠 Memory: ${(memory.rss / 1024 / 1024).toFixed(1)} MB RSS`,
      `│ 📦 Node.js: ${process.version}`,
      `│ 💻 Platform: ${os.platform()} ${os.arch()}`,
      "╰────────⭓",
    ].join("\n");
  },
};
