const prisma = require("../config/db");
const logger = require("../utils/logger");

/**
 * Dummy/seed rider accounts recognizable by naming convention
 * (vehicle_no "TEST...", mobile "99999..."), annotated with what they're
 * actually eligible to receive — so picking one in the simulator doesn't
 * silently fail the way an un-enabled rider would.
 */
async function listTestDrivers(req, res) {
  // Exposes rider phone numbers and live GPS coordinates with no auth,
  // gated only by a vehicle_no/mobile-prefix heuristic — fine for local
  // dev testing, never for a real deployment.
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ Result: false, msg: "Not found" });
  }

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

async function setStatus(req, res) {
  try {
    const { rider_id, a_status } = req.body;
    if (!rider_id || ![0, 1].includes(Number(a_status))) {
      return res.status(400).json({ Result: false, msg: "rider_id and a_status (0 or 1) are required" });
    }

    await prisma.tbl_rider.update({
      where: { id: Number(rider_id) },
      data: { a_status: Number(a_status) },
    });

    return res.status(200).json({ Result: true, msg: "Status updated" });
  } catch (err) {
    logger.error("riderController.setStatus failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

/** REST fallback for clients that can't hold a live socket for location updates. */
async function updateLocation(req, res) {
  try {
    const { rider_id, lat, lng } = req.body;
    if (!rider_id || lat === undefined || lng === undefined) {
      return res.status(400).json({ Result: false, msg: "rider_id, lat and lng are required" });
    }

    await prisma.tbl_rider.update({
      where: { id: Number(rider_id) },
      data: { rlats: String(lat), rlongs: String(lng) },
    });

    return res.status(200).json({ Result: true, msg: "Location updated" });
  } catch (err) {
    logger.error("riderController.updateLocation failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

module.exports = { listTestDrivers, setStatus, updateLocation };
