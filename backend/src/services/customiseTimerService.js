const prisma = require("../config/db");
const logger = require("../utils/logger");

// Extra waiting / loading / unloading charges on a Customise ride (spec 2026-10-26 section 11). The customer chose
// how long each activity may take; time beyond that is billed at the ride's own waiting rate (order.wating_charge,
// the same per-minute rate and rounding a normal ride uses). The rate card's free minutes do NOT apply here: the
// customer's selected minutes replace them. The three segments cover disjoint intervals, so nothing is charged twice:
//   pickup_wait  driver arrival -> pickup OTP verified
//   pickup_load  pickup OTP verified -> pickup complete
//   drop         drop arrival -> trip completion (allowance = drop waiting + unloading minutes combined, because the
//                app has no separate "unloading started" event)
// Per-stop timers are not billed: there is no "left the stop" event to measure a stop's dwell time.

const round2 = (n) => Math.round(n * 100) / 100;
const secs = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
const at = (v) => (v ? new Date(v) : null);

function segment(name, selectedMin, elapsedSeconds, rate, startedAt, endedAt) {
  const billed = Math.max(0, elapsedSeconds - selectedMin * 60);
  return {
    segment: name,
    selected_min: selectedMin,
    started_at: startedAt,
    ended_at: endedAt,
    elapsed_seconds: elapsedSeconds,
    billed_seconds: billed,
    rate_per_min: rate,
    charge: round2((billed / 60) * rate),
  };
}

function segmentsOf({ co, waitTimer, dropWaitSeconds, rate, endedAt }) {
  const t = waitTimer || {};
  const loadSeconds = secs(t.pickup_load_wait_seconds);
  const loadStart = at(t.otp_verify_at) || at(t.pickup_wait_end);
  return [
    segment("pickup_wait", Number(co.p_wait_min) || 0, secs(t.pickup_wait_seconds), rate, at(t.pickup_wait_start), at(t.pickup_wait_end)),
    segment("pickup_load", Number(co.p_load_min) || 0, loadSeconds, rate, loadStart, loadStart ? new Date(loadStart.getTime() + loadSeconds * 1000) : null),
    segment("drop", (Number(co.d_wait_min) || 0) + (Number(co.d_unload_min) || 0), secs(dropWaitSeconds), rate, at(t.drop_wait_start), endedAt || null),
  ];
}

/** { total, segments } for a Customise ride, or null (not one, or its order row is unreadable: keep the normal formula). */
async function billFor(order, waitTimer, dropWaitSeconds, endedAt = new Date()) {
  if (order?.customise_order_id == null) return null;
  let co;
  try {
    co = await prisma.customise_order.findUnique({ where: { id: Number(order.customise_order_id) } });
  } catch (err) {
    logger.error(`customiseTimers.billFor: order ${order.customise_order_id} unreadable, using the normal waiting formula:`, err);
    return null;
  }
  if (!co) return null;
  const rate = Number(order.wating_charge) || 0;
  const segments = segmentsOf({ co, waitTimer, dropWaitSeconds, rate, endedAt });
  return { total: round2(segments.reduce((sum, s) => sum + s.charge, 0)), segments };
}

/** Audit rows, one per (order, segment); a recompute overwrites rather than adds. Never throws. */
async function record(orderId, segments) {
  try {
    for (const s of segments) {
      const data = {
        selected_min: s.selected_min, started_at: s.started_at, ended_at: s.ended_at, elapsed_seconds: s.elapsed_seconds,
        billed_seconds: s.billed_seconds, rate_per_min: s.rate_per_min, charge: s.charge, computed_at: new Date(),
      };
      await prisma.customise_order_timer.upsert({
        where: { order_id_segment: { order_id: orderId, segment: s.segment } },
        create: { order_id: orderId, segment: s.segment, ...data },
        update: data,
      });
    }
    await prisma.customise_event.create({
      data: { order_id: orderId, type: "timers_charged", meta: { total: round2(segments.reduce((sum, s) => sum + s.charge, 0)) } },
    });
  } catch (err) {
    logger.error(`customiseTimers.record: audit rows for ride ${orderId} not written:`, err);
  }
}

module.exports = { segmentsOf, billFor, record };
