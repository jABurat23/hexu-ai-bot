const OWNER_GITHUB_USERNAME = "jABurat23";
const { ROLES, hasPermission, getRoleString } = require("../lib/roles");

module.exports = {
  name: "help",
  aliases: ["menu"],
  category: "General",
  description: "List all available commands grouped by role, or !help <command> for details.",
  handler: async (user, args, registry) => {
    const query = args[0];

    // Details on a specific command
    if (query) {
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

      // Check if user has permission to view this command
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
        `│ Required Role: ${getRoleString(reqRole)}`,
        `│ Usage: ${command.usage || `!${command.name}`}`,
        `│ Cooldown: ${command.cooldownSeconds || 0}s`,
        "╰────────⭓",
      ].join("\n");
    }

    // List all commands grouped by role
    const all = [...new Set(Object.values(registry))].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    
    // Group commands based on required role
    const grouped = {};
    for (const roleKey of Object.keys(ROLES)) {
      grouped[roleKey] = [];
    }
    
    for (const c of all) {
      const reqRole = c.requiredRole || "USER";
      // Only show commands the user has permission to see
      if (hasPermission(user.access_role, reqRole)) {
        grouped[reqRole].push(c);
      }
    }

    const header = [
      "╭─────────────⭓",
      "│ 『 HEXU AI COMMANDS 』",
      "├────────⭔",
      "│ » Type !help <command> for details",
    ];

    const body = [];
    
    // Sort roles by level descending so OWNER commands are at the top (if they can see them)
    const sortedRoles = Object.values(ROLES).sort((a, b) => b.level - a.level);
    
    for (const role of sortedRoles) {
      const commands = grouped[role.name];
      if (commands && commands.length > 0) {
        body.push("├─────⭔");
        body.push(`│ ${role.emoji} ${role.name} COMMANDS`);
        const categories = {};
        for (const command of commands) {
          const category = command.category || "General";
          if (!categories[category]) categories[category] = [];
          categories[category].push(command);
        }
        for (const [category, categoryCommands] of Object.entries(categories)) {
          body.push(`│ ${category}:`);
          for (const c of categoryCommands) {
            body.push(`│ ⮑ !${c.name} — ${c.description || "No description."}`);
          }
        }
      }
    }

    const footer = [
      "├─────⭔",
      `│ Owner: ${OWNER_GITHUB_USERNAME}`, 
      "╰─────────────⭓"
    ];

    return [...header, ...body, ...footer].join("\n");
  },
};