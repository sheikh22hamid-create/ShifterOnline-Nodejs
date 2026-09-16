const prisma = require("../config/db");
const logger = require("../utils/logger");

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
    const setting = await prisma.setting.findFirst();
    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "type Get Successfully!!",
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
// per-user usage limit is actually enforced going forward.
async function couponList(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    if (!uid) return fail(res, "Something Went Wrong!");

    const today = new Date();
    const candidates = await prisma.tbl_coupon.findMany({ where: { status: 1, OR: [{ cusefor: 0 }, { cusefor: uid }] } });

    const result = [];
    for (const row of candidates) {
      const usedCount = await prisma.pkg_order.count({ where: { cou_id: row.id, uid } });
      if (usedCount >= row.ulimit) continue;

      if (new Date(row.cdate) < today) {
        await prisma.tbl_coupon.update({ where: { id: row.id }, data: { status: 0 } });
        continue;
      }

      result.push({
        id: row.id,
        c_img: row.c_img,
        cdate: row.cdate,
        c_desc: row.c_desc,
        c_value: row.c_value,
        coupon_code: row.c_title,
        coupon_title: row.ctitle,
        min_amt: row.min_amt,
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
    return fail(res, "Internal server error", 500);
  }
}

// --- check_coupon.php --- (same buy_order -> pkg_order adaptation as above)
async function checkCoupon(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const cid = Number(req.body?.cid || 0);
    if (!uid || !cid) return fail(res, "Something Went Wrong!");

    const coupon = await prisma.tbl_coupon.findUnique({ where: { id: cid } });
    const usedCount = await prisma.pkg_order.count({ where: { cou_id: cid, uid } });

    if (coupon && usedCount >= coupon.ulimit) return fail(res, "Coupon Limit Exists!!");
    if (!coupon) return fail(res, "Coupon Not Exist!!");

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Coupon Applied Successfully!!" });
  } catch (err) {
    logger.error("customerContentController.checkCoupon failed:", err);
    return fail(res, "Internal server error", 500);
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
    const rows = await prisma.tbl_page.findMany({ where: { status: 1 } });
    const list = rows.map((r) => ({ title: r.title, description: r.description }));
    return res.status(200).json({
      pagelist: list,
      ResponseCode: "200",
      Result: list.length ? "true" : "false",
      ResponseMsg: list.length ? "Pages List Founded!" : "Pages Not Founded!",
    });
  } catch (err) {
    logger.error("customerContentController.pageList failed:", err);
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
      const device = await prisma.tbl_user_device.findFirst({ where: { uid, is_active: true }, orderBy: { last_login_at: "desc" } });
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
      isHowUse: 1,
    };

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Home Data Get Successfully!", ResultData: resultData });
  } catch (err) {
    logger.error("customerContentController.homeData failed:", err);
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
};
