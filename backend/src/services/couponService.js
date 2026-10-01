const prisma = require("../config/db");

/** "50" -> flat 50, "10%" -> 10 percent. null when the admin-entered value is unusable. */
function parseCouponValue(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const isPercent = text.endsWith("%");
  const n = parseFloat(isPercent ? text.slice(0, -1) : text);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { isPercent, value: n };
}

/**
 * Server-side coupon validation + discount calculation for a booking. The
 * client only sends which coupon it picked (cou_id); the amount is always
 * computed here so it can never be forged. couId 0/empty means "no coupon".
 * Like referral coins, the discount reduces what the CUSTOMER pays at the
 * end of the ride (tripLifecycle nets it off with the advance payment) and
 * the platform absorbs it - driver earning is unaffected.
 */
async function resolveCoupon({ couId, uid, fare }) {
  const id = Number(couId) || 0;
  if (!id) return { ok: true, cou_id: 0, cou_amt: 0 };

  const invalid = (msg) => ({ ok: false, code: "INVALID_COUPON", msg });
  const coupon = await prisma.tbl_coupon.findUnique({ where: { id } });
  if (!coupon || Number(coupon.status) !== 1) return invalid("Coupon is not available");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(coupon.cdate) < today) return invalid("Coupon has expired");
  if (Number(coupon.cusefor) !== 0 && Number(coupon.cusefor) !== Number(uid)) return invalid("Coupon is not valid for this account");

  const used = await prisma.pkg_order.count({ where: { cou_id: id, uid: Number(uid), o_status: { not: "Cancelled" } } });
  if (used >= Number(coupon.ulimit)) return invalid("Coupon usage limit reached");
  if (Number(fare) < Number(coupon.min_amt)) return invalid(`Coupon needs a minimum order of ₹${coupon.min_amt}`);

  const parsed = parseCouponValue(coupon.c_value);
  if (!parsed) return invalid("Coupon value is not configured correctly");
  const raw = parsed.isPercent ? (Number(fare) * parsed.value) / 100 : parsed.value;
  const amount = Math.round(Math.min(raw, Number(fare)) * 100) / 100;
  return { ok: true, cou_id: id, cou_amt: amount };
}

module.exports = { resolveCoupon, parseCouponValue };
