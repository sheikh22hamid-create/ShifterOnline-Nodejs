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
 * Driver Wallet & Profile Query (Redirects to Driver App)
 */
async function checkDriverStatus(phoneNumber) {
  const driverAppUrl = process.env.DRIVER_APP_DOWNLOAD_URL || "https://play.google.com/store/apps/details?id=com.shifter.driver";
  return (
    `🚚 *Shifter Driver Partner App*\n\n` +
    `Driver wallet balance, daily kamai, duty status aur profile details dekhne ke liye kripya official *Shifter Partner App* ka upayog karein:\n\n` +
    `📲 *Open / Download Driver App*:\n` +
    `👉 ${driverAppUrl}\n\n` +
    `App me aapko real-time earnings, withdrawal aur ride history ki poori jankari milti hai!\n\n` +
    `📞 *Driver Helpline*: 9109114515`
  );
}

module.exports = {
  registerDriverFromWhatsApp,
  checkDriverStatus,
};
