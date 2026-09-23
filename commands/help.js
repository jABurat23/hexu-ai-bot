const OWNER_GITHUB_USERNAME = "jABurat23";
const { ROLES, hasPermission, getRoleString } = require("../lib/roles");
const commandLoader = require("../lib/commandLoader");

const DIVIDER = "━━━━━━━━━━━━";
const DIVIDER_DECOR = "━━━━━━༺༻━━━━━━";

// Strict count, not a character budget — every page shows at most this
// many command cards, however long their descriptions are.
const COMMANDS_PER_PAGE = 6;

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks.length ? chunks : [[]];
}

function clampPage(requested, totalPages) {
  let page = parseInt(requested, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (page > totalPages) page = totalPages;
  return page;
}

/** Flat list of commands a role can see, ordered role-ascending (USER
 * first, OWNER last) then alphabetically within each role. */
function buildOrderedCommands(userRole) {
  const sortedRoles = Object.values(ROLES).sort((a, b) => a.level - b.level);
  const visible = commandLoader.getCommandsByRole(userRole);
  const ordered = [];
  for (const role of sortedRoles) {
    ordered.push(
      ...visible
        .filter((c) => (c.requiredRole || "USER") === role.name)
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  }
  return ordered;
}

function formatDateTime(date) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${weekday} || ${day}/${month}/${year} || ${hours}:${minutes}:${seconds}`;
}

/** One numbered command card. */
function renderCard(number, command) {
  return [
    DIVIDER,
    `╭┈ ❒「 ${number} 」➪ !${command.name}`,
    `╰┈➤ Description: ${command.description || "No description."}`,
    `╰┈➤ Cooldown: ${command.cooldownSeconds || 0}s`,
    `╰┈➤ Category: ${command.category || "General"}`,
    DIVIDER,
  ].join("\n");
}

function renderPage(cardsWithNumbers, page, totalPages, totalCount) {
  const top = [
    DIVIDER_DECOR,
    "╭┈ ❒ Use: !",
    "╰┈➤ this prefix to run these commands",
    DIVIDER_DECOR,
  ].join("\n");

  const cards = cardsWithNumbers.map(({ number, command }) => renderCard(number, command)).join("\n\n");

  const footer = [
    DIVIDER_DECOR,
    "[ TIME ]",
    formatDateTime(new Date()),
    "",
    `This Bot Made by: ${OWNER_GITHUB_USERNAME}`,
    DIVIDER_DECOR,
    `Total Commands: ${totalCount}`,
    `Page ${page}/${totalPages}`,
    `Use: !help <page> (1-${totalPages})`,
    "Use: !help <command>",
    "Use: !help <category>",
    DIVIDER_DECOR,
  ].join("\n");

  return [top, cards, footer].join("\n\n");
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
        const cardsWithNumbers = pages[page - 1].map((command, i) => ({
          number: (page - 1) * COMMANDS_PER_PAGE + i + 1,
          command,
        }));

        return renderPage(cardsWithNumbers, page, pages.length, sorted.length);
      }

      // --- !help <command> ---
      const name = query.replace(/^!/, "").toLowerCase();
      const command = commandLoader.getCommand(name);

      if (!command) {
        return [
          DIVIDER,
          "╭┈ ❒ Not Found",
          `╰┈➤ No command or category called "${query}".`,
          "╰┈➤ Type !help to see the full list.",
          DIVIDER,
        ].join("\n");
      }

      const reqRole = command.requiredRole || "USER";
      if (!hasPermission(user.access_role, reqRole)) {
        return [
          DIVIDER,
          "╭┈ ❒ Access Denied",
          `╰┈➤ You do not have permission to view "!${name}".`,
          DIVIDER,
        ].join("\n");
      }

      return [
        DIVIDER,
        `╭┈ ❒ !${command.name}`,
        `╰┈➤ Description: ${command.description || "No description available."}`,
        `╰┈➤ Category: ${command.category || "General"}`,
        command.aliases?.length
          ? `╰┈➤ Aliases: ${command.aliases.map((a) => `!${a}`).join(", ")}`
          : null,
        `╰┈➤ Required Role: ${getRoleString(reqRole)}`,
        `╰┈➤ Usage: ${command.usage || `!${command.name}`}`,
        `╰┈➤ Cooldown: ${command.cooldownSeconds || 0}s`,
        DIVIDER,
      ]
        .filter((line) => line !== null)
        .join("\n");
    }

    // --- !help [page] ---
    const ordered = buildOrderedCommands(user.access_role);
    const pages = chunk(ordered, COMMANDS_PER_PAGE);
    const page = clampPage(query, pages.length);
    const cardsWithNumbers = pages[page - 1].map((command, i) => ({
      number: (page - 1) * COMMANDS_PER_PAGE + i + 1,
      command,
    }));

    return renderPage(cardsWithNumbers, page, pages.length, ordered.length);
  },
};