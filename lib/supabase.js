const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HISTORY_LIMIT = 20; // messages kept per user for AI context

/**
 * Ensure a user row exists for this Messenger PSID. Returns the user row.
 */
async function getOrCreateUser(psid) {
  const { data: existing, error: fetchErr } = await supabase
    .from("users")
    .select("*")
    .eq("psid", psid)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (existing) return existing;

  const { data: created, error: insertErr } = await supabase
    .from("users")
    .insert({ psid })
    .select()
    .single();

  if (insertErr) throw insertErr;
  return created;
}

/**
 * Save one message (from user or bot) to history.
 */
async function saveMessage(psid, role, content) {
  const { error } = await supabase
    .from("messages")
    .insert({ psid, role, content });
  if (error) throw error;
}

/**
 * Get the last N messages for a user, oldest first, formatted for the
 * Claude API (role: "user" | "assistant").
 */
async function getRecentHistory(psid, limit = HISTORY_LIMIT) {
  const { data, error } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("psid", psid)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).reverse();
}

module.exports = { supabase, getOrCreateUser, saveMessage, getRecentHistory };
