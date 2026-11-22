const prisma = require("../config/db");
const logger = require("../utils/logger");
const { WHATSAPP_TEMPLATES } = require("../whatsapp/templates");

const SETTING_KEY = "whatsapp_broadcast_templates";

async function getStoredMap() {
  try {
    const row = await prisma.app_settings.findUnique({
      where: { setting_key: SETTING_KEY },
    });
    if (!row || !row.setting_value) return {};
    return JSON.parse(row.setting_value);
  } catch (err) {
    logger.error("Error reading whatsapp_broadcast_templates from app_settings:", err);
    return {};
  }
}

async function getAllTemplates() {
  const storedMap = await getStoredMap();

  return WHATSAPP_TEMPLATES.map((tpl) => {
    const saved = storedMap[tpl.id];
    const isCustomized = Boolean(
      (saved?.message && saved.message !== tpl.message) || saved?.media_url
    );

    return {
      id: tpl.id,
      name: tpl.id,
      metaTemplateName: tpl.metaTemplateName || tpl.id,
      isMetaApproved: Boolean(tpl.isMetaApproved),
      title: tpl.title,
      category: tpl.category,
      categoryLabel: tpl.categoryLabel,
      description: tpl.description,
      // Default hardcoded content
      defaultMessage: tpl.message,
      defaultMediaUrl: null,
      defaultMediaType: null,
      // Active content: saved permanent content if exists, else default
      message: saved?.message !== undefined && saved?.message !== null ? saved.message : tpl.message,
      media_url: saved?.media_url || null,
      media_type: saved?.media_type || null,
      media_filename: saved?.media_filename || null,
      is_customized: isCustomized,
      updated_at: saved?.updated_at || null,
      updated_by: saved?.updated_by || null,
    };
  });
}

async function getTemplateById(id) {
  const all = await getAllTemplates();
  return all.find((t) => t.id === id) || null;
}

async function saveTemplate(templateId, { message, media_url, media_type, media_filename }, user) {
  const baseTpl = WHATSAPP_TEMPLATES.find((t) => t.id === templateId);
  if (!baseTpl) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const cleanMsg = typeof message === "string" ? message.trim() : "";
  if (!cleanMsg && !media_url) {
    throw new Error("Message text or media attachment is required");
  }

  if (cleanMsg.length > 4000) {
    throw new Error("Message text cannot exceed 4000 characters");
  }

  const storedMap = await getStoredMap();
  const userName = user?.username || user?.name || (user?.id ? `Admin #${user.id}` : "Admin");

  storedMap[templateId] = {
    message: cleanMsg,
    media_url: media_url || null,
    media_type: media_type || null,
    media_filename: media_filename || null,
    updated_at: new Date().toISOString(),
    updated_by: userName,
  };

  await prisma.app_settings.upsert({
    where: { setting_key: SETTING_KEY },
    update: {
      setting_value: JSON.stringify(storedMap),
      updated_at: new Date(),
    },
    create: {
      setting_key: SETTING_KEY,
      setting_value: JSON.stringify(storedMap),
    },
  });

  logger.info(`[AUDIT] WhatsApp template '${templateId}' permanently updated by ${userName}`);
  return getTemplateById(templateId);
}

async function resetTemplate(templateId) {
  const baseTpl = WHATSAPP_TEMPLATES.find((t) => t.id === templateId);
  if (!baseTpl) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const storedMap = await getStoredMap();
  if (storedMap[templateId]) {
    delete storedMap[templateId];

    await prisma.app_settings.upsert({
      where: { setting_key: SETTING_KEY },
      update: {
        setting_value: JSON.stringify(storedMap),
        updated_at: new Date(),
      },
      create: {
        setting_key: SETTING_KEY,
        setting_value: JSON.stringify(storedMap),
      },
    });
  }

  logger.info(`[AUDIT] WhatsApp template '${templateId}' reset to default`);
  return getTemplateById(templateId);
}

module.exports = {
  getAllTemplates,
  getTemplateById,
  saveTemplate,
  resetTemplate,
};
