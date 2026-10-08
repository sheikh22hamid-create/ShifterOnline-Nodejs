const sessions = new Map();

const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 Minutes session timeout

/**
 * Gets or creates session for a WhatsApp phone number
 */
function getSession(phoneNumber) {
  const cleanPhone = String(phoneNumber).replace(/\D/g, "");
  if (!sessions.has(cleanPhone)) {
    sessions.set(cleanPhone, {
      phone: cleanPhone,
      step: "IDLE",
      data: {},
      history: [],
      lastUpdated: Date.now(),
    });
  }
  const session = sessions.get(cleanPhone);
  
  if (!Array.isArray(session.history)) {
    session.history = [];
  }

  // Expire stale sessions
  if (Date.now() - session.lastUpdated > SESSION_TIMEOUT_MS) {
    session.step = "IDLE";
    session.data = {};
    session.history = [];
  }
  
  session.lastUpdated = Date.now();
  return session;
}

/**
 * Updates step and data of user session
 */
function updateSession(phoneNumber, step, dataToMerge = {}) {
  const session = getSession(phoneNumber);
  session.step = step;
  session.data = { ...session.data, ...dataToMerge };
  session.lastUpdated = Date.now();
  return session;
}

/**
 * Records a message to the rolling conversation history (keeps last 8 messages)
 */
function addHistory(phoneNumber, role, text) {
  const session = getSession(phoneNumber);
  const clean = String(text || "").trim();
  if (!clean) return;

  session.history.push({
    role, // "user" or "assistant"
    text: clean.length > 300 ? clean.slice(0, 300) + "..." : clean,
    timestamp: Date.now(),
  });

  if (session.history.length > 8) {
    session.history = session.history.slice(-8);
  }
}

/**
 * Gets rolling conversation history for a user
 */
function getHistory(phoneNumber) {
  const session = getSession(phoneNumber);
  return session.history || [];
}

/**
 * Resets user session step back to IDLE
 */
function clearSession(phoneNumber, clearHistory = false) {
  const cleanPhone = String(phoneNumber).replace(/\D/g, "");
  if (sessions.has(cleanPhone)) {
    const session = sessions.get(cleanPhone);
    session.step = "IDLE";
    session.data = {};
    if (clearHistory) {
      session.history = [];
    }
    session.lastUpdated = Date.now();
  }
}

module.exports = {
  getSession,
  updateSession,
  addHistory,
  getHistory,
  clearSession,
};
