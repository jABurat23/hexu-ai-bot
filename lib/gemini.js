const { GoogleGenAI } = require("@google/genai");
const config = require("../config");
const runtimeSettings = require("../utils/runtimeSettings");

const client = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;

/** Ordered by preference — first working model wins. */
const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash"];
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

  let lastError;
  for (const model of MODELS) {
    try {
      const response = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: runtimeSettings.getGeminiSystemPrompt(),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      });

      const text = response.text;
      if (text) return text;
      // Empty response — try next model
    } catch (err) {
      lastError = err;
      const code = err?.status || err?.httpStatusCode || 0;
      // Retry on transient errors (429, 500, 503); bail on auth/client errors
      if (code && code < 500 && code !== 429) throw err;
      console.warn(`[gemini] ${model} failed (${code || err.message}), trying fallback…`);
    }
  }

  throw lastError || new Error("All Gemini models failed to produce a response.");
}

module.exports = { getAiReply };