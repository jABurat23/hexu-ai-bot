const metrics = {
  startedAt: Date.now(),
  eventsReceived: 0,
  eventsCompleted: 0,
  eventsFailed: 0,
  commandsRun: 0,
  commandsFailed: 0,
  aiReplies: 0,
  aiFailures: 0,
  totalEventDurationMs: 0,
};

// name -> { run, failed }. Separate from `metrics` above since it's not a
// flat number — increment() only handles the simple counters.
const commandUsage = new Map();

function increment(name, amount = 1) {
  if (typeof metrics[name] === "number") metrics[name] += amount;
}

function recordEvent(durationMs, failed = false) {
  increment("eventsReceived");
  increment(failed ? "eventsFailed" : "eventsCompleted");
  metrics.totalEventDurationMs += durationMs;
}

function recordCommand(name, failed = false) {
  increment(failed ? "commandsFailed" : "commandsRun");
  if (!name) return;
  const entry = commandUsage.get(name) || { run: 0, failed: 0 };
  if (failed) entry.failed += 1;
  else entry.run += 1;
  commandUsage.set(name, entry);
}

function recordAi(failed = false) {
  increment(failed ? "aiFailures" : "aiReplies");
}

/** Top N commands by total (run + failed) calls, most-used first. */
function topCommands(limit = 5) {
  return [...commandUsage.entries()]
    .map(([name, counts]) => ({ name, ...counts, total: counts.run + counts.failed }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

function snapshot() {
  return {
    ...metrics,
    uptimeSeconds: Math.floor((Date.now() - metrics.startedAt) / 1000),
    averageEventDurationMs:
      metrics.eventsCompleted + metrics.eventsFailed > 0
        ? Math.round(
            metrics.totalEventDurationMs /
              (metrics.eventsCompleted + metrics.eventsFailed)
          )
        : 0,
  };
}

module.exports = { recordEvent, recordCommand, recordAi, topCommands, snapshot };