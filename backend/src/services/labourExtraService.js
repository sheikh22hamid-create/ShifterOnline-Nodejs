// Loading/Unloading on-site mismatch gate — DB layer (spec 2026-11-24, Phase 1).
// Driver proposes an extra (corrected inputs + photo); it is NOT collected until the customer
// approves it, and only then is the customer wallet debited (key labour_extra:<order>) — same
// no-minting rule as the base hold. On release, payableTotal includes the extra only if approved.

const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const labourSettings = require("./labourSettings");
const { extraDelta, canAddExtra, canApproveExtra } = require("./labourExtra");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** Driver proposes an extra for a bigger-than-declared reality. Requires a photo. No money moves yet. */
async function proposeExtra({ orderId, riderId, mode, heavyItem, legs, photo }) {
  const order = await prisma.pkg_order.findUnique({
    where: { id: Number(orderId) },
    select: { id: true, rid: true, city_id: true, labour_status: true, labour_charge_amount: true },
  });
  if (!order) throw httpError(404, "Order not found");
  if (riderId != null && Number(order.rid) !== Number(riderId)) throw httpError(403, "Not your order");
  if (!canAddExtra(order.labour_status)) throw httpError(409, "Labour is not in a state to add extra");
  if (!photo || !String(photo).trim()) throw httpError(400, "A photo of the real situation is required");

  const config = await labourSettings.getLabourConfig(order.city_id);
  const delta = extraDelta({ mode, heavyItem, legs }, config, order.labour_charge_amount);
  if (delta <= 0) throw httpError(400, "The corrected load is not larger than what was declared");

  await prisma.pkg_order.update({
    where: { id: Number(orderId) },
    data: {
      labour_extra_amount: delta,
      labour_extra_json: JSON.stringify({ mode, heavyItem: heavyItem === true, legs }),
      labour_extra_photo: String(photo).trim(),
      labour_extra_approved: false,
    },
  });
  return { proposed: true, extra: delta };
}

/** Customer approves the pending extra: collect it from the wallet and mark approved, atomically. */
async function approveExtra({ orderId, uid }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.pkg_order.findUnique({
      where: { id: Number(orderId) },
      select: { uid: true, labour_status: true, labour_extra_amount: true, labour_extra_approved: true },
    });
    if (!order) throw httpError(404, "Order not found");
    if (uid != null && Number(order.uid) !== Number(uid)) throw httpError(403, "Not your order");
    if (!canApproveExtra({
      labourStatus: order.labour_status, extraApproved: order.labour_extra_approved, extraAmount: order.labour_extra_amount,
    })) {
      throw httpError(409, "No pending extra to approve");
    }

    const amt = round2(order.labour_extra_amount);
    const key = `labour_extra:${orderId}`;
    const dup = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" }, select: { id: true } });
    if (!dup) {
      const user = await tx.tbl_user.findUnique({ where: { id: Number(order.uid) }, select: { wallet: true } });
      const balance = Math.max(0, round2(user?.wallet) || 0);
      if (balance < amt) throw httpError(402, "Insufficient wallet balance for the extra labour");
      await tx.tbl_user.update({ where: { id: Number(order.uid) }, data: { wallet: { decrement: amt } } });
      await tx.tbl_wallet_history.create({
        data: {
          user_id: Number(order.uid), amount: amt, type: "debit",
          remark: `Extra labour approved for order #${orderId}`, wallet_type: "user",
          order_id: Number(orderId), payment_id: key, created_at: istNow(),
        },
      });
    }

    // Claim the approval atomically with the collection (idempotent against a repeat approve).
    const claimed = await tx.pkg_order.updateMany({
      where: { id: Number(orderId), labour_extra_approved: false, labour_status: "held" },
      data: { labour_extra_approved: true },
    });
    if (claimed.count !== 1) throw httpError(409, "Extra already decided");
    return { approved: true, extra: amt };
  });
}

module.exports = { proposeExtra, approveExtra };
