const PAGE_SIZE = 6;
const OWNER_GITHUB_USERNAME = "jABurat23";

module.exports = {
  name: "help",
  description: "List all available commands.",
  // The bridge (commands/index.js) passes the full registry in as the 3rd
  // arg, so this command can list every other command without importing
  // them directly. Usage: "!help" (page 1) or "!help 2" for later pages.
  handler: async (_psid, args, registry) => {
    const all = Object.values(registry).sort((a, b) => a.name.localeCompare(b.name));
    const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));

    let page = parseInt(args[0], 10);
    if (!Number.isInteger(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const start = (page - 1) * PAGE_SIZE;
    const pageCommands = all.slice(start, start + PAGE_SIZE);

    const lines = pageCommands.map(
      (c) => `⮑ !${c.name}\n   ${c.description || "No description."}`
    );

    const footer = [
      `Page ${page}/${totalPages} · ${all.length} total commands`,
      page < totalPages ? `Tip: !help ${page + 1} to see the next page` : null,
      `Owner: ${OWNER_GITHUB_USERNAME}`,
    ]
      .filter((line) => line !== null)
      .join("\n");

    return ["『 HEXU AI COMMANDS 』", "", lines.join("\n\n"), "", footer].join("\n");
  },
};