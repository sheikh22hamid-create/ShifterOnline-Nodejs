// Pure rules for Customise Orders (spec 2026-10-26): payload validation, bargaining window, vehicle capacity and
// driver eligibility. No DB access here; the service passes in already-loaded rows.

const IST_OFFSET_MS = 330 * 60 * 1000;
const DIM_TO_CM = { cm: 1, m: 100, ft: 30.48, in: 2.54 };
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/** ISO text -> Date. A time with no offset is IST wall-clock (the app's convention). Invalid -> null. */
function parseWhen(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const parsed = HAS_OFFSET.test(text) ? new Date(text) : new Date(new Date(`${text}Z`).getTime() - IST_OFFSET_MS);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const num = (v) => (v === undefined || v === null || v === "" ? NaN : Number(v));
const nonNegInt = (v) => (v === undefined || v === null || v === "" ? 0 : Number(v));
const text = (v) => (typeof v === "string" ? v.trim() : "");

function handling(block, keys, errors, label) {
  const out = {};
  for (const key of keys) {
    const n = nonNegInt(block?.[key]);
    if (!Number.isFinite(n) || n < 0) errors.push(`${label} ${key.replace(/_/g, " ")} must be zero or more`);
    out[key] = Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  }
  out.notes = text(block?.notes) || null;
  return out;
}

function validateCreate(body, now, bounds) {
  const errors = [];
  const b = body || {};

  const pLat = num(b.pickup?.lat), pLng = num(b.pickup?.lng), dLat = num(b.drop?.lat), dLng = num(b.drop?.lng);
  if (![pLat, pLng].every(Number.isFinite) || !text(b.pickup?.address)) errors.push("Pickup location is required");
  if (![dLat, dLng].every(Number.isFinite) || !text(b.drop?.address)) errors.push("Drop location is required");

  const goods = b.goods || {};
  if (!text(goods.description)) errors.push("Goods description is required");
  const qty = num(goods.quantity);
  if (!Number.isFinite(qty) || qty < 1) errors.push("Goods quantity is required");
  const weight = num(goods.weight_kg);
  if (!Number.isFinite(weight) || weight <= 0) errors.push("Goods weight is required");
  const dims = ["length_cm", "width_cm", "height_cm"].map((k) => (goods[k] === undefined || goods[k] === null || goods[k] === "" ? null : Number(goods[k])));
  if (dims.some((d) => d !== null && (!Number.isFinite(d) || d <= 0))) errors.push("Package dimensions must be positive numbers");

  const pickupHandling = handling(b.pickup_handling, ["floor", "carry_m", "helpers", "load_min", "wait_min"], errors, "Pickup");
  const dropHandling = handling(b.drop_handling, ["floor", "carry_m", "helpers", "unload_min", "wait_min"], errors, "Drop");

  const fare = num(b.initial_fare);
  if (!Number.isFinite(fare) || fare < bounds.minFare || fare > bounds.maxFare) {
    errors.push(`Offered fare must be between ${bounds.minFare} and ${bounds.maxFare}`);
  }

  const start = parseWhen(b.bargain_start_at);
  const expiry = parseWhen(b.expires_at);
  if (!start) errors.push("Bargaining start time is required");
  if (!expiry) errors.push("Expiry time is required");
  if (start && start.getTime() < now.getTime()) errors.push("Bargaining start time cannot be in the past");
  if (start && expiry) {
    if (expiry.getTime() <= start.getTime()) errors.push("Expiry time must be after the bargaining start time");
    else if (expiry.getTime() - start.getTime() > bounds.maxWindowHours * 3600 * 1000) {
      errors.push(`Bargaining window cannot be longer than ${bounds.maxWindowHours} hours`);
    }
  }

  const stops = [];
  (Array.isArray(b.stops) ? b.stops : []).forEach((s, i) => {
    const lat = num(s?.lat), lng = num(s?.lng);
    if (![lat, lng].every(Number.isFinite) || !text(s?.address)) {
      errors.push(`Stop ${i + 1} needs a location`);
      return;
    }
    const sub = handling(s, ["floor", "carry_m", "helpers", "load_min", "unload_min", "wait_min"], errors, `Stop ${i + 1}`);
    stops.push({
      seq: i + 1, lat, lng, address: text(s.address), kind: ["pickup", "drop", "both"].includes(s.kind) ? s.kind : "drop",
      goods_desc: text(s.goods_desc) || null, ...sub,
    });
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      pickup: { lat: pLat, lng: pLng, address: text(b.pickup.address), exact: b.pickup.exact !== false && b.pickup.exact !== 0 && b.pickup.exact !== "false" },
      drop: { lat: dLat, lng: dLng, address: text(b.drop.address) },
      goods: {
        description: text(goods.description), quantity: Math.round(qty), weight_kg: weight,
        length_cm: dims[0], width_cm: dims[1], height_cm: dims[2], packing_notes: text(goods.packing_notes) || null,
      },
      pickup_handling: pickupHandling,
      drop_handling: dropHandling,
      category_id: b.category_id ? Number(b.category_id) : null,
      p_method_id: Number(b.p_method_id) || 1,
      initial_fare: fare,
      bargain_start_at: start,
      expires_at: expiry,
      stops,
    },
  };
}

/** Can offers be made on this order right now? Server clock only. */
function isBiddable(order, now) {
  if (!order || order.status !== "open") return { ok: false, reason: "not_open" };
  if (now.getTime() >= new Date(order.expires_at).getTime()) return { ok: false, reason: "expired" };
  if (now.getTime() < new Date(order.bargain_start_at).getTime()) return { ok: false, reason: "not_started" };
  return { ok: true };
}

/** Weight and size against the vehicle category's limits. A NULL limit (or unknown unit) skips that check. */
function driverCanCarry(order, category) {
  const maxLoad = category?.max_load_kg == null ? null : Number(category.max_load_kg);
  if (maxLoad !== null && Number(order.goods_weight_kg) > maxLoad) return { ok: false, reason: "too_heavy" };

  const factor = DIM_TO_CM[String(category?.dim_unit || "cm").toLowerCase()];
  const limits = [category?.dim_length, category?.dim_width, category?.dim_height];
  const cargo = [order.goods_len_cm, order.goods_wid_cm, order.goods_hgt_cm];
  if (factor && limits.every((v) => v != null) && cargo.every((v) => v != null)) {
    const box = limits.map((v) => Number(v) * factor).sort((a, c) => c - a);
    const item = cargo.map(Number).sort((a, c) => c - a);
    if (item.some((side, i) => side > box[i])) return { ok: false, reason: "too_big" };
  }
  return { ok: true };
}

function driverEligible({ order, rider, category, dismissed, excludedRiderIds = [] }) {
  if (!rider || rider.status !== 1) return false;
  if (dismissed || excludedRiderIds.includes(rider.id)) return false;
  if (order.city_id != null && rider.city_id != null && Number(order.city_id) !== Number(rider.city_id)) return false;
  if (order.category_name && String(rider.vehicle).trim().toLowerCase() !== String(order.category_name).trim().toLowerCase()) return false;
  return driverCanCarry(order, category).ok;
}

module.exports = { parseWhen, validateCreate, isBiddable, driverCanCarry, driverEligible };
