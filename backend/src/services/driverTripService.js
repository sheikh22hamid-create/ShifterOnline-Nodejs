const prisma = require('../config/db');
const { observeArrival } = require('./tripArrivalPolicy');
const { getAdvancePaymentTimerInfo } = require('../utils/advancePaymentTimer');
const { getPickupOtpTimeoutMinutes } = require('../utils/pickupOtpTimeout');
const { getPickupRelocateSettings } = require('../utils/pickupRelocateSettings');
const { computeRouteDistanceKm } = require('./orderRouteRepricing');
const { haversineKm } = require('../utils/geoDistance');
const { recordSamples } = require('./tripRouteService');
const { getPickupEtaRow } = require('./pickupEtaService');
const { reconcileRideDiscountToFare } = require('./referralPointsRefund');

// Arrival time comes from the phone's own clock. A phone running minutes
// behind the server would back-date the arrival and shorten the customer's
// OTP window (cancel fires early), so never trust a stamp older than a minute
// or from the future - both are clamped to server time.
const ARRIVAL_STAMP_MAX_AGE_MS = 60000;
function clampToServerTime(timestampMs, nowMs = Date.now()) {
  const ts = Number(timestampMs);
  if (!Number.isFinite(ts)) return nowMs;
  return Math.min(nowMs, Math.max(ts, nowMs - ARRIVAL_STAMP_MAX_AGE_MS));
}
const sameCoord = (a, b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) < 1e-6;

function fail(message) { const error = new Error(message); error.statusCode = 409; throw error; }
async function snapshot(order, progress, timer, stopCount) {
  const active = [1, 2, 3].includes(order.order_status);
  // Waiting-for-OTP countdown, admin-configurable (Settings > Pickup OTP
  // timeout) - same source tripLifecycle.sweepOverduePickups enforces
  // against, so the driver's on-screen timer never drifts from when the
  // trip would actually auto-cancel. Only meaningful while arrived at
  // pickup and still waiting (pickup_wait_start set, not yet handed over).
  // pickup_wait_banked_seconds is time already spent waiting at a previous
  // pickup point before a large relocation paused the clock - it still
  // counts, exactly as sweepOverduePickups counts it.
  let pickupOtpRemainingSeconds = 0;
  if (timer?.pickup_wait_start && !timer?.pickup_wait_end) {
    const timeoutMinutes = await getPickupOtpTimeoutMinutes();
    const elapsedMs = (Date.now() - new Date(timer.pickup_wait_start).getTime())
      + (Number(timer.pickup_wait_banked_seconds) || 0) * 1000;
    pickupOtpRemainingSeconds = Math.max(0, Math.round(timeoutMinutes * 60 - elapsedMs / 1000));
  }
  // Pickup-ETA countdown (driver must reach the pickup by this deadline or the
  // order auto-cancels with a penalty) - only while still heading to pickup.
  let pickupDeadlineMs = 0;
  if (order.order_status === 1) {
    const etaRow = await getPickupEtaRow(order.id);
    pickupDeadlineMs = etaRow?.pickup_deadline_at ? new Date(etaRow.pickup_deadline_at).getTime() : 0;
  }
  return {
    pickup_deadline_ms: pickupDeadlineMs,
    pickup_eta_remaining_seconds: pickupDeadlineMs ? Math.max(0, Math.round((pickupDeadlineMs - Date.now()) / 1000)) : 0,
    order_id: order.id, order_status: order.order_status, o_status: order.o_status, city_id: order.city_id,
    active, driver_flow_id: active && timer?.drop_wait_start ? 4 : order.order_status,
    stop_step: progress?.stop_step || 0, stop_count: stopCount,
    pickup_wait_start: timer?.pickup_wait_start ? new Date(timer.pickup_wait_start).getTime() : 0,
    pickup_wait_seconds: timer?.pickup_wait_seconds || 0,
    pickup_otp_remaining_seconds: pickupOtpRemainingSeconds,
    // otp_verified/pickup_load_wait_start let the driver app know when to
    // swap the OTP-entry UI for the "Pickup Complete" button, and show its
    // own loading-time counter - see the 'pickup_complete' action below.
    otp_verified: !!progress?.otp_verified_at,
    pickup_load_wait_start: timer?.pickup_load_wait_start ? new Date(timer.pickup_load_wait_start).getTime() : 0,
    pickup_load_wait_seconds: timer?.pickup_load_wait_seconds || 0,
    drop_wait_start: timer?.drop_wait_start ? new Date(timer.drop_wait_start).getTime() : 0,
    server_time: Date.now(), version: progress?.updated_at ? new Date(progress.updated_at).getTime() : 0,
  };
}

async function progressTrip({ orderId, riderId, action = 'sync', otp, samples = [], managed = false, lat, lng }) {
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
      return await snapshot(order, progress, timer, stops.length);
    }
    if (progress && progress.rider_id !== riderId) fail('Trip belongs to a different driver');
    if (!progress) progress = await tx.driver_trip_progress.create({ data: { order_id: orderId, rider_id: riderId } });
    // Keep the driven GPS trail for the customer's completed-order route map.
    // Best effort: a trail problem must never block the trip itself.
    try {
      await recordSamples(tx, { orderId, riderId, orderStatus: order.order_status, samples });
    } catch (err) {
      require('../utils/logger').error(`progressTrip: recordSamples failed for order ${orderId}:`, err);
    }
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
          payload: { ...(await snapshot(order, progress, timer, stops.length)), milestone, message } },
      });
    }
    async function arrive(target, at) {
      if (target === 'arrived') {
        if (order.order_status !== 1) return;
        Object.assign(order, await tx.pkg_order.update({ where: { id: orderId }, data: { order_status: 2, o_status: 'Pickup' } }));
        timer = await tx.pkg_order_wait_timer.upsert({ where: timerKey,
          create: { order_id: orderId, rid: riderId, pickup_wait_start: at, first_arrival_at: at, created_at: new Date() },
          update: { pickup_wait_start: at, pickup_wait_end: null, pickup_wait_seconds: 0, updated_at: new Date(),
            // Only set on the row's FIRST arrival — an upsert's `update`
            // branch means the row already existed, so only stamp this if
            // a prior cycle (pause/relocation) left it unset.
            ...(timer?.first_arrival_at ? {} : { first_arrival_at: at }) } });
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

    // Pickup-timer pause: the driver is going to a different pickup point (or
    // simply left the pin), so the auto-cancel clock must stop. Same bookkeeping
    // as orderPickupService's relocation pause: bank the time already waited,
    // clear the running clock, send the trip back to "en route" and drop the
    // stale "arrived" milestone so a fresh arrival re-notifies the customer.
    // `suppressAutoArrival`: after a MANUAL pause the driver is still standing
    // at the old pin, so GPS must not instantly re-arrive there while the pickup
    // is unchanged (they confirm arrival at the new spot manually, or the
    // customer moves the pin).
    async function pausePickupTimer(reason, at, suppressAutoArrival) {
      if (order.order_status !== 2 || !timer?.pickup_wait_start || timer.pickup_wait_end || progress.otp_verified_at) return false;
      const elapsedSeconds = Math.max(0, Math.floor((at - new Date(timer.pickup_wait_start)) / 1000));
      timer = await tx.pkg_order_wait_timer.update({ where: timerKey, data: {
        pickup_wait_start: null, pickup_wait_seconds: 0,
        pickup_wait_banked_seconds: (Number(timer.pickup_wait_banked_seconds) || 0) + elapsedSeconds,
        updated_at: new Date(),
      } });
      Object.assign(order, await tx.pkg_order.update({ where: { id: orderId }, data: { order_status: 1, o_status: 'Processing' } }));
      await tx.driver_trip_event.deleteMany({ where: { order_id: orderId, milestone: 'arrived' } });
      // The driver already arrived once - the pickup-ETA deadline is spent; the OTP-wait and relocation-ceiling sweeps bound the rest.
      try { await tx.$executeRaw`UPDATE pkg_order SET pickup_deadline_at = NULL WHERE id = ${orderId}`; } catch (_) { /* column not on this DB yet */ }
      progress.candidate_key = null; progress.candidate_since = null; progress.candidate_count = 0;
      progress.last_sample_at = at;
      const payload = {
        ...(await snapshot(order, progress, timer, stops.length)),
        milestone: 'pickup_timer_paused',
        message: 'Your driver is heading to your updated pickup location.',
        reason, suppress_auto_arrival: Boolean(suppressAutoArrival),
        pickup_lat: order.plat, pickup_lng: order.plong,
      };
      await tx.driver_trip_event.upsert({
        where: { order_id_milestone: { order_id: orderId, milestone: 'pickup_timer_paused' } },
        update: { payload, sent_at: null, lease_until: null },
        create: { order_id: orderId, rider_id: riderId, user_id: order.uid, milestone: 'pickup_timer_paused', payload },
      });
      return true;
    }

    async function completePickup(at) {
      Object.assign(order, await tx.pkg_order.update({ where: { id: orderId }, data: { order_status: 3, o_status: 'On_Route', pickup_time: at } }));
      const loadWaitSeconds = timer?.pickup_load_wait_start
        ? Math.max(0, Math.floor((at - new Date(timer.pickup_load_wait_start)) / 1000)) : 0;
      timer = await tx.pkg_order_wait_timer.update({ where: timerKey, data: {
        pickup_load_wait_seconds: loadWaitSeconds, pickup_load_wait_start: null,
      } });
      progress.candidate_key = null; progress.candidate_since = null; progress.candidate_count = 0;
      progress.last_sample_at = at;
      await event('pickup', 'Your goods have been picked up. Your driver is starting the delivery.');
    }

    if (action === 'sync' && !blocked) {
      // Waiting for the OTP and the driver has driven off (more than the
      // admin distance, default 500 m, from the pickup pin): pause the
      // auto-cancel timer for them instead of letting it run out.
      if (order.order_status === 2 && timer?.pickup_wait_start && !timer.pickup_wait_end && !progress.otp_verified_at) {
        const { autoPauseDistanceM } = await getPickupRelocateSettings();
        const limitM = Number(autoPauseDistanceM) > 0 ? Number(autoPauseDistanceM) : 500;
        const pLat = Number(order.plat), pLng = Number(order.plong);
        const waitStartMs = new Date(timer.pickup_wait_start).getTime();
        if ([pLat, pLng].every(Number.isFinite)) {
          for (const sample of [...samples].sort((a, b) => Number(a.timestamp) - Number(b.timestamp))) {
            const sLat = Number(sample.lat), sLng = Number(sample.lng);
            if (![sLat, sLng].every(Number.isFinite) || Number(sample.timestamp) < waitStartMs) continue;
            if (haversineKm(pLat, pLng, sLat, sLng) * 1000 > limitM) {
              await pausePickupTimer('left_pickup', new Date(clampToServerTime(sample.timestamp)), false);
              break;
            }
          }
        }
      }
      let target = null;
      if (order.order_status === 1) {
        target = { key: 'arrived', lat: order.plat, lng: order.plong };
        // Manual pause + pickup pin unchanged: don't auto-re-arrive at the same pin.
        const paused = await tx.driver_trip_event.findUnique({
          where: { order_id_milestone: { order_id: orderId, milestone: 'pickup_timer_paused' } },
        });
        const p = paused?.payload;
        if (p?.suppress_auto_arrival && sameCoord(p.pickup_lat, order.plat) && sameCoord(p.pickup_lng, order.plong)) target = null;
      }
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
            await arrive(target.key, new Date(clampToServerTime(sample.timestamp)));
            break;
          }
        }
      }
      // Driver verified the OTP but never tapped "Pickup Complete" - if they
      // physically leave the pickup vicinity, treat that as an implicit
      // confirmation instead of leaving the trip stuck waiting on a tap that
      // may never come.
      if (order.order_status === 2 && progress.otp_verified_at && timer?.pickup_load_wait_start) {
        const { autoCompleteDistanceM } = await getPickupRelocateSettings();
        const pLat = Number(order.plat), pLng = Number(order.plong);
        if ([pLat, pLng].every(Number.isFinite)) {
          for (const sample of [...samples].sort((a, b) => Number(a.timestamp) - Number(b.timestamp))) {
            const sLat = Number(sample.lat), sLng = Number(sample.lng);
            if (![sLat, sLng].every(Number.isFinite)) continue;
            const distanceM = haversineKm(pLat, pLng, sLat, sLng) * 1000;
            if (distanceM > autoCompleteDistanceM) {
              await completePickup(new Date(sample.timestamp));
              break;
            }
          }
        }
      }
    } else if (action === 'auto_pause_pickup_timer') {
      // Server-initiated (sweepOverduePickups: the driver's last known position
      // is already well past the pickup but their app hasn't synced the pause).
      if (!(await pausePickupTimer('left_pickup', new Date(Date.now()), false))) fail('The pickup timer can only be paused while you are waiting for the OTP');
    } else if (action === 'pause_pickup_timer') {
      if (!(await pausePickupTimer('driver_paused', new Date(Date.now()), true))) fail('The pickup timer can only be paused while you are waiting for the OTP');
    } else if (action === 'arrived') {
      await arrive(action, new Date(Date.now())); // explicit manual fallback for weak GPS/wrong pins
    } else if (action === 'verify_otp' || action === 'pickup' || action === 'pickup_complete') {
      const wasVerified = !!progress.otp_verified_at;
      if (otp !== undefined) {
        if (!order.otp || String(otp).trim() !== String(order.otp).trim()) fail('Invalid pickup OTP');
        progress.otp_verified_at = progress.otp_verified_at || new Date();
      }
      if (!progress.otp_verified_at) fail('Verify the pickup OTP after goods are handed over');
      const newlyVerified = !wasVerified && !!progress.otp_verified_at;

      if (newlyVerified) {
        if (order.order_status !== 2) fail('Mark pickup arrival before verifying handover');
        const verifiedAt = new Date();
        // Snapshot of where the driver actually was when they confirmed the
        // pickup OTP. Always recorded for reporting; the mismatch check
        // below additionally reprices the trip against this point when it
        // differs materially from the last confirmed pickup (see the
        // otp_verify_lat/lng schema comment). Silently skipped if the app
        // didn't send a fix (older app version, or no GPS available at that
        // instant) - never blocks OTP verification itself.
        const hasFix = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
        timer = await tx.pkg_order_wait_timer.update({ where: timerKey, data: {
          pickup_wait_end: verifiedAt, pickup_wait_seconds: timer?.pickup_wait_start ? Math.max(0, Math.floor((verifiedAt - new Date(timer.pickup_wait_start)) / 1000)) : 0,
          // Starts the loading-wait clock - ends in completePickup(), whether
          // from an explicit "Pickup Complete" tap or the leave-the-vicinity
          // auto-trigger above.
          pickup_load_wait_start: verifiedAt,
          ...(hasFix ? { otp_verify_lat: String(lat), otp_verify_lng: String(lng), otp_verify_at: verifiedAt } : {}),
        } });
        if (hasFix) {
          const oldLat = Number(order.plat), oldLng = Number(order.plong);
          const mismatchDistanceM = [oldLat, oldLng].every(Number.isFinite)
            ? haversineKm(oldLat, oldLng, Number(lat), Number(lng)) * 1000
            : Infinity;
          const { otpMismatchFlagM } = await getPickupRelocateSettings();
          if (mismatchDistanceM > otpMismatchFlagM) {
            const newDistanceKm = await computeRouteDistanceKm({ plat: lat, plong: lng, stops, dlat: order.dlat, dlong: order.dlong });
            const packageId = Number(order.delivery_type) || 1;
            const extraMileCharge = Number(order.extra_mile_charge) || 0;
            const pricingEngine = require('./pricingEngine');
            // The radius (driver-to-pickup) charge was fixed at accept time off
            // the driver's real distance THEN. Repricing it off the driver's
            // live position here would zero it (they're standing at the OTP
            // point), and pkg_order.radius_charge never holds the real value
            // (written 0 at creation, never updated). So recover it from the
            // current d_charge: whatever sits above a zero-radius fare at the
            // order's current distance is carried over onto the new route's
            // zero-radius fare unchanged.
            const zeroRadiusOld = await pricingEngine.priceForPackageId(packageId, Number(order.distance) || 0, 1, extraMileCharge, order.uid);
            const impliedRadiusAmount = Math.max(0, (Number(order.d_charge) || 0) - zeroRadiusOld.fare);
            const zeroRadiusNew = await pricingEngine.priceForPackageId(packageId, newDistanceKm, 1, extraMileCharge, order.uid);
            const finalDCharge = Math.round(zeroRadiusNew.fare + impliedRadiusAmount);
            // Same conventions as tripLifecycle.finalizeAcceptedOrder:
            // driver_earning is the gross fare (commission is clawed back at
            // completion) and `commission` is a PERCENTAGE. Keep this order's
            // own existing percentage so its split is preserved as-is.
            const existingCommissionPercent = order.commission !== null && order.commission !== undefined && Number.isFinite(Number(order.commission))
              ? Number(order.commission)
              : zeroRadiusNew.commission;
            Object.assign(order, await tx.pkg_order.update({ where: { id: orderId }, data: {
              plat: String(lat), plong: String(lng), distance: Math.round(newDistanceKm * 100) / 100,
              d_charge: finalDCharge, total_dcharge: finalDCharge,
              driver_earning: finalDCharge, commission: existingCommissionPercent, pickup_otp_mismatch_flag: true,
            } }));
            await reconcileRideDiscountToFare(orderId, finalDCharge, tx);
          }
        }
      }

      if ((action === 'pickup' || action === 'pickup_complete') && order.order_status !== 3) {
        if (order.order_status !== 2) fail('Mark pickup arrival before verifying handover');
        await completePickup(new Date());
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
    return await snapshot(order, progress, timer, stops.length);
  }, { maxWait: 5000, timeout: 15000 });
  // Commit first. Outbox retries independently if FCM/network is unavailable.
  void require('./tripEventNotifier').flushTripEvents().catch(() => {});
  return result;
}

module.exports = { progressTrip, snapshot };
