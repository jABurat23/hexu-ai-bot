const axios = require("axios");
const config = require("../config");
const logger = require("./logger");

/**
 * Render's free web services spin down after 15 minutes without inbound
 * HTTP traffic (see https://render.com/free#spinning-down-on-idle), then
 * cold-start on the next request — which is the multi-second delay a user
 * sees on the first message after the bot's been idle.
 *
 * This is NOT an officially supported fix. Render's own recommendation
 * for eliminating cold starts is a paid instance; a self-ping is a common
 * workaround, not a guarantee — Render can still restart the service for
 * other reasons (deploys, host maintenance, etc.), and this only helps on
 * the free tier in the first place. Treat it as "good enough to avoid the
 * common case", not a reliability promise.
 */

let intervalHandle = null;

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

async function pingSelf(url, attempt = 1) {
  const startedAt = Date.now();
  try {
    await axios.get(url, { timeout: 10_000 });
    logger.debug(
      "keepAlive",
      `Self-ping ok (${Date.now() - startedAt}ms)${attempt > 1 ? ` after ${attempt} attempt(s)` : ""}.`
    );
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      logger.debug(
        "keepAlive",
        `Self-ping attempt ${attempt} failed (${err.message}) — retrying in ${RETRY_DELAY_MS}ms.`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return pingSelf(url, attempt + 1);
    }
    // Not fatal — just means this cycle didn't reset the idle timer. The
    // next scheduled interval will try again from attempt 1.
    logger.warn("keepAlive", `Self-ping failed after ${attempt} attempt(s):`, err.message);
  }
}

/**
 * Starts the periodic self-ping. Safe to call unconditionally at startup —
 * it no-ops when disabled, when there's no known public URL to ping
 * (e.g. running locally), or if it's already running.
 */
function startKeepAlive() {
  if (!config.keepAliveEnabled) {
    logger.debug("keepAlive", "Disabled via KEEP_ALIVE=false.");
    return;
  }
  if (!config.externalUrl) {
    logger.debug(
      "keepAlive",
      "No RENDER_EXTERNAL_URL / EXTERNAL_URL set — nothing to ping (expected when running locally)."
    );
    return;
  }
  if (intervalHandle) return; // already running

  const minutes = Math.round(config.keepAliveIntervalMs / 60000);
  logger.info(
    "keepAlive",
    `Pinging ${config.externalUrl} every ${minutes} min to prevent free-tier spin-down.`
  );

  intervalHandle = setInterval(() => pingSelf(config.externalUrl), config.keepAliveIntervalMs);
  // Don't let this timer alone keep the Node process alive during shutdown.
  intervalHandle.unref();
}

function stopKeepAlive() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startKeepAlive, stopKeepAlive };