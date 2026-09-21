const { getOrCreateUser } = require("../lib/supabase");
const { getRoleString } = require("../lib/roles");

module.exports = {
  name: "profile",
  description: "View your profile, PSID, and access role.",
  handler: async (user) => {
    // We already have the full user object with access_role and created_at
    const joinedDate = new Date(user.created_at).toLocaleDateString();

    return [
      "╭── YOUR PROFILE ──⭓",
      `│ 🔑 PSID: ${user.psid}`,
      `│ ${getRoleString(user.access_role)}`,
      `│ 📅 Joined: ${joinedDate}`,
      "╰────────⭓",
    ].join("\n");
  },
};
