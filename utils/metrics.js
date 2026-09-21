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

function increment(name, amount = 1) {
  if (typeof metrics[name] === "number") metrics[name] += amount;
}

function recordEvent(durationMs, failed = false) {
  increment("eventsReceived");
  increment(failed ? "eventsFailed" : "eventsCompleted");
  metrics.totalEventDurationMs += durationMs;
}

function recordCommand(failed = false) {
  increment(failed ? "commandsFailed" : "commandsRun");
}

function recordAi(failed = false) {
  increment(failed ? "aiFailures" : "aiReplies");
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

module.exports = { recordEvent, recordCommand, recordAi, snapshot };
