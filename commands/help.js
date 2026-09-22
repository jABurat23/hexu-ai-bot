const OWNER_GITHUB_USERNAME = "jABurat23";
const { ROLES, hasPermission, getRoleString } = require("../lib/roles");
const commandLoader = require("../lib/commandLoader");

// Keep each page's body comfortably under Messenger's 2000-char text
// limit, leaving room for the header/footer wrapped around it.
const MAX_BODY_CHARS_PER_PAGE = 1400;

/**
 * Packs `lines` into pages, never letting a page's total length exceed
 * maxChars. A single line longer than maxChars still gets its own page
 * rather than being dropped or split mid-line.
 */
function paginateLines(lines, maxChars) {
  const pages = [[]];
  let currentLen = 0;
  for (const line of lines) {
    const lineLen = line.length + 1; // +1 for the newline that'll join it
    const page = pages[pages.length - 1];
    if (currentLen + lineLen > maxChars && page.length > 0) {
      pages.push([line]);
      currentLen = lineLen;
    } else {
      page.push(line);
      currentLen += lineLen;
    }
  }
  return pages;
}

/** Builds the flat "role header / category header / command" line list. */
function buildFullListingLines(userRole) {
  const grouped = {};
  for (const roleKey of Object.keys(ROLES)) grouped[roleKey] = [];
  for (const c of commandLoader.getCommandsByRole(userRole)) {
    grouped[c.requiredRole || "USER"].push(c);
  }

  const lines = [];
  const sortedRoles = Object.values(ROLES).sort((a, b) => b.level - a.level);
  for (const role of sortedRoles) {
    const roleCommands = grouped[role.name];
    if (!roleCommands || roleCommands.length === 0) continue;

    lines.push(`${role.emoji} ${role.name} COMMANDS`);
    const byCategory = {};
    for (const c of roleCommands) {
      const category = c.category || "General";
      if (!byCategory[category]) byCategory[category] = [];
      byCategory[category].push(c);
    }
    for (const [category, cmds] of Object.entries(byCategory)) {
      lines.push(`${category}:`);
      for (const c of cmds) {
        lines.push(`⮑ !${c.name} — ${c.description || "No description."}`);
      }
    }
  }
  return lines;
}

/** Same idea, scoped to a single category. */
function buildCategoryLines(userRole, category) {
  const commands = commandLoader.getCategories(userRole)[category] || [];
  return commands.map((c) => `⮑ !${c.name} — ${c.description || "No description."}`);
}

function renderPage(title, lines, page, totalPages, totalCount) {
  const header = [
    "╭─────────────⭓",
    `│ 『 ${title} 』`,
    "├────────⭔",
    "│ » Type !help <command> for details",
    "│ » Type !help <category> to filter",
    totalPages > 1 ? `│ » Type !help <page> — ${totalPages} pages total` : null,
  ].filter(Boolean);

  const body = lines.map((l) => `│ ${l}`);

  const footer = [
    "├─────⭔",
    `│ Page ${page}/${totalPages} · ${totalCount} command${totalCount === 1 ? "" : "s"}`,
    `│ Owner: ${OWNER_GITHUB_USERNAME}`,
    "╰─────────────⭓",
  ];

  return [...header, ...body, ...footer].join("\n");
}

module.exports = {
  name: "help",
  aliases: ["menu"],
  category: "General",
  usage: "!help [page] | !help <command> | !help <category>",
  description:
    "List all commands grouped by role, filter by category, or !help <command> for details.",
  handler: async (user, args) => {
    const query = args[0];
    const isPageNumber = query && /^\d+$/.test(query);

    // --- !help <category> ---
    if (query && !isPageNumber) {
      const categories = commandLoader.getCategories(user.access_role);
      const categoryMatch = Object.keys(categories).find(
        (c) => c.toLowerCase() === query.toLowerCase()
      );

      if (categoryMatch) {
        const lines = buildCategoryLines(user.access_role, categoryMatch);
        const pages = paginateLines(lines, MAX_BODY_CHARS_PER_PAGE);
        let page = parseInt(args[1], 10);
        if (!Number.isInteger(page) || page < 1) page = 1;
        if (page > pages.length) page = pages.length;

        return renderPage(
          `${categoryMatch.toUpperCase()} COMMANDS`,
          pages[page - 1],
          page,
          pages.length,
          lines.length
        );
      }

      // --- !help <command> ---
      const name = query.replace(/^!/, "").toLowerCase();
      const command = commandLoader.getCommand(name);

      if (!command) {
        return [
          "╭── ERROR ──⭓",
          `│ No command or category called "${query}".`,
          "│ Type !help to see the full list.",
          "╰────────⭓",
        ].join("\n");
      }

      const reqRole = command.requiredRole || "USER";
      if (!hasPermission(user.access_role, reqRole)) {
        return [
          "╭── ACCESS DENIED ──⭓",
          `│ You do not have permission to view "!${name}".`,
          "╰────────⭓",
        ].join("\n");
      }

      return [
        "╭── NAME ──⭓",
        `│ !${command.name}`,
        "├── INFO ──⭔",
        `│ Description: ${command.description || "No description available."}`,
        `│ Category: ${command.category || "General"}`,
        command.aliases?.length ? `│ Aliases: ${command.aliases.map((a) => `!${a}`).join(", ")}` : null,
        `│ Required Role: ${getRoleString(reqRole)}`,
        `│ Usage: ${command.usage || `!${command.name}`}`,
        `│ Cooldown: ${command.cooldownSeconds || 0}s`,
        "╰────────⭓",
      ]
        .filter((line) => line !== null)
        .join("\n");
    }

    // --- !help [page] ---
    const lines = buildFullListingLines(user.access_role);
    const pages = paginateLines(lines, MAX_BODY_CHARS_PER_PAGE);
    let page = parseInt(query, 10);
    if (!Number.isInteger(page) || page < 1) page = 1;
    if (page > pages.length) page = pages.length;

    const totalCommands = commandLoader.getCommandsByRole(user.access_role).length;
    return renderPage("HEXU AI COMMANDS", pages[page - 1], page, pages.length, totalCommands);
  },
};