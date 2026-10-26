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
//   stop_<n>     the trip flow's own arrived_stop_<n> -> complete_stop_<n> events (driver_trip_event); allowance = that
//                stop's waiting + loading + unloading minutes. A stop missing either event is not billed (no guess).

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

/** One segment per additional stop that has both its arrival and its completion recorded, in the stop order. */
function stopSegmentsOf({ stops, events, rate }) {
  const when = (milestone) => {
    const row = (events || []).find((e) => e.milestone === milestone);
    return row ? new Date(row.created_at) : null;
  };
  const out = [];
  for (const stop of [...(stops || [])].sort((a, b) => a.seq - b.seq)) {
    const arrived = when(`arrived_stop_${stop.seq}`);
    const completed = when(`complete_stop_${stop.seq}`);
    if (!arrived || !completed || completed.getTime() < arrived.getTime()) continue;
    const allowance = (Number(stop.wait_min) || 0) + (Number(stop.load_min) || 0) + (Number(stop.unload_min) || 0);
    out.push(segment(`stop_${stop.seq}`, allowance, Math.floor((completed.getTime() - arrived.getTime()) / 1000), rate, arrived, completed));
  }
  return out;
}

async function stopSegmentsFor(order, rate) {
  try {
    const stops = await prisma.customise_order_stop.findMany({ where: { order_id: Number(order.customise_order_id) }, orderBy: { seq: "asc" } });
    if (!stops.length) return [];
    const milestones = stops.flatMap((st) => [`arrived_stop_${st.seq}`, `complete_stop_${st.seq}`]);
    const events = await prisma.driver_trip_event.findMany({ where: { order_id: order.id, milestone: { in: milestones } }, select: { milestone: true, created_at: true } });
    return stopSegmentsOf({ stops, events, rate });
  } catch (err) {
    logger.error(`customiseTimers: stop timers for ride ${order.id} unreadable, billing pickup and drop only:`, err);
    return [];
  }
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
  const segments = [...segmentsOf({ co, waitTimer, dropWaitSeconds, rate, endedAt }), ...(await stopSegmentsFor(order, rate))];
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

module.exports = { segmentsOf, stopSegmentsOf, billFor, record };
