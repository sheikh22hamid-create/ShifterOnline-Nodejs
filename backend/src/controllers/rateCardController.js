const prisma = require("../config/db");
const logger = require("../utils/logger");
const {
  SLAB_INTERVALS,
  DEFAULT_SLAB_RATES,
  DEFAULT_MODEL_MULTIPLIERS,
  getSlabPricingConfig,
  saveSlabPricingConfig,
  calculateBaseSlabFare,
  calculateModelFares,
  findVehicleSlabConfig,
} = require("../services/slabPricingService");

const PACKAGE_TYPES = ["USER", "DRIVER"];

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

/** tbl_package.start_time/end_time are `Time` columns; the Prisma client
 * represents them as a Date on 1970-01-01. Accepts "HH:mm" or "HH:mm:ss". */
function toTimeValue(value) {
  if (!value) return null;
  const [h, m, s] = String(value).split(":");
  const hh = String(h || "0").padStart(2, "0");
  const mm = String(m || "0").padStart(2, "0");
  const ss = String(s || "0").padStart(2, "0");
  return new Date(`1970-01-01T${hh}:${mm}:${ss}.000Z`);
}

function formatTime(date) {
  if (!date) return null;
  const d = new Date(date);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function serializePackage(pkg, category) {
  return {
    ...pkg,
    user_title: pkg.user_title || null,
    driver_title: pkg.driver_title || null,
    start_time: formatTime(pkg.start_time),
    end_time: formatTime(pkg.end_time),
    category_name: category?.cat_name || null,
    category_img: category?.cat_img || null,
    vehicle_type: category?.cat_name || null,
  };
}

async function list(req, res) {
  try {
    const where = {};
    if (req.query.cat_id) where.cat_id = parseInt(req.query.cat_id, 10);
    if (req.query.status !== undefined) where.status = parseInt(req.query.status, 10);

    const [rows, categories] = await Promise.all([
      prisma.tbl_package.findMany({ where, orderBy: [{ cat_id: "asc" }, { sort_order: "asc" }] }),
      prisma.pkg_category.findMany(),
    ]);

    const catMap = new Map(categories.map((c) => [c.id, c]));

    let filteredRows = rows;
    if (req.query.city_id) {
      // city_id is a legacy comma-separated VarChar column, not a real FK —
      // substring match would false-positive ("1" inside "21"), so split first.
      const target = String(parseInt(req.query.city_id, 10));
      filteredRows = filteredRows.filter((p) => (p.city_id || "").split(",").map((s) => s.trim()).includes(target));
    }

    const data = filteredRows.map((pkg) => serializePackage(pkg, catMap.get(pkg.cat_id)));

    return res.status(200).json({ success: true, total: data.length, data });
  } catch (err) {
    return internalError(res, err, "rateCards.list");
  }
}

async function getOne(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const pkg = await prisma.tbl_package.findUnique({ where: { id } });
    if (!pkg) {
      return res.status(404).json({ success: false, message: "Rate card not found" });
    }
    const category = pkg.cat_id ? await prisma.pkg_category.findUnique({ where: { id: pkg.cat_id } }) : null;
    return res.status(200).json({ success: true, data: serializePackage(pkg, category) });
  } catch (err) {
    return internalError(res, err, "rateCards.getOne");
  }
}

async function create(req, res) {
  try {
    const b = req.body;
    const required = [
      "title",
      "type",
      "cat_id",
      "city_id",
      "min_charge",
      "per_km_charge",
      "free_waiting_time",
      "waiting_charge",
      "start_time",
      "end_time",
    ];
    const missing = required.filter((f) => b[f] === undefined || b[f] === null || b[f] === "");
    if (missing.length) {
      return res.status(400).json({ success: false, message: `Missing required fields: ${missing.join(", ")}` });
    }
    if (!PACKAGE_TYPES.includes(b.type)) {
      return res.status(400).json({ success: false, message: `type must be one of ${PACKAGE_TYPES.join(", ")}` });
    }

    const category = await prisma.pkg_category.findUnique({ where: { id: parseInt(b.cat_id, 10) } });
    if (!category) {
      return res.status(400).json({ success: false, message: `cat_id ${b.cat_id} does not exist` });
    }

    const created = await prisma.tbl_package.create({
      data: {
        title: b.title,
        user_title: b.user_title ? String(b.user_title).trim() : null,
        driver_title: b.driver_title ? String(b.driver_title).trim() : null,
        type: b.type,
        cat_id: parseInt(b.cat_id, 10),
        city_id: String(b.city_id),
        min_charge: b.min_charge,
        per_km_charge: b.per_km_charge,
        driver_per_trip: b.driver_per_trip !== undefined ? String(b.driver_per_trip) : "0",
        driver_per_percent: b.driver_per_percent !== undefined ? String(b.driver_per_percent) : "0",
        free_waiting_time: parseInt(b.free_waiting_time, 10),
        waiting_charge: b.waiting_charge,
        service_charge_percent: b.service_charge_percent ?? 0,
        night_charge_percent: b.night_charge_percent ?? 0,
        start_time: toTimeValue(b.start_time),
        end_time: toTimeValue(b.end_time),
        loading_charge: b.loading_charge ?? null,
        unloading_charge: b.unloading_charge ?? null,
        service_charge: b.service_charge ?? null,
        pickup_charge: b.pickup_charge ?? null,
        pickup_per_km_charge: b.pickup_per_km_charge ?? null,
        premium_plan_id: b.premium_plan_id ? parseInt(b.premium_plan_id, 10) : null,
        sort_order: b.sort_order !== undefined ? parseInt(b.sort_order, 10) : 0,
        cancellation_charge_customer: b.cancellation_charge_customer ?? 0,
        cancellation_charge_driver: b.cancellation_charge_driver ?? 0,
        user_detail_image: b.user_detail_image ?? null,
        driver_detail_image: b.driver_detail_image ?? null,
        status: b.status !== undefined ? parseInt(b.status, 10) : 1,
      },
    });

    return res.status(201).json({ success: true, message: "Rate card created", data: serializePackage(created, category) });
  } catch (err) {
    return internalError(res, err, "rateCards.create");
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_package.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Rate card not found" });
    }

    const b = req.body;
    if (b.type !== undefined && !PACKAGE_TYPES.includes(b.type)) {
      return res.status(400).json({ success: false, message: `type must be one of ${PACKAGE_TYPES.join(", ")}` });
    }
    if (b.cat_id !== undefined) {
      const category = await prisma.pkg_category.findUnique({ where: { id: parseInt(b.cat_id, 10) } });
      if (!category) {
        return res.status(400).json({ success: false, message: `cat_id ${b.cat_id} does not exist` });
      }
    }

    const data = {};
    const directFields = [
      "title",
      "user_title",
      "driver_title",
      "min_charge",
      "per_km_charge",
      "free_waiting_time",
      "waiting_charge",
      "service_charge_percent",
      "night_charge_percent",
      "loading_charge",
      "unloading_charge",
      "service_charge",
      "pickup_charge",
      "pickup_per_km_charge",
      "cancellation_charge_customer",
      "cancellation_charge_driver",
      "user_detail_image",
      "driver_detail_image",
    ];
    for (const field of directFields) {
      if (b[field] !== undefined) {
        if (field === "user_title" || field === "driver_title") {
          data[field] = b[field] ? String(b[field]).trim() : null;
        } else {
          data[field] = b[field];
        }
      }
    }
    if (b.type !== undefined) data.type = b.type;
    if (b.cat_id !== undefined) data.cat_id = parseInt(b.cat_id, 10);
    if (b.city_id !== undefined) data.city_id = String(b.city_id);
    if (b.driver_per_trip !== undefined) data.driver_per_trip = String(b.driver_per_trip);
    if (b.driver_per_percent !== undefined) data.driver_per_percent = String(b.driver_per_percent);
    if (b.free_waiting_time !== undefined) data.free_waiting_time = parseInt(b.free_waiting_time, 10);
    if (b.start_time !== undefined) data.start_time = toTimeValue(b.start_time);
    if (b.end_time !== undefined) data.end_time = toTimeValue(b.end_time);
    if (b.premium_plan_id !== undefined) data.premium_plan_id = b.premium_plan_id ? parseInt(b.premium_plan_id, 10) : null;
    if (b.sort_order !== undefined) data.sort_order = parseInt(b.sort_order, 10);
    if (b.status !== undefined) data.status = parseInt(b.status, 10);

    const updated = await prisma.tbl_package.update({ where: { id }, data });
    const category = updated.cat_id ? await prisma.pkg_category.findUnique({ where: { id: updated.cat_id } }) : null;
    return res.status(200).json({ success: true, message: "Rate card updated", data: serializePackage(updated, category) });
  } catch (err) {
    return internalError(res, err, "rateCards.update");
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_package.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Rate card not found" });
    }

    // tbl_rider_delivery_type.delivery_type stores this id as a string —
    // deleting out from under an enabled driver would silently orphan it.
    const enabledDriverCount = await prisma.tbl_rider_delivery_type.count({
      where: { delivery_type: String(id), status: 1 },
    });
    if (enabledDriverCount) {
      return res.status(409).json({
        success: false,
        message: "Cannot delete a rate card that drivers are currently enabled for — deactivate it instead (PUT status: 0).",
      });
    }

async function getSlabs(req, res) {
  try {
    const config = await getSlabPricingConfig();
    return res.status(200).json({
      success: true,
      data: {
        slabRates: config.slabRates,
        modelMultipliers: config.modelMultipliers,
        intervals: SLAB_INTERVALS,
      },
    });
  } catch (err) {
    return internalError(res, err, "rateCards.getSlabs");
  }
}

async function updateSlabs(req, res) {
  try {
    const { slabRates, modelMultipliers } = req.body;
    if (!slabRates && !modelMultipliers) {
      return res.status(400).json({ success: false, message: "slabRates or modelMultipliers is required" });
    }

    const saved = await saveSlabPricingConfig({ slabRates, modelMultipliers });
    return res.status(200).json({
      success: true,
      message: "Slab pricing rules updated successfully",
      data: saved,
    });
  } catch (err) {
    return internalError(res, err, "rateCards.updateSlabs");
  }
}

async function simulateFare(req, res) {
  try {
    const { vehicle_key, distance_km } = req.body;
    const distance = Number(distance_km) || 0;
    const config = await getSlabPricingConfig();
    const vehicleConfig = config.slabRates[vehicle_key] || findVehicleSlabConfig(config.slabRates, vehicle_key);

    if (!vehicleConfig) {
      return res.status(404).json({ success: false, message: `Vehicle slab config not found for '${vehicle_key}'` });
    }

    const result = calculateModelFares(vehicleConfig, config.modelMultipliers, distance);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return internalError(res, err, "rateCards.simulateFare");
  }
}

async function syncModelsFromSlabs(req, res) {
  try {
    const config = await getSlabPricingConfig();
    const categories = await prisma.pkg_category.findMany();
    const multipliers = config.modelMultipliers || DEFAULT_MODEL_MULTIPLIERS;
    const anchorMarkup = Number(multipliers.anchor_markup_percent) || 10;
    const anchorMultiplier = 1 + anchorMarkup / 100;

    let updatedCount = 0;

    for (const category of categories) {
      const vehicleConfig = findVehicleSlabConfig(config.slabRates, category.id);
      if (!vehicleConfig) continue;

      const packages = await prisma.tbl_package.findMany({
        where: { cat_id: category.id },
        orderBy: { sort_order: "asc" },
      });

      for (const pkg of packages) {
        const pkgTitle = String(pkg.title || "").toLowerCase();
        const modelMatch = (multipliers.models || []).find((m) => pkgTitle.includes(m.model.toLowerCase()));

        if (modelMatch) {
          const offset = Number(modelMatch.offset_percent) || 0;
          const effectiveMultiplier = anchorMultiplier * (1 + offset / 100);

          const calculatedMin = Math.round(Number(vehicleConfig.min_charge) * effectiveMultiplier * 100) / 100;
          // Representative per_km_charge for legacy reference (e.g. 5-10 km slab rate scaled)
          const basePerKm = Number(vehicleConfig.rates?.["5_10"] || vehicleConfig.rates?.["1_5"] || 10);
          const calculatedPerKm = Math.round(basePerKm * effectiveMultiplier * 100) / 100;

          await prisma.tbl_package.update({
            where: { id: pkg.id },
            data: {
              min_charge: String(calculatedMin),
              per_km_charge: String(calculatedPerKm),
              user_title: modelMatch.user_title ? String(modelMatch.user_title).trim() : null,
              driver_title: modelMatch.driver_title ? String(modelMatch.driver_title).trim() : null,
            },
          });
          updatedCount++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully synchronized ${updatedCount} model rate cards with distance-slab pricing rules!`,
      updatedCount,
    });
  } catch (err) {
    return internalError(res, err, "rateCards.syncModelsFromSlabs");
  }
}

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
  getSlabs,
  updateSlabs,
  simulateFare,
  syncModelsFromSlabs,
};
