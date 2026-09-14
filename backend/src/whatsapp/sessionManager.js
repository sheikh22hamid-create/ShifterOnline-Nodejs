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
      lastUpdated: Date.now(),
    });
  }
  const session = sessions.get(cleanPhone);
  
  // Expire stale sessions
  if (Date.now() - session.lastUpdated > SESSION_TIMEOUT_MS) {
    session.step = "IDLE";
    session.data = {};
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
 * Resets user session back to IDLE
 */
function clearSession(phoneNumber) {
  const cleanPhone = String(phoneNumber).replace(/\D/g, "");
  if (sessions.has(cleanPhone)) {
    sessions.set(cleanPhone, {
      phone: cleanPhone,
      step: "IDLE",
      data: {},
      lastUpdated: Date.now(),
    });
  }
}

module.exports = {
  getSession,
  updateSession,
  clearSession,
};
