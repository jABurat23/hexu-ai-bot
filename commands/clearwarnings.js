const { clearWarnings, getUserByPsid } = require("../lib/supabase");

module.exports = {
  name: "clearwarnings",
  category: "Moderation",
  requiredRole: "OWNER",
  usage: "!clearwarnings <psid> CONFIRM",
  cooldownSeconds: 10,
  description: "Clear a user's warnings. Owner only.",
  handler: async (actor, args) => {
    if (!args[0] || args[1]?.toUpperCase() !== "CONFIRM") {
      return "Usage: !clearwarnings <psid> CONFIRM";
    }
    if (!(await getUserByPsid(args[0]))) return "User not found.";
    await clearWarnings(args[0], actor.psid);
    return `Warnings cleared for ${args[0]}.`;
  },
};
