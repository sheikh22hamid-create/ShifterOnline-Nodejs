const prisma = require('../config/db');
const { observeArrival } = require('./tripArrivalPolicy');
const { getAdvancePaymentTimerInfo } = require('../utils/advancePaymentTimer');

function fail(message) { const error = new Error(message); error.statusCode = 409; throw error; }
function snapshot(order, progress, timer, stopCount) {
  const active = [1, 2, 3].includes(order.order_status);
  return {
    order_id: order.id, order_status: order.order_status, o_status: order.o_status, city_id: order.city_id,
    active, driver_flow_id: active && timer?.drop_wait_start ? 4 : order.order_status,
    stop_step: progress?.stop_step || 0, stop_count: stopCount,
    pickup_wait_start: timer?.pickup_wait_start ? new Date(timer.pickup_wait_start).getTime() : 0,
    pickup_wait_seconds: timer?.pickup_wait_seconds || 0,
    drop_wait_start: timer?.drop_wait_start ? new Date(timer.drop_wait_start).getTime() : 0,
    server_time: Date.now(), version: progress?.updated_at ? new Date(progress.updated_at).getTime() : 0,
  };
}

async function progressTrip({ orderId, riderId, action = 'sync', otp, samples = [], managed = false }) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !Number.isSafeInteger(riderId) || riderId <= 0) fail('Invalid order or driver');
  if (!Array.isArray(samples) || samples.length > 120 || samples.some(s => !s || typeof s !== 'object' || Array.isArray(s))) fail('At most 120 valid location samples are allowed');
  const result = await prisma.$transaction(async tx => {
    // Serializes manual actions, retries and background fixes across server instances.
    await tx.$queryRaw`SELECT id FROM pkg_order WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.pkg_order.findUnique({ where: { id: orderId } });
    if (!order || order.rid !== riderId) fail('Order is not assigned to this driver');
    const stops = await tx.pkg_order_stops.findMany({ where: { order_id: orderId }, orderBy: [{ sequence: 'asc' }, { id: 'asc' }] });
    const timerKey = { order_id_rid: { order_id: orderId, rid: riderId } };
    let timer = await tx.pkg_order_wait_timer.findUnique({ where: timerKey });
    let progress = await tx.driver_trip_progress.findUnique({ where: { order_id: orderId } });
    if (![1, 2, 3].includes(order.order_status)) {
      if (action !== 'sync') fail('This trip is no longer active');
      return snapshot(order, progress, timer, stops.length);
    }
    if (progress && progress.rider_id !== riderId) fail('Trip belongs to a different driver');
    if (!progress) progress = await tx.driver_trip_progress.create({ data: { order_id: orderId, rider_id: riderId } });
    if (managed) progress.automation_enabled = true;
    const blocked = getAdvancePaymentTimerInfo(order).is_advance_payment_required;
    if (blocked && action !== 'sync') fail('Wait for advance payment before starting the trip');
    if (blocked) {
      progress.last_sample_at = new Date(); progress.candidate_key = null;
      progress.candidate_since = null; progress.candidate_count = 0;
    }

    async function event(milestone, message) {
      await tx.driver_trip_event.upsert({
        where: { order_id_milestone: { order_id: orderId, milestone } }, update: {},
        create: { order_id: orderId, rider_id: riderId, user_id: order.uid, milestone,
          payload: { ...snapshot(order, progress, timer, stops.length), milestone, message } },
      });
    }
    async function arrive(target, at) {
      if (target === 'arrived') {
        if (order.order_status !== 1) return;
        Object.assign(order, await tx.pkg_order.update({ where: { id: orderId }, data: { order_status: 2, o_status: 'Pickup' } }));
        timer = await tx.pkg_order_wait_timer.upsert({ where: timerKey,
          create: { order_id: orderId, rid: riderId, pickup_wait_start: at, created_at: new Date() },
          update: { pickup_wait_start: at, pickup_wait_end: null, pickup_wait_seconds: 0, updated_at: new Date() } });
        await event('arrived', 'Your driver has arrived at the pickup location.');
      } else if (target === 'arrived_drop') {
        if (order.order_status !== 3 || progress.stop_step !== stops.length * 2) fail('Finish the active stop first');
        progress.stop_step++;
        timer = await tx.pkg_order_wait_timer.upsert({ where: timerKey,
          create: { order_id: orderId, rid: riderId, drop_wait_start: at, created_at: new Date() },
          update: { drop_wait_start: at, updated_at: new Date() } });
        await event('arrived_drop', 'Your driver has arrived at the drop location. Please receive your goods.');
      } else {
        const stopNumber = Number(target.substring('arrived_stop_'.length));
        if (order.order_status !== 3 || progress.stop_step !== (stopNumber - 1) * 2 || stopNumber > stops.length) fail('This is not the active stop');
        progress.stop_step++;
        await event(target, `Your driver has arrived at stop ${stopNumber}.`);
      }
      progress.candidate_key = null; progress.candidate_since = null; progress.candidate_count = 0;
    }

    if (action === 'sync' && !blocked) {
      let target = null;
      if (order.order_status === 1) target = { key: 'arrived', lat: order.plat, lng: order.plong };
      if (order.order_status === 3 && progress.stop_step % 2 === 0) {
        const index = progress.stop_step / 2;
        if (index < stops.length) target = { key: `arrived_stop_${index + 1}`, lat: stops[index].lat, lng: stops[index].lng };
        else if (index === stops.length) target = { key: 'arrived_drop', lat: order.dlat, lng: order.dlong };
      }
      if (target) {
        for (const sample of [...samples].sort((a, b) => Number(a.timestamp) - Number(b.timestamp))) {
          // Only observations made during the current leg can trigger its arrival.
          const legStart = order.order_status === 1 ? order.accept_time : order.pickup_time;
          let legStartMs = legStart ? new Date(legStart).getTime() : 0;
          if (legStartMs > Date.now() + 5000) legStartMs -= 330 * 60000;
          if (Number(sample.timestamp) < legStartMs) continue;
          const observed = observeArrival(progress, sample, target);
          const { arrived, ...state } = observed;
          Object.assign(progress, state);
          if (arrived) {
            // Use confirmation time, never the start of the proximity window.
            await arrive(target.key, new Date(sample.timestamp));
            break;
          }
        }
      }
    } else if (action === 'arrived') {
      await arrive(action, new Date()); // explicit manual fallback for weak GPS/wrong pins
    } else if (action === 'verify_otp' || action === 'pickup') {
      if (otp !== undefined) {
        if (!order.otp || String(otp).trim() !== String(order.otp).trim()) fail('Invalid pickup OTP');
        progress.otp_verified_at = progress.otp_verified_at || new Date();
      }
      if (!progress.otp_verified_at) fail('Verify the pickup OTP after goods are handed over');
      if (action === 'pickup' && order.order_status !== 3) {
        if (order.order_status !== 2) fail('Mark pickup arrival before verifying handover');
        const now = new Date();
        Object.assign(order, await tx.pkg_order.update({ where: { id: orderId }, data: { order_status: 3, o_status: 'On_Route', pickup_time: now } }));
        timer = await tx.pkg_order_wait_timer.update({ where: timerKey, data: {
          pickup_wait_end: now, pickup_wait_seconds: timer?.pickup_wait_start ? Math.max(0, Math.floor((now - new Date(timer.pickup_wait_start)) / 1000)) : 0,
        } });
        progress.candidate_key = null; progress.candidate_since = null; progress.candidate_count = 0;
        progress.last_sample_at = now;
        await event('pickup', 'Your goods have been picked up. Your driver is starting the delivery.');
      }
    } else if (/^arrived_stop_[1-9]\d*$/.test(action) || action === 'arrived_drop') {
      const requestedStep = action === 'arrived_drop' ? stops.length * 2 : (Number(action.split('_').pop()) - 1) * 2;
      if (progress.stop_step <= requestedStep) await arrive(action, new Date());
    } else if (/^complete_stop_[1-9]\d*$/.test(action)) {
      const number = Number(action.split('_').pop());
      if (number > stops.length || order.order_status !== 3) fail('Invalid stop');
      if (progress.stop_step < number * 2) {
        if (progress.stop_step !== number * 2 - 1) fail('Mark stop arrival before completing it');
        progress.stop_step++;
        progress.last_sample_at = new Date();
        progress.candidate_key = null; progress.candidate_since = null; progress.candidate_count = 0;
        await event(action, `Stop ${number} is complete. Your driver is heading to the next destination.`);
      }
    } else if (action !== 'sync') fail('Unsupported trip action');

    const { order_id, rider_id, updated_at, ...changes } = progress;
    progress = await tx.driver_trip_progress.update({ where: { order_id: orderId }, data: changes });
    return snapshot(order, progress, timer, stops.length);
  }, { maxWait: 5000, timeout: 15000 });
  // Commit first. Outbox retries independently if FCM/network is unavailable.
  void require('./tripEventNotifier').flushTripEvents().catch(() => {});
  return result;
}

module.exports = { progressTrip, snapshot };
