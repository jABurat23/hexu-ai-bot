const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Hexu AI, a friendly, concise assistant chatting with someone over Facebook Messenger.
Keep replies short and conversational — a few sentences at most, since this is a chat app, not an essay.`;

/**
 * history: array of { role: "user" | "assistant", content: string }, oldest first.
 * Returns the assistant's reply text.
 */
async function getAiReply(history) {
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
