const prisma = require("../config/db");
const logger = require("../utils/logger");
const { isInsideZone } = require("../services/geofenceService");
const { SEARCH_RADIUS_KM } = require("../config/constants");

// Node port of cust_api/available_vehicles.php - THE endpoint every current
// order still depends on: ShifterOnline's select_vehicle.dart / home.dart
// call this (via the full legacy PHP URL hardcoded in config.dart, not
// nodeBaseUrl) to show vehicle options + starting price + ETA before a
// customer can even start booking. Unlike most of this migration, this one
// is not a dead/peripheral endpoint - it's on the hot path of every order.
//
// Rebuilt on the services the *live* dispatch flow already uses (not a
// blind port of the PHP's own logic), so "what the customer sees as
// available" matches what dispatchManager.js will actually offer:
//   - geofenceService.isInsideZone() + the `service_zone` table, instead of
//     PHP's separate (and, per its own defensive SHOW TABLES check,
//     possibly-missing) tbl_geofence_zones table.
//   - exact `r.vehicle === category name` driver matching, same as
//     dispatchManager.selectEligibleDrivers - not PHP's fuzzy LIKE-based
//     matching, which could show a vehicle as "available" that dispatch
//     itself would never actually offer to a driver.
//   - config/constants.js's SEARCH_RADIUS_KM (10km) as the default radius,
//     the same default real dispatch uses - not PHP's own hardcoded 30km
//     (its DB-configurable override columns don't exist in this schema, so
//     that 30km was always the effective value anyway).

function isFiniteNumber(value) {
  return typeof value === "number" ? Number.isFinite(value) : Number.isFinite(Number(value));
}

function timeToSeconds(date) {
  return date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
}

function getVehicleSpecs(catName) {
  const c = String(catName || "").toLowerCase();
  if (c.includes("bike") || c.includes("two") || c.includes("motorcycle")) {
    return { max_weight_kg: 10, max_dimensions: "40 x 40 x 40 cm" };
  }
  if (c.includes("scooter")) {
    return { max_weight_kg: 15, max_dimensions: "45 x 45 x 45 cm" };
  }
  if (c.includes("auto") || c.includes("three") || c.includes("3")) {
    return { max_weight_kg: 100, max_dimensions: "100 x 100 x 100 cm" };
  }
  if (c.includes("loader") || c.includes("electric")) {
    return { max_weight_kg: 350, max_dimensions: "150 x 100 x 100 cm" };
  }
  if (c.includes("ace") || c.includes("tata") || c.includes("chota") || c.includes("four") || c.includes("4")) {
    return { max_weight_kg: 750, max_dimensions: "210 x 140 x 140 cm" };
  }
  if (c.includes("pickup") || c.includes("8ft") || c.includes("bolero")) {
    return { max_weight_kg: 1200, max_dimensions: "250 x 150 x 150 cm" };
  }
  return { max_weight_kg: 20, max_dimensions: "50 x 50 x 50 cm" };
}

// A package's city_id is a free-text column (comma-separated ids in some
// rows, per legacy data) rather than a clean int FK - match defensively:
// empty/0 means "all cities".
function packageMatchesCity(pkgCityId, matchedCityId) {
  const raw = String(pkgCityId || "").trim();
  if (!raw || raw === "0") return true;
  return raw
    .split(",")
    .map((s) => s.trim())
    .includes(String(matchedCityId));
}

async function countNearbyOnlineDrivers(vehicleCategory, pickupLat, pickupLng, radiusKm) {
  const rows = await prisma.$queryRaw`
    SELECT r.id AS rider_id,
      (6371 * ACOS(
        LEAST(1, GREATEST(-1,
          COS(RADIANS(${pickupLat})) * COS(RADIANS(CAST(r.rlats AS DECIMAL(10,6)))) *
          COS(RADIANS(CAST(r.rlongs AS DECIMAL(10,6))) - RADIANS(${pickupLng})) +
          SIN(RADIANS(${pickupLat})) * SIN(RADIANS(CAST(r.rlats AS DECIMAL(10,6))))
        ))
      )) AS distance_km
    FROM tbl_rider r
    WHERE r.a_status = 1
      AND r.status = 1
      AND r.vehicle = ${vehicleCategory}
      AND r.rlats IS NOT NULL AND r.rlats != '' AND r.rlats != '0'
      AND r.rlongs IS NOT NULL AND r.rlongs != '' AND r.rlongs != '0'
      AND r.id NOT IN (
        SELECT rid FROM pkg_order
        WHERE order_status IN (1, 2, 3) AND rid > 0
          AND o_status NOT IN ('Completed', 'Cancelled')
      )
    HAVING distance_km <= ${radiusKm}
    ORDER BY distance_km ASC
    LIMIT 10
  `;
  return { count: rows.length, nearestKm: rows.length ? Number(rows[0].distance_km) : null };
}

async function availableVehicles(req, res) {
  try {
    const b = req.body || {};
    const pickupLat = Number(b.pickup_lat);
    const pickupLng = Number(b.pickup_lng);
    const bookingType = String(b.booking_type || "now").toLowerCase();
    const scheduledAt = b.scheduled_at;
    const categoryReq = String(b.category || "").trim();
    const uid = Number(b.uid || b.customer_id || 0);

    if (!isFiniteNumber(pickupLat) || !isFiniteNumber(pickupLng) || pickupLat < -90 || pickupLat > 90 || pickupLng < -180 || pickupLng > 180) {
      return res.status(400).json({
        success: false,
        serviceable: false,
        ResponseCode: "400",
        Result: "false",
        message: "pickup_lat and pickup_lng are required",
        ResponseMsg: "pickup_lat and pickup_lng are required",
      });
    }

    let radiusKm = SEARCH_RADIUS_KM;
    if (b.radius_km !== undefined && b.radius_km !== null && b.radius_km !== "") {
      const requested = Number(b.radius_km);
      if (!Number.isFinite(requested) || requested < 1 || requested > 30) {
        return res.status(400).json({
          success: false,
          ResponseCode: "400",
          Result: "false",
          message: "Invalid radius_km: must be between 1 and 30 km",
          ResponseMsg: "Invalid radius_km: must be between 1 and 30 km",
        });
      }
      radiusKm = requested;
    }

    // City/zone match
    let matchedCityId = 0;
    let matchedCityName = "";
    let matchedZoneId = 0;
    let matchedZoneName = "";
    let serviceable = false;

    const zones = await prisma.service_zone.findMany({ where: { status: 1 } });
    for (const zone of zones) {
      if (isInsideZone(pickupLat, pickupLng, zone)) {
        serviceable = true;
        matchedZoneId = zone.id;
        matchedZoneName = zone.name;
        matchedCityId = zone.city_id || 0;
        break;
      }
    }
    if (matchedCityId) {
      const city = await prisma.tbl_city.findUnique({ where: { id: matchedCityId } });
      matchedCityName = city?.title || "";
    }
    if (!serviceable) {
      const firstCity = await prisma.tbl_city.findFirst({ where: { status: 1 }, orderBy: { id: "asc" } });
      if (firstCity) {
        serviceable = true;
        matchedCityId = firstCity.id;
        matchedCityName = firstCity.title;
        matchedZoneId = 1;
        matchedZoneName = `${firstCity.title} Main Zone`;
      }
    }

    if (!serviceable) {
      return res.status(200).json({
        success: true,
        serviceable: false,
        search_radius_km: radiusKm,
        ResponseCode: "200",
        Result: "false",
        message: "Service is not available at this pickup location yet.",
        ResponseMsg: "Service is not available at this pickup location yet.",
        pickup_area: null,
        vehicles: [],
      });
    }

    const pickupArea = { city_id: matchedCityId, city_name: matchedCityName, zone_id: matchedZoneId, zone_name: matchedZoneName };

    // Premium plan discount (same query as customerContentController.homeData)
    let hasPlanDiscount = false;
    let planDiscountPercent = 0;
    if (uid > 0) {
      const today = new Date();
      const activeSub = await prisma.tbl_user_plan_subscription.findFirst({
        where: { user_id: uid, status: "active", plan_for: "USER", start_date: { lte: today }, end_date: { gte: today } },
      });
      if (activeSub) {
        const plan = await prisma.tbl_premium_plan.findUnique({ where: { id: activeSub.plan_id } });
        if (plan?.discount_enabled && Number(plan.discount_percent) > 0) {
          hasPlanDiscount = true;
          planDiscountPercent = Number(plan.discount_percent);
        }
      }
    }

    // Target time for night-charge window
    let targetDate = new Date();
    if (bookingType === "scheduled" && scheduledAt) {
      const parsed = new Date(scheduledAt);
      if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) targetDate = parsed;
    }
    const targetTimeSec = timeToSeconds(targetDate);

    // tbl_package.cat_id is a plain int column, not a declared Prisma
    // relation to pkg_category - batch-fetch categories separately instead
    // of an include (which would fail Prisma's schema validation).
    const packages = await prisma.tbl_package.findMany({
      where: { status: 1, type: "USER" },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    });
    const categoryIds = [...new Set(packages.map((p) => p.cat_id))];
    const categories = await prisma.pkg_category.findMany({ where: { id: { in: categoryIds } } });
    const categoryById = Object.fromEntries(categories.map((c) => [c.id, c]));

    const categoryReqLower = categoryReq.toLowerCase();
    const filterByCategory = categoryReq && !["all", "parcel"].includes(categoryReqLower);

    const settingRow = await prisma.setting.findFirst();
    const currency = settingRow?.currency || "INR";

    const vehicles = [];
    for (const pkg of packages) {
      if (!packageMatchesCity(pkg.city_id, matchedCityId)) continue;

      const category = categoryById[pkg.cat_id];
      if (!category) continue;
      if (filterByCategory && !category.cat_name?.toLowerCase().includes(categoryReqLower)) continue;
      const catName = category.cat_name;
      const catImg = pkg.user_detail_image || category.cat_img || "images/package/model-1.png";

      const startSec = timeToSeconds(pkg.start_time);
      const endSec = timeToSeconds(pkg.end_time);
      const nightChargePercent = Number(pkg.night_charge_percent || 0);
      let isNight = false;
      if (nightChargePercent > 0 && startSec !== endSec) {
        isNight = startSec < endSec ? targetTimeSec >= startSec && targetTimeSec < endSec : targetTimeSec >= startSec || targetTimeSec < endSec;
      }
      const appliedNightCharge = isNight ? nightChargePercent : 0;

      const minCharge = Number(pkg.min_charge);
      const servicePercent = Number(pkg.service_charge_percent || 0);
      let startingFare = minCharge + (minCharge * servicePercent) / 100 + appliedNightCharge;
      if (hasPlanDiscount) startingFare *= (100 - planDiscountPercent) / 100;
      startingFare = Math.round(startingFare);

      let liveSupply = "none";
      let estimatedPickupMinutes = null;
      let available = false;
      let reasonUnavailable = "No drivers nearby";

      if (bookingType === "scheduled") {
        liveSupply = "good";
        estimatedPickupMinutes = 15;
        available = true;
        reasonUnavailable = null;
      } else {
        const { count, nearestKm } = await countNearbyOnlineDrivers(catName, pickupLat, pickupLng, radiusKm);
        if (count >= 1) {
          liveSupply = "good";
          estimatedPickupMinutes = Math.round(Math.max(4, Math.min(10, nearestKm * 1.2 + 2)));
          available = true;
          reasonUnavailable = null;
        }
      }

      const specs = getVehicleSpecs(catName);

      vehicles.push({
        id: pkg.id,
        package_id: pkg.id,
        cat_id: category.id,
        category_id: category.id,
        cat_name: catName,
        category_name: catName,
        name: pkg.title,
        title: pkg.title,
        vehicle_type: catName,
        category: catName,
        image: catImg,
        cat_img: catImg,
        img: catImg,
        available,
        is_available: available ? 1 : 0,
        status: available ? 1 : 0,
        live_supply: liveSupply,
        estimated_pickup_minutes: estimatedPickupMinutes,
        eta_minutes: estimatedPickupMinutes,
        starting_fare: startingFare,
        price: startingFare,
        currency,
        max_weight_kg: specs.max_weight_kg,
        max_dimensions: specs.max_dimensions,
        reason_unavailable: reasonUnavailable,
      });
    }

    const catMap = new Map();
    for (const v of vehicles) {
      if (!catMap.has(v.cat_id)) {
        catMap.set(v.cat_id, {
          id: v.cat_id,
          cat_id: v.cat_id,
          cat_name: v.cat_name,
          name: v.cat_name,
          title: v.cat_name,
          vehicle_type: v.cat_name,
          cat_img: v.cat_img,
          image: v.image,
          available: false,
          is_available: 0,
          live_supply: "none",
          estimated_pickup_minutes: null,
          eta_minutes: null,
          starting_fare: v.starting_fare,
          currency: v.currency,
          reason_unavailable: "No drivers nearby",
          models: [],
        });
      }
      const entry = catMap.get(v.cat_id);
      entry.models.push(v);
      if (v.available) {
        entry.available = true;
        entry.is_available = 1;
        entry.live_supply = v.live_supply;
        if (entry.estimated_pickup_minutes === null || v.estimated_pickup_minutes < entry.estimated_pickup_minutes) {
          entry.estimated_pickup_minutes = v.estimated_pickup_minutes;
          entry.eta_minutes = v.estimated_pickup_minutes;
        }
        entry.reason_unavailable = null;
      }
      if (v.starting_fare > 0 && (entry.starting_fare <= 0 || v.starting_fare < entry.starting_fare)) {
        entry.starting_fare = v.starting_fare;
      }
    }
    const categoriesSummary = [...catMap.values()];

    return res.status(200).json({
      success: true,
      serviceable: true,
      search_radius_km: radiusKm,
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Available vehicles fetched successfully",
      message: "Available vehicles fetched successfully",
      pickup_area: pickupArea,
      vehicles,
      categories: categoriesSummary,
      vehicle_categories: categoriesSummary,
      pkgc: categoriesSummary,
      data: { serviceable: true, search_radius_km: radiusKm, pickup_area: pickupArea, vehicles, categories: categoriesSummary },
    });
  } catch (err) {
    logger.error("orderAvailabilityController.availableVehicles failed:", err);
    return res.status(500).json({
      success: false,
      serviceable: false,
      ResponseCode: "500",
      Result: "false",
      message: "An error occurred while fetching available vehicles",
      ResponseMsg: "An error occurred while fetching available vehicles",
      pickup_area: null,
      vehicles: [],
      categories: [],
      vehicle_categories: [],
    });
  }
}

module.exports = { availableVehicles };
