require("dotenv").config();
const crypto = require("crypto");
const express = require("express");

const { sendText, sendTypingOn } = require("./lib/messenger");
const { getAiReply } = require("./lib/claude");
const { getOrCreateUser, saveMessage, getRecentHistory } = require("./lib/supabase");
const { parseCommand, runCommand } = require("./commands");

const app = express();

// Keep the raw body around so we can verify Meta's signature.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// --- Health check (also what you can point Render's health check at) ---
app.get("/", (_req, res) => res.send("Hexu AI bot is running."));

// --- Webhook verification (Meta calls this once when you save the config) ---
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("Webhook verified.");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Signature check (confirms the request really came from Meta) ---
function isValidSignature(req) {
  if (!process.env.APP_SECRET) return true; // allow skipping in early dev
  const signature = req.get("x-hub-signature-256");
  if (!signature) return false;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", process.env.APP_SECRET)
      .update(req.rawBody)
      .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// --- Incoming messages ---
app.post("/webhook", async (req, res) => {
  if (!isValidSignature(req)) return res.sendStatus(403);

  // Always ack immediately; Meta retries aggressively on slow/failed responses.
  res.status(200).send("EVENT_RECEIVED");

  const body = req.body;
  if (body.object !== "page") return;

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      handleEvent(event).catch((err) =>
        console.error("Error handling event:", err)
      );
    }
  }
});

async function handleEvent(event) {
  const psid = event.sender?.id;
  if (!psid || !event.message || event.message.is_echo) return;

  const text = event.message.text;
  if (!text) return; // ignore attachments/stickers for now

  await getOrCreateUser(psid);
  await saveMessage(psid, "user", text);

  const { isCommand, name, args } = parseCommand(text);

  if (isCommand) {
    const result = await runCommand(name, psid, args);
    const reply = result ?? `Unknown command: ${name}. Try !help.`;
    await saveMessage(psid, "assistant", reply);
    await sendText(psid, reply);
    return;
  }

  // No command matched — fall through to AI response.
  await sendTypingOn(psid);
  const history = await getRecentHistory(psid);
  const reply = await getAiReply(history);
  await saveMessage(psid, "assistant", reply);
  await sendText(psid, reply);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Hexu AI bot listening on port ${PORT}`));
