module.exports = {
  name: "about",
  category: "General",
  description: "Learn about Hexu AI and how to use the bot.",
  handler: async () =>
    [
      "╭── ABOUT HEXU AI ──⭓",
      "│ 🤖 An AI-powered Messenger assistant.",
      "│",
      "│ Send a normal message to chat with AI.",
      "│ Use !help to browse available commands.",
      "│ Use !profile to view your role and account.",
      "╰────────⭓",
    ].join("\n"),
};
