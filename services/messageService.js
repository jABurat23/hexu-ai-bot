const { sendText, sendButtonTemplate, sendTypingOn } = require("../lib/messenger");
const { getAiReply } = require("../lib/claude");
const { getOrCreateUser, saveMessage, getRecentHistory } = require("../lib/supabase");
const { parseCommand, runCommand } = require("../commands");
const logger = require("../utils/logger");

/**
 * Handles one Messenger "messaging" event: a user's incoming text message.
 * eventId (from routes/webhook.js) ties every log line for this message
 * together — grep the logs for "evt:<id>" to see its full path.
 */
async function handleEvent(event, eventId = logger.newEventId()) {
  const scope = `evt:${eventId}`;
  const psid = event.sender?.id;

  if (!psid || !event.message || event.message.is_echo) {
    logger.debug(scope, "Skipped (no psid, no message body, or echo).");
    return;
  }

  const text = event.message.text;
  if (!text) {
    logger.debug(scope, "Skipped (non-text message — attachment/sticker).");
    return;
  }

  logger.info(scope, `Message from psid=${psid}: "${text}"`);

  await getOrCreateUser(psid);
  await saveMessage(psid, "user", text);

  const { isCommand, name, args } = parseCommand(text);

  if (isCommand) {
    logger.debug(scope, `Routed to command "!${name}"${args.length ? ` args=${JSON.stringify(args)}` : ""}`);
    await handleCommand(psid, name, args, scope);
    return;
  }

  logger.debug(scope, "No command matched — routed to AI fallback.");
  await handleAiFallback(psid, scope);
}

async function handleCommand(psid, name, args, scope) {
  const result = await runCommand(name, psid, args);

  if (result == null) {
    logger.warn(scope, `Unknown command "!${name}".`);
    const reply = `Unknown command: ${name}. Try !help.`;
    await saveMessage(psid, "assistant", reply);
    await sendText(psid, reply);
    return;
  }

  // A command returns either a plain string (sent as normal text) or a
  // rich reply object like { type: "button_template", text, buttons }
  // (see commands/help.js) for messages that need tappable buttons.
  if (typeof result === "string") {
    await saveMessage(psid, "assistant", result);
    await sendText(psid, result);
    logger.debug(scope, `Replied to "!${name}" (text, ${result.length} chars).`);
    return;
  }

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

async function handleAiFallback(psid, scope) {
  await sendTypingOn(psid);
  try {
    const history = await getRecentHistory(psid);
    const reply = await getAiReply(history);
    await saveMessage(psid, "assistant", reply);
    await sendText(psid, reply);
    logger.debug(scope, `AI replied (${reply.length} chars).`);
  } catch (err) {
    // Most common cause: ANTHROPIC_API_KEY not set yet. Log and stay quiet
    // rather than send the user an error message.
    logger.warn(scope, "AI fallback skipped:", err.message);
  }
}

module.exports = { handleEvent };