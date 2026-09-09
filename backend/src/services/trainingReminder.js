const prisma = require("../config/db");
const logger = require("../utils/logger");
const { notifyDriverTrainingIncomplete } = require("./pushNotifier");
const { TRAINING_REMINDER_COOLDOWN_MS } = require("../config/constants");

/** Nudges drivers who started training but haven't finished, at most once per TRAINING_REMINDER_COOLDOWN_MS. */
async function sweepIncompleteTraining() {
  const cutoff = new Date(Date.now() - TRAINING_REMINDER_COOLDOWN_MS);
  let candidates;
  try {
    candidates = await prisma.driver_training_progress.findMany({
      where: {
        is_completed: false,
        OR: [{ last_reminded_at: null }, { last_reminded_at: { lte: cutoff } }],
      },
    });
  } catch (err) {
    logger.error("sweepIncompleteTraining: failed to query incomplete progress rows:", err);
    return;
  }

  for (const row of candidates) {
    try {
      const rider = await prisma.tbl_rider.findUnique({ where: { id: row.rider_id }, select: { fcm_token: true } });
      if (!rider || !rider.fcm_token) continue;

      await notifyDriverTrainingIncomplete(rider.fcm_token);
      await prisma.driver_training_progress.update({
        where: { rider_id: row.rider_id },
        data: { last_reminded_at: new Date() },
      });
    } catch (err) {
      logger.error(`sweepIncompleteTraining: failed for rider ${row.rider_id}:`, err);
    }
  }
}

module.exports = { sweepIncompleteTraining };
