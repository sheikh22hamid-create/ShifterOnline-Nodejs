const prisma = require("../config/db");
const logger = require("../utils/logger");
const cloudApi = require("./cloudApiClient");
const tripLifecycle = require("../services/tripLifecycle");
const driverTripService = require("../services/driverTripService");

/**
 * Normalizes phone number to match tbl_rider (last 10 digits).
 */
function toTenDigits(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Finds a rider by phone number.
 */
async function findDriverByPhone(phone) {
  const tenDigits = toTenDigits(phone);
  if (!tenDigits) return null;

  return await prisma.tbl_rider.findFirst({
    where: {
      OR: [
        { fmobile: tenDigits },
        { mobile: tenDigits },
        { fmobile: `91${tenDigits}` },
        { mobile: `91${tenDigits}` },
      ],
    },
  });
}

/**
 * Builds Google Maps navigation link.
 */
function getMapLink(lat, lng) {
  if (!lat || !lng || Number(lat) === 0) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/**
 * Offer an order to a trial driver on WhatsApp with Accept/Reject buttons.
 */
async function sendOrderOffer(rider, order) {
  try {
    const phone = rider.fmobile || rider.mobile;
    const fare = order.total_dcharge || order.d_charge || 0;
    const distance = order.distance || "N/A";
    const pickup = order.paddress || order.pick_address || "Pickup point";
    const drop = order.daddress || order.drop_address || "Drop point";

    const bodyText = `🚚 *Naya Order Offer!*\n\n` +
      `📦 *Order ID:* #${order.id}\n` +
      `💰 *Aapki Kamaai:* ₹${fare}\n` +
      `🛣️ *Distance:* ${distance} km\n\n` +
      `📍 *Pickup:* ${pickup}\n` +
      `🏁 *Drop:* ${drop}\n\n` +
      `Kripya turant Accept karein:`;

    const buttons = [
      { id: `TRIAL_ACCEPT_${order.id}`, title: "Accept Order 🚚" },
      { id: `TRIAL_REJECT_${order.id}`, title: "Reject ❌" },
    ];

    await cloudApi.sendInteractiveButtons(phone, bodyText, buttons, "Shifter Logistics");
    logger.info(`Trial driver WhatsApp offer sent: order ${order.id} to rider ${rider.id}`);
  } catch (err) {
    logger.error(`Error sending trial order offer to rider ${rider?.id}:`, err);
  }
}

/**
 * Sends order assigned & pickup navigation details with [ Arrived Pickup ] button.
 */
async function sendPickupPrompt(phone, order) {
  const pickup = order.paddress || order.pick_address || "Pickup location";
  const customerName = order.pick_name || order.customer_name || "Customer";
  const customerPhone = order.pmobile || order.customer_pmobile || "N/A";
  const mapLink = getMapLink(order.plat, order.plong);

  let bodyText = `🎉 *Order Confirm Ho Gaya!*\n\n` +
    `📦 *Order ID:* #${order.id}\n` +
    `👤 *Customer:* ${customerName} (${customerPhone})\n` +
    `📍 *Pickup Address:*\n${pickup}\n`;

  if (mapLink) {
    bodyText += `\n🗺️ *Pickup Navigation:*\n${mapLink}\n`;
  }

  bodyText += `\nPickup par pahunch kar niche button dabayein:`;

  const buttons = [
    { id: `TRIAL_ARRIVED_PU_${order.id}`, title: "Arrived Pickup 📍" },
  ];

  await cloudApi.sendInteractiveButtons(phone, bodyText, buttons, "Shifter Partner");
}

/**
 * Handle incoming webhook payload from WhatsApp Cloud API.
 */
async function handleIncomingMessage(payload) {
  try {
    const entry = payload?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value || !value.messages || !value.messages[0]) {
      return; // Ignore status callbacks, acknowledgements, etc.
    }

    const message = value.messages[0];
    const fromPhone = message.from; // e.g. "916378211202"

    const rider = await findDriverByPhone(fromPhone);
    if (!rider) {
      logger.info(`Received WhatsApp message from unregistered number: ${fromPhone}`);
      return;
    }

    // 1. Handle interactive button clicks
    if (message.type === "interactive" && message.interactive?.button_reply) {
      const buttonId = message.interactive.button_reply.id;
      logger.info(`Driver ${rider.id} clicked button: ${buttonId}`);

      await handleButtonClick(rider, fromPhone, buttonId);
      return;
    }

    // 2. Handle plain text messages (e.g. 4-digit pickup OTP)
    if (message.type === "text" && message.text?.body) {
      const text = message.text.body.trim();
      logger.info(`Driver ${rider.id} sent text: "${text}"`);

      await handleTextMessage(rider, fromPhone, text);
      return;
    }
  } catch (err) {
    logger.error("Error processing incoming WhatsApp message:", err);
  }
}

/**
 * Processes interactive button actions from the driver.
 */
async function handleButtonClick(rider, fromPhone, buttonId) {
  // Case A: Accept Order
  if (buttonId.startsWith("TRIAL_ACCEPT_")) {
    const orderId = Number(buttonId.replace("TRIAL_ACCEPT_", ""));
    const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });

    if (!order) {
      await cloudApi.sendTextMessage(fromPhone, "❌ Ye order ab available nahi hai.");
      return;
    }

    if (order.rid !== 0 && order.rid !== rider.id) {
      await cloudApi.sendTextMessage(fromPhone, "⚠️ Ye order kisi aur driver ko assign ho chuka hai.");
      return;
    }

    // If order was not yet accepted by this rider, call tripLifecycle.acceptOrder
    if (order.order_status === 0) {
      const acceptRes = await tripLifecycle.acceptOrder(orderId, rider.id);
      if (!acceptRes.success) {
        await cloudApi.sendTextMessage(fromPhone, `❌ Order accept nahi ho saka: ${acceptRes.msg || "Error"}`);
        return;
      }
    }

    const freshOrder = await prisma.pkg_order.findUnique({ where: { id: orderId } });
    await sendPickupPrompt(fromPhone, freshOrder);
    return;
  }

  // Case B: Reject Order
  if (buttonId.startsWith("TRIAL_REJECT_")) {
    await cloudApi.sendTextMessage(fromPhone, "Theek hai, agla order aate hi aapko yahan message mil jayega.");
    return;
  }

  // Case C: Arrived at Pickup
  if (buttonId.startsWith("TRIAL_ARRIVED_PU_")) {
    const orderId = Number(buttonId.replace("TRIAL_ARRIVED_PU_", ""));
    const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });

    if (!order || order.rid !== rider.id) {
      await cloudApi.sendTextMessage(fromPhone, "❌ Active order nahi mila.");
      return;
    }

    try {
      await driverTripService.progressTrip({
        orderId,
        riderId: rider.id,
        action: "arrived",
      });
    } catch (err) {
      logger.warn(`progressTrip arrived notice: ${err.message}`);
    }

    const promptText = `📍 *Aap Pickup location par pahunch gaye hain!*\n\n` +
      `Kripya customer se *4-Digit Pickup OTP* maangein aur yahan message me likhkar bhejein (jaise: 1234).`;

    await cloudApi.sendTextMessage(fromPhone, promptText);
    return;
  }

  // Case D: Start Trip / Saman Load Hua
  if (buttonId.startsWith("TRIAL_START_TRIP_")) {
    const orderId = Number(buttonId.replace("TRIAL_START_TRIP_", ""));
    const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });

    if (!order || order.rid !== rider.id) {
      await cloudApi.sendTextMessage(fromPhone, "❌ Active order nahi mila.");
      return;
    }

    try {
      await driverTripService.progressTrip({
        orderId,
        riderId: rider.id,
        action: "pickup",
      });
    } catch (err) {
      logger.warn(`progressTrip pickup notice: ${err.message}`);
    }

    const drop = order.daddress || order.drop_address || "Drop location";
    const dropName = order.drop_name || order.customer_name || "Receiver";
    const mapLink = getMapLink(order.dlat, order.dlong);

    let bodyText = `🚀 *Trip Shuru Ho Gayi Hai!*\n\n` +
      `👤 *Receiver:* ${dropName}\n` +
      `🏁 *Drop Address:*\n${drop}\n`;

    if (mapLink) {
      bodyText += `\n🗺️ *Drop Navigation:*\n${mapLink}\n`;
    }

    bodyText += `\nDrop location par pahunchne ke baad niche button dabayein:`;

    const buttons = [
      { id: `TRIAL_ARRIVED_DROP_${order.id}`, title: "Arrived at Drop 🏁" },
    ];

    await cloudApi.sendInteractiveButtons(fromPhone, bodyText, buttons, "Shifter Partner");
    return;
  }

  // Case E: Arrived at Drop
  if (buttonId.startsWith("TRIAL_ARRIVED_DROP_")) {
    const orderId = Number(buttonId.replace("TRIAL_ARRIVED_DROP_", ""));
    const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });

    if (!order || order.rid !== rider.id) {
      await cloudApi.sendTextMessage(fromPhone, "❌ Active order nahi mila.");
      return;
    }

    try {
      await driverTripService.progressTrip({
        orderId,
        riderId: rider.id,
        action: "arrived_drop",
      });
    } catch (err) {
      logger.warn(`progressTrip arrived_drop notice: ${err.message}`);
    }

    const isCod = order.payment_method === "cod" || order.payment_type === "cash" || String(order.p_method_id) === "2";
    const fare = order.total_dcharge || order.d_charge || 0;

    let bodyText = `🏁 *Aap Drop Location par pahunch gaye hain!*\n\n`;
    if (isCod) {
      bodyText += `💵 *CASH COLLECTION:*\nCustomer se *₹${fare}* cash collect karein.\n\n`;
    } else {
      bodyText += `💳 *PAID ONLINE:*\nCustomer se koi cash lene ki zaroorat nahi hai (Already Paid).\n\n`;
    }

    bodyText += `Saman safely deliver hone ke baad delivery complete karein:`;

    const buttons = [
      { id: `TRIAL_COMPLETE_${order.id}`, title: "Complete Trip ✅" },
    ];

    await cloudApi.sendInteractiveButtons(fromPhone, bodyText, buttons, "Shifter Partner");
    return;
  }

  // Case F: Complete Trip
  if (buttonId.startsWith("TRIAL_COMPLETE_")) {
    const orderId = Number(buttonId.replace("TRIAL_COMPLETE_", ""));
    const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });

    if (!order || order.rid !== rider.id) {
      await cloudApi.sendTextMessage(fromPhone, "❌ Active order nahi mila.");
      return;
    }

    const updateRes = await tripLifecycle.updateStatus(orderId, rider.id, "complete");
    if (!updateRes.success) {
      await cloudApi.sendTextMessage(fromPhone, `❌ Order complete nahi ho saka: ${updateRes.msg || "Error"}`);
      return;
    }

    // Refresh rider record to check trial orders count
    const freshRider = await prisma.tbl_rider.findUnique({ where: { id: rider.id } });
    const completed = freshRider.trial_orders_completed || 1;
    const allowed = freshRider.trial_orders_allowed || 2;
    const fare = order.total_dcharge || order.d_charge || 0;

    if (freshRider.trial_status === "exhausted" || completed >= allowed) {
      const completionText = `🎉 *Badhai Ho! Aapka Trial Poora Hua!*\n\n` +
        `📦 Order #${order.id} safalta se complete ho gaya hai.\n` +
        `💰 Aapki kamaai (₹${fare}) aapke Shifter wallet me add ho chuki hai.\n\n` +
        `🚀 *Aage ke unlimited orders lene ke liye abhi Shifter Partner App download karein:*\n` +
        `👉 https://play.google.com/store/apps/details?id=com.shifter.driver\n\n` +
        `App download karke login karein aur daily orders se kamaai shuru karein! 🚚💨`;

      await cloudApi.sendTextMessage(fromPhone, completionText);
    } else {
      const nextPrompt = `🎉 *Order #${order.id} Complete!*\n\n` +
        `💰 Aapki kamaai: ₹${fare}\n` +
        `📊 Trial Progress: ${completed}/${allowed} orders complete ho chuke hain.\n\n` +
        `Agla order dispatch hote hi aapko WhatsApp par update mil jayega! 👍`;

      await cloudApi.sendTextMessage(fromPhone, nextPrompt);
    }
  }
}

/**
 * Processes plain text messages (Pickup OTP entry).
 */
async function handleTextMessage(rider, fromPhone, text) {
  // Check if text looks like a 4-digit numeric OTP
  const isOtp = /^\d{4}$/.test(text.trim());

  if (isOtp) {
    // Find rider's active trip in Pickup status (order_status = 2)
    const activeOrder = await prisma.pkg_order.findFirst({
      where: {
        rid: rider.id,
        order_status: 2,
        o_status: "Pickup",
      },
      orderBy: { id: "desc" },
    });

    if (!activeOrder) {
      await cloudApi.sendTextMessage(
        fromPhone,
        "⚠️ Abhi aapki koi aisi trip nahi hai jo Pickup OTP verify hone ka wait kar rahi ho."
      );
      return;
    }

    try {
      await driverTripService.progressTrip({
        orderId: activeOrder.id,
        riderId: rider.id,
        action: "verify_otp",
        otp: text.trim(),
      });

      const bodyText = `✅ *Pickup OTP Verify Ho Gaya!*\n\n` +
        `Saman gaadi me load karwayein aur jab delivery ke liye niklein toh niche diye gaye button par click karein:`;

      const buttons = [
        { id: `TRIAL_START_TRIP_${activeOrder.id}`, title: "Start Trip 🚀" },
      ];

      await cloudApi.sendInteractiveButtons(fromPhone, bodyText, buttons, "Shifter Partner");
      return;
    } catch (err) {
      logger.warn(`OTP verification failed for rider ${rider.id}: ${err.message}`);
      await cloudApi.sendTextMessage(
        fromPhone,
        `❌ *Galat OTP!* Kripya customer se sahi 4-digit pickup OTP lekar dobara bhejein.`
      );
      return;
    }
  }

  // If driver just sends a greeting or general text
  await cloudApi.sendTextMessage(
    fromPhone,
    "Namaste! Yeh Shifter Online Driver Assistant hai. Aapka agla trial order aate hi aapko yahan message mil jayega."
  );
}

module.exports = {
  findDriverByPhone,
  sendOrderOffer,
  sendPickupPrompt,
  handleIncomingMessage,
};
