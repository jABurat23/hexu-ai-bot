const { getWarnings, getUserByPsid } = require("../lib/supabase");

module.exports = {
  name: "warnings",
  aliases: ["warns"],
  category: "Moderation",
  requiredRole: "ADMIN",
  usage: "!warnings <psid>",
  cooldownSeconds: 3,
  description: "View a user's moderation warnings.",
  handler: async (_actor, args) => {
    if (!args[0]) return "Usage: !warnings <psid>";
    if (!(await getUserByPsid(args[0]))) return "User not found.";
    const warnings = await getWarnings(args[0]);
    if (!warnings.length) return `No warnings found for ${args[0]}.`;
    return [
      `Warnings for ${args[0]} (${warnings.length}):`,
      ...warnings.map((warning, index) => `${index + 1}. ${warning.reason}`),
    ].join("\n");
  },
};
