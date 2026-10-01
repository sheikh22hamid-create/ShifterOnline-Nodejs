const logger = require("../utils/logger");

// The customer app's Notification screen reads tbl_notification. FCM pushes
// alone never show up there, so every customer-facing push that should be
// kept in the inbox also writes a row here. Never throws - a failed inbox
// write must not block the push or the order flow.
async function saveCustomerNotification(uid, title, description) {
  try {
    const prisma = require("../config/db");
    const userId = Number(uid) || 0;
    if (!userId || !title) return;
    await prisma.tbl_notification.create({
      data: { uid: userId, title: String(title), description: String(description || ""), datetime: new Date() },
    });
  } catch (err) {
    logger.error("customerInbox.saveCustomerNotification failed:", err);
  }
}

// Same, for call sites that only hold the device token (pushNotifier).
async function saveCustomerNotificationByToken(fcmToken, title, description) {
  try {
    if (!fcmToken) return;
    const prisma = require("../config/db");
    const user = await prisma.tbl_user.findFirst({ where: { fcm_token: fcmToken }, select: { id: true } });
    if (user) await saveCustomerNotification(user.id, title, description);
  } catch (err) {
    logger.error("customerInbox.saveCustomerNotificationByToken failed:", err);
  }
}

module.exports = { saveCustomerNotification, saveCustomerNotificationByToken };
