const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const pricingEngine = require("./pricingEngine");
const walletAdvance = require("./walletAdvanceService");
const walletNotifier = require("./walletNotifier");

// Replace Driver (customer taps it in the Cancel Order popup after a driver is assigned).
//
// 1st replace: NOT a cancellation. The same order goes back to Pending and is searched again without the replaced
//   driver; that driver gets nothing and pays nothing. The advance the customer paid for them stays with the
//   customer as wallet money (a Razorpay advance already is wallet money; a wallet-paid one is handed back) and is
//   remembered in order_driver_replacement (status 'held'). The next driver takes a fresh advance as usual.
// 2nd replace before the ride is complete: the ride is cancelled through the normal customer-cancel path (the
//   current driver gets the admin-configured cancellation compensation) AND the first driver is settled: the held
//   advance is reversed out of the customer's ledger and that driver is paid the same admin-configured compensation.
// If the 2nd driver completes the ride the held row is never settled: the first driver gets nothing and the
//   customer keeps the first advance (nothing in tripLifecycle's completion path touches it).
//
// Money is only ever moved under a unique ledger key, and the held row is claimed with a compare-and-set, so a
// repeated request or event can never charge or pay twice.

const PRE_PICKUP_STATUS = new Set([1, 2]);
const PRE_PICKUP_O_STATUS = new Set(["processing", "pickup"]);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const reverseKey = (orderId, riderId) => `replace_advance_reverse:${orderId}:${riderId}`;
const compKey = (orderId, riderId) => `replace_driver_comp:${orderId}:${riderId}`;

class Refused extends Error {}

const lazy = {
  tripLifecycle: () => require("./tripLifecycle"),
  dispatchManager: () => require("./dispatchManager"),
  relive: () => require("./driverCancelRelive"),
  pushNotifier: () => require("./pushNotifier"),
};

/**
 * First replace, one transaction: lock the order, hand the paid advance back to the wallet, remember it, and put the
 * order back to the unassigned Pending state. Resolves { order, replacedRiderId } or throws Refused.
 */
async function firstReplace(tx, order) {
  const orderId = Number(order.id);
  const riderId = Number(order.rid);
  const paid = Number(order.payment_status) === 1 && Number(order.advance_payment) > 0;
  const advance = paid ? Math.round(Number(order.advance_payment)) : 0;

  const generation = (await tx.$queryRaw`SELECT COUNT(*) AS n FROM order_driver_replacement WHERE order_id = ${orderId}`)[0];
  const seq = Number(generation?.n || 0) + 1;

  if (advance > 0) {
    // A wallet-paid advance left the wallet when it was paid: give it back so it is wallet money exactly like a
    // Razorpay advance. Then retire that generation's ledger keys, because the next driver's advance reuses the
    // per-order keys (advance_apply:<order>, advance_wallet_refund:<order>) and must not see these rows.
    const refunded = await walletAdvance.refundWalletAdvanceIfAny(orderId, tx);
    const retire = [walletAdvance.applyKey(orderId), `advance_wallet_refund:${orderId}`];
    for (const key of retire) {
      await tx.tbl_wallet_history.updateMany({ where: { payment_id: key, order_id: orderId }, data: { payment_id: `${key}:replaced${seq}` } });
    }
    if (refunded > 0) logger.info(`driverReplace: order ${orderId} wallet advance ₹${refunded} returned to the customer's wallet`);
  }

  await tx.$executeRaw`
    INSERT INTO order_driver_replacement (order_id, rider_id, advance_amount, status, created_at)
    VALUES (${orderId}, ${riderId}, ${advance}, 'held', NOW())`;

  const moved = await tx.$executeRaw`
    UPDATE pkg_order
    SET rid = 0, order_status = 0, o_status = 'Pending', accept_time = NULL,
        payment_status = 0, advance_payment = '0', razorpay_payment_id = NULL
    WHERE id = ${orderId} AND rid = ${riderId} AND o_status NOT IN ('Completed', 'Cancelled')`;
  if (moved !== 1) throw new Refused("Order changed. Please try again.");

  // Driver-side leftovers, same as an undone assignment: never offer it to this driver again, drop their trip state.
  await tx.tbl_order_requests.updateMany({
    where: { order_id: orderId, rider_id: riderId, status: { in: ["sent", "accepted"] } },
    data: { status: "10" },
  });
  await tx.driver_trip_progress.deleteMany({ where: { order_id: orderId } });
  await tx.pkg_order_wait_timer.deleteMany({ where: { order_id: orderId, rid: riderId } });
  await tx.driver_trip_event.deleteMany({ where: { order_id: orderId, milestone: "arrived" } });
  try { await tx.$executeRaw`UPDATE pkg_order SET pickup_deadline_at = NULL WHERE id = ${orderId}`; } catch (_) { /* column not on this DB yet */ }
  // Deliberately NOT "Driver Cancelled": that row makes the next accept keep the old advance and counts toward the
  // driver-cancel re-live limit, and this was the customer's choice, not the driver's cancel.
  await tx.order_status_history.create({
    data: { order_id: orderId, rider_id: riderId, status: "Driver Replaced", remark: "Customer replaced the driver", created_at: new Date() },
  });
  return { order, replacedRiderId: riderId };
}

async function tellReplacedDriver(riderId, orderId) {
  const reason = "The customer replaced the driver for this order";
  try {
    lazy.dispatchManager().emitDriverEvent(riderId, "order:customer_cancelled", { order_id: orderId, reason, order_status: 4, o_status: "Cancelled" });
    const rider = await prisma.tbl_rider.findUnique({ where: { id: Number(riderId) }, select: { fcm_token: true } });
    if (rider?.fcm_token) await lazy.pushNotifier().notifyDriverCustomerCancelled(rider.fcm_token, orderId, reason);
  } catch (err) {
    logger.error(`driverReplace: could not tell driver ${riderId} about order ${orderId}:`, err);
  }
  // WhatsApp Trial Order: a replaced WhatsApp-channel driver is told the order is no longer theirs.
  try {
    require("../whatsapp/driverOrder/flow").notifyOrderChanged(Number(orderId), { kind: "cancelled" }).catch(() => {});
  } catch (_) { /* bot flow unavailable in this process */ }
}

/**
 * Settle every still-held first driver of a cancelled order: reverse the held advance from the customer's ledger and
 * pay the driver the admin-configured cancellation compensation. Idempotent: the held row is claimed with a
 * compare-and-set and each ledger row sits under a unique key.
 */
async function settleHeldReplacements(orderId) {
  const order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) } });
  if (!order) return [];
  const pkg = order.delivery_type ? await pricingEngine.getPackageById(order.delivery_type) : null;
  const compensation = round2(Number(pkg?.driver_earning) || 0);
  const held = await prisma.$queryRaw`SELECT id, rider_id, advance_amount FROM order_driver_replacement WHERE order_id = ${Number(orderId)} AND status = 'held'`;
  const settled = [];
  for (const row of held) {
    const riderId = Number(row.rider_id);
    const advance = round2(row.advance_amount);
    const notes = [];
    try {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.$executeRaw`UPDATE order_driver_replacement SET status = 'forfeited', settled_at = NOW() WHERE id = ${Number(row.id)} AND status = 'held'`;
        if (claimed !== 1) return; // another request already settled it
        if (advance <= 0) return; // no advance was taken for this driver: nothing to reverse, nothing to pay
        await tx.tbl_user.update({ where: { id: Number(order.uid) }, data: { wallet: { decrement: advance } } });
        await tx.tbl_wallet_history.create({
          data: {
            user_id: Number(order.uid), amount: advance, type: "debit", wallet_type: "user", order_id: Number(orderId),
            payment_id: reverseKey(orderId, riderId),
            remark: `Advance of the replaced driver applied as cancellation charge - order #${orderId}`,
            created_at: istNow(),
          },
        });
        if (compensation > 0) {
          const remark = `Cancellation compensation (customer replaced you) for order #${orderId}`;
          await tx.tbl_rider.update({ where: { id: riderId }, data: { wallet_balance: { increment: compensation } } });
          await tx.tbl_wallet_history.create({
            data: {
              user_id: riderId, amount: compensation, type: "credit", wallet_type: "driver", order_id: Number(orderId),
              payment_id: compKey(orderId, riderId), remark, created_at: istNow(),
            },
          });
          notes.push({ riderId, type: "credit", amount: compensation, remark });
        }
        settled.push(riderId);
      });
    } catch (err) {
      logger.error(`driverReplace: settling replaced driver ${riderId} of order ${orderId} failed (row stays 'held' for a retry):`, err);
      continue;
    }
    for (const n of notes) {
      walletNotifier.notifyDriverWalletTransaction(n.riderId, { type: n.type, amount: n.amount, remark: n.remark })
        .catch((err) => logger.error(`driverReplace: wallet notify failed for rider ${n.riderId}:`, err));
    }
  }
  return settled;
}

/**
 * The customer's Replace Driver tap. Resolves { success, msg, cancelled? }:
 *   first time  -> { success: true, replaced: true }   (booking continues, new search started)
 *   second time -> { success: true, cancelled: true }  (ride cancelled, both drivers settled)
 */
async function replaceDriver(uid, orderId) {
  uid = Number(uid);
  orderId = Number(orderId);
  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const order = (await tx.$queryRaw`
        SELECT id, uid, rid, order_status, o_status, advance_payment, payment_status, delivery_type, customise_order_id
        FROM pkg_order WHERE id = ${orderId} FOR UPDATE`)[0];
      if (!order || Number(order.uid) !== uid) throw new Refused("Order not found");
      const status = String(order.o_status || "").trim().toLowerCase();
      if (status === "completed" || status === "cancelled" || [4, 5].includes(Number(order.order_status))) throw new Refused("This order can no longer be changed.");
      if (order.customise_order_id != null) throw new Refused("A driver cannot be replaced on a Customise Order.");
      if (!(Number(order.rid) > 0)) throw new Refused("No driver is assigned to this order yet.");
      if (!PRE_PICKUP_STATUS.has(Number(order.order_status)) || !PRE_PICKUP_O_STATUS.has(status)) {
        throw new Refused("The driver can only be replaced before the pickup.");
      }
      const held = (await tx.$queryRaw`SELECT COUNT(*) AS n FROM order_driver_replacement WHERE order_id = ${orderId} AND status = 'held' FOR UPDATE`)[0];
      if (Number(held?.n || 0) > 0) return { second: true, order };
      return { second: false, ...(await firstReplace(tx, order)) };
    });
  } catch (err) {
    if (err instanceof Refused) return { success: false, msg: err.message };
    logger.error(`driverReplace: order ${orderId} not replaced:`, err);
    return { success: false, msg: "Could not replace the driver. Please try again." };
  }

  if (!outcome.second) {
    await tellReplacedDriver(outcome.replacedRiderId, orderId);
    await lazy.relive().afterRelive({ orderId, riderId: outcome.replacedRiderId, reason: "You replaced the driver. Finding you a new driver." });
    return { success: true, replaced: true, msg: "Driver replaced. We are finding you a new driver." };
  }

  // Second replace: cancel the ride the normal way (current driver's compensation, advance handling, notifications),
  // then settle the first driver. The cancel is a compare-and-set on the order, so a duplicate request cancels once.
  const cancel = await lazy.tripLifecycle().customerCancel(uid, orderId, "Customer replaced the driver again - ride cancelled");
  if (!cancel.success) return { success: false, msg: cancel.msg || "Order cannot be cancelled" };
  const settled = await settleHeldReplacements(orderId);
  if (settled.length === 0) {
    const left = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM order_driver_replacement WHERE order_id = ${orderId} AND status = 'held'`;
    if (Number(left[0]?.n || 0) > 0) logger.error(`driverReplace: order ${orderId} cancelled but the first driver is still unsettled - run settleHeldReplacements again`);
  }
  return { success: true, cancelled: true, msg: "Order cancelled. Both drivers have been settled." };
}

module.exports = { replaceDriver, settleHeldReplacements, reverseKey, compKey };
