const PAGE_SIZE = 6;
const OWNER_GITHUB_USERNAME = "jABurat23";

module.exports = {
  name: "help",
  description: "List all available commands, or !help <command> for details on one.",
  // The bridge (commands/index.js) passes the full registry in as the 3rd
  // arg, so this command can list every other command without importing
  // them directly. Usage:
  //   !help            -> page 1 of the full list
  //   !help 2          -> page 2 of the full list
  //   !help <command>  -> details on one specific command
  handler: async (_psid, args, registry) => {
    const query = args[0];

    // A non-numeric arg is treated as a command name to look up, e.g.
    // "!help ping" or "!help !ping" (leading "!" is optional).
    if (query && !/^\d+$/.test(query)) {
      const name = query.replace(/^!/, "").toLowerCase();
      const command = registry[name];

      if (!command) {
        return [
          "╭── ERROR ──⭓",
          `│ Command "!${name}" does not exist.`,
          "│ Type !help to see the full list.",
          "╰────────⭓",
        ].join("\n");
      }

      return [
        "╭── NAME ──⭓",
        `│ !${command.name}`,
        "├── INFO ──⭔",
        `│ Description: ${command.description || "No description available."}`,
        `│ Usage: !${command.name}`,
        "╰────────⭓",
      ].join("\n");
    }

    const all = Object.values(registry).sort((a, b) => a.name.localeCompare(b.name));
    const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));

    let page = parseInt(query, 10);
    if (!Number.isInteger(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const start = (page - 1) * PAGE_SIZE;
    const pageCommands = all.slice(start, start + PAGE_SIZE);

    const header = [
      "╭─────────────⭓",
      "│ 『 HEXU AI COMMANDS 』",
      "├─────⭔",
      `│ Page [ ${page}/${totalPages} ]`,
      `│ Hexu AI currently has ${all.length} command${all.length === 1 ? "" : "s"}`,
      "│ » Type !help <page> to view more commands",
      "│ » Type !help <command> for details on one",
      "├────────⭔",
    ];

    const body = pageCommands.map(
      (c) => `│ ⮑ !${c.name} — ${c.description || "No description."}`
    );

    const footer = [`│ Owner: ${OWNER_GITHUB_USERNAME}`, "╰─────────────⭓"];

    return [...header, ...body, ...footer].join("\n");
  },
};