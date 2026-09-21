const { sendText, sendButtonTemplate, sendTypingOn } = require("../lib/messenger");
const { REACTION_PENDING, REACTION_DONE, REACTION_ERROR, setReaction } = require("../lib/reaction");
const { getAiReply } = require("../lib/claude");
const {
  getOrCreateUser,
  saveMessage,
  getRecentHistory,
  claimMessage,
  getBlockedUser,
} = require("../lib/supabase");
const { parseCommand, runCommand } = require("../commands");
const logger = require("../utils/logger");
const { recordEvent, recordAi } = require("../utils/metrics");

/**
 * Handles one Messenger "messaging" event: a user's incoming text message.
 * eventId (from routes/webhook.js) ties every log line for this message
 * together — grep the logs for "evt:<id>" to see its full path.
 */
async function handleEvent(event, eventId = logger.newEventId()) {
  const eventStartedAt = Date.now();
  const scope = `evt:${eventId}`;
  const psid = event.sender?.id;

  if (!psid) {
    logger.debug(scope, "Skipped event without a sender.");
    recordEvent(Date.now() - eventStartedAt);
    return;
  }

  if (event.delivery || event.read || event.reaction) {
    logger.debug(scope, "Received delivery/read/reaction event.");
    recordEvent(Date.now() - eventStartedAt);
    return;
  }

  if (event.message?.is_echo) {
    logger.debug(scope, "Skipped echo event.");
    recordEvent(Date.now() - eventStartedAt);
    return;
  }

  const message = event.message || event.postback;
  if (!message) {
    logger.debug(scope, "Skipped unsupported event shape.");
    recordEvent(Date.now() - eventStartedAt);
    return;
  }

  const messageId = event.message?.mid || event.postback?.mid;

  const user = await getOrCreateUser(psid);
  const blocked = await getBlockedUser(psid);
  if (blocked) {
    logger.info(scope, `Blocked user ignored: psid=${psid}.`);
    recordEvent(Date.now() - eventStartedAt);
    return;
  }

  if (messageId && !(await claimMessage(messageId, psid))) {
    logger.info(scope, `Skipped duplicate message mid=${messageId}.`);
    recordEvent(Date.now() - eventStartedAt);
    return;
  }

  if (messageId && !(await claimMessage(messageId, psid))) {
    logger.info(scope, `Skipped duplicate message mid=${messageId}.`);
    recordEvent(Date.now() - eventStartedAt);
    return;
  }

  const text = getEventText(event);
  if (!text) {
    await sendUnsupportedMessage(psid, scope);
    recordEvent(Date.now() - eventStartedAt);
    return;
  }

  logger.info(scope, `Input from psid=${psid}: "${text}"`);

  await saveMessage(psid, "user", text);

  const { isCommand, name, args } = parseCommand(text);

  if (isCommand) {
    logger.debug(scope, `Routed to command "!${name}"${args.length ? ` args=${JSON.stringify(args)}` : ""}`);
    await handleCommand(user, name, args, scope, messageId);
    recordEvent(Date.now() - eventStartedAt);
    return;
  }

  logger.debug(scope, "No command matched — routed to AI fallback.");
  await handleAiFallback(psid, scope);
  recordEvent(Date.now() - eventStartedAt);
}

function getEventText(event) {
  if (event.message?.text) return event.message.text;

  const payload =
    event.postback?.payload || event.message?.quick_reply?.payload;
  if (!payload) return null;
  if (payload === "GET_STARTED" || payload === "HELP") return "!help";
  if (payload.startsWith("CMD:")) return payload.slice(4).trim();
  return null;
}

async function sendUnsupportedMessage(psid, scope) {
  const reply =
    "I can currently process text messages and commands. Please send text or type !help.";
  try {
    await sendText(psid, reply);
    logger.debug(scope, "Sent unsupported-message guidance.");
  } catch (err) {
    logger.warn(scope, "Failed to send unsupported-message guidance:", err.message);
  }
}

async function handleCommand(user, name, args, scope, messageId) {
  const psid = user.psid;
  setReaction(psid, messageId, REACTION_PENDING, scope);

  try {
    const result = await runCommand(name, user, args);

    if (result == null) {
      logger.warn(scope, `Unknown command "!${name}".`);
      const reply = `Unknown command: ${name}. Try !help.`;
      await saveMessage(psid, "assistant", reply);
      await sendText(psid, reply);
      setReaction(psid, messageId, REACTION_DONE, scope);
      return;
    }

    // A command returns either a plain string (sent as normal text) or a
    // rich reply object like { type: "button_template", text, buttons }
    // (see commands/help.js) for messages that need tappable buttons.
    if (typeof result === "string") {
      await saveMessage(psid, "assistant", result);
      await sendText(psid, result);
      logger.debug(scope, `Replied to "!${name}" (text, ${result.length} chars).`);
    } else {
      await saveMessage(psid, "assistant", result.text);
      if (result.type === "button_template") {
        await sendButtonTemplate(psid, result.text, result.buttons);
        logger.debug(
          scope,
          `Replied to "!${name}" (button_template, ${result.buttons.length} button(s)).`
        );
      } else {
        await sendText(psid, result.text);
        logger.debug(scope, `Replied to "!${name}" (text).`);
      }
    }

    setReaction(psid, messageId, REACTION_DONE, scope);
  } catch (err) {
    setReaction(psid, messageId, REACTION_ERROR, scope);
    throw err;
  }
}

async function handleAiFallback(psid, scope) {
  await sendTypingOn(psid);
  try {
    const history = await getRecentHistory(psid);
    const reply = await getAiReply(history);
    recordAi();
    await saveMessage(psid, "assistant", reply);
    await sendText(psid, reply);
    logger.debug(scope, `AI replied (${reply.length} chars).`);
  } catch (err) {
    recordAi(true);
    logger.warn(scope, "AI fallback skipped:", err.message);
    const fallback =
      "I’m temporarily unable to answer right now. Please try again in a moment.";
    try {
      await saveMessage(psid, "assistant", fallback);
      await sendText(psid, fallback);
    } catch (fallbackErr) {
      logger.error(scope, "Failed to send AI fallback message:", fallbackErr.message);
    }
  }
}

module.exports = { handleEvent };