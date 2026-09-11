const prisma = require("../../config/db");
const logger = require("../../utils/logger");

/**
 * Handles Driver KYC Onboarding via WhatsApp
 */
async function registerDriverFromWhatsApp(phoneNumber, driverData) {
  try {
    const cleanPhone = String(phoneNumber).replace(/\D/g, "");

    let rider = await prisma.tbl_rider.findFirst({
      where: { fmobile: cleanPhone },
    });

    const {
      name = "New Driver Partner",
      vehicle = "Bike",
      vehicleNo = "NOT_PROVIDED",
      rcImage = "",
      dlImage = "",
    } = driverData;

    const nameParts = name.split(" ");
    const firstName = nameParts[0] || "New";
    const lastName = nameParts.slice(1).join(" ") || "Driver";

    if (!rider) {
      rider = await prisma.tbl_rider.create({
        data: {
          first_name: firstName,
          last_name: lastName,
          full_name: `${firstName} ${lastName}`,
          fmobile: cleanPhone,
          vehicle: vehicle,
          vehicle_no: vehicleNo,
          profile_picture: "default_avatar.jpg",
          rdate: new Date(),
          fcm_token: "",
          device_id: `WA_${cleanPhone}`,
          a_status: 0, // Offline initially
          status: 0,   // Unapproved / Pending KYC review
          wallet_balance: 0,
        },
      });
    } else {
      rider = await prisma.tbl_rider.update({
        where: { id: rider.id },
        data: {
          vehicle: vehicle,
          vehicle_no: vehicleNo !== "NOT_PROVIDED" ? vehicleNo : rider.vehicle_no,
        },
      });
    }

    return {
      success: true,
      riderId: rider.id,
      msg: `🎉 *Shifter Online Registration Received!*\n\n` +
           `🆔 *Partner ID*: #${rider.id}\n` +
           `👤 *Name*: ${firstName} ${lastName}\n` +
           `🛵 *Vehicle*: ${vehicle} (${vehicleNo})\n` +
           `📋 *KYC Status*: *Pending Audit*\n\n` +
           `Aapke upload kiye gaye documents ko admin team inspect kar rahi hai. Status approval ke baad aap delivery orders accept kar sakenge!`,
    };
  } catch (err) {
    logger.error("registerDriverFromWhatsApp error:", err);
    return {
      success: false,
      msg: "⚠️ Driver registration me error aaya. Kripya punah prayaas karein.",
    };
  }
}

/**
 * Checks Driver KYC & Wallet Balance
 */
async function checkDriverStatus(phoneNumber) {
  try {
    const cleanPhone = String(phoneNumber).replace(/\D/g, "");

    const rider = await prisma.tbl_rider.findFirst({
      where: { fmobile: cleanPhone },
    });

    if (!rider) {
      return `❌ Aapka mobile number (${cleanPhone}) Shifter Online Driver network me registered nahi hai.\n\nType *Join Driver* to register today!`;
    }

    const kycStatus = rider.status === 1 ? "✅ Approved & Active" : "⏳ Pending Review";
    const dutyStatus = rider.a_status === 1 ? "🟢 Online" : "🔴 Offline";
    const walletBalance = rider.wallet_balance || 0;

    return `🚚 *Shifter Partner Profile & Earnings*\n\n` +
           `🆔 *Driver ID*: #${rider.id}\n` +
           `👤 *Name*: ${rider.first_name || ""} ${rider.last_name || ""}\n` +
           `🛵 *Vehicle*: ${rider.vehicle || "N/A"} (${rider.vehicle_no || "N/A"})\n` +
           `📋 *KYC Approval*: ${kycStatus}\n` +
           `⏱️ *Duty Status*: ${dutyStatus}\n` +
           `💰 *Wallet Balance*: ₹${walletBalance}\n\n` +
           `💡 Duty status toggle aur detailed trip history ke liye Partner App open karein!`;
  } catch (err) {
    logger.error("checkDriverStatus error:", err);
    return "⚠️ Driver profile info fetch karne me error aaya.";
  }
}

module.exports = {
  registerDriverFromWhatsApp,
  checkDriverStatus,
};
