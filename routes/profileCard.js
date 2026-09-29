const express = require("express");
const { getOrCreateUser, supabase } = require("../lib/supabase");
const { getUserProfile } = require("../lib/messenger");
const { renderProfileCard } = require("../lib/profileCard");
const logger = require("../utils/logger");

const router = express.Router();

function getRank(role, level) {
  const upperRole = String(role || "USER").toUpperCase();
  if (upperRole === "OWNER") return "COMMANDER";
  if (upperRole === "ADMIN") return "ELITE";
  if (upperRole === "MODERATOR") return "OFFICER";
  if (level >= 25) return "WARLORD";
  if (level >= 15) return "VETERAN";
  if (level >= 5) return "OPERATIVE";
  return "RECRUIT";
}

router.get("/:psid", async (req, res) => {
  const { psid } = req.params;

  if (!psid || !/^[0-9a-zA-Z_-]+$/.test(psid)) {
    return res.status(400).type("text/plain").send("Invalid PSID format.");
  }

  try {
    // 1. Fetch user record from Supabase
    let user;
    try {
      user = await getOrCreateUser(psid);
    } catch (dbErr) {
      logger.warn("profileCard", `Supabase lookup failed for ${psid}: ${dbErr.message}`);
      user = { psid, access_role: "USER" };
    }

    // 2. Fetch message count to determine dynamic level
    let messageCount = 0;
    try {
      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("psid", psid);
      messageCount = count || 0;
    } catch {
      messageCount = 0;
    }

    const level = Math.max(1, Math.floor(messageCount / 5) + 1);
    const rank = getRank(user.access_role, level);

    // 3. Fetch public name and avatar from Graph API
    let name = "HEXU USER";
    let handle = `@user_${psid.slice(-4)}`;
    let avatarUrl = null;

    try {
      const fbProfile = await getUserProfile(psid);
      if (fbProfile) {
        if (fbProfile.first_name || fbProfile.last_name) {
          name = [fbProfile.first_name, fbProfile.last_name].filter(Boolean).join(" ");
          handle = `@${(fbProfile.first_name || "user").toLowerCase().replace(/[^a-z0-9_]/g, "")}`;
        }
        if (fbProfile.profile_pic) {
          avatarUrl = fbProfile.profile_pic;
        }
      }
    } catch (fbErr) {
      logger.warn("profileCard", `Graph API profile lookup failed for ${psid}: ${fbErr.message}`);
    }

    // 4. Render canvas PNG buffer
    const buffer = await renderProfileCard({
      name,
      handle,
      psid: user.psid,
      role: user.access_role || "USER",
      rank,
      level,
      avatarUrl,
    });

    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=300"); // 5-minute cache
    res.send(buffer);
  } catch (err) {
    logger.error("profileCard", `Error rendering profile card for ${psid}:`, err);
    res.status(500).type("text/plain").send("Failed to generate profile card.");
  }
});

module.exports = router;
