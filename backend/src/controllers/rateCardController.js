const prisma = require("../config/db");
const logger = require("../utils/logger");

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

function serializePackage(pkg) {
  return { ...pkg, start_time: formatTime(pkg.start_time), end_time: formatTime(pkg.end_time) };
}

async function list(req, res) {
  try {
    const where = {};
    if (req.query.cat_id) where.cat_id = parseInt(req.query.cat_id, 10);
    if (req.query.status !== undefined) where.status = parseInt(req.query.status, 10);

    let rows = await prisma.tbl_package.findMany({ where, orderBy: [{ cat_id: "asc" }, { sort_order: "asc" }] });

    if (req.query.city_id) {
      // city_id is a legacy comma-separated VarChar column, not a real FK —
      // substring match would false-positive ("1" inside "21"), so split first.
      const target = String(parseInt(req.query.city_id, 10));
      rows = rows.filter((p) => (p.city_id || "").split(",").map((s) => s.trim()).includes(target));
    }

    return res.status(200).json({ success: true, total: rows.length, data: rows.map(serializePackage) });
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
    return res.status(200).json({ success: true, data: serializePackage(pkg) });
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

    return res.status(201).json({ success: true, message: "Rate card created", data: serializePackage(created) });
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
      if (b[field] !== undefined) data[field] = b[field];
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
    return res.status(200).json({ success: true, message: "Rate card updated", data: serializePackage(updated) });
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

    await prisma.tbl_package.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Rate card deleted" });
  } catch (err) {
    return internalError(res, err, "rateCards.remove");
  }
}

module.exports = { list, getOne, create, update, remove };
