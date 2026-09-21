const axios = require("axios");
const config = require("../config");

// Message reactions (added below) need a newer Graph API version than the
// project started on — v21.0 predates that feature.
const GRAPH_URL = "https://graph.facebook.com/v23.0/me/messages";
const graphRequest = axios.create({ timeout: config.requestTimeoutMs });

/**
 * Send a plain text message to a Messenger user.
 */
async function sendText(psid, text) {
  // Messenger caps text at 2000 chars; trim defensively.
  const trimmed = text.length > 2000 ? text.slice(0, 1997) + "..." : text;

  await graphRequest.post(
    GRAPH_URL,
    {
      recipient: { id: psid },
      message: { text: trimmed },
    },
    { params: { access_token: config.pageAccessToken } }
  );
}

/**
 * Send a "button template" message: body text plus up to 3 tappable
 * buttons (e.g. a web_url button that opens a link).
 * buttons: [{ type: "web_url", url, title }, ...] — title max 20 chars,
 * text max 640 chars (Messenger platform limits).
 */
async function sendButtonTemplate(psid, text, buttons) {
  await graphRequest.post(
    GRAPH_URL,
    {
      recipient: { id: psid },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text,
            buttons,
          },
        },
      },
    },
    { params: { access_token: config.pageAccessToken } }
  );
}

/**
 * React (or edit an existing reaction) on a specific message from the
 * user — identified by its message id (event.message.mid on the webhook
 * payload), not the user's psid. Used to show progress on a command, e.g.
 * an hourglass while it runs, swapped for a checkmark once it's done.
 */
async function reactToMessage(psid, messageId, reaction) {
  await graphRequest.post(
    GRAPH_URL,
    {
      recipient: { id: psid },
      sender_action: "react",
      payload: { message_id: messageId, reaction },
    },
    { params: { access_token: config.pageAccessToken } }
  );
}

/**
 * Remove a reaction previously set with reactToMessage.
 */
async function unreactToMessage(psid, messageId) {
  await graphRequest.post(
    GRAPH_URL,
    {
      recipient: { id: psid },
      sender_action: "unreact",
      payload: { message_id: messageId },
    },
    { params: { access_token: config.pageAccessToken } }
  );
}

/**
 * Show/hide the "..." typing indicator.
 */
async function sendTypingOn(psid) {
  await graphRequest.post(
    GRAPH_URL,
    { recipient: { id: psid }, sender_action: "typing_on" },
    { params: { access_token: config.pageAccessToken } }
  );
}

module.exports = {
  sendText,
  sendButtonTemplate,
  sendTypingOn,
  reactToMessage,
  unreactToMessage,
};