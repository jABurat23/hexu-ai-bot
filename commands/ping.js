const { sendTypingOn } = require("../lib/messenger");
const { supabase } = require("../lib/supabase");

/**
 * Times a promise, returning { ms, ok }. Never throws — a failed check
 * just reports as unreachable rather than crashing the command.
 */
async function timeIt(promiseFactory) {
  const start = Date.now();
  try {
    await promiseFactory();
    return { ms: Date.now() - start, ok: true };
  } catch {
    return { ms: Date.now() - start, ok: false };
  }
}

module.exports = {
  name: "ping",
  description: "Check the bot's status and response latency.",
  handler: async (user) => {
    // Piggyback on the typing indicator as a real round-trip to the
    // Messenger Graph API — costs nothing extra, gives a genuine latency.
    const api = await timeIt(() => sendTypingOn(user.psid));

    // A trivial query against Supabase to check DB connectivity/latency.
    const db = await timeIt(() =>
      supabase.from("users").select("psid").limit(1).throwOnError()
    );

    const allOk = api.ok && db.ok;
    const status = allOk ? "🟢 Online" : "🟡 Degraded";

    return [
      `Status: ${status}`,
      `Messenger API: ${api.ok ? `${api.ms}ms` : "unreachable"}`,
      `Database: ${db.ok ? `${db.ms}ms` : "unreachable"}`,
    ].join("\n");
  },
};