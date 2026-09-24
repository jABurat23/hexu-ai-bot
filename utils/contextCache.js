// Purpose-built for !ai's conversation context — deliberately separate from
// utils/messageQueue.js, which handles webhook concurrency, not AI state.
// Mixing the two would violate single-responsibility for no real benefit.

const MAX_USERS = 100; // LRU-evicted once exceeded
const MAX_HISTORY_ENTRIES = 20; // per-user turns kept in memory
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_CALLS = 10;

const cache = new Map(); // psid -> { history: [{role,content}], lastUsed, callTimestamps: number[] }

function evictIfFull() {
  if (cache.size < MAX_USERS) return;
  // Map iterates in insertion order, and getOrCreate() below re-inserts an
  // entry on every access — so the first key here is genuinely the least
  // recently used one, not just the oldest-created.
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

function getOrCreate(psid) {
  let entry = cache.get(psid);
  if (entry) {
    // Re-insert to move this key to the "most recently used" end.
    cache.delete(psid);
    cache.set(psid, entry);
  } else {
    evictIfFull();
    entry = { history: [], lastUsed: Date.now(), callTimestamps: [] };
    cache.set(psid, entry);
  }
  entry.lastUsed = Date.now();
  return entry;
}

/** Current in-memory history for a user (empty array if none cached yet). */
function getHistory(psid) {
  return getOrCreate(psid).history;
}

/** Appends one turn, trimming from the front once over the cap. */
function appendTurn(psid, role, content) {
  const entry = getOrCreate(psid);
  entry.history.push({ role, content });
  if (entry.history.length > MAX_HISTORY_ENTRIES) {
    entry.history.splice(0, entry.history.length - MAX_HISTORY_ENTRIES);
  }
}

/** True if this user has hit the rate limit within the current window. */
function isRateLimited(psid) {
  const entry = getOrCreate(psid);
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  entry.callTimestamps = entry.callTimestamps.filter((t) => t > cutoff);
  return entry.callTimestamps.length >= RATE_LIMIT_MAX_CALLS;
}

/** Records one !ai call against the rate limit window. Call after the
 * isRateLimited() check passes, not before. */
function recordCall(psid) {
  getOrCreate(psid).callTimestamps.push(Date.now());
}

function getStats() {
  let recentCalls = 0;
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const entry of cache.values()) {
    recentCalls += entry.callTimestamps.filter((t) => t > cutoff).length;
  }
  return { cachedUsers: cache.size, maxUsers: MAX_USERS, recentCallsLastMinute: recentCalls };
}

module.exports = { getHistory, appendTurn, isRateLimited, recordCall, getStats };