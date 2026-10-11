const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const rules = require("./tierPenaltyRules");
const settings = require("./tieredDispatchSettings");
const events = require("./driverOrderEventService");
const walletNotifier = require("./walletNotifier");
const pushNotifier = require("./pushNotifier");

const notFound = (message) => Object.assign(new Error(message), { statusCode: 404 });
const missKey = (orderId, riderId) => `tier_penalty:${orderId}:${riderId}:miss`;
const cancelKey = (orderId, riderId) => `tier_penalty:${orderId}:${riderId}:cancel`;

/** What the driver's NEXT reject/skip would cost on this order (shown in the offer popup). Never throws. */
async function previewForOffer({ riderId, stage, order }) {
  if (!rules.isPenaltyTier(stage)) return { pct: 0, amount: 0 };
  try {
    const s = await settings.getTierSettings();
    if (!s.penaltyEnabled) return { pct: 0, amount: 0 };
    const counter = await prisma.driver_tier_penalty_counter.findUnique({
      where: { rider_id_tier: { rider_id: Number(riderId), tier: stage } },
      select: { misses: true },
    });
    const pct = rules.pctForMiss(s.ladder, (counter?.misses || 0) + 1);
    return { pct, amount: rules.penaltyAmount(order?.total_dcharge, pct) };
  } catch (err) {
    logger.error(`tierPenaltyService.previewForOffer failed for rider ${riderId}:`, err);
    return { pct: 0, amount: 0 };
  }
}

/** Still waiting for a driver: unassigned, not accepted, not cancelled. */
const isOpenOrder = (o) => Boolean(o) && Number(o.rid) === 0 && Number(o.order_status) === 0 && o.o_status !== "Cancelled";

async function isOrderOpen(orderId) {
  const order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) }, select: { rid: true, order_status: true, o_status: true } });
  return isOpenOrder(order);
}

async function openEnrollmentId(tx, riderId) {
  const log = await tx.daily_driver_duty_log.findFirst({
    where: { rider_id: riderId, status: "in_progress" },
    orderBy: { id: "desc" },
    select: { enrollment_id: true },
  });
  return log ? log.enrollment_id : null;
}

async function debitDriverWallet(tx, { riderId, orderId, amount, key, remark }) {
  await tx.tbl_rider.update({ where: { id: riderId }, data: { wallet_balance: { decrement: amount } } });
  await tx.tbl_wallet_history.create({
    data: { user_id: riderId, amount, type: "debit", remark, wallet_type: "driver", order_id: orderId, payment_id: key, created_at: istNow() },
  });
}

/**
 * Creates one penalty row (idempotent per order+rider+kind) and collects it. A miss also advances the
 * per-tier counter. Daily Drivers with an open enrollment are collected at settlement instead.
 */
async function createPenalty({ orderId, riderId, tier, kind, event, s }) {
  const oid = Number(orderId);
  const rid = Number(riderId);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.driver_tier_penalty.findFirst({ where: { order_id: oid, rider_id: rid, kind } });
      if (existing) return { applied: false, duplicate: true };

      const order = await tx.pkg_order.findUnique({ where: { id: oid }, select: { total_dcharge: true, rid: true, order_status: true, o_status: true } });
      // Taken by someone else (or cancelled) after the pre-check in onMiss: nothing is charged or counted.
      if (kind === "miss" && !isOpenOrder(order)) return { applied: false, ignored: true };
      const base = rules.round2(order?.total_dcharge || 0);
      let missNo = null;
      let pct;
      if (kind === "miss") {
        const counter = await tx.driver_tier_penalty_counter.upsert({
          where: { rider_id_tier: { rider_id: rid, tier } },
          create: { rider_id: rid, tier, misses: 1 },
          update: { misses: { increment: 1 } },
        });
        missNo = counter.misses;
        pct = rules.pctForMiss(s.ladder, missNo);
      } else {
        pct = s.cancelPenaltyPct;
      }
      const amount = rules.penaltyAmount(base, pct);
      const enrollmentId = tier === rules.TIER.DAILY ? await openEnrollmentId(tx, rid) : null;
      const status = enrollmentId ? "pending_daily" : "collected";

      const row = await tx.driver_tier_penalty.create({
        data: {
          rider_id: rid, order_id: oid, tier, kind, event, miss_no: missNo, pct, base_amount: base, amount, status,
          enrollment_id: enrollmentId, collected_at: status === "collected" ? new Date() : null,
        },
      });
      if (status === "collected" && amount > 0) {
        await debitDriverWallet(tx, {
          riderId: rid, orderId: oid, amount,
          key: kind === "miss" ? missKey(oid, rid) : cancelKey(oid, rid),
          remark: `Penalty for order #${oid} (${event.replace("_", " ")})`,
        });
      }
      return { applied: true, penalty: row, missNo, pct, amount, status, base };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { applied: false, duplicate: true };
    throw err;
  }
}

async function afterPenalty(result, { orderId, riderId, tier, event, s, fcmToken }) {
  await events.logEvent({
    riderId, orderId, tier, event: events.EVENTS.PENALTY, reason: event,
    penaltyPct: result.pct, penaltyAmount: result.amount, missNo: result.missNo,
  });
  if (result.status === "collected" && result.amount > 0) {
    walletNotifier
      .notifyDriverWalletTransaction(riderId, { type: "debit", amount: result.amount, remark: `Penalty for order #${orderId}` })
      .catch((err) => logger.error(`tierPenaltyService: wallet notify failed for rider ${riderId}:`, err));
  }
  let token = fcmToken;
  if (!token) {
    token = (await prisma.tbl_rider.findUnique({ where: { id: Number(riderId) }, select: { fcm_token: true } }).catch(() => null))?.fcm_token;
  }
  const nextPct = result.missNo != null ? rules.pctForMiss(s.ladder, result.missNo + 1) : result.pct;
  await Promise.resolve(
    pushNotifier.notifyDriverTierPenalty(token, {
      orderId, amount: result.amount, pct: result.pct, nextPct, deferred: result.status === "pending_daily",
    })
  ).catch((err) => logger.error(`tierPenaltyService: push failed for rider ${riderId}:`, err));
}

/**
 * A Free/Daily driver rejected (event "rejected") or let an offer expire (event "skipped"). Always logs
 * the event; penalises only Free/Daily stages and only when penalties are on. Never throws.
 */
async function onMiss({ orderId, riderId, event, stage = null, fcmToken = null }) {
  const tier = stage || rules.TIER.NORMAL;
  try {
    // Someone else took the order, or the customer cancelled, while this driver still had the popup: the offer
    // does not count (no penalty, counter untouched, excluded from the report rates).
    if (!(await isOrderOpen(orderId))) {
      await events.logEvent({ riderId, orderId, tier, event: events.EVENTS.SUPERSEDED });
      return { applied: false, ignored: true };
    }
    await events.logEvent({ riderId, orderId, tier, event });
    if (!rules.isPenaltyTier(tier)) return { applied: false };
    const s = await settings.getTierSettings();
    if (!s.penaltyEnabled) return { applied: false };
    const result = await createPenalty({ orderId, riderId, tier, kind: "miss", event, s });
    if (result.applied) await afterPenalty(result, { orderId, riderId, tier, event, s, fcmToken });
    return result;
  } catch (err) {
    logger.error(`tierPenaltyService.onMiss failed (order ${orderId}, rider ${riderId}):`, err);
    return { applied: false, error: true };
  }
}

/** Penalty for an admin-approved cancel request (kind "cancel"; not on the ladder). Never throws. */
async function applyCancelPenalty({ orderId, riderId, tier }) {
  try {
    const s = await settings.getTierSettings();
    if (!s.penaltyEnabled) return { applied: false };
    const result = await createPenalty({ orderId, riderId, tier, kind: "cancel", event: "cancel_approved", s });
    if (result.applied) await afterPenalty(result, { orderId, riderId, tier, event: "cancel_approved", s, fcmToken: null });
    return result;
  } catch (err) {
    logger.error(`tierPenaltyService.applyCancelPenalty failed (order ${orderId}, rider ${riderId}):`, err);
    return { applied: false, error: true };
  }
}

async function waive({ penaltyId, adminId }) {
  let notify = null;
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.driver_tier_penalty.findUnique({ where: { id: Number(penaltyId) } });
    if (!row) throw notFound("Penalty not found");
    if (row.status === "waived") return { alreadyWaived: true };

    const amount = Number(row.amount);
    if (row.status === "collected" && amount > 0) {
      const key = `tier_penalty_waive:${row.id}`;
      const dup = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "driver" } });
      if (!dup) {
        await tx.tbl_rider.update({ where: { id: row.rider_id }, data: { wallet_balance: { increment: amount } } });
        await tx.tbl_wallet_history.create({
          data: {
            user_id: row.rider_id, amount, type: "credit", remark: `Penalty waived for order #${row.order_id}`,
            wallet_type: "driver", order_id: row.order_id, payment_id: key, created_at: istNow(),
          },
        });
        notify = { riderId: row.rider_id, amount, orderId: row.order_id };
      }
    }
    await tx.driver_tier_penalty.update({ where: { id: row.id }, data: { status: "waived", waived_by: adminId ?? null, waived_at: new Date() } });
    await events.logEvent({ riderId: row.rider_id, orderId: row.order_id, tier: row.tier, event: events.EVENTS.PENALTY_WAIVED, penaltyAmount: amount });
    return { waived: true };
  });
  if (notify) {
    walletNotifier
      .notifyDriverWalletTransaction(notify.riderId, { type: "credit", amount: notify.amount, remark: `Penalty waived for order #${notify.orderId}` })
      .catch((err) => logger.error(`tierPenaltyService.waive: wallet notify failed for rider ${notify.riderId}:`, err));
  }
  return result;
}

async function resetCounter({ riderId, tier, adminId }) {
  await prisma.driver_tier_penalty_counter.upsert({
    where: { rider_id_tier: { rider_id: Number(riderId), tier } },
    update: { misses: 0 },
    create: { rider_id: Number(riderId), tier, misses: 0 },
  });
  await events.logEvent({ riderId, orderId: 0, tier, event: events.EVENTS.COUNTER_RESET, reason: `reset by admin ${adminId ?? "?"}` });
}

/**
 * Called inside dailyDriverSettlementService.settleEnrollment's transaction: collects every penalty that
 * was deferred to this enrollment. The settlement has already credited the company payout to the wallet,
 * so decrementing here nets the penalty against what the company owed; any excess leaves the wallet
 * negative (a due), exactly as the manager decided.
 */
async function settlePendingForEnrollment(tx, { enrollmentId, riderId }) {
  const rows = await tx.driver_tier_penalty.findMany({ where: { enrollment_id: Number(enrollmentId), status: "pending_daily" } });
  if (rows.length === 0) return 0;
  const total = rules.round2(rows.reduce((sum, r) => sum + Number(r.amount), 0));
  const rid = Number(riderId);
  const now = new Date();
  for (const r of rows) {
    await tx.driver_tier_penalty.update({ where: { id: r.id }, data: { status: "collected", collected_at: now } });
    if (Number(r.amount) > 0) {
      await tx.tbl_wallet_history.create({
        data: {
          user_id: rid, amount: Number(r.amount), type: "debit",
          remark: `Penalty for order #${r.order_id} (${r.event}) adjusted against Daily Driver settlement`,
          wallet_type: "driver", order_id: r.order_id, payment_id: missKey(r.order_id, rid), created_at: istNow(),
        },
      });
    }
  }
  if (total > 0) await tx.tbl_rider.update({ where: { id: rid }, data: { wallet_balance: { decrement: total } } });
  await tx.daily_driver_ledger.createMany({
    data: rows.map((r) => ({
      rider_id: rid, enrollment_id: Number(enrollmentId), order_id: r.order_id, entry_type: "PENALTY_DEDUCTION",
      amount: Number(r.amount), balance_effect: "DEBIT", notes: `Penalty (${r.event}) for order #${r.order_id}`, created_at: istNow(),
    })),
  });
  return total;
}

module.exports = { previewForOffer, onMiss, applyCancelPenalty, waive, resetCounter, settlePendingForEnrollment };
