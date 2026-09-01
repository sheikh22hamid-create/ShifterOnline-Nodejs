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
    const { initializeApp, getApps, cert } = require("firebase-admin/app");
    const { getMessaging } = require("firebase-admin/messaging");
    const serviceAccount = rawJson
      ? JSON.parse(rawJson)
      : require(require("path").resolve(path));

    const apps = getApps();
    const app =
      apps.length > 0
        ? apps[0]
        : initializeApp({
            credential: cert(serviceAccount),
          });

    messaging = getMessaging(app);
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
    const stringData = Object.fromEntries(
      Object.entries({ ...data, title: String(title), body: String(body) }).map(([k, v]) => [k, String(v ?? "")])
    );

    await client.send({
      token: fcmToken,
      notification: { title, body },
      android: {
        priority: "high",
        notification: {
          title,
          body,
          sound: "default",
          channelId: "order_channel",
          defaultSound: true,
          defaultVibrateTimings: true,
          visibility: "public",
        },
      },
      data: stringData,
    });
    return { sent: true };
  } catch (err) {
    logger.error("sendPushNotification failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendPushNotification };
