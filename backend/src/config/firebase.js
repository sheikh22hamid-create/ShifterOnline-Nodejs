const logger = require("../utils/logger");

let messaging = null;
let warnedNotConfigured = false;

function initFirebase() {
  if (messaging) return messaging;

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const base64Json = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  let serviceAccount = null;
  if (rawJson) {
    try {
      serviceAccount = JSON.parse(rawJson);
    } catch (e) {
      logger.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:", e.message);
    }
  } else if (base64Json) {
    try {
      const decoded = Buffer.from(base64Json, "base64").toString("utf8");
      serviceAccount = JSON.parse(decoded);
    } catch (e) {
      logger.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64:", e.message);
    }
  } else if (path) {
    try {
      serviceAccount = require(require("path").resolve(path));
    } catch (e) {
      logger.error("Failed to load FIREBASE_SERVICE_ACCOUNT_PATH:", e.message);
    }
  }

  if (!serviceAccount) {
    return null;
  }

  try {
    const { initializeApp, getApps, cert } = require("firebase-admin/app");
    const { getMessaging } = require("firebase-admin/messaging");

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
 *
 * channelId defaults to "order_channel" — the customer app's (ShifterOnline,
 * a separate Flutter codebase) own locally-defined channel, untouched by
 * anything in the driver app — so every existing caller keeps working
 * unchanged. Pass a different id for a driver-app notification: the driver
 * app (ShifterDriver, native Java) only pre-creates specific channel ids
 * itself (see MyApplication.createOrderNotificationChannels); a channelId
 * that doesn't match one it actually created falls back to Android/FCM's
 * own uncontrolled default channel behavior instead of what's configured
 * here — confirmed live as the cause of a driver's "Order No Longer
 * Available" dismiss notification ringing indefinitely after the driver
 * app's channel was renamed but this hardcoded value wasn't updated to
 * match.
 */
async function sendPushNotification(fcmToken, title, body, data = {}, channelId = "order_channel") {
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

    const message = {
      token: fcmToken,
      android: {
        priority: "high",
      },
      data: stringData,
    };

    // Only the driver order-popup itself is pure data-only, so Flutter's
    // custom ringing dialog can render it silently without a competing tray
    // notification. Dismiss events are deliberately EXCLUDED from this set
    // (see pushNotifier.notifyDriverDismiss) — they must carry a real
    // notification block so they never reach Flutter's background *data*
    // handler, which is what opens a blank "Unknown Pickup Location" dialog
    // for any data-only push it doesn't recognize.
    const isDriverEvent = data.type === "order" || data.silent === "1";
    if (!isDriverEvent) {
      message.notification = { title, body };
      message.android.notification = {
        title,
        body,
        sound: "default",
        channelId,
        defaultSound: true,
        defaultVibrateTimings: true,
        visibility: "public",
      };
    }

    // A driver order-request offer is only valid for as long as its own
    // server-side dispatch lock (POPUP_TIMEOUT_MS, stamped as expires_at —
    // see dispatchManager.buildOrderRequestPayload). Without an explicit
    // ttl, FCM defaults to holding an undeliverable message for up to 4
    // weeks and delivering it whenever the device next reconnects — for a
    // driver who was briefly offline/Doze'd, that can be long after this
    // exact offer (and sometimes the whole order) is already resolved.
    // The app has no freshness check of its own at render time, so a late
    // delivery like that showed Accept/Reject for an order already "taken
    // or cancelled", stuck on screen with nothing left to ever dismiss it
    // (confirmed live). Bound this message's own life to that same
    // deadline, and collapse same-type offers so only the newest one for
    // this device is ever queued.
    if (data.type === "order" && data.expires_at) {
      const ttlMs = Number(data.expires_at) - Date.now();
      if (!(ttlMs > 0)) {
        return { sent: false, reason: "offer_already_expired" };
      }
      message.android.ttl = ttlMs;
      message.android.collapseKey = "order_request";
    }

    await client.send(message);
    return { sent: true };
  } catch (err) {
    logger.error("sendPushNotification failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendPushNotification };
