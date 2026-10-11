const prisma = require("../config/db");
const logger = require("../utils/logger");
const settings = require("./tieredDispatchSettings");
const { TIER } = require("./tierPenaltyRules");

async function getStage(orderId) {
  try {
    const row = await prisma.order_dispatch_stage.findUnique({ where: { order_id: Number(orderId) }, select: { stage: true } });
    return row?.stage ?? null;
  } catch (err) {
    logger.error(`orderStageService.getStage failed for order ${orderId}:`, err);
    return null;
  }
}

async function setStage(orderId, stage) {
  try {
    await prisma.order_dispatch_stage.upsert({
      where: { order_id: Number(orderId) },
      update: { stage },
      create: { order_id: Number(orderId), stage },
    });
  } catch (err) {
    logger.error(`orderStageService.setStage failed for order ${orderId}:`, err);
  }
}

/** Free for a still-CONFIRMED free booking, daily for everything else; null when tiered dispatch is off. */
async function decideStartStage(order) {
  if (!(await settings.isTieredEnabled())) return null;
  const row = await prisma.free_booking_order
    .findUnique({ where: { order_id: Number(order.id) }, select: { status: true } })
    .catch(() => null);
  return row && row.status === "FREE_BOOKING_CONFIRMED" ? TIER.FREE : TIER.DAILY;
}

/** Daily Drivers on duty: enrolled, punched in and not yet punched out. */
async function dailyRiderIds() {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT rider_id FROM daily_driver_duty_log
    WHERE status = 'in_progress' AND punch_in_at IS NOT NULL AND punch_out_at IS NULL
  `;
  return rows.map((r) => Number(r.rider_id));
}

async function freePoolRiderIds(order) {
  const row = await prisma.free_booking_order
    .findUnique({ where: { order_id: Number(order.id) }, select: { city_id: true } })
    .catch(() => null);
  const cityId = row?.city_id ?? order.city_id;
  if (!cityId) return [];
  return require("./freeBookingService").poolRiderIds(Number(cityId));
}

/** Candidate rider ids for a stage; null = no restriction (normal). */
async function riderIdsForStage(stage, order) {
  if (stage === TIER.FREE) return freePoolRiderIds(order);
  if (stage === TIER.DAILY) return dailyRiderIds();
  return null;
}

/** Every rider this order was ever offered to (any stage); used so a later stage never re-offers them. */
async function offeredRiderIds(orderId) {
  const rows = await prisma.tbl_order_requests.findMany({
    where: { order_id: Number(orderId) },
    select: { rider_id: true },
    distinct: ["rider_id"],
  });
  return rows.map((r) => Number(r.rider_id)).filter((id) => Number.isFinite(id));
}

module.exports = { getStage, setStage, decideStartStage, riderIdsForStage, dailyRiderIds, offeredRiderIds };
