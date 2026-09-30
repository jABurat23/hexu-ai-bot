const config = require("../config");

module.exports = {
  name: "profile",
  category: "User",
  description: "View your profile card, PSID, and access role.",
  handler: async (user) => {
    const baseUrl = process.env.APP_URL || config.externalUrl || `http://localhost:${config.port}`;
    const cardUrl = `${baseUrl.replace(/\/+$/, "")}/api/profile-card/${encodeURIComponent(user.psid)}?t=${Date.now()}`;

    return {
      type: "image",
      url: cardUrl,
      text: "⏳ Generating your profile card...",
    };
  },
};
