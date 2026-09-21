const axios = require("axios");

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
    { params: { access_token: process.env.PAGE_ACCESS_TOKEN } }
  );
}

/**
 * Show/hide the "..." typing indicator.
 */
async function sendTypingOn(psid) {
  await axios.post(
    GRAPH_URL,
    { recipient: { id: psid }, sender_action: "typing_on" },
    { params: { access_token: process.env.PAGE_ACCESS_TOKEN } }
  );
}

module.exports = { sendText, sendTypingOn };
