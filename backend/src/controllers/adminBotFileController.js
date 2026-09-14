const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const logger = require("../utils/logger");
const { clearBotKnowledgeCache } = require("../whatsapp/groqService");

const KNOWLEDGE_DIR = path.join(__dirname, "../../data");
const KNOWLEDGE_FILE = path.join(KNOWLEDGE_DIR, "bot_knowledge.txt");
const DOCX_SOURCE = path.join(__dirname, "../../Shifter_Online_WhatsApp_Bot_Company_Information_Updated_v2.docx");

function ensureKnowledgeFileExists() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }

  if (!fs.existsSync(KNOWLEDGE_FILE)) {
    if (fs.existsSync(DOCX_SOURCE)) {
      try {
        const buffer = fs.readFileSync(DOCX_SOURCE);
        mammoth.extractRawText({ buffer }).then((result) => {
          fs.writeFileSync(KNOWLEDGE_FILE, result.value, "utf-8");
          logger.info("Initialized bot_knowledge.txt from DOCX source file.");
        }).catch((err) => {
          logger.error("Failed to initialize bot_knowledge.txt from DOCX:", err);
          fs.writeFileSync(KNOWLEDGE_FILE, "Shifter Online Company Information & FAQs", "utf-8");
        });
      } catch (err) {
        logger.error("Error reading DOCX source:", err);
        fs.writeFileSync(KNOWLEDGE_FILE, "Shifter Online Company Information & FAQs", "utf-8");
      }
    } else {
      fs.writeFileSync(KNOWLEDGE_FILE, "Shifter Online Company Information & FAQs", "utf-8");
    }
  }
}

async function getBotFile(req, res) {
  try {
    ensureKnowledgeFileExists();
    const content = fs.readFileSync(KNOWLEDGE_FILE, "utf-8");
    const stats = fs.statSync(KNOWLEDGE_FILE);

    const charCount = content.length;
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
    const lineCount = content.split(/\r\n|\r|\n/).length;

    return res.status(200).json({
      success: true,
      data: {
        fileName: "bot_knowledge.txt",
        content,
        charCount,
        wordCount,
        lineCount,
        updatedAt: stats.mtime.toISOString(),
      },
    });
  } catch (err) {
    logger.error("getBotFile failed:", err);
    return res.status(500).json({ success: false, message: "Failed to read bot knowledge file" });
  }
}

async function updateBotFile(req, res) {
  try {
    const { content } = req.body;
    if (typeof content !== "string") {
      return res.status(400).json({ success: false, message: "content string is required" });
    }

    ensureKnowledgeFileExists();
    fs.writeFileSync(KNOWLEDGE_FILE, content, "utf-8");
    clearBotKnowledgeCache();

    const stats = fs.statSync(KNOWLEDGE_FILE);
    const charCount = content.length;
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
    const lineCount = content.split(/\r\n|\r|\n/).length;

    logger.info(`Bot knowledge file updated by Admin (${req.user?.username || "Admin"}). ${charCount} chars written.`);

    return res.status(200).json({
      success: true,
      message: "Bot Knowledge File updated successfully! Bot will now use updated information.",
      data: {
        fileName: "bot_knowledge.txt",
        content,
        charCount,
        wordCount,
        lineCount,
        updatedAt: stats.mtime.toISOString(),
      },
    });
  } catch (err) {
    logger.error("updateBotFile failed:", err);
    return res.status(500).json({ success: false, message: "Failed to update bot knowledge file" });
  }
}

async function uploadBotFile(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    ensureKnowledgeFileExists();
    const originalName = req.file.originalname || "";
    const fileBuffer = req.file.buffer || fs.readFileSync(req.file.path);
    let extractedText = "";

    if (originalName.endsWith(".docx") || req.file.mimetype.includes("word")) {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      extractedText = result.value || "";
    } else {
      extractedText = fileBuffer.toString("utf-8");
    }

    if (!extractedText.trim()) {
      return res.status(400).json({ success: false, message: "Could not extract text content from the uploaded file" });
    }

    fs.writeFileSync(KNOWLEDGE_FILE, extractedText, "utf-8");
    clearBotKnowledgeCache();

    const stats = fs.statSync(KNOWLEDGE_FILE);
    const charCount = extractedText.length;
    const wordCount = extractedText.trim() ? extractedText.trim().split(/\s+/).length : 0;
    const lineCount = extractedText.split(/\r\n|\r|\n/).length;

    logger.info(`Bot knowledge file replaced via upload (${originalName}) by Admin (${req.user?.username || "Admin"}).`);

    return res.status(200).json({
      success: true,
      message: `File "${originalName}" uploaded & Bot Knowledge File updated!`,
      data: {
        fileName: "bot_knowledge.txt",
        originalName,
        content: extractedText,
        charCount,
        wordCount,
        lineCount,
        updatedAt: stats.mtime.toISOString(),
      },
    });
  } catch (err) {
    logger.error("uploadBotFile failed:", err);
    return res.status(500).json({ success: false, message: "Failed to process uploaded file" });
  }
}

module.exports = {
  getBotFile,
  updateBotFile,
  uploadBotFile,
};
