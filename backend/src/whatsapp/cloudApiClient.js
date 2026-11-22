const logger = require("../utils/logger");

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Returns credentials from environment variables.
 */
function getCredentials() {
  const phoneNumberId = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID || "1435391406329420";
  const accessToken = process.env.WHATSAPP_CLOUD_ACCESS_TOKEN || "EAAT6UulZBwI0BTG3ZAtxV3C9LNPISqsGBuasfemdoFHtWkTOvF53dd2Lln4YMeeOibFkJZCitieHDdIt82auxfZCBeMk87EZALXSZA6ujkDEyye4qSxHW9ZBnpfCPC5EiknXZCvW6gRLTGnTIaGUgPLWLPIafOxF9GVdVvnxefrE7rMrFQ2bZCn4TSiCfqRN7ok5ZA8AZDZD";

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

module.exports = {
  getCredentials,
  normalizeRecipient,
  sendTextMessage,
  sendInteractiveButtons,
  sendTemplateMessage,
  sendMediaMessage,
};
