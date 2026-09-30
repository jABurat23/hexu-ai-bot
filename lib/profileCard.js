const axios = require("axios");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const WIDTH = 700;
const HEIGHT = 240;
const RADIUS = 16;

/**
 * Utility to draw a rounded rectangle path on canvas.
 */
function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Utility to draw a compact pill badge.
 */
function drawPillBadge(ctx, text, rightX, centerY, bgColor, borderColor, textColor) {
  ctx.font = "bold 11px sans-serif";
  const textWidth = ctx.measureText(text).width;
  const paddingH = 10;
  const badgeWidth = textWidth + paddingH * 2;
  const badgeHeight = 22;
  const x = rightX - badgeWidth;
  const y = centerY - badgeHeight / 2;
  const radius = 11;

  ctx.save();
  drawRoundedRect(ctx, x, y, badgeWidth, badgeHeight, radius);
  ctx.fillStyle = bgColor;
  ctx.fill();
  if (borderColor) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + badgeWidth / 2, centerY);
  ctx.restore();
  return badgeWidth;
}

/**
 * Fetches an image buffer from URL with a short timeout.
 */
async function fetchImageBuffer(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return null;
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 3000,
      headers: { "User-Agent": "HexuAIBot/1.0" },
    });
    return Buffer.from(res.data);
  } catch {
    return null;
  }
}

/**
 * Renders a compact, high-density profile card (700x240).
 */
async function renderProfileCard({
  name = "HEXU USER",
  handle = "@user",
  psid = "N/A",
  role = "USER",
  rank = "RECRUIT",
  level = 1,
  avatarUrl = null,
} = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // 1. Clip card with 16px rounded corners
  ctx.save();
  drawRoundedRect(ctx, 0, 0, WIDTH, HEIGHT, RADIUS);
  ctx.clip();

  // 2. Background: Deep dark gradient
  const bgGrad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bgGrad.addColorStop(0, "#0c111a");
  bgGrad.addColorStop(1, "#070a0f");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle ambient glow behind avatar
  const radialGlow = ctx.createRadialGradient(85, 120, 10, 85, 120, 150);
  radialGlow.addColorStop(0, "rgba(0, 210, 255, 0.1)");
  radialGlow.addColorStop(1, "transparent");
  ctx.fillStyle = radialGlow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Card Outer Border
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, 1, 1, WIDTH - 2, HEIGHT - 2, RADIUS);
  ctx.stroke();
  ctx.restore();

  // -------------------------------------------------------------
  // LEFT: AVATAR & GLOW (Center X: 85, Center Y: 120)
  // -------------------------------------------------------------
  const avatarX = 85;
  const avatarY = 120;
  const avatarRadius = 46;

  // Outer glowing ring (#00d2ff)
  ctx.save();
  ctx.shadowColor = "#00d2ff";
  ctx.shadowBlur = 14;
  ctx.strokeStyle = "#00d2ff";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius + 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Avatar image or Fallback
  let loadedAvatar = null;
  const imgBuffer = await fetchImageBuffer(avatarUrl);
  if (imgBuffer) {
    try {
      loadedAvatar = await loadImage(imgBuffer);
    } catch {
      loadedAvatar = null;
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (loadedAvatar) {
    ctx.drawImage(
      loadedAvatar,
      avatarX - avatarRadius,
      avatarY - avatarRadius,
      avatarRadius * 2,
      avatarRadius * 2
    );
  } else {
    const fallbackGrad = ctx.createLinearGradient(
      avatarX - avatarRadius,
      avatarY - avatarRadius,
      avatarX + avatarRadius,
      avatarY + avatarRadius
    );
    fallbackGrad.addColorStop(0, "#16284d");
    fallbackGrad.addColorStop(1, "#0f172a");
    ctx.fillStyle = fallbackGrad;
    ctx.fill();

    const initial = (name || "U").trim().charAt(0).toUpperCase();
    ctx.fillStyle = "#00d2ff";
    ctx.font = "bold 38px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initial, avatarX, avatarY + 2);
  }
  ctx.restore();

  // Status Indicator Dot (Online)
  const dotX = avatarX + 32;
  const dotY = avatarY + 32;
  ctx.save();
  ctx.fillStyle = "#070a0f";
  ctx.beginPath();
  ctx.arc(dotX, dotY, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = "#00e676";
  ctx.shadowBlur = 8;
  ctx.fillStyle = "#00e676";
  ctx.beginPath();
  ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // -------------------------------------------------------------
  // RIGHT / MAIN CONTENT (Starts X: 160, Width: 500)
  // -------------------------------------------------------------
  const contentX = 160;
  const rightEdgeX = 665;

  // --- Row 1: User Name, Handle, Role Badge (Y: 48) ---
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const cleanName = (name || "HEXU USER").toUpperCase();
  let displayName = cleanName;
  while (ctx.measureText(displayName + "…").width > 260 && displayName.length > 3) {
    displayName = displayName.slice(0, -1);
  }
  if (displayName !== cleanName) displayName += "…";
  ctx.fillText(displayName, contentX, 48);

  // Handle
  const nameWidth = ctx.measureText(displayName).width;
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  const cleanHandle = handle.startsWith("@") ? handle : `@${handle}`;
  ctx.fillText(cleanHandle, contentX + nameWidth + 12, 48);

  // Role Pill Badge (Top Right)
  const upperRole = String(role || "USER").toUpperCase();
  let roleBg = "#1e293b";
  let roleBorder = "#334155";
  let roleText = "#94a3b8";
  if (upperRole === "OWNER") {
    roleBg = "#382312";
    roleBorder = "#78350f";
    roleText = "#fbbf24";
  } else if (upperRole === "ADMIN") {
    roleBg = "#172554";
    roleBorder = "#1d4ed8";
    roleText = "#60a5fa";
  } else if (upperRole === "MODERATOR") {
    roleBg = "#2e1065";
    roleBorder = "#581c87";
    roleText = "#c084fc";
  }
  drawPillBadge(ctx, upperRole, rightEdgeX, 48, roleBg, roleBorder, roleText);
  ctx.restore();

  // --- Row 2: Metadata Chips (Y: 96) ---
  const chipY = 96;
  ctx.save();

  // PSID Chip
  const psidText = `ID: ${String(psid).length > 14 ? String(psid).slice(0, 12) + "…" : String(psid)}`;
  ctx.font = "11px monospace";
  const psidWidth = ctx.measureText(psidText).width + 16;
  drawRoundedRect(ctx, contentX, chipY - 11, psidWidth, 22, 5);
  ctx.fillStyle = "#111827";
  ctx.fill();
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#94a3b8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(psidText, contentX + psidWidth / 2, chipY);

  // Rank Chip
  const rankX = contentX + psidWidth + 8;
  const upperRank = String(rank || "RECRUIT").toUpperCase();
  ctx.font = "bold 11px sans-serif";
  const rankWidth = ctx.measureText(upperRank).width + 16;
  drawRoundedRect(ctx, rankX, chipY - 11, rankWidth, 22, 5);
  ctx.fillStyle = "#1e1b4b";
  ctx.fill();
  ctx.strokeStyle = "#312e81";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#a5b4fc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(upperRank, rankX + rankWidth / 2, chipY);

  // Level Badge (Right Aligned)
  ctx.fillStyle = "#00e5ff";
  ctx.font = "bold 15px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(`LVL ${level}`, rightEdgeX, chipY);
  ctx.restore();

  // --- Row 3: Progress Bar (Y: 142) ---
  const barY = 142;
  const barWidth = rightEdgeX - contentX; // 505px
  const barHeight = 8;
  const numLevel = Number(level) || 1;
  const progressPercent = Math.min(100, Math.max(15, ((numLevel * 17) % 85) + 15)); // realistic demo progress 15-100%

  ctx.save();
  // Progress Bar Track
  drawRoundedRect(ctx, contentX, barY, barWidth, barHeight, 4);
  ctx.fillStyle = "#151e2e";
  ctx.fill();

  // Progress Bar Fill
  const fillWidth = Math.max(8, (barWidth * progressPercent) / 100);
  drawRoundedRect(ctx, contentX, barY, fillWidth, barHeight, 4);
  const fillGrad = ctx.createLinearGradient(contentX, barY, contentX + fillWidth, barY);
  fillGrad.addColorStop(0, "#00d2ff");
  fillGrad.addColorStop(1, "#3b82f6");
  ctx.fillStyle = fillGrad;
  ctx.fill();

  // Progress Percentage Label
  ctx.fillStyle = "#475569";
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("XP PROGRESS", contentX, barY - 4);

  ctx.textAlign = "right";
  ctx.fillText(`${progressPercent}%`, rightEdgeX, barY - 4);
  ctx.restore();

  // --- Row 4: Footer Accent (Y: 195) ---
  const footerY = 195;
  ctx.save();
  ctx.strokeStyle = "#162032";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(contentX, footerY - 14);
  ctx.lineTo(rightEdgeX, footerY - 14);
  ctx.stroke();

  // Footer Branding
  ctx.fillStyle = "#334155";
  ctx.font = "11px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("HEXU BOT // IDENTITY", contentX, footerY);

  // Status text
  ctx.fillStyle = "#00e676";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("● ACTIVE NOW", rightEdgeX, footerY);
  ctx.restore();

  return canvas.toBuffer("image/png");
}

module.exports = { renderProfileCard };
