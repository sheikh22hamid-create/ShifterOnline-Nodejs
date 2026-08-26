const logger = require("../utils/logger");

let messaging = null;
let warnedNotConfigured = false;

function initFirebase() {
  if (messaging) return messaging;

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!rawJson && !path) {
    return null;
  }

  try {
    const admin = require("firebase-admin");
    const serviceAccount = rawJson
      ? JSON.parse(rawJson)
      : require(require("path").resolve(path));

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    messaging = admin.messaging();
    logger.info("Firebase Admin SDK initialized for FCM push notifications.");
    return messaging;
  } catch (err) {
    logger.error("Failed to initialize Firebase Admin SDK:", err.message);
    return null;
  }
}

/**
 * Sends an FCM push notification. Resolves to a result object instead of
 * throwing so callers (e.g. dispatch fallback on disconnected sockets) never
 * need to wrap this in try/catch on the hot path.
 */
async function sendPushNotification(fcmToken, title, body, data = {}) {
  if (!fcmToken) {
    return { sent: false, reason: "missing_fcm_token" };
  }

  const client = initFirebase();
  if (!client) {
    if (!warnedNotConfigured) {
      logger.warn(
        "sendPushNotification: Firebase not configured (set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH). Push notifications are disabled; relying on Socket.io only."
      );
      warnedNotConfigured = true;
    }
    return { sent: false, reason: "not_configured" };
  }

  try {
    await client.send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
    });
    return { sent: true };
  } catch (err) {
    logger.error("sendPushNotification failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendPushNotification };
