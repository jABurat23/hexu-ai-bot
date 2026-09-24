const crypto = require("crypto");
const express = require("express");
const config = require("../config");
const logger = require("../utils/logger");
const { handleEvent } = require("../services/messageService");
const MessageQueue = require("../utils/messageQueue");

const router = express.Router();
const messageQueue = new MessageQueue({
  maxSize: config.queueMaxSize,
  concurrency: config.queueConcurrency,
});

// Fast pre-check dedup: Meta can redeliver the same webhook event, and this
// short-circuits a true dupe before it even reaches the queue or the DB
// (lib/supabase.js's claimMessage is still the source of truth across
// restarts, since this Set is cleared on every deploy — this is purely a
// same-process optimization to save a queue slot + DB round trip).
const recentlySeenMessageIds = new Set();
const DEDUP_TTL_MS = 10_000;

function isDuplicateInMemory(messageId) {
  if (!messageId) return false;
  if (recentlySeenMessageIds.has(messageId)) return true;
  recentlySeenMessageIds.add(messageId);
  setTimeout(() => recentlySeenMessageIds.delete(messageId), DEDUP_TTL_MS).unref();
  return false;
}

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
  if (!config.appSecret) return config.nodeEnv !== "production";
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
      logger.debug(`evt:${eventId}`, describeEvent(event));

      const messageId = event.message?.mid || event.postback?.mid;
      if (isDuplicateInMemory(messageId)) {
        logger.debug(`evt:${eventId}`, `Skipped (in-memory dedup) mid=${messageId}.`);
        continue;
      }

      const accepted = messageQueue.enqueue(async () => {
        try {
          await handleEvent(event, eventId);
          logger.info(`evt:${eventId}`, `Handled in ${Date.now() - startedAt}ms`);
        } catch (err) {
          logger.error(`evt:${eventId}`, "Failed:", err.message);
        }
      });
      if (!accepted) {
        logger.warn(`evt:${eventId}`, "Dropped: message queue is full or shutting down.");
      }
    }
  }
});

module.exports = router;
module.exports.messageQueue = messageQueue;

function describeEvent(event) {
  if (event.message?.attachments) return "attachment message";
  if (event.message?.quick_reply) return "quick reply";
  if (event.message) return "message";
  if (event.postback) return "postback";
  if (event.delivery) return "delivery";
  if (event.read) return "read";
  if (event.reaction) return "reaction";
  return "unknown event";
}