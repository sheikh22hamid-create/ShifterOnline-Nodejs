const prisma = require("../config/db");
const logger = require("../utils/logger");
const rules = require("./pointsExpiryRules");

// Points expiry (spec 2026-10-30). See pointsExpiryRules.js for how lots are rebuilt from the ledger.
//  - stampCredit(): called where points are credited; records the credit's own expiry (fixed at credit time).
//  - processLot(): expires what is left of ONE credit, atomically with the balance and an "expiry" ledger row.
//  - settleUser(): called before a redemption, so a points that expired a minute ago can never be spent.
//  - sweepDue(): the scheduled job; picks up everything due, safe to run twice and across instances.

const userTable = (type) => (type === "DRIVER" ? "tbl_rider" : "tbl_user");

/** Config of the three activities x two user types, or {} when never saved. */
async function getConfig(db = prisma) {
  const row = await db.tbl_referral_setting.findFirst({ select: { points_expiry: true } });
  return row?.points_expiry || {};
}

/**
 * Ledger fields to store with a new credit: the activity, its configured duration and the resulting expiry moment.
 * No duration configured = no expiry (nothing is invented). Never throws: a settings problem must not block a credit.
 */
async function stampCredit({ activity, userType, points, now = new Date(), db = prisma }) {
  const base = { activity };
  try {
    const duration = rules.durationFor(await getConfig(db), activity, userType);
    if (!duration) return { fields: base, expiresAt: null, description: rules.describeCredit(activity, points, null), suffix: "" };
    const expiresAt = rules.addDuration(now, duration);
    return {
      fields: { ...base, expires_at: expiresAt, expiry_status: "active", expiry_duration: rules.durationText(duration) },
      expiresAt,
      description: rules.describeCredit(activity, points, expiresAt),
      suffix: ` | Expires on: ${rules.formatExpiryDate(expiresAt)}`,
    };
  } catch (err) {
    logger.error(`pointsExpiry: could not read expiry settings for ${activity}/${userType}, crediting without expiry:`, err);
    return { fields: base, expiresAt: null, description: rules.describeCredit(activity, points, null), suffix: "" };
  }
}

const ledgerRows = (tx, userId, userType) =>
  tx.tbl_referral_point_log.findMany({
    where: { user_id: userId, user_type: userType },
    orderBy: { id: "asc" },
    select: { id: true, points: true, activity: true, expires_at: true, origin_log_id: true, created_at: true },
  });

/**
 * Expire what is left of one credit. One transaction: lock the user, rebuild the lots, deduct from the balance, write the
 * expiry row, mark the credit settled. A second run (or a second server) finds the credit settled and does nothing.
 * Resolves { status: "expired" | "nothing_left" | "skipped", points }.
 */
async function processLot(lotId, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const lot = await tx.tbl_referral_point_log.findUnique({ where: { id: lotId } });
    if (!lot || lot.points <= 0 || lot.expiry_status !== "active" || !lot.expires_at || lot.expires_at > now) return { status: "skipped", points: 0 };

    const model = userTable(lot.user_type);
    await tx.$queryRawUnsafe(`SELECT id FROM ${model} WHERE id = ? FOR UPDATE`, lot.user_id); // table name is one of two constants
    const fresh = await tx.tbl_referral_point_log.findUnique({ where: { id: lotId }, select: { expiry_status: true } });
    if (fresh?.expiry_status !== "active") return { status: "skipped", points: 0 };

    const remaining = rules.replayLots(await ledgerRows(tx, lot.user_id, lot.user_type)).get(lot.id)?.remaining || 0;
    const account = await tx[model].findUnique({ where: { id: lot.user_id }, select: { referral_points: true } });
    const balance = Number(account?.referral_points) || 0;
    // Never push the balance negative: points the ledger cannot explain may already have been spent.
    const expire = Math.max(0, Math.min(remaining, balance));

    if (expire > 0) {
      await tx[model].update({ where: { id: lot.user_id }, data: { referral_points: { decrement: expire } } });
      await tx.tbl_referral_point_log.create({
        data: {
          user_id: lot.user_id, user_type: lot.user_type, points: -expire, txn_type: "expiry", source: "points_expiry",
          ref_id: lot.id, balance_after: balance - expire, note: rules.expiryNote(lot.activity), created_at: now,
          activity: lot.activity, origin_log_id: lot.id, expires_at: lot.expires_at, expiry_status: "processed",
        },
      });
    }
    await tx.tbl_referral_point_log.update({ where: { id: lot.id }, data: { expiry_status: "settled", expired_points: { increment: expire } } });
    return { status: expire > 0 ? "expired" : "nothing_left", points: expire };
  });
}

/** Credits of one user that are due, expired right now. Called before any redemption; never throws. */
async function settleUser(userType, userId, now = new Date()) {
  try {
    const due = await prisma.tbl_referral_point_log.findMany({
      where: { user_id: Number(userId), user_type: userType, expiry_status: "active", expires_at: { lte: now } },
      orderBy: { expires_at: "asc" }, take: 50, select: { id: true },
    });
    for (const d of due) await processLot(d.id, now);
    return due.length;
  } catch (err) {
    logger.error(`pointsExpiry.settleUser failed for ${userType} #${userId}:`, err);
    return 0;
  }
}

/** The scheduled job. A failing credit is logged and retried on the next run; it never stops the others. */
async function sweepDue({ limit = 200, now = new Date() } = {}) {
  let due;
  try {
    due = await prisma.tbl_referral_point_log.findMany({
      where: { expiry_status: "active", expires_at: { lte: now } }, orderBy: { expires_at: "asc" }, take: limit, select: { id: true, user_id: true, user_type: true },
    });
  } catch (err) {
    logger.error("pointsExpiry sweep: could not read due credits (migration not applied?):", err);
    return { processed: 0, expired: 0, failed: 0 };
  }
  let expired = 0;
  let failed = 0;
  for (const d of due) {
    try {
      const r = await processLot(d.id, now);
      expired += r.points;
    } catch (err) {
      failed += 1;
      logger.error(`pointsExpiry sweep: credit ${d.id} (${d.user_type} #${d.user_id}) failed, will retry:`, err);
    }
  }
  if (due.length) logger.info(`pointsExpiry sweep: ${due.length} due, ${expired} points expired, ${failed} failed`);
  return { processed: due.length, expired, failed };
}

/** Admin view: lots (remaining points per credit) for the users on one page of the ledger. Map "TYPE:id" -> Map(lotId -> lot). */
async function lotsForUsers(pairs) {
  const out = new Map();
  for (const { user_id, user_type } of pairs) {
    const key = `${user_type}:${user_id}`;
    if (out.has(key)) continue;
    out.set(key, rules.replayLots(await ledgerRows(prisma, user_id, user_type)));
  }
  return out;
}

module.exports = { getConfig, stampCredit, processLot, settleUser, sweepDue, lotsForUsers };
