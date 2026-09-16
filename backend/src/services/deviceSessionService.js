const prisma = require("../config/db");
const logger = require("../utils/logger");
const { sendPushNotification } = require("../config/firebase");

// Ported from admin/include/Common.php::registerUserDevice() — on every
// login, upsert this device's row in tbl_user_device, deactivate every
// OTHER active device for the same account (single-device-login), and push
// a force-logout notification to whatever FCM tokens those old devices had
// so their app sessions drop immediately instead of silently going stale.
async function registerDevice({ uid, deviceId, fcmToken, platform, deviceName, appVersion }) {
  if (!uid || !deviceId) return [];

  try {
    // The "other devices" lookup/deactivate and "this device" lookup/upsert
    // are two independent record sets (device_id != deviceId vs == deviceId)
    // - run each pair concurrently instead of stacking all 4 round trips,
    // since this DB is a WAN hop away from this backend (see login's own
    // comment on the same issue).
    const [oldDevices, existing] = await Promise.all([
      prisma.tbl_user_device.findMany({
        where: { uid, device_id: { not: deviceId }, is_active: true },
        select: { fcm_token: true },
      }),
      prisma.tbl_user_device.findFirst({ where: { uid, device_id: deviceId } }),
    ]);
    const oldTokens = oldDevices.map((d) => d.fcm_token).filter(Boolean);

    await Promise.all([
      prisma.tbl_user_device.updateMany({
        where: { uid, device_id: { not: deviceId }, is_active: true },
        data: { is_active: false, logged_out_at: new Date() },
      }),
      existing
        ? prisma.tbl_user_device.update({
            where: { id: existing.id },
            data: {
              fcm_token: fcmToken || existing.fcm_token,
              platform: platform ?? existing.platform,
              device_name: deviceName ?? existing.device_name,
              app_version: appVersion ?? existing.app_version,
              is_active: true,
              login_count: { increment: 1 },
              last_login_at: new Date(),
              logged_out_at: null,
            },
          })
        : prisma.tbl_user_device.create({
            data: {
              uid,
              device_id: deviceId,
              fcm_token: fcmToken || null,
              platform: platform || null,
              device_name: deviceName || null,
              app_version: appVersion || null,
              is_active: true,
              login_count: 1,
              last_login_at: new Date(),
              created_at: new Date(),
            },
          }),
    ]);

    // Best-effort — a dead/old token failing to receive this push must never
    // fail the login itself.
    for (const token of oldTokens) {
      if (token === fcmToken) continue;
      sendPushNotification(token, "Logged out", "Your account was signed in on another device.", {
        type: "force_logout",
      }).catch((err) => logger.warn("deviceSessionService: force-logout push failed:", err.message));
    }

    return oldTokens;
  } catch (err) {
    logger.error("deviceSessionService.registerDevice failed:", err);
    return [];
  }
}

module.exports = { registerDevice };
