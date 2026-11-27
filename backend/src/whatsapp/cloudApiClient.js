const logger = require("../utils/logger");
const { uploadBuffer, urlForRelativePath } = require("../utils/cloudinaryStorage");

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Returns credentials from environment variables.
 */
function getCredentials() {
  const phoneNumberId = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID || "1435391406329420";
  const accessToken =
    process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
    "EAAT6UulZBwI0BTNT4Ltt5IXfBBeYYQZBhjRPUUvjQxaw2UV6TkwZCd44TaRKIKqWo5VLVjt1IoaCzuZBFU6yaOKkg4d8NQb9w1ZA9bo4kZBCGle0SlAhLo3NZBlWLYui1ZCaKMzi9269WzPa7NdZC8XL0UZCBCIXLQJfw8ovz7SaQOo1SRbcMLF9Msy5LzrnZBH8gZDZD";

  return { phoneNumberId, accessToken };
}

/**
 * Formats destination phone number into international digits without leading '+'
 * e.g. "916378211202"
 */
function normalizeRecipient(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) {
    digits = `91${digits}`;
  }
  return digits;
}

/**
 * Generic caller for WhatsApp Cloud API message endpoint.
 */
async function callMessagesEndpoint(payload) {
  const { phoneNumberId, accessToken } = getCredentials();
  if (!phoneNumberId || !accessToken) {
    throw new Error("WhatsApp Cloud API credentials missing (PHONE_NUMBER_ID or ACCESS_TOKEN).");
  }

  const url = `${GRAPH_BASE_URL}/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    logger.error("WhatsApp Cloud API Error:", JSON.stringify(data.error || data));
    const err = new Error(data.error?.message || "WhatsApp Cloud API call failed");
    err.details = data.error;
    throw err;
  }

  return data;
}

/**
 * Send a plain text message.
 */
async function sendTextMessage(to, text, previewUrl = false) {
  const recipient = normalizeRecipient(to);
  if (!recipient) throw new Error(`Invalid recipient phone: ${to}`);

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
    type: "text",
    text: {
      preview_url: Boolean(previewUrl),
      body: String(text),
    },
  };

  return await callMessagesEndpoint(payload);
}

/**
 * Send interactive buttons (up to 3 buttons).
 * @param {string} to - Recipient phone number
 * @param {string} bodyText - Message body
 * @param {Array<{id: string, title: string}>} buttons - Array of button objects (title max 20 chars)
 * @param {string} [headerText] - Optional header string
 * @param {string} [footerText] - Optional footer string
 */
async function sendInteractiveButtons(to, bodyText, buttons, headerText = null, footerText = null) {
  const recipient = normalizeRecipient(to);
  if (!recipient) throw new Error(`Invalid recipient phone: ${to}`);

  if (!Array.isArray(buttons) || buttons.length === 0 || buttons.length > 3) {
    throw new Error("Interactive buttons must be an array of 1 to 3 items.");
  }

  const interactive = {
    type: "button",
    body: {
      text: String(bodyText),
    },
    action: {
      buttons: buttons.map((btn) => ({
        type: "reply",
        reply: {
          id: String(btn.id),
          title: String(btn.title).slice(0, 20), // WhatsApp enforces max 20 characters
        },
      })),
    },
  };

  if (headerText) {
    interactive.header = {
      type: "text",
      text: String(headerText),
    };
  }

  if (footerText) {
    interactive.footer = {
      text: String(footerText),
    };
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
    type: "interactive",
    interactive,
  };

  return await callMessagesEndpoint(payload);
}

/**
 * Send a template message (useful when initiating outside 24-hr session window).
 */
async function sendTemplateMessage(to, templateName, languageCode = "en_US", components = []) {
  const recipient = normalizeRecipient(to);
  if (!recipient) throw new Error(`Invalid recipient phone: ${to}`);

  const payload = {
    messaging_product: "whatsapp",
    to: recipient,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: components.length ? components : undefined,
    },
  };

  return await callMessagesEndpoint(payload);
}

/**
 * Send media message (image, video, or document) via URL link.
 */
async function sendMediaMessage(to, mediaType = "image", mediaUrl, caption = null) {
  const recipient = normalizeRecipient(to);
  if (!recipient) throw new Error(`Invalid recipient phone: ${to}`);
  if (!mediaUrl) throw new Error("mediaUrl is required for media message");

  const validTypes = ["image", "video", "document", "audio"];
  const type = validTypes.includes(mediaType) ? mediaType : "image";

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
    type,
    [type]: {
      link: mediaUrl,
      caption: caption ? String(caption) : undefined,
    },
  };

  return await callMessagesEndpoint(payload);
}

/**
 * Maps mime type to appropriate file extension.
 */
function getExtensionFromMime(mimeType, defaultType = "image") {
  if (!mimeType) return defaultType === "video" ? ".mp4" : defaultType === "audio" ? ".ogg" : ".jpg";
  const cleanMime = mimeType.split(";")[0].trim().toLowerCase();
  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/3gpp": ".3gp",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/aac": ".aac",
    "audio/amr": ".amr",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  };
  return map[cleanMime] || (defaultType === "video" ? ".mp4" : defaultType === "audio" ? ".ogg" : ".jpg");
}

/**
 * Retrieves the temporary media download URL and metadata from Meta Graph API.
 * @param {string} mediaId - Meta media ID
 */
async function getMediaUrl(mediaId) {
  const { accessToken } = getCredentials();
  if (!accessToken) throw new Error("WhatsApp Cloud API access token missing");

  const url = `${GRAPH_BASE_URL}/${mediaId}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    logger.error("Meta media URL retrieval error:", JSON.stringify(data.error || data));
    const err = new Error(data.error?.message || "Failed to retrieve media URL from Meta");
    err.details = data.error;
    throw err;
  }

  return data; // { url, mime_type, sha256, file_size, id }
}

/**
 * Downloads the binary data of a media file from Meta CDN (lookaside.fbsbx.com).
 * @param {string} mediaId - Meta media ID
 */
async function downloadMediaBuffer(mediaId) {
  const { accessToken } = getCredentials();
  const mediaInfo = await getMediaUrl(mediaId);
  if (!mediaInfo.url) {
    throw new Error(`No download URL returned by Meta for media ID: ${mediaId}`);
  }

  const downloadRes = await fetch(mediaInfo.url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "ShifterOnline-Nodejs/1.0",
    },
  });

  if (!downloadRes.ok) {
    throw new Error(`Failed to download media binary from Meta CDN: HTTP ${downloadRes.status}`);
  }

  const arrayBuf = await downloadRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  return {
    buffer,
    mimeType: mediaInfo.mime_type,
    fileSize: mediaInfo.file_size,
    id: mediaInfo.id,
  };
}

/**
 * Fetches media from Meta, stores it durably via Cloudinary (or local fallback),
 * and returns the public delivery URL.
 * @param {{ mediaId: string, mimeType?: string, messageType?: string }} options
 */
async function fetchAndStoreMedia({ mediaId, mimeType = null, messageType = "image" }) {
  if (!mediaId) throw new Error("mediaId is required to fetch media");

  const downloaded = await downloadMediaBuffer(mediaId);
  const finalMime = downloaded.mimeType || mimeType;
  const ext = getExtensionFromMime(finalMime, messageType);

  const isVideo = messageType === "video" || (finalMime && finalMime.startsWith("video/"));
  const isAudio = messageType === "audio" || (finalMime && finalMime.startsWith("audio/"));
  const subfolder = isVideo
    ? "videos/whatsapp_inbound"
    : isAudio
    ? "audio/whatsapp_inbound"
    : "images/whatsapp_inbound";

  const filename = `${Date.now()}_${mediaId}${ext}`;
  const relativePath = `${subfolder}/${filename}`;

  await uploadBuffer(downloaded.buffer, relativePath);

  let deliveryUrl = urlForRelativePath(relativePath);
  if (!deliveryUrl) {
    const base = process.env.PUBLIC_BASE_URL || "https://dev-api.shifteronline.com";
    deliveryUrl = `${base.replace(/\/$/, "")}/${relativePath.replace(/^\//, "")}`;
  }

  return {
    url: deliveryUrl,
    mimeType: finalMime,
    relativePath,
  };
}

module.exports = {
  getCredentials,
  normalizeRecipient,
  sendTextMessage,
  sendInteractiveButtons,
  sendTemplateMessage,
  sendMediaMessage,
  getMediaUrl,
  downloadMediaBuffer,
  fetchAndStoreMedia,
};
