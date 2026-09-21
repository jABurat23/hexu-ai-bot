const axios = require("axios");
const config = require("../config");

const GRAPH_URL = "https://graph.facebook.com/v21.0/me/messages";

/**
 * Send a plain text message to a Messenger user.
 */
async function sendText(psid, text) {
  // Messenger caps text at 2000 chars; trim defensively.
  const trimmed = text.length > 2000 ? text.slice(0, 1997) + "..." : text;

  await axios.post(
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
  await axios.post(
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
 * Show/hide the "..." typing indicator.
 */
async function sendTypingOn(psid) {
  await axios.post(
    GRAPH_URL,
    { recipient: { id: psid }, sender_action: "typing_on" },
    { params: { access_token: config.pageAccessToken } }
  );
}

module.exports = { sendText, sendButtonTemplate, sendTypingOn };