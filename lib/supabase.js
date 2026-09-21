const { createClient } = require("@supabase/supabase-js");
const config = require("../config");

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

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
  if (existing) {
    // Bootstrap: Automatically promote the owner PSID if set in config
    if (config.ownerPsid && existing.psid === config.ownerPsid && existing.access_role !== "OWNER") {
      return await updateUserRole(psid, "OWNER");
    }
    return existing;
  }

  const initialRole = (config.ownerPsid && psid === config.ownerPsid) ? "OWNER" : "USER";

  const { data: created, error: insertErr } = await supabase
    .from("users")
    .insert({ psid, access_role: initialRole })
    .select()
    .single();

  if (insertErr) throw insertErr;
  return created;
}

/**
 * Update a user's access role.
 */
async function updateUserRole(psid, newRole) {
  const { data, error } = await supabase
    .from("users")
    .update({ access_role: newRole })
    .eq("psid", psid)
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

async function getUsers(limit = 10, offset = 0) {
  const { data, error } = await supabase
    .from("users")
    .select("psid, access_role, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return data || [];
}

async function getUserByPsid(psid) {
  const { data, error } = await supabase
    .from("users")
    .select("psid, access_role, created_at")
    .eq("psid", psid)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getBlockedUser(psid) {
  const { data, error } = await supabase
    .from("blocked_users")
    .select("psid, reason, blocked_by, blocked_at")
    .eq("psid", psid)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function blockUser(psid, reason, blockedBy) {
  const { error } = await supabase.from("blocked_users").upsert({
    psid,
    reason: reason || "No reason provided",
    blocked_by: blockedBy,
  });
  if (error) throw error;
  await recordModeration("block", psid, blockedBy, reason);
}

async function unblockUser(psid, actorPsid) {
  const { error } = await supabase.from("blocked_users").delete().eq("psid", psid);
  if (error) throw error;
  await recordModeration("unblock", psid, actorPsid);
}

async function addWarning(psid, reason, warnedBy) {
  const { data, error } = await supabase
    .from("user_warnings")
    .insert({ psid, reason, warned_by: warnedBy })
    .select("id, psid, reason, created_at")
    .single();
  if (error) throw error;
  await recordModeration("warn", psid, warnedBy, reason);
  return data;
}

async function getWarnings(psid, limit = 10) {
  const { data, error } = await supabase
    .from("user_warnings")
    .select("id, reason, warned_by, created_at")
    .eq("psid", psid)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function clearWarnings(psid, actorPsid) {
  const { error } = await supabase.from("user_warnings").delete().eq("psid", psid);
  if (error) throw error;
  await recordModeration("clear_warnings", psid, actorPsid);
}

async function recordModeration(action, targetPsid, actorPsid, details = null) {
  const { error } = await supabase.from("moderation_audit").insert({
    action,
    target_psid: targetPsid,
    actor_psid: actorPsid,
    details,
  });
  if (error) throw error;
}

/**
 * Save one message (from user or bot) to history.
 */
async function saveMessage(psid, role, content) {
  const { error } = await supabase.from("messages").insert({ psid, role, content });
  if (error) throw error;
}

/**
 * Claim a Messenger message ID before processing it. Meta can redeliver the
 * same event, so only the first insert should be allowed to continue.
 */
async function claimMessage(messageId, psid) {
  if (!messageId) return true;

  const { data, error } = await supabase
    .from("processed_messages")
    .upsert(
      { message_id: messageId, psid },
      { onConflict: "message_id", ignoreDuplicates: true }
    )
    .select("message_id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
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

/**
 * Delete a user's stored conversation history without affecting their profile.
 */
async function clearMessageHistory(psid) {
  const { error } = await supabase.from("messages").delete().eq("psid", psid);
  if (error) throw error;
}

module.exports = {
  supabase,
  getOrCreateUser,
  saveMessage,
  getRecentHistory,
  updateUserRole,
  getUsers,
  getUserByPsid,
  getBlockedUser,
  blockUser,
  unblockUser,
  addWarning,
  getWarnings,
  clearWarnings,
  recordModeration,
  claimMessage,
  clearMessageHistory,
};
