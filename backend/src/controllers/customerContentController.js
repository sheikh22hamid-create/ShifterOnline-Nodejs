const prisma = require("../config/db");
const logger = require("../utils/logger");
const { getCustomerWalletMaxTopup } = require("../services/driverWalletSettings");

// Node port of several small read-mostly cust_api/*.php endpoints:
// add_favorite_driver.php, get_favorite_drivers.php, couponlist.php,
// check_coupon.php, notification_list.php, city.php, pagelist.php,
// faq.php, paymentgateway.php, home_data.php, cancel_reason.php,
// sms_type.php.

function fail(res, msg, code = 401) {
  return res.status(200).json({ ResponseCode: String(code), Result: "false", ResponseMsg: msg });
}

// --- cancel_reason.php --- (customer-facing list; admin CRUD already lives in adminRoutes.js)
async function cancelReasonList(req, res) {
  try {
    const type = req.body?.type;
    if (!type || !["user", "driver"].includes(type)) {
      return fail(res, "Invalid or Missing Type! (user/driver)");
    }

    const reasons = await prisma.tbl_cancel_reason.findMany({
      where: { OR: [{ type }, { type: "both" }], status: true },
      orderBy: { id: "asc" },
      select: { id: true, reason: true, type: true },
    });
    if (!reasons.length) return fail(res, "No Cancel Reasons Found!");

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Cancel Reasons Fetched Successfully!!", reason_list: reasons });
  } catch (err) {
    logger.error("customerContentController.cancelReasonList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- sms_type.php --- (app-level feature-flag/config echo, read from `setting`)
// A handful of the PHP fields (admob, mode, slogin, banner_id, in_id,
// coin_fun, ios_in_id, ios_banner_id, agora_app_id) don't exist as columns
// on `setting` in this schema - they're returned as null rather than
// silently dropped, so the app's existing null-handling for "feature off"
// keeps working instead of the key vanishing outright.
async function appConfig(req, res) {
  try {
    const [setting, careRow] = await Promise.all([
      prisma.setting.findFirst(),
      prisma.app_settings.findUnique({ where: { setting_key: "customer_care_number" } }),
    ]);
    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "type Get Successfully!!",
      customer_care_number: careRow?.setting_value || "+91 9109114515",
      SMS_TYPE: setting?.sms_type ?? null,
      Admob_Enabled: null,
      maintainance_Enabled: null,
      Social_login_enabled: null,
      banner_id: null,
      in_id: null,
      otp_auth: setting?.otp_auth ?? null,
      gift_fun: null,
      ios_in_id: null,
      ios_banner_id: null,
      agora_app_id: null,
      one_key: setting?.one_key ?? null,
      one_hash: setting?.one_hash ?? null,
    });
  } catch (err) {
    logger.error("customerContentController.appConfig failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- add_favorite_driver.php --- (toggle)
async function toggleFavoriteDriver(req, res) {
  try {
    const userId = Number(req.body?.user_id || 0);
    const riderId = Number(req.body?.rider_id || 0);
    if (!userId || !riderId) return res.status(200).json({ Result: false, msg: "user_id and rider_id required" });

    const existing = await prisma.tbl_favorite_driver.findFirst({ where: { user_id: userId, rider_id: riderId } });
    if (existing) {
      const newStatus = existing.status === 1 ? 0 : 1;
      await prisma.tbl_favorite_driver.update({ where: { id: existing.id }, data: { status: newStatus } });
      return res.status(200).json({ Result: true, msg: newStatus ? "Added to favorite" : "Removed from favorite", status: newStatus });
    }

    await prisma.tbl_favorite_driver.create({ data: { user_id: userId, rider_id: riderId, status: 1 } });
    return res.status(200).json({ Result: true, msg: "Added to favorite", status: 1 });
  } catch (err) {
    logger.error("customerContentController.toggleFavoriteDriver failed:", err);
    return res.status(200).json({ Result: false, msg: "Internal server error" });
  }
}

// --- get_favorite_drivers.php ---
async function listFavoriteDrivers(req, res) {
  try {
    const userId = Number(req.body?.user_id || 0);
    if (!userId) return res.status(200).json({ Result: false, msg: "user_id required" });

    const favs = await prisma.tbl_favorite_driver.findMany({ where: { user_id: userId, status: 1 } });
    const riderIds = favs.map((f) => f.rider_id).filter(Boolean);
    const riders = await prisma.tbl_rider.findMany({
      where: { id: { in: riderIds } },
      select: { id: true, first_name: true, last_name: true, fmobile: true, vehicle: true },
    });
    const data = riders.map((r) => ({
      id: r.id,
      name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
      fmobile: r.fmobile,
      vehicle: r.vehicle,
    }));

    return res.status(200).json({ Result: true, data });
  } catch (err) {
    logger.error("customerContentController.listFavoriteDrivers failed:", err);
    return res.status(200).json({ Result: false, msg: "Internal server error" });
  }
}

// --- couponlist.php ---
// PHP counted redemptions against `buy_order` (the pre-migration order
// table). New orders are written to `pkg_order` (see orderController.js),
// so counting against buy_order would never hit `ulimit` for any order
// placed since the migration. Counts against pkg_order instead so the
// --- couponlist.php ---
async function couponList(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);

    const today = new Date();
    const where = {
      status: 1,
      ...(uid > 0 ? { OR: [{ cusefor: 0 }, { cusefor: uid }] } : { cusefor: 0 }),
    };
    const candidates = await prisma.tbl_coupon.findMany({ where, orderBy: { id: "desc" } });

    const result = [];
    for (const row of candidates) {
      if (uid > 0 && row.ulimit) {
        const usedCount = await prisma.pkg_order.count({ where: { cou_id: row.id, uid } });
        if (usedCount >= row.ulimit) continue;
      }

      if (row.cdate) {
        const expiry = new Date(row.cdate);
        expiry.setHours(23, 59, 59, 999);
        if (expiry < today) {
          continue;
        }
      }

      result.push({
        id: String(row.id),
        c_img: row.c_img || "",
        cdate: row.cdate ? row.cdate.toISOString() : null,
        c_desc: row.c_desc || "",
        c_value: String(row.c_value || "0"),
        coupon_code: row.c_title || "",
        coupon_title: row.ctitle || row.c_title || "",
        min_amt: String(row.min_amt || "0"),
      });
    }

    return res.status(200).json({
      couponlist: result,
      ResponseCode: "200",
      Result: result.length ? "true" : "false",
      ResponseMsg: result.length ? "Coupon List Founded!" : "Coupon Not Founded!",
    });
  } catch (err) {
    logger.error("customerContentController.couponList failed:", err);
    return res.status(200).json({
      couponlist: [],
      ResponseCode: "200",
      Result: "false",
      ResponseMsg: "Coupon Not Founded!",
    });
  }
}

// --- check_coupon.php ---
async function checkCoupon(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const cid = Number(req.body?.cid || 0);
    const code = String(req.body?.coupon_code || req.body?.code || "").trim();

    if (!cid && !code) {
      return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: "Please select or enter a coupon code" });
    }

    let coupon = null;
    if (cid) {
      coupon = await prisma.tbl_coupon.findUnique({ where: { id: cid } });
    } else if (code) {
      coupon = await prisma.tbl_coupon.findFirst({
        where: {
          status: 1,
          OR: [
            { c_title: code },
            { ctitle: code },
          ],
        },
      });
    }

    if (!coupon || coupon.status === 0) {
      return res.status(200).json({ ResponseCode: "404", Result: "false", ResponseMsg: "Coupon Not Exist or Expired!!" });
    }

    if (uid && coupon.cusefor !== 0 && coupon.cusefor !== uid) {
      return res.status(200).json({ ResponseCode: "403", Result: "false", ResponseMsg: "This coupon is not valid for your account!" });
    }

    const today = new Date();
    if (coupon.cdate) {
      const expiry = new Date(coupon.cdate);
      expiry.setHours(23, 59, 59, 999);
      if (expiry < today) {
        return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: "This coupon has expired!" });
      }
    }

    if (uid && coupon.ulimit) {
      const usedCount = await prisma.pkg_order.count({ where: { cou_id: coupon.id, uid } });
      if (usedCount >= coupon.ulimit) {
        return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: "Coupon Limit Exists!!" });
      }
    }

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Coupon Applied Successfully!!",
      coupon: {
        id: String(coupon.id),
        c_img: coupon.c_img || "",
        cdate: coupon.cdate ? coupon.cdate.toISOString() : null,
        c_desc: coupon.c_desc || "",
        c_value: String(coupon.c_value || "0"),
        coupon_code: coupon.c_title || "",
        coupon_title: coupon.ctitle || coupon.c_title || "",
        min_amt: String(coupon.min_amt || "0"),
      },
    });
  } catch (err) {
    logger.error("customerContentController.checkCoupon failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

// --- notification_list.php ---
async function notificationList(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    if (!uid) return fail(res, "Something Went Wrong!");

    const rows = await prisma.tbl_notification.findMany({ where: { uid }, orderBy: { id: "desc" } });
    return res.status(200).json({ NotificationData: rows, ResponseCode: "200", Result: "true", ResponseMsg: "Notification List Get Successfully!!" });
  } catch (err) {
    logger.error("customerContentController.notificationList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- city.php ---
async function cityList(req, res) {
  try {
    const rows = await prisma.tbl_city.findMany({
      where: { status: 1 },
      select: { id: true, title: true, status: true },
      orderBy: { id: "asc" },
    });
    return res.status(200).json({ CityData: rows, ResponseCode: "200", Result: "true", ResponseMsg: "City List Get Successfully!!" });
  } catch (err) {
    logger.error("customerContentController.cityList failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Query Failed" });
  }
}

// --- pagelist.php ---
async function pageList(req, res) {
  try {
    const [rows, careSettings] = await Promise.all([
      prisma.tbl_page.findMany({ where: { status: 1 } }),
      prisma.app_settings.findMany({
        where: { setting_key: { in: ["customer_care_number", "customer_care_email", "customer_care_hours"] } },
      }),
    ]);
    const careMap = Object.fromEntries(careSettings.map((s) => [s.setting_key, s.setting_value]));
    const list = rows.map((r) => ({ title: r.title, description: r.description }));
    return res.status(200).json({
      pagelist: list,
      ResponseCode: "200",
      Result: list.length ? "true" : "false",
      ResponseMsg: list.length ? "Pages List Founded!" : "Pages Not Founded!",
      customer_care_number: careMap.customer_care_number || "+91 9109114515",
      customer_care_email: careMap.customer_care_email || "support@shifteronline.com",
      customer_care_hours: careMap.customer_care_hours || "24/7 Helpline",
    });
  } catch (err) {
    logger.error("customerContentController.pageList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- customer_care API ---
async function getCustomerCare(req, res) {
  try {
    const rows = await prisma.app_settings.findMany({
      where: {
        setting_key: { in: ["customer_care_number", "customer_care_email", "customer_care_hours"] },
      },
    });
    const map = Object.fromEntries(rows.map((s) => [s.setting_key, s.setting_value]));
    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Customer care details fetched successfully",
      customer_care_number: map.customer_care_number || "+91 9109114515",
      customer_care_email: map.customer_care_email || "support@shifteronline.com",
      customer_care_hours: map.customer_care_hours || "24/7 Helpline",
    });
  } catch (err) {
    logger.error("customerContentController.getCustomerCare failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- faq.php ---
async function faqList(req, res) {
  try {
    const uid = req.body?.uid;
    if (!uid) return fail(res, "Something Went Wrong!");

    const rows = await prisma.tbl_faq.findMany({ where: { status: 1 } });
    return res.status(200).json({ FaqData: rows, ResponseCode: "200", Result: "true", ResponseMsg: "Faq List Get Successfully!!" });
  } catch (err) {
    logger.error("customerContentController.faqList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- paymentgateway.php ---
async function paymentGatewayList(req, res) {
  try {
    const rows = await prisma.tbl_payment_list.findMany({ where: { status: 1 } });
    return res.status(200).json({ data: rows, ResponseCode: "200", Result: "true", ResponseMsg: "Payment Gateway List Founded!" });
  } catch (err) {
    logger.error("customerContentController.paymentGatewayList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

const FLOW_MESSAGES_BUY_ORDER = {
  0: "Waiting For Delivery Boy Decision.",
  1: "Delivery Valut Going To Pick Up Location.",
  2: "Finding Other Delivery Partner.",
  3: "Delivery Partner Reached Pickup Location.",
  4: "Delivery Partner Not Able To Deliver This Order.",
  5: "Review Item Options!!",
  6: "Delivery Partner Waiting For Your Payment.",
  7: "Delivery Partner Pay Bill",
  8: "Your Item Pickup",
  9: "Delivery Partner On The Way",
  10: "Your Order Delivered Successfully.",
};

const FLOW_MESSAGES_PKG_ORDER = {
  0: "Waiting For Delivery Boy Decision.",
  1: "Delivery Valut Going To Pick Up Location.",
  2: "Finding Other Delivery Partner.",
  3: "Delivery Partner On The Way",
  4: "Delivery Partner Not Able To Deliver This Order.",
  5: "Your Order Delivered Successfully.",
};

// --- home_data.php ---
async function homeData(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const deviceId = String(req.body?.device_id || "");
    const search = String(req.body?.search || "");
    if (!uid) return fail(res, "Something Went wrong  try again !");

    const [bannerRow] = await prisma.tbl_banner.findMany({ where: { status: 1 }, orderBy: { id: "desc" }, take: 1 });
    const banner = bannerRow ? [{ id: bannerRow.id, img: bannerRow.img }] : [];

    const categoryWhere = { cat_status: 1, ...(search ? { cat_name: { contains: search } } : {}) };
    const rawCategories = await prisma.pkg_category.findMany({ where: categoryWhere, orderBy: { sort_order: "asc" } });
    const categories = rawCategories.map((cat) => ({
      id: cat.id,
      cat_name: cat.cat_name,
      cat_img: cat.cat_img,
      other_image: cat.other_image || cat.cat_img,
      cat_status: cat.cat_status,
      img: cat.cat_img,
      image: cat.cat_img,
      icon: cat.cat_img,
      cat_icon: cat.cat_img,
      cat_image: cat.cat_img,
      vehicle_img: cat.cat_img,
      cat_title: cat.cat_name,
      title: cat.cat_name,
    }));

    // Legacy pre-migration order (buy_order) - kept only for response-shape
    // parity; new orders never write here (see couponList comment above),
    // so this is normally null for every current customer.
    const buyOrder = await prisma.buy_order.findFirst({
      where: { uid, NOT: [{ o_status: "Completed" }, { o_status: "Cancelled" }] },
      orderBy: { id: "desc" },
    });
    const buyOrderHistory = buyOrder
      ? {
          id: buyOrder.id,
          status: buyOrder.o_status,
          order_date: buyOrder.order_date,
          total: Number(buyOrder.d_charge) + Number(buyOrder.extra_mile_charge) - Number(buyOrder.cou_amt),
          order_step: buyOrder.flow_id,
          is_rate: buyOrder.is_rate,
          pick_address: buyOrder.pick_address,
          drop_address: buyOrder.drop_address,
          flow_msg: FLOW_MESSAGES_BUY_ORDER[buyOrder.flow_id] ?? "",
        }
      : {};

    // Current live in-progress order (pkg_order).
    const pkgOrder = await prisma.pkg_order.findFirst({
      where: { uid, NOT: [{ o_status: "Completed" }, { o_status: "Cancelled" }] },
      orderBy: { id: "desc" },
    });
    const orderHistory = pkgOrder
      ? {
          id: pkgOrder.id,
          status: pkgOrder.o_status,
          order_date: pkgOrder.odate,
          total: pkgOrder.d_charge,
          is_rate: pkgOrder.is_rate,
          pick_address: pkgOrder.paddress,
          drop_address: pkgOrder.daddress,
          flow_msg: FLOW_MESSAGES_PKG_ORDER[pkgOrder.order_status] ?? "",
        }
      : {};

    const mainData = await prisma.setting.findFirst();

    let deviceMatch = false;
    if (deviceId) {
      // is_active straight in the WHERE, not "latest by id" - see
      // memory/device_match_query_bug.md for why ordering by id is wrong here.
      const device = await prisma.tbl_user_device.findFirst({ where: { uid, user_type: "customer", is_active: true }, orderBy: { last_login_at: "desc" } });
      deviceMatch = !!(device && device.device_id === deviceId);
    }

    const user = await prisma.tbl_user.findUnique({ where: { id: uid } });

    let hasPlanDiscount = false;
    let planDiscountPercent = 0;
    let planName = "";
    const today = new Date();
    const activeSub = await prisma.tbl_user_plan_subscription.findFirst({
      where: {
        user_id: uid,
        status: "active",
        plan_for: "USER",
        start_date: { lte: today },
        end_date: { gte: today },
      },
    });
    if (activeSub) {
      const plan = await prisma.tbl_premium_plan.findUnique({ where: { id: activeSub.plan_id } });
      if (plan?.discount_enabled && Number(plan.discount_percent) > 0) {
        hasPlanDiscount = true;
        planDiscountPercent = Number(plan.discount_percent);
        planName = plan.plan_name || "";
      }
    }

    const stopSetting = await prisma.app_settings.findUnique({ where: { setting_key: "max_extra_stops" } });
    const maxExtraStops = stopSetting && Number(stopSetting.setting_value) >= 0
      ? Math.floor(Number(stopSetting.setting_value))
      : 2;

    const walletMaxTopup = await getCustomerWalletMaxTopup();

    const radiusSetting = await prisma.app_settings.findUnique({ where: { setting_key: "default_search_radius" } });
    const defaultSearchRadius = radiusSetting && Number(radiusSetting.setting_value) > 0
      ? Math.floor(Number(radiusSetting.setting_value))
      : 4;

    const [completedPkgOrders, completedBuyOrders, howToUseSettings] = await Promise.all([
      prisma.pkg_order.count({ where: { uid, o_status: "Completed" } }),
      prisma.buy_order.count({ where: { uid, o_status: "Completed" } }),
      prisma.app_settings.findMany({
        where: {
          setting_key: {
            in: [
              "how_to_use_video_url",
              "how_to_use_enabled",
              "how_to_use_title",
              "how_to_use_max_orders",
              "customer_care_number",
              "customer_care_email",
              "customer_care_hours",
            ],
          },
        },
      }),
    ]);
    const completedOrdersCount = completedPkgOrders + completedBuyOrders;

    const howToUseMap = Object.fromEntries(howToUseSettings.map((s) => [s.setting_key, s.setting_value]));
    const howToUseUrl = howToUseMap.how_to_use_video_url || "https://www.youtube.com/shorts/h7KMfS0IrI8";
    const howToUseTitle = howToUseMap.how_to_use_title || "How To Use";
    const maxOrdersThreshold = howToUseMap.how_to_use_max_orders !== undefined && howToUseMap.how_to_use_max_orders !== ""
      ? Number(howToUseMap.how_to_use_max_orders)
      : 5;

    let isHowUseEnabled = howToUseMap.how_to_use_enabled !== undefined
      ? (howToUseMap.how_to_use_enabled === "1" || howToUseMap.how_to_use_enabled === "true")
      : true;

    // Automatically hide How To Use bar if user has reached/exceeded the completed orders threshold (default: 5 orders)
    if (maxOrdersThreshold > 0 && completedOrdersCount >= maxOrdersThreshold) {
      isHowUseEnabled = false;
    }

    const resultData = {
      PriceData: mainData,
      Package_Category: categories,
      banner,
      BuyOrderHistory: buyOrderHistory,
      OrderHistory: orderHistory,
      DeviceMatch: deviceMatch,
      referral_code: user?.reffer_code || "",
      referral_msg: "Hey! Use my referral code to sign up on Shifter Online and earn exciting rewards!",
      has_plan_discount: hasPlanDiscount,
      plan_discount_percent: planDiscountPercent,
      plan_name: planName,
      max_extra_stops: maxExtraStops,
      wallet_max_topup: walletMaxTopup,
      default_search_radius: defaultSearchRadius,
      isHowUse: isHowUseEnabled ? 1 : "true",
      how_to_use_url: howToUseUrl,
      how_to_use_title: howToUseTitle,
      how_to_use_enabled: isHowUseEnabled ? 1 : 0,
      completed_orders_count: completedOrdersCount,
      how_to_use_max_orders: maxOrdersThreshold,
      customer_care_number: howToUseMap.customer_care_number || "+91 9109114515",
      customer_care_email: howToUseMap.customer_care_email || "support@shifteronline.com",
      customer_care_hours: howToUseMap.customer_care_hours || "24/7 Helpline",
    };

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Home Data Get Successfully!", ResultData: resultData });
  } catch (err) {
    logger.error("customerContentController.homeData failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- cust_api/pkg_history.php --- (the customer app's "My Orders" screen).
// This was never ported when the order flow moved to Node - the Flutter app
// (p_d_order_histroy_api_controller.dart) was still calling the legacy PHP
// pkg_history.php via Config.baseurl, which has no visibility into orders
// created through this backend's pkg_order table, so Pending/Completed/
// Cancelled orders never showed up. Mirrors
// driverOrderHistoryController.pkgHistoryDriver's recent/past split (uid
// instead of rid), using $queryRaw so o_status comes back as the raw DB
// string ("On Route", not the enum key "On_Route") to match what the app's
// orderlistBox() switch-case already expects.
async function pkgHistoryCustomer(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const type = req.body?.type;
    if (!uid) return fail(res, "Something Went Wrong!");

    let rows;
    if (type === "past") {
      rows = await prisma.$queryRaw`
        SELECT * FROM pkg_order WHERE uid = ${uid} AND (o_status = 'Completed' OR o_status = 'Cancelled') ORDER BY id DESC
      `;
    } else {
      rows = await prisma.$queryRaw`
        SELECT * FROM pkg_order WHERE uid = ${uid} AND o_status NOT IN ('Completed', 'Cancelled') ORDER BY id DESC
      `;
    }

    const orderHistory = rows.map((row) => ({
      id: String(row.id),
      status: row.o_status,
      order_date: row.odate,
      total: String(row.total_dcharge > 0 ? row.total_dcharge : row.d_charge),
      is_rate: String(row.is_rate ?? 0),
      pick_address: row.paddress,
      drop_address: row.daddress,
      flow_msg: FLOW_MESSAGES_PKG_ORDER[row.order_status] ?? "",
    }));

    return res.status(200).json({
      OrderHistory: orderHistory,
      ResponseCode: "200",
      Result: orderHistory.length ? "true" : "false",
      ResponseMsg: orderHistory.length ? "Order History Get Successfully!!!" : "No Order History Found!",
    });
  } catch (err) {
    logger.error("customerContentController.pkgHistoryCustomer failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

module.exports = {
  toggleFavoriteDriver,
  listFavoriteDrivers,
  couponList,
  checkCoupon,
  notificationList,
  cityList,
  pageList,
  faqList,
  paymentGatewayList,
  homeData,
  cancelReasonList,
  appConfig,
  pkgHistoryCustomer,
  getCustomerCare,
};
