const { blockUser, getBlockedUser } = require("../lib/supabase");
const { canModerate, getTarget, usage } = require("../lib/moderation");

module.exports = {
  name: "block",
  category: "Moderation",
  requiredRole: "ADMIN",
  usage: "!block <psid> [reason]",
  cooldownSeconds: 5,
  description: "Block a user from using the bot.",
  handler: async (actor, args) => {
    if (!args[0]) return usage("block", "<psid> [reason]");
    const target = await getTarget(args[0]);
    const denied = canModerate(actor, target);
    if (denied) return denied;
    if (await getBlockedUser(args[0])) return "That user is already blocked.";
    await blockUser(args[0], args.slice(1).join(" "), actor.psid);
    return `Blocked user ${args[0]}.`;
  },
};
