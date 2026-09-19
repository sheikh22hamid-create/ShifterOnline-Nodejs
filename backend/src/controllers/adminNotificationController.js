const prisma = require("../config/db");
const logger = require("../utils/logger");
const { sendMulticastNotification } = require("../config/firebase");

// In-memory audit log for broadcast history (survives app reloads if stored, but provides clean recent list)
const broadcastHistory = [];

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

async function send(req, res) {
  try {
    const {
      target_type = "all_everyone",
      city_id,
      target_id,
      title,
      message,
      image_url,
      notification_type = "offer",
    } = req.body;

    const cleanTitle = String(title || "").trim();
    const cleanMessage = String(message || "").trim();
    const cleanImageUrl = image_url ? String(image_url).trim() : null;

    if (!cleanTitle) {
      return res.status(400).json({ success: false, message: "Notification title is required" });
    }
    if (!cleanMessage) {
      return res.status(400).json({ success: false, message: "Notification message / description is required" });
    }

    let drivers = [];
    let customers = [];
    const now = new Date();

    // 1. Gather targeted Drivers
    const shouldTargetDrivers =
      target_type === "all_drivers" ||
      target_type === "all_everyone" ||
      target_type === "city_drivers" ||
      target_type === "specific_driver";

    if (shouldTargetDrivers) {
      const driverWhere = { status: 1 };
      if (target_type === "specific_driver" && target_id) {
        driverWhere.id = parseInt(target_id, 10);
      } else if (target_type === "city_drivers" && (city_id || req.scopedCityId)) {
        driverWhere.city_id = parseInt(city_id || req.scopedCityId, 10);
      } else if (req.scopedCityId) {
        driverWhere.city_id = req.scopedCityId;
      }

      drivers = await prisma.tbl_rider.findMany({
        where: driverWhere,
        select: { id: true, full_name: true, fmobile: true, fcm_token: true },
      });
    }

    // 2. Gather targeted Customers
    const shouldTargetCustomers =
      target_type === "all_customers" ||
      target_type === "all_everyone" ||
      target_type === "city_customers" ||
      target_type === "specific_customer";

    if (shouldTargetCustomers) {
      const customerWhere = { status: 1 };
      if (target_type === "specific_customer" && target_id) {
        customerWhere.id = parseInt(target_id, 10);
      }

      customers = await prisma.tbl_user.findMany({
        where: customerWhere,
        select: { id: true, name: true, mobile: true, fcm_token: true },
      });
    }

    const totalTargeted = drivers.length + customers.length;
    if (totalTargeted === 0) {
      return res.status(400).json({
        success: false,
        message: "No active recipients found for the selected target criteria.",
      });
    }

    let totalFcmSent = 0;
    let totalFcmFailed = 0;

    // 3. Send to Drivers
    if (drivers.length > 0) {
      // Driver In-App Inbox Records (tbl_rnoti)
      const rnotiRows = drivers.map((d) => ({
        rid: d.id,
        title: cleanTitle,
        msg: cleanMessage,
        date: now,
      }));

      // Batch insert in chunks of 500
      for (let i = 0; i < rnotiRows.length; i += 500) {
        await prisma.tbl_rnoti.createMany({
          data: rnotiRows.slice(i, i + 500),
        });
      }

      // FCM Push to valid driver tokens
      const driverTokens = drivers.map((d) => d.fcm_token).filter((t) => t && t.trim().length > 10);
      if (driverTokens.length > 0) {
        const result = await sendMulticastNotification(
          driverTokens,
          cleanTitle,
          cleanMessage,
          {
            type: "promo",
            notification_type,
            ...(cleanImageUrl ? { image_url: cleanImageUrl } : {}),
          },
          "order_dismiss_channel_v1",
          cleanImageUrl
        );
        totalFcmSent += result.sent || 0;
        totalFcmFailed += result.failed || 0;
      }
    }

    // 4. Send to Customers
    if (customers.length > 0) {
      // Customer In-App Inbox Records (tbl_notification)
      const notiRows = customers.map((c) => ({
        uid: c.id,
        title: cleanTitle,
        description: cleanMessage,
        datetime: now,
      }));

      // Batch insert in chunks of 500
      for (let i = 0; i < notiRows.length; i += 500) {
        await prisma.tbl_notification.createMany({
          data: notiRows.slice(i, i + 500),
        });
      }

      // FCM Push to valid customer tokens
      const customerTokens = customers.map((c) => c.fcm_token).filter((t) => t && t.trim().length > 10);
      if (customerTokens.length > 0) {
        const result = await sendMulticastNotification(
          customerTokens,
          cleanTitle,
          cleanMessage,
          {
            type: "promo",
            notification_type,
            ...(cleanImageUrl ? { image_url: cleanImageUrl } : {}),
          },
          "order_channel",
          cleanImageUrl
        );
        totalFcmSent += result.sent || 0;
        totalFcmFailed += result.failed || 0;
      }
    }

    // Record in broadcast history
    const broadcastRecord = {
      id: Date.now(),
      title: cleanTitle,
      message: cleanMessage,
      image_url: cleanImageUrl,
      target_type,
      notification_type,
      drivers_count: drivers.length,
      customers_count: customers.length,
      total_targeted: totalTargeted,
      fcm_sent: totalFcmSent,
      sent_by: req.user?.username || `Admin #${req.user?.id || 1}`,
      created_at: now.toISOString(),
    };
    broadcastHistory.unshift(broadcastRecord);
    if (broadcastHistory.length > 50) broadcastHistory.pop();

    logger.info(
      `adminNotificationController.send: sent "${cleanTitle}" to ${totalTargeted} recipients (${totalFcmSent} push notifications delivered) by admin #${req.user?.id}`
    );

    return res.status(200).json({
      success: true,
      message: `Notification sent to ${totalTargeted} recipients (${drivers.length} drivers, ${customers.length} users).`,
      data: broadcastRecord,
    });
  } catch (err) {
    return internalError(res, err, "notifications.send");
  }
}

async function history(req, res) {
  try {
    return res.status(200).json({
      success: true,
      data: broadcastHistory,
    });
  } catch (err) {
    return internalError(res, err, "notifications.history");
  }
}

module.exports = { send, history };
