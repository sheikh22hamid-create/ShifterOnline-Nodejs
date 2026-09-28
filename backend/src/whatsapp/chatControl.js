const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "../../data");
const PAUSED_CHATS_FILE = path.join(DATA_DIR, "paused_chats.json");

let pausedChatsSet = new Set();

function normalizeChatId(id) {
  if (!id) return "";
  const str = String(id).trim();
  const cleanPhone = str.split("@")[0].replace(/\D/g, "");
  return cleanPhone || str.toLowerCase();
}

function loadPausedChats() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(PAUSED_CHATS_FILE)) {
      const data = fs.readFileSync(PAUSED_CHATS_FILE, "utf-8");
      const list = JSON.parse(data);
      if (Array.isArray(list)) {
        pausedChatsSet = new Set(list.map(normalizeChatId));
        logger.info(`Loaded ${pausedChatsSet.size} paused chat(s) from paused_chats.json`);
      }
    }
  } catch (err) {
    logger.error("Failed to load paused_chats.json:", err);
  }
}

function savePausedChats() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(PAUSED_CHATS_FILE, JSON.stringify([...pausedChatsSet], null, 2), "utf-8");
  } catch (err) {
    logger.error("Failed to save paused_chats.json:", err);
  }
}

// Initialize on module load
loadPausedChats();

function isChatPaused(chatId) {
  const norm = normalizeChatId(chatId);
  return norm ? pausedChatsSet.has(norm) : false;
}

function pauseChat(chatId) {
  const norm = normalizeChatId(chatId);
  if (norm) {
    pausedChatsSet.add(norm);
    savePausedChats();
    logger.info(`⏸️ Chat ${norm} has been PAUSED. Bot will not reply in this chat.`);
  }
}

function resumeChat(chatId) {
  const norm = normalizeChatId(chatId);
  if (norm && pausedChatsSet.has(norm)) {
    pausedChatsSet.delete(norm);
    savePausedChats();
    logger.info(`▶️ Chat ${norm} has been RESUMED. Bot active again.`);
  }
}

function isStopCommand(text) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return /^(stop|\/stop|bot stop|stop bot|pause|\/pause)$/i.test(t);
}

function isStartCommand(text) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return /^(\/start|start|bot start|start bot|\/resume|resume)$/i.test(t);
}

function getAllPausedChats() {
  return [...pausedChatsSet];
}

module.exports = {
  isChatPaused,
  pauseChat,
  resumeChat,
  isStopCommand,
  isStartCommand,
  getAllPausedChats,
};
