const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const logger = require("../../utils/logger");

/**
 * Handles Instant Fare Estimate via WhatsApp
 */
async function handleFareCalculation(phoneNumber, entities, session) {
  try {
    const categories = await prisma.pkg_category.findMany({
      where: { cat_status: 1 },
      orderBy: { sort_order: "asc" },
    });

    if (categories.length === 0) {
      return "⚠️ Abhi koi vehicle category active nahi hai. Kripya baad me try karein.";
    }

    let categoryListText = "📦 *Shifter Online — Fare Estimator*:\n\n";
    categoryListText += "Pickup aur Drop location enter karke aasan steps me fare calculate karein!\n\n";
    categoryListText += "💡 *Start karne ke liye reply karein*:\n*<Pickup Location> to <Drop Location>* (e.g. Connaught Place to Noida Sector 62)\n\n";
    categoryListText += "Ya apna *Pickup Location* write karein:";
    return categoryListText;
  } catch (err) {
    logger.error("WhatsApp handleFareCalculation error:", err);
    return "⚠️ Fare calculate karne me error aaya. Kripya punah prayaas karein.";
  }
}

/**
 * Fetches all active vehicle categories from DB for WhatsApp prompt
 */
async function getActiveCategories() {
  try {
    const categories = await prisma.pkg_category.findMany({
      where: { cat_status: 1 },
      orderBy: { sort_order: "asc" },
    });
    return categories;
  } catch (err) {
    logger.error("getActiveCategories error:", err);
    return [];
  }
}

/**
 * Formats active categories into a numbered WhatsApp prompt string
 */
function formatCategoriesPrompt(categories, radiusKm = 5) {
  if (!categories || categories.length === 0) {
    return "⚠️ Abhi koi vehicle category active nahi hai. Kripya baad me try karein.";
  }

  let text = `⭕ *Driver Search Radius*: *${radiusKm} km* set ho gaya hai!\n\n` +
             `🛵 *Vehicle Category Choose Karein*:\n\n`;

  categories.forEach((cat, idx) => {
    text += `${idx + 1}. *${cat.cat_name}*\n`;
  });

  text += `\n(Reply 1, 2, 3, etc. ya category ka naam write karein)`;
  return text;
}

/**
 * Fetches models & calculated fares for a chosen category and trip route
 */
async function getCategoryModels(categoryId, bookingData) {
  try {
    const {
      pickupLat = "28.6139",
      pickupLng = "77.2090",
      dropLat = "28.5355",
      dropLng = "77.3910",
      searchRadius = 5,
    } = bookingData;

    const radiusKm = parseInt(searchRadius, 10) || 5;

    const estimate = await pricingEngine.getFareEstimate({
      cat_id: Number(categoryId),
      plat: parseFloat(pickupLat),
      plong: parseFloat(pickupLng),
      dlat: parseFloat(dropLat),
      dlong: parseFloat(dropLng),
      radiusRangeKm: radiusKm,
    });

    const models = estimate.packages || [];
    return {
      distanceKm: estimate.distance_km || 0,
      models,
    };
  } catch (err) {
    logger.error("getCategoryModels error:", err);
    return { distanceKm: 0, models: [] };
  }
}

/**
 * Formats available models for a category into a numbered WhatsApp prompt
 */
function formatModelsPrompt(categoryName, models, distanceKm) {
  if (!models || models.length === 0) {
    return `⚠️ *${categoryName}* category me abhi koi vehicle model active nahi hai.\nKripya koi doosri category select karein.`;
  }

  let text = `🚚 *${categoryName} ke Available Vehicle Models*:\n`;
  if (distanceKm > 0) {
    text += `🛣️ *Route Distance*: ${distanceKm} km\n\n`;
  } else {
    text += `\n`;
  }

  models.forEach((mod, idx) => {
    const radiusNote = mod.radius_charge > 0 ? ` (Radius Charge: ₹${mod.radius_charge})` : ` (1st km Free)`;
    text += `${idx + 1}. *${mod.title}* — ₹${mod.estimated_fare}${radiusNote}\n`;
  });

  text += `\nKripya apne pasand ka *Model Number* select karne ke liye reply karein (e.g. 1, 2, 3):`;
  return text;
}

/**
 * Generates the final Fare Estimate Result & App Redirect response for WhatsApp
 */
async function getFareEstimateResult(bookingData) {
  try {
    const {
      pickupAddress = "Customer Specified Pickup",
      dropAddress = "Customer Specified Drop",
      vehicleCategory = "Vehicle",
      selectedModel,
      searchRadius = 5,
      distanceKm = 0,
    } = bookingData;

    const radiusKm = parseInt(searchRadius, 10) || 5;
    const modelTitle = selectedModel ? selectedModel.title : "Standard Model";
    const fare = selectedModel ? parseFloat(selectedModel.estimated_fare || selectedModel.min_charge) : 0;
    const radiusCharge = selectedModel ? parseFloat(selectedModel.radius_charge || 0) : 0;
    const dist = distanceKm || bookingData.distanceKm || 0;

    const radiusChargeText = radiusCharge > 0 ? ` (Radius Charge: ₹${radiusCharge})` : ` (1st km Free)`;

    const appDownloadUrl = process.env.USER_APP_DOWNLOAD_URL || "https://play.google.com/store/apps/details?id=com.shifter.online";

    let text = `💰 *Your Estimated Fare is ₹${fare}*\n\n` +
               `📋 *Trip Details & Fare Breakdown*:\n` +
               `📍 *Pickup*: ${pickupAddress}\n` +
               `🎯 *Drop*: ${dropAddress}\n`;

    if (dist > 0) {
      text += `🛣️ *Distance*: ${dist} km\n`;
    }

    text += `⭕ *Search Radius*: ${radiusKm} km${radiusChargeText}\n` +
            `🚗 *Vehicle Category*: ${vehicleCategory}\n` +
            `🚚 *Vehicle Model*: ${modelTitle}\n` +
            `💵 *Estimated Total Fare*: *₹${fare}*\n\n` +
            `----------------------------------------\n` +
            `ℹ️ *WhatsApp par direct booking available nahi hai.*\n` +
            `Agar aap booking karna chahte hain, toh hamari official application se booking kar sakte hain.\n\n` +
            `📲 *Download / Open Shifter App to Book*:\n` +
            `🔗 ${appDownloadUrl}\n` +
            `----------------------------------------`;

    return text;
  } catch (err) {
    logger.error("getFareEstimateResult error:", err);
    return `💰 *Your Estimated Fare is ₹150*\n\n` +
           `ℹ️ WhatsApp par direct booking available nahi hai. Booking ke liye hamari official application download karein:\n` +
           `🔗 https://play.google.com/store/apps/details?id=com.shifter.online`;
  }
}

/**
 * Normalizes phone number to last 10 digits for accurate matching
 */
function normalizePhone10(phone) {
  if (phone === null || phone === undefined) return "";
  let str = "";
  if (typeof phone === "number") {
    if (isNaN(phone) || !isFinite(phone)) return "";
    str = BigInt(Math.round(phone)).toString();
  } else {
    str = String(phone).trim();
    if (str.includes("e+") || str.includes("E+")) {
      const num = Number(str);
      if (!isNaN(num)) {
        str = BigInt(Math.round(num)).toString();
      }
    }
  }
  const digits = str.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Verifies if incoming sender phone number belongs to the order
 */
function matchesOrderPhone(senderPhone, order, user) {
  const senderClean = normalizePhone10(senderPhone);
  if (!senderClean) return false;

  const orderPmobile = normalizePhone10(order.pmobile);
  const orderDmobile = normalizePhone10(order.dmobile);
  const userMobile = user ? normalizePhone10(user.mobile) : "";

  return (
    (orderPmobile && senderClean === orderPmobile) ||
    (orderDmobile && senderClean === orderDmobile) ||
    (userMobile && senderClean === userMobile)
  );
}

/**
 * Order Tracking Query (For orders created via official mobile app)
 * Returns order tracking details for any valid Order ID requested by user
 */
async function handleTrackingQuery(orderId, senderPhone) {
  try {
    const id = parseInt(String(orderId).replace(/\D/g, ""), 10);
    if (!id) return "⚠️ Valid Order ID bhejein (e.g. *Track 1024*).";

    const order = await prisma.pkg_order.findUnique({
      where: { id },
    });

    if (!order) {
      return `❌ Order #${id} nahi mila. Kripya sahi Order ID check karein.`;
    }

    let riderText = "Abhi driver search me hai...";
    if (order.rid > 0) {
      const rider = await prisma.tbl_rider.findUnique({
        where: { id: order.rid },
      });
      if (rider) {
        riderText = `*${rider.first_name || ""} ${rider.last_name || ""}* (${rider.vehicle_no || "N/A"}) — 📞 ${rider.fmobile}`;
      }
    }

    const trackingUrl = process.env.PUBLIC_TRACKING_URL || `https://shifter.online/track/${order.id}`;

    return `📦 *Order #${order.id} Tracking Status*\n\n` +
           `📌 *Status*: *${order.o_status}*\n` +
           `🛵 *Driver*: ${riderText}\n` +
           `📍 *Pickup*: ${order.paddress}\n` +
           `🎯 *Drop*: ${order.daddress}\n` +
           `💰 *Total Amount*: ₹${order.total_dcharge}\n\n` +
           `🗺️ *Live Location Tracking*: ${trackingUrl}`;
  } catch (err) {
    logger.error("handleTrackingQuery error:", err);
    return "⚠️ Order status fetch karne me error aaya.";
  }
}

module.exports = {
  handleFareCalculation,
  getActiveCategories,
  formatCategoriesPrompt,
  getCategoryModels,
  formatModelsPrompt,
  getFareEstimateResult,
  handleTrackingQuery,
};
