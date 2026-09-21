const { getUsers } = require("../lib/supabase");

const PAGE_SIZE = 10;

module.exports = {
  name: "users",
  category: "Admin",
  requiredRole: "ADMIN",
  usage: "!users [page]",
  cooldownSeconds: 5,
  description: "List registered users with roles. Admin only.",
  handler: async (_user, args) => {
    const requestedPage = args[0] ? Number(args[0]) : 1;
    const page = Number.isInteger(requestedPage) ? Math.max(requestedPage, 1) : 1;
    const users = await getUsers(PAGE_SIZE, (page - 1) * PAGE_SIZE);

    if (!users.length) {
      return page === 1 ? "No registered users found." : `No users found on page ${page}.`;
    }

    const lines = [`╭── USERS · PAGE ${page} ──⭓`];
    for (const user of users) {
      lines.push(`│ ${user.access_role} · ${user.psid}`);
    }
    lines.push(`│ Showing up to ${PAGE_SIZE} users.`);
    lines.push("╰────────⭓");
    return lines.join("\n");
  },
};
