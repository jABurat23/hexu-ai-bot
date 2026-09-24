const { getAiReply } = require("../lib/gemini");
const { saveAiMessage, getRecentAiHistory } = require("../lib/supabase");
const contextCache = require("../utils/contextCache");
const { recordAi } = require("../utils/metrics");

module.exports = {
  name: "ai",
  category: "AI",
  usage: "!ai <question>",
  cooldownSeconds: 6,
  description: "Ask AI anything, powered by Gemini.",
  handler: async (user, args) => {
    const question = args.join(" ").trim();
    if (!question) {
      return "Usage: !ai <question>";
    }

    const psid = user.psid;

    if (contextCache.isRateLimited(psid)) {
      return "You're sending !ai requests too fast — wait a bit and try again.";
    }
    contextCache.recordCall(psid);

    // The in-memory cache starts empty on every process restart; seed it
    // from Supabase on first use per user so context survives a redeploy.
    if (contextCache.getHistory(psid).length === 0) {
      const stored = await getRecentAiHistory(psid);
      for (const turn of stored) contextCache.appendTurn(psid, turn.role, turn.content);
    }

    contextCache.appendTurn(psid, "user", question);
    await saveAiMessage(psid, "user", question);

    try {
      const reply = await getAiReply(contextCache.getHistory(psid));
      recordAi();
      contextCache.appendTurn(psid, "assistant", reply);
      await saveAiMessage(psid, "assistant", reply);
      return reply;
    } catch (err) {
      recordAi(true);
      // Graceful, not a thrown error — a Gemini hiccup shouldn't show as a
      // failed command (❌ reaction) to the user, just an apologetic reply.
      return "I'm temporarily unable to answer right now. Please try again in a moment.";
    }
  },
};