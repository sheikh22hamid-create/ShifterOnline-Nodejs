const prisma = require("../config/db");
const adminSocket = require("../sockets/adminSocket");
const logger = require("../utils/logger");
const { uniqueRefferCode } = require("./riderAuthController");
const { parseInfoSections } = require("../services/driverTierInfo");

/**
 * Dummy/seed rider accounts recognizable by naming convention
 * (vehicle_no "TEST...", mobile "99999..."), annotated with what they're
 * actually eligible to receive — so picking one in the simulator doesn't
 * silently fail the way an un-enabled rider would.
 */
async function listTestDrivers(req, res) {
  // Exposes rider phone numbers and live GPS coordinates with no auth,
  // gated only by a vehicle_no/mobile-prefix heuristic. Deliberately left
  // reachable in every environment, including production, per explicit
  // product decision (2026-08-26) — see memory/order_dispatch_auth_gap.md.
  try {
    const riders = await prisma.tbl_rider.findMany({
      where: {
        OR: [{ vehicle_no: { startsWith: "TEST" } }, { fmobile: { startsWith: "99999" } }],
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        fmobile: true,
        vehicle: true,
        vehicle_no: true,
        a_status: true,
        status: true,
        rlats: true,
        rlongs: true,
      },
      orderBy: { id: "asc" },
    });

    const riderIds = riders.map((r) => r.id);
    const deliveryTypes = await prisma.tbl_rider_delivery_type.findMany({
      where: { rider_id: { in: riderIds }, status: 1 },
    });
    const packageIds = [...new Set(deliveryTypes.map((d) => Number(d.delivery_type)))];
    const packages = await prisma.tbl_package.findMany({
      where: { id: { in: packageIds } },
      select: { id: true, title: true, cat_id: true },
    });
    const packageById = Object.fromEntries(packages.map((p) => [p.id, p]));
    const categories = await prisma.pkg_category.findMany({
      where: { cat_status: 1 },
      select: { id: true, cat_name: true },
    });
    const categoryNameById = Object.fromEntries(categories.map((c) => [c.id, c.cat_name]));

    const enabledByRider = {};
    for (const d of deliveryTypes) {
      const pkg = packageById[Number(d.delivery_type)];
      if (!pkg) continue;
      if (!enabledByRider[d.rider_id]) enabledByRider[d.rider_id] = [];
      enabledByRider[d.rider_id].push({
        package_id: pkg.id,
        title: pkg.title,
        category: categoryNameById[pkg.cat_id] || null,
      });
    }

    const drivers = riders.map((r) => ({
      id: r.id,
      name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || null,
      mobile: r.fmobile,
      vehicle: r.vehicle,
      vehicle_no: r.vehicle_no,
      online: r.a_status === 1,
      approved: r.status === 1,
      lat: r.rlats,
      lng: r.rlongs,
      enabled_packages: enabledByRider[r.id] || [],
    }));

    return res.status(200).json({ Result: true, drivers });
  } catch (err) {
    logger.error("listTestDrivers failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

/** Every package tier for this rider's vehicle category, flagged with whether the rider is currently enabled for it. */
async function getDeliveryTypes(req, res) {
  try {
    const riderId = Number(req.params.riderId);
    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { vehicle: true } });
    if (!rider) {
      return res.status(404).json({ Result: false, msg: "Rider not found" });
    }

    const category = await prisma.pkg_category.findFirst({ where: { cat_name: rider.vehicle, cat_status: 1 } });
    if (!category) {
      return res.status(200).json({ Result: true, vehicle: rider.vehicle, packages: [] });
    }

    const packages = await prisma.tbl_package.findMany({
      where: { cat_id: category.id, status: 1 },
      orderBy: { sort_order: "asc" },
      select: { id: true, title: true },
    });

    const enabledRows = await prisma.tbl_rider_delivery_type.findMany({
      where: { rider_id: riderId, delivery_type: { in: packages.map((p) => String(p.id)) }, status: 1 },
    });
    const enabledPackageIds = new Set(enabledRows.map((r) => Number(r.delivery_type)));

    return res.status(200).json({
      Result: true,
      vehicle: rider.vehicle,
      packages: packages.map((p) => ({ package_id: p.id, title: p.title, enabled: enabledPackageIds.has(p.id) })),
    });
  } catch (err) {
    logger.error("getDeliveryTypes failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

// Node port of cust_api/packagelist.php's type==="DRIVER" branch only (the
// customer branch - geofence/night-charge/plan-discount pricing display -
// lives in orderController.fareEstimate instead; this is just the driver
// home screen's simple delivery-type toggle list, which only ever reads
// id/title/driver_detail_image/driver_active - see HomeFragment.createPackageRow).
// Same vehicle->category lookup as getDeliveryTypes above, kept as its own
// endpoint since the response shape (PackageData array) and calling
// convention (POST body with uid, not a path param) are both different.
async function packageListForDriver(req, res) {
  try {
    const riderId = Number(req.body?.uid || 0);
    if (!riderId) return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "uid and cat_id required" });

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { vehicle: true } });
    if (!rider) return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Rider not found" });

    const category = await prisma.pkg_category.findFirst({ where: { cat_name: rider.vehicle, cat_status: 1 } });
    if (!category) {
      return res.status(200).json({ PackageData: [], ResponseCode: "200", Result: "true", ResponseMsg: "Package List By Category Get Successfully!!" });
    }

    const packages = await prisma.tbl_package.findMany({
      where: { cat_id: category.id, status: 1 },
      orderBy: { sort_order: "asc" },
      select: {
        id: true,
        title: true,
        user_title: true,
        driver_title: true,
        driver_detail_image: true,
        user_detail_image: true,
        per_km_charge: true,
        min_charge: true,
        driver_card_subtitle: true,
        driver_info_subtitle: true,
        driver_info_sections: true,
      },
    });

    const enabledRows = await prisma.tbl_rider_delivery_type.findMany({
      where: { rider_id: riderId, delivery_type: { in: packages.map((p) => String(p.id)) }, status: 1 },
    });
    const enabledPackageIds = new Set(enabledRows.map((r) => Number(r.delivery_type)));

    const packageData = packages.map((p) => ({
      id: String(p.id),
      title: p.driver_title || p.title || "",       // driver_title has priority (e.g. "Standard Tier" over "Model 1")
      driver_title: p.driver_title || p.title || "", // also exposed separately for Android PackageData model
      user_title: p.user_title || p.title || "",
      driver_card_subtitle: p.driver_card_subtitle || "",
      driver_info_subtitle: p.driver_info_subtitle || "",
      driver_info_sections: parseInfoSections(p.driver_info_sections),
      driver_detail_image: p.driver_detail_image || p.user_detail_image || "",
      user_detail_image: p.user_detail_image || "",
      per_km_charge: p.per_km_charge != null ? String(p.per_km_charge) : "0",
      min_charge: p.min_charge != null ? String(p.min_charge) : "0",
      rate: p.per_km_charge != null ? String(p.per_km_charge) : "0",
      km: p.per_km_charge != null ? String(p.per_km_charge) : "0",
      driver_active: enabledPackageIds.has(p.id) ? "1" : "0",
      status: enabledPackageIds.has(p.id) ? "1" : "0",
    }));

    return res.status(200).json({
      PackageData: packageData,
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Package List By Category Get Successfully!!",
    });
  } catch (err) {
    logger.error("packageListForDriver failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

/** Toggles one rider's eligibility for one package tier (creates the tbl_rider_delivery_type row if it doesn't exist yet). */
async function setDeliveryType(req, res) {
  try {
    const { rider_id, package_id, enabled } = req.body;
    if (!rider_id || !package_id || typeof enabled !== "boolean") {
      return res.status(400).json({ Result: false, msg: "rider_id, package_id and enabled (boolean) are required" });
    }

    const riderId = Number(rider_id);
    const deliveryType = String(package_id);
    const status = enabled ? 1 : 0;

    const existing = await prisma.tbl_rider_delivery_type.findFirst({
      where: { rider_id: riderId, delivery_type: deliveryType },
    });

    if (existing) {
      await prisma.tbl_rider_delivery_type.update({ where: { id: existing.id }, data: { status } });
    } else {
      await prisma.tbl_rider_delivery_type.create({ data: { rider_id: riderId, delivery_type: deliveryType, status } });
    }

    return res.status(200).json({ Result: true, msg: "Updated" });
  } catch (err) {
    logger.error("setDeliveryType failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

async function setStatus(req, res) {
  try {
    const { rider_id, a_status, device_id } = req.body;
    if (!rider_id || ![0, 1].includes(Number(a_status))) {
      return res.status(400).json({ Result: false, msg: "rider_id and a_status (0 or 1) are required" });
    }

    // Preserve last known coordinates (rlats/rlongs) so Admin Live Fleet Radar
    // can display the driver's last seen position with an offline marker.
    // Dispatch safety is guaranteed by `WHERE r.a_status = 1 AND r.rloc_updated_at >= freshSince`.
    const updated = await prisma.tbl_rider.update({
      where: { id: Number(rider_id) },
      data: { a_status: Number(a_status) },
      select: { id: true, city_id: true, a_status: true, status: true, rlats: true, rlongs: true, rloc_updated_at: true },
    });

    adminSocket.notifyDriverStatusUpdate(updated.id, updated.city_id, {
      a_status: updated.a_status,
      online: updated.a_status === 1,
      status: updated.status,
      lat: updated.rlats ? Number(updated.rlats) : null,
      lng: updated.rlongs ? Number(updated.rlongs) : null,
      rloc_updated_at: updated.rloc_updated_at,
    });

    // Same multi-device-login kickout check driverContentController.homeData
    // does - the PHP rider_status.php this replaces did this on every
    // online/offline toggle, not just on app-open, so a driver logged in
    // elsewhere gets caught sooner rather than only on next app reopen.
    let deviceMatch = true;
    if (device_id) {
      // is_active straight in the WHERE, not "latest by id" - a device that
      // logged in long ago but was reactivated today keeps its old (lower)
      // id, so ordering by id desc can surface a newer-but-since-logged-out
      // device instead of the actually active one (see memory/device_match_query_bug.md).
      const device = await prisma.tbl_user_device.findFirst({ where: { uid: Number(rider_id), user_type: "rider", is_active: true }, orderBy: { last_login_at: "desc" } });
      deviceMatch = !!(device && device.device_id === device_id);
    }

    return res.status(200).json({ Result: true, msg: "Status updated", device_match: deviceMatch });
  } catch (err) {
    logger.error("riderController.setStatus failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

const dutyTrackingService = require("../services/dutyTrackingService");

/** REST fallback for clients that can't hold a live socket for location updates. */
async function updateLocation(req, res) {
  try {
    const { rider_id, lat, lng, device_id } = req.body;
    if (!rider_id || lat === undefined || lng === undefined) {
      return res.status(400).json({ Result: false, msg: "rider_id, lat and lng are required" });
    }

    const updated = await prisma.tbl_rider.update({
      where: { id: Number(rider_id) },
      data: { rlats: String(lat), rlongs: String(lng), rloc_updated_at: new Date() },
      select: { id: true, city_id: true },
    });

    adminSocket.notifyLiveDriverPing(Number(rider_id), updated.city_id, Number(lat), Number(lng));

    // Track monthly driver duty hours & in-zone minutes
    dutyTrackingService.recordDutyLocationPing(Number(rider_id), Number(lat), Number(lng)).catch((err) => {
      logger.error(`dutyTrackingService.recordDutyLocationPing error for rider ${rider_id}:`, err);
    });

    // Same multi-device-login kickout check as setStatus/homeData - this
    // fires far more often than either (continuous background pings while
    // online), so it's actually the most reliable place to catch a driver
    // logged in elsewhere.
    let deviceMatch = true;
    if (device_id) {
      const device = await prisma.tbl_user_device.findFirst({ where: { uid: Number(rider_id), user_type: "rider", is_active: true }, orderBy: { last_login_at: "desc" } });
      deviceMatch = !!(device && device.device_id === device_id);
    }

    return res.status(200).json({ Result: true, msg: "Location updated", device_match: deviceMatch });
  } catch (err) {
    logger.error("riderController.updateLocation failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

/** Turn offline all test bike riders except the ones specified in keep_ids */
async function isolateTestDrivers(req, res) {
  try {
    const keepIds = (req.body.keep_ids || []).map(Number).filter((n) => !isNaN(n) && n > 0);
    await prisma.tbl_rider.updateMany({
      where: {
        vehicle: "Bike",
        ...(keepIds.length > 0 ? { id: { notIn: keepIds } } : {}),
      },
      data: { a_status: 0 },
    });
    return res.status(200).json({ Result: true, msg: "Extra dummy drivers turned offline", kept: keepIds });
  } catch (err) {
    logger.error("riderController.isolateTestDrivers failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

/** Get full driver profile */
async function getProfile(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || req.query?.rider_id || req.params?.riderId || 0);
    if (!riderId) return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Driver ID is required" });

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) return res.status(200).json({ Result: "false", ResponseCode: "404", ResponseMsg: "Driver not found" });

    // Auto-generate referral code if not already present
    let refferCode = rider.reffer_code || rider.referral_code;
    if (!refferCode) {
      refferCode = await uniqueRefferCode(rider.full_name || "RID");
      await prisma.tbl_rider.update({
        where: { id: riderId },
        data: { reffer_code: refferCode, referral_code: refferCode },
      }).catch((e) => logger.error("getProfile: failed to persist reffer_code:", e));
      rider.reffer_code = refferCode;
      rider.referral_code = refferCode;
    }

    // Auto-sync any pending referral rewards for this driver (e.g. if referred driver completed first order)
    try {
      const referralRewardService = require("../services/referralRewardService");
      await referralRewardService.syncPendingReferralRewardsForDriver(riderId);
      const refreshed = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { referral_points: true } });
      if (refreshed) {
        rider.referral_points = refreshed.referral_points;
      }
    } catch (syncErr) {
      logger.error("getProfile: syncPendingReferralRewardsForDriver error:", syncErr);
    }

    return res.status(200).json({
      Result: "true",
      ResponseCode: "200",
      ResponseMsg: "Profile fetched successfully",
      rider_data: {
        ...rider,
        reffer_code: refferCode,
        referral_code: refferCode,
        mobile: rider.fmobile,
        fmobile: rider.fmobile,
        dob: rider.dob || "",
        nationality: rider.nationality || "Indian",
        full_address: rider.full_address || "",
        know_language: rider.know_language || "Hindi, English",
        vehicle_no: rider.vehicle_no || "",
        wallet_balance: rider.wallet_balance?.toString?.() ?? rider.wallet_balance,
        payment_complete: Number(rider.payment_complete) === 1 ? 1 : 0,
      },
    });
  } catch (err) {
    logger.error("riderController.getProfile failed:", err);
    return res.status(200).json({ Result: "false", ResponseCode: "500", ResponseMsg: "Internal server error" });
  }
}

/** Update editable driver profile fields */
async function updateProfile(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || 0);
    if (!riderId) return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Driver ID is required" });

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) return res.status(200).json({ Result: "false", ResponseCode: "404", ResponseMsg: "Driver not found" });

    const data = {};
    if (req.body.full_name !== undefined) data.full_name = String(req.body.full_name).trim();
    if (req.body.email !== undefined) data.email = String(req.body.email).trim();
    if (req.body.dob !== undefined) data.dob = String(req.body.dob).trim();
    if (req.body.nationality !== undefined) data.nationality = String(req.body.nationality).trim();
    if (req.body.full_address !== undefined) data.full_address = String(req.body.full_address).trim();
    if (req.body.know_language !== undefined) data.know_language = String(req.body.know_language).trim();
    if (req.body.vehicle_no !== undefined) data.vehicle_no = String(req.body.vehicle_no).trim();

    const updated = Object.keys(data).length ? await prisma.tbl_rider.update({ where: { id: riderId }, data }) : rider;

    return res.status(200).json({
      Result: "true",
      ResponseCode: "200",
      ResponseMsg: "Profile updated successfully!",
      rider_data: {
        ...updated,
        reffer_code: updated.reffer_code || updated.referral_code || "",
        referral_code: updated.referral_code || updated.reffer_code || "",
        mobile: updated.fmobile,
        fmobile: updated.fmobile,
        dob: updated.dob || "",
        nationality: updated.nationality || "Indian",
        full_address: updated.full_address || "",
        know_language: updated.know_language || "Hindi, English",
        vehicle_no: updated.vehicle_no || "",
        wallet_balance: updated.wallet_balance?.toString?.() ?? updated.wallet_balance,
        payment_complete: Number(updated.payment_complete) === 1 ? 1 : 0,
      },
    });
  } catch (err) {
    logger.error("riderController.updateProfile failed:", err);
    return res.status(200).json({ Result: "false", ResponseCode: "500", ResponseMsg: "Internal server error" });
  }
}

/** Check if referral code is valid in real time */
async function checkReferral(req, res) {
  try {
    const refCodeRaw = req.body?.referral_code || req.body?.refferal_code || req.body?.reffer_code || req.query?.code || "";
    const refferalCode = String(refCodeRaw).trim().toUpperCase();
    if (!refferalCode) {
      return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Referral code is required." });
    }

    const refRider = await prisma.tbl_rider.findFirst({
      where: { OR: [{ reffer_code: refferalCode }, { referral_code: refferalCode }, { refferal_code: refferalCode }] },
      select: { id: true, full_name: true },
    });
    if (refRider) {
      return res.status(200).json({
        Result: "true",
        ResponseCode: "200",
        ResponseMsg: `Valid Driver referral code (${refRider.full_name || "Driver Partner"})`,
        referrer_name: refRider.full_name || "Driver Partner",
        referrer_type: "DRIVER",
      });
    }

    const refUser = await prisma.tbl_user.findFirst({
      where: { OR: [{ reffer_code: refferalCode }, { referral_code: refferalCode }, { refferal_code: refferalCode }] },
      select: { id: true, name: true },
    });
    if (refUser) {
      return res.status(200).json({
        Result: "true",
        ResponseCode: "200",
        ResponseMsg: `Valid Customer referral code (${refUser.name || "Customer"})`,
        referrer_name: refUser.name || "Customer",
        referrer_type: "USER",
      });
    }

    return res.status(200).json({ Result: "false", ResponseCode: "404", ResponseMsg: "Invalid Referral Code!" });
  } catch (err) {
    logger.error("riderController.checkReferral failed:", err);
    return res.status(200).json({ Result: "false", ResponseCode: "500", ResponseMsg: "Internal server error" });
  }
}

/** Apply referral code for an active driver account */
async function applyReferral(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || req.body?.rid || 0);
    const refCodeRaw = req.body?.referral_code || req.body?.refferal_code || req.body?.reffer_code || "";
    const refferalCode = String(refCodeRaw).trim().toUpperCase();

    if (!riderId) return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Driver ID is required." });
    if (!refferalCode) return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Please enter a valid referral code." });

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) return res.status(200).json({ Result: "false", ResponseCode: "404", ResponseMsg: "Driver not found." });

    // Cannot apply own referral code
    const ownCode = (rider.reffer_code || rider.referral_code || "").toUpperCase();
    if (ownCode && ownCode === refferalCode) {
      return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "You cannot apply your own referral code!" });
    }

    // Check if referral is already applied
    if (rider.referred_by && Number(rider.referred_by) > 0) {
      return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Referral code already applied for this account." });
    }
    const existingRef = await prisma.tbl_referral.findFirst({
      where: { referred_id: riderId, referred_type: "DRIVER" },
    });
    if (existingRef) {
      return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Referral code already applied for this account." });
    }

    // Lookup referrer
    let referrerId = 0;
    let referrerType = "DRIVER";
    const refRider = await prisma.tbl_rider.findFirst({
      where: { OR: [{ reffer_code: refferalCode }, { referral_code: refferalCode }, { refferal_code: refferalCode }] },
    });
    if (refRider) {
      if (refRider.id === riderId) {
        return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "You cannot apply your own referral code!" });
      }
      referrerId = refRider.id;
      referrerType = "DRIVER";
    } else {
      const refUser = await prisma.tbl_user.findFirst({
        where: { OR: [{ reffer_code: refferalCode }, { referral_code: refferalCode }, { refferal_code: refferalCode }] },
      });
      if (refUser) {
        referrerId = refUser.id;
        referrerType = "USER";
      } else {
        return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Invalid Referral Code! Please check and try again." });
      }
    }

    // Create referral log
    const now = new Date();
    await prisma.tbl_referral.create({
      data: {
        referrer_id: referrerId,
        referrer_type: referrerType,
        referred_id: riderId,
        referred_type: "DRIVER",
        referral_code: refferalCode,
        status: "pending",
        points_awarded: 0,
        ride_id: 0,
        registered_at: now,
      },
    });

    await prisma.tbl_rider.update({
      where: { id: riderId },
      data: {
        referred_by: referrerId,
        referred_by_type: referrerType,
        refer_by: referrerId,
        refferal_code: refferalCode,
      },
    });

    return res.status(200).json({
      Result: "true",
      ResponseCode: "200",
      ResponseMsg: "Referral code applied successfully!",
      referral_code: refferalCode,
    });
  } catch (err) {
    logger.error("riderController.applyReferral failed:", err);
    return res.status(200).json({ Result: "false", ResponseCode: "500", ResponseMsg: "Internal server error" });
  }
}

/** Explicitly claim / sync pending referral reward for a driver */
async function claimReferralReward(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || req.body?.rid || req.query?.rider_id || 0);
    if (!riderId) return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Driver ID is required" });

    const referralRewardService = require("../services/referralRewardService");
    const result = await referralRewardService.syncPendingReferralRewardsForDriver(riderId);

    const rider = await prisma.tbl_rider.findUnique({
      where: { id: riderId },
      select: { id: true, full_name: true, fmobile: true, referral_points: true, refer_by: true, referred_by: true },
    });

    return res.status(200).json({
      Result: "true",
      ResponseCode: "200",
      ResponseMsg: "Referral reward sync completed successfully",
      data: {
        rider_id: riderId,
        awarded_to_this_driver: result.awardedToThisDriver || 0,
        awarded_to_referrer: result.awardedToReferrer || 0,
        current_referral_points: rider?.referral_points || 0,
      },
    });
  } catch (err) {
    logger.error("riderController.claimReferralReward failed:", err);
    return res.status(200).json({ Result: "false", ResponseCode: "500", ResponseMsg: "Internal server error" });
  }
}

module.exports = {
  listTestDrivers,
  getDeliveryTypes,
  setDeliveryType,
  packageListForDriver,
  setStatus,
  updateLocation,
  isolateTestDrivers,
  getProfile,
  updateProfile,
  checkReferral,
  applyReferral,
  claimReferralReward,
};
