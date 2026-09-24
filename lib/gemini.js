const { GoogleGenAI } = require("@google/genai");
const config = require("../config");

const client = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;

const MODEL = "gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = 400;

/**
 * history: array of { role: "user" | "assistant", content: string }, oldest
 * first, ending with the newest user turn. Returns the reply text.
 * Throws if GEMINI_API_KEY isn't configured — callers should catch this.
 */
async function getAiReply(history) {
  if (!client) {
    throw new Error("GEMINI_API_KEY is not set — the !ai command is disabled.");
  }

  // Gemini uses "user" / "model" roles, not "user" / "assistant".
  const contents = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const response = await client.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: config.geminiSystemPrompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });

  return response.text || "Sorry, I couldn't come up with a reply just now.";
}

module.exports = { getAiReply };