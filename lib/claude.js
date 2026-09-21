const Anthropic = require("@anthropic-ai/sdk");
const config = require("../config");

const anthropic = config.anthropicApiKey
  ? new Anthropic({
      apiKey: config.anthropicApiKey,
      maxRetries: 2,
      timeout: config.requestTimeoutMs,
    })
  : null;

const SYSTEM_PROMPT = `You are Hexu AI, a friendly, concise assistant chatting with someone over Facebook Messenger.
Keep replies short and conversational — a few sentences at most, since this is a chat app, not an essay.`;

/**
 * history: array of { role: "user" | "assistant", content: string }, oldest first.
 * Returns the assistant's reply text.
 * Throws if ANTHROPIC_API_KEY isn't configured — callers should catch this.
 */
async function getAiReply(history) {
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY is not set — AI fallback is disabled.");
  }

  const messages = history.map((m) => ({ role: m.role, content: m.content }));

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock ? textBlock.text : "Sorry, I couldn't come up with a reply just now.";
}

module.exports = { getAiReply };
