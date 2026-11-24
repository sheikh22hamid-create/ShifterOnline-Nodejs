// Loading/Unloading labour escrow — DB layer (spec 2026-11-24, Phase 1).
// Wraps the pure labourEscrow state machine with prisma writes and wallet moves. Idempotency is the
// status column itself: each money move claims the 'held' row atomically (updateMany), so a repeated
// drop-OTP or cancel never double-pays. Customer wallet = tbl_user.wallet (+ tbl_wallet_history),
// driver wallet = tbl_rider.wallet_balance.

const prisma = require("./../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const { releasePlan, refundPlan, payableTotal } = require("./labourEscrow");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function hasOpenDispute(orderId, client = prisma) {
  const d = await client.labour_dispute.findFirst({
    where: { order_id: Number(orderId), status: "pending" },
    select: { id: true },
  });
  return !!d;
}

/**
 * At order creation, when the customer opted for labour: COLLECT the charge from the customer wallet
 * and hold it in escrow, atomically. The money is really taken here — release later pays the driver
 * from it, cancel refunds it — so there is no minting: labour_status='held' is set only in the same
 * transaction as the debit, and is itself the proof the money was collected. Idempotent via the
 * `labour_hold:<order>` ledger key. Fails (no hold) if the wallet balance is short.
 */
async function holdLabour({ orderId, mode, amount, declaredJson }) {
  const amt = round2(amount);
  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.pkg_order.findUnique({
        where: { id: Number(orderId) },
        select: { uid: true, labour_status: true },
      });
      if (!order) return { held: false, reason: "order_not_found" };
      if (order.labour_status === "held") return { held: true, amount: amt, already: true };

      const key = `labour_hold:${orderId}`;
      const dup = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" }, select: { id: true } });
      if (dup) return { held: true, amount: amt, already: true };

      if (amt > 0) {
        const user = await tx.tbl_user.findUnique({ where: { id: Number(order.uid) }, select: { wallet: true } });
        const balance = Math.max(0, round2(user?.wallet) || 0);
        if (balance < amt) return { held: false, reason: "insufficient_balance", balance, required: amt };
        await tx.tbl_user.update({ where: { id: Number(order.uid) }, data: { wallet: { decrement: amt } } });
        await tx.tbl_wallet_history.create({
          data: {
            user_id: Number(order.uid), amount: amt, type: "debit",
            remark: `Labour charge held for order #${orderId}`, wallet_type: "user",
            order_id: Number(orderId), payment_id: key, created_at: istNow(),
          },
        });
      }

      await tx.pkg_order.update({
        where: { id: Number(orderId) },
        data: {
          labour_opted: true,
          labour_mode: mode || null,
          labour_charge_amount: amt,
          labour_declared_json: declaredJson ? JSON.stringify(declaredJson) : null,
          labour_status: "held",
        },
      });
      return { held: true, amount: amt };
    });
  } catch (err) {
    logger.error(`labourEscrow.hold order#${orderId}: ${err.message}`);
    return { held: false, reason: "error" };
  }
}

/** At completion / drop-OTP: release 100% to the driver, unless a dispute has frozen the escrow. */
async function releaseLabourOnComplete({ orderId }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.pkg_order.findUnique({
        where: { id: Number(orderId) },
        select: {
          id: true, rid: true, labour_status: true,
          labour_charge_amount: true, labour_extra_amount: true, labour_extra_approved: true,
        },
      });
      if (!order) return { released: false, reason: "order_not_found" };

      const open = await hasOpenDispute(orderId, tx);
      const plan = releasePlan(order.labour_status, open);
      if (!plan.act) return { released: false, reason: open ? "dispute_open" : "not_held" };

      // Atomic claim — idempotent against repeat/concurrent completion.
      const claimed = await tx.pkg_order.updateMany({
        where: { id: Number(orderId), labour_status: "held" },
        data: { labour_status: "released" },
      });
      if (claimed.count !== 1) return { released: false, reason: "already_settled" };

      const total = payableTotal({
        base: order.labour_charge_amount, extra: order.labour_extra_amount, extraApproved: order.labour_extra_approved,
      });
      if (total > 0 && order.rid) {
        await tx.tbl_rider.update({ where: { id: Number(order.rid) }, data: { wallet_balance: { increment: total } } });
      }
      return { released: true, amount: total, riderId: order.rid };
    });
  } catch (err) {
    logger.error(`labourEscrow.release order#${orderId}: ${err.message}`);
    throw err;
  }
}

/** On any cancel path: refund the held labour to the customer wallet. No-op once released/disputed. */
async function refundLabourOnCancel({ orderId }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.pkg_order.findUnique({
        where: { id: Number(orderId) },
        select: {
          id: true, uid: true, labour_status: true,
          labour_charge_amount: true, labour_extra_amount: true, labour_extra_approved: true,
        },
      });
      if (!order) return { refunded: false, reason: "order_not_found" };

      const plan = refundPlan(order.labour_status);
      if (!plan.act) return { refunded: false, reason: "not_held" };

      const claimed = await tx.pkg_order.updateMany({
        where: { id: Number(orderId), labour_status: "held" },
        data: { labour_status: "refunded" },
      });
      if (claimed.count !== 1) return { refunded: false, reason: "already_settled" };

      const total = payableTotal({
        base: order.labour_charge_amount, extra: order.labour_extra_amount, extraApproved: order.labour_extra_approved,
      });
      if (total > 0 && order.uid) {
        const key = `labour_refund:${orderId}`;
        const dup = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" }, select: { id: true } });
        if (!dup) {
          await tx.tbl_user.update({ where: { id: Number(order.uid) }, data: { wallet: { increment: total } } });
          await tx.tbl_wallet_history.create({
            data: {
              user_id: Number(order.uid), amount: total, type: "credit",
              remark: `Labour refund for order #${orderId}`, wallet_type: "user",
              order_id: Number(orderId), payment_id: key, created_at: istNow(),
            },
          });
        }
      }
      return { refunded: true, amount: total };
    });
  } catch (err) {
    logger.error(`labourEscrow.refund order#${orderId}: ${err.message}`);
    throw err;
  }
}

module.exports = { holdLabour, releaseLabourOnComplete, refundLabourOnCancel, hasOpenDispute };
