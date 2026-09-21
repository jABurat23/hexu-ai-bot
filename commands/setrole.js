const { updateUserRole } = require("../lib/supabase");
const { ROLES, getRoleString } = require("../lib/roles");

module.exports = {
  name: "setrole",
  category: "Admin",
  usage: "!setrole <psid> <role>",
  cooldownSeconds: 5,
  description: "Promote or demote a user to a specific role. Owner only.",
  requiredRole: "OWNER", // Only OWNER can run this command
  handler: async (_user, args) => {
    if (args.length < 2) {
      return [
        "╭── USAGE ──⭓",
        "│ !setrole <psid> <role>",
        "│ Example: !setrole 123456 ADMIN",
        "│ Roles: USER, ADMIN, DEVELOPER, OWNER",
        "╰────────⭓",
      ].join("\n");
    }

    const targetPsid = args[0];
    const newRole = args[1].toUpperCase();

    if (!ROLES[newRole]) {
      return `Invalid role "${newRole}". Valid roles are: ${Object.keys(ROLES).join(", ")}.`;
    }

    try {
      await updateUserRole(targetPsid, newRole);
      return [
        "╭── SUCCESS ──⭓",
        `│ User ${targetPsid} is now:`,
        `│ ${getRoleString(newRole)}`,
        "╰────────⭓",
      ].join("\n");
    } catch (err) {
      // If the PSID doesn't exist in the users table, Supabase will throw a foreign key or row not found error.
      return `Failed to update role. Does PSID ${targetPsid} exist? Error: ${err.message}`;
    }
  },
};
