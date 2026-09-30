const { GoogleGenAI } = require("@google/genai");
const config = require("../config");
const runtimeSettings = require("../utils/runtimeSettings");

const client = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;

/** Ordered by preference — first working model wins. */
const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-flash-latest"];
const MAX_OUTPUT_TOKENS = 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    // Try each model up to 2 times (initial + 1 retry with delay)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await sleep(1000); // brief pause before retry

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
        // Empty response — skip retry, try next model
        break;
      } catch (err) {
        lastError = err;
        const code = err?.status || err?.httpStatusCode || 0;
        // Bail immediately on auth/client errors (400, 401, 403, 404)
        if (code && code >= 400 && code < 500 && code !== 429) throw err;
        // Transient (429, 500, 503) — retry once, then try next model
        if (attempt === 0) {
          console.warn(`[gemini] ${model} attempt ${attempt + 1} failed (${code || err.message}), retrying…`);
        } else {
          console.warn(`[gemini] ${model} failed after retry (${code || err.message}), trying next model…`);
        }
      }
    }
  }

  throw lastError || new Error("All Gemini models failed to produce a response.");
}

module.exports = { getAiReply };