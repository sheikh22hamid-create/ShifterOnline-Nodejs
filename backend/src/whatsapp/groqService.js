const fs = require("fs");
const path = require("path");
const { Groq } = require("groq-sdk");
const logger = require("../utils/logger");
const geminiService = require("./geminiService");

let groqClient = null;
let cachedKnowledge = null;
let lastKnowledgeReadTime = 0;

function getBotKnowledge() {
  try {
    const knowledgePath = path.join(__dirname, "../../data/bot_knowledge.txt");
    if (!fs.existsSync(knowledgePath)) return "";
    const stats = fs.statSync(knowledgePath);
    if (!cachedKnowledge || stats.mtimeMs > lastKnowledgeReadTime) {
      cachedKnowledge = fs.readFileSync(knowledgePath, "utf-8");
      lastKnowledgeReadTime = stats.mtimeMs;
      logger.info(`Loaded fresh Bot Knowledge Base (${cachedKnowledge.length} chars).`);
    }
    return cachedKnowledge;
  } catch (err) {
    logger.error("Error reading bot knowledge base:", err);
    return cachedKnowledge || "";
  }
}

function clearBotKnowledgeCache() {
  cachedKnowledge = null;
  lastKnowledgeReadTime = 0;
}

const groqClientsMap = new Map();

/**
 * Resolves list of configured Groq API keys from process.env
 */
function getGroqApiKeys() {
  const keys = [];

  if (process.env.GROQ_API_KEY) keys.push(process.env.GROQ_API_KEY.trim());
  if (process.env.GROQ_API_KEY_2) keys.push(process.env.GROQ_API_KEY_2.trim());
  if (process.env.GROQ_API_KEY_3) keys.push(process.env.GROQ_API_KEY_3.trim());
  if (process.env.GROQ_API_KEY_FALLBACK) keys.push(process.env.GROQ_API_KEY_FALLBACK.trim());

  if (process.env.GROQ_API_KEYS) {
    const list = process.env.GROQ_API_KEYS.split(",").map((k) => k.trim()).filter(Boolean);
    keys.push(...list);
  }

  return [...new Set(keys)].filter(Boolean);
}

/**
 * Gets or creates Groq client instance for a specific API key
 */
function getGroqClientForKey(apiKey) {
  if (!groqClientsMap.has(apiKey)) {
    groqClientsMap.set(apiKey, new Groq({ apiKey }));
  }
  return groqClientsMap.get(apiKey);
}

const SYSTEM_PROMPT = `
You are the official AI Assistant for Shifter Online — India's premier real-time intra-city logistics and freight platform.
Your goal is to parse user messages in Hindi, Hinglish, or English and converse logically, politely, and contextually for an automated WhatsApp Bot.

Available Intents:
1. DRIVER_SUPPORT: User asking for driver support phone number, helpline, or driver customer care contact details.
2. CUSTOMER_SUPPORT: User asking for customer care phone number, contact details, helpline, support email, or wanting to talk to customer care.
3. CANCEL_RESET: User saying "no", "nhi", "nahi yrr", "cancel", "stop", "reset", "exit", or wanting to cancel the current process/flow.
4. DRIVER_ONBOARDING: User asking about joining as a driver partner to drive vehicle/tempo, driver registration, required documents, earnings, or downloading driver app.
5. CALCULATE_FARE: User wants to calculate price/fare quote for shipping goods (e.g., "Connaught place se Noida Tata Ace ka kitna lagega?").
6. BOOK_TRIP: User wants to book a delivery truck/bike immediately.
7. TRACK_ORDER: User wants to track an active order or check status (e.g., "Order #1024 kahan hai?").
8. CHECK_WALLET: Driver wants to check wallet balance, daily earnings, or withdrawal status.
9. FAQ_QUERY: User asking general questions about company services, moving policies, rates, or general inquiries.
10. JOB_INQUIRY: User asking about office/staff jobs (telecaller, support, sales, HR), job vacancies, hiring, employment, or recruiters contacting from job portals (JobHai, Naukri, WorkIndia, Indeed, etc.).
11. CONVERSATIONAL_FILLER: User replying with conversational affirmations or short acknowledgements like "Ji", "Haan", "Haanji", "Ok", "Okay", "Theek hai", "Sure", "Suno", "Acha".
12. UNKNOWN: Casual greeting or unclassified query.

You MUST reply strictly in valid JSON format:
{
  "intent": "DRIVER_SUPPORT" | "CUSTOMER_SUPPORT" | "CANCEL_RESET" | "DRIVER_ONBOARDING" | "CALCULATE_FARE" | "BOOK_TRIP" | "TRACK_ORDER" | "CHECK_WALLET" | "FAQ_QUERY" | "JOB_INQUIRY" | "CONVERSATIONAL_FILLER" | "UNKNOWN",
  "entities": {
    "pickup": "pickup location if mentioned or null",
    "drop": "drop location if mentioned or null",
    "vehicleType": "Bike" | "3 wheeler" | "4 wheeler" | "E loader" | null,
    "orderId": number or string or null,
    "goodsType": "goods description or null",
    "jobType": "Office/Staff" | "Driver" | "Recruiter" | null
  },
  "aiResponse": "A polite, logical, natural 1-3 sentence response in Hinglish directly answering the user in context of recent conversation history."
}

CRITICAL GREETING RULE:
- ALWAYS start greetings with "Hello!" or "Hello ji!".
- NEVER use "Namaste" or "Namaskar" under any circumstances.

CRITICAL CONVERSATIONAL CONTINUITY & CONTEXT RULE:
- ALWAYS read the provided "Recent Conversation History" before crafting your answer.
- If the user sends short conversational affirmations like "Ji", "Haan", "Haanji", "Ok", "Theek hai", "Acha", "Suno", DO NOT treat it as a new booking or fare estimate request!
- NEVER dump booking links or Customer App download links on simple conversational affirmations!
- Instead, respond politely and contextually (e.g., if earlier they were talking about JobHai or recruitment, continue the conversation regarding JobHai).

CRITICAL JOB & RECRUITMENT INQUIRY RULES:
- SHIFTER ONLINE IS ACTIVELY HIRING! (Haan, Shifter Online mein current hiring chal rahi hai).
- If someone is asking about jobs, vacancies, hiring, or office/staff roles (telecaller, customer support, operations, accounts, sales):
  State clearly that Shifter Online is actively hiring, and instruct them to send their resume/CV or contact our official careers email: careers@shifteronline.com.
- If a recruiter or job portal representative reaches out (e.g. "Neha from jobhai.com", Naukri, WorkIndia, HR agencies):
  Politely acknowledge them in natural Hinglish, state that hiring is active, and direct them to connect/share proposals at Email: careers@shifteronline.com (or helpline 9109114515). NEVER dump customer delivery booking links!
- If someone wants to join with their vehicle to do delivery work as a driver:
  Direct them to download the Shifter Driver Partner App: https://play.google.com/store/apps/details?id=com.shifter.driver and contact Driver Support 9109114515.

CRITICAL BOOKING & FARE ESTIMATE RULE:
- The WhatsApp Bot CANNOT book rides/orders, cannot take pickup/drop locations, and cannot calculate custom trip fares directly.
- NEVER ask the user for their pickup/drop location or attempt to initiate a booking in chat.
- ONLY IF the user explicitly asks to book a vehicle/delivery or asks for prices/fare for goods transport, instruct them to download the official Shifter Online Customer App: https://play.google.com/store/apps/details?id=com.shifter.online and mention Customer Care 9109114515.
- DO NOT dump this link for unrelated questions, greetings, job inquiries, or conversational fillers.

CRITICAL DRIVER WALLET & PROFILE RULE:
- The WhatsApp Bot CANNOT display driver wallet balances, profile status, or earnings in chat.
- If a driver asks about wallet, earnings, balance, or profile, instruct them to open/download the official Shifter Driver Partner App: https://play.google.com/store/apps/details?id=com.shifter.driver and contact Driver Support 9109114515.
`;

/**
 * Parses user input using:
 * 1. Tier 1: Google Gemini AI (Primary) with multi-model cascade
 * 2. Tier 2: Groq AI (Secondary Failover) with multi-key failover
 * 3. Tier 3: Rule-based fallback parser (Guaranteed Offline Safety Net)
 */
async function parseMessageWithAI(userText, sessionContext = {}) {
  // 1. Tier 1: Google Gemini AI
  try {
    const geminiResult = await geminiService.parseMessageWithGemini(userText, sessionContext);
    if (geminiResult && geminiResult.intent) {
      return geminiResult;
    }
  } catch (err) {
    logger.warn(`⚠️ Gemini parsing error: ${err.message}. Proceeding to Groq failover.`);
  }

  // 2. Tier 2: Groq AI Multi-Key Failover
  const apiKeys = getGroqApiKeys();
  if (apiKeys.length > 0) {
    const knowledgeBase = getBotKnowledge();
    const systemPromptWithKnowledge =
      SYSTEM_PROMPT +
      (knowledgeBase ? `\n\nOFFICIAL COMPANY KNOWLEDGE BASE:\n"""\n${knowledgeBase.slice(0, 10000)}\n"""` : "");

    for (let i = 0; i < apiKeys.length; i++) {
      const apiKey = apiKeys[i];
      const keyLabel = `Groq Key #${i + 1} (${apiKey.slice(0, 7)}...${apiKey.slice(-4)})`;

      try {
        const client = getGroqClientForKey(apiKey);

        let historyText = "";
        if (sessionContext && Array.isArray(sessionContext.history) && sessionContext.history.length > 0) {
          historyText = sessionContext.history
            .map((h) => `${h.role === "user" ? "User" : "Bot"}: ${h.text}`)
            .join("\n");
        }

        const userPrompt = `${historyText ? `Recent Conversation History:\n${historyText}\n\n` : ""}Current User Message: "${userText}"`;

        const response = await client.chat.completions.create({
          model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: systemPromptWithKnowledge },
            {
              role: "user",
              content: userPrompt,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 500,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error("Empty content returned from Groq API");

        const parsed = JSON.parse(content);
        logger.info(`✅ Groq AI parsing successful using ${keyLabel} (Intent: ${parsed.intent})`);
        return parsed;
      } catch (error) {
        logger.warn(`⚠️ Groq AI API error with ${keyLabel}: ${error.message}`);
        if (i < apiKeys.length - 1) {
          logger.info(`🔄 Failing over to next Groq API key #${i + 2}...`);
        }
      }
    }
  }

  // 3. Tier 3: Deterministic Rule-Based Fallback
  logger.warn("⚠️ Both Gemini and Groq AI unavailable or exhausted. Using rule-based fallback parser.");
  return fallbackRuleBasedParser(userText);
}

// Backward compatibility alias
const parseMessageWithGroq = parseMessageWithAI;

/**
 * Fallback intent classifier if GROQ_API_KEY is not configured
 */
function fallbackRuleBasedParser(text) {
  const t = (text || "").toLowerCase().trim();

  // 1. CANCEL / RESET / REJECT
  if (/^(nhi|nahi|nah|no|cancel|stop|reset|exit|band|galat|wrong|menu)(?:\s+yrr|\s+bhai|\s+please)?$/i.test(t) || t === "nhi" || t === "nahi") {
    return {
      intent: "CANCEL_RESET",
      entities: {},
      aiResponse: "Bilkul! Aapka current process cancel kar diya gaya hai.\n\nAap kya help chahte hain?\n\n• *App* — Delivery booking ke liye Shifter App link\n• *Track <OrderId>* — Order tracking status check karein\n• *Driver* — Driver partner registration & app link\n• *Support* — Customer care & driver helpline numbers",
    };
  }

  // 2. DRIVER SUPPORT NUMBER (Check BEFORE general driver or customer care)
  if (
    t.includes("driver support") ||
    t.includes("driver helpline") ||
    t.includes("driver care") ||
    (t.includes("driver") && (t.includes("support") || t.includes("helpline") || t.includes("number") || t.includes("phone") || t.includes("contact") || t.includes("care")))
  ) {
    return {
      intent: "DRIVER_SUPPORT",
      entities: {},
      aiResponse: "📞 *Shifter Online Driver Support*\n\nDriver Partners ke liye dedicated helpline details:\n📱 *Driver Support Phone*: 9109114515\n📱 *Customer Care*: 9109114515\n📧 *Support Email*: support@shifteronline.com\n\n📲 *Driver App*: https://play.google.com/store/apps/details?id=com.shifter.driver",
    };
  }

  // 3. CUSTOMER CARE / CONTACT SUPPORT (Check BEFORE general driver)
  if (
    t.includes("customer care") ||
    t.includes("costumer care") ||
    t.includes("customer support") ||
    t.includes("costumer support") ||
    t.includes("helpline") ||
    t.includes("contact") ||
    t.includes("call center") ||
    t.includes("support number") ||
    t.includes("care number") ||
    t.includes("number do") ||
    t.includes("phone number") ||
    (t.includes("baat") && t.includes("karna")) ||
    (t.includes("baat") && t.includes("karni"))
  ) {
    return {
      intent: "CUSTOMER_SUPPORT",
      entities: {},
      aiResponse: "📞 *Shifter Online Customer Care*\n\nHamari support team se sampark karne ke liye details:\n📱 *Customer Care Number*: 9109114515\n📱 *Driver Helpline*: 9109114515\n📧 *Support Email*: support@shifteronline.com\n🌐 *Website*: https://shifteronline.com\n\n🏢 *Company*: Movigo Logistic Aggregator Private Limited",
    };
  }

  // 4. DRIVER ONBOARDING (Registration / Partner App / Joining)
  if (
    t.includes("registration") ||
    t.includes("register") ||
    t.includes("onboarding") ||
    t.includes("join") ||
    t.includes("attach") ||
    t.includes("partner") ||
    t.includes("kyc") ||
    t.includes("driver banna") ||
    t === "driver"
  ) {
    return {
      intent: "DRIVER_ONBOARDING",
      entities: {},
      aiResponse: "🚚 *Shifter Online Driver Partner Program*\n\nAap Shifter Online ke saath judein aur apni gadi (Bike, 3-Wheeler, 4-Wheeler, E-Loader) se daily achhi kamai karein!\n\n📋 *Required Documents*:\n1️⃣ Driving License (DL)\n2️⃣ Aadhaar Card / Govt ID Proof\n3️⃣ Vehicle RC Book\n4️⃣ Bank Account / UPI Details\n5️⃣ Live Face verification\n6️⃣ PAN Card\n\n📲 *Registration Kaise Karein?*\nDirect humari *Shifter Driver Partner App* download karke 5 min me aasan registration complete karein:\n🔗 https://play.google.com/store/apps/details?id=com.shifter.driver\n\n📞 *Driver Support*: 9109114515",
    };
  }

  // 5. TRACK ORDER
  if (t.includes("track") || t.includes("kahan") || t.includes("order status") || t.match(/#?\d+/)) {
    const match = text.match(/\d+/);
    return {
      intent: "TRACK_ORDER",
      entities: { orderId: match ? match[0] : null },
      aiResponse: "Aapki order status check kar rahe hain...",
    };
  }

  // 6. FARE CALCULATION / BOOKING
  if (t.includes("fare") || t.includes("kitna") || t.includes("price") || t.includes("cost") || t.includes("rate") || t.includes("book") || t.includes("gadi") || t.includes("truck") || t.includes("tempo") || t.includes("pickup") || t.includes("drop")) {
    return {
      intent: "CALCULATE_FARE",
      entities: {},
      aiResponse: "📦 *Shifter Online Booking*\n\nWhatsApp par direct booking ya fare calculation uplabdh nahi hai. Delivery booking aur live fare ke liye kripya hamari official *Shifter Online Customer App* download karein:\n\n👉 https://play.google.com/store/apps/details?id=com.shifter.online\n\nApp me aapko transparent fare aur instant driver allocation milta hai!\n📞 Customer Care: 9109114515",
    };
  }

  // 7. CHECK WALLET
  if (t.includes("earning") || t.includes("wallet") || t.includes("payout") || t.includes("kamai") || t.includes("balance")) {
    return {
      intent: "CHECK_WALLET",
      entities: {},
      aiResponse: "🚚 *Shifter Driver Partner App*\n\nWallet balance, daily kamai aur duty status sirf official *Shifter Partner App* me dekhi ja sakti hai.\n\n📲 *Download / Open Driver App*:\n👉 https://play.google.com/store/apps/details?id=com.shifter.driver\n\n📞 Driver Helpline: 9109114515",
    };
  }

  // 8. JOB / RECRUITER / HIRING INQUIRIES
  if (
    t.includes("jobhai") ||
    t.includes("naukri") ||
    t.includes("workindia") ||
    t.includes("recruiter") ||
    t.includes("vacancy") ||
    t.includes("hiring") ||
    t.includes("office job") ||
    t.includes("telecaller") ||
    t.includes("resume") ||
    t.includes("cv") ||
    (t.includes("job") && !t.includes("driver"))
  ) {
    return {
      intent: "JOB_INQUIRY",
      entities: {},
      aiResponse:
        "Hello ji! Haan, Shifter Online mein current hiring chal rahi hai.\n\n" +
        "💼 *Job Openings & Recruiter Inquiries*:\n" +
        "Agar aap job search kar rahe hain ya recruiter hain, to kripya apna updated resume (CV) ya hiring proposal hamari official careers email par bhejein:\n" +
        "📧 *Email*: careers@shifteronline.com\n" +
        "📞 *Helpline*: 9109114515\n\n" +
        "🚚 *Driver Jobs*: Agar aap gadi chalane ke liye judna chahte hain, to hamara Shifter Driver Partner App download karein:\n" +
        "👉 https://play.google.com/store/apps/details?id=com.shifter.driver",
    };
  }

  // 9. CONVERSATIONAL FILLERS / AFFIRMATIONS (Ji, Haan, Ok, etc.)
  if (/^(ji|haan|haanji|han|hanji|ok|okay|theek hai|thik hai|acha|achha|sure|hmm|suno|boliye)$/i.test(t)) {
    return {
      intent: "CONVERSATIONAL_FILLER",
      entities: {},
      aiResponse: "Ji batayein, aapko Shifter Online ke regarding kya jankari chahiye? Main aapki poori madad karunga.",
    };
  }

  return {
    intent: "FAQ_QUERY",
    entities: {},
    aiResponse:
      "Main Shifter Online Bot hoon! Main abhi training phase mein hoon. Hamari technical team aapki sahayata Se mujhe develop aur advance banaa rahi hai\nAap mujhse koi bhi sawal poochh sakte hain\nAapke sawal ka hamari team uchit jawab degi.",
  };
}

module.exports = {
  parseMessageWithAI,
  parseMessageWithGroq,
  fallbackRuleBasedParser,
  getBotKnowledge,
  clearBotKnowledgeCache,
  getGroqApiKeys,
};
