const { reactToMessage } = require("./messenger");
const logger = require("../utils/logger");

const REACTION_PENDING = "⏳"; // set while a command is running
const REACTION_DONE = "✅"; // set once a reply has been sent
const REACTION_ERROR = "❌"; // set if the command handler threw

/**
 * Fire-and-forget reaction helper: reactions are cosmetic, so a failure
 * (e.g. older Graph API version, message too old to react to) should just
 * be logged at debug level, never block or fail the actual reply.
 * scope is an optional logger scope (e.g. "evt:abc123") for tracing.
 */
function setReaction(psid, messageId, emoji, scope = "") {
  if (!messageId) return;
  reactToMessage(psid, messageId, emoji).catch((err) =>
    logger.debug(scope, `Couldn't set ${emoji} reaction:`, err.message)
  );
}

module.exports = {
  REACTION_PENDING,
  REACTION_DONE,
  REACTION_ERROR,
  setReaction,
};