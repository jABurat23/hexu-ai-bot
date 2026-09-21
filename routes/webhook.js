const crypto = require("crypto");
const express = require("express");
const config = require("../config");
const logger = require("../utils/logger");
const { handleEvent } = require("../services/messageService");

const router = express.Router();

// --- Webhook verification (Meta calls this once when you save the config) ---
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.webhookVerifyToken) {
    logger.info("webhook", "Verified.");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Signature check (confirms the request really came from Meta) ---
function isValidSignature(req) {
  if (!config.appSecret) return true; // allowed in early dev, see config.js warning
  const signature = req.get("x-hub-signature-256");
  if (!signature) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", config.appSecret).update(req.rawBody).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false; // buffers of different length, etc.
  }
}

// --- Incoming messages ---
router.post("/", async (req, res) => {
  if (!isValidSignature(req)) {
    logger.warn("webhook", "Rejected request: invalid signature.");
    return res.sendStatus(403);
  }

  // Always ack immediately; Meta retries aggressively on slow/failed responses.
  res.status(200).send("EVENT_RECEIVED");

  const body = req.body;
  if (body.object !== "page") return;

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      const eventId = logger.newEventId();
      const startedAt = Date.now();
      handleEvent(event, eventId)
        .then(() => logger.info(`evt:${eventId}`, `Handled in ${Date.now() - startedAt}ms`))
        .catch((err) => logger.error(`evt:${eventId}`, "Failed:", err.message));
    }
  }
});

module.exports = router;