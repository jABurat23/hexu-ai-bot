const { unblockUser, getBlockedUser } = require("../lib/supabase");
const { canModerate, getTarget, usage } = require("../lib/moderation");

module.exports = {
  name: "unblock",
  category: "Moderation",
  requiredRole: "ADMIN",
  usage: "!unblock <psid>",
  cooldownSeconds: 5,
  description: "Restore a blocked user's access.",
  handler: async (actor, args) => {
    if (!args[0]) return usage("unblock", "<psid>");
    const target = await getTarget(args[0]);
    const denied = canModerate(actor, target);
    if (denied) return denied;
    if (!(await getBlockedUser(args[0]))) return "That user is not blocked.";
    await unblockUser(args[0], actor.psid);
    return `Unblocked user ${args[0]}.`;
  },
};
