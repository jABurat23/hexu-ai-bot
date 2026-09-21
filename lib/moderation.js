const { hasPermission, ROLES } = require("./roles");
const { getUserByPsid } = require("./supabase");

async function getTarget(targetPsid) {
  if (!targetPsid) return null;
  return getUserByPsid(targetPsid);
}

function canModerate(actor, target) {
  if (!target) return "User not found. The user must message the bot first.";
  if (target.psid === actor.psid) return "You cannot moderate yourself.";
  const targetRole = ROLES[target.access_role] || ROLES.USER;
  const actorRole = ROLES[actor.access_role] || ROLES.USER;
  if (!hasPermission(actor.access_role, "OWNER") &&
      targetRole.level >= actorRole.level) {
    return "You cannot moderate a user with an equal or higher role.";
  }
  return null;
}

function usage(command, text) {
  return `Usage: !${command} ${text}`;
}

module.exports = { getTarget, canModerate, usage };
