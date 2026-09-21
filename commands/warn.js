const { addWarning, getWarnings, blockUser } = require("../lib/supabase");
const { canModerate, getTarget, usage } = require("../lib/moderation");

const WARNING_LIMIT = 3;

module.exports = {
  name: "warn",
  category: "Moderation",
  requiredRole: "ADMIN",
  usage: "!warn <psid> <reason>",
  cooldownSeconds: 5,
  description: "Add a moderation warning; three warnings block access.",
  handler: async (actor, args) => {
    if (!args[0] || args.length < 2) return usage("warn", "<psid> <reason>");
    const target = await getTarget(args[0]);
    const denied = canModerate(actor, target);
    if (denied) return denied;
    const reason = args.slice(1).join(" ");
    await addWarning(args[0], reason, actor.psid);
    const warnings = await getWarnings(args[0], WARNING_LIMIT);
    if (warnings.length >= WARNING_LIMIT) {
      await blockUser(args[0], "Automatic block after three warnings", actor.psid);
      return `Warning added. ${args[0]} reached ${WARNING_LIMIT} warnings and is now blocked.`;
    }
    return `Warning added to ${args[0]} (${warnings.length}/${WARNING_LIMIT}).`;
  },
};
