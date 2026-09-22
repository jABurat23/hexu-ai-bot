const OWNER_GITHUB_USERNAME = "jABurat23";
const { ROLES, hasPermission, getRoleString } = require("../lib/roles");
const commandLoader = require("../lib/commandLoader");

// Strict count, not a character budget — every page shows at most this
// many commands, however short or long their descriptions are.
const COMMANDS_PER_PAGE = 6;

/** Splits an array into chunks of `size`, in order. */
function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks.length ? chunks : [[]];
}

/**
 * Flat, ordered (role desc, then category, then name) list of
 * { role, category, command } for every command a role can see. This is
 * what gets chunked into pages — headers are re-derived per page from
 * whichever role/category each page's commands actually belong to, so a
 * category that spans two pages still gets its header repeated on both.
 */
function buildOrderedEntries(userRole) {
  const sortedRoles = Object.values(ROLES).sort((a, b) => a.level - b.level);
  const commands = commandLoader.getCommandsByRole(userRole);
  const entries = [];

  for (const role of sortedRoles) {
    const roleCommands = commands
      .filter((c) => (c.requiredRole || "USER") === role.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!roleCommands.length) continue;

    const byCategory = {};
    for (const c of roleCommands) {
      const category = c.category || "General";
      if (!byCategory[category]) byCategory[category] = [];
      byCategory[category].push(c);
    }
    for (const [category, cmds] of Object.entries(byCategory)) {
      for (const command of cmds) entries.push({ role, category, command });
    }
  }
  return entries;
}

/** Renders one page's worth of entries, reprinting a header whenever the
 * role or category changes from the previous line on this page. */
function renderEntryLines(entries) {
  const lines = [];
  let lastRole = null;
  let lastCategory = null;

  for (const { role, category, command } of entries) {
    if (role.name !== lastRole) {
      lines.push(`${role.emoji} ${role.name} COMMANDS`);
      lastRole = role.name;
      lastCategory = null; // force the category header to reprint too
    }
    if (category !== lastCategory) {
      lines.push(`${category}:`);
      lastCategory = category;
    }
    lines.push(`⮑ !${command.name} — ${command.description || "No description."}`);
  }
  return lines;
}

function renderPage(title, lines, page, totalPages, totalCount) {
  const header = [
    "╭─────────────⭓",
    `│ 『 ${title} 』`,
    "├────────⭔",
    "│ » Details: !help <command>",
    "│ » Filter: !help <category>",
    totalPages > 1 ? `│ » More: !help <page> (${totalPages} pages)` : null,
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

function clampPage(requested, totalPages) {
  let page = parseInt(requested, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (page > totalPages) page = totalPages;
  return page;
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
        const sorted = [...categories[categoryMatch]].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        const pages = chunk(sorted, COMMANDS_PER_PAGE);
        const page = clampPage(args[1], pages.length);
        const lines = pages[page - 1].map(
          (c) => `⮑ !${c.name} — ${c.description || "No description."}`
        );

        return renderPage(
          `${categoryMatch.toUpperCase()} COMMANDS`,
          lines,
          page,
          pages.length,
          sorted.length
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
    const entries = buildOrderedEntries(user.access_role);
    const pages = chunk(entries, COMMANDS_PER_PAGE);
    const page = clampPage(query, pages.length);
    const lines = renderEntryLines(pages[page - 1]);

    return renderPage("HEXU AI COMMANDS", lines, page, pages.length, entries.length);
  },
};