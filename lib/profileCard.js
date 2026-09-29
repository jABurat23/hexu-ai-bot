const axios = require("axios");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const WIDTH = 1000;
const HEIGHT = 500;
const RADIUS = 24;

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
 * Utility to draw a styled rounded pill badge.
 */
function drawPillBadge(ctx, text, rightX, centerY, bgColor, borderColor, textColor) {
  ctx.font = "bold 13px sans-serif";
  const textWidth = ctx.measureText(text).width;
  const paddingH = 14;
  const badgeWidth = textWidth + paddingH * 2;
  const badgeHeight = 28;
  const x = rightX - badgeWidth;
  const y = centerY - badgeHeight / 2;
  const radius = 14;

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
}

/**
 * Fetches an image buffer from URL with a short timeout.
 * Returns null if network fails or URL is invalid.
 */
async function fetchImageBuffer(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return null;
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 3500,
      headers: { "User-Agent": "HexuAIBot/1.0" },
    });
    return Buffer.from(res.data);
  } catch {
    return null;
  }
}

/**
 * Renders a glassmorphic profile card.
 * @param {Object} options
 * @param {string} [options.name] Full display name
 * @param {string} [options.handle] Handle e.g. @username
 * @param {string} [options.psid] Page-scoped ID
 * @param {string} [options.role] Role (e.g. USER, ADMIN, OWNER)
 * @param {string} [options.rank] Rank title (e.g. RECRUIT, ELITE)
 * @param {number|string} [options.level] Level number or string
 * @param {string} [options.avatarUrl] Optional profile picture URL
 * @returns {Promise<Buffer>} PNG image buffer
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

  // 1. Clip overall card with 24px rounded corners
  ctx.save();
  drawRoundedRect(ctx, 0, 0, WIDTH, HEIGHT, RADIUS);
  ctx.clip();

  // 2. Background: Dark glassmorphic gradient (#0b101d to #070a12)
  const bgGrad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bgGrad.addColorStop(0, "#0b101d");
  bgGrad.addColorStop(0.5, "#090d18");
  bgGrad.addColorStop(1, "#070a12");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle ambient glow behind avatar
  const radialGlow = ctx.createRadialGradient(210, 160, 20, 210, 160, 220);
  radialGlow.addColorStop(0, "rgba(0, 210, 255, 0.12)");
  radialGlow.addColorStop(0.6, "rgba(0, 210, 255, 0.03)");
  radialGlow.addColorStop(1, "transparent");
  ctx.fillStyle = radialGlow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle tech accent grid pattern (faint lines)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.015)";
  ctx.lineWidth = 1;
  for (let x = 40; x < WIDTH; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  for (let y = 40; y < HEIGHT; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }

  // 3. Card Outer Border Stroke: 1.5px #1d3b5e
  ctx.strokeStyle = "#1d3b5e";
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 1, 1, WIDTH - 2, HEIGHT - 2, RADIUS);
  ctx.stroke();
  ctx.restore();

  // -------------------------------------------------------------
  // LEFT COLUMN: Avatar, Name, Handle
  // -------------------------------------------------------------
  const avatarCenterX = 210;
  const avatarCenterY = 160;
  const avatarRadius = 62;

  // Outer glowing ring (#00d2ff)
  ctx.save();
  ctx.shadowColor = "#00d2ff";
  ctx.shadowBlur = 20;
  ctx.strokeStyle = "#00d2ff";
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarRadius + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Avatar Image or Fallback
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
  ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (loadedAvatar) {
    ctx.drawImage(
      loadedAvatar,
      avatarCenterX - avatarRadius,
      avatarCenterY - avatarRadius,
      avatarRadius * 2,
      avatarRadius * 2
    );
  } else {
    // Elegant fallback: deep gradient with user initial
    const fallbackGrad = ctx.createLinearGradient(
      avatarCenterX - avatarRadius,
      avatarCenterY - avatarRadius,
      avatarCenterX + avatarRadius,
      avatarCenterY + avatarRadius
    );
    fallbackGrad.addColorStop(0, "#16284d");
    fallbackGrad.addColorStop(1, "#0f192e");
    ctx.fillStyle = fallbackGrad;
    ctx.fill();

    const initial = (name || "U").trim().charAt(0).toUpperCase();
    ctx.fillStyle = "#00d2ff";
    ctx.font = "bold 52px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initial, avatarCenterX, avatarCenterY + 2);
  }
  ctx.restore();

  // Full Name under avatar
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const cleanName = (name || "HEXU USER").toUpperCase();
  // Truncate name if it exceeds column width
  let displayName = cleanName;
  if (ctx.measureText(displayName).width > 300) {
    while (ctx.measureText(displayName + "…").width > 290 && displayName.length > 3) {
      displayName = displayName.slice(0, -1);
    }
    displayName += "…";
  }
  ctx.fillText(displayName, avatarCenterX, 270);

  // Handle under name (@handle)
  ctx.fillStyle = "#5c6b8a";
  ctx.font = "15px sans-serif";
  const cleanHandle = handle.startsWith("@") ? handle : `@${handle}`;
  ctx.fillText(cleanHandle, avatarCenterX, 298);
  ctx.restore();

  // Vertical Separator Line between Left and Right columns
  ctx.strokeStyle = "#151d2a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(380, 50);
  ctx.lineTo(380, 420);
  ctx.stroke();

  // -------------------------------------------------------------
  // RIGHT COLUMN: Metadata Grid & Online Status
  // -------------------------------------------------------------
  const gridStartX = 425;
  const gridEndX = 935;
  const rowStartY = 75;
  const rowHeight = 56;

  const rows = [
    { label: "PSID", type: "text", value: String(psid) },
    {
      label: "ROLE",
      type: "pill",
      value: String(role).toUpperCase(),
      bg: "#16284d",
      border: "#234078",
      color: "#5ba4ff",
    },
    {
      label: "RANK",
      type: "pill",
      value: String(rank).toUpperCase(),
      bg: "#251b40",
      border: "#412a75",
      color: "#c27df7",
    },
    { label: "LEVEL", type: "level", value: String(level) },
  ];

  rows.forEach((row, idx) => {
    const centerY = rowStartY + idx * rowHeight;

    // Label on left
    ctx.save();
    ctx.fillStyle = "#5c6b8a";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(row.label, gridStartX, centerY);

    // Value on right
    if (row.type === "pill") {
      drawPillBadge(ctx, row.value, gridEndX, centerY, row.bg, row.border, row.color);
    } else if (row.type === "level") {
      ctx.fillStyle = "#00e5ff";
      ctx.font = "bold 17px monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(`LVL ${row.value}`, gridEndX, centerY);
    } else {
      // PSID or standard text
      ctx.fillStyle = "#a2b4d6";
      ctx.font = "14px monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      let textVal = row.value;
      if (ctx.measureText(textVal).width > 300) {
        textVal = textVal.slice(0, 18) + "…";
      }
      ctx.fillText(textVal, gridEndX, centerY);
    }
    ctx.restore();

    // Horizontal divider below row (except after last row)
    ctx.strokeStyle = "#151d2a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gridStartX, centerY + rowHeight / 2);
    ctx.lineTo(gridEndX, centerY + rowHeight / 2);
    ctx.stroke();
  });

  // Bottom Status: Green glowing dot + "ONLINE" + "Active now"
  const statusBaseY = rowStartY + 4 * rowHeight + 10;
  const dotX = gridStartX + 6;
  const dotY = statusBaseY + 6;

  ctx.save();
  // Glowing green dot
  ctx.shadowColor = "#00e676";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#00e676";
  ctx.beginPath();
  ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // "ONLINE" text
  ctx.save();
  ctx.fillStyle = "#00e676";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("ONLINE", dotX + 16, dotY);

  // "Active now" subtitle
  ctx.fillStyle = "#5c6b8a";
  ctx.font = "12px sans-serif";
  ctx.fillText("Active now", dotX + 16, dotY + 18);
  ctx.restore();

  // -------------------------------------------------------------
  // FOOTER BRANDING
  // -------------------------------------------------------------
  const footerY = 466;

  ctx.save();
  // Left: COMMANDER v1.0
  ctx.fillStyle = "#344258";
  ctx.font = "12px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("COMMANDER v1.0", 50, footerY);

  // Right: /// Accent Decoration
  ctx.fillStyle = "#00d2ff";
  ctx.font = "bold 15px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("///", WIDTH - 50, footerY);
  ctx.restore();

  return canvas.toBuffer("image/png");
}

module.exports = { renderProfileCard };
