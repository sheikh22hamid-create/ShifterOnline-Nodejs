const prisma = require("../config/db");
const dispatchManager = require("./dispatchManager");
const lockManager = require("./lockManager");
const pricingEngine = require("./pricingEngine");
const driverPlanService = require("./driverPlanService");
const pushNotifier = require("./pushNotifier");
const adminSocket = require("../sockets/adminSocket");
const logger = require("../utils/logger");
const { haversineKm } = require("../utils/geoDistance");
const { POPUP_TIMEOUT_MS, PICKUP_OTP_TIMEOUT_MS } = require("../config/constants");

function notifyAdminStatus(order) {
  try {
    adminSocket.notifyOrderStatusUpdate(order);
  } catch (err) {
    logger.error(`notifyAdminStatus failed for order ${order?.id}:`, err);
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// This DB's datetime columns are read elsewhere (the PHP admin/customer/
// driver APIs, e.g. cust_api/wallet_history.php) as IST wall-clock text —
// same convention already established for acceptOrder's accept_time write
// above and pricingEngine.isNightNow. A wallet_history row written with a
// plain `new Date()` stores true UTC digits (confirmed live: MySQL's NOW()
// and UTC_TIMESTAMP() are identical on this DB), which wallet_history.php
// then echoes straight from the DB with no timezone conversion — every
// entry showed ~5.5 hours behind the real IST time it was created at
// (order #1754: the commission-debit entry stamped 06:45 for what was
// actually a midday IST event). Mirrors acceptOrder's own
// `DATE_ADD(NOW(), INTERVAL 330 MINUTE)` shift, just from the JS side.
function istNow() {
  return new Date(Date.now() + 330 * 60 * 1000);
}

/**
 * Thrown inside acceptOrder's transaction to trigger a rollback and select
 * which clean failure message to return. Never escapes acceptOrder itself.
 */
class OfferNotFreshError extends Error {}
class OrderAlreadyTakenError extends Error {}

/**
 * Atomic first-come-first-served acceptance (spec §4.5), gated on the
 * accepted offer's own freshness — never the in-memory setTimeout, which is
 * lost on crash/restart. Two atomic conditional UPDATEs run inside one DB
 * transaction, so either both apply or neither does:
 *   1. tbl_order_requests: claims THIS rider's offer for THIS order, only if
 *      it is still 'sent' and less than POPUP_TIMEOUT_MS old — per MySQL's
 *      own NOW(), not the Node process clock, so a crashed/restarted server
 *      can never make a stale offer acceptable again.
 *   2. pkg_order: claims the booking, only if still unassigned/searchable.
 * Whichever UPDATE's WHERE clause a concurrent expiry-sweep or a competing
 * accept fails to match affects 0 rows — InnoDB's row lock on the same
 * request row is what makes "accept vs. expiry at the same instant"
 * deterministic, with no extra app-level locking needed.
 */
/**
 * Fast path: just the atomic first-come-first-served claim (spec §4.5) —
 * the two conditional UPDATEs below, inside one transaction. Returns the
 * instant the claim itself is decided, without waiting on anything
 * finalizeAcceptedOrder does afterward (streak tracking, pricing off the
 * driver's real distance, advance_payment, admin/customer notifications) —
 * several sequential DB round-trips that have no bearing on whether THIS
 * accept won. orderSocket's order:accept handler acks the driver right off
 * this, then calls finalizeAcceptedOrder in the background: measured live,
 * the combined wait was costing the driver's own accept ack ~8s — almost
 * entirely finalize work — before "waiting for advance payment" could even
 * open (see ShifterDriver's OrderDetailsActivity). acceptOrder() below
 * still runs both in sequence for callers that want the one-shot result.
 */
async function claimOrderForRider(orderId, riderId) {
  const popupSeconds = POPUP_TIMEOUT_MS / 1000;
  let acceptedPackageId = null;

  // Check if order is already assigned to this rider (e.g. direct assigned by admin or queue)
  const existingOrder = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  if (existingOrder && existingOrder.rid === riderId && existingOrder.o_status !== "Cancelled") {
    return { success: true, acceptedPackageId: existingOrder.delivery_type || 1 };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const requestAffected = await tx.$executeRaw`
        UPDATE tbl_order_requests
        SET status = 'accepted'
        WHERE order_id = ${orderId}
          AND rider_id = ${riderId}
          AND status = 'sent'
          AND created_at > (NOW() - INTERVAL ${popupSeconds} SECOND)
      `;
      if (requestAffected === 0) {
        throw new OfferNotFreshError();
      }

      const acceptedRequest = await tx.tbl_order_requests.findFirst({
        where: { order_id: orderId, rider_id: riderId, status: "accepted" },
        orderBy: { id: "desc" },
      });
      acceptedPackageId = acceptedRequest ? acceptedRequest.package_id : (existingOrder?.delivery_type || 1);

      const orderAffected = await tx.$executeRaw`
        UPDATE pkg_order
        SET rid = ${riderId},
            order_status = 1,
            o_status = 'Processing',
            accept_time = DATE_ADD(NOW(), INTERVAL 330 MINUTE)
        WHERE id = ${orderId} AND (rid = 0 OR rid = ${riderId}) AND o_status != 'Cancelled'
      `;
      if (orderAffected === 0) {
        throw new OrderAlreadyTakenError();
      }
    });
  } catch (err) {
    if (err instanceof OfferNotFreshError) {
      const requestRow = await prisma.tbl_order_requests.findFirst({
        where: { order_id: orderId, rider_id: riderId },
        orderBy: { id: "desc" },
      });
      if (requestRow && requestRow.status === "sent") {
        return { success: false, msg: "Offer expired" };
      }
      return { success: false, msg: "Order already taken or cancelled" };
    }
    if (err instanceof OrderAlreadyTakenError) {
      return { success: false, msg: "Order already taken or cancelled" };
    }
    throw err;
  }

  return { success: true, acceptedPackageId };
}

/**
 * Everything after a successful claim: streak tracking, pricing off the
 * accepting driver's real distance, advance_payment, admin/customer
 * notifications. Split out from claimOrderForRider so the driver's own
 * accept ack doesn't wait on any of it — see that function's comment.
 */
async function finalizeAcceptedOrder(orderId, riderId, acceptedPackageId) {
  // An accept that lost the race (claimOrderForRider returned success:
  // false) never reaches here, so this can't wrongly reset the streak for
  // an attempt that didn't really succeed.
  await dispatchManager.recordModel1Outcome(riderId, acceptedPackageId, "accept");

  const [order, rider] = await Promise.all([
    prisma.pkg_order.findUnique({ where: { id: orderId } }),
    prisma.tbl_rider.findUnique({ where: { id: riderId } }),
  ]);

  // The accepting driver's real distance to pickup — NOT order.radius_range
  // (the customer's chosen search-radius setting) — is what the fare's own
  // radius charge must bill (see pricingEngine.calculateRadiusCharge):
  // widening the search radius must never change what THIS driver is
  // charged for, only how far dispatch was willing to look for one.
  // `?? NaN` before Number(): a null/undefined rlats/rlongs (driver never
  // sent a location fix) must fail the isFinite check below, not coerce to
  // 0 — Number(null) is 0, not NaN, which would silently treat a
  // location-less driver as sitting at (0,0) in the Atlantic.
  const driverLat = Number(rider?.rlats ?? NaN);
  const driverLng = Number(rider?.rlongs ?? NaN);
  const pickupLat = Number(order.plat ?? NaN);
  const pickupLng = Number(order.plong ?? NaN);
  const driverToPickupKm = [driverLat, driverLng, pickupLat, pickupLng].every(Number.isFinite)
    ? haversineKm(driverLat, driverLng, pickupLat, pickupLng)
    : 1; // unknown location -> same "zero radius charge" default used everywhere else

  const { pkg, fare, commission, radiusCharge } = await pricingEngine.priceForPackageId(
    acceptedPackageId,
    Number(order.distance) || 0,
    driverToPickupKm,
    Number(order.extra_mile_charge) || 0,
    order.uid
  );

  // driver_earning stores the full gross fare (same number the popup and
  // customer estimate already show), not the commission-deducted net
  // amount — commission is instead clawed back separately at ride
  // completion (see updateStatus's cash-order wallet debit below), net of
  // any advance_payment already collected.
  const priced = { d_charge: fare, total_dcharge: fare, delivery_type: Number(acceptedPackageId), driver_earning: fare, commission };
  await prisma.pkg_order.update({ where: { id: orderId }, data: priced });

  // Release this rider's own popup lock, then dismiss every OTHER driver
  // still holding a popup for this order and cancel remaining timers.
  lockManager.releaseLock(riderId);
  dispatchManager.stopDispatch(orderId, "accepted_by_other");

  notifyAdminStatus(order);

  // Advance payment: the same radiusCharge just billed into d_charge/
  // total_dcharge above (driver's real pickup distance beyond the free 1km,
  // at the package's pickup_per_km_charge) + admin's existing per-package
  // cancellation charge (tbl_package.cancellation_charge_customer — already
  // the field customerCancel() above charges on a post-accept cancel).
  // Covers the driver's cost of travelling to pickup plus the cancellation
  // risk, charged upfront right when the driver accepts (both apps show a
  // "waiting for advance payment" screen at this exact moment). Reusing
  // pricingEngine's own radiusCharge — instead of this file separately
  // recomputing driverToPickupKm * pickupPerKm with no free-1km allowance —
  // keeps this upfront charge and the fare's own radius component from ever
  // drifting apart again.
  //
  // advance_payment isn't in Prisma's schema for pkg_order (confirmed via
  // introspection — the live column exists but was never modeled), so this
  // is a raw SQL write rather than a typed .update() call, same as the
  // accept transaction's own writes above.
  const customerPlan = await pricingEngine.getActiveCustomerPlan(order.uid);
  let advancePayment = Math.round((Number(pkg?.cancellation_charge_customer) || 0) + (Number(radiusCharge) || 0));
  if (customerPlan && customerPlan.noAdvancePayment) {
    advancePayment = 0;
  }
  await prisma.$executeRaw`UPDATE pkg_order SET advance_payment = ${String(advancePayment)} WHERE id = ${orderId}`;

  const customer = await prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { fcm_token: true } });
  // FCM is only a background/reconnect fallback.  It must not block the
  // customer's order:assigned event (see orderSocket, which emits that
  // once this whole finalize step resolves).  Waiting for a slow FCM
  // request here made the customer app sit on its old screen for ~10s.
  void pushNotifier.notifyCustomerOrderAssigned(customer?.fcm_token, {
    order_id: orderId,
    rider_name: `${rider.first_name || ""} ${rider.last_name || ""}`.trim(),
    rider_phone: rider.fmobile,
    vehicle_no: rider.vehicle_no,
    otp: order.otp,
  }).catch((err) => {
    logger.error(`notifyCustomerOrderAssigned failed for order ${orderId}:`, err);
  });

  return {
    order: { ...order, ...priced, advance_payment: String(advancePayment), package: pkg },
    rider,
  };
}

/**
 * Convenience wrapper preserving the old one-call accept contract (claim +
 * finalize, run in sequence, single combined result) for callers that want
 * the whole thing done before they get anything back — this file's own
 * test suite included. orderSocket's order:accept handler calls
 * claimOrderForRider/finalizeAcceptedOrder directly instead, specifically
 * so the driver's accept ack doesn't wait on finalize (see its comment).
 */
async function acceptOrder(orderId, riderId) {
  const claim = await claimOrderForRider(orderId, riderId);
  if (!claim.success) return claim;
  const finalized = await finalizeAcceptedOrder(orderId, riderId, claim.acceptedPackageId);
  return { success: true, ...finalized };
}

/**
 * packageId, when the client sends it (the exact tier they were shown —
 * every popup payload already carries package_id), identifies which row to
 * reject directly, instead of inferring it from the rider's current
 * in-memory lock. order:reject is fire-and-forget with no ack (see
 * NodeSocketManager.emitReject) — if the app's own socket connection blips
 * right when the driver taps Reject, the event can arrive after this
 * popup's own 15s timeout has already fired server-side and released the
 * lock. The old lock-only lookup had nothing left to infer the tier from
 * at that point and silently dropped the reject — recorded as a plain
 * timeout instead — so the rider kept getting offered this order's later
 * tiers despite having explicitly rejected it (confirmed live: three
 * consecutive orders where every tier ended in 'timeout', never '10',
 * despite the driver rejecting).
 *
 * packageId is still cross-checked against the rider's CURRENT lock before
 * ever releasing it — a lock for a NEWER tier of this order (or a
 * different order) must be left alone; it belongs to a popup this reject
 * was never about (confirmed live on order #1503: matching only orderId,
 * not tier, let a stale reject wrongly flip a NEWER tier's still-legitimately
 * -'sent' row).
 */
async function rejectOrder(orderId, riderId, packageId = null) {
  const lock = lockManager.peekLock(riderId);
  const lockMatchesThisOrder = !!lock && lock.orderId === orderId;

  let resolvedPackageId = packageId != null ? Number(packageId) : null;
  if (!Number.isFinite(resolvedPackageId)) {
    if (!lockMatchesThisOrder) {
      // No client-supplied packageId (older app) and no matching lock to
      // infer it from — nothing of theirs for THIS order left to touch.
      return { success: true };
    }
    resolvedPackageId = lock.packageId;
  }

  // DB write before lock release, not after: releasing the lock first makes
  // this rider immediately eligible for the cascade's next tier, which can
  // fire (and even complete) before this status write lands.
  //
  // Matches 'timeout' too, not just 'sent': a reject that arrives after
  // this popup's own expiry already wrote 'timeout' must still be able to
  // upgrade that row to '10' — that's the whole point of trusting the
  // client's own packageId instead of the (by then already-gone) lock.
  const result = await prisma.tbl_order_requests.updateMany({
    where: { order_id: orderId, rider_id: riderId, package_id: Number(resolvedPackageId), status: { in: ["sent", "timeout"] } },
    data: { status: "10" },
  });
  if (result.count > 0) {
    await dispatchManager.recordModel1Outcome(riderId, resolvedPackageId, "miss");
  }

  // Only release the lock if it's actually the one for this exact tier.
  if (lockMatchesThisOrder && Number(lock.packageId) === Number(resolvedPackageId)) {
    lockManager.releaseLock(riderId);
  }

  return { success: true };
}

async function updateStatus(orderId, riderId, status) {
  const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  if (!order) {
    return { success: false, msg: "Order not found" };
  }
  if (order.rid !== riderId) {
    return { success: false, msg: "Not authorized for this order" };
  }

  if (status === "arrived") {
    const now = new Date();
    await prisma.pkg_order.update({
      where: { id: orderId },
      data: { order_status: 2, o_status: "Pickup" },
    });
    await prisma.pkg_order_wait_timer.upsert({
      where: { order_id_rid: { order_id: orderId, rid: riderId } },
      create: { order_id: orderId, rid: riderId, pickup_wait_start: now, created_at: now },
      update: { pickup_wait_start: now, updated_at: now },
    });
    notifyAdminStatus({ id: orderId, city_id: order.city_id, order_status: 2, o_status: "Pickup", rid: riderId });
    return { success: true, order_status: 2, o_status: "Pickup" };
  }

  if (status === "pickup") {
    const now = new Date();
    const waitTimer = await prisma.pkg_order_wait_timer.findUnique({
      where: { order_id_rid: { order_id: orderId, rid: riderId } },
    });
    const pickupWaitSeconds = waitTimer?.pickup_wait_start
      ? Math.max(0, Math.round((now - new Date(waitTimer.pickup_wait_start)) / 1000))
      : 0;

    await prisma.pkg_order.update({
      where: { id: orderId },
      data: { order_status: 3, o_status: "On_Route", pickup_time: now },
    });
    await prisma.pkg_order_wait_timer.update({
      where: { order_id_rid: { order_id: orderId, rid: riderId } },
      data: { pickup_wait_end: now, pickup_wait_seconds: pickupWaitSeconds, updated_at: now },
    });
    notifyAdminStatus({ id: orderId, city_id: order.city_id, order_status: 3, o_status: "On_Route", rid: riderId });
    return { success: true, order_status: 3, o_status: "On Route" };
  }

  if (status === "complete") {
    const now = new Date();
    const waitTimer = await prisma.pkg_order_wait_timer.findUnique({
      where: { order_id_rid: { order_id: orderId, rid: riderId } },
    });

    const freeWaitSeconds = parseFloat(order.free_waiting_time) || 0;
    const totalWaitSeconds = waitTimer?.pickup_wait_seconds || 0;
    const chargeableWaitSeconds = Math.max(0, totalWaitSeconds - freeWaitSeconds);
    const waitingChargeRate = Number(order.wating_charge) || 0;
    const waitingCharge = round2((chargeableWaitSeconds / 60) * waitingChargeRate);

    const finalTotal = round2(Number(order.total_dcharge) + waitingCharge);

    // A driver may hold multiple subscriptions. Select the single plan that
    // produces the lowest deduction for this specific fare; benefits never
    // stack and a worse plan can never reduce the normal rate-card earning.
    const baseCommissionPercent = Number(order.commission) || 0;
    const driverBenefit = await driverPlanService.resolveBestBenefit(riderId, finalTotal, baseCommissionPercent);
    const effectiveCommissionPercent = driverBenefit && driverBenefit.benefit > 0
      ? driverBenefit.commissionPercent
      : baseCommissionPercent;

    await prisma.pkg_order.update({
      where: { id: orderId },
      data: {
        order_status: 5,
        o_status: "Completed",
        // Both are display-only (invoice_date / order_deliver_date to the
        // apps), never read back by Node for a calculation — safe to store
        // IST-shifted like the wallet_history writes above. `now` itself
        // stays true UTC for the wait-timer arithmetic just below, which
        // only ever diffs against other `now`-based values and must not be
        // shifted (order #1754 also showed this exact bug on ddate/drop_time:
        // 06:45:03 stored for what was really a ~12:14pm IST completion).
        ddate: istNow(),
        drop_time: istNow(),
        total_dcharge: finalTotal,
        commission: effectiveCommissionPercent,
      },
    });

    if (waitTimer) {
      await prisma.pkg_order_wait_timer.update({
        where: { order_id_rid: { order_id: orderId, rid: riderId } },
        data: {
          drop_wait_end: now,
          total_wait_seconds: totalWaitSeconds,
          updated_at: now,
        },
      });
    }

    // advance_payment isn't in Prisma's schema for pkg_order (same unmapped-
    // column gap documented in acceptOrder/driverCancel) — prisma.pkg_order.
    // findUnique() silently drops any column it has no model field for
    // instead of erroring, so `order.advance_payment` is always undefined.
    // Fetched once here via the same raw-SQL pattern driverCancel already
    // uses, and reused below both to net the driver's commission claw-back
    // and to clear the customer's advance-payment wallet credit.
    const [advanceRow] = await prisma.$queryRaw`SELECT advance_payment FROM pkg_order WHERE id = ${orderId}`;
    const advancePaymentCollected = Number(advanceRow?.advance_payment) || 0;

    const rider = await prisma.tbl_rider.findUnique({
      where: { id: riderId },
      select: { id: true, monthly_plan: true },
    });
    const isMonthlyDriver = Number(rider?.monthly_plan) === 1;

    const isCashOrder = (order.trans_id || "").toLowerCase().startsWith("cash") || Number(order.p_method_id) === 2 || Number(order.p_method_id) === 0;
    const cashCollected = isCashOrder ? Math.max(0, finalTotal - advancePaymentCollected) : 0;

    if (isMonthlyDriver) {
      if (cashCollected > 0) {
        const existingLedger = await prisma.monthly_driver_ledger.findFirst({
          where: {
            rider_id: riderId,
            order_id: orderId,
            entry_type: "CASH_COLLECTED",
          },
        });
        if (!existingLedger) {
          const todayDate = new Date(new Date(Date.now() + 330 * 60 * 1000).toISOString().split("T")[0]);
          await prisma.monthly_driver_ledger.create({
            data: {
              rider_id: riderId,
              order_id: orderId,
              duty_date: todayDate,
              entry_type: "CASH_COLLECTED",
              amount: cashCollected,
              balance_effect: "DEBIT",
              notes: `Cash collected for order #${orderId} (Fare: ₹${finalTotal}${advancePaymentCollected > 0 ? `, Advance paid online: ₹${advancePaymentCollected}` : ""})`,
              created_at: istNow(),
            },
          });

          await prisma.driver_duty_log.updateMany({
            where: {
              rider_id: riderId,
              duty_date: todayDate,
              status: "in_progress",
            },
            data: {
              cash_collected: { increment: cashCollected },
            },
          });
        }
      }
    } else if (isCashOrder && (effectiveCommissionPercent > 0 || driverBenefit?.perTripCharge > 0 || advancePaymentCollected > 0)) {
      // order.commission is a percentage (matches the legacy PHP DB
      // convention — see pricingEngine.js), not a ₹ amount — convert before
      // touching real money. Computed off finalTotal (includes waiting
      // charge), not the pre-waiting-charge d_charge, since that's the
      // actual final fare the customer/driver settle on.
      const commission = pricingEngine.commissionAmount(finalTotal, effectiveCommissionPercent);
      const perTripCharge = driverBenefit?.benefit > 0 ? driverBenefit.perTripCharge : 0;

      // The driver popup shows (and the driver collects in cash) the FULL
      // fare — but the customer already paid advance_payment online at
      // accept time (tripLifecycle.acceptOrder), which is money admin
      // already holds. Only the commission still outstanding after that
      // advance is clawed back from the driver's wallet here; debiting the
      // full commission again would double-charge the driver for the
      // portion admin already collected upfront.
      const netCommissionDue = Math.max(0, commission + perTripCharge - advancePaymentCollected);

      // Guarded the same way the advance-payment debit below is: a retried or
      // duplicate 'complete' call (order #1790 showed this live — two
      // "Admin deduction" debits nine seconds apart, ₹93 taken instead of
      // ₹93 once) must not claw back commission from the driver's wallet
      // twice for the same order.
      if (netCommissionDue > 0) {
        const commissionKey = `commission_debit:${orderId}`;
        const alreadyDebited = await prisma.tbl_wallet_history.findFirst({
          where: { payment_id: commissionKey, type: "debit", wallet_type: "driver" },
        });
        if (!alreadyDebited) {
          await prisma.tbl_rider.update({
            where: { id: riderId },
            data: { wallet_balance: { decrement: netCommissionDue } },
          });
          await prisma.tbl_wallet_history.create({
            data: {
              user_id: riderId,
              amount: netCommissionDue,
              type: "debit",
              remark: `Admin deduction for order #${orderId}${driverBenefit?.benefit > 0 ? ` (${driverBenefit.plan.plan_name})` : ""}`,
              wallet_type: "driver",
              order_id: orderId,
              payment_id: commissionKey,
              created_at: istNow(),
            },
          });
        }
      }

      // The reverse case (order #1832): a small/low-fare cash trip where the
      // flat advance_payment collected online is bigger than what admin is
      // actually owed (commission + perTripCharge). The driver then only
      // collects a reduced cash-in-hand (fare - advance) that's LESS than
      // their real net earning (fare - commission - perTripCharge) — the
      // leftover advance is sitting with admin and belongs to the driver.
      // pkg_history.php's own "wallet_adjustment" display already computes
      // this exact shortfall and shows "₹X added to wallet" on the driver's
      // trip-detail screen, but nothing here ever actually paid it — the
      // driver's real wallet never received a matching credit for it.
      const advanceRefundDue = Math.max(0, advancePaymentCollected - (commission + perTripCharge));
      if (advanceRefundDue > 0) {
        const refundKey = `advance_refund:${orderId}`;
        const alreadyRefunded = await prisma.tbl_wallet_history.findFirst({
          where: { payment_id: refundKey, type: "credit", wallet_type: "driver" },
        });
        if (!alreadyRefunded) {
          await prisma.tbl_rider.update({
            where: { id: riderId },
            data: { wallet_balance: { increment: advanceRefundDue } },
          });
          await prisma.tbl_wallet_history.create({
            data: {
              user_id: riderId,
              amount: advanceRefundDue,
              type: "credit",
              remark: `Advance payment balance for order #${orderId} (cash collected was less than net earning)`,
              wallet_type: "driver",
              order_id: orderId,
              payment_id: refundKey,
              created_at: istNow(),
            },
          });
        }
      }
    }

    // cust_api/advanced_payment.php credits this exact amount straight into
    // the customer's wallet the moment they pay it (accept time) — a plain
    // credit with nothing anywhere that ever spends it back down. The
    // driver already collects less cash by the same amount (cash_to_collect
    // = fare - advance_payment), so left alone this was a silent top-up:
    // the customer kept the full advance as free wallet balance on every
    // completed ride (confirmed live: a test customer's wallet grew ₹15 per
    // trip, unspent, across dozens of orders). Debit it back out now that
    // the trip — and the advance that went toward it — is actually done, so
    // a completed ride's net wallet effect is zero. Applies to every
    // completed order, not just cash ones — advance_payment is charged at
    // accept time regardless of the final settlement method. Guarded by a
    // unique payment_id key (same idempotency pattern as driverCancel's
    // refund) so a retried 'complete' call can never double-debit.
    if (advancePaymentCollected > 0 && Number(order.payment_status) === 1) {
      const applyKey = `advance_apply:${orderId}`;
      const alreadyApplied = await prisma.tbl_wallet_history.findFirst({
        where: { payment_id: applyKey, type: "debit", wallet_type: "user" },
      });
      if (!alreadyApplied) {
        await prisma.tbl_user.update({
          where: { id: order.uid },
          data: { wallet: { decrement: advancePaymentCollected } },
        });
        await prisma.tbl_wallet_history.create({
          data: {
            user_id: order.uid,
            amount: advancePaymentCollected,
            type: "debit",
            remark: `Advance payment applied to completed order #${orderId}`,
            wallet_type: "user",
            order_id: orderId,
            payment_id: applyKey,
            created_at: istNow(),
          },
        });
      }
    }

    if (driverBenefit?.benefit > 0) {
      await driverPlanService.recordCompletedRide({
        driverId: riderId,
        orderId,
        fare: finalTotal,
        baseCommissionPercent,
        chosenBenefit: driverBenefit,
      });
    }

    // Check & cascade next queued order if rider is a Monthly Driver
    processNextQueuedOrder(riderId, orderId).catch((err) => {
      logger.error(`processNextQueuedOrder error for rider ${riderId}:`, err);
    });

    notifyAdminStatus({ id: orderId, city_id: order.city_id, order_status: 5, o_status: "Completed", rid: riderId });
    return { success: true, order_status: 5, o_status: "Completed" };
  }

  return { success: false, msg: `Unknown status transition: ${status}` };
}

/**
 * Automatically checks and activates the next pending order for a Monthly Driver upon trip completion.
 */
async function processNextQueuedOrder(riderId, completedOrderId) {
  try {
    if (!prisma.driver_order_queue) return;

    // 1. Mark completed queue item
    await prisma.driver_order_queue.updateMany({
      where: { rider_id: Number(riderId), order_id: Number(completedOrderId), status: "active" },
      data: { status: "completed", completed_at: new Date() },
    });

    // 2. Increment today's completed order counter
    if (prisma.driver_duty_log) {
      const todayStr = new Date(Date.now() + 330 * 60 * 1000).toISOString().split("T")[0];
      await prisma.driver_duty_log.updateMany({
        where: { rider_id: Number(riderId), duty_date: new Date(todayStr), status: "in_progress" },
        data: { orders_completed: { increment: 1 } },
      });
    }

    // 3. Find next pending order in queue
    const nextItem = await prisma.driver_order_queue.findFirst({
      where: { rider_id: Number(riderId), status: "pending" },
      orderBy: { queue_order: "asc" },
    });

    if (!nextItem) return;

    // 4. Activate next order
    await prisma.pkg_order.update({
      where: { id: nextItem.order_id },
      data: {
        rid: Number(riderId),
        o_status: "Processing",
        flow_id: 1,
      },
    });

    await prisma.driver_order_queue.update({
      where: { id: nextItem.id },
      data: { status: "active" },
    });

    // 5. Emit direct assign & notify driver
    const nextOrder = await prisma.pkg_order.findUnique({
      where: { id: nextItem.order_id },
    });
    if (nextOrder) {
      dispatchManager.emitDirectAssign(Number(riderId), nextOrder);
      dispatchManager.emitQueueUpdate(Number(riderId));
      logger.info(`Next queued order #${nextOrder.id} automatically activated for Monthly Driver #${riderId}`);
    }
  } catch (err) {
    logger.error("Error processing next queued order:", err);
  }
}

/**
 * Customer-initiated cancel. The atomic conditional UPDATE is what decides
 * the race against a concurrent driver accept (spec §4.6) — if the driver's
 * accept already flipped o_status away from cancellable, affectedRows is 0.
 */
async function customerCancel(uid, orderId, comment) {
  const orderBefore = await prisma.pkg_order.findFirst({ where: { id: orderId, uid } });
  if (!orderBefore) {
    return { success: false, msg: "Order not found" };
  }

  const affectedRows = await prisma.$executeRaw`
    UPDATE pkg_order
    SET o_status = 'Cancelled', cancel_reason = ${comment || null}
    WHERE id = ${orderId} AND uid = ${uid} AND o_status NOT IN ('Completed', 'Cancelled')
  `;

  if (affectedRows === 0) {
    return { success: false, msg: "Order cannot be cancelled" };
  }

  if (orderBefore.rid !== 0) {
    const pkg = await pricingEngine.getPackageById(orderBefore.delivery_type);
    let cancellationCharge = Number(pkg?.cancellation_charge_customer) || 0;

    const customerPlan = await pricingEngine.getActiveCustomerPlan(uid);
    const hasFreeCancellation = customerPlan && customerPlan.cancellationEnabled && (
      customerPlan.freeCancellations === -1 || customerPlan.cancellationsUsed < customerPlan.freeCancellations
    );

    if (hasFreeCancellation) {
      cancellationCharge = 0;
      await prisma.$executeRaw`
        UPDATE tbl_user_plan_subscription
        SET cancellations_used = cancellations_used + 1
        WHERE id = ${customerPlan.subscriptionId}
      `;
    }

    if (cancellationCharge > 0) {
      await prisma.tbl_wallet_history.create({
        data: {
          user_id: uid,
          amount: cancellationCharge,
          type: "debit",
          remark: `Cancellation charge for order #${orderId}`,
          wallet_type: "user",
          order_id: orderId,
          created_at: istNow(),
        },
      });
    }
  } else {
    dispatchManager.stopDispatch(orderId, "cancelled_by_user");
  }

  return { success: true };
}

/**
 * Driver cancellation after acceptance.
 *
 * This is deliberately a single transaction.  The order row is locked before
 * checking payment/refund state, so a duplicate cancel request (or two socket
 * connections) can never credit the customer's wallet twice.
 */
async function driverCancel(orderId, riderId, reason) {
  let cancelledOrder = null;
  let refundAmount = 0;
  let refundStatus = "not_required";

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id, uid, rid, order_status, o_status, advance_payment,
             payment_status, razorpay_payment_id
      FROM pkg_order
      WHERE id = ${orderId}
      FOR UPDATE
    `;
    const order = rows[0];
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (Number(order.rid) !== Number(riderId)) throw new Error("NOT_ASSIGNED_DRIVER");

    // Refunds are exclusively for an accepted driver cancellation.  Keep the
    // eligibility check strict: a completed order must never be treated as a
    // cancellable order just because a legacy status field is stale/malformed.
    const normalizedStatus = String(order.o_status || "").trim().toLowerCase();
    const isCompleted = normalizedStatus === "completed" || Number(order.order_status) === 5;
    const isCancelled = normalizedStatus === "cancelled" || Number(order.order_status) === 4;
    const isActiveTrip = [1, 2, 3].includes(Number(order.order_status)) &&
      ["processing", "pickup", "on_route", "on route"].includes(normalizedStatus);
    if (isCompleted || isCancelled || !isActiveTrip) {
      throw new Error("ORDER_NOT_CANCELLABLE");
    }

    const affected = await tx.$executeRaw`
      UPDATE pkg_order
      SET rid = 0,
          order_status = 4,
          o_status = 'Cancelled',
          accept_time = NULL,
          cancel_reason = ${`Driver cancelled: ${reason || "No reason provided"}`}
      WHERE id = ${orderId}
        AND rid = ${riderId}
        AND o_status NOT IN ('Completed', 'Cancelled')
    `;
    if (affected === 0) throw new Error("ORDER_NOT_CANCELLABLE");

    const amount = Math.max(0, Math.round(Number(order.advance_payment) || 0));
    // Legacy payment paths have historically persisted the gateway payment id
    // before updating the numeric flag, so accept either marker as captured.
    const paymentCaptured = Number(order.payment_status) === 1 || Boolean(order.razorpay_payment_id);
    const refundKey = `advance_refund:${orderId}:${order.razorpay_payment_id || "advance"}`;

    // `payment_status=1` is the existing project's captured/success state.
    // Do not credit an un-captured payment; its gateway callback can safely
    // settle against the now-cancelled order later.
    if (paymentCaptured && amount > 0) {
      const alreadyRefunded = await tx.tbl_wallet_history.findFirst({
        where: { payment_id: refundKey, type: "credit", wallet_type: "user" },
        select: { id: true, amount: true },
      });

      if (alreadyRefunded) {
        refundAmount = Number(alreadyRefunded.amount) || amount;
        refundStatus = "refunded_to_wallet";
      } else {
        await tx.tbl_user.update({
          where: { id: Number(order.uid) },
          data: { wallet: { increment: amount } },
        });
        await tx.tbl_wallet_history.create({
          data: {
            user_id: Number(order.uid),
            amount,
            type: "credit",
            wallet_type: "user",
            order_id: orderId,
            payment_id: refundKey,
            remark: `Advance payment refunded to wallet — driver cancelled order #${orderId}`,
            created_at: istNow(),
          },
        });
        refundAmount = amount;
        refundStatus = "refunded_to_wallet";
      }
    } else if (amount > 0) {
      refundStatus = "payment_not_captured";
    }

    await tx.tbl_order_requests.updateMany({
      where: { order_id: orderId, rider_id: riderId, status: { in: ["sent", "accepted"] } },
      data: { status: "driver_cancelled" },
    });
    await tx.order_status_history.create({
      data: {
        order_id: orderId,
        rider_id: riderId,
        status: "Driver Cancelled",
        remark: reason || "No reason provided",
        created_at: new Date(),
      },
    });

    cancelledOrder = { ...order, rid: 0, order_status: 0, o_status: "Pending", uid: Number(order.uid) };
  });

  const freshOrder = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  if (freshOrder) {
    // Driver cancellation is terminal for this booking. Do not silently put
    // a paid order back into dispatch/reassignment after refunding it.
    dispatchManager.stopDispatch(orderId, "driver_cancelled");
    dispatchManager.emitCustomerEvent(freshOrder.uid, "order:driver_cancelled", {
      order_id: orderId,
      rider_id: riderId,
      refund_amount: refundAmount,
      refund_status: refundStatus,
      reason: reason || "Driver cancelled the ride",
      order_status: 4,
      o_status: "Cancelled",
      searching_for_new_driver: false,
    });
  }

  return {
    success: true,
    order: cancelledOrder,
    refund_amount: refundAmount,
    refund_status: refundStatus,
  };
}

async function rateOrder(uid, orderId, riderId, star, comment) {
  const result = await prisma.pkg_order.updateMany({
    where: { id: orderId, uid, rid: riderId },
    data: { is_rate: 1, cust_rate: star, cust_comment: comment || null },
  });

  if (result.count === 0) {
    return { success: false, msg: "Order not found for this customer/rider pair" };
  }

  return { success: true };
}

/**
 * Auto-cancels a single order whose driver has been waiting at pickup past
 * PICKUP_OTP_TIMEOUT_MS with no OTP handed over — the customer's own
 * no-show. Charges the same cancellation fee an ordinary customer-initiated
 * cancel-after-accept already charges (see customerCancel) — same economic
 * outcome, the customer just never showed up instead of tapping Cancel. The
 * driver keeps nothing extra here (matches that existing convention
 * exactly) but is immediately eligible for new dispatch again, since a
 * Cancelled order doesn't count against a rider in selectEligibleDrivers.
 *
 * Guarded by a conditional UPDATE (o_status = 'Pickup' only), so a driver
 * who gets the OTP right as the sweep runs, or a customer/driver cancel
 * that lands first, can never be double-cancelled or overwritten here.
 */
async function cancelOverduePickup(orderId, riderId) {
  const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  if (!order) return;

  const affected = await prisma.$executeRaw`
    UPDATE pkg_order
    SET o_status = 'Cancelled', order_status = 4,
        cancel_reason = 'Customer did not provide OTP within 10 minutes of driver arrival'
    WHERE id = ${orderId} AND o_status = 'Pickup'
  `;
  if (affected === 0) return; // already resolved another way between the sweep's read and this write

  await prisma.pkg_order_wait_timer.updateMany({
    where: { order_id: orderId, rid: riderId },
    data: { pickup_wait_end: new Date() },
  });

  const pkg = await pricingEngine.getPackageById(order.delivery_type);
  const cancellationCharge = Number(pkg?.cancellation_charge_customer) || 0;
  if (cancellationCharge > 0) {
    await prisma.tbl_wallet_history.create({
      data: {
        user_id: order.uid,
        amount: cancellationCharge,
        type: "debit",
        remark: `No-show penalty — OTP not provided within 10 minutes (order #${orderId})`,
        wallet_type: "user",
        order_id: orderId,
        created_at: istNow(),
      },
    });
  }

  dispatchManager.emitCustomerEvent(order.uid, "order:status_changed", {
    order_id: orderId,
    order_status: 4,
    o_status: "Cancelled",
  });

  const [customer, rider] = await Promise.all([
    prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { fcm_token: true } }),
    riderId ? prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { fcm_token: true } }) : Promise.resolve(null),
  ]);
  await pushNotifier.notifyCustomerPickupTimeoutCancel(customer?.fcm_token, orderId, cancellationCharge);
  if (rider) await pushNotifier.notifyDriverPickupTimeoutCancel(rider.fcm_token, orderId);

  notifyAdminStatus({ ...order, order_status: 4, o_status: "Cancelled" });

  logger.warn(
    `tripLifecycle: order ${orderId} auto-cancelled — customer did not provide OTP within ${PICKUP_OTP_TIMEOUT_MS / 60000} minutes of driver arrival (rider ${riderId})`
  );
}

/**
 * Periodic sweep (see server.js), not a per-order in-memory timer — an
 * in-memory setTimeout armed at "arrived" would silently vanish on every
 * Render restart/redeploy and never fire, the same class of bug
 * dispatchManager's own reconcileStaleOffersOnStartup exists to guard
 * against. Anchored to pkg_order_wait_timer.pickup_wait_start (a DB
 * timestamp), so a sweep that runs late — or resumes after a restart —
 * still finds and cancels every order that's actually overdue.
 */
async function sweepOverduePickups() {
  const cutoff = new Date(Date.now() - PICKUP_OTP_TIMEOUT_MS);
  let overdue;
  try {
    overdue = await prisma.pkg_order_wait_timer.findMany({
      where: { pickup_wait_start: { lte: cutoff }, pickup_wait_end: null },
    });
  } catch (err) {
    logger.error("sweepOverduePickups: failed to query overdue wait timers:", err);
    return;
  }

  for (const waitRow of overdue) {
    try {
      await cancelOverduePickup(waitRow.order_id, waitRow.rid);
    } catch (err) {
      logger.error(`sweepOverduePickups: failed cancelling order ${waitRow.order_id}:`, err);
    }
  }
}

module.exports = {
  acceptOrder,
  claimOrderForRider,
  finalizeAcceptedOrder,
  rejectOrder,
  updateStatus,
  customerCancel,
  driverCancel,
  rateOrder,
  cancelOverduePickup,
  sweepOverduePickups,
};
