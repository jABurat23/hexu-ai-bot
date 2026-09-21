module.exports = {
  name: "rules",
  category: "General",
  usage: "!rules",
  description: "Show the bot's usage and safety rules.",
  handler: async () =>
    [
      "╭── HEXU AI RULES ──⭓",
      "│ 1. Be respectful and do not spam commands.",
      "│ 2. Do not send passwords, tokens, or private data.",
      "│ 3. AI replies may be imperfect; verify important information.",
      "│ 4. Admin commands are restricted by role.",
      "│ 5. Type !help to view available commands.",
      "╰────────⭓",
    ].join("\n"),
};
