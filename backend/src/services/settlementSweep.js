const prisma = require("../config/db");
const logger = require("../utils/logger");
const pushNotifier = require("./pushNotifier");
const { getSettlementSettings } = require("./settlementSettings");

const BATCH = 200;

async function sendReminders(s) {
  const amount = Number(s.amount_due);
  const [customer, rider] = await Promise.all([
    prisma.tbl_user.findUnique({ where: { id: s.uid }, select: { fcm_token: true } }),
    prisma.tbl_rider.findUnique({ where: { id: s.rid }, select: { fcm_token: true } }),
  ]);
  const sends = [];
  // async wrappers so a synchronous throw from a notifier is also captured.
  // A receiver-mode settlement is the receiver's to pay; the booker's pay would be refused (RECEIVER_MODE).
  if (customer?.fcm_token && s.payer !== "receiver") sends.push((async () => pushNotifier.notifyCustomerSettlementReminder(customer.fcm_token, s.order_id, amount))());
  if (rider?.fcm_token) sends.push((async () => pushNotifier.notifyDriverSettlementReminder(rider.fcm_token, s.order_id, amount))());
  const results = await Promise.allSettled(sends);
  for (const r of results) {
    if (r.status === "rejected") logger.error(`sweepSettlements: reminder push failed for settlement ${s.id}:`, r.reason);
  }
}

/**
 * Periodic, DB-anchored sweep (same pattern as tripLifecycle.sweepOverduePickups):
 *  - sends the next due reminder to customer and driver,
 *  - flags a long-pending settlement for the admin "Unsettled" queue.
 * Each action is claimed with a conditional updateMany so a restart, an
 * overlapping run or a second instance can never double-send or double-stamp.
 * Never moves money.
 */
async function sweepSettlements(now = new Date()) {
  const settings = await getSettlementSettings();
  if (!settings.enabled) return { reminded: 0, escalated: 0 };

  const rows = await prisma.order_settlement.findMany({
    // Only rows with sweep work left: a fully processed row (escalated and all
    // reminders sent) is never fetched again, so it cannot crowd out newer rows.
    where: {
      status: "pending",
      OR: [{ escalated_at: null }, { reminders_sent: { lt: settings.reminderMinutes.length } }],
    },
    orderBy: { pending_since: "asc" },
    take: BATCH,
  });

  let reminded = 0;
  let escalated = 0;
  for (const s of rows) {
    try {
      const minutes = (now.getTime() - new Date(s.pending_since).getTime()) / 60000;

      const due = settings.reminderMinutes.filter((m) => minutes >= m).length;
      if (due > s.reminders_sent) {
        const claim = await prisma.order_settlement.updateMany({
          where: { id: s.id, status: "pending", reminders_sent: s.reminders_sent },
          data: { reminders_sent: due, last_reminder_at: now, updated_at: now },
        });
        if (claim.count === 1) {
          reminded++;
          try {
            await sendReminders(s);
          } catch (err) {
            logger.error(`sweepSettlements: sending reminders failed for settlement ${s.id}:`, err);
          }
        }
      }

      if (!s.escalated_at && minutes >= settings.escalateAfterMinutes) {
        const claim = await prisma.order_settlement.updateMany({
          where: { id: s.id, status: "pending", escalated_at: null },
          data: { escalated_at: now, updated_at: now },
        });
        if (claim.count === 1) {
          await prisma.order_settlement_event.create({
            data: {
              settlement_id: s.id, actor: "system", from_status: "pending", to_status: "pending",
              note: `Flagged as unsettled after ${settings.escalateAfterMinutes} minutes`, created_at: now,
            },
          });
          escalated++;
        }
      }
    } catch (err) {
      logger.error(`sweepSettlements: failed for settlement ${s.id}:`, err);
    }
  }
  return { reminded, escalated };
}

module.exports = { sweepSettlements };
