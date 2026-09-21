const { clearMessageHistory } = require("../lib/supabase");

module.exports = {
  name: "clearhistory",
  category: "User",
  usage: "!clearhistory CONFIRM",
  cooldownSeconds: 10,
  description: "Delete your saved conversation history after confirmation.",
  requiredRole: "ADMIN",
  handler: async (user, args) => {
    if (args.join(" ").toUpperCase() !== "CONFIRM") {
      return [
        "This permanently deletes your saved conversation history.",
        "Type !clearhistory CONFIRM to continue.",
      ].join("\n");
    }

    await clearMessageHistory(user.psid);
    return "Your conversation history has been cleared.";
  },
};
