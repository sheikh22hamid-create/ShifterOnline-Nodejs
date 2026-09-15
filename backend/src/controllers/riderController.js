const prisma = require("../config/db");
const adminSocket = require("../sockets/adminSocket");
const logger = require("../utils/logger");

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
      select: { id: true, title: true, driver_title: true, driver_detail_image: true },
    });

    const enabledRows = await prisma.tbl_rider_delivery_type.findMany({
      where: { rider_id: riderId, delivery_type: { in: packages.map((p) => String(p.id)) }, status: 1 },
    });
    const enabledPackageIds = new Set(enabledRows.map((r) => Number(r.delivery_type)));

    const packageData = packages.map((p) => ({
      id: String(p.id),
      title: p.driver_title || p.title,
      driver_detail_image: p.driver_detail_image || "",
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

    const updated = await prisma.tbl_rider.update({
      where: { id: Number(rider_id) },
      data: { a_status: Number(a_status) },
      select: { id: true, city_id: true, a_status: true, status: true },
    });

    adminSocket.notifyDriverStatusUpdate(updated.id, updated.city_id, {
      a_status: updated.a_status,
      online: updated.a_status === 1,
      status: updated.status,
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
      const device = await prisma.tbl_user_device.findFirst({ where: { uid: Number(rider_id), is_active: true }, orderBy: { last_login_at: "desc" } });
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
      data: { rlats: String(lat), rlongs: String(lng) },
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
      const device = await prisma.tbl_user_device.findFirst({ where: { uid: Number(rider_id), is_active: true }, orderBy: { last_login_at: "desc" } });
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

module.exports = { listTestDrivers, getDeliveryTypes, setDeliveryType, packageListForDriver, setStatus, updateLocation, isolateTestDrivers };
