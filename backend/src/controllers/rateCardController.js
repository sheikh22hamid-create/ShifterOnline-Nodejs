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
  const rawPct = parseFloat(pkg.driver_per_percent);
  let commission_percent = 10;
  let driver_share_percent = 90;
  if (Number.isFinite(rawPct) && rawPct >= 0) {
    if (rawPct > 50 && rawPct <= 100) {
      driver_share_percent = rawPct;
      commission_percent = Math.round((100 - rawPct) * 100) / 100;
    } else if (rawPct <= 50) {
      commission_percent = rawPct;
      driver_share_percent = Math.round((100 - rawPct) * 100) / 100;
    }
  }

  return {
    ...pkg,
    commission_percent: String(commission_percent),
    driver_share_percent: String(driver_share_percent),
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
        driver_per_percent: (() => {
          if (b.commission_percent !== undefined && b.commission_percent !== "") {
            return String(parseFloat(b.commission_percent) || 0);
          }
          if (b.driver_share_percent !== undefined && b.driver_share_percent !== "") {
            const share = parseFloat(b.driver_share_percent) || 0;
            return String(Math.max(0, Math.round((100 - share) * 100) / 100));
          }
          if (b.driver_per_percent !== undefined && b.driver_per_percent !== "") {
            const raw = parseFloat(b.driver_per_percent) || 0;
            return raw > 50 ? String(Math.max(0, Math.round((100 - raw) * 100) / 100)) : String(raw);
          }
          return "10";
        })(),
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
        outside_min_charge: b.outside_min_charge ?? 0,
        outside_per_km_charge: b.outside_per_km_charge ?? 0,
        outside_surcharge: b.outside_surcharge ?? 0,
        cancellation_charge: b.cancellation_charge ?? null,
        admin_earning: b.admin_earning ?? 0,
        driver_earning: b.driver_earning ?? 0,
        driver_cancel_admin_earning: b.driver_cancel_admin_earning ?? 0,
        driver_cancel_user_earning: b.driver_cancel_user_earning ?? 0,
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
      "outside_min_charge",
      "outside_per_km_charge",
      "outside_surcharge",
      "cancellation_charge",
      "admin_earning",
      "driver_earning",
      "driver_cancel_admin_earning",
      "driver_cancel_user_earning",
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
    if (b.commission_percent !== undefined && b.commission_percent !== "") {
      data.driver_per_percent = String(parseFloat(b.commission_percent) || 0);
    } else if (b.driver_share_percent !== undefined && b.driver_share_percent !== "") {
      const share = parseFloat(b.driver_share_percent) || 0;
      data.driver_per_percent = String(Math.max(0, Math.round((100 - share) * 100) / 100));
    } else if (b.driver_per_percent !== undefined) {
      const raw = parseFloat(b.driver_per_percent) || 0;
      data.driver_per_percent = raw > 50 ? String(Math.max(0, Math.round((100 - raw) * 100) / 100)) : String(raw);
    }
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

    // Check if there are active in-progress orders using this rate card
    const activeOrderCount = await prisma.pkg_order.count({
      where: {
        delivery_type: id,
        order_status: { in: [1, 2, 3] },
        o_status: { notIn: ["Completed", "Cancelled"] },
      },
    });
    if (activeOrderCount > 0) {
      return res.status(409).json({
        success: false,
        message: "Cannot delete rate card while active orders are in progress for it. Deactivate it instead.",
      });
    }

    // Clean up any rider delivery type links
    await prisma.tbl_rider_delivery_type.deleteMany({
      where: { delivery_type: String(id) },
    });

    await prisma.tbl_package.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Rate card deleted successfully" });
  } catch (err) {
    return internalError(res, err, "rateCards.remove");
  }
}

async function getSlabs(req, res) {
  try {
    const config = await getSlabPricingConfig();
    const slabRates = config.slabRates || DEFAULT_SLAB_RATES;
    const modelMultipliers = config.modelMultipliers || DEFAULT_MODEL_MULTIPLIERS;

    // Build vehicle_slabs array for clean frontend UI. Every interval,
    // including the open-ended 60+ km one (previously filtered out here) —
    // dropping it meant the admin UI never showed that band at all, and
    // updateSlabs below rebuilt a vehicle's whole `rates` object from
    // exactly this array on save, so every save silently wiped the real
    // 60+ km rate to 0 (confirmed live: a 60km-vs-100km trip on the same
    // vehicle produced an identical fare after any admin save). `to:
    // Infinity` serializes over JSON as `null` — the frontend must treat a
    // null to_km as unbounded, not as "ends at 0km".
    //
    // The 60+ band no longer has an independent stored rate at all (see
    // slabPricingService.calculateBaseSlabFare's rateForInterval) — it
    // always mirrors the last finite band (50-60km) automatically, so
    // there's nothing left to go missing or drift out of sync. `derived:
    // true` tells the admin UI to render it as read-only instead of an
    // editable rate.
    const lastFiniteInterval = SLAB_INTERVALS.filter((i) => i.to !== Infinity).slice(-1)[0];
    const vehicle_slabs = Object.values(slabRates).map((v) => {
      const slabs = SLAB_INTERVALS.map((interval) => ({
        key: interval.key,
        from_km: interval.from,
        to_km: interval.to === Infinity ? null : interval.to,
        label: interval.label,
        rate: interval.to === Infinity
          ? Number(v.rates?.[lastFiniteInterval.key] ?? 0)
          : Number(v.rates?.[interval.key] ?? v.rates?.[interval.label] ?? 0),
        derived: interval.to === Infinity,
      }));
      return {
        vehicle_key: v.vehicle_key,
        vehicle_type: v.vehicle_name || v.vehicle_type,
        category_id: v.category_id,
        min_charge: Number(v.min_charge) || 0,
        anchor_model: Number(v.anchor_model) || (typeof v.anchor_model === "string" ? parseInt(v.anchor_model.replace(/\D/g, ""), 10) : 3) || 3,
        markup_percent: v.markup_percent !== undefined && v.markup_percent !== null ? Number(v.markup_percent) : (Number(modelMultipliers.anchor_markup_percent) || 10),
        slabs,
      };
    });

    const model_multipliers = (modelMultipliers.models || []).map((m, idx) => ({
      model_number: idx + 1,
      model: m.model,
      name: m.model,
      user_title: m.user_title || "",
      driver_title: m.driver_title || "",
      percent_offset: Number(m.offset_percent) || 0,
    }));

    const anchor_model = {
      model_number: 3,
      name: modelMultipliers.anchor_model || "Model 3",
      markup_percent: Number(modelMultipliers.anchor_markup_percent) || 10,
    };

    return res.status(200).json({
      success: true,
      data: {
        vehicle_slabs,
        model_multipliers,
        anchor_model,
        slabRates,
        modelMultipliers,
        intervals: SLAB_INTERVALS,
      },
    });
  } catch (err) {
    return internalError(res, err, "rateCards.getSlabs");
  }
}

async function updateSlabs(req, res) {
  try {
    const { vehicle_slabs, model_multipliers, anchor_model, slabRates, modelMultipliers } = req.body;

    let savedSlabRates = slabRates;
    if (!savedSlabRates && Array.isArray(vehicle_slabs)) {
      // Merge onto the EXISTING persisted rates rather than replacing each
      // vehicle's whole `rates` object outright — a caller (the admin UI's
      // own slab-editing table, or any older cached build of it) that omits
      // a slab key entirely must not silently delete that band's real rate.
      // This is exactly how the 60+ km band went to 0 for every vehicle:
      // the UI never rendered or sent that interval, and this endpoint used
      // to rebuild `rates` from nothing but what it received (see getSlabs'
      // own comment on the matching read-side gap).
      const existingConfig = await getSlabPricingConfig();
      const existingSlabRates = existingConfig?.slabRates || DEFAULT_SLAB_RATES;

      savedSlabRates = {};
      for (const v of vehicle_slabs) {
        const key = v.vehicle_key || String(v.vehicle_type).toLowerCase().replace(/[^a-z0-9]/g, "_");
        const rates = { ...(existingSlabRates[key]?.rates || {}) };
        for (const s of v.slabs || []) {
          // The 60+ band (see getSlabs' `derived: true`) has no rate of its
          // own to persist — it always mirrors the last finite band at read
          // time (slabPricingService.calculateBaseSlabFare), so writing
          // whatever the (read-only, mirrored) value the client echoed back
          // would just be redundant/stale data sitting in `rates` doing
          // nothing. Skipped rather than written.
          if (s.key === "60_plus") continue;
          const sKey = s.key || `${s.from_km}_${s.to_km}`;
          rates[sKey] = Number(s.rate) || 0;
        }
        savedSlabRates[key] = {
          vehicle_key: key,
          vehicle_name: v.vehicle_type || v.vehicle_name,
          category_id: v.category_id,
          min_charge: Number(v.min_charge) || 0,
          anchor_model: Number(v.anchor_model) || 3,
          markup_percent: v.markup_percent !== undefined && v.markup_percent !== null ? Number(v.markup_percent) : 10,
          rates,
        };
      }
    }

    let savedModelMultipliers = modelMultipliers;
    if (!savedModelMultipliers && (Array.isArray(model_multipliers) || anchor_model)) {
      const anchorMarkup = Number(anchor_model?.markup_percent) || 10;
      const anchorName = anchor_model?.name || `Model ${anchor_model?.model_number || 3}`;
      const models = (model_multipliers || []).map((m) => ({
        model: m.name || m.model || `Model ${m.model_number}`,
        offset_percent: Number(m.percent_offset) || 0,
        user_title: m.user_title || "",
        driver_title: m.driver_title || "",
      }));

      savedModelMultipliers = {
        anchor_model: anchorName,
        anchor_markup_percent: anchorMarkup,
        models,
      };
    }

    const saved = await saveSlabPricingConfig({
      slabRates: savedSlabRates,
      modelMultipliers: savedModelMultipliers,
    });

    return res.status(200).json({
      success: true,
      message: "Slab pricing configuration saved successfully",
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
    let createdCount = 0;

    for (const category of categories) {
      const vehicleConfig = findVehicleSlabConfig(config.slabRates, category.id);
      if (!vehicleConfig) continue;

      const categoryAnchorMarkup = Number(
        vehicleConfig.markup_percent ??
        vehicleConfig.anchor_markup_percent ??
        multipliers.anchor_markup_percent
      ) || 10;
      const anchorMultiplier = 1 + categoryAnchorMarkup / 100;

      const packages = await prisma.tbl_package.findMany({
        where: { cat_id: category.id },
        orderBy: { sort_order: "asc" },
      });

      const baseTemplate = packages[0] || null;

      for (const m of multipliers.models || []) {
        const offset = Number(m.offset_percent) || 0;
        const effectiveMultiplier = anchorMultiplier * (1 + offset / 100);

        const calculatedMin = Math.round(Number(vehicleConfig.min_charge) * effectiveMultiplier * 100) / 100;
        // Representative per_km_charge for trip rate (e.g. 5-10 km slab rate scaled)
        const basePerKm = Number(vehicleConfig.rates?.["5_10"] || vehicleConfig.rates?.["1_5"] || 10);
        const calculatedPerKm = Math.round(basePerKm * effectiveMultiplier * 100) / 100;
        const calculatedPickupPerKm = Math.round(calculatedPerKm * 0.5 * 100) / 100;

        const modelTargetTitle = String(m.model).trim();
        const pkgMatch = packages.find((p) =>
          String(p.title || "").toLowerCase().includes(modelTargetTitle.toLowerCase())
        );

        if (pkgMatch) {
          await prisma.tbl_package.update({
            where: { id: pkgMatch.id },
            data: {
              min_charge: String(calculatedMin),
              per_km_charge: String(calculatedPerKm),
              pickup_per_km_charge: pkgMatch.pickup_per_km_charge ? String(calculatedPickupPerKm) : null,
              user_title: m.user_title ? String(m.user_title).trim() : pkgMatch.user_title,
              driver_title: m.driver_title ? String(m.driver_title).trim() : pkgMatch.driver_title,
            },
          });
          updatedCount++;
        } else {
          // Auto-create missing model rate card for this vehicle category
          const sortOrder = parseInt(modelTargetTitle.replace(/\D/g, ""), 10) || 0;
          await prisma.tbl_package.create({
            data: {
              title: modelTargetTitle,
              user_title: m.user_title ? String(m.user_title).trim() : null,
              driver_title: m.driver_title ? String(m.driver_title).trim() : null,
              type: baseTemplate?.type || "USER",
              cat_id: category.id,
              city_id: baseTemplate?.city_id || "1",
              min_charge: String(calculatedMin),
              per_km_charge: String(calculatedPerKm),
              pickup_per_km_charge: String(calculatedPickupPerKm),
              pickup_charge: baseTemplate?.pickup_charge || null,
              outside_min_charge: "0",
              outside_per_km_charge: "0",
              outside_surcharge: "0",
              driver_per_trip: baseTemplate?.driver_per_trip || "0",
              driver_per_percent: baseTemplate?.driver_per_percent || "10",
              free_waiting_time: baseTemplate?.free_waiting_time ?? 5,
              waiting_charge: baseTemplate?.waiting_charge ?? 0,
              service_charge_percent: baseTemplate?.service_charge_percent ?? 0,
              night_charge_percent: baseTemplate?.night_charge_percent ?? 0,
              start_time: baseTemplate?.start_time || new Date("1970-01-01T23:00:00.000Z"),
              end_time: baseTemplate?.end_time || new Date("1970-01-01T06:00:00.000Z"),
              sort_order: sortOrder,
              cancellation_charge_customer: baseTemplate?.cancellation_charge_customer ?? 0,
              cancellation_charge_driver: baseTemplate?.cancellation_charge_driver ?? 0,
              admin_earning: baseTemplate?.admin_earning ?? 0,
              driver_earning: baseTemplate?.driver_earning ?? 0,
              driver_cancel_admin_earning: baseTemplate?.driver_cancel_admin_earning ?? 0,
              driver_cancel_user_earning: baseTemplate?.driver_cancel_user_earning ?? 0,
              status: 1,
            },
          });
          createdCount++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully synchronized model rate cards with distance-slab pricing rules (${updatedCount} updated, ${createdCount} created)!`,
      updatedCount,
      createdCount,
    });
  } catch (err) {
    return internalError(res, err, "rateCards.syncModelsFromSlabs");
  }
}

/**
 * Auto-generate multiple model rate cards from a single base model (e.g. Model 3).
 * Copies all common non-price settings (category, city, waiting time/charge,
 * cancellation charges, driver share %, night surge window) and calculates
 * scaled min_charge and per_km_charge according to each model's offset percentage.
 */
async function generateModels(req, res) {
  try {
    const baseId = parseInt(req.body.baseRateCardId || req.body.base_package_id || req.body.base_id, 10);
    if (!baseId) {
      return res.status(400).json({ success: false, message: "baseRateCardId is required" });
    }

    const base = await prisma.tbl_package.findUnique({ where: { id: baseId } });
    if (!base) {
      return res.status(404).json({ success: false, message: "Base rate card not found" });
    }

    const modelsList = req.body.models;
    if (!Array.isArray(modelsList) || modelsList.length === 0) {
      return res.status(400).json({ success: false, message: "models array is required" });
    }

    const category = base.cat_id ? await prisma.pkg_category.findUnique({ where: { id: base.cat_id } }) : null;

    let createdCount = 0;
    let updatedCount = 0;
    const results = [];

    for (const m of modelsList) {
      const offset = Number(m.offset_percent) || 0;
      const multiplier = 1 + offset / 100;

      const calculatedMin = Math.round(Number(base.min_charge) * multiplier * 100) / 100;
      const calculatedPerKm = Math.round(Number(base.per_km_charge) * multiplier * 100) / 100;
      const calculatedPickupPerKm =
        base.pickup_per_km_charge != null
          ? Math.round(Number(base.pickup_per_km_charge) * multiplier * 100) / 100
          : null;
      const calculatedOutsideMin =
        base.outside_min_charge != null
          ? Math.round(Number(base.outside_min_charge) * multiplier * 100) / 100
          : 0;
      const calculatedOutsidePerKm =
        base.outside_per_km_charge != null
          ? Math.round(Number(base.outside_per_km_charge) * multiplier * 100) / 100
          : 0;

      const modelTitle = String(m.title || `Model ${m.model_number || ""}`).trim();
      const sortOrder =
        m.sort_order !== undefined
          ? parseInt(m.sort_order, 10)
          : parseInt(modelTitle.replace(/\D/g, ""), 10) || 0;

      // Find if this model already exists for the same cat_id, city_id and type (case-insensitive)
      const existingCandidates = await prisma.tbl_package.findMany({
        where: {
          cat_id: base.cat_id,
          city_id: base.city_id,
          type: base.type,
        },
      });

      const existing = existingCandidates.find((cand) => {
        const candTitle = String(cand.title || "").trim().toLowerCase();
        const targetTitle = modelTitle.toLowerCase();
        return candTitle === targetTitle || (cand.id === base.id && String(base.title || "").trim().toLowerCase() === targetTitle);
      });

      if (existing) {
        // Update existing model rate card
        const updated = await prisma.tbl_package.update({
          where: { id: existing.id },
          data: {
            title: modelTitle,
            min_charge: String(calculatedMin),
            per_km_charge: String(calculatedPerKm),
            pickup_per_km_charge: calculatedPickupPerKm != null ? String(calculatedPickupPerKm) : null,
            outside_min_charge: String(calculatedOutsideMin),
            outside_per_km_charge: String(calculatedOutsidePerKm),
            user_title: m.user_title ? String(m.user_title).trim() : existing.user_title,
            driver_title: m.driver_title ? String(m.driver_title).trim() : existing.driver_title,
            sort_order: sortOrder,
            free_waiting_time: base.free_waiting_time,
            waiting_charge: base.waiting_charge,
            service_charge_percent: base.service_charge_percent,
            night_charge_percent: base.night_charge_percent,
            start_time: base.start_time,
            end_time: base.end_time,
            driver_per_percent: base.driver_per_percent,
            driver_per_trip: base.driver_per_trip,
            cancellation_charge_customer: base.cancellation_charge_customer,
            cancellation_charge_driver: base.cancellation_charge_driver,
            admin_earning: base.admin_earning,
            driver_earning: base.driver_earning,
            driver_cancel_admin_earning: base.driver_cancel_admin_earning,
            driver_cancel_user_earning: base.driver_cancel_user_earning,
            status: base.status,
          },
        });
        updatedCount++;
        results.push(serializePackage(updated, category));
      } else {
        // Create new model rate card inheriting from base
        const created = await prisma.tbl_package.create({
          data: {
            title: modelTitle,
            user_title: m.user_title ? String(m.user_title).trim() : null,
            driver_title: m.driver_title ? String(m.driver_title).trim() : null,
            type: base.type,
            cat_id: base.cat_id,
            city_id: base.city_id,
            min_charge: String(calculatedMin),
            per_km_charge: String(calculatedPerKm),
            pickup_per_km_charge: calculatedPickupPerKm != null ? String(calculatedPickupPerKm) : null,
            pickup_charge: base.pickup_charge,
            outside_min_charge: String(calculatedOutsideMin),
            outside_per_km_charge: String(calculatedOutsidePerKm),
            outside_surcharge: base.outside_surcharge,
            driver_per_trip: base.driver_per_trip !== undefined ? String(base.driver_per_trip) : "0",
            driver_per_percent: base.driver_per_percent !== undefined ? String(base.driver_per_percent) : "10",
            free_waiting_time: base.free_waiting_time ?? 5,
            waiting_charge: base.waiting_charge ?? 0,
            service_charge_percent: base.service_charge_percent ?? 0,
            night_charge_percent: base.night_charge_percent ?? 0,
            start_time: base.start_time,
            end_time: base.end_time,
            loading_charge: base.loading_charge ?? null,
            unloading_charge: base.unloading_charge ?? null,
            service_charge: base.service_charge ?? null,
            premium_plan_id: base.premium_plan_id ?? null,
            sort_order: sortOrder,
            cancellation_charge_customer: base.cancellation_charge_customer ?? 0,
            cancellation_charge_driver: base.cancellation_charge_driver ?? 0,
            cancellation_charge: base.cancellation_charge ?? null,
            admin_earning: base.admin_earning ?? 0,
            driver_earning: base.driver_earning ?? 0,
            driver_cancel_admin_earning: base.driver_cancel_admin_earning ?? 0,
            driver_cancel_user_earning: base.driver_cancel_user_earning ?? 0,
            user_detail_image: base.user_detail_image ?? null,
            driver_detail_image: base.driver_detail_image ?? null,
            status: base.status ?? 1,
          },
        });
        createdCount++;
        results.push(serializePackage(created, category));
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully processed models (${createdCount} created, ${updatedCount} updated)`,
      createdCount,
      updatedCount,
      data: results,
    });
  } catch (err) {
    return internalError(res, err, "rateCards.generateModels");
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
  generateModels,
};
