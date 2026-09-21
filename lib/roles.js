const ROLES = {
  USER: {
    name: "USER",
    level: 0,
    emoji: "👤",
  },
  ADMIN: {
    name: "ADMIN",
    level: 1,
    emoji: "🛡️",
  },
  DEVELOPER: {
    name: "DEVELOPER",
    level: 2,
    emoji: "💻",
  },
  OWNER: {
    name: "OWNER",
    level: 3,
    emoji: "👑",
  },
};

/**
 * Checks if the userRole meets or exceeds the requiredRole.
 * @param {string} userRoleName - The user's role (e.g. "USER")
 * @param {string} requiredRoleName - The required role (e.g. "ADMIN")
 * @returns {boolean} True if authorized
 */
function hasPermission(userRoleName, requiredRoleName) {
  const userRole = ROLES[userRoleName] || ROLES.USER;
  const requiredRole = ROLES[requiredRoleName] || ROLES.USER;
  
  return userRole.level >= requiredRole.level;
}

/**
 * Gets a formatted string for a role (e.g., "👑 OWNER").
 */
function getRoleString(roleName) {
  const role = ROLES[roleName] || ROLES.USER;
  return `${role.emoji} ${role.name}`;
}

module.exports = { ROLES, hasPermission, getRoleString };
