const config = require("../config");
const { getRoleString } = require("../lib/roles");

module.exports = {
  name: "profile",
  category: "User",
  description: "View your profile card, PSID, and access role.",
  handler: async (user) => {
    const joinedDate = user.created_at ? new Date(user.created_at).toLocaleDateString() : "Recently";
    const baseUrl = process.env.APP_URL || config.externalUrl || `http://localhost:${config.port}`;
    const cardUrl = `${baseUrl.replace(/\/+$/, "")}/api/profile-card/${encodeURIComponent(user.psid)}?t=${Date.now()}`;

    const caption = [
      "╭── YOUR PROFILE ──⭓",
      `│ 🔑 PSID: ${user.psid}`,
      `│ ${getRoleString(user.access_role)}`,
      `│ 📅 Joined: ${joinedDate}`,
      "╰────────⭓",
    ].join("\n");

    return {
      type: "image",
      url: cardUrl,
      text: caption,
    };
  },
};
