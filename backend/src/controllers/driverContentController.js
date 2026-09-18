const multer = require("multer");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { uploadBuffer } = require("../utils/cloudinaryStorage");
const { formatPkgOrderForDriver } = require("./driverOrderHistoryController");
const { formatBuyOrderForDriver } = require("./legacyOrderController");

// Node port of several rider_api/*.php endpoints confirmed still called by
// the native Android driver app (ShifterDriver/app/src/main/java/.../UserService.java):
// home_data.php, citylist.php, country_code.php, pagelist.php,
// notification_list.php, eme_contact.php, is_bicyle.php,
// get_registration_settings.php, get_joining_plan.php, kit_details.php.

function fail(res, msg, code = 401) {
  return res.status(200).json({ ResponseCode: String(code), Result: "false", ResponseMsg: msg });
}

// --- home_data.php (driver dashboard: today/month order count + earnings, wallet, referral) ---
async function homeData(req, res) {
  try {
    const rid = Number(req.body?.rid || 0);
    const deviceId = String(req.body?.device_id || "");
    if (!rid) return fail(res, "Something Went Wrong!");

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    async function pkgStats(from, to) {
      const rows = await prisma.$queryRaw`
        SELECT COUNT(*) AS total_order,
          IFNULL(ROUND(SUM(
            CASE
              WHEN COALESCE(driver_earning, 0) > 0 THEN driver_earning
              WHEN COALESCE(total_dcharge, 0) > 0 THEN (total_dcharge - (total_dcharge * COALESCE(commission, 0) / 100))
              ELSE (COALESCE(d_charge, 0) - (COALESCE(d_charge, 0) * COALESCE(commission, 0) / 100)) + COALESCE(extra_mile_charge, 0)
            END
          ), 2), 0) AS earning
        FROM pkg_order
        WHERE rid = ${rid}
          AND (LOWER(TRIM(o_status)) = 'completed' OR order_status = 4 OR order_status = 5)
          AND COALESCE(ddate, odate) BETWEEN ${from} AND ${to}
      `;
      return rows[0] || { total_order: 0, earning: 0 };
    }

    async function buyStats(from, to) {
      const rows = await prisma.$queryRaw`
        SELECT COUNT(*) AS total_order,
          IFNULL(ROUND(SUM(
            (COALESCE(d_charge, 0) - (COALESCE(d_charge, 0) * COALESCE(commission, 0) / 100)) + COALESCE(extra_mile_charge, 0) + COALESCE(item_total, 0)
          ), 2), 0) AS earning
        FROM buy_order
        WHERE rid = ${rid}
          AND (LOWER(TRIM(o_status)) = 'completed' OR flow_id = 4 OR flow_id = 5)
          AND order_date BETWEEN ${from} AND ${to}
      `;
      return rows[0] || { total_order: 0, earning: 0 };
    }

    const [pkgToday, buyToday, pkgMonth, buyMonth] = await Promise.all([
      pkgStats(todayStart, todayEnd),
      buyStats(todayStart, todayEnd),
      pkgStats(monthStart, monthEnd),
      buyStats(monthStart, monthEnd),
    ]);

    const todayOrder = Number(pkgToday.total_order || 0) + Number(buyToday.total_order || 0);
    const todayEarning = Number(pkgToday.earning || 0) + Number(buyToday.earning || 0);
    const monthOrder = Number(pkgMonth.total_order || 0) + Number(buyMonth.total_order || 0);
    const monthEarning = Number(pkgMonth.earning || 0) + Number(buyMonth.earning || 0);

    const setting = await prisma.setting.findFirst({ select: { reject_timer: true, rider_commission: true } });
    const rider = await prisma.tbl_rider.findUnique({ where: { id: rid } });
    if (!rider) return fail(res, "Something Went Wrong!");

    let deviceMatch = false;
    if (deviceId) {
      // is_active straight in the WHERE, not "latest by id" - see
      // memory/device_match_query_bug.md for why ordering by id is wrong here.
      const device = await prisma.tbl_user_device.findFirst({ where: { uid: rid, user_type: "rider", is_active: true }, orderBy: { last_login_at: "desc" } });
      deviceMatch = !!(device && device.device_id === deviceId);
    }

    // Active order (if any) - drives the driver app's auto-navigate-back-into
    // OrderDetailsActivity behavior on app open/reopen. Reuses the same
    // row-formatters pkg_history.php/buy_order_list.php's Node ports use so
    // the pricing math (which has fixed real production bugs - see
    // driverOrderHistoryController.js header) isn't re-derived here.
    let activeOrderHistory = null;
    const activePkgOrder = await prisma.$queryRaw`
      SELECT * FROM pkg_order WHERE rid = ${rid} AND o_status NOT IN ('Completed', 'Cancelled') ORDER BY id DESC LIMIT 1
    `;
    if (activePkgOrder.length) {
      const row = activePkgOrder[0];
      const orderId = Number(row.id);
      const stops = await prisma.pkg_order_stops.findMany({ where: { order_id: orderId }, orderBy: { sequence: "asc" } });
      const stopsByOrder = {
        [orderId]: stops.map((s) => ({
          sequence: s.sequence,
          lat: s.lat,
          lng: s.lng,
          address: s.address,
          hno: s.hno,
          landmark: s.landmark,
          contact_name: s.contact_name,
          contact_number: s.contact_number,
        })),
      };
      activeOrderHistory = formatPkgOrderForDriver(row, {
        stopsByOrder,
        benefitByOrder: {}, // active orders are never "Completed" yet, so the benefit lookup formatPkgOrderForDriver does is a no-op anyway
        planNameCache: {},
        globalComm: Number(setting?.rider_commission ?? 10),
      });
    }

    let activeBuyOrderHistory = null;
    const activeBuyOrder = await prisma.buy_order.findFirst({
      where: { rid, NOT: [{ o_status: "Completed" }, { o_status: "Cancelled" }] },
      orderBy: { id: "desc" },
    });
    if (activeBuyOrder) {
      const buyer = await prisma.tbl_user.findUnique({ where: { id: activeBuyOrder.uid }, select: { mobile: true } }).catch(() => null);
      activeBuyOrderHistory = formatBuyOrderForDriver(activeBuyOrder, buyer?.mobile ?? null);
    }

    const referralCode = rider.reffer_code || rider.referral_code || "";
    const todayOrderStr = String(todayOrder);
    const todayEarningStr = todayEarning.toFixed(2);
    const monthOrderStr = String(monthOrder);
    const monthEarningStr = monthEarning.toFixed(2);
    const walletStr = Number(rider.wallet_balance || 0).toFixed(2);

    return res.status(200).json({
      today_order: todayOrderStr,
      today_orders: todayOrderStr,
      today_completed: todayOrderStr,
      today_complete: todayOrderStr,
      today_ride: todayOrderStr,
      today_rides: todayOrderStr,
      tot_order: todayOrderStr,
      total_order: todayOrderStr,
      today_earning: todayEarningStr,
      today_earnings: todayEarningStr,
      today_income: todayEarningStr,
      tot_earning: todayEarningStr,
      total_earning: todayEarningStr,
      month_order: monthOrderStr,
      month_orders: monthOrderStr,
      month_completed: monthOrderStr,
      month_complete: monthOrderStr,
      month_ride: monthOrderStr,
      month_rides: monthOrderStr,
      monthly_order: monthOrderStr,
      monthly_completed: monthOrderStr,
      month_earning: monthEarningStr,
      month_earnings: monthEarningStr,
      monthly_earning: monthEarningStr,
      month_income: monthEarningStr,
      wallet: walletStr,
      wallet_balance: walletStr,
      reject_timer: String(setting?.reject_timer ?? 15),
      device_match: deviceMatch,
      isHowUse: 1,
      Online: rider.a_status === 1,
      OrderHistory: activeOrderHistory,
      BuyOrderHistory: activeBuyOrderHistory,
      referral_code: referralCode,
      referral_points: rider.referral_points || 0,
      referral_msg: "Hey! Use my referral code to sign up on Shifter Online and earn exciting rewards!",
      report_data: { today_order: todayOrderStr, today_earning: todayEarningStr, month_order: monthOrderStr, month_earning: monthEarningStr, wallet: walletStr },
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Data Get Successfully!!",
    });
  } catch (err) {
    logger.error("driverContentController.homeData failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- citylist.php ---
async function cityList(req, res) {
  try {
    const rows = await prisma.tbl_city.findMany({ where: { status: 1 } });
    return res.status(200).json({ CityList: rows, ResponseCode: "200", Result: "true", ResponseMsg: "City List Founded!" });
  } catch (err) {
    logger.error("driverContentController.cityList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- country_code.php ---
async function countryCodeList(req, res) {
  try {
    const rows = await prisma.tbl_code.findMany();
    return res.status(200).json({ CountryCode: rows, ResponseCode: "200", Result: "true", ResponseMsg: "Country Code List Founded!" });
  } catch (err) {
    logger.error("driverContentController.countryCodeList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- pagelist.php ---
async function pageList(req, res) {
  try {
    const rid = Number(req.body?.rid || 0);
    const rows = await prisma.tbl_page.findMany({ where: { status: 1 } });
    const list = rows.map((r) => ({ title: r.title, description: r.description }));
    if (!list.length) return res.status(200).json({ pagelist: [], ResponseCode: "200", Result: "false", ResponseMsg: "Pages Not Founded!" });

    const rider = rid ? await prisma.tbl_rider.findUnique({ where: { id: rid } }) : null;
    return res.status(200).json({
      pagelist: list,
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Pages List Founded!",
      referral_code: rider?.reffer_code || "",
      referral_msg: "Hey! Use my referral code to sign up on Shifter Online and earn exciting rewards!",
    });
  } catch (err) {
    logger.error("driverContentController.pageList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- notification_list.php --- (tbl_rnoti - driver's own notification table, distinct from customer's tbl_notification)
async function notificationList(req, res) {
  try {
    const rid = Number(req.body?.rid || 0);
    if (!rid) return fail(res, "Something Went Wrong!");

    const rows = await prisma.tbl_rnoti.findMany({ where: { rid }, orderBy: { id: "desc" } });
    // Android app expects "yyyy-MM-dd HH:mm:ss" (legacy PHP format), not the ISO string
    // JSON.stringify would produce from the native Prisma DateTime.
    const notificationData = rows.map((r) => ({
      ...r,
      date: r.date ? r.date.toISOString().slice(0, 19).replace("T", " ") : r.date,
    }));
    return res.status(200).json({ NotificationData: notificationData, ResponseCode: "200", Result: "true", ResponseMsg: "Notification List Get Successfully!!" });
  } catch (err) {
    logger.error("driverContentController.notificationList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- eme_contact.php ---
async function saveEmergencyContact(req, res) {
  try {
    const b = req.body || {};
    const name = b.name;
    const relation = b.relation;
    const mobile = b.mobile;
    const riderId = Number(b.rider_id || 0);
    if (!name || !relation || !mobile || !riderId) return fail(res, "Something Went Wrong!");

    const existing = await prisma.tbl_eme_contact.findFirst({ where: { rider_id: riderId } });
    if (existing) {
      await prisma.tbl_eme_contact.update({ where: { id: existing.id }, data: { name, relation, mobile, status: 0 } });
      return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Emergency Details Update Successfully!!" });
    }
    await prisma.tbl_eme_contact.create({ data: { rider_id: riderId, name, relation, mobile } });
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Emergency Details Add Successfully!!" });
  } catch (err) {
    logger.error("driverContentController.saveEmergencyContact failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- is_bicyle.php ---
async function setIsBicycle(req, res) {
  try {
    const isBicycle = req.body?.is_bycle;
    const riderId = Number(req.body?.rider_id || 0);
    if (isBicycle === undefined || isBicycle === "" || !riderId) return fail(res, "Something Went Wrong!");

    const existing = await prisma.tbl_personal_doc.findFirst({ where: { rider_id: riderId } });
    if (existing) {
      await prisma.tbl_personal_doc.update({ where: { id: existing.id }, data: { is_bycle: Number(isBicycle) } });
      return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Option Details Update Successfully!!" });
    }
    await prisma.tbl_personal_doc.create({ data: { rider_id: riderId, is_bycle: Number(isBicycle) } });
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Option Details Add Successfully!!" });
  } catch (err) {
    logger.error("driverContentController.setIsBicycle failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- get_registration_settings.php ---
async function registrationSettings(req, res) {
  try {
    // The app only ever knows the driver's mobile at this point (rider_id
    // doesn't exist yet for a brand-new registration, and isn't looked up
    // for a returning one) - resolve by mobile first. `rid` is kept as a
    // fallback for any other caller that already has the numeric id.
    const mobile = String(req.body?.mobile || "").trim();
    const rid = Number(req.body?.rid || 0);
    const rows = await prisma.app_settings.findMany();
    const rawMap = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    const num = (k, def = 0) => {
      const v = Number(rawMap[k]);
      return Number.isFinite(v) ? v : def;
    };

    let pendingPayment = false;
    const rider = mobile
      ? await prisma.tbl_rider.findFirst({ where: { fmobile: mobile }, select: { payment_complete: true } })
      : rid
        ? await prisma.tbl_rider.findUnique({ where: { id: rid }, select: { payment_complete: true } })
        : null;
    if (rider) pendingPayment = Number(rider.payment_complete) !== 1;

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Success",
      manual_registration: num("manual_registration", 0),
      auto_verification_msg: rawMap.auto_verification_msg || "",
      auto_verification_charge: num("auto_verification_charge", 0),
      auto_verification_charge_old: num("auto_verification_charge_old", 0),
      pending_payment: pendingPayment,
      auto_verification: num("auto_verification", 0),
      digilocker_verification: num("digilocker_verification", 0),
    });
  } catch (err) {
    logger.error("driverContentController.registrationSettings failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- get_joining_plan.php ---
async function joiningPlan(req, res) {
  try {
    const plan = await prisma.tbl_joining_plan.findUnique({ where: { id: 1 } });
    if (!plan) return res.status(200).json({ ResponseCode: "404", Result: "false", ResponseMsg: "No Joining Plan Found!" });

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Joining Plan Loaded!",
      screen_show: plan.screen_show,
      title: plan.title,
      subtitle: plan.subtitle,
      description: plan.description,
      price: plan.price,
      discount_price: plan.discount_price,
      benefits: [plan.benefit_1, plan.benefit_2, plan.benefit_3, plan.benefit_4],
    });
  } catch (err) {
    logger.error("driverContentController.joiningPlan failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- kit_details.php --- (qu_answer=1 means "yes, has a kit" -> requires photo; otherwise just the answer)
const kitUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).any();

function saveKitDetailsHandler(req, res) {
  kitUpload(req, res, async (err) => {
    if (err) {
      logger.error("driverContentController.saveKitDetails upload failed:", err);
      return fail(res, err.message || "Upload failed", 400);
    }
    try {
      const b = req.body || {};
      const quAnswer = Number(b.qu_answer);
      const riderId = Number(b.rider_id || 0);
      if (!quAnswer || !riderId) return fail(res, "Something Went Wrong!");

      const existing = await prisma.tbl_kit.findFirst({ where: { rider_id: riderId } });
      const data = { qu_answer: quAnswer };

      if (quAnswer === 1) {
        const files = (req.files || []).filter((f) => /^image\d+$/.test(f.fieldname));
        if (!files.length) return fail(res, "Kit Image Sent Null Please Check!!");
        const paths = await Promise.all(
          files.map((file) => {
            const filename = `${Date.now()}${Math.floor(Math.random() * 1e6)}.jpg`;
            return uploadBuffer(file.buffer, `images/kit_img/${filename}`);
          })
        );
        data.img = paths.join("$;");
        data.kit_status = 0;
      }

      if (existing) {
        await prisma.tbl_kit.update({ where: { id: existing.id }, data });
      } else {
        await prisma.tbl_kit.create({ data: { rider_id: riderId, ...data } });
      }
      await prisma.tbl_rider.update({ where: { id: riderId }, data: { add_info: 1 } });

      return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: existing ? "Kit Details Update Successfully!!" : "Kit Details Add Successfully!!" });
    } catch (e) {
      logger.error("driverContentController.saveKitDetails failed:", e);
      return fail(res, "Internal server error", 500);
    }
  });
}

module.exports = {
  homeData,
  cityList,
  countryCodeList,
  pageList,
  notificationList,
  saveEmergencyContact,
  setIsBicycle,
  registrationSettings,
  joiningPlan,
  saveKitDetails: saveKitDetailsHandler,
};
